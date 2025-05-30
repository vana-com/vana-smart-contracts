import { ethers } from "hardhat";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const contractAddress = "0xF084Ca24B4E29Aa843898e0B12c465fAFD089965";

// Main execution
async function main(): Promise<void> {
  const provider = ethers.provider;

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as string;

  // Setup provider and signer
  const signer = new ethers.Wallet(privateKey, provider);

  // Contract ABI - just the function we need
  const abi = [
    "function updateTrustedForwarder(address trustedForwarderAddress) external",
  ] as const;

  // Create contract instance
  const teePool = new ethers.Contract(contractAddress, abi, signer);

  try {
    // Send transaction
    const tx =
      await teePool.updateTrustedForwarder(
        0x0000000000000000000000000000000000000000,
      );
    console.log("Transaction sent:", tx.hash);

    // Wait for transaction to be mined
    const receipt = await tx.wait();
    console.log("Transaction confirmed in block:", receipt.blockNumber);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    } else {
      console.error("Unknown error:", error);
    }
    throw error;
  }
}

// Execute with error handling
main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
