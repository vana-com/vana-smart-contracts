import { ethers } from "hardhat";

// Contract addresses
const VANA_EPOCH_ADDRESS = "0x2063cFF0609D59bCCc196E20Eb58A8696a6b15A0";
const DLP_REWARD_DEPLOYER_ADDRESS = "0xEFD0F9Ba9De70586b7c4189971cF754adC923B04";

// Target epoch
const EPOCH_ID = 6;

// Contract ABIs (without bonusAmount since it's not deployed yet)
const VANA_EPOCH_ABI = [
  "function epochDlpIds(uint256 epochId) external view returns (uint256[])",
  "function epochDlps(uint256 epochId, uint256 dlpId) external view returns (tuple(bool isTopDlp, uint256 rewardAmount, uint256 penaltyAmount, uint256 distributedAmount, uint256 distributedPenaltyAmount))",
  "function epochs(uint256 epochId) external view returns (tuple(uint256 startBlock, uint256 endBlock, uint256 rewardAmount, bool isFinalized))"
];

const DLP_REWARD_DEPLOYER_ABI = [
  "function epochDlpRewards(uint256 epochId, uint256 dlpId) external view returns (tuple(uint256 totalDistributedAmount, uint256 distributedPenaltyAmount, uint256 tranchesCount))",
  "function epochDlpDistributedRewards(uint256 epochId, uint256 dlpId) external view returns (tuple(uint256 amount, uint256 blockNumber, uint256 tokenRewardAmount, uint256 spareToken, uint256 spareVana, uint256 usedVanaAmount)[])"
];

// Types
interface TrancheData {
  amount: bigint;
  blockNumber: bigint;
  tokenRewardAmount: bigint;
  spareToken: bigint;
  spareVana: bigint;
  usedVanaAmount: bigint;
}

interface DlpStatistics {
  dlpId: number;
  totalReward: bigint;
  totalPenalty: bigint;
  totalDistributed: bigint;
  numberOfTranches: number;
  sumOfAllTrancheAmounts: bigint;
  sumOfAllSpareVana: bigint;
  sumOfAllUsedVana: bigint;
}

// Helper function to format values with raw wei and rounded
function formatValue(value: bigint): string {
  const rounded = parseFloat(ethers.formatEther(value)).toFixed(2);
  return `${value.toString()} wei (${rounded} VANA)`;
}

