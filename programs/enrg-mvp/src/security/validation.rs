use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::EnergyProducer;

/// Максимальный "возраст" доказательства.
/// Сейчас для dev/test оставляем большое окно: 1 год (~31.5M секунд).
/// Для прод-режима это значение должно быть существенно уменьшено
/// (например, до нескольких минут/часов).
pub const MAX_PROOF_AGE: i64 = 31_536_000;

/// Проверка nonce производителя (MVP).
///
/// Сейчас:
/// - допускаем неубывающий nonce: nonce >= producer.nonce;
/// - это даёт защиту от простого "отката" и повторной подачи старых отчётов,
///   но теоретически позволяет "залипнуть" на одном и том же nonce.
///
/// Для прод-режима:
/// - это место нужно ужесточить до строгого роста:
///     require!(nonce > producer.nonce, ErrorCode::InvalidNonce);
pub fn verify_nonce(producer: &EnergyProducer, nonce: u64) -> Result<()> {
    require!(nonce >= producer.nonce, ErrorCode::InvalidNonce);
    Ok(())
}

/// Проверка "устаревания" доказательства.
///
/// Модель:
/// - now = текущий on-chain Clock::get().unix_timestamp.
/// - timestamp = время на стороне устройства/оракула.
/// - если отчёт старше MAX_PROOF_AGE относительно now → StaleProof.
/// - отчёты "из будущего" (timestamp > now) на этом этапе не режем,
///   так как возможна рассинхронизация часов.
///   При переходе в прод это место можно ужесточить.
pub fn verify_timestamp(now: i64, timestamp: i64) -> Result<()> {
    let diff = now - timestamp;

    if diff > MAX_PROOF_AGE {
        return Err(ErrorCode::StaleProof.into());
    }

    Ok(())
}

/// Проверка физически возможной выработки энергии за окно MAX_PROOF_AGE.
///
/// Ограничение сверху:
///   energy_wh <= max_power_w * MAX_PROOF_AGE / 3600
pub fn verify_energy(producer: &EnergyProducer, energy_wh: u64) -> Result<()> {
    let max_energy = (producer.max_power_w as u128) * (MAX_PROOF_AGE as u128) / 3600;

    require!((energy_wh as u128) <= max_energy, ErrorCode::ExcessiveEnergy);

    Ok(())
}
