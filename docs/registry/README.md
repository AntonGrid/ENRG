# Manifest Registry — ENRG

Purpose
---------
Manifest Registry — the canonical service for publishing and distributing:
- Device Enrollment Manifests (device identity + pubkey + provenance)
- Firmware Manifests (firmware metadata + hashes + signatures)
- Revocation entries (key compromises, device blacklist)

Principles
--------
- Signature required: every manifest is signed with a private key.
- Verification: the server verifies the signature before storing.
- Anchoring: the daily Merkle root is published on-chain.
- Revocation: revocation list support.

Quick start
-------------
See oracle/registry/README.md
