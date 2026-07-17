# ADR-0007: Security & Key Management

Status: Draft (Approved as Draft by @AntonGrid)
Date: 2026-07-17
Authors: ENRG Protocol Team (draft by @AntonGrid / AI-architect)
Related: README.md, docs/README.md

## Контекст / Background

ENRG — протокол, связывающий физические устройства и блокчейн-слой (reference implementation — Solana). Репозиторий содержит компоненты firmware/, oracle/, programs/, registries/ и т.д. (см. README). Для безопасности всей системы критически важно определить единый, документированный и проверяемый подход к управлению ключами и подписью: какие ключи используются кем и где, как они генерируются, как хранится корень доверия, как делается аттестация устройств, как выполняется ротация/аннуляция ключей, как привязать подписи прошивки к on-chain-реестрам и governance.

Без формализованного ADR разные подсистемы (производство прошивки, oracle-операторы, контракты, регистрационные сервисы) будут иметь несовместимые или небезопасные процедуры.

## Решение (Decision)

1. Единственный корень доверия для каждых производственных/поставочных цепочек хранится и управляется через Governance-managed Root Key Registry (он- или off-chain registry с привязкой на on-chain anchoring).
2. Стандарт наборов ключей:
   - On-chain keys: ED25519 (совместим с Solana) — для транзакций, program upgrades (multisig), oracle node on-chain signatures.
   - Device signing keys: ED25519 — для подписи манифестов устройств и сообщений.
   - Device attestation keys: ED25519 — хранится в Secure Element (см. ниже) или TPM; формат аттестации — COSE/CBOR (primary). X.509-based attestation остаётся опциональной для с��вместимости.
   - Firmware signing keys: ED25519 (offline, cold key) — подпись образов прошивки.
   - Transport keys (TLS): ECDSA P-256 или x25519 for key agreement — для защищённого соединения (OTA, provisioning).
3. Root-of-trust model:
   - Для производственных ключей используется цепочка доверия: Root CA / Root Public Key (управляемый Governance) → Manufacturer CA (или signing authority) → Device attestation key.
   - Альтернативно (lightweight deployments): root public key directly signs device public keys; это допускается при документированном производственном процессе.
4. Key lifecycle:
   - Генерация: private keys MUST be generated in secure environment (HSM / Secure Element / TPM). Device keys MUST be generated in device secure element when possible; otherwise, generated in provisioning environment with a documented secure transfer to device.
   - Storage: private keys MUST be stored in secure hardware module on device (Secure Element / eFuse / TPM). Если устройство — ESP32, то за хранение ключей отвечает ATECC608A (secure element) — это официально рекомендуемая конфигурация для ENRG reference hardware.
   - Provisioning: devices enrolled with a signed Device Enrollment Certificate / Manifest that contains device_id, public keys, and provisioning metadata; this manifest is anchored in the Manifest Registry (see ADR for registries).
   - Rotation: keys MUST support rotation. Rotation process MUST produce new key material, submit new public key and attestation to registry, and optionally re-sign device manifests. Old keys MUST be revocable in registry.
   - Revocation: Registry supports revocation records and revocation reasons; chain-of-trust checks must validate revocation status.
5. Attestation:
   - Devices SHALL produce attestation statements binding device identity to measured firmware image and to device public key.
   - Attestation statement format: COSE/CBOR-based attestation (PRIMARY) or optional X.509-based attestation for interoperability. COSE/CBOR is preferred for compactness and ease of parsing on constrained devices.
   - Fields expected in attestation (COSE/CBOR):
     - device_id (UUID)
     - device_pubkey
     - firmware_manifest_hash
     - nonce
     - timestamp
     - attestation_signature (signed by device attestation key or via TPM/ATECC608A quote)
   - Verifiers (oracle nodes or on-chain verifiers) SHALL validate attestation using manifest registry root keys and firmware signature checks.
6. Firmware signing & OTA:
   - Firmware images MUST be signed by a Firmware Signing Key (cold/offline). Signature and firmware manifest (hash, version, allowed device models, minimum attestation policy) are stored in Manifest Registry and distributed to devices and oracles.
   - Devices MUST verify firmware signature before installing.
