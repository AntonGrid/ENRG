ADR-001: OracleReport and Ed25519 signatures in ENRG Core
Status
Accepted (draft implementation, MVP stack).

Context
ENRG Core must securely accept energy-production proofs from physical devices through oracles. Key requirements:

Device-data authenticity
The signature is made by the device itself (an Ed25519 key), not by the oracle or the producer.

Separating data collection from verification

Device → sends a raw measurement and a signature.
Oracle → verifies the signature, adds service fields (oracle, verified_at, nonce) and sends it to the protocol.
Impossibility of report reuse (replay)

A sequential nonce at the producer level.
Time limits via verified_at (the time check can be relaxed at the MVP stage, but the path to a production check must be transparent).
Message-format determinism
The signed message must be:

clearly described;
unambiguously serializable in Rust/TS/Python, etc.;
independent of internal structure representations (TLV/Borsh, etc.).
At the MVP stage the real on-chain Ed25519 check can be temporarily stubbed (to stabilize the flow and the test economy), but the architectural contract and the OracleReport format must already be finalized — this is the "pivot" around which all the remaining logic is built.

Decision
1. The OracleReport structure
OracleReport is the only trusted object that Core accepts from the off-chain world:

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OracleReport {
    /// Trusted Oracle identity.
    pub oracle: Pubkey,

    /// Producer device.
    pub device_id: Pubkey,

    /// Sequential proof number.
    pub nonce: u64,

    /// Original device timestamp (seconds since Unix epoch).
    pub device_timestamp: i64,

    /// Oracle verification timestamp (seconds since Unix epoch).
    pub verified_at: i64,

    /// Verified energy (in Wh).
    pub energy_wh: u64,

    /// Original device signature (Ed25519, 64 bytes).
    pub device_signature: [u8; 64],
}
Field meanings:

oracle — the Solana account of the trusted oracle. Used for:
checking that the report is signed by a whitelisted oracle (via the OracleRegistry);
logging and the audit trail.
device_id — the device public key (Ed25519 → Solana Pubkey), by which:
the signature is verified;
the report is linked to an EnergyProducer.
nonce — a monotonically increasing proof number at the producer level (not the device level):
each EnergyProducer stores producer.nonce;
the protocol requires report.nonce > producer.nonce.
device_timestamp — the device's original timestamp (seconds, UTC, Unix epoch):
can be used by the oracle for internal checks;
not critical on-chain, but part of the signed message.
verified_at — the oracle verification time (seconds, UTC, Unix epoch):
used on-chain for freshness (now - verified_at <= Δ);
can be temporarily logged without a strict require! (MVP).
energy_wh — the verified energy in watt-hours for the interval covered by the report.
device_signature — the device's unmodified Ed25519 signature over the deterministic message (see below).
2. The signed message message_to_sign()
The device signs only a part of the report fields:

impl OracleReport {
    /// Serialize report fields excluding signature.
    /// This produces the exact message that was signed by the device.
    pub fn message_to_sign(&self) -> Result<Vec<u8>> {
        let mut buf = Vec::with_capacity(8 + 8 + 8 + 8);

        // Serialize only the fields the device signs:
        // device_id + nonce + device_timestamp + energy_wh
        buf.extend_from_slice(&self.device_id.to_bytes());
        buf.extend_from_slice(&self.nonce.to_le_bytes());
        buf.extend_from_slice(&self.device_timestamp.to_le_bytes());
        buf.extend_from_slice(&self.energy_wh.to_le_bytes());

        Ok(buf)
    }
}
Thus:

The signed message is a precisely defined byte sequence:

device_id — 32 bytes, as Pubkey::to_bytes().
nonce — 8 bytes, u64::to_le_bytes().
device_timestamp — 8 bytes, i64::to_le_bytes().
energy_wh — 8 bytes, u64::to_le_bytes().
The oracle cannot substitute these values without breaking the signature.

The service fields (oracle, verified_at) are not signed by the device:

they are added and signed by the oracle itself in a separate off-chain protocol (if required),
but on-chain Core trusts only the device Ed25519 verification and its own oracle whitelist check.
3. On-chain Ed25519 verification
The on-chain check is performed in mint_energy:

let message = report.message_to_sign()?;

verify_ed25519_signature(
    &report.device_signature,
    &report.device_id.to_bytes(),
    &message,
    &ctx.accounts.instructions.to_account_info(),
)?;
The target (prod-ready) verify_ed25519_signature behavior:

It is expected that the transaction already contains an ed25519_program instruction before mint_energy, created with the same publicKey, message, signature.
Inside verify_ed25519_signature:
SysvarInstructions (SYSVAR_INSTRUCTIONS_PUBKEY) is read;
a valid Ed25519Program instruction is searched for in the current transaction's instruction list:
program_id == ed25519_program::id();
the instruction fields (pubkey, msg, sig) match the ones passed to the function;
on a successful match the function returns Ok(()), otherwise — Err(ErrorCode::InvalidSignature).
MVP state (at the time of this ADR):

A "legacy stub" is implemented on-chain:
the message format is fixed via message_to_sign;
an Ed25519 instruction is created and logged;
but the actual verification can be relaxed (e.g. skipped, while the first key bytes, msg_len, sig_len are logged).
This allows:
stabilizing the integration tests;
not blocking the economics/flow work;
without breaking the future interface.
4. Nonce and time checks
Nonce:

Each EnergyProducer stores producer.nonce.

In mint_energy:

msg!(
    "DEBUG NONCE report={} producer={}",
    report.nonce,
    producer.nonce
);
verify_nonce(producer, report.nonce)?;
The target verify_nonce behavior:

require a strict increase, report.nonce > producer.nonce;
update producer.nonce = report.nonce on a successful report.
Time:

In mint_energy the following are available:

now = Clock::get()?.unix_timestamp;
report.verified_at (seconds, Unix epoch).
Target behavior (enabled closer to mainnet):

verify_timestamp(now, report.verified_at)?;
with the invariants:

verified_at <= now + ε_future (a weak future tolerance, if needed);
now - verified_at <= MAX_REPORT_AGE.
At MVP the time check can be temporarily disabled (we log but do not fail the transaction) to:

avoid local test-time artifacts;
simplify Ed25519/nonce/economics debugging.
5. Integration scenario (reference flow)
A typical on-chain MintEnergy call in an integration test:

Assemble the message exactly as message_to_sign():

function buildOracleMessage({
  deviceId,
  nonce,
  deviceTimestamp,
  energyWh,
}): Buffer {
  const le64 = (v: BN) => Buffer.from(v.toArray("le", 8));

  return Buffer.concat([
    Buffer.from(deviceId.toBytes()), // 32
    le64(nonce),                     // 8
    le64(deviceTimestamp),           // 8
    le64(energyWh),                  // 8
  ]);
}
The device signs the message with its Ed25519 key:

const message = buildOracleMessage({ deviceId, nonce, deviceTimestamp, energyWh });
const signature = nacl.sign.detached(message, deviceKeypair.secretKey);
Build Ed25519Program.createInstructionWithPublicKey({ publicKey, message, signature }) and put it first in the transaction.

Assemble the report as a single Anchor argument (not report: { ... }, but exactly a struct):

const report = {
  oracle: oracleKeypair.publicKey,
  deviceId,
  nonce,
  deviceTimestamp,
  verifiedAt: now,
  energyWh,
  deviceSignature: Array.from(signature),
};

const mintIx = await program.methods
  .mintEnergy(report)
  .accounts({ /* ... */ })
  .instruction();
Add to a single transaction:

const tx = new Transaction().add(ed25519Ix, mintIx);
and send it.

6. Invariants
Message format:

The length is always 56 bytes.
The field order and endianness are fixed and must not change without a protocol migration.
Replay protection:

For each EnergyProducer:
report.nonce > producer.nonce (a strict ordering).
Reusing an old nonce must fail.
The link with the economics:

report.energy_wh > 0 for meaningful reports;
calculate_reward(report.energy_wh, vault.total_supply) never returns a value that overflows vault.total_supply or exceeds max_supply.
Key security:

The device private key never appears on-chain;
device_id is set at create_producer and is immutable afterwards.
Alternatives
Considered and rejected:

Signing the entire OracleReport content
Drawbacks:

the oracle cannot add service fields (e.g. adjust verified_at within reasonable bounds) without the device;
the report-format evolution is harder — every new field breaks the device signing protocol.
Using Borsh/TLV serialization of the whole structure as the message
Drawbacks:

a strong coupling to the internal format (field/attribute order);
a higher risk of implementation drift across languages.
Verifying the Ed25519 signature fully in Rust without ed25519_program
Drawbacks:

more compute units;
duplicating the system precompile functionality.
Consequences
Positive
A clearly defined protocol signing format (message_to_sign) — we can:
implement devices/gateways in any language;
integrate with external systems without knowing Anchor.
A transparent migration path:
now — a stub with logs;
later — full verification without changing the report format.
Negative/limitations
Any change to the message_to_sign format (adding/removing fields, reordering) is a breaking change for all devices.
Correct use of SysvarInstructions and Ed25519Program requires careful transaction and test construction.
