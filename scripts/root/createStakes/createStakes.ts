import { ethers } from "ethers";
import dotenv from "dotenv";
import { parseEther } from "../../../utils/helpers";

// Load environment variables
dotenv.config();

// Contract ABI
const DLP_ROOT_ABI = [
  "function createStakes(address[] memory stakers, uint256[] memory dlpIds, uint256[] memory amounts) external",
];

// Configuration from environment variables
const PROVIDER_URL = process.env.JSON_RPC_URL ?? "";
const DLP_ROOT_ADDRESS = process.env.DLP_ROOT_ADDRESS2 ?? "";

if (!PROVIDER_URL || !DLP_ROOT_ADDRESS) {
  throw new Error("Missing required environment variables");
}

// Private keys from environment variables
const PRIVATE_KEYS = [
  process.env.CALLER1_PRIVATE_KEY,
  process.env.CALLER2_PRIVATE_KEY,
  process.env.CALLER3_PRIVATE_KEY,
  process.env.CALLER4_PRIVATE_KEY,
  process.env.CALLER5_PRIVATE_KEY,
].filter((key): key is string => !!key);

if (PRIVATE_KEYS.length !== 5) {
  throw new Error("All 5 caller private keys are required");
}

// Staker addresses (ensure they are checksummed)
const STAKERS = [
  "0xc04D0694f3E9D8c90584467c52427765a5e225b8",
  "0xB9c314b7D148DAA5f51C1a75DE443eb16DD74Bb4",
  "0x0E31A8c186B1a2D6B58eBcC9366753a8c7194D0D",
  "0x06e1b04723a45E93e58036540C13f411E1FA4319",
  "0x940f2D0480B8ce0fc890542a875CF658DCd2C910",
  "0x09303C5093b140d595AB30467Ee5A9Edd54187B5",
  "0x745EF006D5cA2444B8419414fA4d49CAa02454E9",
  "0xb816674d14bc95f973200b524C32916E77992b9e",
  "0x854217dbE05c1aD37733e37cC560f26bbe734f18",
  "0xD0fCCc3ADB1D35397c180c900E3F33Cc3f34E133",
].map((addr) => ethers.getAddress(addr));

const DLP_COUNT = 5;
const STAKES_PER_BATCH = 100; // Changed from 50 to 100
const TOTAL_STAKES = 1_000_000;

async function main() {
  // Initialize provider
  const provider = new ethers.JsonRpcProvider(PROVIDER_URL);

  // Create wallet instances
  const wallets = PRIVATE_KEYS.map((pk) => new ethers.Wallet(pk, provider));

  // Initialize contract instances
  const dlpRootContracts = wallets.map(
    (wallet) => new ethers.Contract(DLP_ROOT_ADDRESS, DLP_ROOT_ABI, wallet),
  );

  let successfulTxs = 0;
  let failedTxs = 0;
  let currentBatch = 0;
  let totalStakesCreated = 0;

  // Process stakes in batches until we reach TOTAL_STAKES
  while (totalStakesCreated < TOTAL_STAKES) {
    const callerIndex = currentBatch % 5; // Rotate through callers
    const dlpRootContract = dlpRootContracts[callerIndex];

    // Prepare batch data
    const stakers: string[] = [];
    const dlpIds: number[] = [];
    const amounts: bigint[] = [];

    // Fill the batch with stakes (now 100 per batch)
    for (
      let i = 0;
      i < STAKES_PER_BATCH && totalStakesCreated < TOTAL_STAKES;
      i++
    ) {
      // Calculate indices cycling through stakers and DLPs
      const stakerIndex =
        Math.floor(totalStakesCreated / DLP_COUNT) % STAKERS.length;
      const dlpIndex = totalStakesCreated % DLP_COUNT;

      const stakerMultiplier = stakerIndex + 1;
      const dlpMultiplier = dlpIndex + 1;
      const amount = parseEther(stakerMultiplier * dlpMultiplier); // Amount in wei

      stakers.push(STAKERS[stakerIndex]);
      dlpIds.push(dlpIndex + 1); // DLP IDs start from 1
      amounts.push(amount);
      totalStakesCreated++;
    }

    try {
      console.log(`\nProcessing batch ${currentBatch + 1}`);
      console.log(`Caller: ${wallets[callerIndex].address}`);
      console.log(`Stakes in batch: ${stakers.length}`);
      console.log(`Total stakes created: ${totalStakesCreated}`);
      console.log(
        `Progress: ${((totalStakesCreated * 100) / TOTAL_STAKES).toFixed(2)}%`,
      );

      const tx = await dlpRootContract.createStakes(stakers, dlpIds, amounts, {
        maxFeePerGas: 2000000000,
        maxPriorityFeePerGas: 1000000000,
      });
      console.log(`Transaction hash: ${tx.hash}`);

      // Wait for transaction confirmation
      // const receipt = await tx.wait(1);
      // console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      successfulTxs++;
    } catch (error) {
      console.error(`Error in batch ${currentBatch + 1}:`, error);
      totalStakesCreated -= stakers.length; // Revert the count for failed batch
      failedTxs++;
    }

    currentBatch++;

    // Wait for 1 second before next transaction
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  console.log("\nStaking process completed!");
  console.log(`Successful transactions: ${successfulTxs}`);
  console.log(`Failed transactions: ${failedTxs}`);
  console.log(`Total batches processed: ${currentBatch}`);
  console.log(`Total stakes created: ${totalStakesCreated}`);
}

// Error handling wrapper
main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
