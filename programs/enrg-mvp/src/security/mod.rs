use anchor_lang::prelude::*;
use solana_instructions_sysvar::get_instruction_relative;

use crate::constants::ED25519_PROGRAM_ID;
use crate::error::ErrorCode;

pub mod validation;
pub mod ed25519;

pub use validation::*;
pub use ed25519::*;

/// Максимальная глубина сканирования sysvar Instructions назад от текущей
/// инструкции. Ed25519-precompile-инструкции размещаются клиентом ПЕРЕД
/// инструкцией программы в одной транзакции, поэтому их относительные
/// индексы отрицательны (-1, -2, ...).
const MAX_SCAN_BACK: i64 = 8;

/// Verify an Ed25519 signature on-chain using the sysvar Instructions
/// account and Solana's built-in Ed25519 precompile program.
///
/// Паттерн (стандарт Axis/Solana):
/// 1. Клиент кладёт в транзакцию ПЕРЕД нашей инструкцией precompile-инструкцию
///    Ed25519 с (pubkey, message, signature). Рантайм Solana сам проверяет
///    подпись — недействительная подпись роняет всю транзакцию.
/// 2. Здесь мы читаем sysvar Instructions, находим эту precompile-инструкцию
///    и убеждаемся, что её (signature, public_key, message) совпадают
///    с ожидаемыми. Это связывает проверенную рантаймом подпись
///    с обрабатываемыми данными.
///
/// Никаких обходов и «debug/test» веток: проверка выполняется всегда.
pub fn verify_ed25519_signature(
    signature: &[u8; 64],
    public_key: &[u8; 32],
    message: &[u8],
    instructions_sysvar: &AccountInfo,
) -> Result<()> {
    require!(!message.is_empty(), ErrorCode::InvalidParameter);
    require!(
        instructions_sysvar.key() == crate::constants::INSTRUCTIONS_SYSVAR_ID,
        ErrorCode::InvalidInstructionsAccount
    );

    for i in 0..=MAX_SCAN_BACK {
        match get_instruction_relative(-i, instructions_sysvar) {
            Ok(ix) => {
                if ix.program_id == ED25519_PROGRAM_ID
                    && ed25519::verify_ed25519_instruction_data(
                        &ix.data,
                        signature,
                        public_key,
                        message,
                    )
                {
                    msg!(
                        "Ed25519 verified: pubkey={}, msg_len={}",
                        Pubkey::new_from_array(*public_key),
                        message.len()
                    );
                    return Ok(());
                }
            }
            // Аккаунт не является sysvar Instructions — сработает только если
            // constraint в Accounts не был задан; страхуемся и здесь.
            Err(anchor_lang::solana_program::program_error::ProgramError::UnsupportedSysvar) => {
                return Err(ErrorCode::InvalidInstructionsAccount.into())
            }
            // Вышли за пределы списка инструкций транзакции.
            Err(_) => break,
        }
    }

    Err(ErrorCode::Ed25519VerificationFailed.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Тест-вектор сгенерирован offline (tweetnacl, Ed25519):
    /// message = [0,1,...,31], ключ и подпись фиксированы.
    const TEST_PUBKEY: [u8; 32] = [
        77, 14, 195, 160, 208, 63, 239, 255, 147, 169, 188, 206, 42, 36, 180, 6,
        212, 111, 68, 174, 255, 31, 119, 135, 218, 237, 177, 60, 170, 250, 64, 44,
    ];
    const TEST_SIGNATURE: [u8; 64] = [
        88, 110, 27, 59, 112, 17, 174, 37, 136, 41, 241, 161, 159, 230, 28, 163,
        207, 113, 85, 239, 29, 66, 175, 101, 65, 16, 242, 150, 45, 244, 217, 179,
        146, 196, 32, 10, 123, 174, 53, 122, 252, 59, 166, 50, 21, 133, 2, 9,
        199, 49, 46, 182, 150, 74, 212, 40, 110, 195, 54, 136, 120, 10, 126, 7,
    ];
    const TEST_MESSAGE: [u8; 32] = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
        16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    ];

    /// Формирует data ed25519 precompile-инструкции (layout как в web3.js).
    fn build_ed25519_data(signature: &[u8; 64], public_key: &[u8; 32], message: &[u8]) -> Vec<u8> {
        let mut data = Vec::with_capacity(16 + 64 + 32 + message.len());
        data.push(1); // num_signatures
        data.push(0); // padding
        data.extend_from_slice(&16u16.to_le_bytes()); // signature_offset
        data.push(0); // signature_instruction_index
        data.push(0); // padding
        data.extend_from_slice(&80u16.to_le_bytes()); // public_key_offset
        data.push(0); // public_key_instruction_index
        data.push(0); // padding
        data.extend_from_slice(&112u16.to_le_bytes()); // message_data_offset
        data.extend_from_slice(&(message.len() as u16).to_le_bytes()); // message_data_size
        data.push(0); // message_instruction_index
        data.push(0); // padding
        data.extend_from_slice(signature);
        data.extend_from_slice(public_key);
        data.extend_from_slice(message);
        data
    }

    /// Оборачивает готовые данные sysvar в AccountInfo.
    fn sysvar_account<'a>(data: &'a mut Vec<u8>, lamports: &'a mut u64) -> AccountInfo<'a> {
        AccountInfo::new(
            &crate::constants::INSTRUCTIONS_SYSVAR_ID,
            false,
            false,
            lamports,
            data.as_mut_slice(),
            &anchor_lang::solana_program::system_program::ID,
            false,
            0,
        )
    }

    /// Строит данные sysvar Instructions с одной ed25519-инструкцией
    /// на текущем индексе 0 (имитация транзакции [ed25519Ix, ...]).
    fn build_sysvar_data(signature: &[u8; 64], public_key: &[u8; 32], message: &[u8]) -> Vec<u8> {
        let ix_data = build_ed25519_data(signature, public_key, message);
        let borrowed = solana_instruction::BorrowedInstruction {
            program_id: &crate::constants::ED25519_PROGRAM_ID,
            accounts: vec![],
            data: &ix_data,
        };
        let mut sysvar_data =
            solana_instructions_sysvar::construct_instructions_data(&[borrowed]);
        solana_instructions_sysvar::store_current_index_checked(&mut sysvar_data, 0).unwrap();
        sysvar_data
    }

    #[test]
    fn verify_valid_signature() {
        let mut sysvar_data = build_sysvar_data(&TEST_SIGNATURE, &TEST_PUBKEY, &TEST_MESSAGE);
        let mut lamports: u64 = 0;
        let sysvar = sysvar_account(&mut sysvar_data, &mut lamports);
        let res = verify_ed25519_signature(&TEST_SIGNATURE, &TEST_PUBKEY, &TEST_MESSAGE, &sysvar);
        assert!(res.is_ok(), "expected Ok, got {:?}", res);
    }

    #[test]
    fn reject_wrong_message() {
        let mut sysvar_data = build_sysvar_data(&TEST_SIGNATURE, &TEST_PUBKEY, &TEST_MESSAGE);
        let mut lamports: u64 = 0;
        let sysvar = sysvar_account(&mut sysvar_data, &mut lamports);
        let wrong: &[u8] = &[9u8; 32];
        let res = verify_ed25519_signature(&TEST_SIGNATURE, &TEST_PUBKEY, wrong, &sysvar);
        assert!(res.is_err(), "expected Err for wrong message");
    }

    #[test]
    fn reject_wrong_pubkey() {
        let mut sysvar_data = build_sysvar_data(&TEST_SIGNATURE, &TEST_PUBKEY, &TEST_MESSAGE);
        let mut lamports: u64 = 0;
        let sysvar = sysvar_account(&mut sysvar_data, &mut lamports);
        let wrong_pk = [1u8; 32];
        let res = verify_ed25519_signature(&TEST_SIGNATURE, &wrong_pk, &TEST_MESSAGE, &sysvar);
        assert!(res.is_err(), "expected Err for wrong pubkey");
    }

    #[test]
    fn reject_wrong_signature() {
        let mut sysvar_data = build_sysvar_data(&TEST_SIGNATURE, &TEST_PUBKEY, &TEST_MESSAGE);
        let mut lamports: u64 = 0;
        let sysvar = sysvar_account(&mut sysvar_data, &mut lamports);
        let mut wrong_sig = [0u8; 64];
        wrong_sig[0] = 1;
        let res = verify_ed25519_signature(&wrong_sig, &TEST_PUBKEY, &TEST_MESSAGE, &sysvar);
        assert!(res.is_err(), "expected Err for wrong signature");
    }

    #[test]
    fn reject_non_sysvar_account() {
        let mut lamports: u64 = 0;
        let mut junk = [0u8; 8];
        let fake_key = Pubkey::new_unique();
        let fake = AccountInfo::new(
            &fake_key,
            false,
            false,
            &mut lamports,
            &mut junk,
            &anchor_lang::solana_program::system_program::ID,
            false,
            0,
        );
        let res = verify_ed25519_signature(&TEST_SIGNATURE, &TEST_PUBKEY, &TEST_MESSAGE, &fake);
        assert!(res.is_err(), "expected Err for non-sysvar account");
    }
}
