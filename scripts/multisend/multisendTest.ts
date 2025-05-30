import { ethers } from "hardhat";
import { parseEther } from "ethers";

async function main() {
  const [deployer] = await ethers.getSigners();

  const multisend = await ethers.getContractAt(
    "MultisendImplementation",
    "0x8807e8BCDFbaA8c2761760f3FBA37F6f7F2C5b2d",
  );
  // Generate 500 random wallet addresses
  const wallets: string[] = [];
  const amounts: bigint[] = [];

  // Starting amount in wei (0.00000001 ETH = 10 gwei)
  let currentAmount = ethers.parseUnits("0.00000001", "ether");
  const incrementAmount = ethers.parseUnits("0.00000001", "ether");

  console.log("Generating test wallets and amounts...");

  for (let i = 0; i < 2; i++) {
    // Generate a new random wallet
    const wallet = ethers.Wallet.createRandom();
    wallets.push(wallet.address);

    // Add amount for this wallet
    amounts.push(currentAmount);

    currentAmount = currentAmount + incrementAmount;
  }

  // Calculate total amount needed
  const totalAmount = amounts.reduce((a, b) => a + b, parseEther("0"));

  console.log(`Total amount needed: ${ethers.formatEther(totalAmount)} ETH`);
  console.log(`Number of addresses: ${wallets.length}`);
  console.log("First few addresses and amounts for verification:");

  try {
    console.log("Creating transactions...");

    // Create transaction object
    const txData = await multisend
      .connect(deployer)
      .multisendVanaWithDifferentAmounts.populateTransaction(amounts, wallets, {
        value: totalAmount,
        gasLimit: 30000000,
      });

    console.log("\nRaw Transaction before signing:");
    console.log(txData);

    // Get the raw transaction
    const rawTx = await deployer.signTransaction(txData);
    console.log("\nRaw Transaction:");
    console.log(rawTx);

    return;

    console.log("Sending transactions...");
    const tx = await multisend
      .connect(deployer)
      .multisendVanaWithDifferentAmounts(amounts, wallets, {
        value: totalAmount,
        gasLimit: 30000000, // Adjust based on your network
      });

    console.log("Transaction sent! Waiting for confirmation...");
    await tx.wait();
    console.log(`Transaction confirmed! Hash: ${tx.hash}`);
  } catch (error) {
    console.error("Error during execution:");
    console.error(error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
