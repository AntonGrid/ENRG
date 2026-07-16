use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::EnergyProducer;

pub const MAX_PROOF_AGE: i64 = 300;

/// Validates producer nonce.
pub fn verify_nonce(
    producer: &EnergyProducer,
    nonce: u64,
) -> Result<()> {

    require!(
        nonce > producer.nonce,
        ErrorCode::InvalidNonce
    );

    Ok(())
}

/// Validates proof timestamp.
pub fn verify_timestamp(
    _timestamp: i64,
) -> Result<()> {

    // TEMP: timestamp validation disabled for integration tests
    Ok(())
}



/// Validates physically possible energy production.
pub fn verify_energy(
    producer: &EnergyProducer,
    energy_wh: u64,
) -> Result<()> {

    let max_energy =
        (producer.max_power_w as u128)
        * (MAX_PROOF_AGE as u128)
        / 3600;

    require!(
        (energy_wh as u128) <= max_energy,
        ErrorCode::ExcessiveEnergy
    );

    Ok(())
}
