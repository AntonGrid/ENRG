#!/usr/bin/env node
/**
 * ENRG — generate `docs/openapi.json` from `server.js`.
 *
 * Why (P1, audit 2026-09-21): the repository shipped eight OpenAPI files that
 * described the "Part II" FastAPI mock (`registry.example.com`, port 8000) and
 * covered none of the real oracle routes. Those specs are now labelled legacy
 * (`legacy/openapi/`), and this script derives the real one from the live
 * source of truth.
 *
 * How it stays honest:
 *   1. the route list is *extracted* from `server.js` — it cannot drift;
 *   2. every extracted route must have curated metadata in ROUTE_DOCS, and every
 *      ROUTE_DOCS entry must still exist in `server.js` — otherwise the script
 *      fails with a non-zero exit code, so CI (`npm run openapi:check`) breaks
 *      the moment somebody adds, renames or removes an endpoint without
 *      documenting it;
 *   3. the output embeds the sha256 of `server.js`, so a reviewer can tell
 *      whether the published spec matches the code in front of them.
 *
 * Usage:
 *   npm run openapi         # write docs/openapi.json
 *   npm run openapi:check   # exit 1 when docs/openapi.json is out of date
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER_PATH = path.join(ROOT, 'server.js');
const OUT_PATH = path.join(ROOT, 'docs', 'openapi.json');
const CHECK_ONLY = process.argv.includes('--check');

const PROGRAM_ID = 'HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb';
const PROFILE_PROGRAM_ID = '78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt';

// ── Curated metadata for every route of server.js ──────────────────────────
// Keys are "<method> <path>" exactly as they appear in server.js.
const ROUTE_DOCS = {
    'get /health': {
        tag: 'ops',
        summary: 'Liveness probe (also used by the hosting platform)',
        responses: { 200: 'Service is up' },
    },
    'post /api/v1/device/register': {
        tag: 'device lifecycle',
        summary: 'Register a device: the device signs its own registration message',
        body: {
            device_id: 'base58 device public key (32 bytes)',
            public_key: 'same key, base58 (44 chars)',
            signature: 'base64 Ed25519 signature over the registration message',
        },
        responses: {
            200: 'Device accepted, producer PDA derived; `activated_on_chain` reports whether the on-chain registration succeeded',
            400: 'Validation failed',
            503: 'RPC unavailable (retry)',
        },
    },
    'post /api/v1/proof/submit': {
        tag: 'proof',
        summary: 'Submit an energy proof (the main ingestion endpoint)',
        notes:
            'Verification is against the on-chain EnergyProducer account, not the local DB. ' +
            'The decisive check is the device Ed25519 signature over ' +
            'SHA-256(device_id‖nonce‖device_timestamp‖energy_wh); the same hash is what oracles vote on. ' +
            'Minting is queued and resumes across restarts.',
        body: {
            device_id: 'base58 device public key',
            nonce: 'monotonic uint64 counter from the device',
            device_timestamp: 'unix seconds reported by the device (clock-skew checked)',
            energy_wh: 'energy in watt-hours since the previous report',
            device_signature: 'Ed25519 signature, array of 64 bytes',
            signature: 'legacy string signature (accepted for accumulation only, cannot mint)',
        },
        responses: {
            200: 'Accepted — `mint` is one of `queued` | `deferred` (with `mint_reason`) | `already_minted`',
            400: 'Invalid proof, bad signature, clock skew or policy rejection',
            403: 'Device revoked on-chain',
            503: 'RPC unavailable (retry)',
        },
    },
    'get /api/v1/proofs': {
        tag: 'proof',
        summary: 'List stored proofs, newest first, with the accepting oracle',
        query: { device_id: 'optional filter', limit: 'default 100, max 1000' },
        responses: { 200: 'Proof rows (one per oracle that accepted the proof)' },
    },
    'get /api/v1/device/:id/status': {
        tag: 'device lifecycle',
        summary: 'Device status (energy accumulated, last nonce, on-chain state)',
        responses: { 200: 'Status', 404: 'Unknown device' },
    },
    'get /api/v1/device/:id/balance': {
        tag: 'device lifecycle',
        summary: 'SRC balance of the device owner, read from the on-chain token account',
        notes:
            'The owner is the EnergyProducer `authority` — the same account `mint_energy` ' +
            'requires as the token-account owner (mint.rs). An owner that was never paid has no ' +
            'token account yet; that is a zero balance, not an error.',
        responses: {
            200: 'balance (ui amount), balance_atomic, owner, ata, mint',
            404: 'Device is not registered on-chain',
            503: 'RPC unavailable (retry)',
        },
    },
    'get /api/v1/device/:id/history': {
        tag: 'device lifecycle',
        summary: 'Proof/mint history of one device from oracle storage',
        query: { limit: 'default 50, max 200' },
        responses: { 200: 'history[] with ts, energy_wh, nonce, mint_status, mint_tx, mint_error, oracle_id', 404: 'Unknown device' },
    },
    'post /api/v1/device/revoke/:device_id': {
        tag: 'device lifecycle',
        summary: 'Revoke a device on-chain (ADR-0007); a revoked device cannot send proofs',
        notes: 'Signed server-side with the founder key (vault authority).',
        responses: { 200: 'Revoked, transaction signature returned', 500: 'founder_key_missing / idl_missing' },
    },
    'post /api/v1/device/rotate/:device_id': {
        tag: 'device lifecycle',
        summary: 'Rotate a device key (ADR-0007) — needs the current owner and the new device signature',
        body: {
            new_device_id: 'base58 public key of the new device key',
            owner_signature: 'base64 signature by the current owner authorising the rotation',
            new_device_signature: 'base64 signature by the new device key',
        },
        responses: { 200: 'Rotation accepted', 400: 'Signature/validation failure' },
    },
    'get /api/v1/manifest/:device_id': {
        tag: 'firmware & manifest',
        summary: 'Founder-signed Device Manifest for a device (ADR-0004)',
        responses: { 200: 'Manifest JSON + signature', 404: 'No manifest for this device' },
    },
    'get /api/v1/firmware/latest': {
        tag: 'firmware & manifest',
        summary: 'Metadata of the latest signed firmware image (version, hash, signature)',
        responses: { 200: 'latest.json metadata', 404: 'No firmware published yet' },
    },
    'get /api/v1/firmware/latest/image': {
        tag: 'firmware & manifest',
        summary: 'Download the latest firmware image (binary)',
        responses: { 200: 'application/octet-stream', 404: 'No firmware published yet' },
    },
    'post /api/v1/firmware/update': {
        tag: 'firmware & manifest',
        summary: 'Publish a firmware image (admin only, ADR-0008)',
        headers: { 'x-api-key': 'must equal FIRMWARE_ADMIN_KEY' },
        body: { _raw: 'raw binary firmware image (application/octet-stream)' },
        responses: {
            200: 'Published; the oracle signs the metadata with the firmware signing key',
            401: 'Missing/incorrect x-api-key',
            503: 'firmware_admin_key_missing (env not configured)',
        },
    },
    'post /api/v1/pool/create': {
        tag: 'pool',
        summary: 'Create a pooling group (aggregated minting for small producers)',
        body: { pool_id: 'string', threshold: 'energy threshold in Wh' },
        responses: { 200: 'Pool created', 400: 'Missing fields or duplicate pool_id' },
    },
    'get /api/v1/stats': {
        tag: 'public metrics',
        summary: 'Protocol metrics from the proofs table (single source of truth)',
        notes:
            'Counts one row per proof (device_id + nonce), so a proof attested by several oracles is ' +
            'not double counted; `attestation_rows` exposes the raw row count separately.',
        responses: { 200: 'total_proofs, minted_proofs, deferred_proofs, accepted_proofs, energy, active_producers' },
    },
    'get /api/v1/oracles': {
        tag: 'public metrics',
        summary: 'Oracle network: the on-chain trusted set + per-oracle attribution',
        notes:
            '`counts` separates registered keys from keys that have actually handled proofs. ' +
            '`unattributed_proofs` counts rows recorded before per-oracle attribution existed ' +
            '(2026-08-30) — they cannot be assigned to an oracle and are reported instead of being ' +
            'silently shown as 0 for every oracle.',
        responses: { 200: 'oracles[], counts{registered,with_proofs,idle}, unattributed_proofs, note' },
    },
};

// ── 1. Routes that actually exist in server.js ─────────────────────────────
function extractRoutes(source) {
    const re = /app\.(get|post|put|delete)\('([^']+)'/g;
    const out = [];
    let m;
    while ((m = re.exec(source)) !== null) out.push(`${m[1]} ${m[2]}`);
    return out;
}

const serverSource = fs.readFileSync(SERVER_PATH, 'utf8');
const routes = extractRoutes(serverSource);

// ── 2. Drift check in both directions (this is what CI runs) ───────────────
const undocumented = routes.filter((r) => !ROUTE_DOCS[r]);
const stale = Object.keys(ROUTE_DOCS).filter((r) => !routes.includes(r));
if (undocumented.length || stale.length) {
    console.error('❌ docs/openapi.json is out of sync with server.js:');
    for (const r of undocumented) console.error(`   undocumented route in server.js: ${r}`);
    for (const r of stale) console.error(`   documented route that no longer exists: ${r}`);
    console.error('   → add/remove the matching entry in ROUTE_DOCS (scripts/generate-openapi.js).');
    process.exit(1);
}

// ── 3. Build the document ──────────────────────────────────────────────────
function pathParameters(routePath) {
    const params = [];
    const re = /:([A-Za-z0-9_]+)/g;
    let m;
    while ((m = re.exec(routePath)) !== null) {
        params.push({
            name: m[1],
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description:
                m[1] === 'id'
                    ? 'base58 device public key (32 bytes)'
                    : m[1] === 'device_id'
                      ? 'base58 device public key'
                      : `Path parameter ${m[1]}`,
        });
    }
    return params;
}

function openApiPath(routePath) {
    return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

const paths = {};
for (const route of routes) {
    const [method, routePath] = route.split(' ');
    const doc = ROUTE_DOCS[route];
    const op = {
        tags: [doc.tag],
        summary: doc.summary,
        operationId: `${method}_${routePath.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
        parameters: pathParameters(routePath),
        responses: {},
    };

    if (doc.notes) op.description = doc.notes;

    for (const [status, description] of Object.entries(doc.responses || {})) {
        op.responses[status] = {
            description,
            content: { 'application/json': { schema: { type: 'object' } } },
        };
    }

    if (doc.query) {
        for (const [name, description] of Object.entries(doc.query)) {
            op.parameters.push({ name, in: 'query', required: false, schema: { type: 'string' }, description });
        }
    }

    if (doc.headers) {
        for (const [name, description] of Object.entries(doc.headers)) {
            op.parameters.push({ name, in: 'header', required: true, schema: { type: 'string' }, description });
        }
    }

    if (doc.body) {
        const raw = doc.body._raw;
        if (raw) {
            op.requestBody = {
                required: true,
                content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
                description: raw,
            };
        } else {
            const properties = {};
            for (const [name, description] of Object.entries(doc.body)) {
                properties[name] = { description };
            }
            op.requestBody = {
                required: true,
                content: { 'application/json': { schema: { type: 'object', properties } } },
            };
        }
    }

    paths[openApiPath(routePath)] = { ...(paths[openApiPath(routePath)] || {}), [method]: op };
}

const spec = {
    openapi: '3.0.3',
    info: {
        title: 'ENRG oracle API (live)',
        version: '1.0.0',
        description:
            'Generated from server.js by scripts/generate-openapi.js — do not edit by hand.\n\n' +
            'This is the API that actually runs: the Express oracle on devnet ' +
            '(https://enrg-oracle.onrender.com). The "Part II" FastAPI mock specs are legacy and ' +
            'live in legacy/openapi/.\n\n' +
            `On-chain programs: enrg-mvp ${PROGRAM_ID} (58 instructions), enrg-profile ${PROFILE_PROGRAM_ID}.`,
    },
    servers: [
        { url: 'https://enrg-oracle.onrender.com', description: 'devnet deployment' },
        { url: 'http://localhost:3000', description: 'local (npm start)' },
    ],
    tags: [...new Set(Object.values(ROUTE_DOCS).map((d) => d.tag))].map((name) => ({ name })),
    paths,
    'x-generated-from': 'server.js',
    'x-generated-from-sha256': crypto.createHash('sha256').update(serverSource).digest('hex'),
};

const rendered = JSON.stringify(spec, null, 2) + '\n';

// ── 4. Write, or verify in --check mode ────────────────────────────────────
if (CHECK_ONLY) {
    const current = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : null;
    if (current !== rendered) {
        console.error(
            '❌ docs/openapi.json is stale — run `npm run openapi` and commit the result.\n' +
                `   (routes: ${routes.length}, spec: ${Object.keys(paths).length} paths)`
        );
        process.exit(1);
    }
    console.log(`✅ docs/openapi.json matches server.js (${routes.length} routes, sha256 ${spec['x-generated-from-sha256'].slice(0, 12)}…)`);
} else {
    fs.writeFileSync(OUT_PATH, rendered);
    console.log(
        `✅ wrote docs/openapi.json — ${routes.length} routes, ${Object.keys(paths).length} paths, ` +
            `sha256(server.js)=${spec['x-generated-from-sha256'].slice(0, 12)}…`
    );
}
