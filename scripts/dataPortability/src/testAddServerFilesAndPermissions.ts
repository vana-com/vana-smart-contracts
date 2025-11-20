import {
  CONFIG,
  recoverServerFilesAndPermissionSigner,
  ServerFilesAndPermissionData,
} from "./common";

const chainId = 14800; // moksha = 14800, mainnet = 1480

const signature =
  "0x166a3935ffe801719af0a8ae8a0809aa6d2df9c8a6c9678efd194b43fcaf7c75274177b4f85d6844acbd1fb748d508527de75b2002a0be68a20fe9f1c89f78ce1b";
const expectedSigner = "0xDaCe34231AFbcc6afd770B67B6704CDFB50a2651";

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
  console.log("Testing signer recovery...\n");

  try {
    const signer = await recoverServerFilesAndPermissionSigner(
      params,
      signature,
      CONFIG.contractAddress,
      chainId,
    );

    console.log("Recovered signer address:", signer);
    console.log("Expected signer address:", expectedSigner);

    // Verify if the recovered signer matches the expected signer
    if (signer.toLowerCase() === expectedSigner.toLowerCase()) {
      console.log(
        "\n✅ Signature verification successful! Signer matches expected address.",
      );
    } else {
      console.log(
        "\n❌ Signature verification failed! Signer does not match expected address.",
      );
      console.log(`   Expected: ${expectedSigner}`);
      console.log(`   Got:      ${signer}`);
    }
  } catch (error) {
    console.error("Error recovering signer:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
