//! Conformance suite: the ON-CHAIN Policy Engine must return exactly the decisions
//! recorded in `tests/conformance/policy_vectors.json`.
//!
//! Why this exists (audit 2026-09-16): the same policy semantics are implemented
//! three times — Rust (this crate, the deployed gate), JavaScript (`policy.js`, the
//! off-chain transport gate) and Python (`axis_core.policy`, the reference
//! implementation's mirror). Nothing forced them to agree; the suites were
//! hand-written mirrors. These vectors are the neutral contract: the Rust engine is
//! asserted against them here, and Axis-core asserts its Python engine against the
//! SAME file (`tests/test_policy_conformance.py`), so a drift in either direction
//! turns CI red.
//!
//! The vectors are data, not code: no program change is required to add one.

use std::fs;
use std::path::PathBuf;

use anchor_lang::prelude::*;
use serde_json::Value;

use enrg_mvp::instructions::{MintPreambleInput, MintRewardInput, PolicyEngine};
use enrg_mvp::state::{DeviceState, DeviceTier, EnergyProducer, OracleReport, PolicyRegistry};

/// `<repo>/tests/conformance/policy_vectors.json` (CARGO_MANIFEST_DIR is the crate).
fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/conformance/policy_vectors.json")
}

fn load_vectors() -> Value {
    let path = vectors_path();
    let raw =
        fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    serde_json::from_str(&raw).expect("policy_vectors.json must be valid JSON")
}

fn device_state(s: &str) -> DeviceState {
    match s {
        "unregistered" => DeviceState::Unregistered,
        "registered" => DeviceState::Registered,
        "claimed" => DeviceState::Claimed,
        "provisioned" => DeviceState::Provisioned,
        "active" => DeviceState::Active,
        "quarantine" => DeviceState::Quarantine,
        "maintenance" => DeviceState::Maintenance,
        "revoked" => DeviceState::Revoked,
        other => panic!("unknown device state in the vectors: {other}"),
    }
}

fn device_tier(s: &str) -> DeviceTier {
    match s {
        "basic" => DeviceTier::Basic,
        "verified" => DeviceTier::Verified,
        "industrial" => DeviceTier::Industrial,
        "institutional" => DeviceTier::Institutional,
        other => panic!("unknown device tier in the vectors: {other}"),
    }
}

fn producer_from(v: &Value) -> EnergyProducer {
    EnergyProducer {
        authority: Pubkey::new_from_array([1u8; 32]),
        device_id: Pubkey::new_from_array([2u8; 32]),
        nonce: 0,
        energy_wh: 0,
        timestamp: 0,
        state: device_state(v["state"].as_str().expect("producer.state")),
        tier: device_tier(v["tier"].as_str().expect("producer.tier")),
        month_energy_wh: v["month_energy_wh"].as_u64().unwrap_or(0),
        month_start_ts: v["month_start_ts"].as_i64().unwrap_or(0),
        claim_nonce: 0,
        claimed_at: 0,
        revoked: v["revoked"].as_bool().unwrap_or(false),
        rotated_to: Pubkey::default(),
    }
}

/// An empty `policy` object means "protocol defaults" (`None`) — exactly like a
/// partially-specified Python `PolicyRegistry` keeps its dataclass defaults: the
/// unset flags stay TRUE, they do not become false.
fn policy_from(v: &Value) -> Option<PolicyRegistry> {
    let obj = v.as_object()?;
    if obj.is_empty() {
        return None;
    }
    let mut p = PolicyRegistry::defaults(Pubkey::new_from_array([9u8; 32]), 255);
    if let Some(b) = obj.get("mint_enabled").and_then(|x| x.as_bool()) {
        p.mint_enabled = b;
    }
    if let Some(b) = obj.get("enforce_oracle_whitelist").and_then(|x| x.as_bool()) {
        p.enforce_oracle_whitelist = b;
    }
    if let Some(b) = obj.get("enforce_device_state").and_then(|x| x.as_bool()) {
        p.enforce_device_state = b;
    }
    if let Some(b) = obj.get("enforce_tier_limits").and_then(|x| x.as_bool()) {
        p.enforce_tier_limits = b;
    }
    if let Some(b) = obj.get("enforce_energy_caps").and_then(|x| x.as_bool()) {
        p.enforce_energy_caps = b;
    }
    if let Some(b) = obj.get("enforce_supply_cap").and_then(|x| x.as_bool()) {
        p.enforce_supply_cap = b;
    }
    if let Some(n) = obj.get("max_energy_bps").and_then(|x| x.as_u64()) {
        p.max_energy_bps = n;
    }
    if let Some(n) = obj.get("max_clock_skew_sec").and_then(|x| x.as_i64()) {
        p.max_clock_skew_sec = n;
    }
    Some(p)
}

