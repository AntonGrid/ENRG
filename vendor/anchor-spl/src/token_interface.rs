// Shim-модуль token_interface.
//
// Anchor-syn 0.32.1 БЕЗУСЛОВНО генерирует пути
// `::anchor_spl::token_interface::{InitializeMint2, initialize_mint2,
// InitializeAccount3, initialize_account3, ExtensionsVec,
// find_mint_account_size, spl_token_2022::extension::ExtensionType,
// group_pointer_initialize, ...}` для mint/token constraint-ов,
// даже когда ни одно расширение не указано.
//
// Оригинальный `token_interface` завязан на spl-token-2022 и тянет
// solana-zk-sdk → aes-gcm-siv → spl-pod → crypto-common 0.1.7,
// который мономорфизирует SerializableState для огромных массивов
// ([u16; 2048], [u32; 2048], [u64; 1024] ...) и ломает лимит стека 4096.
//
// Этот shim реэкспортирует классический SPL Token (spl-token) по тем же путям
// и предоставляет неисполняемые заглушки для spl-token-2022 extension API,
// чтобы сгенерированный код компилировался без подключения spl-token-2022.
//
// ВАЖНО: расширения spl-token-2022 здесь не поддерживаются — при указании
// mint-расширений (group_pointer, transfer_hook и т.п.) программа сразу
// вернёт ошибку. Для классического SPL Token (как в ENRG) это недостижимо,
// поскольку список расширений всегда пуст.

use anchor_lang::solana_program::account_info::AccountInfo;
use anchor_lang::solana_program::pubkey::Pubkey;
use anchor_lang::Result;
use anchor_lang::{context::CpiContext, Accounts};

#[cfg(not(feature = "token_2022"))]
pub use crate::token::*;

#[cfg(feature = "token_2022")]
pub use crate::token_2022::*;

// ─────────────────────────────────────────────────────────────────────────────
// Заглушки spl-token-2022 extension API (только для компиляции сгенерированного
// кода). Никогда не вызываются, когда расширения не используются.
// ─────────────────────────────────────────────────────────────────────────────

/// Заглушка типа `ExtensionType` из spl-token-2022.
///
/// `match` в сгенерированном коде требует Debug-реализации для `{e:?}`.
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

/// Список расширений mint (аналог spl-pod `ExtensionsVec`).
pub type ExtensionsVec = Vec<ExtensionType>;

/// Путь к spl-token-2022 (заглушка). Настоящий spl-token-2022 не подключён.
pub mod spl_token_2022 {
    pub mod extension {
        pub use crate::token_interface::ExtensionType;
    }
}

/// Рассчитать размер mint с учётом расширений.
///
/// Для классического SPL Token расширения не поддерживаются: если список
/// непустой — возвращаем ошибку (в ENRG список всегда пуст).
pub fn find_mint_account_size(extensions: Option<&ExtensionsVec>) -> Result<usize> {
    if let Some(exts) = extensions {
        if !exts.is_empty() {
            return Err(anchor_lang::error::ErrorCode::RequireViolated.into());
        }
    }
    Ok(crate::token::Mint::LEN)
}

/// Заглушка: инициализация group pointer (не поддерживается).
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

/// Заглушка: инициализация group member pointer (не поддерживается).
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

/// Заглушка: инициализация metadata pointer (не поддерживается).
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

/// Заглушка: инициализация close authority (не поддерживается).
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

/// Заглушка: инициализация transfer hook (не поддерживается).
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

/// Заглушка: инициализация non-transferable mint (не поддерживается).
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

/// Заглушка: инициализация permanent delegate (не поддерживается).
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