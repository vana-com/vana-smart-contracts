const { ethers } = require("hardhat");

// @ts-ignore
async function main() {
  const provider = ethers.provider;
  const txHash =
    "0xf330e44a1b429714b7defd86e718cd8aa05c08f7b6d8b5145b8af104af9fe764"; // Replace with your transaction hash

  const tx = await provider.getTransaction(txHash);

  try {
    // Fetch the transaction receipt
    const txReceipt = await provider.getTransactionReceipt(txHash);

    console.log(`Checking transaction ${txReceipt}`);

    if (!txReceipt) {
      console.log(`Transaction with hash ${txHash} not found`);
      return;
    }

    // Check if the transaction status is 0 (which means it failed)
    if (txReceipt.status === 0) {
      console.log(`Transaction ${txHash} failed`);

      // Retrieve the transaction details
      const tx = await provider.getTransaction(txHash);

      // Send a call to the transaction to simulate and capture the error
      try {
        await provider.call(tx, tx.blockNumber);
      } catch (error: any) {
        console.log("***********");
        console.log("error.data: ", error.data);
        // Decode the revert reason from the error message
        const revertReason = error.data
          ? ethers.utils.toUtf8String(error.data)
          : error.message;
        console.log(`Revert reason: ${revertReason}`);
      }
    } else {
      console.log(`Transaction ${txHash} succeeded`);
    }
  } catch (error) {
    // @ts-ignore
    console.error(`Error retrieving transaction: ${error.message}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