fn report_from(v: &Value) -> OracleReport {
    let verified_at = v["verified_at"].as_i64().expect("report.verified_at");
    OracleReport {
        oracle: Pubkey::new_from_array([7u8; 32]),
        device_id: Pubkey::new_from_array([2u8; 32]),
        nonce: 1,
        device_timestamp: verified_at,
        verified_at,
        energy_wh: v["energy_wh"].as_u64().expect("report.energy_wh"),
        device_signature: [0u8; 64],
        oracle_signature: [0u8; 64],
    }
}

/// Map an anchor error to the STABLE snake_case reason code used by the vectors
/// (the same codes the Python engine and the oracle API return).
fn reason_of(err: &anchor_lang::error::Error) -> &'static str {
    let msg = err.to_string();
    const CODES: &[(&str, &str)] = &[
        ("MintPaused", "mint_paused"),
        ("UntrustedOracle", "untrusted_oracle"),
        ("InvalidDeviceState", "invalid_device_state"),
        ("StaleProof", "stale_timestamp"),
        ("FutureTimestamp", "future_timestamp"),
        ("TierLimitExceeded", "tier_limit_exceeded"),
        ("ExcessiveEnergy", "excessive_energy"),
        ("ZeroAmountMint", "zero_amount_mint"),
        ("SupplyLimitExceeded", "supply_limit_exceeded"),
    ];
    for (name, code) in CODES {
        if msg.contains(name) {
            return code;
        }
    }
    "unmapped"
}

#[test]
fn onchain_policy_engine_matches_the_conformance_vectors() {
    let doc = load_vectors();
    let vectors = doc["vectors"].as_array().expect("vectors[]");
    assert!(
        vectors.len() >= 18,
        "the vector set shrank unexpectedly ({} vectors)",
        vectors.len()
    );

    let mut checked = 0usize;
    for v in vectors {
        let id = v["id"].as_str().unwrap_or("<missing id>");
        let expected_allowed = v["expected"]["allowed"].as_bool().expect("expected.allowed");
        let expected_reason = v["expected"]["reason"].as_str().expect("expected.reason");
        let policy = policy_from(&v["policy"]);

        let (allowed, reason): (bool, &str) = match v["kind"].as_str().expect("kind") {
            "preamble" => {
                let producer = producer_from(&v["producer"]);
                let report = report_from(&v["report"]);
                let result = PolicyEngine::evaluate_preamble(MintPreambleInput {
                    policy: policy.as_ref(),
                    producer: &producer,
                    report: &report,
                    oracle_trusted: v["oracle_trusted"].as_bool().expect("oracle_trusted"),
                    profile_rated_power: v["producer"]["rated_power_wh"]
                        .as_u64()
                        .expect("producer.rated_power_wh"),
                    now: v["now"].as_i64().expect("now"),
                });
                match result {
                    Ok(()) => (true, "ok"),
                    Err(e) => (false, reason_of(&e)),
                }
            }
            "reward" => {
                let result = PolicyEngine::evaluate_reward(MintRewardInput {
                    policy: policy.as_ref(),
                    reward: v["reward"].as_u64().expect("reward"),
                    vault_total_supply: v["vault_total_supply"]
                        .as_u64()
                        .expect("vault_total_supply"),
                    vault_max_supply: v["vault_max_supply"].as_u64().expect("vault_max_supply"),
                });
                match result {
                    Ok(()) => (true, "ok"),
                    Err(e) => (false, reason_of(&e)),
                }
            }
            other => panic!("unknown vector kind: {other}"),
        };

        assert_eq!(
            allowed, expected_allowed,
            "[{id}] allowed mismatch (reason={reason})"
        );
        assert_eq!(reason, expected_reason, "[{id}] reason mismatch");
        checked += 1;
    }

    println!("conformance: {checked} policy vectors match the on-chain Policy Engine");
}
