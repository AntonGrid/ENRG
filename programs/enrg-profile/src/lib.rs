use anchor_lang::prelude::*;

pub mod state;

use state::EnergyProfile;

declare_id!("78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt");

/// Re-export generated CPI module for external programs.
pub use self::enrg_profile::*;

/// Максимальная номинальная мощность устройства (Вт).
///
/// Верхняя граница rated_power — защита от манипуляций (BLOCK 4 аудита):
/// без неё владелец мог бы выставить произвольно большую мощность и тем
/// самым завысить потолок mint (enrg-mvp::mint_energy сверяет
/// `report.energy_wh <= profile.rated_power`).
/// M-4: снижено со 100 ГВт до 1 МВт (1_000_000 Вт) — для неподтверждённых
/// устройств потолок одного отчёта теперь ≤ 1 МВт·ч. Подтверждённые профили
/// с более высокой мощностью требуют отдельной процедуры верификации/апгрейда.
pub const MAX_RATED_POWER: u64 = 1_000_000; // 1 MW

/// Обновляет скользящее окно энергии устройства (30-дневное окно).
/// Вычитает энергию, которая вышла за пределы окна, и добавляет новую.
fn update_energy_window_u128(
    current_window: u128,
    last_updated_at: i64,
    now: i64,
    new_energy: u128,
) -> u128 {
    const THIRTY_DAYS_SECONDS: i64 = 30 * 24 * 60 * 60;

    let elapsed = now - last_updated_at;

    if elapsed <= 0 {
        // Время не ушло вперёд — просто добавляем
        return current_window.saturating_add(new_energy);
    }

    if elapsed >= THIRTY_DAYS_SECONDS {
        // Прошло больше 30 дней — окно полностью сбрасывается
        return new_energy;
    }

    // Пропорциональное уменьшение старого окна
    let decay = (current_window as u128)
        .saturating_mul(elapsed as u128)
        .saturating_div(THIRTY_DAYS_SECONDS as u128);

    let remaining = current_window.saturating_sub(decay);
    remaining.saturating_add(new_energy)
}

#[program]
pub mod enrg_profile {
    use super::*;

    /// Создаёт PDA EnergyProfile для указанного authority.
    ///
    /// Seeds: [b"profile", authority.key().as_ref()]
    pub fn initialize_profile(
        ctx: Context<InitializeProfile>,
        device_id: Pubkey,
        rated_power: u64,
        device_type: String,
        location: String,
    ) -> Result<()> {
        require!(
            device_type.len() <= EnergyProfile::MAX_DEVICE_TYPE_LEN,
            ErrorCode::DeviceTypeTooLong
        );
        require!(
            location.len() <= EnergyProfile::MAX_LOCATION_LEN,
            ErrorCode::LocationTooLong
        );
        require!(
            rated_power <= MAX_RATED_POWER,
            ErrorCode::RatedPowerTooHigh
        );

        let profile = &mut ctx.accounts.profile;
        profile.authority = ctx.accounts.authority.key();
        profile.device_id = device_id;
        profile.rated_power = rated_power;
        profile.device_type = device_type;
        profile.location = location;
        profile.device_energy_30d = 0;
        profile.device_energy_updated_at = Clock::get()?.unix_timestamp;
        profile.bump = ctx.bumps.profile;

        Ok(())
    }

    /// Обновляет метаданные устройства (rated_power, device_type, location).
    /// Может вызывать только authority профиля.
    ///
    /// M-4: rated_power ИММУТАБЕЛЕН после первого назначения — владелец не может
    /// «поднять себе потолок» минта. Изменение возможно только через процедуру
    /// верификации/апгрейда (вне рамок MVP; требует upgrade-инструкции с
    /// governance-контролем). Изменение фиксируется событием RatedPowerChanged.
    pub fn update_metadata(
        ctx: Context<UpdateMetadata>,
        rated_power: u64,
        device_type: String,
        location: String,
    ) -> Result<()> {
        require!(
            device_type.len() <= EnergyProfile::MAX_DEVICE_TYPE_LEN,
            ErrorCode::DeviceTypeTooLong
        );
        require!(
            location.len() <= EnergyProfile::MAX_LOCATION_LEN,
            ErrorCode::LocationTooLong
        );
        require!(
            rated_power <= MAX_RATED_POWER,
            ErrorCode::RatedPowerTooHigh
        );

        let profile = &mut ctx.accounts.profile;

        // M-4: первый вызов (0 → N) задаёт мощность; любые последующие
        // изменения rated_power отклоняются (RatedPowerImmutable).
        let old_rated_power = profile.rated_power;
        if old_rated_power != 0 && rated_power != old_rated_power {
            return err!(ErrorCode::RatedPowerImmutable);
        }

        profile.rated_power = rated_power;
        profile.device_type = device_type;
        profile.location = location;

        if old_rated_power != profile.rated_power {
            emit!(RatedPowerChanged {
                profile: profile.key(),
                old_rated_power,
                new_rated_power: profile.rated_power,
                changed_by: ctx.accounts.authority.key(),
                timestamp: Clock::get()?.unix_timestamp,
            });
        }

        Ok(())
    }

