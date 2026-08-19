use anchor_lang::prelude::*;

use crate::constants::{
    GOVERNANCE_MEMBER_MAX, GOVERNANCE_MIN_MEMBERS, PROPOSAL_AMOUNT_MAX_ATOMIC,
    PROPOSAL_TITLE_MAX_LEN, TIMELOCK_DELAY,
};
use crate::error::ErrorCode;

/// Proposal status (ADR-0009).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ProposalStatus {
    Pending,
    Approved,
    Rejected,
    Cancelled,
    Executed,
}

impl Default for ProposalStatus {
    fn default() -> Self {
        ProposalStatus::Pending
    }
}

/// Single governance account (PDA [b"governance"]).
///
/// Two-level model: `authority` (contract owner) + `members`
/// (3–5 addresses with voting rights). `authority` creates proposals
/// and manages the members list; members vote.
#[account]
pub struct GovernanceState {
    /// Current contract owner (creates proposals, manages members).
    pub authority: Pubkey,

    /// Members with voting rights (3..=GOVERNANCE_MEMBER_MAX).
    pub members: Vec<Pubkey>,

    /// Counter of created proposals (monotonic).
    pub proposal_count: u64,

    /// id of the active proposal (0 = none active; one active at a time).
    pub active_proposal_id: u64,
}

impl GovernanceState {
    pub const LEN: usize =
        32 + // authority
        4 + GOVERNANCE_MEMBER_MAX * 32 + // members Vec<Pubkey>
        8 + // proposal_count
        8;   // active_proposal_id

    pub fn is_member(&self, who: &Pubkey) -> bool {
        self.members.contains(who)
    }
}

/// Governance proposal (PDA [b"proposal", id.to_le_bytes()]).
///
/// `member_snapshot_count` is fixed at creation (quorum is computed from it).
/// Emission after approval and timelock happens via `governance_mint`.
#[account]
pub struct Proposal {
    /// Monotonic id (== GovernanceState.proposal_count at creation time).
    pub id: u64,

    /// Authority that created the proposal (the recipient in `destination` is its ATA).
    pub proposer: Pubkey,

    /// Title / short payload (≤ PROPOSAL_TITLE_MAX_LEN bytes).
    pub title: String,

    /// Requested emission in atomic units (≤ PROPOSAL_AMOUNT_MAX_ATOMIC).
    pub amount_atomic: u64,

    /// Recipient ATA (mint == SRC mint; owner == proposer).
    pub destination: Pubkey,

    pub status: ProposalStatus,
    pub created_at: i64,
    pub approved_at: i64,
    pub executed_at: i64,

    /// Vote counts: "for" / "against".
    pub yes_votes: u32,
    pub no_votes: u32,

    /// Size of the members list at creation time (for quorum calculation).
    pub member_snapshot_count: u32,

    /// Addresses of members who voted (single vote each).
    pub voted_members: Vec<Pubkey>,
}

impl Proposal {
    /// Maximum Proposal account size (discriminator + fields).
    pub const LEN: usize =
        8 + // discriminator
        8 + // id
        32 + // proposer
        4 + PROPOSAL_TITLE_MAX_LEN + // title (String: prefix + max)
        8 + // amount_atomic
        32 + // destination
        1 + // status (enum)
        8 + // created_at
        8 + // approved_at
        8 + // executed_at
        4 + // yes_votes
        4 + // no_votes
        4 + // member_snapshot_count
        4 + GOVERNANCE_MEMBER_MAX * 32; // voted_members (Vec<Pubkey>)

    /// Quorum (ADR-0009): majority "for" among those who voted
    /// (`yes > no`) AND more than half of the members voted (> members/2).
    pub fn quorum_met(&self) -> bool {
        let threshold = self.member_snapshot_count / 2;
        self.yes_votes > self.no_votes
            && (self.yes_votes + self.no_votes) > threshold
    }

    /// All snapshot members have voted.
    pub fn all_voted(&self) -> bool {
        (self.yes_votes + self.no_votes) as usize >= self.member_snapshot_count as usize
    }

    pub fn has_voted(&self, member: &Pubkey) -> bool {
        self.voted_members.contains(member)
    }

