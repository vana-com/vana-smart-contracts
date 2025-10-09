import { ethers } from "hardhat";

async function main() {
  const contractAddress = "0x8C8788f98385F6ba1adD4234e551ABba0f82Cb7C";

  const abi = [
    "function filesCount() view returns (uint256)"
  ];

  const contract = new ethers.Contract(contractAddress, abi, ethers.provider);

  try {
    const count = await contract.filesCount();
    console.log(`Files count at ${contractAddress}: ${count.toString()}`);
  } catch (error) {
    console.error("Error calling filesCount():", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });