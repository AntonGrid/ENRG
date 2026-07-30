# Manifest Registry — ENRG

Назначение
---------
Manifest Registry — canonical service для публикации и распространения:
- Device Enrollment Manifests (device identity + pubkey + provenance)
- Firmware Manifests (firmware metadata + hashes + signatures)
- Revocation entries (key compromises, device blacklist)

Принципы
--------
- Подпись обязательна: каждый манифест подписывается приватным ключом.
- Верификация: сервер проверяет подпись перед сохранением.
- Якорение: ежедневный Merkle root публикуется в блокчейн.
- Отзыв: поддержка revocation списков.

Быстрый старт
-------------
См. oracle/registry/README.md
