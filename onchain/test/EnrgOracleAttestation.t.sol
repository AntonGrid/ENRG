// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/EnrgOracleAttestation.sol";

/// @notice Tests for the k-of-n + timelock attestation contract
///         (audit P1-6 / P0-4, 2026-08-30).
contract EnrgOracleAttestationTest is Test {
    EnrgOracleAttestation internal enrg;

    address internal owner = address(0x123);
    address internal oracle1 = address(0xAAA1);
    address internal oracle2 = address(0xAAA2);
    address internal oracle3 = address(0xAAA3);
    address internal stranger = address(0xBEEF);

    function setUp() public {
        vm.prank(owner);
        enrg = new EnrgOracleAttestation();
        _addOracle(oracle1);
    }

    /// Add a trusted oracle through the full schedule -> timelock -> execute flow.
    function _addOracle(address oracle) internal {
        vm.prank(owner);
        enrg.scheduleSetTrustedOracle(oracle, true);
        vm.warp(block.timestamp + enrg.TIMELOCK() + 1);
        enrg.executeSetTrustedOracle(oracle, true);
    }

    function _raiseThreshold(uint256 k) internal {
        vm.prank(owner);
        enrg.scheduleSetThreshold(k);
        vm.warp(block.timestamp + enrg.TIMELOCK() + 1);
        enrg.executeSetThreshold(k);
    }

    // ── Governance timelock ────────────────────────────────────────────────

    function testOwnerCanScheduleAndExecuteTrustedOracle() public {
        assertFalse(enrg.trustedOracles(oracle2));
        vm.prank(owner);
        enrg.scheduleSetTrustedOracle(oracle2, true);
        vm.warp(block.timestamp + enrg.TIMELOCK() + 1);
        enrg.executeSetTrustedOracle(oracle2, true);
        assertTrue(enrg.trustedOracles(oracle2));
    }

    function testOracleTrustChangeRevertsBeforeTimelock() public {
        vm.prank(owner);
        enrg.scheduleSetTrustedOracle(oracle2, true);
        vm.expectRevert(EnrgOracleAttestation.TimelockNotElapsed.selector);
        enrg.executeSetTrustedOracle(oracle2, true);
    }

    function testNonOwnerCannotSchedule() public {
        vm.prank(stranger);
        vm.expectRevert(EnrgOracleAttestation.NotOwner.selector);
        enrg.scheduleSetTrustedOracle(oracle2, true);
    }

    function testThresholdTimelock() public {
        vm.prank(owner);
        enrg.scheduleSetThreshold(2);
        assertEq(enrg.oracleThreshold(), 1, "threshold unchanged before timelock");
        vm.warp(block.timestamp + enrg.TIMELOCK() + 1);
        enrg.executeSetThreshold(2);
        assertEq(enrg.oracleThreshold(), 2);
    }

    function testInvalidThresholdRejected() public {
        vm.prank(owner);
        vm.expectRevert(EnrgOracleAttestation.InvalidThreshold.selector);
        enrg.scheduleSetThreshold(0);
    }

    // ── Two-step ownership ─────────────────────────────────────────────────

    function testTwoStepOwnershipTransfer() public {
        vm.prank(owner);
        enrg.transferOwnership(stranger);
        assertEq(enrg.pendingOwner(), stranger);
        // Non-pending cannot accept.
        vm.prank(oracle1);
        vm.expectRevert(EnrgOracleAttestation.NotOwner.selector);
        enrg.acceptOwnership();
        // Pending accepts.
        vm.prank(stranger);
        enrg.acceptOwnership();
        assertEq(enrg.owner(), stranger);
    }

    // ── k-of-n quorum ──────────────────────────────────────────────────────

    function testSingleOracleFinalizesAtDefaultThreshold() public {
        bytes32 attId = keccak256("att_1");
        bytes32 devId = keccak256("dev_1");
        bool allowed = true;
        uint64 maxPowerW = 2500;
        uint64 issuedAt = 1_700_000_000;

        vm.prank(oracle1);
        enrg.submitAttestation(attId, devId, allowed, maxPowerW, issuedAt);

        (,,,, uint64 issuedAt2, uint16 confirmations, bool finalized, address firstOracle) = enrg.attestations(attId);
        assertEq(confirmations, 1);
        assertTrue(finalized);
        assertTrue(enrg.attestationExists(attId));
    }

    function testMultiOracleQuorumRequired() public {
        _raiseThreshold(2);
        _addOracle(oracle2);

        bytes32 attId = keccak256("att_k2");
        bytes32 devId = keccak256("dev_k2");
        uint64 issuedAt = 1_700_000_000;

        // First oracle: not yet finalized.
        vm.prank(oracle1);
        enrg.submitAttestation(attId, devId, true, 1000, issuedAt);
        (,,,, uint64 issuedAtStoredA, uint16 conf1, bool fin1, address firstOracleA) = enrg.attestations(attId);
        assertEq(conf1, 1);
        assertFalse(fin1, "k=2: one confirmation must not finalize");
        assertFalse(enrg.attestationExists(attId));

        // Second oracle (same payload): finalized.
        vm.prank(oracle2);
        enrg.submitAttestation(attId, devId, true, 1000, issuedAt);
        (,,,, uint64 issuedAtStoredB, uint16 conf2, bool fin2, address firstOracleB) = enrg.attestations(attId);
        assertEq(conf2, 2);
        assertTrue(fin2, "k=2: second confirmation must finalize");
    }

    function testPayloadMismatchBetweenOracles() public {
        _raiseThreshold(2);
        _addOracle(oracle2);

        bytes32 attId = keccak256("att_mismatch");
        bytes32 devId = keccak256("dev_mismatch");
        uint64 issuedAt = 1_700_000_000;

        vm.prank(oracle1);
        enrg.submitAttestation(attId, devId, true, 1000, issuedAt);

        vm.prank(oracle2);
        vm.expectRevert(EnrgOracleAttestation.PayloadMismatch.selector);
        enrg.submitAttestation(attId, devId, false, 9999, issuedAt);
    }

    function testNonTrustedOracleCannotSubmit() public {
        bytes32 attId = keccak256("att_3");
        bytes32 devId = keccak256("dev_3");
        vm.prank(stranger);
        vm.expectRevert(EnrgOracleAttestation.NotTrustedOracle.selector);
        enrg.submitAttestation(attId, devId, true, 1000, 1_700_000_200);
    }

    function testCannotSubmitSameAttestationTwice() public {
        bytes32 attId = keccak256("att_4");
        bytes32 devId = keccak256("dev_4");
        vm.prank(oracle1);
        enrg.submitAttestation(attId, devId, true, 1000, 1_700_000_300);
        vm.prank(oracle1);
        vm.expectRevert(EnrgOracleAttestation.AttestationAlreadyExists.selector);
        enrg.submitAttestation(attId, devId, false, 2000, 1_700_000_400);
    }

    function testOracleCannotVoteTwice() public {
        _raiseThreshold(2);
        _addOracle(oracle2);

        bytes32 attId = keccak256("att_5");
        bytes32 devId = keccak256("dev_5");
        uint64 issuedAt = 1_700_000_000;

        vm.prank(oracle1);
        enrg.submitAttestation(attId, devId, true, 1000, issuedAt);

        // oracle1 votes again before finalization -> AlreadyVoted.
        vm.prank(oracle1);
        vm.expectRevert(EnrgOracleAttestation.AlreadyVoted.selector);
        enrg.submitAttestation(attId, devId, true, 1000, issuedAt);
    }
}
