# ENRG — parked test (not run by `npm test`)

`devnet-manifest-registry.test.ts` is a **ts-mocha** suite that needs a live
cluster: it registers a manifest, updates the merkle root and verifies a proof
against a deployed program. Neither of the two automated globs picks it up —
`npm test` runs `tests/*.test.js` and `npm run test:integration` runs
`tests/**/*.test.ts` — so it sits here on purpose instead of being deleted.

To run it, start a validator with the program deployed and point the runner at
this directory:

```bash
solana-test-validator &            # or use devnet
anchor deploy
ts-mocha -p tsconfig.json --timeout 180000 tests_disabled/devnet-manifest-registry.test.ts
```

It covers the same merkle path as the Rust tests in
`programs/enrg-mvp/tests/manifest_*` and the hermetic Node suite
(`npm run test:manifest`), which is why the project can stay green without it.