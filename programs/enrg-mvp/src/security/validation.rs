use anchor_lang::prelude::*;

use crate::constants::MAX_CLOCK_SKEW;
use crate::error::ErrorCode;
use crate::state::EnergyProducer;

/// Максимальный «возраст» доказательства.
/// M-3: было 31_536_000 (1 год) — теперь 15 минут, как требует спецификация
/// (см. docs «не старше 15 минут»). Синхронизировано с server.js (MAX_PROOF_AGE_SEC).
pub const MAX_PROOF_AGE: i64 = 900;

/// Проверка nonce производителя (строго возрастающий — защита от replay).
pub fn verify_nonce(producer: &EnergyProducer, nonce: u64) -> Result<()> {
    require!(nonce > producer.nonce, ErrorCode::InvalidNonce);
    Ok(())
}

/// Проверка временной метки:
/// - метка не должна быть в будущем (допускается только отклонение часов MAX_CLOCK_SKEW);
/// - метка не должна быть старше MAX_PROOF_AGE.
pub fn verify_timestamp(now: i64, timestamp: i64) -> Result<()> {
    verify_timestamp_with_skew(now, timestamp, MAX_CLOCK_SKEW)
}

/// Проверка временной метки с параметризуемым допустимым сдвигом часов
/// (используется Policy Engine, ADR-0003).
pub fn verify_timestamp_with_skew(
    now: i64,
    timestamp: i64,
    max_clock_skew: i64,
) -> Result<()> {
    require!(
        timestamp <= now + max_clock_skew,
        ErrorCode::FutureTimestamp
    );
    require!(now - timestamp <= MAX_PROOF_AGE, ErrorCode::StaleProof);
    Ok(())
}

