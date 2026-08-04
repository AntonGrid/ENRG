> NOTE: This document describes the architecture of a specific product implementation (**ENRG**),
> not the abstract Axis Protocol. It is considered **implementation-specific** and may be moved
> to the dedicated ENRG repository in the future.

# ENRG Architecture Overview

## Main Components

1. **Backend API (FastAPI)**  
   - Folder: `app/`  
   - Entry point: `app/main.py`  
   - Main routes:
     - `/provisioning/...` — initial device attestation (`DeviceProof`).
     - `/registry/...` — device registry and related entities.
     - `/oracle/...` — oracle attestation workflows.

2. **Oracle Attestation**
   - Module: `app/api/oracle.py`
   - Endpoint: `POST /oracle/attest`
   - Works in two modes:

     1. **Legacy attestation**  
        Accepts a full attestation, validates it against `schemas/attestation.schema.json`,
        stores it in memory, and returns:
        ```json
        {
          "status": "received",
          "attestation_id": "...",
          "device_id": "...",
          "oracle_id": "..."
        }
        ```

     2. **New `oracle_attest_request`**  
        Accepts a request with fields:
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

   - In-memory storage: dictionary `_ATTESTATIONS` inside `app/api/oracle.py`.

3. **JSON Schemas and Validation**
   - Folder: `schemas/`
     - `attestation.schema.json`
     - `device_manifest.schema.json`
     - `device_proof.schema.json`
     - `device_record.schema.json`
     - `oracle_attest_request.schema.json`
   - Utilities:
     - `app/schema_utils.py` — loading and caching validators.
     - `app/schemas_loader.py` — helper functions for working with schemas.

4. **On-chain Bridge (Python → Solidity)**
   - Module: `app/onchain_bridge.py`
   - Core function: `build_attestation_params(attestation: dict) -> OnchainAttestationParams`
   - Structure `OnchainAttestationParams`:
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
     - `_parse_issued_at(issued_at: str) -> int` — ISO8601 (`...Z`) → Unix timestamp.

   - `build_attestation_params` logic:
     - Reads fields from the Oracle JSON attestation:
       - `attestation["attestation_id"]`
       - `attestation["device_id"]`
       - `attestation["decision"]["allowed"]`
       - `attestation["decision"]["max_power_kw"]`
       - `attestation["issued_at"]`
     - Raises `KeyError` if any required field is missing.
     - Returns `OnchainAttestationParams`, compatible with the Solidity contract function
       signature `submitAttestation(...)`.

5. **Solidity Contracts and Foundry**
   - Folder: `onchain/`
   - Contracts (for example): `ENRGOracle.sol` and related contracts.
   - Foundry tests: run from the repo root via `./run-tests.sh`, which internally calls
     `forge test` in `onchain/`.

6. **Python Tests**
   - Folder: `tests/`
   - Key tests:
     - `test_api.py` — basic API endpoints (including legacy `/oracle/attest`).
     - `test_oracle_attest.py` — new `/oracle/attest` request format.
     - `test_onchain_bridge.py` — verifies:
       - correct construction of `OnchainAttestationParams`;
       - correctness of keccak hashes;
       - conversion from kW → W and `issued_at` → Unix timestamp.
     - `test_oracle_storage.py` — `InMemoryOracleStorage`.

   - All tests are executed from the repo root:
     ```bash
     ./run-tests.sh
     ```

7. **Tools and Demos**
   - `tools/client.py`
     - Small client based on `httpx` for calling the API.
     - Supports:
       - `health()` — `GET /health`.
       - `oracle_attest_request(...)` — new request format for `/oracle/attest`.
       - `build_simple_attestation(...)` + `oracle_attest_legacy(...)` — generation and
         sending of a legacy attestation.
   - `scripts/demo_onchain_bridge.py`
     - Reads `attestation-example.json`.
     - Runs it through `build_attestation_params`.
     - Prints on-chain parameters ready to be passed into the Solidity function
       `submitAttestation(...)`.

## End-to-End Data Flow

1. **Device / client** sends a request to the oracle:
   - New format:
     - `POST /oracle/attest` with fields
       `device_id`, `nonce`, `timestamp`, `algo`, `payload.max_power_kw`, `signature`.
   - Server:
     - Validates against `oracle_attest_request.schema.json`.
     - Checks `timestamp` correctness (ISO8601 with `Z`).
     - Generates `attestation_id` (UUID).
     - Builds a `decision` object and stores the record in `_ATTESTATIONS`.
     - Returns `{"device_id", "attestation_id", "decision"}`.

2. **Oracle attestation is stored** in in-memory storage
   and can also be serialized into JSON (example: `attestation-example.json`).

3. **On-chain bridge** takes the Oracle JSON attestation and builds from it the parameters
   for the smart contract:
   - `build_attestation_params(attestation)` → `OnchainAttestationParams`.

4. **On-chain contract** (Solidity) accepts these parameters via `submitAttestation(...)`
   and updates on-chain state (for example, a registry of allowed devices and their
   power limits).
