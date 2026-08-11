use anchor_lang::prelude::*;

use crate::constants::MAX_CLOCK_SKEW;
use crate::error::ErrorCode;
use crate::state::EnergyProducer;

/// Максимальный «возраст» доказательства.
pub const MAX_PROOF_AGE: i64 = 31_536_000;

/// Проверка nonce производителя (строго возрастающий — защита от replay).
pub fn verify_nonce(producer: &EnergyProducer, nonce: u64) -> Result<()> {
    require!(nonce > producer.nonce, ErrorCode::InvalidNonce);
    Ok(())
}

/// Проверка временной метки:
/// - метка не должна быть в будущем (допускается только отклонение часов MAX_CLOCK_SKEW);
/// - метка не должна быть старше MAX_PROOF_AGE.
pub fn verify_timestamp(now: i64, timestamp: i64) -> Result<()> {
    require!(
        timestamp <= now + MAX_CLOCK_SKEW,
        ErrorCode::FutureTimestamp
    );
    require!(now - timestamp <= MAX_PROOF_AGE, ErrorCode::StaleProof);
    Ok(())
}