    /// Записывает производство энергии в скользящее окно устройства.
    /// Вызывается CPI из enrg-mvp при каждом минте.
    pub fn record_production(
        ctx: Context<RecordProduction>,
        energy_wh: u64,
        timestamp: i64,
    ) -> Result<()> {
        let profile = &mut ctx.accounts.profile;

        profile.device_energy_30d = update_energy_window_u128(
            profile.device_energy_30d,
            profile.device_energy_updated_at,
            timestamp,
            energy_wh as u128,
        );
        profile.device_energy_updated_at = timestamp;

        msg!(
            "record_production: device_energy_30d={}",
            profile.device_energy_30d
        );

        Ok(())
    }

    /// View-функция для чтения профиля.
    /// Возвращает все поля EnergyProfile.
    pub fn read_profile(ctx: Context<ReadProfile>) -> Result<EnergyProfile> {
        let profile = &ctx.accounts.profile;
        Ok(EnergyProfile {
            authority: profile.authority,
            device_id: profile.device_id,
            rated_power: profile.rated_power,
            device_type: profile.device_type.clone(),
            location: profile.location.clone(),
            device_energy_30d: profile.device_energy_30d,
            device_energy_updated_at: profile.device_energy_updated_at,
            bump: profile.bump,
        })
    }
}

// ═══════════════════════════════════════════
//  Account validation structs
// ═══════════════════════════════════════════

#[derive(Accounts)]
pub struct InitializeProfile<'info> {
    /// Владелец профиля (подписывает транзакцию).
    #[account(mut)]
    pub authority: Signer<'info>,

    /// PDA EnergyProfile, создаётся с seeds [b"profile", authority.key().as_ref()].
    #[account(
        init,
        seeds = [b"profile", authority.key().as_ref()],
        bump,
        payer = authority,
        space = EnergyProfile::SIZE
    )]
    pub profile: Account<'info, EnergyProfile>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMetadata<'info> {
    /// Владелец профиля (подписывает транзакцию).
    pub authority: Signer<'info>,

    /// PDA EnergyProfile.
    #[account(
        mut,
        seeds = [b"profile", authority.key().as_ref()],
        bump = profile.bump
    )]
    pub profile: Account<'info, EnergyProfile>,
}

#[derive(Accounts)]
pub struct RecordProduction<'info> {
    /// Владелец профиля (authority) — подписывает CPI.
    pub authority: Signer<'info>,

    /// PDA EnergyProfile (mut для обновления скользящего окна).
    #[account(
        mut,
        seeds = [b"profile", authority.key().as_ref()],
        bump = profile.bump
    )]
    pub profile: Account<'info, EnergyProfile>,
}

#[derive(Accounts)]
pub struct ReadProfile<'info> {
    /// PDA EnergyProfile (только для чтения).
    #[account(
        seeds = [b"profile", authority.key().as_ref()],
        bump = profile.bump
    )]
    pub profile: Account<'info, EnergyProfile>,

    /// Authority, чей профиль читаем (не обязательно подписант).
    /// CHECK: используется только для derivation seeds.
    pub authority: UncheckedAccount<'info>,
}

// ═══════════════════════════════════════════
//  Error codes
// ═══════════════════════════════════════════

#[error_code]
pub enum ErrorCode {
    #[msg("Device type string exceeds maximum length (32 bytes)")]
    DeviceTypeTooLong,
    #[msg("Location string exceeds maximum length (64 bytes)")]
    LocationTooLong,
    #[msg("Rated power exceeds the maximum allowed (1 MW)")]
    RatedPowerTooHigh,
    // M-4: изменение rated_power после первого назначения запрещено
    // (только процедура верификации/апгрейда через governance).
    #[msg("Rated power is immutable after initial assignment")]
    RatedPowerImmutable,
}

// M-4: событие аудита изменения rated_power.
#[event]
pub struct RatedPowerChanged {
    pub profile: Pubkey,
    pub old_rated_power: u64,
    pub new_rated_power: u64,
    pub changed_by: Pubkey,
    pub timestamp: i64,
}