import rawIdl from "../target/idl/enrg_mvp.json";
import { patchIdl } from "./helpers/patch-idl";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BorshCoder } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadAuthority } from "./helpers/accounts";
const bc = BorshCoder as any;

describe("probe5", () => {
  it("instrument accounts.size", () => {
    const idl: any = patchIdl(rawIdl);
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");
    const provider = new AnchorProvider(connection, new anchor.Wallet(loadAuthority()), { commitment: "confirmed" });
    anchor.setProvider(provider);
    const PROGRAM_ID = new PublicKey("9rVoqWPSRQpMN8qbqD9DfMTUcs1qXDELZPF1eVGowsXF");

    // инструментируем AccountsCoder.size через prototype
    const proto = (bc.prototype as any).accounts?.constructor?.prototype;
    try {
      const origSize = bc.prototype.accounts.constructor.prototype.size;
      bc.prototype.accounts.constructor.prototype.size = function (name: string) {
        console.log("size() called for:", name);
        const r = origSize.apply(this, arguments);
        console.log("  ->", r);
        return r;
      };
    } catch(e) { console.log("instrument failed:", (e as any).message); }

    try {
      const program = new Program(idl, provider);
      console.log("new Program OK");
    } catch (e: any) {
      console.log("new Program FAIL:", e.message);
    }
  });
});
