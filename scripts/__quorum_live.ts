/** Live quorum check: register a device (owner=founder), send the SAME proof
 *  to BOTH Render oracles, watch votes -> finalized -> mint. */
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import * as nacl from "tweetnacl";
import fs from "fs";
import { patchIdl } from "../tests/helpers/patch-idl";

const RPC = "https://api.devnet.solana.com";
const PROG = new PublicKey("HkuC3FTGAf9ryPqH7fi3RbUHwP4TKFMg5WgHNWm6Vaxb");
const PROFILE = new PublicKey("78FUdpHn7pWPjnDhA8RWCsXxZq6r4wVPtCcsEKBBvhUt");
const FOUNDER = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("/home/enrg/keys/enrg-mainnet/founder-keypair.json","utf8"))));
const URLS = ["https://enrg-oracle.onrender.com", "https://enrg-oracle-2.onrender.com"];

const conn = new Connection(RPC, "confirmed");
const provider = new AnchorProvider(conn, new Wallet(FOUNDER), { commitment:"confirmed" });
const idl = JSON.parse(fs.readFileSync("idls/enrg_mvp.json","utf8")); idl.address = PROG.toBase58();
const program = new Program(patchIdl(idl), provider);
const edix = (msg: Buffer, kp: Keypair) => Ed25519Program.createInstructionWithPublicKey({ publicKey: kp.publicKey.toBytes(), message: msg, signature: nacl.sign.detached(msg, kp.secretKey) });
const le8 = (n: number|BN) => Buffer.from((n instanceof BN ? n : new BN(n)).toArrayLike(Buffer, "le", 8));
const find = (p: PublicKey, s: Buffer) => PublicKey.findProgramAddressSync([s], p)[0];

async function main() {
  const device = Keypair.generate();
  const did = device.publicKey;
  const [producer] = PublicKey.findProgramAddressSync([Buffer.from("producer"), did.toBytes()], PROG);
  const [ownerDev] = PublicKey.findProgramAddressSync([Buffer.from("owner-devices"), FOUNDER.publicKey.toBytes()], PROG);
  const profile = PublicKey.findProgramAddressSync([Buffer.from("profile"), FOUNDER.publicKey.toBytes()], PROFILE)[0];
  console.log("device:", did.toBase58(), "| producer:", producer.toBase58());

  const ts = new BN(Math.floor(Date.now()/1000));
  const regMsg = Buffer.concat([Buffer.from("enrg:device:register"), did.toBytes(), le8(ts)]);
  await program.methods.registerDevice(Array.from(nacl.sign.detached(regMsg, device.secretKey)), ts)
    .accounts({ operator: FOUNDER.publicKey, producer, deviceId: did, instructions: SYSVAR_INSTRUCTIONS_PUBKEY, systemProgram: SystemProgram.programId })
    .preInstructions([edix(regMsg, device)]).signers([FOUNDER]).rpc();
  console.log("✅ register");

  const cNonce = new BN(1);
  const claimMsg = Buffer.concat([Buffer.from("enrg:device:claim"), did.toBytes(), FOUNDER.publicKey.toBytes(), le8(cNonce), le8(ts)]);
  await program.methods.claimDevice(Array.from(nacl.sign.detached(claimMsg, device.secretKey)), cNonce, ts)
    .accounts({ authority: FOUNDER.publicKey, producer, ownerDevices: ownerDev, instructions: SYSVAR_INSTRUCTIONS_PUBKEY })
    .preInstructions([edix(claimMsg, device)]).signers([FOUNDER]).rpc();
  console.log("✅ claim (owner=founder)");

  await program.methods.provisionDevice().accounts({ authority: FOUNDER.publicKey, producer }).signers([FOUNDER]).rpc();
  await program.methods.activateDevice().accounts({ authority: FOUNDER.publicKey, producer, ownerDevices: ownerDev }).signers([FOUNDER]).rpc();
  console.log("✅ provision + activate");

  const profIdl = JSON.parse(fs.readFileSync("idls/enrg_profile.json","utf8")); profIdl.address = PROFILE.toBase58();
  const profProg = new Program(profIdl, provider);
  if (!(await conn.getAccountInfo(profile))) {
    await program.methods.initEnergyProfile().accounts({ authority: FOUNDER.publicKey, producer, profileProgram: PROFILE, profile, systemProgram: SystemProgram.programId }).signers([FOUNDER]).rpc();
    console.log("✅ profile created");
  }
  // rated_power must be > 0 for mint (immutable after set)
  try {
    const pr: any = await (profProg.account as any).energyProfile.fetch(profile);
    if (!pr.ratedPower || pr.ratedPower.isZero()) {
      await profProg.methods.updateMetadata(new BN(1_000_000), "e2e-solar-panel", "devnet-e2e").accounts({ authority: FOUNDER.publicKey, profile }).signers([FOUNDER]).rpc();
      console.log("✅ rated_power=1_000_000 set");
    } else { console.log("rated_power already", pr.ratedPower.toString()); }
  } catch(e:any) { console.log("profile fetch skipped:", e.message.slice(0,60)); }

  const energyWh = 5000; const nonce = 1;
  const dmsg = Buffer.concat([did.toBytes(), le8(nonce), le8(ts), le8(energyWh)]);
  const sig = Buffer.from(nacl.sign.detached(dmsg, device.secretKey)).toString("base64");
  const payload = { device_id: did.toBase58(), timestamp: ts.toNumber(), energyWh, nonce, signature: sig };
  console.log("payload:", JSON.stringify({...payload, signature: sig.slice(0,12)+"..."}));
  fs.writeFileSync("/tmp/live-proof.json", JSON.stringify({...payload, device_id_pubkey: did.toBase58()}));

  for (const u of URLS) {
    try {
      const r = await fetch(u + "/api/v1/proof/submit", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(payload) });
      console.log(u.split("//")[1], "->", r.status, await r.text());
    } catch (e:any) { console.log(u, "ERR", e.message); }
  }
  console.log("DONE. device=", did.toBase58(), "nonce=1 | ts=", ts.toString(), "| energyWh=", energyWh);
}
main().catch((e)=>{ console.error("❌", e.message); process.exit(1); });
