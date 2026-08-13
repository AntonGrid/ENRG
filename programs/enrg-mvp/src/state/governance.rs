use anchor_lang::prelude::*;

use crate::constants::{
    GOVERNANCE_MEMBER_MAX, GOVERNANCE_MIN_MEMBERS, PROPOSAL_TITLE_MAX_LEN, TIMELOCK_DELAY,
};
use crate::error::ErrorCode;

/// Статус предложения (ADR-0009).
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

/// Единый governance-аккаунт (PDA [b"governance"]).
///
/// Двухуровневая модель: `authority` (владелец контракта) + `members`
/// (3–5 адресов, имеющих право голоса). `authority` создаёт предложения
/// и управляет списком members; члены голосуют.
#[account]
pub struct GovernanceState {
    /// Текущий владелец контракта (создаёт предложения, управляет members).
    pub authority: Pubkey,

    /// Список членов с правом голоса (3..=GOVERNANCE_MEMBER_MAX).
    pub members: Vec<Pubkey>,

    /// Счётчик созданных предложений (монотонный).
    pub proposal_count: u64,

    /// id активного предложения (0 = нет активного; одно активное в момент времени).
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

/// Governance-предложение (PDA [b"proposal", id.to_le_bytes()]).
///
/// `member_snapshot_count` фиксируется при создании (кворум считается от него).
/// Эмиссия после одобрения и timelock — через `governance_mint`.
#[account]
pub struct Proposal {
    /// Монотонный id (== GovernanceState.proposal_count на момент создания).
    pub id: u64,

    /// Authority, создавший предложение (получатель в `destination` — его ATA).
    pub proposer: Pubkey,

    /// Заголовок/короткий payload (≤ PROPOSAL_TITLE_MAX_LEN байт).
    pub title: String,

    /// Запрашиваемая эмиссия в атомарных единицах (≤ PROPOSAL_AMOUNT_MAX_ATOMIC).
    pub amount_atomic: u64,

    /// ATA получателя (mint == SRC mint; owner == proposer).
    pub destination: Pubkey,

    pub status: ProposalStatus,
    pub created_at: i64,
    pub approved_at: i64,
    pub executed_at: i64,

    /// Количество голосов «за» / «против».
    pub yes_votes: u32,
    pub no_votes: u32,

    /// Размер списка members на момент создания (для расчёта кворума).
    pub member_snapshot_count: u32,

    /// Адреса проголосовавших членов (однократное голосование).
    pub voted_members: Vec<Pubkey>,
}

impl Proposal {
    /// Максимальный размер аккаунта Proposal (дискриминатор + поля).
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

    /// Кворум (ADR-0009): большинство «за» среди проголосовавших
    /// (`yes > no`) И проголосовало больше половины members (> members/2).
    pub fn quorum_met(&self) -> bool {
        let threshold = self.member_snapshot_count / 2;
        self.yes_votes > self.no_votes
            && (self.yes_votes + self.no_votes) > threshold
    }

    /// Все члены снапшота проголосовали.
    pub fn all_voted(&self) -> bool {
        (self.yes_votes + self.no_votes) as usize >= self.member_snapshot_count as usize
    }

    pub fn has_voted(&self, member: &Pubkey) -> bool {
        self.voted_members.contains(member)
    }

    /// Исполнение разрешено: статус Approved и прошёл TIMELOCK_DELAY после approved_at.
    pub fn executable(&self, now: i64) -> bool {
        self.status == ProposalStatus::Approved
            && now >= self.approved_at.saturating_add(TIMELOCK_DELAY as i64)
    }
}

/// Валидация списка members: 3..=5 уникальных адресов.
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
