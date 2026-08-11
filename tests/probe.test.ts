import rawIdl from "../target/idl/enrg_mvp.json";
import { IdlCoder } from "@coral-xyz/anchor/dist/cjs/coder/borsh/idl.js";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadAuthority } from "./helpers/accounts";
import * as anchor from "@coral-xyz/anchor";

describe("probe", () => {
  it("dump idl shape", () => {
    console.log("accounts len:", (rawIdl as any).accounts?.length, "| types len:", (rawIdl as any).types?.length);
    console.log("has default wrapper:", !!(rawIdl as any).default);
    // проверим typeSize как в рантайме
    const { IdlCoder: IC } = require("@coral-xyz/anchor/dist/cjs/coder/borsh/idl.js");
    for (const a of (rawIdl as any).accounts) {
      let sz; try { sz = IC.typeSize({ defined: { name: a.name } }, rawIdl as any); } catch(e){ sz="THROW:"+e.message; }
      if (typeof sz !== "number") console.log("  ", a.name, "->", JSON.stringify(sz));
    }
    console.log("done probe");
  });
});
