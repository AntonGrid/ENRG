use anchor_lang::prelude::*;

use crate::error::ErrorCode;

/// Ed25519 verification — production-ready.
///
/// Extracts the ed25519 instruction from the sysvar instructions account
/// and verifies that it matches the expected public key, message, and signature.
///
/// # How it works
///
/// 1. Iterates through all instructions in the sysvar to find one
///    whose program ID is the Ed25519 native program (`Ed25519SigVerify111111111111111111111111111`).
/// 2. Parses the instruction data according to the ed25519 native program format:
///    - 1 byte: signature offset
///    - 1 byte: signature length (must be 64)
///    - 1 byte: public key offset
///    - 1 byte: public key length (must be 32)
///    - 1 byte: message offset
///    - 1 byte: message length
///    - 16 bytes: padding/placeholder
///    - 64 bytes: signature
///    - 32 bytes: public key
///    - N bytes: message
/// 3. Compares the extracted public key, message, and signature with the expected values.
pub fn verify_ed25519_signature(
    signature: &[u8; 64],
    public_key: &[u8; 32],
    message: &[u8],
    instructions_sysvar: &AccountInfo,
) -> Result<()> {
    require!(!message.is_empty(), ErrorCode::InvalidParameter);

    let ed25519_program_id = solana_sdk_ids::ed25519_program::ID;

    // Scan through instructions using get_instruction_relative
    // Index 0 = current instruction, -1 = previous, etc.
    // We scan from the beginning (most negative index) forward
    let mut found = false;

    // Scan through instructions using get_instruction_relative
    let max_scan: i64 = 8; // Reasonable upper bound for nested instructions
    for i in (0..=max_scan).rev() {
        // get_instruction_relative(0) = current instruction
        // get_instruction_relative(-1) = previous instruction, etc.
        match solana_instructions_sysvar::get_instruction_relative(
            -i,
            instructions_sysvar,
        ) {
            Ok(ix) => {
                if ix.program_id == ed25519_program_id {
                    if verify_ed25519_instruction_data(
                        &ix.data,
                        signature,
                        public_key,
                        message,
                    ) {
                        found = true;
                        break;
                    }
                }
            }
            Err(_) => continue,
        }
    }

    require!(found, ErrorCode::Ed25519VerificationFailed);

    msg!(
        "Ed25519 verification OK: pubkey={:?}, msg_len={}",
        &public_key[..4],
        message.len(),
    );

    Ok(())
}

/// Parse and verify ed25519 native instruction data.
fn verify_ed25519_instruction_data(
    data: &[u8],
    signature: &[u8; 64],
    public_key: &[u8; 32],
    message: &[u8],
) -> bool {
    if data.len() < 118 {
        return false;
    }

    // Parse the ed25519 native instruction header
    let sig_offset = data[0] as usize;
    let sig_len = data[1] as usize;
    let pk_offset = data[2] as usize;
    let pk_len = data[3] as usize;
    let msg_offset = data[4] as usize;
    let msg_len = data[5] as usize;

    if sig_len != 64 || pk_len != 32 {
        return false;
    }

    if sig_offset + 64 > data.len()
        || pk_offset + 32 > data.len()
        || msg_offset + msg_len > data.len()
    {
        return false;
    }

    let extracted_sig = &data[sig_offset..sig_offset + 64];
    let extracted_pk = &data[pk_offset..pk_offset + 32];
    let extracted_msg = &data[msg_offset..msg_offset + msg_len];

    extracted_sig == signature.as_slice()
        && extracted_pk == public_key.as_slice()
        && extracted_msg == message
}

/// Alias for oracle signatures (if used separately from device).
pub fn verify_oracle_signature(
    signature: &[u8; 64],
    pubkey: &[u8; 32],
    data: &[u8],
    instructions_sysvar: &AccountInfo,
) -> Result<()> {
    verify_ed25519_signature(signature, pubkey, data, instructions_sysvar)
}
