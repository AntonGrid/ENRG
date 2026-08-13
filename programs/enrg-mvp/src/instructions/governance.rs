use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::constants::PROPOSAL_TITLE_MAX_LEN;
use crate::error::ErrorCode;
use crate::state::*;

/// Инициализация governance (PDA [b"governance"]). authority = signer,
/// задаётся первичный список members (3..=5 уникальных).
#[derive(Accounts)]
pub struct InitializeGovernance<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + GovernanceState::LEN,
        seeds = [b"governance"],
        bump
    )]
    pub governance: Account<'info, GovernanceState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_governance(
    ctx: Context<InitializeGovernance>,
    members: Vec<Pubkey>,
) -> Result<()> {
    validate_members(&members)?;

    let governance = &mut ctx.accounts.governance;
    governance.authority = ctx.accounts.authority.key();
    governance.members = members;
    governance.proposal_count = 0;
    governance.active_proposal_id = 0;

    msg!("Governance initialized, members={}", governance.members.len());
    Ok(())
}

/// Обновление списка members. Только authority.
#[derive(Accounts)]
pub struct UpdateMembers<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump,
        has_one = authority @ ErrorCode::NotGovernanceAuthority
    )]
    pub governance: Account<'info, GovernanceState>,

    pub authority: Signer<'info>,
}

pub fn update_members(
    ctx: Context<UpdateMembers>,
    members: Vec<Pubkey>,
) -> Result<()> {
    validate_members(&members)?;

    let governance = &mut ctx.accounts.governance;
    governance.members = members;

    msg!("Governance members updated to {}", governance.members.len());
    Ok(())
}

/// Создание предложения (PDA [b"proposal", id]). Только authority.
///
/// Одно активное предложение в момент времени: если active_proposal_id != 0,
/// клиент передаёт предыдущее предложение (`prev_proposal`, адрес вычисляется
/// через [b"proposal", active_proposal_id]) — оно помечается Cancelled.
#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateProposal<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump,
        has_one = authority @ ErrorCode::NotGovernanceAuthority
    )]
    pub governance: Account<'info, GovernanceState>,

    /// Предыдущее активное предложение (передаётся при существующем активном).
    #[account(mut)]
    pub prev_proposal: Option<Account<'info, Proposal>>,

    #[account(
        init,
        payer = authority,
        space = 8 + Proposal::LEN,
        seeds = [b"proposal", id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn create_proposal(
    ctx: Context<CreateProposal>,
    id: u64,
    title: String,
    amount_atomic: u64,
    destination: Pubkey,
) -> Result<()> {
    let governance = &mut ctx.accounts.governance;

    // id обязан быть следующим (монотонный счётчик).
    let expected_id = next_proposal_id(governance.proposal_count)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(id == expected_id, ErrorCode::InvalidParameter);

    // Лимит эмиссии (атомарные единицы).
    validate_amount_atomic(amount_atomic)?;
    require!(
        title.len() <= PROPOSAL_TITLE_MAX_LEN,
        ErrorCode::InvalidParameter
    );

    // Одно активное предложение: при наличии активного клиент обязан передать
    // prev_proposal (cancel). Иначе — коллизия.
    let prev_provided = ctx.accounts.prev_proposal.is_some();
    require_no_collision(governance.active_proposal_id, prev_provided)?;

    if governance.active_proposal_id != 0 {
        let prev = ctx
            .accounts
            .prev_proposal
            .as_mut()
            .ok_or(ErrorCode::ProposalNotFound)?;
        let seed = governance.active_proposal_id.to_le_bytes();
        let (expected, _) =
            Pubkey::find_program_address(&[b"proposal", seed.as_ref()], ctx.program_id);
        require!(prev.key() == expected, ErrorCode::InvalidParameter);
        require!(prev.status == ProposalStatus::Pending, ErrorCode::ProposalNotActive);
        prev.status = ProposalStatus::Cancelled;
    }

    let proposal = &mut ctx.accounts.proposal;
    proposal.id = id;
    proposal.proposer = ctx.accounts.authority.key();
    proposal.title = title;
    proposal.amount_atomic = amount_atomic;
    proposal.destination = destination;
    proposal.status = ProposalStatus::Pending;
    proposal.created_at = Clock::get()?.unix_timestamp;
    proposal.approved_at = 0;
    proposal.executed_at = 0;
    proposal.yes_votes = 0;
    proposal.no_votes = 0;
    proposal.member_snapshot_count = governance.members.len() as u32;
    proposal.voted_members = Vec::new();

    governance.proposal_count = id;
    governance.active_proposal_id = id;

    msg!("Proposal #{} created (amount={})", id, amount_atomic);
    Ok(())
}

/// Голосование по активному предложению. Только member; один голос на member.
///
/// После каждого голоса проверяется кворум: `yes > no` И `yes+no > members/2`
/// (от снапшота) → Approved + фиксируется approved_at. Если проголосовали все
/// и кворума нет → Rejected.
#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct Vote<'info> {
    #[account(
        mut,
        seeds = [b"governance"],
        bump
    )]
    pub governance: Account<'info, GovernanceState>,

    #[account(
        mut,
        seeds = [b"proposal", proposal_id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    pub voter: Signer<'info>,
}

