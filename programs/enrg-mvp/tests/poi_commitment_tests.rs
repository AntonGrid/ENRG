//! Host-side tests for the Proof-of-Intelligence commitment message layout.
//!
//! The canonical signed message for `commit_contribution` must be
//! byte-stable across clients:
//!   b"enrg:poi:commit" || round(8 LE) || device_id(32) || digest(32)
//! The on-chain behavior itself is covered by `ENRG/tests/poi-commitment.ts`
//! (anchor test); here we pin the layout for the offline (ENRG-AI) signer.

use enrg_mvp::state::{poi_commit_message, PoiCommitment};
use anchor_lang::prelude::{Pubkey, Space};

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

#[test]
fn poi_commitment_init_space_is_large_enough() {
    // 32 (device) + 8 (round) + 32 (digest) + 64 (signature) + 8 (timestamp).
    assert_eq!(PoiCommitment::INIT_SPACE, 144);
}
