# legacy/ — kept for history, not part of the live system

Nothing in this directory is imported, built, tested or deployed by the running
protocol. It is here because it documents an earlier design of the project (the
"Part II" API-first shape) and because `local-validator/` is the most direct way
to reproduce a chain from scratch on your own machine.

The honest summary of this repository is: the live path is small and specific,
and this directory exists so that the rest of it is visibly labelled instead of
looking like code that runs.

| what you are looking for | where it actually lives |
|---|---|
| the oracle API | `server.js` (Express, devnet) — its routes are the ones the dashboard and the firmware call |
| the on-chain programs | `programs/enrg-mvp` (58 instructions) and `programs/enrg-profile` |
| end-to-end proofs | `scripts/devnet_e2e_lifecycle.ts`, `scripts/submit-proof-to-oracle.js` |
| device firmware | `firmware/esp32_proof_sender` |
| the tests that gate CI | `tests/*.test.js` (Node), `programs/**/tests` (Rust), `tests/test_*.py` (Python), `onchain/test` (Foundry) |

## What is in here

| item | what it is | why it is not live |
|---|---|---|
| `app/` | FastAPI mock (`/health`, `/oracle/attest`) | imports `axis_core.*`, which is neither in `requirements.txt` nor vendored here — it cannot start inside this repository (audit 2026-09-21) |
| `openapi.yaml`, `openapi/` | one bundle plus seven separate specs, all describing that mock (`ENRG Part II Mock API` v0.1.0, `servers: localhost:8000`, `registry.example.com`) | they describe the mock above, not the real routes of `server.js`; the live OpenAPI is generated from `server.js` (P1) |
| `examples/` | `curl-post-*.sh` against `registry.enrg.local` plus the early `device-proof-*.json` / `device-*-example.json` payloads | the maintained payloads live in `examples/` and the live API is `server.js` |
| `history/` | the first public artefacts (pitch deck, whitepaper v2, technical documentation, technical spec v7.0) from the Part II era | superseded by `README.md`, `docs/`, and the film — kept only so the public history stays readable |
| `ADR-00X-enrg-core-vs-energy-profile.md` | a real design proposal that was never accepted | it stayed "Proposed" since 2026-07-16; the accepted ADRs are in `docs/adr/` and `docs/architecture/adr/` |
| `api.md` | the human-readable version of the same mock API | same reason |
| `tools/client.py` | Python client for that mock schema | it targets port 8000 and the mock payloads |
| `index.ts` | the Anchor skeleton generated at project start | superseded by `scripts/*.ts`, which run real lifecycles |
| `test_proof.js`, `test_proof_full.js` | scratch scripts from the first week | referenced by neither `package.json` nor CI |
| `local-validator/bootstrap_protocol.py` | seeds every PDA (`vault`, `src-mint`, `oracle-registry`, …) on a local validator | deliberately not a pytest module; manual, validator-only |
| `local-validator/integration_mint_energy.py` | manual end-to-end `mint_energy` check against a local validator | same |

If any of this is still worth keeping as a first-class tool, open an issue and it
moves back into the active tree — otherwise it stays here, labelled as history.
