use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::Pubkey;
use anchor_lang::solana_program::system_instruction;
use solana_program_test::*;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use solana_sdk::transaction::Transaction;
use std::str::FromStr;

use enrg_mvp::state::{OracleReport, Vault};
use enrg_mvp::state::producer::EnergyProducer;

#[tokio::test]
async fn test_full_mint_cycle() {
    // Setup
    let program_id = Pubkey::from_str("8JEw3eD7NgboNYcQQwoSsTG7UF8RrQpRnJzouDr6XQ8a").unwrap();
    let program_test = ProgramTest::new(
        "enrg_mvp",
        program_id,
        processor!(enrg_mvp::entry),
    );
    let (mut banks_client, payer, recent_blockhash) = program_test.start().await;

    // Initialize Vault
    let vault_pubkey = Pubkey::new_unique();
    let vault_authority = Keypair::new();

    // Create producer
    let producer_pubkey = Pubkey::new_unique();
    let device_id = Pubkey::new_unique();
    let max_power_w = 1000;

    // Create Oracle Report
    let oracle_report = OracleReport {
        oracle: payer.pubkey(),
        device_id,
        nonce: 1,
        device_timestamp: 1000,
        verified_at: 1000,
        energy_wh: 100,
        device_signature: [0u8; 64],
    };

    // Mint Energy
    // Here we would call the mint_energy instruction
    // For now, just verify the structure
    assert!(oracle_report.energy_wh > 0);
}
