import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";

export const LAMPORTS = LAMPORTS_PER_SOL;

export function loadAuthority(idPath = `${os.homedir()}/.config/solana/id.json`): Keypair {
  const secret = JSON.parse(fs.readFileSync(idPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export async function ensureFunded(
  connection: Connection,
  account: PublicKey,
  amount = LAMPORTS,
  commitment: "confirmed" | "finalized" = "confirmed"
): Promise<void> {
  const bal = await connection.getBalance(account);
  if (bal < amount) {
    await connection.requestAirdrop(account, amount);
  }
  await waitForBalance(connection, account, amount, commitment);
}

async function waitForBalance(
  connection: Connection,
  account: PublicKey,
  min: number,
  commitment: "confirmed" | "finalized"
): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const bal = await connection.getBalance(account, commitment);
    if (bal >= min) return;
    await sleep(300);
  }
  throw new Error(`airdrop did not credit ${account.toBase58()}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function randomManifestId(): number[] {
  const id = Buffer.alloc(16);
  for (let i = 0; i < id.length; i++) id[i] = Math.floor(Math.random() * 256);
  return Array.from(id);
}
