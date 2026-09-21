#!/usr/bin/env node
/**
 * ENRG — generate `sdk/vectors/wire_format.json`.
 *
 * The wire format is the part of the protocol where a subtle mistake is silent:
 * the device signs `device_id ‖ nonce ‖ device_timestamp ‖ energy_wh` as
 * little-endian u64s, the oracle hashes its own message (with `verified_at`
 * included), and the chain compares that hash. A client in another language has
 * to reproduce those bytes exactly.
 *
 * This script derives the fixtures from `policy.js` — the JS mirror that
 * `tests/policy-conformance.test.js` already asserts against the Rust engine —
 * so the SDK tests in both languages are compared against the same source of
 * truth instead of two hand-written expectations.
 *
 * Usage:
 *   npm run wire:vectors         # write sdk/vectors/wire_format.json
 *   npm run wire:vectors:check   # exit 1 when the committed vectors are stale
 */
'use strict';

const fs = require('fs');
const path = require('path');
const policy = require('../policy.js');

const ROOT = path.join(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'sdk', 'vectors', 'wire_format.json');
const CHECK_ONLY = process.argv.includes('--check');

// Fixtures. device_id is raw bytes here (the API takes base58); values stay
// inside Number.MAX_SAFE_INTEGER on purpose — see the note in sdk/README.md.
const FIXTURES = [
    {
        name: 'typical-report',
        device_id_hex: '1f2e3d4c5b6a798807162534435261708192a3b4c5d6e7f8091a2b3c4d5e6f70',
        nonce: 42,
        device_timestamp: 1700000000,
        verified_at: 1700000003,
        energy_wh: 1000,
    },
    {
        name: 'first-report-zero-nonce',
        device_id_hex: 'aa'.repeat(32),
        nonce: 0,
        device_timestamp: 1,
        verified_at: 1,
        energy_wh: 1,
    },
    {
        name: 'zero-energy',
        device_id_hex: '00'.repeat(32),
        nonce: 7,
        device_timestamp: 1700000000,
        verified_at: 1700000010,
        energy_wh: 0,
    },
    {
        name: 'largest-safely-representable-energy',
        device_id_hex: 'ff'.repeat(32),
        nonce: Number.MAX_SAFE_INTEGER,
        device_timestamp: 1700000000,
        verified_at: 1700000000,
        energy_wh: Number.MAX_SAFE_INTEGER,
    },
];

function toPublicKey(hex) {
    const { PublicKey } = require('@solana/web3.js');
    return new PublicKey(Buffer.from(hex, 'hex'));
}

const vectors = FIXTURES.map((f) => {
    const devicePubkey = toPublicKey(f.device_id_hex);
    const deviceMessage = policy.buildDeviceMessage(
        devicePubkey,
        f.nonce,
        f.device_timestamp,
        f.energy_wh
    );
    const oracleMessage = policy.buildOracleMessage(
        devicePubkey,
        f.nonce,
        f.device_timestamp,
        f.verified_at,
        f.energy_wh
    );
    const proofHash = policy.proofHashOf(oracleMessage);
    const attestMessage = policy.buildAttestMessage(devicePubkey, f.nonce, proofHash);

    return {
        name: f.name,
        device_id_hex: f.device_id_hex,
        nonce: f.nonce,
        device_timestamp: f.device_timestamp,
        verified_at: f.verified_at,
        energy_wh: f.energy_wh,
        device_message_hex: deviceMessage.toString('hex'),
        oracle_message_hex: oracleMessage.toString('hex'),
        proof_hash_hex: proofHash.toString('hex'),
        attest_message_hex: attestMessage.toString('hex'),
    };
});

const doc = {
    schema_version: '1.0',
    normative_source:
        'ENRG on-chain format: OracleReport::device_message_to_sign / oracle_message_to_sign ' +
        '(programs/enrg-mvp/src/state/oracle.rs) and oracle_attest_message ' +
        '(state/oracle_attestation.rs). Generated from policy.js, the mirror that ' +
        'tests/policy-conformance.test.js checks against the Rust Policy Engine.',
    generated_by: 'scripts/generate-wire-vectors.js',
    wire_formats: {
        device_message_to_sign:
            'device_id(32 bytes) ‖ nonce(u64 little-endian) ‖ device_timestamp(u64 LE) ‖ energy_wh(u64 LE)',
        oracle_message_to_sign:
            'device_id(32 bytes) ‖ nonce(u64 LE) ‖ device_timestamp(u64 LE) ‖ verified_at(u64 LE) ‖ energy_wh(u64 LE)',
        proof_hash: 'SHA-256(oracle_message_to_sign)',
        oracle_attest_message:
            'b"enrg:oracle:attest" ‖ device_id(32 bytes) ‖ nonce(u64 LE) ‖ proof_hash(32 bytes)',
    },
    vectors,
};

const rendered = JSON.stringify(doc, null, 2) + '\n';

if (CHECK_ONLY) {
    const current = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : null;
    if (current !== rendered) {
        console.error('❌ sdk/vectors/wire_format.json is stale — run `npm run wire:vectors`.');
        process.exit(1);
    }
    console.log(`✅ sdk/vectors/wire_format.json matches policy.js (${vectors.length} vectors)`);
} else {
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, rendered);
    console.log(`✅ wrote sdk/vectors/wire_format.json — ${vectors.length} vectors`);
}
