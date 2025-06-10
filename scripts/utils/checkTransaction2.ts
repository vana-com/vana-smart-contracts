import { ethers } from "hardhat";
import { Contract } from "@ethersproject/contracts";

// const txHash =
//   "0x104f83dde323ded57f930a6a964fb65df4a8f041232b32ba63e21919c3a3029e";
const txHash =
  "0x38e02dbfb79d98804cbfa845ab1c9a592f3a61640fac488a5d07a3a73a043a79";
const contractAddress = "0xff14346dF2B8Fd0c95BF34f1c92e49417b508AD5";
const contractName = "DLPRootImplementation";

async function decodeTxError(): Promise<void> {
  try {
    // Get the transaction
    const tx = await ethers.provider.getTransaction(txHash);
    if (!tx) {
      throw new Error("Transaction not found");
    }

    // Get the transaction receipt
    const receipt = await ethers.provider.getTransactionReceipt(txHash);
    if (!receipt) {
      throw new Error("Transaction receipt not found");
    }

    // If the transaction was successful, return early
    if (receipt.status === 1) {
      console.log("Transaction was successful!");
      return;
    }

    // Get the contract instance
    const [signer] = await ethers.getSigners();
    const contract: Contract = await ethers.getContractAt(
      contractName,
      contractAddress,
      signer,
    );

    // Try to decode the revert reason
    try {
      await tx.wait();
    } catch (error: any) {
      console.log("aaaaaaa");
      // Parse different types of errors
      if (error.data) {
        console.log("bbbbbbbbb");
        // Try to decode custom errors
        try {
          const decodedError = contract.interface.parseError(error.data);
          console.log("Custom Error Name:", decodedError.name);
          console.log("Custom Error Args:", decodedError.args);
        } catch (parseError) {
          // If we can't decode it as a custom error, try to get the revert reason
          const reason = error.data;
          if (typeof reason === "string" && reason.startsWith("0x08c379a0")) {
            // Error string starts after the function selector (4 bytes)
            const abiCoder = new ethers.utils.AbiCoder();
            const decodedReason = abiCoder.decode(
              ["string"],
              "0x" + reason.slice(10),
            );
            console.log("Revert Reason:", decodedReason[0]);
          } else {
            console.log("Raw Error Data:", error.data);
          }
        }
      } else if (error.message) {
        console.log("Error Message:", error.message);
      }
    }

    // Print additional transaction details
    console.log("\nTransaction Details:");
    console.log("Gas Used:", receipt.gasUsed.toString());
    console.log("Block Number:", receipt.blockNumber);
    console.log("From:", tx.from);
    console.log("To:", tx.to);
  } catch (error) {
    console.error(
      "Error analyzing transaction:",
      error instanceof Error ? error.message : error,
    );
  }
}

// Example usage
async function main(): Promise<void> {
  await decodeTxError();
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
