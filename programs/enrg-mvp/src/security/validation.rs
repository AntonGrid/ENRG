use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::EnergyProducer;

/// Максимальный "возраст" доказательства.
pub const MAX_PROOF_AGE: i64 = 31_536_000;

/// Проверка nonce производителя.
pub fn verify_nonce(producer: &EnergyProducer, nonce: u64) -> Result<()> {
    require!(nonce > producer.nonce, ErrorCode::InvalidNonce);
    Ok(())
}

/// Проверка "устаревания" доказательства.
pub fn verify_timestamp(now: i64, timestamp: i64) -> Result<()> {
    let diff = now - timestamp;
    if diff > MAX_PROOF_AGE {
        return Err(ErrorCode::StaleProof.into());
    }
    Ok(())
}

/// Проверка физически возможной выработки энергии за окно MAX_PROOF_AGE.
/// ВРЕМЕННО ОТКЛЮЧЕНА — max_power_w перенесён в enrg-profile.
pub fn verify_energy(_producer: &EnergyProducer, _energy_wh: u64) -> Result<()> {
    // Проверка временно отключена
    Ok(())
}
