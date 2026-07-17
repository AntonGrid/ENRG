const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const fetch = require('node-fetch');
const nacl = require('tweetnacl');
const util = require('tweetnacl-util');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Manifest Registry API', function () {
  this.timeout(20000);
  let server;

  before(async function () {
    server = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: '4101', REGISTRY_ADMIN_KEY: 'test-key' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    server.stdout.on('data', (chunk) => process.stdout.write(chunk));
    server.stderr.on('data', (chunk) => process.stdout.write(chunk));

    await wait(1000);
  });

  after(() => {
    if (server) {
      server.kill('SIGTERM');
    }
  });

  it('publishes and retrieves a manifest', async function () {
    const payload = { manifest_version: '1.0', device_type: 'sensor', manufacturer: 'ENRG' };
    const keyPair = nacl.sign.keyPair();
    const signature = util.encodeBase64(nacl.sign.detached(Buffer.from(JSON.stringify(payload)), keyPair.secretKey));
    const publicKey = util.encodeBase64(keyPair.publicKey);

    const publishRes = await fetch('http://127.0.0.1:4101/api/v1/manifests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest_id: 'manifest-test-1', payload, signature, public_key: publicKey })
    });

    assert.strictEqual(publishRes.status, 201);
    const published = await publishRes.json();
    assert.strictEqual(published.status, 'published');

    const getRes = await fetch('http://127.0.0.1:4101/api/v1/manifests/manifest-test-1');
    assert.strictEqual(getRes.status, 200);
    const data = await getRes.json();
    assert.strictEqual(data.payload.manifest_version, '1.0');
  });

  it('creates a snapshot and exposes current root', async function () {
    const snapshotRes = await fetch('http://127.0.0.1:4101/api/v1/merkle/snapshot', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' }
    });
    assert.strictEqual(snapshotRes.status, 201);
    const snapshot = await snapshotRes.json();
    assert.ok(snapshot.root);

    const currentRes = await fetch('http://127.0.0.1:4101/api/v1/merkle/current');
    assert.strictEqual(currentRes.status, 200);
    const current = await currentRes.json();
    assert.strictEqual(current.root, snapshot.root);
  });
});
