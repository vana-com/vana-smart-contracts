import { ethers } from "hardhat";

async function main() {
  // Get the contract instance
  const teePoolAddress = "0x3c92fD91639b41f13338CE62f19131e7d19eaa0D"; // Replace with actual contract address
  const TeePool = await ethers.getContractAt(
    "TeePoolImplementation",
    teePoolAddress,
  );

  // List of addresses to check
  const addressesToCheck = [""];

  console.log("Checking addresses...\n");

  for (const address of addressesToCheck) {
    try {
      const isTee = await TeePool.isTee(address);
      console.log(
        `Address ${address}: ${isTee ? "is a Tee" : "is not an active Tee"}`,
      );

      // if (isTee) {
      //   // Get additional TEE details if it is a TEE
      //   const teeInfo = await TeePool.tees(address);
      //   console.log("TEE Details:");
      //   console.log(`- URL: ${teeInfo.url}`);
      //   console.log(`- Status: ${teeInfo.status}`);
      //   console.log(`- Jobs Count: ${teeInfo.jobsCount}`);
      //   console.log(`- Public Key: ${teeInfo.publicKey}\n`);
      // }
    } catch (error) {
      console.error(`Error checking address ${address}:`, error);
    }
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
