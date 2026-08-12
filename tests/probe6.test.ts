import rawIdl from "../target/idl/enrg_mvp.json";
import { patchIdl } from "./helpers/patch-idl";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadAuthority } from "./helpers/accounts";

describe("probe6", () => {
  it("intercept IdlCoder.typeSize during new Program", () => {
    const IdlCoder = require("@coral-xyz/anchor/dist/cjs/coder/borsh/idl.js").IdlCoder;
    const orig = IdlCoder.typeSize;
    let calls = 0;
    (IdlCoder as any).typeSize = function (type: any, idl: any, fields?: any[]) {
      calls++;
      try {
        const r = orig.call(this, type, idl, fields);
        if (calls <= 30) console.log("#" + calls, "type:", JSON.stringify(type).slice(0,60), "->", typeof r === "number" ? r : JSON.stringify(r));
        return r;
      } catch (e: any) {
        console.log("#" + calls, "type:", JSON.stringify(type).slice(0,60), "THROW:", e.message);
        throw e;
      }
    };

    const idl: any = patchIdl(rawIdl);
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");
    const provider = new AnchorProvider(connection, new anchor.Wallet(loadAuthority()), { commitment: "confirmed" });
    anchor.setProvider(provider);
    const PROGRAM_ID = new PublicKey("9rVoqWPSRQpMN8qbqD9DfMTUcs1qXDELZPF1eVGowsXF");
    try {
      const program = new Program(idl, provider);
      console.log("new Program OK, total typeSize calls:", calls);
    } catch (e: any) {
      console.log("new Program FAIL after", calls, "typeSize calls:", e.message);
    }
  });
});
