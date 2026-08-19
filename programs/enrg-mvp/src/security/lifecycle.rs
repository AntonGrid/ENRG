//! Canonical messages signed by the DEVICE in the lifecycle flow.
//!
//! The format is fixed at the protocol level (ADR-0001 / ADR-0002 / ADR-0005):
//! it cannot be changed without a coordinated migration of device firmware.
//! Clients/devices MUST assemble the bytes EXACTLY as here and sign them
//! with an Ed25519 key whose public key == device_id.
//!
//! Domain-separation prefixes prevent collisions between messages
//! (register vs claim vs proof messages from mint_energy).

use anchor_lang::prelude::*;

/// Registration message prefix.
pub const DEVICE_REGISTER_MESSAGE_PREFIX: &[u8] = b"enrg:device:register";

/// Claim message prefix.
pub const DEVICE_CLAIM_MESSAGE_PREFIX: &[u8] = b"enrg:device:claim";

/// The message the device signs at registration
/// (proves key ownership, ADR-0001 / ADR-0002 / Provisioning spec):
///
/// ```text
/// b"enrg:device:register" (20 bytes)
/// || device_id            (32 bytes) — device public Ed25519 key
/// || register_timestamp   (8 bytes,  little-endian)
/// ```
pub fn device_register_message(device_id: &Pubkey, register_timestamp: i64) -> Vec<u8> {
    let mut buf = Vec::with_capacity(DEVICE_REGISTER_MESSAGE_PREFIX.len() + 32 + 8);
    buf.extend_from_slice(DEVICE_REGISTER_MESSAGE_PREFIX);
    buf.extend_from_slice(&device_id.to_bytes());
    buf.extend_from_slice(&register_timestamp.to_le_bytes());
    buf
}

/// The message the device signs when claiming — the device's consent to be
/// bound to a SPECIFIC wallet (ADR-0005):
///
/// ```text
/// b"enrg:device:claim" (17 bytes)
/// || device_id        (32 bytes) — device public Ed25519 key
/// || owner            (32 bytes) — the wallet the device is transferred to
/// || claim_nonce      (8 bytes,  little-endian) — anti-replay
/// || claim_timestamp  (8 bytes,  little-endian) — freshness
/// ```
///
/// The owner is embedded in the message: an intercepted signature cannot be
/// "redirected" to another wallet — on-chain rebuilds the message from the
/// actual transaction authority and checks it against the signature.
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

/// Key rotation message prefix.
pub const DEVICE_ROTATE_MESSAGE_PREFIX: &[u8] = b"enrg:device:rotate";

/// The message signed by the device's NEW key during rotation
/// (ADR-0007: rotation is confirmed by the new key — proof-of-possession):
///
/// ```text
/// b"enrg:device:rotate" (18 bytes)
/// || new_device_id      (32 bytes) — the device's new public Ed25519 key
/// || owner              (32 bytes) — the current owner (authority)
/// || rotate_nonce       (8 bytes,  little-endian) — anti-replay
/// || rotate_timestamp   (8 bytes,  little-endian) — freshness
/// ```
pub fn device_rotate_message(
    new_device_id: &Pubkey,
    owner: &Pubkey,
    rotate_nonce: u64,
    rotate_timestamp: i64,
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(DEVICE_ROTATE_MESSAGE_PREFIX.len() + 32 + 32 + 8 + 8);
    buf.extend_from_slice(DEVICE_ROTATE_MESSAGE_PREFIX);
    buf.extend_from_slice(&new_device_id.to_bytes());
    buf.extend_from_slice(&owner.to_bytes());
    buf.extend_from_slice(&rotate_nonce.to_le_bytes());
    buf.extend_from_slice(&rotate_timestamp.to_le_bytes());
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

    #[test]
    fn rotate_message_format_is_locked() {
        let new_key = pk2();
        let owner = pk();
        let nonce: u64 = 7;
        let ts: i64 = 1_700_000_000;
        let msg = device_rotate_message(&new_key, &owner, nonce, ts);

        let mut expected = Vec::new();
        expected.extend_from_slice(DEVICE_ROTATE_MESSAGE_PREFIX);
        expected.extend_from_slice(&new_key.to_bytes());
        expected.extend_from_slice(&owner.to_bytes());
        expected.extend_from_slice(&nonce.to_le_bytes());
        expected.extend_from_slice(&ts.to_le_bytes());
        assert_eq!(msg, expected);
    }

    #[test]
    fn rotate_message_binds_key_owner_nonce_timestamp() {
        let a = device_rotate_message(&pk2(), &pk(), 1, 1_700_000_000);
        assert_ne!(a, device_rotate_message(&pk(), &pk(), 1, 1_700_000_000), "new key must be bound");
        assert_ne!(a, device_rotate_message(&pk2(), &pk2(), 1, 1_700_000_000), "owner must be bound");
        assert_ne!(a, device_rotate_message(&pk2(), &pk(), 2, 1_700_000_000), "nonce must be bound");
        assert_ne!(a, device_rotate_message(&pk2(), &pk(), 1, 1_700_000_001), "timestamp must be bound");
    }

    #[test]
    fn rotate_message_is_domain_separated_from_register_and_claim() {
        assert_ne!(
            device_rotate_message(&pk2(), &pk(), 1, 1_700_000_000),
            device_register_message(&pk2(), 1_700_000_000)
        );
        assert_ne!(
            device_rotate_message(&pk2(), &pk(), 1, 1_700_000_000),
            device_claim_message(&pk2(), &pk(), 1, 1_700_000_000)
        );
    }
}
