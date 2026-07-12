use anchor_lang::prelude::*;

use crate::error::ErrorCode;

/// Distribution of newly minted SRC.
#[derive(Debug, Clone)]
pub struct RewardDistribution {
    pub producer: u64,
    pub buyback: u64,
    pub staking: u64,
    pub dao: u64,
    pub emergency: u64,
}

/// Calculates protocol distribution.
///
/// No token transfers are performed here.
/// This module is responsible only for
/// calculating token allocation.
pub fn calculate_distribution(
    reward: u64,
) -> Result<RewardDistribution> {

    require!(
        reward > 0,
        ErrorCode::ZeroAmountMint
    );

    let commission = reward
        .checked_mul(15)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        / 100;

    let producer = reward
        .checked_sub(commission)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let buyback = commission * 20 / 100;
    let staking = commission * 40 / 100;
    let dao = commission * 30 / 100;

    let emergency = commission
        .checked_sub(
            buyback + staking + dao,
        )
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    Ok(
        RewardDistribution {
            producer,
            buyback,
            staking,
            dao,
            emergency,
        }
    )
}
