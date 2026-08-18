use anchor_lang::prelude::*;
use crate::error::ErrorCode;
use crate::state::{ManifestRegistry, ManifestVerification, MerkleProofVerification};

/// Zero-dependency SHA-256 implementation for on-chain use.
mod sha256 {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    pub fn hash(data: &[u8]) -> [u8; 32] {
        let bit_len = (data.len() as u64) * 8;

        // Padding
        let mut msg: Vec<u8> = Vec::with_capacity(((data.len() + 8) / 64 + 1) * 64);
        msg.extend_from_slice(data);
        msg.push(0x80);
        while msg.len() % 64 != 56 {
            msg.push(0);
        }
        msg.extend_from_slice(&bit_len.to_be_bytes());

        let mut h: [u32; 8] = [
            0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
            0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
        ];

        for chunk in msg.chunks(64) {
            let mut w = [0u32; 64];
            for (i, b) in chunk.chunks(4).enumerate().take(16) {
                w[i] = u32::from_be_bytes([b[0], b[1], b[2], b[3]]);
            }
            for i in 16..64 {
                let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
                let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
                w[i] = w[i - 16]
                    .wrapping_add(s0)
                    .wrapping_add(w[i - 7])
                    .wrapping_add(s1);
            }

            let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) =
                (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);

            for i in 0..64 {
                let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
                let ch = (e & f) ^ (!e & g);
                let temp1 = hh
                    .wrapping_add(s1)
                    .wrapping_add(ch)
                    .wrapping_add(K[i])
                    .wrapping_add(w[i]);
                let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
                let maj = (a & b) ^ (a & c) ^ (b & c);
                let temp2 = s0.wrapping_add(maj);

                hh = g;
                g = f;
                f = e;
                e = d.wrapping_add(temp1);
                d = c;
                c = b;
                b = a;
                a = temp1.wrapping_add(temp2);
            }

            h[0] = h[0].wrapping_add(a);
            h[1] = h[1].wrapping_add(b);
            h[2] = h[2].wrapping_add(c);
            h[3] = h[3].wrapping_add(d);
            h[4] = h[4].wrapping_add(e);
            h[5] = h[5].wrapping_add(f);
            h[6] = h[6].wrapping_add(g);
            h[7] = h[7].wrapping_add(hh);
        }

        let mut out = [0u8; 32];
        for (i, word) in h.iter().enumerate() {
            out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
        }
        out
    }
}

/// SHA-256 merkle node hash: H(left || right) — single hash per AXIS spec
/// (docs/merkle-proof-verification.md, "Create Merkle Tree (Off-chain)").
fn merkle_hash(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut buf = [0u8; 64];
    buf[..32].copy_from_slice(left);
    buf[32..].copy_from_slice(right);
    sha256::hash(&buf)
}

/// Compute the Merkle root from a leaf + path (bottom-up).
pub fn compute_merkle_root(leaf_hash: &[u8; 32], proof_path: &[[u8; 32]], position: u8) -> [u8; 32] {
    let mut current = *leaf_hash;
    let mut pos = position;
    for sibling in proof_path {
        if pos & 1 == 0 {
            current = merkle_hash(&current, sibling);
        } else {
            current = merkle_hash(sibling, &current);
        }
        pos >>= 1;
    }
    current
}

/// Детерминированный leaf-хэш манифеста (ADR-0004/0007, docs/merkle-proof-verification.md):
/// `leaf = SHA-256(manifest_id(16) || content_hash(32))`.
///
/// Этот же лист обязан использовать офф-чейн паблишер (oracle/registry/app.js),
/// иначе proof не сойдётся с опубликованным корнем. Привязка leaf к содержимому
/// манифеста устраняет «доказательство принадлежности произвольного leaf»
/// (аудит 2026-08-18, P0-1).
pub fn manifest_leaf_hash(manifest_id: &[u8; 16], content_hash: &[u8; 32]) -> [u8; 32] {
    let mut buf = [0u8; 48];
    buf[..16].copy_from_slice(manifest_id);
    buf[16..48].copy_from_slice(content_hash);
    sha256::hash(&buf)
}

