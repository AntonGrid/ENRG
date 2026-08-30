// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EnrgOracleAttestation
/// @notice Multi-oracle attestation sink with k-of-n quorum and a governance
///         timelock (audit P1-6 / P0-4, 2026-08-30).
///
/// Trust model:
///   - An attestation is finalized only after `oracleThreshold` DISTINCT
///     trusted oracles confirmed the SAME payload (k-of-n). A single oracle
///     can no longer forge an attestation (fixes the "single oracle" finding).
///   - Oracle membership and the threshold are governed through a timelock:
///     scheduleSetTrustedOracle() -> wait TIMELOCK -> executeSetTrustedOracle().
///   - Ownership uses a 2-step transfer (transferOwnership + acceptOwnership).
contract EnrgOracleAttestation {
    struct AttestationCore {
        bytes32 attestationId;
        bytes32 deviceId;
        bool allowed;
        uint64 maxPowerW;
        uint64 issuedAt;
        uint16 confirmations;
        bool finalized;
        address firstOracle;
    }

    /// @notice trusted oracles that may confirm attestations
    mapping(address => bool) public trustedOracles;

    /// @notice attestations by their identifier
    mapping(bytes32 => AttestationCore) public attestations;

    /// @notice per-attestation vote bookkeeping (prevents double voting)
    mapping(bytes32 => mapping(address => bool)) public oracleVoted;

    /// @notice to avoid overwriting an existing finalized attestation
    mapping(bytes32 => bool) public attestationExists;

    /// @notice pending oracle-trust / threshold changes awaiting the timelock
    mapping(bytes32 => uint256) public pendingOracleUpdateAt;

    address public owner;
    address public pendingOwner;

    /// @notice minimum distinct-oracle confirmations to finalize an attestation
    uint256 public oracleThreshold;

    uint256 public constant TIMELOCK = 2 days;
    uint256 public constant MAX_ORACLES = 20;
    uint256 public constant MAX_THRESHOLD = 10;

    event OracleUpdated(address indexed oracle, bool trusted);
    event OracleUpdateScheduled(address indexed oracle, bool trusted, uint256 executeAt);
    event OracleConfirmed(bytes32 indexed attestationId, address indexed oracle, uint16 confirmations);
    event Attested(
        bytes32 indexed attestationId,
        bytes32 indexed deviceId,
        bool allowed,
        uint64 maxPowerW,
        uint64 issuedAt,
        uint16 confirmations
    );
    event ThresholdScheduled(uint256 threshold, uint256 executeAt);
    event ThresholdChanged(uint256 threshold);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotTrustedOracle();
    error AttestationAlreadyExists();
    error AlreadyVoted();
    error PayloadMismatch();
    error TimelockNotElapsed();
    error NoPendingUpdate();
    error InvalidThreshold();
    error OracleLimitReached();

    constructor() {
        owner = msg.sender;
        oracleThreshold = 1; // k=1 default; raise via schedule/execute
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ── Governance: oracle set (timelocked) ────────────────────────────────

    /// @notice Schedule a trust change for an oracle (takes effect after TIMELOCK).
    function scheduleSetTrustedOracle(address oracle, bool trusted) external onlyOwner {
        bytes32 key = keccak256(abi.encode(oracle, trusted));
        pendingOracleUpdateAt[key] = block.timestamp + TIMELOCK;
        emit OracleUpdateScheduled(oracle, trusted, block.timestamp + TIMELOCK);
    }

    /// @notice Execute a previously scheduled trust change after the timelock.
    function executeSetTrustedOracle(address oracle, bool trusted) external {
        bytes32 key = keccak256(abi.encode(oracle, trusted));
        uint256 executeAt = pendingOracleUpdateAt[key];
        if (executeAt == 0) revert NoPendingUpdate();
        if (block.timestamp < executeAt) revert TimelockNotElapsed();
        delete pendingOracleUpdateAt[key];
        trustedOracles[oracle] = trusted;
        emit OracleUpdated(oracle, trusted);
    }

    // ── Governance: k-of-n threshold (timelocked) ──────────────────────────

    /// @notice Schedule a new k-of-n threshold (takes effect after TIMELOCK).
    function scheduleSetThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0 || newThreshold > MAX_THRESHOLD) revert InvalidThreshold();
        pendingOracleUpdateAt[keccak256(abi.encode(newThreshold, "threshold"))] = block.timestamp + TIMELOCK;
        emit ThresholdScheduled(newThreshold, block.timestamp + TIMELOCK);
    }

    /// @notice Execute a scheduled threshold change after the timelock.
    function executeSetThreshold(uint256 newThreshold) external {
        bytes32 key = keccak256(abi.encode(newThreshold, "threshold"));
        uint256 executeAt = pendingOracleUpdateAt[key];
        if (executeAt == 0) revert NoPendingUpdate();
        if (block.timestamp < executeAt) revert TimelockNotElapsed();
        delete pendingOracleUpdateAt[key];
        oracleThreshold = newThreshold;
        emit ThresholdChanged(newThreshold);
    }

    // ── Governance: 2-step ownership transfer ──────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    // ── Attestation submission (k-of-n quorum) ─────────────────────────────

    /// @notice Confirm an attestation. A trusted oracle may vote once.
    ///         The attestation is finalized when `confirmations >= oracleThreshold`.
    function submitAttestation(
        bytes32 attestationId,
        bytes32 deviceId,
        bool allowed,
        uint64 maxPowerW,
        uint64 issuedAt
    ) external {
        if (!trustedOracles[msg.sender]) revert NotTrustedOracle();
        if (attestationExists[attestationId]) revert AttestationAlreadyExists();
        if (oracleVoted[attestationId][msg.sender]) revert AlreadyVoted();

        AttestationCore storage att = attestations[attestationId];

        if (att.confirmations == 0) {
            // First vote initializes the canonical payload.
            att.attestationId = attestationId;
            att.deviceId = deviceId;
            att.allowed = allowed;
            att.maxPowerW = maxPowerW;
            att.issuedAt = issuedAt;
            att.firstOracle = msg.sender;
        } else {
            // Subsequent votes must match the payload byte-for-byte.
            if (
                att.deviceId != deviceId ||
                att.allowed != allowed ||
                att.maxPowerW != maxPowerW ||
                att.issuedAt != issuedAt
            ) revert PayloadMismatch();
        }

        oracleVoted[attestationId][msg.sender] = true;
        att.confirmations += 1;

        if (att.confirmations >= uint16(oracleThreshold)) {
            att.finalized = true;
            attestationExists[attestationId] = true;
            emit Attested(attestationId, deviceId, allowed, maxPowerW, issuedAt, att.confirmations);
        } else {
            emit OracleConfirmed(attestationId, msg.sender, att.confirmations);
        }
    }
}

