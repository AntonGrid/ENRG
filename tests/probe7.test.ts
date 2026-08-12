import rawIdl from "../target/idl/enrg_mvp.json";
import { patchIdl } from "./helpers/patch-idl";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadAuthority } from "./helpers/accounts";

describe("probe7", () => {
  it("full stack", () => {
    const idl: any = patchIdl(rawIdl);
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");
    const provider = new AnchorProvider(connection, new anchor.Wallet(loadAuthority()), { commitment: "confirmed" });
    anchor.setProvider(provider);
    const PROGRAM_ID = new PublicKey("9rVoqWPSRQpMN8qbqD9DfMTUcs1qXDELZPF1eVGowsXF");
    const program = new Program(idl, provider);
    console.log("new Program OK");
  });
});
