use anchor_lang::prelude::*;

/// Per-owner device registry — counter of the owner's devices.
///
/// Seeds: [b"owner-devices", owner.key().as_ref()]
/// Created on the owner's first device claim (init_if_needed).
///
/// The active-devices-per-owner limit (audit BLOCK 4) protects against
/// device "fragmentation" — mass registration of small device_ids to
/// bypass limits or manipulate the economy.
#[account]
#[derive(InitSpace)]
pub struct OwnerDevices {
    /// Owner of the devices (wallet).
    pub owner: Pubkey,

    /// Total devices claimed by the owner of all time.
    pub total_claimed: u64,

    /// Current number of the owner's devices in the Active state.
    pub active_count: u64,
}
