use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::prelude::Pubkey;
use anchor_lang::pubkey;

/// Ed25519 signature verification program id.
///
/// This is the canonical on-chain program responsible for `ed25519` sigverify.
/// Хардкоженный Pubkey, чтобы не тянуть внешний крейт вроде `solana-ed25519-program`.
pub const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");

/// Builds an instruction that verifies an Ed25519 signature on-chain.
///
/// `message` – байты сообщения, по которым считалась подпись.
/// `public_key` – 32-байтовый публичный ключ.
/// `signature` – 64-байтовая подпись.
///
/// ВНИМАНИЕ: эта функция ТОЛЬКО строит Instruction.
/// Сам вызов (invoke) делается в модуле `security::verify_ed25519_signature`.
pub fn build_ed25519_ix(
    message: &[u8],
    public_key: &[u8; 32],
    signature: &[u8; 64],
) -> Instruction {
    // Формат данных для ed25519 precompile:
    // https://docs.solana.com/developing/runtime-facilities/programs#ed25519-program
    //
    // Для простоты используем один сигнатурный блок.
    let num_signatures: u8 = 1;
    let padding: u8 = 0;
    let signature_offset: u16 = 16; // сразу после префикса заголовка
    let signature_instruction_index: u16 = 0;
    let public_key_offset: u16 = signature_offset + 64;
    let public_key_instruction_index: u16 = 0;
    let message_data_offset: u16 = public_key_offset + 32;
    let message_data_size: u16 = message.len() as u16;
    let message_instruction_index: u16 = 0;

    let mut data = Vec::with_capacity(
        16usize // заголовок
            + 64  // подпись
            + 32  // публичный ключ
            + message.len(),
    );

    data.push(num_signatures);
    data.push(padding);

    data.extend_from_slice(&signature_offset.to_le_bytes());
    data.extend_from_slice(&signature_instruction_index.to_le_bytes());
    data.extend_from_slice(&public_key_offset.to_le_bytes());
    data.extend_from_slice(&public_key_instruction_index.to_le_bytes());
    data.extend_from_slice(&message_data_offset.to_le_bytes());
    data.extend_from_slice(&message_data_size.to_le_bytes());
    data.extend_from_slice(&message_instruction_index.to_le_bytes());

    data.extend_from_slice(signature);
    data.extend_from_slice(public_key);
    data.extend_from_slice(message);

    Instruction {
        program_id: ED25519_PROGRAM_ID,
        // Для встроенного ed25519-программы аккаунты не требуются.
        accounts: vec![],
        data,
    }
}
