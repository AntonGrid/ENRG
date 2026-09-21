"""
ENRG Protocol — Integration Bootstrapper (all seeds confirmed from Rust).

PDA seeds (from programs/enrg-mvp/src):
  vault            = [b"vault"]
  token_mint       = [b"token-mint"]
  mint             = [b"src-mint"]
  mint_authority   = [b"mint-authority"]
  buyback_authority= [b"fund-buyback"]
  producer         = [b"producer", <producer_wallet.pubkey()>]
  profile          = [b"profile",  <producer_wallet.pubkey()>]
  oracle_registry  = [b"oracle-registry"]
  config           = [b"config"]

Flow (per IDL enrg_mvp.json):
  1. initialize_token
  2. initialize_vault
  3. create 4 fund ATAs + user ATA
  4. initialize_funds
  5. initialize_oracle_registry + add_oracle
  6. init_config
  7. initialize_manifest_registry
  8. create_producer (+ activate)
"""

from __future__ import annotations

from dataclasses import dataclass, field

import nacl.signing
from nacl.encoding import RawEncoder

import anchorpy
from anchorpy import Context, Idl, Program
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.system_program import ID as SYSTEM_PROGRAM
from solders.sysvar import RENT
from solders.token.associated import get_associated_token_address
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed

# SPL Token program (constant address; avoids solders.token.constants).
TOKEN_PROGRAM_ID = Pubkey.from_string(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
)

# ---- Seeds (match Rust) -----------------------------------------------------
SEED_VAULT = b"vault"
SEED_TOKEN_MINT = b"token-mint"
SEED_SRC_MINT = b"src-mint"
SEED_MINT_AUTHORITY = b"mint-authority"
SEED_BUYBACK_AUTHORITY = b"fund-buyback"
SEED_PRODUCER = b"producer"
SEED_PROFILE = b"profile"
SEED_ORACLE_REGISTRY = b"oracle-registry"
SEED_CONFIG = b"config"

FUND_ROLES = {
    "buyback": b"fund-buyback",
    "staking": b"fund-staking",
    "dao": b"fund-dao",
    "emergency": b"fund-emergency",
}


def le64(v: int) -> bytes:
    return v.to_bytes(8, "little")


def le64s(v: int) -> bytes:
    return (v & 0xFFFFFFFFFFFFFFFF).to_bytes(8, "little")


def find_pda(program_id: Pubkey, seeds: list[bytes]) -> tuple[Pubkey, int]:
    return Pubkey.find_program_address(seeds, program_id)


@dataclass
class ProtocolAccounts:
    program: Program
    provider: anchorpy.Provider
    deployer: Keypair
    oracle: Pubkey
    producer_wallet: Keypair
    device_kp: Keypair
    device_signing: nacl.signing.SigningKey
    device_id: Pubkey
    vault: Pubkey
    token_mint: Pubkey
    mint: Pubkey
    mint_authority: Pubkey
    buyback_authority: Pubkey
    oracle_registry: Pubkey
    config: Pubkey
    producer: Pubkey
    profile: Pubkey
    user_token_account: Pubkey
    funds: dict[str, Pubkey]
    fund_owners: dict[str, Pubkey]
    bumps: dict[str, int] = field(default_factory=dict)


async def load_program(idl_path: str, connection: AsyncClient) -> Program:
    with open(idl_path) as f:
        idl = Idl.from_json(f.read())
    return Program(idl, Pubkey.from_string(idl.address),
                   anchorpy.Provider(connection, None))


async def _ensure_ata(connection, owner: Pubkey, mint: Pubkey, payer: Keypair) -> Pubkey:
    from solana.transaction import Transaction
    from solders.token.associated import create_associated_token_account
    ata = get_associated_token_address(owner, mint)
    ix = create_associated_token_account(payer.pubkey(), owner, mint)
    tx = Transaction.new_signed([payer], [ix], payer.pubkey())
    await connection.send_transaction(tx, Confirmed)
    return ata


async def airdrop_many(connection, keys, lamports=10_000_000_000):
    for k in keys:
        await connection.request_airdrop(k, lamports, Confirmed)


