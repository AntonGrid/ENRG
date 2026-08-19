use anchor_lang::prelude::*;

use crate::constants::MAX_CLOCK_SKEW;
use crate::error::ErrorCode;
use crate::state::EnergyProducer;

/// Maximum proof "age".
/// M-3: was 31_536_000 (1 year) — now 15 minutes, as required by the spec
/// (see docs "no older than 15 minutes"). Synced with server.js (MAX_PROOF_AGE_SEC).
pub const MAX_PROOF_AGE: i64 = 900;

/// Producer nonce check (strictly increasing — replay protection).
pub fn verify_nonce(producer: &EnergyProducer, nonce: u64) -> Result<()> {
    require!(nonce > producer.nonce, ErrorCode::InvalidNonce);
    Ok(())
}

/// Timestamp check:
/// - the timestamp must not be in the future (only a clock skew of MAX_CLOCK_SKEW is allowed);
/// - the timestamp must not be older than MAX_PROOF_AGE.
pub fn verify_timestamp(now: i64, timestamp: i64) -> Result<()> {
    verify_timestamp_with_skew(now, timestamp, MAX_CLOCK_SKEW)
}

/// Timestamp check with a parameterized allowed clock skew
/// (used by the Policy Engine, ADR-0003).
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

