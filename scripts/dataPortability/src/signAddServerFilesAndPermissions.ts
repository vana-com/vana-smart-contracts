import { ethers } from "ethers";
import {
  CONFIG,
  createServerFilesAndPermissionSignature,
  recoverServerFilesAndPermissionSigner,
  validatePrivateKey,
  formatParamsForJSON,
  ServerFilesAndPermissionData,
} from "./common";

const chainId = 14800; // moksha = 14800, mainnet = 1480

const params: ServerFilesAndPermissionData = {
  nonce: 14n,
  granteeId: 1n,
  grant:
    "https://drive.google.com/uc?id=1RXXRT9oildFjrIjk-t1eEbXVaahNXSN1&export=download",
  fileUrls: [
    "https://drive.google.com/uc?id=1ixCSWVv-Ms86Ax1zAKI2-IKRglkWcW7m&export=download",
  ],
  serverAddress: "0x6F24E31b607b7b7Bd80FE214604E66678c28915E",
  serverUrl: "http://localhost:8000/api/v1",
  serverPublicKey:
    "0xa86a0bd9a447a266a8e3d73bf06c4fd7cf4578b922a0a6cbb1fa08c9266f1ca0b2e587790f3c949e77a8445bcda3de355818ad9f51893776243e6d5dac60b59d",
  filePermissions: [
    [
      {
        account: "0x6F24E31b607b7b7Bd80FE214604E66678c28915E",
        key: "0xa86a0bd9a447a266a8e3d73bf06c4fd7cf4578b922a0a6cbb1fa08c9266f1ca0b2e587790f3c949e77a8445bcda3de355818ad9f51893776243e6d5dac60b59d",
      },
    ],
  ],
};

async function main() {
  // Get private key from command line arguments
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Error: Please provide a private key as an argument");
    console.error(
      "Usage: yarn ts-node scripts/dataPortability/createAddServerFilesAndPermissionsSignature.ts <PRIVATE_KEY>",
    );
    process.exit(1);
  }

  const privateKey = args[0];

  try {
    // Validate private key format
    validatePrivateKey(privateKey);

    console.log("Creating signature for ServerFilesAndPermission...\n");

    // Create wallet from private key
    const wallet = new ethers.Wallet(privateKey);
    console.log("Signer address:", wallet.address);

    // Create signature
    const signature = await createServerFilesAndPermissionSignature(
      params,
      wallet,
      CONFIG.contractAddress,
      chainId,
    );

    console.log("\n✅ Signature created successfully!");
    console.log("\nSignature:", signature);

    // Verify the signature by recovering the signer
    const recoveredSigner = await recoverServerFilesAndPermissionSigner(
      params,
      signature,
      CONFIG.contractAddress,
      chainId,
    );

    console.log("\nVerification:");
    console.log("Recovered signer:", recoveredSigner);
    console.log("Expected signer: ", wallet.address);

    if (recoveredSigner.toLowerCase() === wallet.address.toLowerCase()) {
      console.log("✅ Signature verification successful!");
    } else {
      console.log("❌ Signature verification failed!");
    }

    // Output JSON format for easy copy-paste
    console.log("\n📋 Parameters and signature (JSON format):");
    console.log(
      JSON.stringify(
        {
          contractAddress: CONFIG.contractAddress,
          chainId: chainId,
          params: formatParamsForJSON(params),
          signature,
          signer: wallet.address,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Error creating signature:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
