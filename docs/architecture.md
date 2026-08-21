# ENRG Architecture Overview

## Main components

1. **Backend API (FastAPI)**
   - Folder: `app/`
   - Entry point: `app/main.py`
   - Main routes:
     - `/provisioning/...` — initial device attestation (DeviceProof).
     - `/registry/...` — the device registry and related entities.
     - `/oracle/...` — oracle attestations.

2. **Oracle attestation**
   - Module: `app/api/oracle.py`
   - Endpoint: `POST /oracle/attest`
   - Works in two modes:
     1. **Legacy attestation**: accepts a full attestation, validates it against `schemas/attestation.schema.json`, stores it in memory and returns:
        ```json
        {
          "status": "received",
          "attestation_id": "...",
          "device_id": "...",
          "oracle_id": "..."
        }
        ```
     2. **New oracle_attest_request**: accepts a request with fields
        `device_id`, `nonce`, `timestamp`, `algo`, `payload.max_power_kw`, `signature`,
        validates it against `schemas/oracle_attest_request.schema.json` and returns:
        ```json
        {
          "device_id": "...",
          "attestation_id": "... (uuid4)",
          "decision": {
            "allowed": true,
            "max_power_kw": <number>
          }
        }
        ```
   - In-memory storage: the `_ATTESTATIONS` dict inside `app/api/oracle.py`.

3. **JSON schemas and validation**
   - Folder: `schemas/`
     - `attestation.schema.json`
     - `device_manifest.schema.json`
     - `device_proof.schema.json`
     - `device_record.schema.json`
     - `oracle_attest_request.schema.json`
   - Utilities:
     - `app/schema_utils.py` — loading and caching validators.
     - `app/schemas_loader.py` — helper functions for working with schemas.

4. **On-chain bridge (Python → Solidity)**
   - Module: `app/onchain_bridge.py`
   - Main: `build_attestation_params(attestation: dict) -> OnchainAttestationParams`
   - The `OnchainAttestationParams` structure:
     ```python
     @dataclass
     class OnchainAttestationParams:
         attestation_id: bytes   # keccak256(attestation_id), bytes32
         device_id: bytes        # keccak256(device_id), bytes32
         allowed: bool
         max_power_w: int        # max_power_kw * 1000
         issued_at: int          # unix timestamp
     ```
   - Helper functions:
     - `_to_bytes32_hash(value: str) -> bytes` — `keccak(text=value)`.
     - `_parse_issued_at(issued_at: str) -> int` — ISO8601 (`...Z`) → unix timestamp.

   - `build_attestation_params` logic:
     - Takes fields from the Oracle JSON attestation:
       - `attestation["attestation_id"]`
       - `attestation["device_id"]`
       - `attestation["decision"]["allowed"]`
       - `attestation["decision"]["max_power_kw"]`
       - `attestation["issued_at"]`
     - Raises `KeyError` if required fields are missing.
     - Returns `OnchainAttestationParams` compatible with the contract function signature `submitAttestation(...)`.

5. **Solidity contracts and Foundry**
   - Folder: `onchain/`
   - Contracts (roughly): `ENRGOracle.sol` and/or similar.
   - Foundry tests: run from the root via `./run-tests.sh`, which invokes `forge test` in `onchain/`.

6. **Python tests**
   - Folder: `tests/`
   - Key:
     - `test_api.py` — basic API endpoints (incl. the legacy `/oracle/attest`).
     - `test_oracle_attest.py` — the new `/oracle/attest` request format.
     - `test_onchain_bridge.py` — verifies:
       - correct `OnchainAttestationParams` building;
       - keccak hash correctness;
       - the kW → W and issued_at → timestamp conversions.
     - `test_oracle_storage.py` — InMemoryOracleStorage.
   - All tests run from the root:
     ```bash
     ./run-tests.sh
     ```

7. **Tools and demos**
   - `tools/client.py`
     - A minimal `httpx` client for the API.
     - Supports:
       - `health()` — GET `/health`.
       - `oracle_attest_request(...)` — the new request format for `/oracle/attest`.
       - `build_simple_attestation(...)` + `oracle_attest_legacy(...)` — building and sending a legacy attestation.
   - `scripts/demo_onchain_bridge.py`
     - Reads `attestation-example.json`.
     - Runs it through `build_attestation_params`.
     - Prints on-chain parameters ready for the Solidity `submitAttestation(...)` call.

## Data flow (end-to-end)

1. **The device / client** sends a request to the oracle:
   - New format:
     - `POST /oracle/attest` with `device_id`, `nonce`, `timestamp`, `algo`, `payload.max_power_kw`, `signature`.
   - Server:
     - Validates against `oracle_attest_request.schema.json`.
     - Checks `timestamp` (ISO8601 with `Z`).
     - Generates an `attestation_id` (UUID).
     - Builds the `decision` and stores the record in `_ATTESTATIONS`.
     - Returns `{"device_id", "attestation_id", "decision"}`.

2. **The oracle attestation is stored** (in-memory),
   and can also be serialized to JSON (e.g. `attestation-example.json`).

3. **The on-chain bridge** takes the Oracle JSON attestation and builds contract parameters from it:
   - `build_attestation_params(attestation)` → `OnchainAttestationParams`.

4. **The on-chain contract** (Solidity) accepts these parameters via `submitAttestation(...)` and updates the on-chain state (e.g. the registry of allowed devices and their power limits).

