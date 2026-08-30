use anchor_lang::prelude::*;

/// Proof-of-Intelligence contribution commitment (ADR-0010 / ENRG-AI Phase 2).
///
/// On-chain binding of a federated contribution digest to a device:
///   PDA seeds: [b"poi-commit", round(8 LE), device_id(32)]
///
/// The device signs
///   b"enrg:poi:commit" || round(8 LE) || device_id(32) || digest(32)
/// (verified on-chain via the Ed25519 precompile + Instructions sysvar), so a
/// third party cannot forge a contribution for a device. Anyone may pay the
/// rent (the oracle/aggregator usually does) — the signature binds the digest
/// to the device, not the payer.
#[account]
#[derive(InitSpace)]
pub struct PoiCommitment {
    /// Device Ed25519 public key that signed the contribution.
    pub device_id: Pubkey,
    /// Federated round number.
    pub round: u64,
    /// SHA-256 digest of the canonical contribution JSON (raw bytes).
    pub digest: [u8; 32],
    /// Ed25519 signature over the canonical commit message.
    pub signature: [u8; 64],
    /// Commitment timestamp (unix).
    pub committed_at: i64,
}

/// Canonical message a device signs for a contribution commitment.
pub fn poi_commit_message(round: u64, device_id: &Pubkey, digest: &[u8; 32]) -> Vec<u8> {
    let mut msg = Vec::with_capacity(15 + 8 + 32 + 32);
    msg.extend_from_slice(b"enrg:poi:commit");
    msg.extend_from_slice(&round.to_le_bytes());
    msg.extend_from_slice(&device_id.to_bytes());
    msg.extend_from_slice(digest);
    msg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_message_layout_is_stable() {
        let device = Pubkey::new_from_array([7u8; 32]);
        let digest = [9u8; 32];
        let msg = poi_commit_message(5, &device, &digest);
        assert_eq!(&msg[..15], b"enrg:poi:commit");
        assert_eq!(&msg[15..23], &5u64.to_le_bytes());
        assert_eq!(&msg[23..55], &device.to_bytes());
        assert_eq!(&msg[55..87], &digest);
        assert_eq!(msg.len(), 87);
    }
}
