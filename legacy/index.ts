import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { EnrgMvp } from "../target/types/enrg_mvp";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

async function main() {
    const provider = anchor.AnchorProvider.local();
    anchor.setProvider(provider);
    const program = anchor.workspace.EnrgMvp as Program<EnrgMvp>;

    const authority = anchor.web3.Keypair.generate();

    const airdropSig = await provider.connection.requestAirdrop(
        authority.publicKey,
        2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    console.log("Authority pubkey:", authority.publicKey.toBase58());

    const [producerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("producer"), authority.publicKey.toBuffer()],
        program.programId
    );

    console.log("Creating producer...");
    await program.methods
        .createProducer()
        .accounts({
            producer: producerPda,
            authority: authority.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

    let producerAccount = await program.account.energyProducer.fetch(producerPda);
    console.log("Producer after creation:", {
        authority: producerAccount.authority.toBase58(),
        energyProduced: producerAccount.energyProduced.toNumber(),
    });

    console.log("Adding energy 100...");
    await program.methods
        .addEnergy(new anchor.BN(100))
        .accounts({
            producer: producerPda,
            authority: authority.publicKey,
        })
        .signers([authority])
        .rpc();

    producerAccount = await program.account.energyProducer.fetch(producerPda);
    console.log("Producer after adding energy:", {
        authority: producerAccount.authority.toBase58(),
        energyProduced: producerAccount.energyProduced.toNumber(),
    });

    console.log("MVP test finished successfully.");
}

main().catch(console.error);
