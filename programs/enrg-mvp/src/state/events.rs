use anchor_lang::prelude::*;

#[event]
pub struct EmissionDifficultyChanged {
    /// Current total supply.
    pub current_supply: u64,

    /// Supply expressed as a fraction of MAX_SUPPLY (scaled by 1e18).
    pub supply_fraction: u128,

    /// Current energy required for one ENRG token.
    pub energy_per_token: u128,
}
