import rawIdl from "../target/idl/enrg_mvp.json";
import { patchIdl } from "./helpers/patch-idl";
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadAuthority } from "./helpers/accounts";
import { IdlCoder } from "@coral-xyz/anchor/dist/cjs/coder/borsh/idl.js";

describe("probe4", () => {
  it("find which account fails", () => {
    const idl: any = patchIdl(rawIdl);
    const coder = new (require("@coral-xyz/anchor").BorshCoder)(idl);
    // идем ровно так, как AccountFactory: reduce по accountLayouts
    for (const a of idl.accounts) {
      try {
        const r = IdlCoder.typeSize({ defined: { name: a.name } }, idl);
        const dlen = coder.accounts.accountDiscriminator(a.name).length;
        console.log(a.name.padEnd(26), "discr:", dlen, "typeSize:", typeof r === "number" ? r : JSON.stringify(r));
      } catch(e: any) {
        console.log(a.name.padEnd(26), "FAIL:", e.message);
      }
    }
  });
});
