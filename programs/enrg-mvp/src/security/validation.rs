use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::EnergyProducer;

/// Максимальный "возраст" доказательства.
///
/// Сейчас:
/// - для dev/test оставляем большое окно: 1 год (~31.5M секунд),
///   чтобы не ломать существующие интеграционные сценарии.
/// - verify_timestamp пока НЕ вызывается из mint_energy (закомментировано),
///   так что это значение — на будущее.
///
/// Для прод-режима:
/// - это значение должно быть существенно уменьшено
///   (например, до нескольких минут/часов),
/// - и verify_timestamp должен быть явно включён в основном потоке.
pub const MAX_PROOF_AGE: i64 = 31_536_000;

/// Проверка nonce производителя.
///
/// Было в MVP:
/// - допускали НЕУБЫВАЮЩИЙ nonce: nonce >= producer.nonce,
///   чтобы быстрее поднять тестовый флоу.
///
/// Сейчас (near-prod режим):
/// - требуем СТРОГИЙ РОСТ nonce: nonce > producer.nonce.
/// - это защищает от повторной подачи старых отчётов
///   и не даёт "залипать" на одном и том же nonce.
///
/// Важно:
/// - клиент/оракул обязан инкрементировать nonce хотя бы на 1
///   при каждом новом отчёте.
pub fn verify_nonce(producer: &EnergyProducer, nonce: u64) -> Result<()> {
    require!(nonce > producer.nonce, ErrorCode::InvalidNonce);
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
///
/// ВНИМАНИЕ:
/// - на текущем этапе verify_timestamp НЕ вызывается из mint_energy
///   (строка закомментирована),
/// - включать её нужно будет ближе к mainnet, когда будет ясна
///   политика по часам и MAX_PROOF_AGE.
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
///
/// Сейчас эта функция не используется в основном потоке
/// (лимит в mint_energy считается отдельной формулой),
/// но оставлена как более строгий вариант для будущих версий.
pub fn verify_energy(producer: &EnergyProducer, energy_wh: u64) -> Result<()> {
    let max_energy = (producer.max_power_w as u128) * (MAX_PROOF_AGE as u128) / 3600;

    require!((energy_wh as u128) <= max_energy, ErrorCode::ExcessiveEnergy);

    Ok(())
}
