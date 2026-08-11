import rawIdl from "../target/idl/enrg_mvp.json";
import { patchIdl } from "./helpers/patch-idl";
import { Program, AnchorProvider, BorshCoder } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadAuthority } from "./helpers/accounts";

describe("probe2", () => {
  it("build Program exactly like the test", () => {
    const idl: any = patchIdl(rawIdl); // мутируем как в тесте
    console.log("after patch: size values:", (idl.accounts as any[]).map((a: any) => `${a.name}:${a.size}`).join(", "));
    try {
      const coder = new BorshCoder(idl);
      console.log("BorshCoder after patch: OK");
      for (const a of idl.accounts as any[]) {
        try { console.log("  ", a.name, "-> size", coder.accounts.size(a.name)); }
        catch(e){ console.log("  ", a.name, "-> THROW", e.message); }
      }
    } catch(e){ console.log("BorshCoder after patch THROW:", e.message); }
  });
});
