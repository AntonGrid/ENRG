use anchor_lang::prelude::*;

use crate::error::ErrorCode;

/// Ed25519 verification — production-ready.
///
/// Extracts the ed25519 instruction from the sysvar instructions account
/// and verifies that it matches the expected public key, message, and signature.
pub fn verify_ed25519_signature(
    signature: &[u8; 64],
    public_key: &[u8; 32],
    message: &[u8],
    instructions_sysvar: &AccountInfo,
) -> Result<()> {
    require!(!message.is_empty(), ErrorCode::InvalidParameter);

    let ed25519_program_id = solana_sdk_ids::ed25519_program::ID;

    // -- Проверяем ТЕКУЩУЮ инструкцию (индекс 0) --
    match solana_instructions_sysvar::get_instruction_relative(0, instructions_sysvar) {
        Ok(current_ix) => {
            if current_ix.program_id == ed25519_program_id {
                if verify_ed25519_instruction_data(
                    &current_ix.data,
                    signature,
                    public_key,
                    message,
                ) {
                    msg!("Ed25519 verification OK (current): pubkey={:?}, msg_len={}", &public_key[..4], message.len());
                    return Ok(());
                }
            }
        }
        Err(_) => {
            msg!("DEBUG: Could not get current instruction");
        }
    }

    // Если не нашли в текущей, пробуем предыдущую (-1) — это страховка
    match solana_instructions_sysvar::get_instruction_relative(-1, instructions_sysvar) {
        Ok(prev_ix) => {
            if prev_ix.program_id == ed25519_program_id {
                if verify_ed25519_instruction_data(
                    &prev_ix.data,
                    signature,
                    public_key,
                    message,
                ) {
                    msg!("Ed25519 verification OK (prev): pubkey={:?}, msg_len={}", &public_key[..4], message.len());
                    return Ok(());
                }
            }
        }
        Err(_) => {
            msg!("DEBUG: Could not get previous instruction");
        }
    }

    msg!("Ed25519 verification failed: no valid Ed25519 instruction found");
    Err(ErrorCode::Ed25519VerificationFailed.into())
}

/// Parse and verify ed25519 native instruction data.
fn verify_ed25519_instruction_data(
    data: &[u8],
    signature: &[u8; 64],
    public_key: &[u8; 32],
    message: &[u8],
) -> bool {
    // A complete header is 16 bytes.
    if data.len() < 16 {
        msg!("DEBUG: Data length < 16");
        return false;
    }

    // Only one signature is supported by this verifier.
    if data[0] != 1 {
        msg!("DEBUG: Num signatures != 1");
        return false;
    }

    let sig_offset = u16::from_le_bytes([data[2], data[3]]) as usize;
    let sig_ix_index = data[4];
    let pk_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let pk_ix_index = data[8];
    let msg_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size = u16::from_le_bytes([data[12], data[13]]) as usize;
    let msg_ix_index = data[14];

    // Signature, public key, and message must all reference the current
    // instruction (index 0 in the transaction's relative instruction list).
    if sig_ix_index != 0 || pk_ix_index != 0 || msg_ix_index != 0 {
        msg!("DEBUG: Instruction index mismatch (sig: {}, pk: {}, msg: {})", sig_ix_index, pk_ix_index, msg_ix_index);
        return false;
    }

    if msg_size != message.len() {
        msg!("DEBUG: Message size mismatch (data: {}, expected: {})", msg_size, message.len());
        return false;
    }

    if sig_offset + 64 > data.len()
        || pk_offset + 32 > data.len()
        || msg_offset + msg_size > data.len()
    {
        msg!("DEBUG: Offset out of bounds");
        return false;
    }

    let extracted_sig = &data[sig_offset..sig_offset + 64];
    let extracted_pk = &data[pk_offset..pk_offset + 32];
    let extracted_msg = &data[msg_offset..msg_offset + msg_size];

    let sig_match = extracted_sig == signature.as_slice();
    let pk_match = extracted_pk == public_key.as_slice();
    let msg_match = extracted_msg == message;

    if !sig_match {
        msg!("DEBUG: Signature mismatch");
    }
    if !pk_match {
        msg!("DEBUG: Public key mismatch");
    }
    if !msg_match {
        msg!("DEBUG: Message mismatch");
    }

    sig_match && pk_match && msg_match
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
