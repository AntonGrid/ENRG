# P0 ownership fix — 2026-09-16 (mint for a device owned by another wallet)

## 1. The problem

`mint_energy` required the transaction to be signed by `producer.authority`, and
the reward was credited to `user_token_account` whose owner must also be
`producer.authority`. Consequences on the deployed system:

- the oracle could mint **only** for devices owned by the key the oracle runtime
  held (`server.js` signed the mint with the founder key — the workaround comment
  at `server.js` "Root cause (0x7d6)" documented it);
- therefore every minted SRC landed on the **founder's** ATA, while `README.md`
  promised "Owner — receives tokens proportional to produced energy";
- a device claimed by a user wallet (the Axis-connect flow: `claim_device` with
  the user's own wallet) became **unmintable** by the oracle: C-2 rejected it
  with `NotProducerOwner`.

## 2. The root cause

`programs/enrg-profile/src/lib.rs`:

```rust
pub struct RecordProduction<'info> {
    pub authority: Signer<'info>,                                  // MUST sign
    #[account(mut, seeds = [b"profile", authority.key().as_ref()], ...)]
    pub profile: Account<'info, EnergyProfile>,
}
```

`mint_energy` binds `profile` to `[b"profile", producer.authority]`
(`mint.rs`), so the CPI signer had to be the device owner — the mint transaction
could not be signed by anyone else.

## 3. The fix

**enrg-profile** — a new, owner-independent entry point:

```rust
pub fn record_production_authorized(ctx, energy_wh, timestamp)   // caller MUST be the
                                                                 // enrg-mvp `mint-authority` PDA
```
`RecordProductionAuthorized { caller: Signer, authority: UncheckedAccount, profile }`
where `profile` keeps its `[b"profile", authority]` seeds and a
`profile.authority == authority` constraint. `record_production` (owner-signed)
is kept for compatibility. Both share `record_production_inner`, so the window
math cannot drift.

Authorization is by **address**: only the `mint-authority` PDA of enrg-mvp can be
the caller, and that PDA is owned by enrg-mvp — no third party can move a
device's window.

**enrg-mvp** — `mint_energy` now calls the authorized entry point with
`caller = mint_authority` (signed via `invoke_signed`) and gained one account:

| Account | Signer | Purpose |
|---|---|---|
| `producer_owner` | no | the device owner, needed only for the profile PDA seeds; constrained to `producer.authority` |

**server.js** — the mint transaction is now signed by the **oracle**
(`sendVersioned(..., oracleKeypair, ...)`, `authority: oracleKeypair.publicKey`),
so C-2 passes through the `report.oracle == submitter` branch and the reward goes
to `producer.authority`. The founder key is no longer needed to mint.

## 4. Verification (devnet, executed)

`scripts/devnet_mint_third_party.ts` (new) runs the full flow with a **fresh
device key** and a **fresh owner wallet**, neither of which is the operator or the
oracle:

```
STEP 0  owner a4Erjr9ShTfz8NFLe6frZR78rYcf5sCx9y6Zx2FPuAU  (≠ oracle, ≠ operator)
        device 9QwkFs3FGESCpvYvjN2cNP5maBd43qMBwEzSxyo3zVHh
STEP 2  register → claim (owner) → provision → activate → profile → rated_power   (owner signs)
STEP 3  attestation 7yzC9xVF2iQu81j7XnwxcHyYvt9hJnZnxqDLQE4uJ4Ud | votes=2 finalized=true
STEP 4  mint_energy signed by the ORACLE: ps9c641zjN1EGnkEF4fNafkqCuGVHgN2d6TAu6sBHK6roCaei7N5Ea1o2SDezd2YdggLNCUQpq8Kc4BQkRnd4E1
STEP 5  owner ATA balance: 0 -> 0.000536313 SRC
PASS — a device owned by a wallet that did NOT sign the mint received its SRC.
```

Programs upgraded for this:
- `enrg-profile`: `3PgY8AJ4kSVEhiNshfxjGksG7EpPLTgxu1y43yAd8JGiNPyZezbREB6DuNmr9C6hHX5oDYLWDjyWiyvmmCc9WWrr`
- `enrg-mvp`: `3FDGbbehxGucz1QYDKKARb46FENCBKwA8N9LpgFMukiPjG1UeZtB2CbFw8e43YDwAS6iL9vfdXn6zmppt6Qc5inU`

## 5. Breaking change for clients

`mint_energy` has one additional account: `producerOwner` (= `producer.authority`,
not a signer). Callers must pass it:
`server.js`, `scripts/devnet_e2e_lifecycle.ts`, `scripts/devnet_mint_third_party.ts`
are updated; any external client must be updated too (there is no state migration
— only the account list changed).

## 6. Follow-ups

1. `set_governance_authority` / two-step authority transfer (layout migration) —
   still open from the key-rotation work.
2. `enrg-profile` upgrade authority is still the operator hot key (`GkdhQQ…`);
   move it (with `enrg-mvp`) to the Squads multisig.
3. The `record_production` (owner-signed) path is now unused by the protocol;
   keep it for external integrators or deprecate it in the next major version.
4. Cap the per-mint energy of the authorized path by `rated_power` directly in the
   CPI (today the Policy Engine does it in `mint_energy` before the CPI).
