//! Oracle report structure and signing-message tests for the enrg-mvp crate.
//!
//! Moved from the Axis-core repository (where this test was orphaned) and
//! adapted to the current `OracleReport` shape in `src/state/oracle.rs`
//! (8 fields, including `oracle_signature`).
//!
//! NOTE: the original file used `solana-program-test` for a full mint-cycle
//! harness. That harness is NOT wired as a dev-dependency in this crate, so
//! the tests below verify the report structure and the canonical device/oracle
//! signing messages. Full on-chain integration is exercised via `anchor test`
//! (see the TypeScript tests in `ENRG/tests`).

use anchor_lang::solana_program::pubkey::Pubkey;

use enrg_mvp::state::producer::EnergyProducer;
use enrg_mvp::state::{OracleReport, Vault};

fn sample_report() -> OracleReport {
    OracleReport {
        oracle: Pubkey::new_unique(),
        device_id: Pubkey::new_unique(),
        nonce: 1,
        device_timestamp: 1000,
        verified_at: 1000,
        energy_wh: 100,
        device_signature: [0u8; 64],
        oracle_signature: [0u8; 64],
    }
}

#[test]
fn oracle_report_structure_is_valid() {
    let report = sample_report();
    assert!(report.energy_wh > 0);
    assert_eq!(report.device_signature.len(), 64);
    assert_eq!(report.oracle_signature.len(), 64);
    assert!(report.nonce > 0);
}

#[test]
fn device_message_to_sign_matches_canonical_format() {
    // ENRG device signing message:
    //   device_id (32 bytes) || nonce (LE u64) || device_timestamp (LE i64) || energy_wh (LE u64)
    let report = sample_report();
    let message = report.device_message_to_sign().unwrap();

    let mut expected = Vec::new();
    expected.extend_from_slice(&report.device_id.to_bytes());
    expected.extend_from_slice(&report.nonce.to_le_bytes());
    expected.extend_from_slice(&report.device_timestamp.to_le_bytes());
    expected.extend_from_slice(&report.energy_wh.to_le_bytes());

    assert_eq!(message, expected);
    assert_eq!(message.len(), 32 + 8 + 8 + 8);
}

#[test]
fn oracle_message_to_sign_binds_verified_at() {
    let report = sample_report();
    let message = report.oracle_message_to_sign().unwrap();

    let mut expected = Vec::new();
    expected.extend_from_slice(&report.device_id.to_bytes());
    expected.extend_from_slice(&report.nonce.to_le_bytes());
    expected.extend_from_slice(&report.device_timestamp.to_le_bytes());
    expected.extend_from_slice(&report.verified_at.to_le_bytes());
    expected.extend_from_slice(&report.energy_wh.to_le_bytes());

    assert_eq!(message, expected);
    assert_eq!(message.len(), 32 + 8 + 8 + 8 + 8);
}

#[test]
fn vault_and_producer_types_still_exist() {
    // Compile-time sanity: the types referenced by the original Axis-core
    // integration test still exist in the crate.
    let _vault = Vault::default();
    let _producer_type: Option<EnergyProducer> = None;
}
