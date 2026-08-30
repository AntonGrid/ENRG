//! Host-side tests for the oracle quorum message layout (P3-6).
//!
//! The canonical oracle-vote message must be byte-stable:
//!   b"enrg:oracle:attest" || device_id(32) || nonce(8 LE) || proof_hash(32)
//! The on-chain behavior is covered by `ENRG/tests/oracle-quorum.ts`.

use enrg_mvp::state::{oracle_attest_message, OracleAttestation, OracleStake, OracleVote};
use anchor_lang::prelude::{Pubkey, Space};

#[test]
fn attest_message_layout_is_stable() {
    let device = Pubkey::new_from_array([3u8; 32]);
    let hash = [7u8; 32];
    let msg = oracle_attest_message(&device, 9, &hash);
    assert_eq!(&msg[..18], b"enrg:oracle:attest");
    assert_eq!(&msg[18..50], &device.to_bytes());
    assert_eq!(&msg[50..58], &9u64.to_le_bytes());
    assert_eq!(&msg[58..90], &hash);
    assert_eq!(msg.len(), 90);
}

#[test]
fn quorum_account_sizes_are_sane() {
    assert_eq!(OracleAttestation::INIT_SPACE, 32 + 8 + 32 + 1 + 1 + 1 + 8);
    assert_eq!(OracleVote::INIT_SPACE, 32 + 32 + 32 + 8);
    assert_eq!(OracleStake::INIT_SPACE, 32 + 8 + 8 + 1);
}
