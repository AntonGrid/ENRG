# Security Policy

## Reporting Security Issues

Security is a top priority for ENRG.

If you discover a vulnerability, please do not publish it immediately.

Instead, report it privately so it can be investigated and fixed.

---

## Scope

This includes:

- Smart Contracts
- Oracle
- Firmware
- Cryptography
- API
- Device Authentication
- Documentation

---

## Out of Scope

- General support questions.
- Feature requests.
- Configuration problems.

---

## Responsible Disclosure

Please include:

- Description
- Steps to reproduce
- Impact
- Suggested mitigation (optional)

---

## Known Key Incident (P0-1, 2026-08-30)

The founder wallet private key (`ENRG/founder-wallet.json`) was accidentally
committed to git at `d3664c1` ("Add founder-wallet.json for Render deployment").

- **Status:** file removed from the index (`git rm --cached`), added to
  `.gitignore`, secret scanning added to CI (`.github/workflows/secrets.yml`).
- **Impact:** the key is present in repository history and MUST be considered
  **compromised**. Anyone with repo access can sign as `FOUNDER_WALLET` /
  `EXPECTED_DEPLOYER`.
- **ROTATION COMPLETED (P0-1a, 2026-08-30):** all protocol keys were freshly
  generated (`~/keys/enrg-mainnet`, 0600, outside the repo). The program
  constants (`FOUNDER_WALLET`, `EXPECTED_DEPLOYER` in
  `programs/enrg-mvp/src/constants.rs`), the oracle (`FOUNDER_WALLET` in
  `server.js`), the firmware (`ENRG_FOUNDER_PUBKEY_HEX` /
  `ENRG_FIRMWARE_PUBKEY_HEX`) and the local key files were updated to the new
  keys. **The old key (6gM2…) must never be used on mainnet.**
- **Prevention:** `.gitignore` now blocks `founder-wallet*.json` and
  `*-keypair.json`; gitleaks runs on every push/PR.

## Key Hygiene Rules (all repos)

- Private keys never enter git, env-var dumps, logs, or CI artifacts.
- Secrets are passed to the oracle via `*_KEY_PATH` (0600 file), never inline.
- Any key that appears in git history is compromised and MUST be rotated.

---

## Security Principles

ENRG follows these architectural principles (inherited from [Axis Protocol](https://github.com/AntonGrid/Axis-protocol)):

- Private keys never leave devices.
- Every Proof must be cryptographically verifiable.
- Trust is minimized.
- Every component has a single responsibility.
- Security is preferred over convenience.

---

## Cryptography

Current implementation:

- Ed25519 signatures
- Nonce replay protection
- Timestamp validation
- Device identity verification

---

## Future

Planned improvements:

- Secure Element support
- Multi-Oracle validation
- Remote attestation
- Hardware-backed identity
- Independent security audits

---

## Related Repositories

- [Axis Protocol](https://github.com/AntonGrid/Axis-protocol) — normative specification of the trust standard.
- [Axis Core](https://github.com/AntonGrid/Axis-core) — universal reference implementation.
- **ENRG** (this repository) — first application on Axis, focused on energy tokenization.

---

Thank you for helping keep ENRG secure.
