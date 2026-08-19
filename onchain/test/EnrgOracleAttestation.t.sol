// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/EnrgOracleAttestation.sol";

contract EnrgOracleAttestationTest is Test {
    EnrgOracleAttestation internal enrg;

    address internal owner = address(0x123);
    address internal oracle1 = address(0xAAA1);
    address internal oracle2 = address(0xAAA2);
    address internal stranger = address(0xBEEF);

    function setUp() public {
        // Deploy the contract as the owner
        vm.prank(owner);
        enrg = new EnrgOracleAttestation();

        // Make oracle1 trusted
        vm.prank(owner);
        enrg.setTrustedOracle(oracle1, true);
    }

    function testOwnerCanSetTrustedOracle() public {
        vm.prank(owner);
        enrg.setTrustedOracle(oracle2, true);

        assertTrue(enrg.trustedOracles(oracle2));
    }

    function testNonOwnerCannotSetTrustedOracle() public {
        vm.prank(stranger);
        vm.expectRevert(EnrgOracleAttestation.NotOwner.selector);
        enrg.setTrustedOracle(oracle2, true);
    }

    function testTrustedOracleCanSubmitAttestation() public {
        bytes32 attId = keccak256("att_1");
        bytes32 devId = keccak256("dev_1");
        bool allowed = true;
        uint64 maxPowerW = 2500;
        uint64 issuedAt = 1_700_000_000;

        vm.prank(oracle1);
        enrg.submitAttestation(attId, devId, allowed, maxPowerW, issuedAt);

        (
            bytes32 sAttId,
            bytes32 sDevId,
            bool sAllowed,
            uint64 sMaxPowerW,
            address sOracle,
            uint64 sIssuedAt
        ) = enrg.attestations(attId);

        assertEq(sAttId, attId);
        assertEq(sDevId, devId);
        assertEq(sAllowed, allowed);
        assertEq(sMaxPowerW, maxPowerW);
        assertEq(sOracle, oracle1);
        assertEq(sIssuedAt, issuedAt);
        assertTrue(enrg.attestationExists(attId));
    }

    function testEventEmittedOnSubmit() public {
        bytes32 attId = keccak256("att_2");
        bytes32 devId = keccak256("dev_2");
        bool allowed = false;
        uint64 maxPowerW = 5000;
        uint64 issuedAt = 1_700_000_100;

        vm.prank(oracle1);
        vm.expectEmit(true, true, true, true);
        emit EnrgOracleAttestation.Attested(attId, devId, allowed, maxPowerW, oracle1, issuedAt);

        enrg.submitAttestation(attId, devId, allowed, maxPowerW, issuedAt);
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
}
