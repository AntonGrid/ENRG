import { PublicKey } from "@solana/web3.js";

export const MERKLE_PROOF_VERIFICATION_SEED = "merkle-proof-verification";
export const MANIFEST_REGISTRY_SEED = "manifest-registry";
export const MANIFEST_VERIFICATION_SEED = "manifest-verification";

export async function registryPda(programId: PublicKey): Promise<PublicKey> {
  const [pda] = await PublicKey.findProgramAddress(
    [Buffer.from(MANIFEST_REGISTRY_SEED)],
    programId
  );
  return pda;
}

export async function verificationPda(
  programId: PublicKey,
  manifestId: number[]
): Promise<PublicKey> {
  const [pda] = await PublicKey.findProgramAddress(
    [Buffer.from(MANIFEST_VERIFICATION_SEED), Buffer.from(manifestId)],
    programId
  );
  return pda;
}

export async function proofPda(
  programId: PublicKey,
  manifestId: number[],
  registry: PublicKey
): Promise<PublicKey> {
  const [pda] = await PublicKey.findProgramAddress(
    [Buffer.from(MERKLE_PROOF_VERIFICATION_SEED), Buffer.from(manifestId), registry.toBuffer()],
    programId
  );
  return pda;
}
