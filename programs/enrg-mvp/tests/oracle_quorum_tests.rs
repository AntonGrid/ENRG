//! Host-side tests for the oracle quorum message layout (P3-6).
//!
//! The canonical oracle-vote message must be byte-stable:
//!   b"enrg:oracle:attest" || device_id(32) || nonce(8 LE) || proof_hash(32)
//! The on-chain behavior is covered by `ENRG/tests/oracle-quorum.ts`.

use enrg_mvp::state::{
    apply_vote, is_finalized, oracle_attest_message, OracleAttestation, OracleStake, OracleVote,
    OracleReport, VoteOutcome,
};
use anchor_lang::prelude::{Pubkey, Space};

fn empty_attestation() -> OracleAttestation {
    OracleAttestation {
        device_id: Pubkey::default(),
        nonce: 0,
        proof_hash: [0u8; 32],
        votes: 0,
        finalized: false,
        conflict: false,
        created_at: 0,
    }
}

const X: [u8; 32] = [0xAA; 32];
const Y: [u8; 32] = [0xBB; 32];

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
fn first_vote_fixes_the_canonical_hash() {
    let mut att = empty_attestation();
    let device = Pubkey::new_from_array([5u8; 32]);
    assert_eq!(apply_vote(&mut att, device, 42, &X, 1_700_000_000), VoteOutcome::Canonical);
    assert_eq!(att.proof_hash, X);
    assert_eq!(att.device_id, device);
    assert_eq!(att.nonce, 42);
    assert_eq!(att.votes, 1);
    assert_eq!(att.created_at, 1_700_000_000);
    assert!(!att.conflict);
}

/// REGRESSION (audit 2026-09-16): with `threshold = 2` the old implementation
/// counted a contradictory vote as a regular one, so ONE honest oracle plus ONE
/// contradicting oracle finalized the attestation. The contradictory vote must
/// never advance the quorum.
#[test]
fn conflicting_vote_never_counts_toward_the_threshold() {
    let mut att = empty_attestation();
    let device = Pubkey::new_from_array([5u8; 32]);
    let threshold = 2u8;

    // oracle #1 — honest, establishes the canonical hash X
    apply_vote(&mut att, device, 1, &X, 100);
    assert_eq!(att.votes, 1);
    assert!(!is_finalized(&att, threshold));

    // oracle #2 — contradicts (hash Y): recorded, but NOT counted
    assert_eq!(apply_vote(&mut att, device, 1, &Y, 101), VoteOutcome::Conflict);
    assert!(att.conflict, "the contradiction must be recorded as evidence");
    assert_eq!(att.votes, 1, "a contradictory vote must not advance the quorum");
    assert!(
        !is_finalized(&att, threshold),
        "one honest + one contradicting oracle must NOT finalize a k=2 attestation"
    );

    // oracle #3 — agrees with X: now the quorum is reached
    assert_eq!(apply_vote(&mut att, device, 1, &X, 102), VoteOutcome::Agreed);
    assert_eq!(att.votes, 2);
    assert!(is_finalized(&att, threshold));
}

#[test]
fn agreement_alone_reaches_the_quorum() {
    let mut att = empty_attestation();
    let device = Pubkey::new_from_array([6u8; 32]);
    apply_vote(&mut att, device, 7, &X, 10);
    apply_vote(&mut att, device, 7, &X, 11);
    apply_vote(&mut att, device, 7, &X, 12);
    assert_eq!(att.votes, 3);
    assert!(is_finalized(&att, 3));
    // A higher threshold is still not met by the same votes.
    assert!(!is_finalized(&att, 4));
}

#[test]
fn a_late_conflict_does_not_undo_finalization() {
    let mut att = empty_attestation();
    let device = Pubkey::new_from_array([7u8; 32]);
    apply_vote(&mut att, device, 3, &X, 1);
    apply_vote(&mut att, device, 3, &X, 2);
    if is_finalized(&att, 2) {
        att.finalized = true; // the handler does this
    }
    assert!(att.finalized);
    apply_vote(&mut att, device, 3, &Y, 3);
    assert!(att.finalized, "finalization is monotonic — a conflict cannot revert it");
    assert_eq!(att.proof_hash, X, "the canonical hash never changes after the first vote");
}

#[test]
fn agreeing_votes_saturate_instead_of_overflowing() {
    let mut att = empty_attestation();
    let device = Pubkey::new_from_array([8u8; 32]);
    att.votes = 255;
    att.proof_hash = X;
    assert_eq!(apply_vote(&mut att, device, 1, &X, 0), VoteOutcome::Agreed);
    assert_eq!(att.votes, 255, "must not wrap around");
}

#[test]
fn quorum_account_sizes_are_sane() {
    assert_eq!(OracleAttestation::INIT_SPACE, 32 + 8 + 32 + 1 + 1 + 1 + 8);
    assert_eq!(OracleVote::INIT_SPACE, 32 + 32 + 32 + 8 + 1);
    assert_eq!(OracleStake::INIT_SPACE, 32 + 8 + 8 + 1);
}

#[test]
fn report_proof_hash_is_sha256_of_device_message() {
    let report = OracleReport {
        oracle: Pubkey::new_from_array([1u8; 32]),
        device_id: Pubkey::new_from_array([2u8; 32]),
        nonce: 7,
        device_timestamp: 1_700_000_000,
        verified_at: 1_700_000_050, // differs from device_timestamp on purpose
        energy_wh: 1_250,
        device_signature: [3u8; 64],
        oracle_signature: [4u8; 64],
    };
    let msg = report.device_message_to_sign().unwrap();
    let expected = solana_sha256_hasher::hash(&msg).to_bytes();
    assert_eq!(report.proof_hash().unwrap(), expected);
    // The hash MUST be independent of verified_at (each oracle verifies at a
    // slightly different moment; an oracle-based hash would never match across
    // independent oracles → false conflicts).
    let mut other = OracleReport { verified_at: 1_700_000_999, ..report };
    assert_eq!(report.proof_hash().unwrap(), other.proof_hash().unwrap());
    other.nonce = 8;
    assert_ne!(report.proof_hash().unwrap(), other.proof_hash().unwrap());
}
