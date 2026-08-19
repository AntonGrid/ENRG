"""
ENRG Protocol — End-to-end integration test: mint_energy.

Flow:
  1. Bootstrap protocol (via bootstrap_protocol.init)
  2. Build OracleReport (valid nonce & fresh timestamp)
  3. Sign device message (Ed25519) via the Ed25519 precompile instruction
  4. Call mint_energy in the same transaction (sysvar picks up precompile)
  5. Assert minted energy / state
"""

from __future__ import annotations

import asyncio
import time

import nacl.signing
from nacl.encoding import RawEncoder
from anchorpy import Context
from solders.pubkey import Pubkey
from solders.transaction import Transaction
from solders.instruction import Instruction
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solana.rpc.types import TxOpts

from bootstrap_protocol import ProtocolAccounts, init, le64, le64s

# SPL Token program + Sysvars + Profile program (constants).
TOKEN_PROGRAM_ID = Pubkey.from_string(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
)
ED25519_PROGRAM_ID = Pubkey.from_string(
    "Ed25519SigVerify111111111111111111111111111"
)
ENRG_PROFILE_PROGRAM_ID = Pubkey.from_string(
    "6q8dkGGaTq78oxEfPSgrynSG1D28W65oV667gTockLNH"
)
INSTRUCTIONS_SYSVAR = Pubkey.from_string(
    "Sysvar1nstructions1111111111111111111111111"
)


def build_ed25519_instruction(
    message: bytes,
    signing: nacl.signing.SigningKey,
) -> Instruction:
    """Ed25519 precompile sysvar instruction (see security/ed25519.rs).

    Layout:
      u8 signature_offset, u8 sig_len(64),
      u8 pubkey_offset,    u8 pubkey_len(32),
      u8 message_offset,   u8 message_len,
      16 bytes padding,
      64 bytes signature, 32 bytes pubkey, N bytes message.
    """
    sig = signing.sign(message, encoder=RawEncoder).signature  # 64
    vk = bytes(signing.verify_key)                              # 32

    data = bytearray()
    data.append(1)                          # signature offset
    data.append(64)                         # sig len
    data.append(65)                         # pubkey offset
    data.append(32)                         # pubkey len
    data.append(97)                         # message offset
    data.append(len(message))               # message len
    data.extend(b"\x00" * 16)               # padding
    data.extend(sig)                        # 16..80
    data.extend(vk)                         # 80..112
    data.extend(message)                    # 112....

    return Instruction(program_id=ED25519_PROGRAM_ID, data=bytes(data), accounts=[])


async def main() -> None:
    RPC = "http://127.0.0.1:8899"
    conn = AsyncClient(RPC, Confirmed)

    acc = await init(conn, "target/idl/enrg_mvp.json")
    signing = acc.device_signing  # nacl Ed25519 for the device

    now = int(time.time())
    energy_wh = 1_000_000
    nonce = 1  # must be > producer.nonce (0 after create_producer)

    # message_to_sign(): device_id || nonce LE || device_timestamp LE || energy_wh LE
    message = (
        bytes(acc.device_id)
        + le64(nonce)
        + le64s(now)
        + le64(energy_wh)
    )
    raw_sig = signing.sign(message, encoder=RawEncoder).signature  # 64 bytes

    report = {
        "oracle": acc.oracle,
        "device_id": acc.device_id,
        "nonce": nonce,
        "device_timestamp": now,
        "verified_at": now,
        "energy_wh": energy_wh,
        "device_signature": list(raw_sig),
    }

    ed_ix = build_ed25519_instruction(message, signing)

    mint_ix = acc.program.request(
        "mint_energy",
        args={"report": report},
        accounts={
            "producer": acc.producer,
            "vault": acc.vault,
            "token_mint": acc.token_mint,
            "mint": acc.mint,
            "mint_authority": acc.mint_authority,
            "user_token_account": acc.user_token_account,
            "buyback_account": acc.funds["buyback"],
            "staking_account": acc.funds["staking"],
            "dao_account": acc.funds["dao"],
            "emergency_account": acc.funds["emergency"],
            "instructions": INSTRUCTIONS_SYSVAR,
            "token_program": TOKEN_PROGRAM_ID,
            "profile_program": ENRG_PROFILE_PROGRAM_ID,
            "authority": acc.producer_wallet.pubkey(),
            "profile": acc.profile,
            # ADR-0003: Policy Registry — optional (None = default policies).
            "policy_registry": None,
        },
    ).to_solders()

    tx = Transaction.new_signed(
        [acc.producer_wallet],
        [ed_ix, mint_ix],
        acc.producer_wallet.pubkey(),
    )
    blockhash = (await conn.get_latest_blockhash(Confirmed)).value.blockhash
    resp = await conn.send_transaction(
        tx, blockhash, opts=TxOpts(skip_preflight=True)
    )
    print("tx:", resp.value)
    await conn.confirm_transaction(resp.value, Confirmed)

    # ---- Assertions ----------------------------------------------------------
    producer = await acc.program.account["EnergyProducer"].fetch(acc.producer)
    assert producer.energy_wh == energy_wh, producer.energy_wh
    assert producer.nonce == nonce, producer.nonce
    print("OK: producer.energy_wh =", producer.energy_wh,
          "nonce =", producer.nonce)

    vault = await acc.program.account["Vault"].fetch(acc.vault)
    print("OK: vault.total_proofs =", vault.total_proofs,
          "total_supply =", vault.total_supply)
    print("OK: vault.total_energy_wh =", vault.total_energy_wh)

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
