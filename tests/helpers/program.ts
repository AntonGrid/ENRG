import path from "node:path";
import * as fs from "node:fs";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BorshCoder } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadAuthority } from "./accounts.ts";
import { patchIdl } from "./patch-idl.ts";

export const PROGRAM_ID = new PublicKey(
  "5tTUFoRzB1Z7yjo1WC1LJ7AvRruhFn81nifZ5J564nin",
);

export const LOCAL_ENDPOINT = "http://127.0.0.1:8899";

const IDL_PATH = path.resolve(__dirname, "../../", "target", "idl", "enrg_mvp.json");

function loadRawIdl(): any {
  return JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
}

function normalizeIdl(rawIdl: any): Record<string, unknown> {
  const compat = patchIdl(rawIdl); // <-- ключ: чинит accounts.type/size
  return {
    version: compat.version ?? "0.0.0",
    name: compat.name ?? "enrg_mvp",
    address: compat.address ?? PROGRAM_ID.toBase58(),
    instructions: Array.isArray(compat.instructions) ? compat.instructions : [],
    accounts: Array.isArray(compat.accounts) ? compat.accounts : [],
    types: Array.isArray(compat.types) ? compat.types : [],
    events: Array.isArray(compat.events) ? compat.events : [],
    errors: Array.isArray(compat.errors) ? compat.errors : [],
    metadata: compat.metadata ?? { address: PROGRAM_ID.toBase58() },
  };
}

export interface ProgramHandle {
  program: Program | null;
  coder: BorshCoder;
  connection: Connection;
  provider: AnchorProvider;
  idl: Record<string, unknown>;
  full: boolean;
  rawFallback: boolean;
}

export function getProgram(): ProgramHandle {
  const connection = new Connection(LOCAL_ENDPOINT, "confirmed");
  const provider = new AnchorProvider(
    connection,
    new anchor.Wallet(loadAuthority()),
    { commitment: "confirmed" },
  );
  anchor.setProvider(provider);

  const idl = normalizeIdl(loadRawIdl());
  const coder = new BorshCoder(idl as anchor.Idl);

  try {
    const program = new Program(idl as anchor.Idl, PROGRAM_ID, provider, coder);
    return { program, coder, connection, provider, idl, full: true, rawFallback: false };
  } catch (e: any) {
    console.warn("[getProgram] full Program failed → raw fallback:", e?.message);
    return { program: null, coder, connection, provider, idl, full: false, rawFallback: true };
  }
}

export { anchor };