async function getEpochStatistics() {
  console.log("\n" + "=".repeat(80));
  console.log(`EPOCH ${EPOCH_ID} REWARD DISTRIBUTION STATISTICS`);
  console.log("=".repeat(80));

  // Get signer
  const [signer] = await ethers.getSigners();

  // Connect to contracts
  const vanaEpoch = new ethers.Contract(VANA_EPOCH_ADDRESS, VANA_EPOCH_ABI, signer);
  const dlpRewardDeployer = new ethers.Contract(DLP_REWARD_DEPLOYER_ADDRESS, DLP_REWARD_DEPLOYER_ABI, signer);

  // Get epoch info
  const epochInfo = await vanaEpoch.epochs(EPOCH_ID);
  console.log(`\nEpoch Information:`);
  console.log(`  Start Block: ${epochInfo.startBlock}`);
  console.log(`  End Block: ${epochInfo.endBlock}`);
  console.log(`  Total Reward Amount: ${formatValue(epochInfo.rewardAmount)}`);
  console.log(`  Is Finalized: ${epochInfo.isFinalized}`);

  // Get all DLP IDs in the epoch
  const dlpIds = await vanaEpoch.epochDlpIds(EPOCH_ID);
  console.log(`  Number of DLPs: ${dlpIds.length}`);

  console.log("\n" + "-".repeat(80));
  console.log("DLP STATISTICS");
  console.log("-".repeat(80));

  const dlpStatsList: DlpStatistics[] = [];

  // Aggregate totals
  let totalRewardsAllDlps = BigInt(0);
  let totalPenaltiesAllDlps = BigInt(0);
  let totalDistributedAllDlps = BigInt(0);
  let totalSpareVanaAllDlps = BigInt(0);
  let totalUsedVanaAllDlps = BigInt(0);
  let totalTranchesAllDlps = 0;

  // Process each DLP
  for (const dlpId of dlpIds) {
    // Get DLP epoch info
    const dlpEpochInfo = await vanaEpoch.epochDlps(EPOCH_ID, dlpId);

    // Get DLP reward info
    const dlpRewardInfo = await dlpRewardDeployer.epochDlpRewards(EPOCH_ID, dlpId);

    // Get distributed rewards (tranches)
    const tranches: TrancheData[] = await dlpRewardDeployer.epochDlpDistributedRewards(EPOCH_ID, dlpId);

    // Calculate statistics
    let sumTrancheAmounts = BigInt(0);
    let sumSpareVana = BigInt(0);
    let sumUsedVana = BigInt(0);

    for (const tranche of tranches) {
      sumTrancheAmounts += tranche.amount;
      sumSpareVana += tranche.spareVana;
      sumUsedVana += tranche.usedVanaAmount;
    }

    // Store DLP statistics
    const dlpStats: DlpStatistics = {
      dlpId: Number(dlpId),
      totalReward: dlpEpochInfo.rewardAmount,
      totalPenalty: dlpEpochInfo.penaltyAmount,
      totalDistributed: dlpRewardInfo.totalDistributedAmount,
      numberOfTranches: Number(dlpRewardInfo.tranchesCount),
      sumOfAllTrancheAmounts: sumTrancheAmounts,
      sumOfAllSpareVana: sumSpareVana,
      sumOfAllUsedVana: sumUsedVana
    };

    dlpStatsList.push(dlpStats);

    // Update aggregates
    totalRewardsAllDlps += dlpStats.totalReward;
    totalPenaltiesAllDlps += dlpStats.totalPenalty;
    totalDistributedAllDlps += dlpStats.totalDistributed;
    totalSpareVanaAllDlps += dlpStats.sumOfAllSpareVana;
    totalUsedVanaAllDlps += dlpStats.sumOfAllUsedVana;
    totalTranchesAllDlps += dlpStats.numberOfTranches;

    // Print DLP statistics
    console.log(`\nDLP ID ${dlpId}:`);
    console.log(`  Total Reward:              ${formatValue(dlpStats.totalReward)}`);
    console.log(`  Total Penalty:             ${formatValue(dlpStats.totalPenalty)}`);
    console.log(`  Total Distributed:         ${formatValue(dlpStats.totalDistributed)}`);
    console.log(`  Number of Tranches:        ${dlpStats.numberOfTranches}`);
    console.log(`  Sum of Tranche Amounts:    ${formatValue(dlpStats.sumOfAllTrancheAmounts)}`);
    console.log(`  Sum of Spare VANA:         ${formatValue(dlpStats.sumOfAllSpareVana)}`);
    console.log(`  Sum of Used VANA:          ${formatValue(dlpStats.sumOfAllUsedVana)}`);
  }

  // Print summary
  console.log("\n" + "=".repeat(80));
  console.log("AGGREGATE SUMMARY");
  console.log("=".repeat(80));

  console.log(`\nTotal Rewards (All DLPs):     ${formatValue(totalRewardsAllDlps)}`);
  console.log(`Total Penalties (All DLPs):   ${formatValue(totalPenaltiesAllDlps)}`);
  console.log(`Total Distributed (All DLPs): ${formatValue(totalDistributedAllDlps)}`);
  console.log(`Total Tranches (All DLPs):    ${totalTranchesAllDlps}`);
  console.log(`Total Spare VANA (All DLPs):  ${formatValue(totalSpareVanaAllDlps)}`);
  console.log(`Total Used VANA (All DLPs):   ${formatValue(totalUsedVanaAllDlps)}`);

  console.log("\n" + "-".repeat(80));
  console.log("KEY METRICS");
  console.log("-".repeat(80));

  const dlpsWithSpareVana = dlpStatsList.filter(dlp => dlp.sumOfAllSpareVana > BigInt(0));
  const dlpsWithPenalties = dlpStatsList.filter(dlp => dlp.totalPenalty > BigInt(0));

  console.log(`\nDLPs with spare VANA: ${dlpsWithSpareVana.length} out of ${dlpStatsList.length}`);
  console.log(`DLPs with penalties: ${dlpsWithPenalties.length} out of ${dlpStatsList.length}`);

  // Export to JSON
  const jsonResults = {
    epochId: EPOCH_ID,
    epochInfo: {
      startBlock: epochInfo.startBlock.toString(),
      endBlock: epochInfo.endBlock.toString(),
      totalRewardAmount: {
        wei: epochInfo.rewardAmount.toString(),
        vana: parseFloat(ethers.formatEther(epochInfo.rewardAmount)).toFixed(2)
      },
      isFinalized: epochInfo.isFinalized
    },
    aggregateStatistics: {
      totalDlps: dlpStatsList.length,
      totalRewards: {
        wei: totalRewardsAllDlps.toString(),
        vana: parseFloat(ethers.formatEther(totalRewardsAllDlps)).toFixed(2)
      },
      totalPenalties: {
        wei: totalPenaltiesAllDlps.toString(),
        vana: parseFloat(ethers.formatEther(totalPenaltiesAllDlps)).toFixed(2)
      },
      totalDistributed: {
        wei: totalDistributedAllDlps.toString(),
        vana: parseFloat(ethers.formatEther(totalDistributedAllDlps)).toFixed(2)
      },
      totalTranches: totalTranchesAllDlps,
      totalSpareVana: {
        wei: totalSpareVanaAllDlps.toString(),
        vana: parseFloat(ethers.formatEther(totalSpareVanaAllDlps)).toFixed(2)
      },
      totalUsedVana: {
        wei: totalUsedVanaAllDlps.toString(),
        vana: parseFloat(ethers.formatEther(totalUsedVanaAllDlps)).toFixed(2)
      },
      dlpsWithSpareVana: dlpsWithSpareVana.length,
      dlpsWithPenalties: dlpsWithPenalties.length
    },
    dlpDetails: dlpStatsList.map(dlp => ({
      dlpId: dlp.dlpId,
      totalReward: {
        wei: dlp.totalReward.toString(),
        vana: parseFloat(ethers.formatEther(dlp.totalReward)).toFixed(2)
      },
      totalPenalty: {
        wei: dlp.totalPenalty.toString(),
        vana: parseFloat(ethers.formatEther(dlp.totalPenalty)).toFixed(2)
      },
      totalDistributed: {
        wei: dlp.totalDistributed.toString(),
        vana: parseFloat(ethers.formatEther(dlp.totalDistributed)).toFixed(2)
      },
      numberOfTranches: dlp.numberOfTranches,
      sumOfAllTrancheAmounts: {
        wei: dlp.sumOfAllTrancheAmounts.toString(),
        vana: parseFloat(ethers.formatEther(dlp.sumOfAllTrancheAmounts)).toFixed(2)
      },
      sumOfAllSpareVana: {
        wei: dlp.sumOfAllSpareVana.toString(),
        vana: parseFloat(ethers.formatEther(dlp.sumOfAllSpareVana)).toFixed(2)
      },
      sumOfAllUsedVana: {
        wei: dlp.sumOfAllUsedVana.toString(),
        vana: parseFloat(ethers.formatEther(dlp.sumOfAllUsedVana)).toFixed(2)
      }
    }))
  };

  // Write to file
  const fs = (await import("fs")).default;
  const outputPath = `./epoch_${EPOCH_ID}_statistics.json`;
  fs.writeFileSync(outputPath, JSON.stringify(jsonResults, null, 2));

  console.log(`\n${"=".repeat(80)}`);
  console.log(`Results exported to: ${outputPath}`);
  console.log(`${"=".repeat(80)}\n`);
}

// Run the script
getEpochStatistics()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });