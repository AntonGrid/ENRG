# ENRG → Mainnet: Real Integration Tests on Anchor/Solana

**Goal:** validate the full ENRG flow against a real local Solana validator — from device-side Proof generation (Ed25519) through the oracle to an on-chain `mint_energy` call, and confirm SRC tokens are minted.

This replaces the current mock-only test coverage with a real end-to-end integration test, updated for the new `axis_core` package layout.

---

## 1. Environment preparation

### 1.1 Required tools

Install the Solana toolchain and Anchor. Versions matter — keep them aligned with the one used for the ENRG program.

```bash
# Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.18/install)"

# Anchor CLI (requires Rust + Yarn)
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest

# Python side
pip install anchorpy solana solders
Verify the toolchain:

solana --version
anchor --version
python3 -c "import anchorpy, solana, solders; print('anchorpy', anchorpy.__version__); print('ok')"
If your ENRG program was built with a specific anchor-lang / solana-program version, pin those versions instead of latest.

1.2 Project layout (current, post-migration)
Axis-workspace/
├── Axis-core/          # oracle + schemas + attestation logic (axis_core package)
│   └── axis_core/
├── ENRG/               # Anchor program + ENRG test suite
│   ├── Anchor.toml
│   ├── contracts/enrg/
│   └── tests/          # integration tests live here
All new integration tests go into ENRG/tests/.

2. Start the local Solana validator
Run a local cluster with program support. Start it in a dedicated terminal (it must stay running):

cd ~/Axis-workspace/ENRG
solana-test-validator
Useful flags while tuning:

solana-test-validator --reset --mint 0x<your_keypair_pubkey>
Notes:

Default RPC endpoint: http://127.0.0.1:8899.
In a second terminal, confirm health:
solana cluster-version
solana config get
3. Deploy the ENRG contract
3.1 Build
cd ~/Axis-workspace/ENRG
anchor build
3.2 Configure cluster
Make sure Anchor.toml points at the local validator:

[provider]
cluster = "localnet"
wallet = "<path-to-your-wallet-keypair.json>"

[programs.localnet]
enrg = "<PROGRAM_ID>"
Deploy:

anchor deploy
On success you'll see the newly deployed program ID. If the program has an IDL, anchor deploy also writes target/idl/enrg.json, which anchorpy will use.

3.3 (Optional) one-shot build + deploy
anchor build && anchor deploy
4. First real integration test (Python + anchorpy)
Create ENRG/tests/test_integration_mint_energy.py.

4.1 What the test does
Generates an Ed25519 keypair on the device side (representing the proving device).
Signs a Proof with that key, producing a signature.
Sends the Proof to the oracle (Axis-core running locally).
Receives back an Attestation + decision.
Connects to the local validator via AnchorPy.
Calls the ENRG program's mint_energy instruction through Anchor.
Verifies that SRC tokens were minted to the recipient account.
4.2 Helper: sign a Proof (Ed25519)
from solders.keypair import Keypair
from solders.signature import Signature
from nacl.signing import SigningKey


def sign_proof(device_keypair: Keypair, message_bytes: bytes) -> str:
    signing_key = SigningKey(bytes(device_keypair.secret()))
    signed = signing_key.sign(message_bytes)
    return bytes(signed.signature).hex()
The message to sign is typically the canonical serialization of the proof body (device_id, nonce, timestamp, payload). Match the exact bytes your axis_core attestation flow expects — reuse the same canonical encoder to avoid signature-mismatch rejections.

4.3 Oracle call (Axis-core)
Run Axis-core locally (e.g. uvicorn axis_core.main:app) then call the attest endpoint:

import httpx

BASE = "http://127.0.0.1:8000"

def attest(proof: dict) -> dict:
    r = httpx.post(f"{BASE}/oracle/attest", json=proof)
    r.raise_for_status()
    return r.json()

# returned body contains attestation_id, decision {allowed, reason, max_power_kw, ...},
# and oracle_signature
4.4 Anchor program call (mint_energy)
import asyncio
from solders.pubkey import Pubkey
from anchorpy import Provider, Wallet, Program

PROGRAM_ID = Pubkey.from_string("<ENRG_PROGRAM_ID>")
LOCAL_RPC = "http://127.0.0.1:8899"


async def mint_energy(
    provider: Provider,
    program: Program,
    att: dict,
    recipient: Pubkey,
) -> dict:
    return await program.rpc["mint_energy"](
        # instruction args, e.g.:
        amount=att["decision"]["max_power_kw"],
        # accounts map:
        accounts={
            "recipient": recipient,
            # token_account, authority, ... as defined by the ENRG program
        },
    )


async def main():
    # Device keypair
    device_kp = Keypair()
    # ... build & sign proof, call attest() -> att
    att = ...

    # Anchor provider against local validator
    wallet = Wallet(Keypair())
    provider = Provider.local(LOCAL_RPC, wallet)
    # idl loaded from ENRG/target/idl/enrg.json
    idl = Program.fetch_idl(PROGRAM_ID, provider)
    program = Program(idl, PROGRAM_ID, provider)

    recipient = Pubkey.from_string("<recipient_address>")

    tx = await mint_energy(provider, program, att, recipient)
    print("mint_energy tx:", tx)

    # Verify SRC tokens exist / balance
    # (query the token account via solana.rpc.api.RpcClient or solders)


if __name__ == "__main__":
    asyncio.run(main())
⚠️ Map the actual ENRG instruction args and account names to the real program — replace the placeholders above (amount, accounts, recipient) with fields from ENRG/contracts/enrg/src/lib.rs.

4.5 Verify SRC tokens
After mint_energy, query the recipient's token account balance and assert it is greater than 0:

from solana.rpc.api import Client

client = Client(LOCAL_RPC)

def get_token_balance(client: Client, token_account: Pubkey) -> int:
    resp = client.get_token_account_balance(token_account)
    return resp.value.amount if resp.value else 0
Wrap the whole flow in a pytest test with pytest.mark.asyncio.

5. Run
cd ~/Axis-workspace/ENRG
# 1) validator must be running (separate terminal)
# 2) oracle must be running on :8000 (separate terminal / via uvicorn)
pytest tests/test_integration_mint_energy.py -v
Troubleshooting
Anchor error: AccountNotInitialized → the token/recipient account wasn't created before mint_energy; add an init step (create associated token account) first.
Signature mismatch → the signed bytes differ from what axis_core canonicalizes; align the encoder.
No program deployed on localnet → run anchor deploy after restarting the validator (state is ephemeral).
IDL not found → run anchor idl init <PROGRAM_ID> -f target/idl/enrg.json.
6. On the path to mainnet
Once the integration test is green locally:

Promote to a CI job running solana-test-validator + anchor deploy automatically.
Add a staging cluster (solana -u devnet) variant of the test.
Then migrate to mainnet-beta with the audited program ID and a funded vault.
Next deliverables after this integration test: on-chain mint_energy receipt spec, SRC token transfer accounting, and an end-to-end pipeline demo.