    /// Execution allowed: status Approved and TIMELOCK_DELAY elapsed since approved_at.
    pub fn executable(&self, now: i64) -> bool {
        self.status == ProposalStatus::Approved
            && now >= self.approved_at.saturating_add(TIMELOCK_DELAY as i64)
    }
}

/// Validate the members list: 3..=5 unique addresses.
pub fn validate_members(members: &[Pubkey]) -> Result<()> {
    if members.len() < GOVERNANCE_MIN_MEMBERS || members.len() > GOVERNANCE_MEMBER_MAX {
        return Err(ErrorCode::InvalidMemberList.into());
    }
    for (i, m) in members.iter().enumerate() {
        if members[..i].contains(m) {
            return Err(ErrorCode::DuplicateMember.into());
        }
    }
    Ok(())
}

/// Next monotonic proposal id.
pub fn next_proposal_id(proposal_count: u64) -> Option<u64> {
    proposal_count.checked_add(1)
}

/// Validate the proposal amount: > 0 and <= PROPOSAL_AMOUNT_MAX_ATOMIC (atomic units).
pub fn validate_amount_atomic(amount: u64) -> Result<()> {
    if amount == 0 {
        return Err(ErrorCode::ZeroAmountMint.into());
    }
    if amount > PROPOSAL_AMOUNT_MAX_ATOMIC {
        return Err(ErrorCode::AmountCapExceeded.into());
    }
    Ok(())
}

