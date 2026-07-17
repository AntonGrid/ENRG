# ADR-0008: OTA & Secure Firmware Updates

Status: Draft
Date: 2026-07-17
Authors: ENRG Protocol Team (draft by @AntonGrid / AI-architect)
Related: ADR-0007-Security-Key-Management, docs/registry, firmware/

## Контекст / Background

ENRG reference hardware (ESP32 + ATECC608A) требует безопасного механизма доставки и установки прошивок: целостность и подлинность образа, защита приватных ключей, минимизация риска «забивания» устройства (brick), откат при неудачных обновлениях, способ уведомления и согласования обновлений с реестрами и on‑chain анкерингом.

Без строгой модели OTA возможны: подмена образа, установка неподписанных образов, невозможность отката, рассинхронизация между on‑chain реестром и устройствами.

## Решение (Decision)

Краткий свод:
- Файлы прошивки подписываются Firmware Signing Key (ED25519, offline/cold). Подпись и метаданные (Firmware Manifest) публикуются в Manifest Registry (ADR-0007).
- Транспорт: TLS 1.3 (HTTPS, CoAP+DTLS/TLS, MQTTs) — защищённый канал для загрузки образа и уведомлений.
- Устройство проверяет manifest → image hash → image signature → compatibility и только затем устанавливает.
- Атомарность установки: dual‑bank (A/B) или verified‑boot + pending‑flag + fallback (если поддерживается), с smoke‑tests и автоматическим rollback при ошибке в probation window.
- Anti‑rollback: monotonic counter или secure version stored/protected in ATECC608A (preferred). Если SE отсутствует — fallback protection с повышенным уровнем риска и ограниченными возможностями.
- Нотификации: push (Notification Service signed by Oracle/Registry) или pull (poll Manifest Registry with ETag/If‑Modified‑Since).
- Emergency update flow: emergency flag в manifest + immediate on‑chain emergency anchor (Merkle root) + ускоренная delivery.

### Формат Firmware Manifest (обязательные поля)

- firmware_version: semver-like string
- image_hash: sha256:<hex>
- image_size: integer
- compatible_models: [string]
- min_attestation_policy: string (ссылка на политику smoke-tests/verification)
- firmware_signature: BASE64_ED25519_SIGNATURE (signature over canonical manifest or image)
- issued_by: signing_entity_id
- issued_at: ISO8601 timestamp
- emergency: boolean (default false)
- optional: rollout_policy { percentage, regions, schedule }

Manifest публикуется в Manifest Registry и его можно проверить через Merkle anchoring (ADR-0007).

### Последовательность получения и проверки обновления

1. Источник manifest:
   - Push: Notification Service (signed notification) отправляет manifest URI/ID.
   - Pull: device poll → GET /manifests?model=ENRG-ESP32-v1
2. Device verifies manifest signature against Firmware Signing Key published in Manifest Registry / Root Key Registry.
3. Check compatible_models and min_attestation_policy.
4. Download image via HTTPS (TLS 1.3).
5. Compute SHA‑256(image) and compare to image_hash.
6. Verify image signature if the signature covers image; otherwise verify canonical manifest signature that binds image_hash.
7. Store image in staging/inactive bank.
8. Atomically switch to new bank or mark new image as pending.
9. Perform smoke-tests per min_attestation_policy:
   - hardware checks, peripheral sanity, attestation generation, connectivity.
10. If smoke-tests succeed within probation window, mark image active and report success (attestation + update report).
11. If failure occurs, rollback to previous image; publish failure report (attestation signed by device key).

### Подписание прошивок

- Firmware images MUST be signed offline by Firmware Signing Key (ED25519).
- Manifest MUST include image_hash (sha256), firmware_version, compatible_models, min_attestation_policy, signature.
- Firmware Signing Key public key MUST be published in Manifest Registry / Root Key Registry (ADR-0007); verifiers use it to validate manifests and images.
- CI pipeline MUST produce signed manifest and (optionally) signed image artifact; manifest must be published to registry as atomic step.

### Анти-rollback и откат

