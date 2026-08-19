/// Parser for the data of Solana's built-in Ed25519 instruction (precompile).
///
/// Checks that the data contains exactly one signature and that the extracted
/// signature, public key, and message match the expected values.
///
/// Data format (see `@solana/web3.js` `Ed25519Program.createInstructionWithPublicKey`):
/// ```text
/// [0]    u8   num_signatures                = 1
/// [1]    u8   padding                       = 0
/// [2..4] u16  signature_offset              (LE)
/// [4..6] u16  signature_instruction_index   (LE)
/// [6..8] u16  public_key_offset             (LE)
/// [8..10] u16 public_key_instruction_index  (LE)
/// [10..12] u16 message_data_offset          (LE)
/// [12..14] u16 message_data_size            (LE)
/// [14..16] u16 message_instruction_index    (LE)
/// [16..] data: signature(64) | public_key(32) | message
/// ```
///
/// Instruction indices where signature/public_key/message live:
/// - `0xffff` (u16::MAX) — the "current instruction", i.e. the ed25519 instruction
///   itself (web3.js >= 1.9x standard, default value);
/// - `0` — "instruction with index 0" — the same ed25519 instruction when it
///   is first in the transaction (older clients or explicit `instructionIndex: 0`).
/// Other values mean the data is read from a FOREIGN instruction — we do NOT
/// accept such a layout (it would break the signature binding).
///
/// IMPORTANT: the actual cryptographic signature check is performed by the Solana
/// runtime when processing the precompile instruction (an invalid signature fails
/// the whole transaction). Here we only bind the precompile instruction from the
/// sysvar to the expected (signature, public_key, message).
pub fn verify_ed25519_instruction_data(
    data: &[u8],
    signature: &[u8; 64],
    public_key: &[u8; 32],
    message: &[u8],
) -> bool {
    // Full header is 16 bytes.
    if data.len() < 16 {
        return false;
    }

    // Support exactly one signature per instruction.
    if data[0] != 1 {
        return false;
    }

    let sig_offset = u16::from_le_bytes([data[2], data[3]]) as usize;
    let sig_ix_index = u16::from_le_bytes([data[4], data[5]]);
    let pk_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let pk_ix_index = u16::from_le_bytes([data[8], data[9]]);
    let msg_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size = u16::from_le_bytes([data[12], data[13]]) as usize;
    let msg_ix_index = u16::from_le_bytes([data[14], data[15]]);

    // Signature/key/message data must live in the ed25519 instruction itself.
    let is_self = |i: u16| i == 0 || i == u16::MAX;
    if !is_self(sig_ix_index) || !is_self(pk_ix_index) || !is_self(msg_ix_index) {
        return false;
    }

    if msg_size != message.len() {
        return false;
    }

    if sig_offset + 64 > data.len()
        || pk_offset + 32 > data.len()
        || msg_offset + msg_size > data.len()
    {
        return false;
    }

    let extracted_sig = &data[sig_offset..sig_offset + 64];
    let extracted_pk = &data[pk_offset..pk_offset + 32];
    let extracted_msg = &data[msg_offset..msg_offset + msg_size];

    extracted_sig == signature.as_slice()
        && extracted_pk == public_key.as_slice()
        && extracted_msg == message
}
