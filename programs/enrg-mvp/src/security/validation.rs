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

/// Bind the DEVICE clock to the ORACLE's verification stamp (audit 2026-09-16).
///
/// `device_timestamp` is written by the device and was previously bound only by the
/// device signature: a device could anchor its proof to 1970 or 2035 and the mint
/// still passed, while every UI derives "production today" from this field.
///
/// Both values come from the same report, so this does **not** depend on when the mint
/// is submitted — a proof may legitimately be minted later (retry queue, drain after a
/// restart) and its freshness *at mint time* is already enforced through `verified_at`.
/// Anchoring the device clock to the mint time instead would reject those queued mints.
///
/// - the device must not claim an event *after* the oracle verified it (beyond the
///   allowed skew) → `FutureTimestamp`;
/// - the oracle must not have verified the report more than `MAX_PROOF_AGE` after the
///   event it describes → `StaleProof`.
///
/// The live pilot measures `verified_at - device_timestamp` = 1..3 s (NTP-synced ESP32).
pub fn verify_device_clock(
    device_timestamp: i64,
    verified_at: i64,
    max_clock_skew: i64,
) -> Result<()> {
    require!(
        device_timestamp <= verified_at + max_clock_skew,
        ErrorCode::FutureTimestamp
    );
    require!(
        verified_at - device_timestamp <= MAX_PROOF_AGE,
        ErrorCode::StaleProof
    );
    Ok(())
}

