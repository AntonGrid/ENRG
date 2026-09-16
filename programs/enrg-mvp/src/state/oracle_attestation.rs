use anchor_lang::prelude::*;

/// On-chain oracle quorum (P3-6, audit 2026-08-30).
///
/// A proof (device_id, nonce, proof_hash) is confirmed when `threshold`
/// DISTINCT trusted oracles from the OracleRegistry voted for it. Every vote
/// is a separate PDA `OracleVote`, so a single oracle cannot vote twice and
/// the N-in-one-transaction tx-size limit is avoided (each vote is its own tx).
///
///   OracleAttestation PDA: [b"oracle-attest", device_id, nonce]
///   OracleVote PDA:        [b"oracle-vote", attestation, oracle]
///   OracleStake PDA:       [b"oracle-stake", oracle]
///
/// The first vote fixes the canonical `proof_hash`; a later vote carrying a
/// different hash sets `conflict = true` (a contradictory report — the
/// economic basis for `slash_oracle`) and does **NOT** count toward the
/// threshold (audit 2026-09-16: previously every vote incremented `votes`, so one
/// honest plus one contradicting oracle could finalize a k=2 attestation).
#[account]
#[derive(InitSpace)]
pub struct OracleAttestation {
    /// Device whose proof is being confirmed.
    pub device_id: Pubkey,
    /// Proof nonce (uniquely identifies the report together with device_id).
    pub nonce: u64,
    /// Canonical proof hash fixed by the first oracle vote.
    pub proof_hash: [u8; 32],
    /// Number of **agreeing** oracle votes (contradictory votes are not counted).
    pub votes: u8,
    /// votes >= threshold → the attestation is finalized.
    pub finalized: bool,
    /// A later vote carried a different proof_hash (basis for slashing).
    pub conflict: bool,
    /// First vote timestamp.
    pub created_at: i64,
}

/// Outcome of applying one oracle vote (see `apply_vote`).
#[derive(Debug, PartialEq, Eq)]
pub enum VoteOutcome {
    /// The very first vote — it fixes the canonical hash.
    Canonical,
    /// The vote agrees with the canonical hash and advances the quorum.
    Agreed,
    /// The vote contradicts the canonical hash: recorded, never counted.
    Conflict,
}

/// Apply one oracle vote to an attestation.
///
/// `attestation.votes` counts **agreeing** votes only, so a contradictory report
/// can neither reach the threshold nor help someone else reach it. The
/// contradictory vote is still persisted in its own `OracleVote` PDA (with its
/// own signed `proof_hash`), which makes the offence verifiable on-chain and is
/// the basis for `slash_oracle`.
///
/// Deliberately pure: the handler (which needs the Ed25519 check and the clock)
/// stays a thin wrapper, and the quorum arithmetic is unit-tested.
pub fn apply_vote(
    attestation: &mut OracleAttestation,
    device_id: Pubkey,
    nonce: u64,
    proof_hash: &[u8; 32],
    now: i64,
) -> VoteOutcome {
    // `votes == 0` is exactly "the canonical hash is not set yet": the first vote
    // always establishes it and is counted as agreeing.
    if attestation.votes == 0 {
        attestation.device_id = device_id;
        attestation.nonce = nonce;
        attestation.proof_hash = *proof_hash;
        attestation.created_at = now;
        attestation.votes = 1;
        return VoteOutcome::Canonical;
    }

    if attestation.proof_hash == *proof_hash {
        attestation.votes = attestation.votes.saturating_add(1);
        VoteOutcome::Agreed
    } else {
        attestation.conflict = true;
        VoteOutcome::Conflict
    }
}

/// Whether the attestation reached the quorum (used by the handler and by
/// `mint_energy`'s gate test suite).
pub fn is_finalized(attestation: &OracleAttestation, threshold: u8) -> bool {
    attestation.votes >= threshold
}

/// One oracle's vote on an attestation (dedupe via PDA seeds).
#[account]
#[derive(InitSpace)]
pub struct OracleVote {
    /// The oracle that voted.
    pub oracle: Pubkey,
    /// The attestation this vote belongs to.
    pub attestation: Pubkey,
    /// The proof hash the oracle signed.
    pub proof_hash: [u8; 32],
    /// Vote timestamp.
    pub voted_at: i64,
    /// Reward for a vote in a FINALIZED attestation was already claimed
    /// (SRC minted from the staking fund).
    pub reward_claimed: bool,
}

/// Oracle reputation deposit (lamports escrowed by the oracle on the PDA).
#[account]
#[derive(InitSpace)]
pub struct OracleStake {
    /// The oracle.
    pub oracle: Pubkey,
    /// Escrowed lamports (deposit). 0 if slashed/withdrawn.
    pub lamports: u64,
    /// Joined timestamp.
    pub joined_at: i64,
    /// Set when the deposit was slashed (funds moved to the vault).
    pub slashed: bool,
}

/// Canonical message an oracle signs for a vote:
///   b"enrg:oracle:attest" || device_id(32) || nonce(8 LE) || proof_hash(32)
pub fn oracle_attest_message(device_id: &Pubkey, nonce: u64, proof_hash: &[u8; 32]) -> Vec<u8> {
    let mut msg = Vec::with_capacity(18 + 32 + 8 + 32);
    msg.extend_from_slice(b"enrg:oracle:attest");
    msg.extend_from_slice(&device_id.to_bytes());
    msg.extend_from_slice(&nonce.to_le_bytes());
    msg.extend_from_slice(proof_hash);
    msg
}

/// Minimum number of oracle votes to finalize an attestation.
pub const ORACLE_ATTESTATION_THRESHOLD: u8 = 2;

/// On-chain oracle quorum configuration (P3-6, phase 2).
///
/// PDA `[b"oracle-quorum-config"]`. When the PDA is NOT initialized the quorum
/// is disabled and `mint_energy` behaves exactly like the single-oracle
/// legacy flow (full backward compatibility). When initialized with
/// `required = true`, every mint must present a FINALIZED attestation whose
/// proof_hash equals SHA-256(oracle_message) of the report.
#[account]
#[derive(InitSpace)]
pub struct OracleQuorumConfig {
    /// Authority — must equal the OracleRegistry authority (protocol admin).
    pub authority: Pubkey,
    /// mint_energy requires a finalized attestation when true.
    pub required: bool,
    /// Votes needed to finalize an attestation (2..=MAX_ORACLES).
    pub threshold: u8,
    /// SRC reward (atomic units) paid to an oracle for a vote in a FINALIZED
    /// attestation, sourced from the staking fund.
    pub reward_per_vote: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
