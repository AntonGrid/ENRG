use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::constants::*;

#[derive(Debug, Clone)]
pub struct EmissionResult {
    pub reward: u64,
    pub producer: u64,
    pub buyback: u64,
    pub staking: u64,
    pub dao: u64,
    pub emergency: u64,
}

pub fn calculate_distribution(
    reward: u64,
) -> Result<EmissionResult> {

    require!(
        reward > 0,
        ErrorCode::ZeroAmountMint
    );

    let commission = reward
        .checked_mul(COMMISSION_PERCENT)
        .ok_or(ErrorCode::ArithmeticOverflow)?
        / 100;

    let producer = reward
        .checked_sub(commission)
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    let buyback = commission * BUYBACK_PERCENT / 100;
    let staking = commission * STAKING_PERCENT / 100;
    let dao = commission * DAO_PERCENT / 100;

    let emergency = commission
        .checked_sub(
            buyback + staking + dao,
        )
        .ok_or(ErrorCode::ArithmeticOverflow)?;

    Ok(
        EmissionResult {
            reward,
            producer,
            buyback,
            staking,
            dao,
            emergency,
        }
    )
}
