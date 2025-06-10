import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import { parseEther } from "../../utils/helpers";
import { parseUnits } from "ethers";

dotenv.config();

async function main() {
  try {
    // Specify the private key and transaction details
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY as string;
    const provider = ethers.provider;
    const contractAddress = "0xff14346dF2B8Fd0c95BF34f1c92e49417b508AD5";
    const trustedForwarderAddress =
      "0x2AC93684679a5bdA03C6160def908CdB8D46792f";
    const data =
      "0xf90b031100000000000000000000000000000000000000002AC93684679a5bdA03C6160def908CdB8D46792f";
    // const data = "contract.connect("2AC93684679a5bdA03C6160def908CdB8D46792f").grantRole(DEFAULT_ADMIN_ROLE, 'fd3E61C018Ea22Cea7CB15f35cc968F39dC2c3F4')";

    // Wallet setup
    const trustedForwarder = new ethers.Wallet(privateKey, provider);

    console.log(`Using wallet: ${trustedForwarder.address}`);

    if (
      trustedForwarderAddress.toLowerCase() !==
      trustedForwarder.address.toLowerCase()
    ) {
      throw new Error("Invalid wallet address");
    }

    // Create the transaction
    const tx = {
      to: contractAddress,
      from: trustedForwarder.address,
      data: data,
    };

    // Send the transaction
    console.log("Sending transaction...");
    const transaction = await trustedForwarder.sendTransaction(tx);

    const receipt = await transaction.wait();

    console.log("Transaction hash: ", transaction.hash);
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
