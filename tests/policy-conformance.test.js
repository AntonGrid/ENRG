/**
 * Conformance: the off-chain transport gate (`policy.js`) must return exactly the
 * results recorded in `tests/conformance/policy_vectors.json#transport_vectors`.
 *
 * Why (audit 2026-09-16): `policy.js` is the second implementation of the policy
 * layer — the gate every proof from every device passes through before the oracle
 * even looks at the chain. The same shared vector file is asserted against by the
 * on-chain Rust engine (`programs/enrg-mvp/tests/policy_conformance.rs`) and by the
 * Axis-core mirror; this suite closes the third leg so the three cannot drift apart
 * silently.
 *
 * Scope: only what the transport gate actually implements — device_id format,
 * energyWh range/cap, timestamp freshness, nonce monotonicity. The on-chain POLICY
 * semantics (whitelist, device state, tiers, supply cap) live in the `vectors`
 * section and are NOT re-implemented here on purpose (ADR-0003: Verifier != Policy
 * Engine).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const policy = require('../policy');

const VECTORS = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'conformance', 'policy_vectors.json'), 'utf8')
);

/** Run one transport check by name (never casts: the vectors carry the raw input). */
function runCheck(vector) {
    const input = vector.input || {};
    switch (vector.check) {
        case 'device_id':
            return policy.validateDeviceId(input.device_id);
        case 'energy_wh':
            return policy.validateEnergyWh(input.energyWh);
        case 'timestamp':
            return policy.validateTimestamp(input.timestamp, input.nowSec);
        case 'nonce':
            return policy.validateNonce(input.nonce, input.lastNonce);
        default:
            throw new Error(`unknown check in the vectors: ${vector.check}`);
    }
}

describe('conformance: transport gate (policy.js) vs the shared vectors', () => {
    before(() => {
        // Deterministic limits: the vectors assume the protocol defaults, not whatever
        // the environment (MAX_ENERGY_PER_REPORT_WH / MAX_PROOF_AGE_SEC / ...) sets.
        policy.setConfig(policy.DEFAULT_CONFIG);
    });

    it('the shared vector file carries both sections', () => {
        assert.ok(Array.isArray(VECTORS.vectors), 'the `vectors` array must exist');
        assert.ok(Array.isArray(VECTORS.transport_vectors), 'the `transport_vectors` array must exist');
        assert.ok(
            VECTORS.vectors.length >= 21,
            `the policy vector set shrank (${VECTORS.vectors.length})`
        );
        assert.ok(
            VECTORS.transport_vectors.length >= 14,
            `the transport vector set shrank (${VECTORS.transport_vectors.length})`
        );
    });

    for (const vector of VECTORS.transport_vectors) {
        it(`${vector.id} (${vector.check})`, () => {
            const result = runCheck(vector);
            const expected = vector.expected;

            assert.strictEqual(
                result.ok,
                expected.ok,
                `${vector.id}: ok mismatch -> ${JSON.stringify(result)}`
            );

            if (expected.ok === false) {
                assert.strictEqual(result.status, expected.status, `${vector.id}: status`);
                assert.strictEqual(result.error, expected.error, `${vector.id}: error`);
            }

            if (expected.field) {
                assert.strictEqual(
                    result[expected.field],
                    expected.value,
                    `${vector.id}: ${expected.field}`
                );
            }
        });
    }
});
