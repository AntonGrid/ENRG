import rawPath from "node:path";
import * as fs from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { BorshCoder, Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { patchIdl } from "./patch-idl.ts";

const IDL_PATH = rawPath.resolve(__dirname, "../../", "target", "idl", "enrg_mvp.json");
const idl = patchIdl(JSON.parse(fs.readFileSync(IDL_PATH, "utf8")));

const PROGRAM_ID = new PublicKey("5tTUFoRzB1Z7yjo1WC1LJ7AvRruhFn81nifZ5J564nin");
const connection = new Connection("http://127.0.0.1:8899", "confirmed");

function probe(step: string, fn: () => void) {
  try { fn(); console.log("OK  :", step); }
  catch (e: any) { console.log("FAIL:", step, "→", e?.message); }
}

probe("coder.instructions", () => { const c = new BorshCoder(idl as any); c.instructions; });
probe("coder.accounts.size Vault", () => {
  const c = new BorshCoder(idl as any);
  const size = c.accounts.size("Vault");
  console.log("  size:", size);
});
