import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import { parseEther } from "../../utils/helpers";
import { parseUnits } from "ethers";

dotenv.config();

async function main() {
  // Specify the private key and transaction details
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as string;
  const customNonce = 400; // Replace with the nonce you want to set
  const provider = ethers.provider;

  // Wallet setup
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`Using wallet: ${wallet.address}`);

  // Override the nonce and send a transaction
  const tx = {
    to: wallet.address, // You can send to the same wallet or specify another address
    value: parseEther("0.01"), // Example amount, can be adjusted
    nonce: customNonce, // Override with the nonce you need
    gasLimit: 21000, // Standard gas limit for simple transfers
    gasPrice: parseUnits("100", "gwei"), // Adjust gas price as needed
  };

  try {
    // Sign and send the transaction
    const txResponse = await wallet.sendTransaction(tx);
    console.log("Transaction sent:", txResponse.hash);

    // Wait for the transaction to be confirmed
    const receipt = await txResponse.wait();
    console.log("Transaction confirmed", receipt);
  } catch (error) {
    console.error("Error sending transaction:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
