import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import fs from "fs";
import bs58 from "bs58";

// Device ID из логов ESP32 (hex строка без 0x)
const DEVICE_ID_HEX = "cbec5afc382549012faf845ab25f593fe8f119d2ceb93f34ed308c283521584a";

// Конвертируем hex → Buffer → base58
const deviceIdBuffer = Buffer.from(DEVICE_ID_HEX, "hex");
const deviceIdBase58 = bs58.encode(deviceIdBuffer);
const DEVICE_ID = new PublicKey(deviceIdBase58);

console.log("📝 Device ID (base58):", deviceIdBase58);

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/enrg_mvp.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  const [producerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("producer"), DEVICE_ID.toBuffer()],
    program.programId
  );

  const [ownerDevicesPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("owner-devices"), provider.wallet.publicKey.toBuffer()],
    program.programId
  );

  console.log("📝 Registering device:", DEVICE_ID.toBase58());
  console.log("📝 Producer PDA:", producerPda.toBase58());
  console.log("📝 Owner Devices PDA:", ownerDevicesPda.toBase58());

  // Шаг 1: Регистрация устройства
  await program.methods
    .registerDevice(DEVICE_ID)
    .accounts({
      producer: producerPda,
      operator: provider.wallet.publicKey,
      ownerDevices: ownerDevicesPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  console.log("✅ Device registered");

  // Шаг 2: Привязка к владельцу (Claim)
  await program.methods
    .claimDevice(DEVICE_ID)
    .accounts({
      producer: producerPda,
      operator: provider.wallet.publicKey,
      ownerDevices: ownerDevicesPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  console.log("✅ Device claimed");

  // Шаг 3: Настройка (Provision)
  await program.methods
    .provisionDevice(DEVICE_ID)
    .accounts({
      producer: producerPda,
      operator: provider.wallet.publicKey,
    })
    .rpc();
  console.log("✅ Device provisioned");

  // Шаг 4: Активация (Activate)
  await program.methods
    .activateDevice(DEVICE_ID)
    .accounts({
      producer: producerPda,
      operator: provider.wallet.publicKey,
    })
    .rpc();
  console.log("✅ Device activated");

  console.log("🎉 Device is ready to send proofs!");
}

main().catch(console.error);
