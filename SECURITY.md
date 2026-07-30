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
