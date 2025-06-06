import { ethers } from "hardhat";
import { formatEther } from "ethers";

async function main() {
  // Get the signer (wallet) from Hardhat, connected to the specified network
  const [signer] = await ethers.getSigners();

  console.log(
    formatEther(
      await ethers.provider.getBalance(
        "0xB76D909d8BE3B0E2F137e99530A00c95725e2655",
      ),
    ),
  );
  console.log(
    formatEther(
      await ethers.provider.getBalance(
        "0xDBFb6B8b9E2eCAEbdE64d665cD553dB81e524479",
      ),
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
