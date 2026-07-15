import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { EnrgMvp } from "../target/types/enrg_mvp";

describe("enrg-mvp", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.EnrgMvp as Program<EnrgMvp>;

  it("Is initialized!", async () => {
    // Simple test to verify program deployment
    const tx = await program.methods.initializeVault().rpc();
    console.log("Your transaction signature", tx);
  });
});
