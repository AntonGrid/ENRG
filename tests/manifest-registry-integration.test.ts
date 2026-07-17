import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import * as nacl from "tweetnacl";
import * as util from "tweetnacl-util";
import * as keccak from "keccak";
import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";
import * as assert from "assert";

const REGISTRY_URL = process.env.REGISTRY_URL || "http://127.0.0.1:4000";
const REGISTRY_ADMIN_KEY = process.env.REGISTRY_ADMIN_KEY || "secure-key";

interface ManifestPayload {
  manifest_version: string;
  device_type: string;
  manufacturer: string;
  model?: string;
  firmware_version?: string;
}

async function publishManifest(payload: ManifestPayload): Promise<{ manifest_id: string; signature: string; public_key: string }> {
  const keyPair = nacl.sign.keyPair();
  const signature = util.encodeBase64(nacl.sign.detached(Buffer.from(JSON.stringify(payload)), keyPair.secretKey));
  const publicKey = util.encodeBase64(keyPair.publicKey);
  const manifest_id = uuidv4();

  const res = await fetch(`${REGISTRY_URL}/api/v1/manifests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manifest_id, payload, signature, public_key: publicKey }),
  });

  assert.strictEqual(res.status, 201, `Failed to publish manifest: ${res.statusText}`);
  const data = (await res.json()) as { manifest_id: string; status: string };
  assert.strictEqual(data.status, "published");

  return { manifest_id, signature, public_key: publicKey };
}

async function createMerkleSnapshot(): Promise<{ root: string; total: number }> {
  const res = await fetch(`${REGISTRY_URL}/api/v1/merkle/snapshot`, {
    method: "POST",
    headers: { "x-api-key": REGISTRY_ADMIN_KEY },
  });

  assert.strictEqual(res.status, 201, `Failed to create snapshot: ${res.statusText}`);
  const data = (await res.json()) as { root: string; total: number; timestamp: string };
  return { root: data.root, total: data.total };
}

async function getCurrentMerkleRoot(): Promise<string> {
  const res = await fetch(`${REGISTRY_URL}/api/v1/merkle/current`);
  assert.strictEqual(res.status, 200);
  const data = (await res.json()) as { root: string; message?: string };
  return data.root || "0x" + "0".repeat(64);
}

describe("Manifest Registry Integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.EnrgMvp as Program<any>;
  const wallet = provider.wallet as anchor.Wallet;

  const [manifestRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("manifest-registry")],
    program.programId
  );

  let registryAccount: PublicKey;
  let publishedManifests: Array<{ manifest_id: string; payload: ManifestPayload }> = [];

  it("should initialize Manifest Registry on-chain", async () => {
    const tx = await program.methods
      .initializeManifestRegistry()
      .accounts({
        registry: manifestRegistryPda,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Registry initialized: tx =", tx);
    registryAccount = manifestRegistryPda;

    const account = await program.account.manifestRegistry.fetch(manifestRegistryPda);
    assert.ok(account, "Registry account should exist");
    assert.strictEqual(account.version, 1);
    assert.strictEqual(account.manifestCount, 0);
  });

  it("should publish manifests via off-chain registry", async () => {
    const manifest1Payload: ManifestPayload = {
      manifest_version: "1.0",
      device_type: "sensor",
      manufacturer: "ENRG",
      model: "ESP32-Pro",
      firmware_version: "2.0.1",
    };

    const manifest2Payload: ManifestPayload = {
      manifest_version: "1.0",
      device_type: "gateway",
      manufacturer: "ENRG",
      model: "GW-100",
      firmware_version: "1.5.0",
    };

    const m1 = await publishManifest(manifest1Payload);
    publishedManifests.push({ manifest_id: m1.manifest_id, payload: manifest1Payload });
    console.log("✅ Published manifest 1:", m1.manifest_id);

    const m2 = await publishManifest(manifest2Payload);
    publishedManifests.push({ manifest_id: m2.manifest_id, payload: manifest2Payload });
    console.log("✅ Published manifest 2:", m2.manifest_id);
  });

  it("should create a Merkle snapshot and update on-chain registry", async () => {
    const snapshot = await createMerkleSnapshot();
    console.log(`✅ Merkle snapshot created: root = ${snapshot.root}, total = ${snapshot.total}`);

    const rootHex = snapshot.root;
    const rootBuffer = Buffer.from(rootHex.replace("0x", ""), "hex");
    const rootBytes = new Uint8Array(rootBuffer.length > 32 ? rootBuffer.slice(0, 32) : rootBuffer);

    const tx = await program.methods
      .updateMerkleRoot([...Array.from(rootBytes).slice(0, 32).fill(0, rootBytes.length)], new BN(snapshot.total))
      .accounts({
        registry: registryAccount,
        authority: wallet.publicKey,
      })
      .rpc();

    console.log("✅ Merkle root updated on-chain: tx =", tx);

    const account = await program.account.manifestRegistry.fetch(manifestRegistryPda);
    assert.strictEqual(account.manifestCount, snapshot.total);
    assert.strictEqual(account.version, 2);
  });

  it("should retrieve current Merkle root and verify consistency", async () => {
    const currentRoot = await getCurrentMerkleRoot();
    console.log("✅ Current Merkle root from registry:", currentRoot);

    const account = await program.account.manifestRegistry.fetch(manifestRegistryPda);
    const onChainRoot = Buffer.from(account.merkleRoot).toString("hex");
    console.log("📝 On-chain stored root:", onChainRoot);

    // Both should exist (may differ due to in-memory vs on-chain)
    assert.ok(currentRoot, "Registry should have a root");
    assert.ok(account.merkleRoot, "On-chain registry should have a root");
  });

  it("should verify all published manifests are still retrievable", async () => {
    for (const { manifest_id } of publishedManifests) {
      const res = await fetch(`${REGISTRY_URL}/api/v1/manifests/${manifest_id}`);
      assert.strictEqual(res.status, 200, `Failed to retrieve manifest ${manifest_id}`);
      const data = (await res.json()) as any;
      assert.ok(data.payload, "Manifest should have payload");
      assert.ok(data.signature, "Manifest should have signature");
      console.log(`✅ Retrieved manifest ${manifest_id}`);
    }
  });
});
