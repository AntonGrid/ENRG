import rawIdl from "../target/idl/enrg_mvp.json";
import { patchIdl } from "./helpers/patch-idl";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BorshCoder } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadAuthority } from "./helpers/accounts";

describe("probe3", () => {
  it("new Program like the test", () => {
    const idl: any = patchIdl(rawIdl);
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");
    const provider = new AnchorProvider(connection, new anchor.Wallet(loadAuthority()), { commitment: "confirmed" });
    anchor.setProvider(provider);
    const PROGRAM_ID = new PublicKey("9rVoqWPSRQpMN8qbqD9DfMTUcs1qXDELZPF1eVGowsXF");
    try {
      const program = new Program(idl, provider);
      console.log("new Program OK");
    } catch (e: any) {
      console.log("new Program FAIL:", e.message);
      console.log("STACK:", (e.stack||"").split("\n").slice(0,8).join("\n"));
    }
  });
});
