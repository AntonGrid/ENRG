import rawIdl from "../target/idl/enrg_mvp.json";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BorshCoder } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadAuthority } from "./helpers/accounts";

describe("probe9", () => {
  it("new Program WITH explicit BorshCoder", () => {
    const idl: any = rawIdl;
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");
    const provider = new AnchorProvider(connection, new anchor.Wallet(loadAuthority()), { commitment: "confirmed" });
    anchor.setProvider(provider);
    const PROGRAM_ID = new PublicKey("5tTUFoRzB1Z7yjo1WC1LJ7AvRruhFn81nifZ5J564nin");
    // создаём BorshCoder явно и прогоняем size для ВСЕХ, как это делает AccountFactory.
    // Program внутри camelCase'ит IDL, поэтому coder должен строиться из
    // camelCase-версии, иначе имена аккаунтов (Config vs config) не совпадут.
    try {
      const { convertIdlToCamelCase } = require("@coral-xyz/anchor/dist/cjs/idl.js");
      const camelIdl: any = convertIdlToCamelCase(idl);
      const coder = new BorshCoder(camelIdl as any);
      for (const acc of camelIdl.accounts) {
        console.log(acc.name.padEnd(26), "coder.accounts.size =>", coder.accounts.size(acc.name));
      }
      console.log("all manual size OK — теперь new Program");
      const program = new Program(idl, provider, coder);
      console.log("new Program WITH coder: OK");
    } catch (e: any) {
      console.log("FAIL:", e.message);
    }
  });
});
