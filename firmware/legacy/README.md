# ENRG — legacy firmware archive (v1 / v2)

> **Nothing in this directory is part of the ENRG delivery.** It is kept locally
> and in git history so the security audits stay reproducible.

## Why it is archived (audit F-3 / D-1 and H-4; ADR-0001 / ADR-0007)

- **v1** — a hard-coded private key (redacted here) uploaded over plaintext HTTP.
- **v2** — string signatures, plaintext HTTP, no manifest and no OTA, and it
  depended on the `identity.*` helper archived here.
- **`identity.h` / `identity.cpp`** — the pre-SE050 key handling: the Ed25519
  private key is created at first boot and written to NVS (flash) **in
  plaintext**, then loaded into RAM for signing. That is the pattern
  `docs/SECURITY_AUDIT_2026-08-16.md` flags as H-4, and the reason the current
  firmware signs *inside* an NXP **SE050** secure element, where the key is
  non-extractable (`firmware/esp32_proof_sender/SE050-HARDWARE-SIGNING.md`).

## Rules

- The firmware sources here are **not tracked** by git (root `.gitignore` →
  `firmware/legacy/`); only this README is.
- **Do not** return them to the repository — the v1 key must be treated as
  compromised forever.
- **Do not** flash them. The current firmware is
  `firmware/esp32_proof_sender/src/esp32_proof_sender_v3/esp32_proof_sender_v3.ino`.

## Contents

| File | Version | Why it is archived |
|---|---|---|
| `esp32_proof_sender_v1.ino` | v1 (demo) | Hard-coded private key (redacted), upload over HTTP |
| `esp32_proof_sender_v2.ino` | v2 (superseded) | String signatures, HTTP, no manifest/OTA |
| `identity.h`, `identity.cpp` | pre-SE050 | Private key in NVS in plaintext, signing in software |

## Restoring the originals (for audits)

Originals stay in git history:

```bash
git log --oneline -- esp32_proof_sender.ino
git show <commit>:esp32_proof_sender_v2.ino
git show <commit>:identity.cpp
```

> Restore them into a directory **outside** the repository: keys must never
> reach git again.

*The earlier Russian version of this note is kept locally as `README.ru.md`.*

**Причина архивации** (аудит F-3 / D-1, ADR-0001 / ADR-0007): legacy-прошивки
содержат небезопасные практики — захардкоженный приватный ключ (v1) и отправку
по plaintext HTTP. Приватный ключ **не должен храниться в git-репозитории**.

## Правила

- Файлы в этой папке **не отслеживаются git** (см. корневой `.gitignore`,
  секция `firmware/legacy/`).
- **Не возвращайте** эти файлы в репозиторий (`git add` отклоняется
  gitignore; принудительный `git add -f` запрещён).
- **Не используйте** их на реальных устройствах. Актуальная прошивка:
  `firmware/esp32_proof_sender/src/esp32_proof_sender_v3.ino`.
- Приватный ключ v1 скомпрометирован фактом публикации в истории git —
  считать его недействительным. В этой архивной копии ключ **заредэктирован**.

## Состав

| Файл | Версия | Причина архивации |
|---|---|---|
| `esp32_proof_sender_v1.ino` | v1 (демо) | Захардкоженный приватный ключ (заредэктирован), отправка по HTTP. |
| `esp32_proof_sender_v2.ino` | v2 (устаревшая) | Строковая подпись, HTTP, нет манифеста/OTA, зависимость от `identity.h` вне репозитория. |

## Как восстановить оригиналы (для аудита)

Оригинальные версии доступны в истории git:

```bash
git log --oneline -- firmware/esp32_proof_sender/esp32_proof_sender.ino
git show <commit>:firmware/esp32_proof_sender/esp32_proof_sender.ino
git show <commit>:esp32_proof_sender_v2.ino
```

> Восстанавливайте только в изолированную директорию вне репозитория —
> ключи не должны попасть обратно в git.
