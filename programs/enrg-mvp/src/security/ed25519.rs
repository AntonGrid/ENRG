/// Парсер data встроенной Ed25519-инструкции Solana (precompile).
///
/// Проверяет, что data содержит ровно одну подпись и что извлечённые
/// подпись, публичный ключ и сообщение совпадают с ожидаемыми.
///
/// Формат data (см. `@solana/web3.js` `Ed25519Program.createInstructionWithPublicKey`):
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
/// [16..] данные: signature(64) | public_key(32) | message
/// ```
///
/// Индексы инструкций, в которых лежат signature/public_key/message:
/// - `0xffff` (u16::MAX) — «текущая инструкция», т.е. сама ed25519-инструкция
///   (стандарт web3.js >= 1.9x, значение по умолчанию);
/// - `0` — «инструкция с индексом 0» — та же ed25519-инструкция, когда она
///   идёт первой в транзакции (старые клиенты или явный `instructionIndex: 0`).
/// Другие значения означают, что данные читаются из ЧУЖОЙ инструкции —
/// такой layout мы НЕ принимаем (это разорвало бы привязку подписи).
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
    let sig_ix_index = u16::from_le_bytes([data[4], data[5]]);
    let pk_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let pk_ix_index = u16::from_le_bytes([data[8], data[9]]);
    let msg_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size = u16::from_le_bytes([data[12], data[13]]) as usize;
    let msg_ix_index = u16::from_le_bytes([data[14], data[15]]);

    // Данные подписи/ключа/сообщения должны лежать в самой ed25519-инструкции.
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
