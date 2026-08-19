// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EnrgOracleAttestation
/// @notice Minimal contract for accepting attestations from trusted oracles.
contract EnrgOracleAttestation {
    struct AttestationCore {
        bytes32 attestationId;
        bytes32 deviceId;
        bool allowed;
        uint64 maxPowerW;
        address oracle;
        uint64 issuedAt; // unix timestamp
    }

    /// @notice trusted oracles that may submit attestations
    mapping(address => bool) public trustedOracles;

    /// @notice attestations stored by their identifier
    mapping(bytes32 => AttestationCore) public attestations;

    /// @notice to avoid overwriting an existing attestation
    mapping(bytes32 => bool) public attestationExists;

    address public owner;

    event OracleUpdated(address indexed oracle, bool trusted);
    event Attested(
        bytes32 indexed attestationId,
        bytes32 indexed deviceId,
        bool allowed,
        uint64 maxPowerW,
        address indexed oracle,
        uint64 issuedAt
    );

    error NotOwner();
    error NotTrustedOracle();
    error AttestationAlreadyExists();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Set/clear trust for an oracle
    function setTrustedOracle(address oracle, bool trusted) external onlyOwner {
        trustedOracles[oracle] = trusted;
        emit OracleUpdated(oracle, trusted);
    }

    /// @notice Submit an attestation. Only trusted oracles may call.
    /// @dev The off-chain layer is expected to have already converted strings to bytes32/uint64.
    function submitAttestation(
        bytes32 attestationId,
        bytes32 deviceId,
        bool allowed,
        uint64 maxPowerW,
        uint64 issuedAt
    ) external {
        if (!trustedOracles[msg.sender]) revert NotTrustedOracle();
        if (attestationExists[attestationId]) revert AttestationAlreadyExists();

        AttestationCore memory att = AttestationCore({
            attestationId: attestationId,
            deviceId: deviceId,
            allowed: allowed,
            maxPowerW: maxPowerW,
            oracle: msg.sender,
            issuedAt: issuedAt
        });

        attestations[attestationId] = att;
        attestationExists[attestationId] = true;

        emit Attested(
            attestationId,
            deviceId,
            allowed,
            maxPowerW,
            msg.sender,
            issuedAt
        );
    }
}
