use anchor_lang::prelude::*;

use crate::constants::{
    GOVERNANCE_MEMBER_MAX, GOVERNANCE_MIN_MEMBERS, PROPOSAL_AMOUNT_MAX_ATOMIC,
    PROPOSAL_TITLE_MAX_LEN, TIMELOCK_DELAY,
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

/// Следующий монотонный id предложения.
pub fn next_proposal_id(proposal_count: u64) -> Option<u64> {
    proposal_count.checked_add(1)
}

/// Валидация суммы предложения: > 0 и <= PROPOSAL_AMOUNT_MAX_ATOMIC (атомарные единицы).
pub fn validate_amount_atomic(amount: u64) -> Result<()> {
    if amount == 0 {
        return Err(ErrorCode::ZeroAmountMint.into());
    }
    if amount > PROPOSAL_AMOUNT_MAX_ATOMIC {
        return Err(ErrorCode::AmountCapExceeded.into());
    }
    Ok(())
}

/// Правило «одно активное предложение»: при наличии активного новый create
/// обязан сопровождаться передачей prev-предложения (cancel). Иначе — коллизия.
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
        // members=5, yes=3 → кворум (3 > 2 и 3 > 2); после TIMELOCK_DELAY — executable.
        let p = proposal_with(ProposalStatus::Approved, 3, 0, 5, 1_000_000);
        assert!(p.quorum_met());
        assert!(!p.executable(1_000_000 + TIMELOCK_DELAY as i64 - 1), "до timelock — нельзя");
        assert!(p.executable(1_000_000 + TIMELOCK_DELAY as i64), "на границе timelock — можно");
        assert!(p.executable(1_000_000 + TIMELOCK_DELAY as i64 + 1));
    }

    #[test]
    fn vetoed_if_minority() {
        // Формула (BLOCK 2): approved если `yes > no` И `yes+no > members/2`.
        // members=5, проголосовало 2 (yes=2): 2 не > 2 → кворума нет (меньшинство).
        let p = proposal_with(ProposalStatus::Pending, 2, 0, 5, 0);
        assert!(!p.quorum_met());
        // yes=1, no=3: yes не > no → не approved.
        let p2 = proposal_with(ProposalStatus::Pending, 1, 3, 5, 0);
        assert!(!p2.quorum_met());
        // все проголосовали (2 за, 3 против) → all_voted, но не кворум
        // (инструкция пометит Rejected).
        let p3 = proposal_with(ProposalStatus::Pending, 2, 3, 5, 0);
        assert!(p3.all_voted());
        assert!(!p3.quorum_met());
    }

    #[test]
    fn no_double_vote() {
        let p = proposal_with(ProposalStatus::Pending, 1, 0, 5, 0);
        // member(1) уже проголосовал (в voted_members).
        assert!(p.has_voted(&member(1)));
        assert!(!p.has_voted(&member(3)));
    }

    #[test]
    fn no_active_proposal_collision() {
        // Активного нет → можно создавать без prev.
        assert!(require_no_collision(0, false).is_ok());
        // Активное есть без prev → коллизия.
        assert!(require_no_collision(3, false).is_err());
        // Активное есть + prev передан → ок (cancel).
        assert!(require_no_collision(3, true).is_ok());
    }

    #[test]
    fn governance_mint_respects_pda_authority() {
        // Mint-authority остаётся PDA [b"mint-authority"] — эмиссия только через него.
        let (pda, bump) = Pubkey::find_program_address(&[b"mint-authority".as_ref()], &crate::id());
        // find_program_address гарантирует off-curve адрес; bump может быть любым
        // (для HkuC3… он равен 255 — это валидно). Проверяем реальный инвариант:
        // возвращённый bump деривирует тот же PDA.
        assert_eq!(
            Pubkey::create_program_address(&[b"mint-authority".as_ref(), &[bump]], &crate::id()).unwrap(),
            pda,
            "bump должен быть валидным seed для mint-authority PDA"
        );
        let (pda2, _) = Pubkey::find_program_address(&[b"mint-authority".as_ref()], &crate::id());
        assert_eq!(pda, pda2, "PDA детерминирован");
        // Пока статус не Approved — исполнение невозможно (ProposalNotApproved путь).
        let p = proposal_with(ProposalStatus::Pending, 3, 0, 5, 1_000_000);
        assert!(!p.executable(1_000_000 + TIMELOCK_DELAY as i64));
    }

    #[test]
    fn amount_cap_enforced() {
        assert!(validate_amount_atomic(0).is_err(), "0 запрещено");
        assert!(validate_amount_atomic(PROPOSAL_AMOUNT_MAX_ATOMIC).is_ok());
        assert!(validate_amount_atomic(PROPOSAL_AMOUNT_MAX_ATOMIC + 1).is_err());
    }

    #[test]
    fn atomic_units_no_decimal_leakage() {
        // Числа — атомарные единицы: 1 SRC = 10^SRC_DECIMALS.
        let one_src = 10u64.pow(SRC_DECIMALS as u32);
        assert_eq!(one_src, 1_000_000_000);
        // Кап кратен атомарной единице (нет «вейев»/десятичных).
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
        // Пути эмиссии SRC: mint_energy (PoP) + governance_mint. Governance-эмиссия
        // за один проход ограничена капом предложения; вместе с founder-премайном
        // не может исчерпать MAX_SUPPLY_ATOMIC.
        assert!(
            PROPOSAL_AMOUNT_MAX_ATOMIC
                <= crate::constants::MAX_SUPPLY_ATOMIC
                    - crate::constants::FOUNDER_ALLOCATION_ATOMIC
        );
        // Non-approved предложение не исполняется никогда (timelock не помогает).
        let pending = proposal_with(ProposalStatus::Pending, 0, 0, 5, 0);
        let rejected = proposal_with(ProposalStatus::Rejected, 0, 0, 5, 0);
        assert!(!pending.executable(TIMELOCK_DELAY as i64 + 1));
        assert!(!rejected.executable(TIMELOCK_DELAY as i64 + 1));
    }
}