pub fn vote(
    ctx: Context<Vote>,
    proposal_id: u64,
    yes: bool,
) -> Result<()> {
    let governance = &mut ctx.accounts.governance;
    let proposal = &mut ctx.accounts.proposal;

    // Только member.
    require!(
        governance.is_member(&ctx.accounts.voter.key()),
        ErrorCode::NotGovernanceMember
    );
    // Должно быть активное предложение и именно это.
    require!(
        governance.active_proposal_id != 0,
        ErrorCode::NoActiveProposal
    );
    require!(
        governance.active_proposal_id == proposal_id,
        ErrorCode::ProposalNotActive
    );
    // Предложение в процессе голосования.
    require!(
        proposal.status == ProposalStatus::Pending,
        ErrorCode::ProposalNotActive
    );
    // Однократное голосование.
    require!(
        !proposal.has_voted(&ctx.accounts.voter.key()),
        ErrorCode::MemberAlreadyVoted
    );

    let voter = ctx.accounts.voter.key();
    if yes {
        proposal.yes_votes = proposal
            .yes_votes
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    } else {
        proposal.no_votes = proposal
            .no_votes
            .checked_add(1)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
    }
    proposal.voted_members.push(voter);

    if proposal.quorum_met() {
        proposal.status = ProposalStatus::Approved;
        proposal.approved_at = Clock::get()?.unix_timestamp;
        governance.active_proposal_id = 0;
        msg!("Proposal #{} approved", proposal_id);
    } else if proposal.all_voted() {
        proposal.status = ProposalStatus::Rejected;
        governance.active_proposal_id = 0;
        msg!("Proposal #{} rejected (no quorum)", proposal_id);
    }

    Ok(())
}


/// Исполнение одобренного предложения после TIMELOCK_DELAY: mint через
/// Mint Authority PDA на ATA получателя + засчёт в vault.total_supply.
///
/// Mint-authority остаётся PDA [b"mint-authority"] (не меняется). Эмиссия
/// возможна ТОЛЬКО после Approved + истёкшего timelock.
#[derive(Accounts)]
#[instruction(proposal_id: u64)]
pub struct GovernanceMint<'info> {
    #[account(
        seeds = [b"governance"],
        bump
    )]
    pub governance: Account<'info, GovernanceState>,

    #[account(
        mut,
        seeds = [b"proposal", proposal_id.to_le_bytes().as_ref()],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    /// Vault PDA — total_supply/max_supply.
    #[account(
        mut,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    /// TokenMint PDA — конфигурация токена.
    #[account(
        seeds = [b"token-mint"],
        bump = token_mint.bump
    )]
    pub token_mint: Box<Account<'info, TokenMint>>,

    /// SRC Mint (writable — CPI token::mint_to увеличивает supply).
    #[account(
        mut,
        seeds = [b"src-mint"],
        bump = token_mint.mint_bump,
        constraint = mint.key() == token_mint.mint @ ErrorCode::InvalidParameter
    )]
    pub mint: Box<Account<'info, Mint>>,

    /// CHECK: Mint Authority PDA — signer для token::mint_to (seeds).
    #[account(
        seeds = [b"mint-authority"],
        bump = token_mint.mint_authority_bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// ATA получателя: тот же mint, владелец == proposer.
    #[account(
        mut,
        constraint = destination.mint == mint.key() @ ErrorCode::DestinationMintMismatch,
        constraint = destination.owner == proposal.proposer @ ErrorCode::Unauthorized
    )]
    pub destination: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn governance_mint(
    ctx: Context<GovernanceMint>,
    proposal_id: u64,
) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;

    require!(
        proposal.id == proposal_id,
        ErrorCode::InvalidParameter
    );
    require!(
        proposal.status == ProposalStatus::Approved,
        ErrorCode::ProposalNotApproved
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        proposal.executable(now),
        ErrorCode::TimelockNotElapsed
    );

    // Лимит эмиссии (атомарные единицы; total_supply + amount <= MAX).
    let vault = &mut ctx.accounts.vault;
    let new_supply = vault
        .total_supply
        .checked_add(proposal.amount_atomic)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        new_supply <= vault.max_supply,
        ErrorCode::SupplyLimitExceeded
    );

    // Реальный mint_to через Mint Authority PDA.
    let mint_authority_bump = ctx.accounts.token_mint.mint_authority_bump;
    let signer_seeds: &[&[u8]] = &[b"mint-authority".as_ref(), &[mint_authority_bump]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            &[signer_seeds],
        ),
        proposal.amount_atomic,
    )?;

    vault.total_supply = new_supply;
    proposal.status = ProposalStatus::Executed;
    proposal.executed_at = now;

    msg!(
        "Proposal #{} executed: minted {} atomic to {}",
        proposal_id,
        proposal.amount_atomic,
        ctx.accounts.destination.key()
    );

    Ok(())
}