/// "One active proposal" rule: if one is active, a new create MUST be
/// accompanied by the previous proposal (cancel). Otherwise — collision.
pub fn require_no_collision(active_proposal_id: u64, prev_provided: bool) -> Result<()> {
    if active_proposal_id != 0 && !prev_provided {
        return Err(ErrorCode::ProposalNotActive.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{
        GOVERNANCE_MEMBER_MAX, GOVERNANCE_MIN_MEMBERS, PROPOSAL_AMOUNT_MAX_ATOMIC,
        SRC_DECIMALS, TIMELOCK_DELAY,
    };

    fn member(i: u8) -> Pubkey {
        Pubkey::new_from_array([i; 32])
    }

    fn proposal_with(status: ProposalStatus, yes: u32, no: u32, snap: u32, approved_at: i64) -> Proposal {
        Proposal {
            id: 1,
            proposer: member(0),
            title: "t".to_string(),
            amount_atomic: 1_000,
            destination: member(9),
            status,
            created_at: approved_at - 100,
            approved_at,
            executed_at: 0,
            yes_votes: yes,
            no_votes: no,
            member_snapshot_count: snap,
            voted_members: vec![member(1), member(2)],
        }
    }

    #[test]
    fn approved_after_majority_and_timelock() {
        // members=5, yes=3 → quorum (3 > 2 and 3 > 2); after TIMELOCK_DELAY — executable.
        let p = proposal_with(ProposalStatus::Approved, 3, 0, 5, 1_000_000);
        assert!(p.quorum_met());
        assert!(!p.executable(1_000_000 + TIMELOCK_DELAY as i64 - 1), "before timelock — not allowed");
        assert!(p.executable(1_000_000 + TIMELOCK_DELAY as i64), "at the timelock boundary — allowed");
        assert!(p.executable(1_000_000 + TIMELOCK_DELAY as i64 + 1));
    }

    #[test]
    fn vetoed_if_minority() {
        // Formula (BLOCK 2): approved if `yes > no` AND `yes+no > members/2`.
        // members=5, 2 voted (yes=2): 2 is not > 2 → no quorum (minority).
        let p = proposal_with(ProposalStatus::Pending, 2, 0, 5, 0);
        assert!(!p.quorum_met());
        // yes=1, no=3: yes is not > no → not approved.
        let p2 = proposal_with(ProposalStatus::Pending, 1, 3, 5, 0);
        assert!(!p2.quorum_met());
        // all voted (2 for, 3 against) → all_voted, but no quorum
        // (the instruction will mark it Rejected).
        let p3 = proposal_with(ProposalStatus::Pending, 2, 3, 5, 0);
        assert!(p3.all_voted());
        assert!(!p3.quorum_met());
    }

    #[test]
    fn no_double_vote() {
        let p = proposal_with(ProposalStatus::Pending, 1, 0, 5, 0);
        // member(1) already voted (in voted_members).
        assert!(p.has_voted(&member(1)));
        assert!(!p.has_voted(&member(3)));
    }

    #[test]
    fn no_active_proposal_collision() {
        // No active proposal → can create without prev.
        assert!(require_no_collision(0, false).is_ok());
        // Active proposal without prev → collision.
        assert!(require_no_collision(3, false).is_err());
        // Active proposal + prev passed → ok (cancel).
        assert!(require_no_collision(3, true).is_ok());
    }

    #[test]
    fn governance_mint_respects_pda_authority() {
        // Mint-authority stays the PDA [b"mint-authority"] — emission only through it.
        let (pda, bump) = Pubkey::find_program_address(&[b"mint-authority".as_ref()], &crate::id());
        // find_program_address guarantees an off-curve address; the bump may be anything
        // (for HkuC3… it is 255 — valid). Check the real invariant:
        // the returned bump derives the same PDA.
        assert_eq!(
            Pubkey::create_program_address(&[b"mint-authority".as_ref(), &[bump]], &crate::id()).unwrap(),
            pda,
            "bump must be a valid seed for the mint-authority PDA"
        );
        let (pda2, _) = Pubkey::find_program_address(&[b"mint-authority".as_ref()], &crate::id());
        assert_eq!(pda, pda2, "PDA is deterministic");
        // Until the status is Approved — execution is impossible (ProposalNotApproved path).
        let p = proposal_with(ProposalStatus::Pending, 3, 0, 5, 1_000_000);
        assert!(!p.executable(1_000_000 + TIMELOCK_DELAY as i64));
    }

    #[test]
    fn amount_cap_enforced() {
        assert!(validate_amount_atomic(0).is_err(), "0 is forbidden");
        assert!(validate_amount_atomic(PROPOSAL_AMOUNT_MAX_ATOMIC).is_ok());
        assert!(validate_amount_atomic(PROPOSAL_AMOUNT_MAX_ATOMIC + 1).is_err());
    }

    #[test]
    fn atomic_units_no_decimal_leakage() {
        // Numbers are atomic units: 1 SRC = 10^SRC_DECIMALS.
        let one_src = 10u64.pow(SRC_DECIMALS as u32);
        assert_eq!(one_src, 1_000_000_000);
        // The cap is a multiple of an atomic unit (no "wei"-like decimals).
        assert_eq!(PROPOSAL_AMOUNT_MAX_ATOMIC % one_src, 0);
        assert!(PROPOSAL_AMOUNT_MAX_ATOMIC < crate::constants::MAX_SUPPLY_ATOMIC);
    }

    #[test]
    fn member_list_bounds() {
        let three = vec![member(1), member(2), member(3)];
        let five = vec![member(1), member(2), member(3), member(4), member(5)];
        let six = vec![member(1), member(2), member(3), member(4), member(5), member(6)];
        let dup = vec![member(1), member(1), member(3)];
        assert!(validate_members(&[]).is_err());
        assert!(validate_members(&three).is_ok());
        assert!(validate_members(&five).is_ok());
        assert!(validate_members(&six).is_err());
        assert!(validate_members(&dup).is_err());
        assert_eq!(GOVERNANCE_MIN_MEMBERS, 3);
        assert_eq!(GOVERNANCE_MEMBER_MAX, 5);
    }

    #[test]
    fn emission_paths_are_capped_and_gated() {
        // SRC emission paths: mint_energy (PoP) + governance_mint. Governance emission
        // in one pass is capped by the proposal cap; together with the founder premine
        // it cannot exhaust MAX_SUPPLY_ATOMIC.
        assert!(
            PROPOSAL_AMOUNT_MAX_ATOMIC
                <= crate::constants::MAX_SUPPLY_ATOMIC
                    - crate::constants::FOUNDER_ALLOCATION_ATOMIC
        );
        // A non-approved proposal is never executed (timelock does not help).
        let pending = proposal_with(ProposalStatus::Pending, 0, 0, 5, 0);
        let rejected = proposal_with(ProposalStatus::Rejected, 0, 0, 5, 0);
        assert!(!pending.executable(TIMELOCK_DELAY as i64 + 1));
        assert!(!rejected.executable(TIMELOCK_DELAY as i64 + 1));
    }
}

