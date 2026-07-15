use anchor_lang::prelude::*;
use anchor_lang::solana_program;

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
/// Uses CPI to the built-in `Ed25519SigVerify111111111111111111111111111`.
/// This is the standard approach for Solana BPF programs.
pub fn verify_ed25519_signature(
    signature: &[u8; 64],
    public_key: &[u8; 32],
    message: &[u8],
) -> Result<()> {
    // ── Length checks ──
    require!(
        signature.len() == 64,
        ErrorCode::InvalidSignatureLength
    );
    require!(
        public_key.len() == 32,
        ErrorCode::InvalidPublicKeyLength
    );

    // ── Build the instruction data ──
    // Layout expected by ed25519_program:
    //   [0x01, 0x00]                          ← count (1) + padding
    //   [pubkey_offset (8B)] [sig_offset (8B)] [msg_offset (8B)] [msg_len (8B)]
    //   [public_key (32B)] [signature (64B)] [message (var)]

    let pubkey_offset: u64 = 2 + 32; // header (2) + 4 offsets (32)
    let sig_offset: u64 = pubkey_offset + 32;
    let msg_offset: u64 = sig_offset + 64;
    let msg_len: u64 = message.len() as u64;

    let mut instruction_data = Vec::with_capacity(
        2 + 32 + 32 + 64 + message.len(),
    );

    // Header
    instruction_data.push(0x01); // count
    instruction_data.push(0x00); // padding
    // offsets (4 × u64 = 32 bytes)
    instruction_data.extend_from_slice(&pubkey_offset.to_le_bytes());
    instruction_data.extend_from_slice(&sig_offset.to_le_bytes());
    instruction_data.extend_from_slice(&msg_offset.to_le_bytes());
    instruction_data.extend_from_slice(&msg_len.to_le_bytes());

    // Data
    instruction_data.extend_from_slice(public_key);
    instruction_data.extend_from_slice(signature);
    instruction_data.extend_from_slice(message);

    // ── CPI to ed25519_program ──
    let ed25519_program_id = solana_program::pubkey::Pubkey::new_from_array(ED25519_PROGRAM_ID);

    let ix = solana_program::instruction::Instruction {
        program_id: ed25519_program_id,
        accounts: vec![],
        data: instruction_data,
    };

    solana_program::program::invoke(&ix, &[])
        .map_err(|_| error!(ErrorCode::Ed25519VerificationFailed))?;

    msg!("Ed25519 signature verified successfully");
    Ok(())
}

/// Verifies an Oracle Ed25519 signature.
pub fn verify_oracle_signature(
    signature: &[u8; 64],
    pubkey: &[u8; 32],
    data: &[u8],
) -> Result<()> {
    verify_ed25519_signature(signature, pubkey, data)
}