7. Anchoring and registries:
   - Public keys for root-of-trust and manufacturer authorities MUST be publishable in Manifest Registry and anchored on-chain via periodic Merkle root anchoring.
   - Anchoring policy: periodic anchoring once per 24 hours (daily Merkle root anchor) is REQUIRED. Emergency revocation anchors MUST be supported and performed as-needed to record urgent revocations or trust-root changes.
8. Governance:
   - Governance-managed Root Key rotations and trust root changes MUST be performed via the protocol governance process (see ADR on governance). Emergency rotation flow with multisig/time-lock is required.
9. Incident response:
   - Procedure for key compromise, emergency revocation, and forced blackout of compromised keys is formalized: immediate registry revocation, notify operators, optionally freeze critical on-chain operations for defined time-window.
10. Minimum cryptographic requirements:
    - ED25519 for signatures (key length and algorithms fixed).
    - SHA-256 or SHA-512 as hashing functions (explicitly use SHA-256 for anchoring and manifests).
    - TLS with modern ciphers for provisioning and OTA (TLS 1.3 recommended).

## Рationale

- Solana reference implementation uses ED25519; унификация на ED25519 упрощает подписание транзакций и верификацию.
- ED25519 имеет широкую поддержку, хорошую производительность и короткие ключи.
- Изоляция firmware signing into offline/cold key снижает риск компрометации образов.
- Registry anchoring on-chain делает изменение корня доверия публично наблюдаемым и усложняет подделку.
- Использование secure elements и HSM в производстве повышает уровень безопасности устройств.

## Последствия (Consequences)

- Необходима инфраструктура HSM/CA/Provisioning и процессы производства с audit trail.
- Devices без secure element имеют пониженный security posture; их использование ограничено и должно быть зафиксировано.
- Governance становится критически важной для управления root keys; задержки в принятии решения могут привести к долгой блокировке.

## Детали реализации

### Key types and usage (summary)
- Root Key (Governance-managed): ED25519 — signs manufacturer CA keys or registry root entries.
- Manufacturer Signing Key: ED25519 — signs device enrollment manifests and firmware manifests.
- Device Attestation Key: ED25519 — stored in device SE / TPM; used to sign attestation statements and optional device-signed logs. For ESP32 reference hardware, the Secure Element used is Microchip ATECC608A.
- Device Operational Key: ED25519 — used by device to sign telemetry / events submitted to oracle.
- Firmware Signing Key: ED25519 (cold) — signs firmware images and firmware manifests.
- Oracle Node Signing Key: ED25519 — used to sign assertions submitted on-chain.

### Formats
- Device Enrollment Manifest (JSON/CBOR):
  - device_id (UUID)
  - device_pubkey (base64 or hex)
  - model
  - manufacturer
  - firmware_version
  - firmware_manifest_hash (sha256 hex)
  - provisioning_timestamp
  - provisioning_signature (manufacturer signing key)
- Firmware Manifest:
  - firmware_version
  - image_hash (sha256)
  - image_size
  - compatible_models
  - min_attestation_policy
  - firmware_signature (firmware signing key)
- Attestation Statement (COSE/CBOR preferred):
  - device_id
  - device_pubkey
  - firmware_manifest_hash
  - nonce
  - timestamp
  - attestation_signature

(Примеры схем ниже)

### Provisioning / Enrollment
- Strongly prefer in-factory provisioning using hardware root-of-trust:
  - Generate device keypair in Secure Element on device (ATECC608A for ESP32 reference hardware).
  - Export device public key and hardware identifier to provisioning system.
  - Manufacturer signs Device Enrollment Manifest and writes it to Manifest Registry.
  - Device stores manifest and uses it for future attestations.
- For devices without SE, provisioning MUST use secure channel and minimize key exposure. Document risk.

### Rotation & Revocation
- Rotation flow:
  1. Create new keypair (in HSM/SE).
  2. Create rotation manifest signed by old key (if still valid) and new credential attestation signed by governance or manufacturer.
  3. Publish new public key to Manifest Registry with effective_from timestamp.
  4. Update dependent artifacts (firmware manifests, allowed key lists).
