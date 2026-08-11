//! Канонические сообщения, подписываемые УСТРОЙСТВОМ в lifecycle-флоу.
//!
//! Формат зафиксирован на уровне протокола (ADR-0001 / ADR-0002 / ADR-0005):
//! менять его нельзя без одновременной миграции прошивок устройств.
//! Клиент/устройство обязаны собирать байты ТОЧНО так же, как здесь,
//! и подписывать их Ed25519-ключом, чей публичный ключ == device_id.
//!
//! Domain-separation prefixes исключают коллизии между сообщениями
//! (register vs claim vs proof-сообщения из mint_energy).

use anchor_lang::prelude::*;

/// Prefix сообщения регистрации.
pub const DEVICE_REGISTER_MESSAGE_PREFIX: &[u8] = b"enrg:device:register";

/// Prefix сообщения claim.
pub const DEVICE_CLAIM_MESSAGE_PREFIX: &[u8] = b"enrg:device:claim";

/// Сообщение, которое устройство подписывает при регистрации
/// (доказывает владение ключом, ADR-0001 / ADR-0002 / Provisioning spec):
///
/// ```text
/// b"enrg:device:register" (20 bytes)
/// || device_id            (32 bytes) — публичный Ed25519-ключ устройства
/// || register_timestamp   (8 bytes,  little-endian)
/// ```
pub fn device_register_message(device_id: &Pubkey, register_timestamp: i64) -> Vec<u8> {
    let mut buf = Vec::with_capacity(DEVICE_REGISTER_MESSAGE_PREFIX.len() + 32 + 8);
    buf.extend_from_slice(DEVICE_REGISTER_MESSAGE_PREFIX);
    buf.extend_from_slice(&device_id.to_bytes());
    buf.extend_from_slice(&register_timestamp.to_le_bytes());
    buf
}

/// Сообщение, которое устройство подписывает при claim'е — согласие
/// устройства на привязку к КОНКРЕТНОМУ кошельку (ADR-0005):
///
/// ```text
/// b"enrg:device:claim" (17 bytes)
/// || device_id        (32 bytes) — публичный Ed25519-ключ устройства
/// || owner            (32 bytes) — кошелёк, которому устройство передаётся
/// || claim_nonce      (8 bytes,  little-endian) — anti-replay
/// || claim_timestamp  (8 bytes,  little-endian) — freshness
/// ```
///
/// Owner вшит в сообщение: перехваченную подпись нельзя «перенаправить»
/// на другой кошелёк — ончейн пересобирает сообщение из фактического
/// authority транзакции и сверяет его с подписью.
pub fn device_claim_message(
    device_id: &Pubkey,
    owner: &Pubkey,
    claim_nonce: u64,
    claim_timestamp: i64,
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(DEVICE_CLAIM_MESSAGE_PREFIX.len() + 32 + 32 + 8 + 8);
    buf.extend_from_slice(DEVICE_CLAIM_MESSAGE_PREFIX);
    buf.extend_from_slice(&device_id.to_bytes());
    buf.extend_from_slice(&owner.to_bytes());
    buf.extend_from_slice(&claim_nonce.to_le_bytes());
    buf.extend_from_slice(&claim_timestamp.to_le_bytes());
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk() -> Pubkey {
        Pubkey::new_from_array([7u8; 32])
    }

    fn pk2() -> Pubkey {
        Pubkey::new_from_array([9u8; 32])
    }

    #[test]
    fn register_message_format_is_locked() {
        let device = pk();
        let ts: i64 = 1_700_000_000;
        let msg = device_register_message(&device, ts);

        let mut expected = Vec::new();
        expected.extend_from_slice(DEVICE_REGISTER_MESSAGE_PREFIX);
        expected.extend_from_slice(&device.to_bytes());
        expected.extend_from_slice(&ts.to_le_bytes());

        assert_eq!(msg, expected);
        assert!(!msg.is_empty());
    }

    #[test]
    fn claim_message_format_is_locked() {
        let device = pk();
        let owner = pk2();
        let nonce: u64 = 7;
        let ts: i64 = 1_700_000_000;
        let msg = device_claim_message(&device, &owner, nonce, ts);

        let mut expected = Vec::new();
        expected.extend_from_slice(DEVICE_CLAIM_MESSAGE_PREFIX);
        expected.extend_from_slice(&device.to_bytes());
        expected.extend_from_slice(&owner.to_bytes());
        expected.extend_from_slice(&nonce.to_le_bytes());
        expected.extend_from_slice(&ts.to_le_bytes());

        assert_eq!(msg, expected);
    }

    #[test]
    fn claim_message_binds_owner() {
        let a = device_claim_message(&pk(), &pk2(), 1, 1_700_000_000);
        let b = device_claim_message(&pk(), &pk(), 1, 1_700_000_000);
        assert_ne!(a, b, "owner must be bound to the message");
    }

    #[test]
    fn claim_message_changes_with_nonce_and_timestamp() {
        let base = device_claim_message(&pk(), &pk2(), 1, 1_700_000_000);
        let n = device_claim_message(&pk(), &pk2(), 2, 1_700_000_000);
        let t = device_claim_message(&pk(), &pk2(), 1, 1_700_000_001);
        assert_ne!(base, n, "nonce must change the message");
        assert_ne!(base, t, "timestamp must change the message");
    }

    #[test]
    fn register_and_claim_messages_are_domain_separated() {
        assert_ne!(
            device_register_message(&pk(), 1_700_000_000),
            device_claim_message(&pk(), &pk2(), 1, 1_700_000_000)
        );
    }
}
