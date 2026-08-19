// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ENRG Oracle Attestation Contract (minimal skeleton)
/// @notice Accepts attestations from trusted oracles and emits events.
contract EnrgOracleAttestation {
    /// @dev Trusted oracles (usually addresses behind the off-chain Oracle services).
    mapping(address => bool) public isTrustedOracle;

    /// @dev Contract owner address (temporarily a centralized admin / DAO multisig).
    address public owner;

    /// @notice Attestation about a device state/decision.
    struct Attestation {
        bytes32 deviceId;       // Hash/byte representation of device_id ("dev_...")
        address oracle;         // Oracle address (msg.sender)
        bool allowed;           // Whether the action/mode is allowed
        int96 maxPowerKw;       // Max power * 1e6 (fixed precision)
        uint64 issuedAt;        // Attestation issue unix timestamp
        bytes32 proofHash;      // Hash of the original DeviceProof/Attestation JSON (stored off-chain)
    }

    /// @dev Event other contracts / off-chain clients will listen to.
    event DeviceAttested(
        bytes32 indexed deviceId,
        address indexed oracle,
        bool allowed,
        int96 maxPowerKw,
        uint64 issuedAt,
        bytes32 proofHash
    );

    /// @dev Emitted when a trusted oracle is added/removed.
    event TrustedOracleUpdated(address indexed oracle, bool isTrusted);

    error NotOwner();
    error NotTrustedOracle();

    constructor(address _owner) {
        owner = _owner;
    }

    /// @notice Updates the trusted-oracle status.
    /// @dev In production this will be governed by a DAO / multisig.
    function setTrustedOracle(address oracle, bool trusted) external {
        if (msg.sender != owner) revert NotOwner();
        isTrustedOracle[oracle] = trusted;
        emit TrustedOracleUpdated(oracle, trusted);
    }

    /// @notice Accepts an attestation from a trusted oracle.
    /// @param deviceId Hash/byte representation of `device_id` (e.g., keccak256("dev_9e9c...")).
    /// @param allowed Whether the action is allowed.
    /// @param maxPowerKw Max power * 1e6 (fractional part without float).
    /// @param issuedAt Attestation issue unix timestamp.
    /// @param proofHash keccak256 of the serialized Attestation/DeviceProof JSON.
    function submitAttestation(
        bytes32 deviceId,
        bool allowed,
        int96 maxPowerKw,
        uint64 issuedAt,
        bytes32 proofHash
    ) external {
        if (!isTrustedOracle[msg.sender]) revert NotTrustedOracle();

        // Extra checks can be added here (e.g., issuedAt not too far in the past/future).

        emit DeviceAttested(deviceId, msg.sender, allowed, maxPowerKw, issuedAt, proofHash);
    }
}