- Revocation:
  - Publish revocation entry in Registry that includes revocation reason and effective timestamp (and optionally a replacement key).
  - All verifiers MUST check revocation list before accepting signatures.

### Attestation verification
- Verifier checks:
  1. Attestation signature validity against device attestation public key.
  2. Device public key existence and provisioning status in Manifest Registry.
  3. Firmware manifest hash matches a signed firmware manifest in Manifest Registry and firmware signature valid.
  4. Revocation status of device key and manufacturer key.
  5. Timestamp freshness / nonce replay protection.

### On-chain anchoring
- Registry root hash (Merkle root or signed snapshot) SHOULD be periodically anchored to chain via a small tx, storing immutably the registry state reference.
- Anchoring policy: periodic anchoring once per 24 hours (daily Merkle root anchor) is REQUIRED. Emergency revocation anchors MUST be performed when urgent revocations or trust-root changes occur.

## Security considerations

- Private keys for firmware signing and root-of-trust MUST be stored offline in HSMs with access controls and audit logs.
- Developer/lab keys MUST NOT be used in production deployment.
- Protect against replay attacks by using nonces and timestamp windows.
- Regular audits of provisioning process required.
- For devices lacking hardware security, raise their risk level and restrict their capabilities (e.g., limit them to read-only telemetry or lower-trust roles).

## Migration plan

- For already-deployed devices without formal manifests:
  - Create retroactive Enrollment Manifests containing device_pubkey and provenance information; flag as "provisioned_out_of_band".
  - Invalidate any non-provisioned devices unless validated through a manual attestation flow.
- For existing firmware images not signed with the new firmware signing key:
  - Re-sign images where possible and publish signed firmware manifest.
  - For devices that refuse unsigned updates, provide a transitional signed image.

## Acceptance criteria (MUST)
1. ADR-0007 added to docs/architecture and approved as Draft by governance (@AntonGrid has approved the Draft).
2. Manifest Registry schema implemented (docs/registry/) and a reference implementation that can store device enrollment and firmware manifests.
3. Devices can produce attestation statements and oracles/verifiers can validate them end-to-end:
   - Example E2E test: device → attestation → oracle → on-chain anchor (green).
4. Firmware images signed by firmware signing key; devices reject unsigned images.
5. Root key change workflow documented and exercised in testnet (including emergency revocation and emergency anchors).
6. Security review plan for HSM / provisioning processes exists.

## Open questions
- Standards for device IDs: UUID chosen as canonical device_id format for ENRG (agreed).
- Level of on-chain anchoring frequency and anchoring scheme (Merkle root vs signed snapshot). Recommendation: periodic snapshots daily + emergency anchors for revocations.

## Implementation artifacts & next steps
- Add Manifest Registry spec in docs/registry/ (schema + API).
- Implement reference manifest registry service (oracle/registry/ or registry/).
- Add firmware signing tool & developer scripts in tools/ (firmware/sign).
- Update firmware repo to verify signatures before install.
- Integrate attestation verification in oracle/ (oracle/verifier).
- Draft Governance flow for root key rotation (link to ADR on governance).

---

Appendix: Example Device Enrollment Manifest (JSON)

```json
{
  "device_id": "550e8400-e29b-41d4-a716-446655440000",
  "device_pubkey": "BASE64_ED25519_PUBLIC_KEY",
  "model": "ENRG-ESP32-v1",
  "manufacturer": "ACME Energy",
  "firmware_version": "2026.07.15",
  "firmware_manifest_hash": "sha256:3a7bd3...f4e2",
  "provisioning_timestamp": "2026-07-15T12:34:56Z",
  "provisioning_signature": "BASE64_SIGNATURE_BY_MANUFACTURER"
}
```

Appendix: Example Firmware Manifest (JSON)

```json
{
  "firmware_version": "2026.07.15",
  "image_hash": "sha256:3a7bd3...f4e2",
  "image_size": 123456,
  "compatible_models": ["ENRG-ESP32-v1", "ENRG-ESP32-v1.1"],
  "min_attestation_policy": "policy-v1",
  "firmware_signature": "BASE64_SIGNATURE_BY_FIRMWARE_SIGNING_KEY"
}
```
