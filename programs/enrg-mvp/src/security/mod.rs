use anchor_lang::prelude::*;
use solana_instructions_sysvar::get_instruction_relative;

use crate::constants::ED25519_PROGRAM_ID;
use crate::error::ErrorCode;

pub mod validation;
pub mod ed25519;
pub mod lifecycle;

pub use validation::*;
pub use ed25519::*;
pub use lifecycle::*;

/// Maximum scan depth of the sysvar Instructions backward from the current
/// instruction. Ed25519 precompile instructions are placed by the client BEFORE
/// the program instruction in the same transaction, so their relative
/// indices are negative (-1, -2, ...).
const MAX_SCAN_BACK: i64 = 8;

/// Verify an Ed25519 signature on-chain using the sysvar Instructions
/// account and Solana's built-in Ed25519 precompile program.
///
/// Pattern (Axis/Solana standard):
/// 1. The client puts an Ed25519 precompile instruction with
///    (pubkey, message, signature) BEFORE our instruction in the transaction.
///    The Solana runtime itself verifies the signature — an invalid signature
///    fails the whole transaction.
/// 2. Here we read the sysvar Instructions, find that precompile instruction,
///    and ensure its (signature, public_key, message) match the expected values.
///    This binds the runtime-verified signature to the data being processed.
///
/// No bypasses or "debug/test" branches: the check always runs.
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
            // The account is not the Instructions sysvar — this only happens if
            // the constraint in Accounts was not set; we guard here too.
            Err(anchor_lang::solana_program::program_error::ProgramError::UnsupportedSysvar) => {
                return Err(ErrorCode::InvalidInstructionsAccount.into())
            }
            // Went past the end of the transaction's instruction list.
            Err(_) => break,
        }
    }

    Err(ErrorCode::Ed25519VerificationFailed.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test vector generated offline (tweetnacl, Ed25519):
    /// message = [0,1,...,31], the key and signature are fixed.
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

    /// Builds the data of an ed25519 precompile instruction (layout as in web3.js).
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

    /// Wraps ready sysvar data into an AccountInfo.
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

    /// Builds sysvar Instructions data with a single ed25519 instruction
    /// at the current index 0 (simulating a transaction [ed25519Ix, ...]).
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

    /// Builds ed25519 instruction data in the web3.js >= 1.9x layout:
    /// instruction indices are written as u16 with value 0xffff
    /// ("current instruction"). This is the format actually sent by
    /// @solana/web3.js 1.98.4 without an explicit instructionIndex.
    fn build_ed25519_data_web3js(
        signature: &[u8; 64],
        public_key: &[u8; 32],
        message: &[u8],
    ) -> Vec<u8> {
        let mut data = Vec::with_capacity(16 + 64 + 32 + message.len());
        data.push(1); // num_signatures
        data.push(0); // padding
        data.extend_from_slice(&16u16.to_le_bytes()); // signature_offset
        data.extend_from_slice(&u16::MAX.to_le_bytes()); // signature_instruction_index = 0xffff
        data.extend_from_slice(&80u16.to_le_bytes()); // public_key_offset
        data.extend_from_slice(&u16::MAX.to_le_bytes()); // public_key_instruction_index = 0xffff
        data.extend_from_slice(&112u16.to_le_bytes()); // message_data_offset
        data.extend_from_slice(&(message.len() as u16).to_le_bytes()); // message_data_size
        data.extend_from_slice(&u16::MAX.to_le_bytes()); // message_instruction_index = 0xffff
        data.extend_from_slice(signature);
        data.extend_from_slice(public_key);
        data.extend_from_slice(message);
        data
    }

    #[test]
    fn verify_web3js_layout_signature() {
        // Direct parser check against the web3.js 1.98.4 layout (0xffff).
        let data = build_ed25519_data_web3js(&TEST_SIGNATURE, &TEST_PUBKEY, &TEST_MESSAGE);
        assert!(
            ed25519::verify_ed25519_instruction_data(
                &data,
                &TEST_SIGNATURE,
                &TEST_PUBKEY,
                &TEST_MESSAGE,
            ),
            "web3js layout (0xffff) must be accepted"
        );

        // Full path: sysvar Instructions + verify_ed25519_signature.
        let mut sysvar_data = build_sysvar_data_web3js(&TEST_SIGNATURE, &TEST_PUBKEY, &TEST_MESSAGE);
        let mut lamports: u64 = 0;
        let sysvar = sysvar_account(&mut sysvar_data, &mut lamports);
        let res = verify_ed25519_signature(&TEST_SIGNATURE, &TEST_PUBKEY, &TEST_MESSAGE, &sysvar);
        assert!(res.is_ok(), "expected Ok for web3js layout, got {:?}", res);
    }

    #[test]
    fn reject_foreign_instruction_index() {
        // An index referencing a FOREIGN instruction (not 0 and not 0xffff) is rejected.
        let mut data = build_ed25519_data(&TEST_SIGNATURE, &TEST_PUBKEY, &TEST_MESSAGE);
        data[4] = 1; // signature_instruction_index = 1
        assert!(
            !ed25519::verify_ed25519_instruction_data(
                &data,
                &TEST_SIGNATURE,
                &TEST_PUBKEY,
                &TEST_MESSAGE,
            ),
            "foreign instruction index must be rejected"
        );
    }

    /// build_sysvar_data for the web3.js layout (0xffff indices).
    fn build_sysvar_data_web3js(
        signature: &[u8; 64],
        public_key: &[u8; 32],
        message: &[u8],
    ) -> Vec<u8> {
        let ix_data = build_ed25519_data_web3js(signature, public_key, message);
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
}
