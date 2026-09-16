# Policy conformance vectors

**What this is.** A neutral, language-independent contract for the *decision* of the
policy layer (ADR-0003 / ADR-0006): given a policy snapshot, a device state and a
report, the answer must be exactly `(allowed, reason)`. Only that pair is compared —
never internals, never error messages.

**Why it exists.** The same semantics are implemented three times:

| Implementation | Where | Role |
|---|---|---|
| Rust | `programs/enrg-mvp/src/instructions/policy_engine.rs` | the deployed on-chain gate (section `vectors`) |
| Python | `Axis-core/axis_core/policy/engine.py` | the reference implementation's mirror (section `vectors`) |
| JavaScript | `policy.js` | the off-chain transport gate (section `transport_vectors`) |

Nothing forced them to agree: the test suites were hand-written mirrors. A silent
divergence between the two full engines would mean the reference implementation
accepts proofs the chain rejects (or vice versa); a divergence in the JS gate would
mean the oracle accepts or drops proofs differently from the contract. These vectors
are the shared contract, so a drift in any of the three fails CI.

**Who runs them.**

```bash
# ENRG — the on-chain engine:
cargo test -p enrg-mvp --test policy_conformance -- --nocapture

# ENRG — the transport gate (policy.js):
npm run test:conformance

# Axis-core (the mirror) — path via env, or a sibling ENRG checkout:
AXIS_CONFORMANCE_VECTORS=$PWD/../ENRG/tests/conformance/policy_vectors.json \
  pytest -q tests/test_policy_conformance.py
```

CI: ENRG runs the Rust runner inside `cargo test -p enrg-mvp` and the JS runner in the
node job; Axis-core checks this repository out (sparse, `tests/conformance`) and
points `AXIS_CONFORMANCE_VECTORS` at the file. If the file is absent the Python suite
skips with an explicit message instead of failing.

**Adding a vector.** Append an object to `vectors[]` with `id`, `kind`
(`preamble` or `reward`), the inputs, and `expected`. Rules that keep it meaningful:

- `policy: {}` (or absent) means *protocol defaults* — do not spell out the defaults,
  and remember that a partial policy keeps the defaults for the flags it omits;
- `month_start_ts` must sit inside the 30-day window, otherwise `month_energy_wh`
  is not effective and the tier rules cannot trigger;
- boundary cases are welcome (clock skew of exactly `max_clock_skew_sec`, proof age
  of exactly 900 s) — they are where the three implementations historically diverged;
- reason codes are the stable snake_case ones listed under `reason_codes`.

`normative_source` in the JSON points at the normative documents — **the L0
repository (Axis-protocol) is the constitution and is never modified by a change
here**; if an implementation disagrees with a vector, the implementation is fixed or
the deviation is documented in `Axis-core/docs/conformance.md`.
