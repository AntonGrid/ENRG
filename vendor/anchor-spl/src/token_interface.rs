// token_interface shim module.
//
// Anchor-syn 0.32.1 UNCONDITIONALLY generates paths
// `::anchor_spl::token_interface::{InitializeMint2, initialize_mint2,
// InitializeAccount3, initialize_account3, ExtensionsVec,
// find_mint_account_size, spl_token_2022::extension::ExtensionType,
// group_pointer_initialize, ...}` for mint/token constraints,
// even when no extensions are specified.
//
// The original `token_interface` depends on spl-token-2022 and pulls in
// solana-zk-sdk → aes-gcm-siv → spl-pod → crypto-common 0.1.7,
// which monomorphizes SerializableState for huge arrays
// ([u16; 2048], [u32; 2048], [u64; 1024] ...) and blows the 4096 stack limit.
//
// This shim re-exports the classic SPL Token (spl-token) at the same paths
// and provides non-executable stubs for the spl-token-2022 extension API,
// so the generated code compiles without depending on spl-token-2022.
//
// IMPORTANT: spl-token-2022 extensions are not supported here — specifying
// mint extensions (group_pointer, transfer_hook, etc.) makes the program
// fail immediately. For the classic SPL Token (as in ENRG) this is unreachable
// because the extension list is always empty.

use anchor_lang::solana_program::account_info::AccountInfo;
use anchor_lang::solana_program::pubkey::Pubkey;
use anchor_lang::Result;
use anchor_lang::{context::CpiContext, Accounts};

#[cfg(not(feature = "token_2022"))]
pub use crate::token::*;

#[cfg(feature = "token_2022")]
pub use crate::token_2022::*;

// ─────────────────────────────────────────────────────────────────────────────
// spl-token-2022 extension API stubs (only to compile the generated
// code). Never invoked when extensions are unused.
// ─────────────────────────────────────────────────────────────────────────────

/// Stub of the `ExtensionType` type from spl-token-2022.
///
/// `match` in the generated code requires a Debug implementation for `{e:?}`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ExtensionType {
    GroupPointer,
    GroupMemberPointer,
    MetadataPointer,
    MintCloseAuthority,
    TransferHook,
    NonTransferable,
    PermanentDelegate,
}

/// Mint extension list (an analog of spl-pod `ExtensionsVec`).
pub type ExtensionsVec = Vec<ExtensionType>;

/// spl-token-2022 path (stub). The real spl-token-2022 is not wired in.
pub mod spl_token_2022 {
    pub mod extension {
        pub use crate::token_interface::ExtensionType;
    }
}

/// Compute the mint size including extensions.
///
/// Extensions are unsupported for the classic SPL Token: if the list
/// is non-empty — return an error (in ENRG the list is always empty).
pub fn find_mint_account_size(extensions: Option<&ExtensionsVec>) -> Result<usize> {
    if let Some(exts) = extensions {
        if !exts.is_empty() {
            return Err(anchor_lang::error::ErrorCode::RequireViolated.into());
        }
    }
    Ok(crate::token::Mint::LEN)
}

/// Stub: group pointer initialization (unsupported).
pub fn group_pointer_initialize<'info>(
    _ctx: CpiContext<'_, '_, '_, 'info, GroupPointerInitialize<'info>>,
    _authority: Option<Pubkey>,
    _group_address: Option<Pubkey>,
) -> Result<()> {
    Err(anchor_lang::error::ErrorCode::RequireViolated.into())
}

#[derive(Accounts)]
pub struct GroupPointerInitialize<'info> {
    pub token_program_id: AccountInfo<'info>,
    pub mint: AccountInfo<'info>,
}

/// Stub: group member pointer initialization (unsupported).
pub fn group_member_pointer_initialize<'info>(
    _ctx: CpiContext<'_, '_, '_, 'info, GroupMemberPointerInitialize<'info>>,
    _authority: Option<Pubkey>,
    _member_address: Option<Pubkey>,
) -> Result<()> {
    Err(anchor_lang::error::ErrorCode::RequireViolated.into())
}

#[derive(Accounts)]
pub struct GroupMemberPointerInitialize<'info> {
    pub token_program_id: AccountInfo<'info>,
    pub mint: AccountInfo<'info>,
}

/// Stub: metadata pointer initialization (unsupported).
pub fn metadata_pointer_initialize<'info>(
    _ctx: CpiContext<'_, '_, '_, 'info, MetadataPointerInitialize<'info>>,
    _authority: Option<Pubkey>,
    _metadata_address: Option<Pubkey>,
) -> Result<()> {
    Err(anchor_lang::error::ErrorCode::RequireViolated.into())
}

#[derive(Accounts)]
pub struct MetadataPointerInitialize<'info> {
    pub token_program_id: AccountInfo<'info>,
    pub mint: AccountInfo<'info>,
}

/// Stub: close authority initialization (unsupported).
pub fn mint_close_authority_initialize<'info>(
    _ctx: CpiContext<'_, '_, '_, 'info, MintCloseAuthorityInitialize<'info>>,
    _close_authority: Option<&Pubkey>,
) -> Result<()> {
    Err(anchor_lang::error::ErrorCode::RequireViolated.into())
}

#[derive(Accounts)]
pub struct MintCloseAuthorityInitialize<'info> {
    pub token_program_id: AccountInfo<'info>,
    pub mint: AccountInfo<'info>,
}

/// Stub: transfer hook initialization (unsupported).
pub fn transfer_hook_initialize<'info>(
    _ctx: CpiContext<'_, '_, '_, 'info, TransferHookInitialize<'info>>,
    _authority: Option<Pubkey>,
    _program_id: Option<Pubkey>,
) -> Result<()> {
    Err(anchor_lang::error::ErrorCode::RequireViolated.into())
}

#[derive(Accounts)]
pub struct TransferHookInitialize<'info> {
    pub token_program_id: AccountInfo<'info>,
    pub mint: AccountInfo<'info>,
}

/// Stub: non-transferable mint initialization (unsupported).
pub fn non_transferable_mint_initialize<'info>(
    _ctx: CpiContext<'_, '_, '_, 'info, NonTransferableMintInitialize<'info>>,
) -> Result<()> {
    Err(anchor_lang::error::ErrorCode::RequireViolated.into())
}

#[derive(Accounts)]
pub struct NonTransferableMintInitialize<'info> {
    pub token_program_id: AccountInfo<'info>,
    pub mint: AccountInfo<'info>,
}

/// Stub: permanent delegate initialization (unsupported).
pub fn permanent_delegate_initialize<'info>(
    _ctx: CpiContext<'_, '_, '_, 'info, PermanentDelegateInitialize<'info>>,
    _permanent_delegate: &Pubkey,
) -> Result<()> {
    Err(anchor_lang::error::ErrorCode::RequireViolated.into())
}

#[derive(Accounts)]
pub struct PermanentDelegateInitialize<'info> {
    pub token_program_id: AccountInfo<'info>,
    pub mint: AccountInfo<'info>,
}