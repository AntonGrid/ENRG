/// Парсер data встроенной Ed25519-инструкции Solana (precompile).
///
/// Проверяет, что data содержит ровно одну подпись и что извлечённые
/// подпись, публичный ключ и сообщение совпадают с ожидаемыми.
///
/// Формат data (см. `@solana/web3.js` `Ed25519Program.createInstructionWithPublicKey`):
/// ```text
/// [0]    u8   num_signatures                = 1
/// [1]    u8   padding                       = 0
/// [2..4] u16  signature_offset              (LE) = 16
/// [4]    u8   signature_instruction_index   = 0
/// [5]    u8   padding
/// [6..8] u16  public_key_offset             (LE) = 80
/// [8]    u8   public_key_instruction_index  = 0
/// [9]    u8   padding
/// [10..12] u16 message_data_offset          (LE) = 112
/// [12..14] u16 message_data_size            (LE)
/// [14]   u8   message_instruction_index     = 0
/// [15]   u8   padding
/// [16..] данные: signature(64) | public_key(32) | message
/// ```
///
/// ВАЖНО: сама криптографическая проверка подписи выполняется рантаймом
/// Solana при обработке precompile-инструкции (недействительная подпись
/// роняет всю транзакцию). Здесь мы лишь связываем precompile-инструкцию
/// из sysvar с ожидаемыми (signature, public_key, message).
pub fn verify_ed25519_instruction_data(
    data: &[u8],
    signature: &[u8; 64],
    public_key: &[u8; 32],
    message: &[u8],
) -> bool {
    // Полный заголовок — 16 байт.
    if data.len() < 16 {
        return false;
    }

    // Поддерживаем ровно одну подпись на инструкцию.
    if data[0] != 1 {
        return false;
    }

    let sig_offset = u16::from_le_bytes([data[2], data[3]]) as usize;
    let sig_ix_index = data[4];
    let pk_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let pk_ix_index = data[8];
    let msg_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size = u16::from_le_bytes([data[12], data[13]]) as usize;
    let msg_ix_index = data[14];

    // Подпись, ключ и сообщение должны ссылаться на текущую инструкцию
    // (индекс 0) — стандартный layout, который генерирует web3.js.
    if sig_ix_index != 0 || pk_ix_index != 0 || msg_ix_index != 0 {
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
