import rawIdl from "../target/idl/enrg_mvp.json";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadAuthority } from "./helpers/accounts";

describe("probe8", () => {
  it("new Program WITHOUT patchIdl", () => {
    const idl: any = rawIdl; // без патча
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");
    const provider = new AnchorProvider(connection, new anchor.Wallet(loadAuthority()), { commitment: "confirmed" });
    anchor.setProvider(provider);
    const PROGRAM_ID = new PublicKey("5tTUFoRzB1Z7yjo1WC1LJ7AvRruhFn81nifZ5J564nin");
    try {
      const program = new Program(idl, provider);
      console.log("new Program WITHOUT patch: OK");
    } catch (e: any) {
      console.log("new Program WITHOUT patch FAIL:", e.message);
    }
  });
});