#[derive(Accounts)]
#[instruction(manifest_id: [u8; 16], proof_path: Vec<[u8; 32]>, leaf_hash: [u8; 32], position: u8)]
pub struct VerifyMerkleProof<'info> {
    /// Единственный легитимный ManifestRegistry (PDA программы).
    #[account(
        seeds = [b"manifest-registry"],
        bump
    )]
    pub registry: Account<'info, ManifestRegistry>,

    pub manifest_verification: Account<'info, ManifestVerification>,

    #[account(
        init,
        payer = verifier,
        space = MerkleProofVerification::SPACE,
        seeds = [b"merkle-proof-verification", manifest_id.as_ref(), registry.key().as_ref()],
        bump
    )]
    pub proof_verification: Account<'info, MerkleProofVerification>,

    #[account(mut)]
    pub verifier: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn verify_merkle_proof(
    ctx: Context<VerifyMerkleProof>,
    manifest_id: [u8; 16],
    proof_path: Vec<[u8; 32]>,
    leaf_hash: [u8; 32],
    position: u8,
) -> Result<()> {
    let registry = &ctx.accounts.registry;
    let manifest = &ctx.accounts.manifest_verification;
    let proof_verification = &mut ctx.accounts.proof_verification;
    let clock = Clock::get()?;

    require!(manifest.manifest_id == manifest_id, ErrorCode::ManifestIdMismatch);

    require!(proof_path.len() <= 32, ErrorCode::ProofPathTooLong);

    // ══ C-4 (P0-1): leaf обязан быть детерминирован от ЗАРЕГИСТРИРОВАННОГО
    // манифеста: leaf = SHA-256(manifest_id || content_hash). Это связывает
    // Merkle-членство с реальным содержимым манифеста, а не с произвольным
    // leaf, переданным вызывающим.
    let expected_leaf = manifest_leaf_hash(&manifest_id, &manifest.content_hash);
    require!(leaf_hash == expected_leaf, ErrorCode::InvalidManifestLeaf);

    // ══ C-3: реально вычисляем root из leaf + proof_path и сверяем ══
    let computed_root = compute_merkle_root(&leaf_hash, &proof_path, position);
    require!(computed_root == registry.merkle_root, ErrorCode::InvalidProof);

    proof_verification.registry = registry.key();
    proof_verification.manifest_verification = ctx.accounts.manifest_verification.key();
    proof_verification.verified_root = computed_root;
    proof_verification.verified_at = clock.unix_timestamp;
    proof_verification.proof_length = proof_path.len() as u8;
    proof_verification.verified_by = ctx.accounts.verifier.key();
    proof_verification.reserved = [0u8; 64];

    emit!(MerkleProofVerified {
        registry: registry.key(),
        manifest_id,
        leaf_hash,
        proof_length: proof_path.len() as u8,
        verified_root: computed_root,
        verified_by: ctx.accounts.verifier.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

pub fn validate_proof_computation(
    leaf_hash: [u8; 32],
    proof_path: &[[u8; 32]],
    position: u8,
    registry_root: [u8; 32],
) -> bool {
    let computed_root = compute_merkle_root(&leaf_hash, proof_path, position);
    computed_root == registry_root && !leaf_hash.iter().all(|&b| b == 0)
}

#[event]
pub struct MerkleProofVerified {
    pub registry: Pubkey,
    pub manifest_id: [u8; 16],
    pub leaf_hash: [u8; 32],
    pub proof_length: u8,
    pub verified_root: [u8; 32],
    pub verified_by: Pubkey,
    pub timestamp: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_leaf_is_deterministic_and_binds_content() {
        let mid = [1u8; 16];
        let ch = [2u8; 32];
        let leaf = manifest_leaf_hash(&mid, &ch);

        // Тот же вход → тот же leaf.
        assert_eq!(leaf, manifest_leaf_hash(&mid, &ch));
        // Изменение content_hash меняет leaf.
        assert_ne!(leaf, manifest_leaf_hash(&mid, &[3u8; 32]));
        // Изменение manifest_id меняет leaf.
        assert_ne!(leaf, manifest_leaf_hash(&[4u8; 16], &ch));
        // Ненулевой leaf.
        assert!(!leaf.iter().all(|&b| b == 0));
    }

    #[test]
    fn compute_merkle_root_matches_manual_hash_chain() {
        // Тривиальное дерево из одного листа: root == leaf_hash.
        let leaf = [7u8; 32];
        let root = compute_merkle_root(&leaf, &[], 0);
        assert_eq!(root, leaf);
    }
}
