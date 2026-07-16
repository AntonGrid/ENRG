use anchor_lang::prelude::*;

use crate::error::ErrorCode;

/// Ed25519 signature verify program ID on Solana.
///
/// Built-in program: Ed25519SigVerify111111111111111111111111111
const ED25519_PROGRAM_ID: [u8; 32] = [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b,
];

/// Verifies an Ed25519 signature using Solana's native ed25519 program.
///
/// MVP implementation: always succeeds (signature verification is skipped).
/// Will be replaced with real CPI to Ed25519SigVerify111111111111111111111111111
/// in a future iteration.
pub fn verify_ed25519_signature(
    _signature: &[u8; 64],
    _public_key: &[u8; 32],
    _message: &[u8],
) -> Result<()> {
    // MVP STUB: always pass
    #[cfg(not(feature = "ed25519-verify"))]
    {
        msg!("Ed25519 verification disabled (MVP stub)");
        return Ok(());
    }

    // ── Real verification (disabled for MVP) ──
    #[cfg(feature = "ed25519-verify")]
    {
        // Length checks
        require!(_signature.len() == 64, ErrorCode::InvalidSignatureLength);
        require!(_public_key.len() == 32, ErrorCode::InvalidPublicKeyLength);

        // Build the instruction data
        let pubkey_offset: u64 = 2 + 32;
        let sig_offset: u64 = pubkey_offset + 32;
        let msg_offset: u64 = sig_offset + 64;
        let msg_len: u64 = _message.len() as u64;

        let mut instruction_data = Vec::with_capacity(2 + 32 + 32 + 64 + _message.len());

        instruction_data.push(0x01);
        instruction_data.push(0x00);
        instruction_data.extend_from_slice(&pubkey_offset.to_le_bytes());
        instruction_data.extend_from_slice(&sig_offset.to_le_bytes());
        instruction_data.extend_from_slice(&msg_offset.to_le_bytes());
        instruction_data.extend_from_slice(&msg_len.to_le_bytes());
        instruction_data.extend_from_slice(_public_key);
        instruction_data.extend_from_slice(_signature);
        instruction_data.extend_from_slice(_message);

        let ed25519_program_id =
            anchor_lang::solana_program::pubkey::Pubkey::new_from_array(ED25519_PROGRAM_ID);

        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: ed25519_program_id,
            accounts: vec![],
            data: instruction_data,
        };

        anchor_lang::solana_program::program::invoke(&ix, &[])
            .map_err(|_| error!(ErrorCode::Ed25519VerificationFailed))?;

        msg!("Ed25519 signature verified successfully");
        Ok(())
    }
}

/// Verifies an Oracle Ed25519 signature.
pub fn verify_oracle_signature(
    signature: &[u8; 64],
    pubkey: &[u8; 32],
    data: &[u8],
) -> Result<()> {
    verify_ed25519_signature(signature, pubkey, data)
}
