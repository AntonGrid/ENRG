ENRG On-chain Attestation Bridge
1. Формат off-chain Attestation (JSON)
Пример (attestation-example.json):

{
  "attestation_id": "att_1a2b3c4d5e6f7890",
  "device_id": "dev_9e9c644e1580a83b",
  "proof": {
    "device_id": "dev_9e9c644e1580a83b",
    "nonce": "abc12345xyz",
    "timestamp": "2026-07-25T19:00:00Z",
    "algo": "mock",
    "payload": { "max_power_kw": 2.5 },
    "signature": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  },
  "decision": {
    "allowed": true,
    "reason": "mock-allowed",
    "max_power_kw": 2.5
  },
  "oracle_id": "oracle_main_1",
  "issued_at": "2026-07-25T19:05:00Z",
  "oracle_signature": "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe"
}
2. On-chain структура (контракт EnrgOracleAttestation)
struct AttestationCore {
    bytes32 attestationId;
    bytes32 deviceId;
    bool allowed;
    uint64 maxPowerW;
    address oracle;
    uint64 issuedAt; // unix timestamp
}

function submitAttestation(
    bytes32 attestationId,
    bytes32 deviceId,
    bool allowed,
    uint64 maxPowerW,
    uint64 issuedAt
) external;
msg.sender — доверенный Oracle (проверяется через trustedOracles[msg.sender]).
Аттестация сохраняется в mapping(bytes32 => AttestationCore) public attestations.
3. Маппинг off-chain → on-chain
Путь: JSON → app.onchain_bridge.build_attestation_params(...) → параметры для submitAttestation.

Маппинг:

attestation_id (string) → attestationId (bytes32):

attestationId = keccak(text=attestation["attestation_id"])
device_id (string) → deviceId (bytes32):

deviceId = keccak(text=attestation["device_id"])
decision.allowed (bool) → allowed (bool).

decision.max_power_kw (float, kW) → maxPowerW (uint64, W):

maxPowerW = int(decision["max_power_kw"] * 1000)
issued_at (ISO 8601, с "Z") → issuedAt (uint64, unix timestamp):

# пример: "2026-07-25T19:05:00Z"
ts = issued_at.replace("Z", "+00:00")
issuedAt = int(datetime.fromisoformat(ts).timestamp())
4. Пример реальных параметров (из demo_onchain_bridge.py)
Команда:

python scripts/demo_onchain_bridge.py
Пример вывода:

=== On-chain parameters for submitAttestation ===
attestationId (bytes32): 0x16c9c0ac191d642d6effa42f8d2a44612c003d2848ba10cf7b9df23206b236ea
deviceId      (bytes32): 0x54562bb25b54e0e36d75c1f38fef431a05f3de67bc51103fc1266257da876e63
allowed       (bool)   : True
maxPowerW     (uint64) : 2500
issuedAt      (uint64) : 1785006300
Эти значения напрямую соответствуют вызову смарт-контракта:

enrgOracleAttestation.submitAttestation(
    0x16c9c0ac191d642d6effa42f8d2a44612c003d2848ba10cf7b9df23206b236ea,
    0x54562bb25b54e0e36d75c1f38fef431a05f3de67bc51103fc1266257da876e63,
    true,
    2500,
    1785006300
);
Где msg.sender должен быть доверенным Oracle, добавленным через:

setTrustedOracle(address oracle, bool trusted);