async def init(connection: AsyncClient, idl_path: str) -> ProtocolAccounts:
    program = await load_program(idl_path, connection)
    provider = program.provider
    pid = program.program_id

    deployer = Keypair()
    oracle_kp = Keypair()
    producer_wallet = Keypair()
    device_kp = Keypair()
    device_id = device_kp.pubkey()

    await airdrop_many(connection, [deployer.pubkey(), oracle_kp.pubkey(),
                                    producer_wallet.pubkey()])

    # ---- PDAs ---------------------------------------------------------------
    vault, vb = find_pda(pid, [SEED_VAULT])
    token_mint, tmb = find_pda(pid, [SEED_TOKEN_MINT])
    mint, mb = find_pda(pid, [SEED_SRC_MINT])
    mint_authority, mab = find_pda(pid, [SEED_MINT_AUTHORITY])
    buyback_authority, bb = find_pda(pid, [SEED_BUYBACK_AUTHORITY])
    oracle_registry, orb = find_pda(pid, [SEED_ORACLE_REGISTRY])
    config, cb = find_pda(pid, [SEED_CONFIG])
    producer, pb = find_pda(pid, [SEED_PRODUCER, bytes(producer_wallet.pubkey())])
    profile, pfb = find_pda(pid, [SEED_PROFILE, bytes(producer_wallet.pubkey())])

    fund_owners = {role: find_pda(pid, [seed])[0]
                   for role, seed in FUND_ROLES.items()}
    funds = {role: get_associated_token_address(owner, mint)
             for role, owner in fund_owners.items()}
    user_token_account = get_associated_token_address(producer_wallet.pubkey(), mint)

    device_signing = nacl.signing.SigningKey(
        bytes(device_kp.to_bytes())[:32], encoder=RawEncoder)

    acc = ProtocolAccounts(
        program=program, provider=provider, deployer=deployer,
        oracle=oracle_kp.pubkey(), producer_wallet=producer_wallet,
        device_kp=device_kp, device_signing=device_signing, device_id=device_id,
        vault=vault, token_mint=token_mint, mint=mint,
        mint_authority=mint_authority, buyback_authority=buyback_authority,
        oracle_registry=oracle_registry, config=config,
        producer=producer, profile=profile,
        user_token_account=user_token_account, funds=funds,
        fund_owners=fund_owners,
        bumps={"vault": vb, "token_mint": tmb, "mint": mb,
               "mint_authority": mab, "buyback_authority": bb,
               "oracle_registry": orb, "config": cb,
               "producer": pb, "profile": pfb},
    )

    # ---- ATAs ---------------------------------------------------------------
    await _ensure_ata(connection, producer_wallet.pubkey(), mint, producer_wallet)
    for role, ata in funds.items():
        await _ensure_ata(connection, fund_owners[role], mint, deployer)

    # ---- 1. initialize_token -------------------------------------------------
    await program.rpc["initialize_token"](
        ctx=Context(
            accounts={
                "token_mint": token_mint, "mint": mint,
                "mint_authority": mint_authority,
                "buyback_authority": buyback_authority,
                "authority": deployer.pubkey(),
                "token_program": TOKEN_PROGRAM_ID,
                "system_program": SYSTEM_PROGRAM, "rent": RENT,
            },
            signers=[deployer],
        )
    )

    # ---- 2. initialize_vault -------------------------------------------------
    await program.rpc["initialize_vault"](
        ctx=Context(
            accounts={
                "vault": vault, "authority": deployer.pubkey(),
                "mint": mint, "token_mint": token_mint,
                "system_program": SYSTEM_PROGRAM,
            },
            signers=[deployer],
        )
    )

    # ---- 3. initialize_funds -------------------------------------------------
    await program.rpc["initialize_funds"](
        ctx=Context(
            accounts={
                "vault": vault, "token_mint": token_mint, "mint": mint,
                "vault_authority": vault,
                "buyback_account": funds["buyback"],
                "staking_account": funds["staking"],
                "dao_account": funds["dao"],
                "emergency_account": funds["emergency"],
                "authority": deployer.pubkey(),
                "token_program": TOKEN_PROGRAM_ID,
                "system_program": SYSTEM_PROGRAM,
            },
            signers=[deployer],
        )
    )

    # ---- 4. oracle registry + add_oracle -------------------------------------
    await program.rpc["initialize_oracle_registry"](
        ctx=Context(
            accounts={"registry": oracle_registry,
                      "authority": deployer.pubkey(),
                      "system_program": SYSTEM_PROGRAM},
            signers=[deployer],
        )
    )
    await program.rpc["add_oracle"](
        ctx=Context(accounts={"registry": oracle_registry,
                              "authority": deployer.pubkey()},
                    args={"oracle": oracle_kp.pubkey()},
                    signers=[deployer])
    )

    # ---- 5. init_config ------------------------------------------------------
    await program.rpc["init_config"](
        ctx=Context(accounts={"config": config,
                              "authority": deployer.pubkey(),
                              "system_program": SYSTEM_PROGRAM},
                    args={"oracle": oracle_kp.pubkey(), "mint": mint},
                    signers=[deployer])
    )

    # ---- 6. manifest registry ------------------------------------------------
    manifest_reg, _ = find_pda(pid, [b"manifest-registry"])
    try:
        await program.rpc["initialize_manifest_registry"](
            ctx=Context(accounts={"registry": manifest_reg,
                                  "authority": deployer.pubkey(),
                                  "system_program": SYSTEM_PROGRAM},
                        signers=[deployer])
        )
    except Exception as e:
        print(f"[warn] initialize_manifest_registry: {e}")

    # ---- 7. create_producer + activate ---------------------------------------
    await program.rpc["create_producer"](
        ctx=Context(accounts={"producer": producer,
                              "authority": producer_wallet.pubkey(),
                              "system_program": SYSTEM_PROGRAM},
                    args={"device_id": device_id},
                    signers=[producer_wallet])
    )
    try:
        await program.rpc["activate_device"](
            ctx=Context(accounts={"authority": producer_wallet.pubkey(),
                                  "producer": producer},
                        signers=[producer_wallet])
        )
    except Exception as e:
        print(f"[warn] activate_device: {e}")

    # ---- 8. user ATA (final) -------------------------------------------------
    await _ensure_ata(connection, producer_wallet.pubkey(), mint, producer_wallet)

    return acc