- Anti‑rollback mechanisms (в порядке предпочтения):
  1. Secure Element monotonic counter / secure version (ATECC608A supports secure counters/monotonic seals).
  2. eFuse / hardware one‑time programmable flags (если доступны).
  3. Software monotonic counters with tamper detection + attestation (less secure).
- Rollback strategy:
  - If smoke tests fail within verification window (e.g., first 5 minutes post-update), device automatically reverts to previous image using fallback partition.
  - Устройство отправляет failure report в registry/oracle с attestation statement.
- Safe-update window & probation:
  - New firmware considered "provisionally active" until device reports attestation after smoke tests. Only after successful series (configurable, e.g., N=3 boots or T=10 minutes) firmware marked as fully active on device and in registry.

### Нотификации о новых версиях

- Canonical source: Manifest Registry (docs/registry). Registry хранит firmware manifests и поддерживает query by model/version.
- Push notifications (optional): Oracle/Notification service can sign and push manifest URI to device via MQTT/WebSocket/CoAP over TLS. Push messages MUST be authenticated and include manifest_signature.
- Pull model: devices poll registry endpoint with ETag/If-Modified-Since and apply exponential backoff.
- Policy: не чаще чем политика обновлений (configurable); для emergency manifests — push и immediate pull recommended.

### Emergency updates

- Emergency manifest field: emergency=true + description + expiring window.
- Emergency manifests get expedited anchoring: immediate Merkle-root anchor and on-chain anchor tx noting emergency update hash.
- Devices SHOULD prefer emergency manifests over regular scheduled updates even if within backoff window.
- Emergency updates still MUST be signed by Firmware Signing Key and validated normally.

### Audit и отчетность

- Все manifest публикации и anchors логируются и доступны для аудита.
- Devices publish update reports (attestation + result) to oracle endpoints that store data and optionally anchor aggregated reports on-chain daily.

## Rationale

- Подписание manifest отдельно от образа уменьшает размер подписываемого документа и ускоряет проверку на устройствах.
- Dual‑bank/verified‑boot + smoke tests минимизируют риск brick.
- ATECC608A обеспечивает аппаратную защиту ключей и поддерживает monotonic counters.
- Daily anchoring и emergency anchors обеспечивают публичный, неизменяемый след о выпуске и отзывах.

## Последствия

- Потребуется инфраструктура для хранения образов, сервиса Manifest Registry и Notification service.
- Для устройств без ATECC608A риск rollback/compromise выше; такие устройства должны быть помечены/ограничены.
- Emergency anchors приводят к стоимости транзакций в сети; использовать экономно.

## Acceptance criteria (MUST)

1. ADR‑0008 добавлен в docs/architecture и утверждён как Draft.
2. Firmware signing tool & CI step: при сборке образ подписывается Firmware Signing Key и manifest публикуется в Manifest Registry.
3. Reference firmware (firmware/) реализует:
   - download & verify manifest,
   - verify signature,
   - atomic install (A/B or pending),
   - smoke tests,
   - rollback,
   - update reporting.
4. E2E тест: эмулятор/реальное устройство проходит update cycle (manifest → download → validate → activate → attest → registry report).
5. Emergency update exercise: publish emergency manifest, perform on-chain emergency anchor, devices accept emergency update and report.

## Open questions

- Push transport choice (MQTT vs CoAP vs WebSocket) — выбрать исходя из сетевых ограничений.
- Default probation policy (e.g., first 3 boots or 10 minutes) — предложить значения и дать возможность per‑model override.

## Implementation tasks

- tools/firmware/sign — signing tool & CI integration.
- firmware/ota client — implement A/B or pending boot strategy + ATECC608A integration.
- manifest registry endpoints for firmware manifests and notification hooks.
- E2E test harness (emulator + CI job).

---

Appendix: Minimal Firmware Manifest (example)

```json
{
  "firmware_version": "2026.07.20",
  "image_hash": "sha256:abcd...",
  "image_size": 234567,
  "compatible_models": ["ENRG-ESP32-v1"],
  "min_attestation_policy": "policy-v1",
  "firmware_signature": "BASE64_ED25519_SIG",
  "emergency": false
}
```
