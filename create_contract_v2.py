from pathlib import Path
import shutil

ROOT = Path.home() / "ENRG" / "programs" / "enrg-mvp" / "src"

(ROOT / "instructions").mkdir(parents=True, exist_ok=True)
(ROOT / "state").mkdir(parents=True, exist_ok=True)
(ROOT / "types").mkdir(parents=True, exist_ok=True)


def write(rel_path: str, content: str):
    path = ROOT / rel_path

    if path.exists():
        backup = path.with_suffix(path.suffix + ".bak")
        shutil.copy2(path, backup)
        print(f"Backup: {backup}")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.strip() + "\n", encoding="utf-8")
    print(f"Created: {path}")


write(
    "constants.rs",
    """
pub const ENRG_DECIMALS: u8 = 9;

pub const ENRG_BASIS: u64 =
    10u64.pow(ENRG_DECIMALS as u32 - 6);

pub const COMMISSION_PERCENT: u64 = 15;
pub const BUYBACK_PERCENT: u64 = 20;
pub const STAKING_PERCENT: u64 = 40;
pub const DAO_PERCENT: u64 = 30;

pub const MAX_SUPPLY: u64 =
    1_000_000_000;

pub const EMISSION_DIFFICULTY_K: u64 = 10;

pub const ENERGY_PER_TOKEN_BASE: u64 =
    1_000_000;

pub const DEFAULT_POOL_THRESHOLD: u128 =
    1_000_000;
""",
)

write(
    "error.rs",
    """
use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {

    #[msg("Unauthorized signer")]
    Unauthorized,

    #[msg("Proof is too old")]
    StaleProof,

    #[msg("Invalid Ed25519 signature")]
    InvalidSignature,

    #[msg("Energy reading exceeds maximum allowed for device power rating")]
    ExcessiveEnergy,

    #[msg("Nonce must be greater than previous nonce")]
    InvalidNonce,

    #[msg("Insufficient stake to withdraw")]
    InsufficientStake,

    #[msg("No staked amount or staking pool empty")]
    NoStake,

    #[msg("1-year cliff period has not passed")]
    CliffNotReached,

    #[msg("No vested tokens available to claim at this time")]
    NothingToClaim,

    #[msg("Arithmetic overflow occurred")]
    ArithmeticOverflow,

    #[msg("Mint amount must be greater than zero")]
    ZeroAmountMint,

    #[msg("Invalid parameter")]
    InvalidParameter,

    #[msg("Excessive energy required")]
    ExcessiveEnergyRequired,

    #[msg("Insufficient energy")]
    InsufficientEnergy,

    #[msg("Maximum supply reached")]
    MaxSupplyReached,

    #[msg("Producer already belongs to pool")]
    AlreadyInPool,
}
""",
)

write(
    "math.rs",
    """
pub fn placeholder() {
}
""",
)

write(
    "types/mod.rs",
    """
pub use crate::state::proof::*;
""",
)

print()
print("Contract V2 bootstrap complete.")
