# Merkle Proof Verification

## Overview

Merkle Proof Verification is a cryptographic mechanism that allows proving membership of a manifest in a Merkle tree without downloading the entire tree. This is critical for:

1. **Efficient Device Verification**: Devices can prove their manifest is registered without downloading all manifests
2. **Scalability**: As the number of manifests grows, proof size remains O(log n)
3. **Privacy**: Devices only expose their manifest content to verifiers, not all manifests

## Architecture

### On-Chain Components

#### MerkleProofVerification Account
Stores the result of a verified proof:
```rust
pub struct MerkleProofVerification {
    pub registry: Pubkey,                    // Link to ManifestRegistry
    pub manifest_verification: Pubkey,       // The verified manifest
    pub verified_root: [u8; 32],            // Root against which proof was checked
    pub verified_at: i64,                   // Timestamp
    pub proof_length: u8,                   // Number of hashes in proof (efficiency metric)
    pub verified_by: Pubkey,                // Who submitted the proof
}
```

#### Instruction: verify_merkle_proof
```anchor
pub fn verify_merkle_proof(
    ctx: Context<VerifyMerkleProof>,
    manifest_id: [u8; 16],
    proof_path: Vec<[u8; 32]>,              // Sibling hashes from leaf to root
    leaf_hash: [u8; 32],                    // Computed leaf hash
) -> Result<()>
```

### Off-Chain Flow

1. **Off-chain registry** maintains manifests and computes Merkle tree
2. **Oracle** creates Merkle snapshot and updates root on-chain
3. **Device/Verifier** requests proof from registry
4. **Device/Verifier** computes Merkle proof locally
5. **Device/Verifier** submits proof to smart contract
6. **Contract** stores verification result for future reference

## Usage Example

### 1. Create Merkle Tree (Off-chain)

```typescript
import * as keccak from "keccak";

function sha256(data: Buffer): Buffer {
  return keccak("keccak256").update(data).digest();
}

const leaves = [
  Buffer.from("manifest-1"),
  Buffer.from("manifest-2"),
  Buffer.from("manifest-3"),
];

// Build tree bottom-up
let currentLevel = leaves.map((leaf) => sha256(leaf));
while (currentLevel.length > 1) {
  const nextLevel = [];
  for (let i = 0; i < currentLevel.length; i += 2) {
    const left = currentLevel[i];
    const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
    const parent = sha256(Buffer.concat([left, right]));
    nextLevel.push(parent);
  }
  currentLevel = nextLevel;
}

const merkleRoot = currentLevel[0];
```

### 2. Generate Proof for a Leaf

```typescript
function getMerkleProof(tree, leafIndex) {
  const proof = [];
  let index = leafIndex;
  
  for (const level of tree.levels) {
    const sibling = index ^ 1;  // XOR to get sibling index
    if (sibling < level.length) {
      proof.push(level[sibling]);
    }
    index = Math.floor(index / 2);
  }
  
  return proof;
}

const leafIndex = 1;
const proof = getMerkleProof(tree, leafIndex);
console.log(`Proof has ${proof.length} nodes`);
```

### 3. Verify on-chain

```typescript
const leafHash = sha256(leaves[leafIndex]);

const tx = await program.methods
  .verifyMerkleProof(
    manifestId,        // [u8; 16]
    proof,              // Vec<[u8; 32]>
    [...leafHash]       // [u8; 32]
  )
  .accounts({
    registry: registryPda,
    manifestVerification: verificationPda,
    proofVerification: proofVerificationPda,
    verifier: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

console.log(`✅ Proof verified: ${tx}`);
```

## Security Properties

### Completeness
Valid proofs are always accepted (if root matches).

### Soundness
Invalid proofs are always rejected. An attacker cannot forge a valid proof without:
1. Knowing the exact leaf value
2. Having valid sibling hashes for the entire path

### Efficiency
- **Proof Size**: O(log n) hashes (e.g., ~256 bytes for 2^64 leaves)
- **Verification Time**: O(log n) hashes
- **Storage**: One-time proof verification result per manifest

## Testing

### Local Test
```bash
npm run test -- tests/merkle-proof-verification.test.ts
```

### Devnet Test
```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npm run test -- tests/devnet-merkle-proof-verification.test.ts
```

## Integration with Device Lifecycle

Devices use Merkle proofs in several scenarios:

1. **Boot-time Verification**: Device proves its manifest is current
2. **Firmware Update**: Device verifies new firmware manifest before installation
3. **Attestation**: Device proves it has an approved manifest for remote verifiers

## Future Enhancements

1. **Batch Proof Verification**: Multiple proofs in one transaction
2. **Proof Caching**: On-chain cache of verified proofs to reduce repeats
3. **Negative Proofs**: Prove that a manifest is NOT in the tree (for quarantine)
4. **Light Client Support**: Optimize for resource-constrained devices
