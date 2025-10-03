import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, network, upgrades } from "hardhat";
import {
  DLPRegistryImplementation,
  VanaEpochImplementation,
  TreasuryImplementation,
  DLPPerformanceImplementation,
  DLPRewardDeployerImplementation,
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  advanceBlockNTimes,
  advanceToBlockN,
  getCurrentBlockNumber,
} from "../../utils/timeAndBlockManipulation";
import { getReceipt, parseEther } from "../../utils/helpers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { formatEther } from "ethers";
import { TickMath as UniswapTickMath } from "@uniswap/v3-sdk";
import { TickMath } from "@uniswap/v3-sdk";

chai.use(chaiAsPromised);
should();

describe("DLP fork tests", () => {
  const vanaEpochAddress = "0x2063cFF0609D59bCCc196E20Eb58A8696a6b15A0";
  const treasuryAddress = "0xb12ce1d27bEeFe39b6F0110b1AB77C21Aa0c9F9a";
  const dlpRegistryAddress = "0x4D59880a924526d1dD33260552Ff4328b1E18a43";
  const dlpPerformanceAddress = "0x847715C7DB37cF286611182Be0bD333cbfa29cc1";
  const dlpRewardDeployerAddress = "0xEFD0F9Ba9De70586b7c4189971cF754adC923B04";
  const dlpRewardDeployerTreasuryAddress =
    "0xb547ca8Fe4990fe330FeAeb1C2EBb42F925Af5b8";

  const adminAddress = "0x2AC93684679a5bdA03C6160def908CdB8D46792f";
  const wvanaAddress = "0x00eddd9621fb08436d0331c149d1690909a5906d";
  // Position Manager contract address (Ethereum mainnet)
  const uniswapPositionManagerAddress =
    "0x45a2992e1bFdCF9b9AcE0a84A238f2E56F481816";
  const uniswapFactoryAddress = "0xc2a0d530e57b1275fbce908031da636f95ea1e38";

  enum DlpStatus {
    None,
    Registered,
    Eligible,
    Deregistered,
  }

  type DlpInfo = {
    dlpAddress: string;
    ownerAddress: HardhatEthersSigner;
    treasuryAddress: string;
    tokenAddress: string;
    name: string;
    lpTokenId: bigint;
  };

  let admin: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let manager: HardhatEthersSigner;

  let dlpRegistry: DLPRegistryImplementation;
  let vanaEpoch: VanaEpochImplementation;
  let treasury: TreasuryImplementation;
  let dlpPerformance: DLPPerformanceImplementation;
  let dlpRewardDeployer: DLPRewardDeployerImplementation;

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );
  const MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MANAGER_ROLE"));
  const CUSTODIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CUSTODIAN_ROLE"));

  type DlpRegistration = {
    dlpAddress: string;
    ownerAddress: HardhatEthersSigner;
    treasuryAddress: string;
    name: string;
    iconUrl: string;
    website: string;
    metadata: string;
  };

  type DlpPerformanceInput = {
    dlpId: number;
    totalScore: bigint;
    tradingVolume: bigint;
    uniqueContributors: bigint;
    dataAccessFees: bigint;
  };

  let dlp1Info: DlpRegistration;
  let dlp2Info: DlpRegistration;

  const deploy = async () => {
    await helpers.mine();
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [adminAddress],
    });
    admin = await ethers.provider.getSigner(adminAddress);

    dlpRegistry = await ethers.getContractAt(
      "DLPRegistryImplementation",
      dlpRegistryAddress,
    );
    vanaEpoch = await ethers.getContractAt(
      "VanaEpochImplementation",
      vanaEpochAddress,
    );
    treasury = await ethers.getContractAt(
      "TreasuryImplementation",
      treasuryAddress,
    );
    dlpPerformance = await ethers.getContractAt(
      "DLPPerformanceImplementation",
      dlpPerformanceAddress,
    );

    dlpRewardDeployer = await ethers.getContractAt(
      "DLPRewardDeployerImplementation",
      dlpRewardDeployerAddress,
    );

    await setBalance(adminAddress, parseEther(100));
  };

  async function advanceToEpochN(epochNumber: number) {}

  describe("Tests", () => {
    beforeEach(async () => {
      await deploy();
    });

    it.only("simulate epoch end", async function () {
      // ============================================================================
      // CONTRACT UPGRADES
      // ============================================================================

      await upgradeContracts();

      // ============================================================================
      // EPOCH PREPARATION
      // ============================================================================

      const epochId = 6n; //await vanaEpoch.epochsCount();
      const currentBlock = await getCurrentBlockNumber();
      const epoch = await vanaEpoch.epochs(epochId);

      logEpochInfo(epochId, epoch, currentBlock);

      // ============================================================================
      // ADVANCE TO EPOCH END
      // ============================================================================

      // await advanceToBlockN(Number(epoch.endBlock) + 1);
      await dlpPerformance.connect(admin).confirmEpochFinalScores(epochId);

      // ============================================================================
      // PROCESS ELIGIBLE DLPS
      // ============================================================================

      const eligibleDlps = await vanaEpoch.epochDlpIds(epochId);
      console.log(
        `\n📊 There are ${eligibleDlps.length} eligible DLPs in epoch ${epochId}\n`,
      );

      const dlpMap = await buildDlpMap(eligibleDlps);

      // Get performance data for sorting
      const dlpPerformanceData = await Promise.all(
        eligibleDlps.map(async (dlpId) => ({
          dlpId,
          performance: await dlpPerformance.epochDlpPerformances(
            epochId,
            dlpId,
          ),
        })),
      );

      // Sort by totalScore in descending order
      const sortedDlps = dlpPerformanceData.sort((a, b) => {
        const scoreA = BigInt(a.performance.totalScore);
        const scoreB = BigInt(b.performance.totalScore);
        return scoreA > scoreB ? -1 : scoreA < scoreB ? 1 : 0;
      });

      console.log("DLPs ranked by Total Score (highest to lowest):\n");

      const totals = {
        dataAccessFees: 0n,
        tradingVolume: 0n,
        uniqueContributors: 0n,
      };

      for (let i = 0; i < sortedDlps.length; i++) {
        const { dlpId } = sortedDlps[i];
        const performance = await logDlpDetailsWithRank(
          epochId,
          dlpId,
          dlpMap[Number(dlpId)],
          i + 1,
        );

        // Accumulate totals
        totals.dataAccessFees += performance.dataAccessFees;
        totals.tradingVolume += performance.tradingVolume;
        totals.uniqueContributors += BigInt(performance.uniqueContributors);
      }

      // Log summary totals
      logEpochSummary(eligibleDlps.length, totals);
    });

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /**
     * Upgrades all necessary contracts to their latest implementations
     */
    async function upgradeContracts(): Promise<void> {
      await vanaEpoch
        .connect(admin)
        .upgradeToAndCall(
          await ethers.deployContract("VanaEpochImplementation"),
          "0x",
        );

      await dlpPerformance
        .connect(admin)
        .upgradeToAndCall(
          await ethers.deployContract("DLPPerformanceImplementation"),
          "0x",
        );

      await dlpRewardDeployer
        .connect(admin)
        .upgradeToAndCall(
          await ethers.deployContract("DLPRewardDeployerImplementation"),
          "0x",
        );

      await dlpRegistry
        .connect(admin)
        .upgradeToAndCall(
          await ethers.deployContract("DLPRegistryImplementation"),
          "0x",
        );
    }

    /**
     * Logs current epoch information in a formatted way
     */
    function logEpochInfo(
      epochId: bigint,
      epoch: any,
      currentBlock: number,
    ): void {
      const timeToEndSeconds = (Number(epoch.endBlock) - currentBlock) * 6;
      const timeToEndFormatted = formatTime(timeToEndSeconds);

      console.log("📅 EPOCH INFORMATION");
      console.log(`Current Epoch ID: ${epochId}`);
      console.log(`Reward Amount: ${formatEther(epoch.rewardAmount)} VANA`);
      console.log(`Ends in: ${timeToEndFormatted}`);
      console.log(`End Block: ${epoch.endBlock} (current: ${currentBlock})`);
      console.log("═".repeat(50) + "\n");
    }

    /**
     * Builds a map of DLP information for easier access
     */
    async function buildDlpMap(
      eligibleDlps: readonly bigint[],
    ): Promise<Record<number, DlpInfo>> {
      const dlpMap: Record<number, DlpInfo> = {};

      for (const dlpId of eligibleDlps) {
        const dlp = await dlpRegistry.dlps(dlpId);
        dlpMap[Number(dlpId)] = {
          dlpAddress: dlp.dlpAddress,
          ownerAddress: await ethers.getSigner(dlp.ownerAddress),
          tokenAddress: dlp.tokenAddress,
          treasuryAddress: dlp.treasuryAddress,
          name: dlp.name,
          lpTokenId: dlp.lpTokenId,
        };
      }

      return dlpMap;
    }

    /**
     * Logs detailed information for a specific DLP with ranking
     * Returns the performance data for totals calculation
     */
    async function logDlpDetailsWithRank(
      epochId: bigint,
      dlpId: bigint,
      dlpInfo: DlpInfo,
      rank: number,
    ): Promise<any> {
      console.log(`#${rank} - dlpId: ${dlpId} (${dlpInfo.name})`);

      // Basic DLP Info
      logDlpBasicInfo(dlpInfo);

      // Performance Metrics
      const dlpPerformances = await dlpPerformance.epochDlpPerformances(
        epochId,
        dlpId,
      );
      logDlpPerformance(dlpPerformances);

      // Detailed Reward Breakdown
      await logDetailedDlpRewards(epochId, dlpId, dlpPerformances);

      // Reward Information
      const epochDlp = await vanaEpoch.epochDlps(epochId, dlpId);
      logDlpRewards(epochDlp);

      console.log("━".repeat(60) + "\n");

      return dlpPerformances;
    }

    /**
     * Logs detailed information for a specific DLP
     * Returns the performance data for totals calculation
     */
    async function logDlpDetails(
      epochId: bigint,
      dlpId: bigint,
      dlpInfo: DlpInfo,
    ): Promise<any> {
      console.log(`🏢 DLP #${dlpId}: ${dlpInfo.name}`);
      console.log("━".repeat(60));

      // Basic DLP Info
      logDlpBasicInfo(dlpInfo);

      // Performance Metrics
      const dlpPerformances = await dlpPerformance.epochDlpPerformances(
        epochId,
        dlpId,
      );
      logDlpPerformance(dlpPerformances);

      // Reward Information
      const epochDlp = await vanaEpoch.epochDlps(epochId, dlpId);
      logDlpRewards(epochDlp);

      console.log("━".repeat(60) + "\n");

      return dlpPerformances;
    }

    /**
     * Logs basic DLP information
     */
    function logDlpBasicInfo(dlpInfo: DlpInfo): void {
      console.log("📋 Basic Information:");
      // console.log(`  dlpAddress: ${dlpInfo.dlpAddress}`);
      // console.log(`  Owner: ${dlpInfo.ownerAddress.address}`);
      console.log(`  TokenAddress: ${dlpInfo.tokenAddress}`);
      console.log(`  LP Token ID: ${dlpInfo.lpTokenId}`);
      console.log("");
    }

    /**
     * Logs DLP performance metrics in Slack-friendly format
     */
    function logDlpPerformance(performance: any): void {
      console.log("📊 Performance Metrics:");
      console.log(
        `  • Data Access Fees: ${formatEther(performance.dataAccessFees)} VANA`,
      );
      console.log(
        `    Data Access Fees Score: ${formatEther(performance.dataAccessFeesScore)}`,
      );
      console.log(
        `    Data Access Fees Penalty: -${formatEther(performance.dataAccessFeesScorePenalty)}`,
      );

      console.log(
        `  • Trading Volume: ${formatEther(performance.tradingVolume)} USD`,
      );
      console.log(
        `    Trading Volume Score: ${formatEther(performance.tradingVolumeScore)}`,
      );
      console.log(
        `    Trading Volume Penalty: -${formatEther(performance.tradingVolumeScorePenalty)}`,
      );

      console.log(`  • Unique Contributors: ${performance.uniqueContributors}`);
      console.log(
        `    Unique Contributors Score: ${formatEther(performance.uniqueContributorsScore)}`,
      );
      console.log(
        `    Unique Contributors Penalty: -${formatEther(performance.uniqueContributorsScorePenalty)}`,
      );

      console.log(`  Total Score: ${formatEther(performance.totalScore)}`);
      console.log("");
    }

    /**
     * Logs detailed DLP reward breakdown by metric
     */
    async function logDetailedDlpRewards(
      epochId: bigint,
      dlpId: bigint,
      performance: any,
    ): Promise<void> {
      const epoch = await vanaEpoch.epochs(epochId);
      const metricWeights = await dlpPerformance.metricWeights();

      const epochRewardAmount = epoch.rewardAmount;

      // Calculate individual metric rewards
      const dataAccessFeesRewardAmount =
        (epochRewardAmount * metricWeights.dataAccessFees) / BigInt(1e18);
      const tradingVolumeRewardAmount =
        (epochRewardAmount * metricWeights.tradingVolume) / BigInt(1e18);
      const uniqueContributorsRewardAmount =
        (epochRewardAmount * metricWeights.uniqueContributors) / BigInt(1e18);

      const dataAccessFeesReward =
        (performance.dataAccessFeesScore * dataAccessFeesRewardAmount) /
        BigInt(1e18);
      const tradingVolumeReward =
        (performance.tradingVolumeScore * tradingVolumeRewardAmount) /
        BigInt(1e18);
      const uniqueContributorsReward =
        (performance.uniqueContributorsScore * uniqueContributorsRewardAmount) /
        BigInt(1e18);

      console.log("🔍 Detailed Reward Breakdown:");
      console.log(
        `    Data Access Fees Reward: ${formatEther(dataAccessFeesReward)} VANA`,
      );
      console.log(
        `    Trading Volume Reward: ${formatEther(tradingVolumeReward)} VANA`,
      );
      console.log(
        `    Unique Contributors Reward: ${formatEther(uniqueContributorsReward)} VANA`,
      );
      console.log("");
    }

    /**
     * Logs DLP reward information
     */
    function logDlpRewards(epochDlp: any): void {
      const finalReward = epochDlp.rewardAmount - epochDlp.penaltyAmount;

      console.log("💰 Rewards:");
      console.log(
        `  • Base Reward: ${formatEther(epochDlp.rewardAmount)} VANA`,
      );

      console.log(`  • Penalty: -${formatEther(epochDlp.penaltyAmount)} VANA`);

      console.log(`  • Final Reward: ${formatEther(finalReward)} VANA`);
    }

    /**
     * Logs epoch summary with total performance metrics
     */
    function logEpochSummary(
      dlpCount: number,
      totals: {
        dataAccessFees: bigint;
        tradingVolume: bigint;
        uniqueContributors: bigint;
      },
    ): void {
      console.log("📈 EPOCH SUMMARY");
      console.log("🏆 Total Performance Metrics:");
      console.log(
        `  • Total Data Access Fees: ${formatEther(totals.dataAccessFees)} VANA`,
      );
      console.log(
        `  • Total Trading Volume: ${formatEther(totals.tradingVolume)} USD`,
      );
      console.log(
        `  • Total Unique Contributors: ${totals.uniqueContributors.toString()}`,
      );
      console.log("═".repeat(50) + "\n");
    }

    /**
     * Formats time duration in seconds to a human-readable format
     * @param totalSeconds - Total seconds to format
     * @returns Formatted time string (e.g., "2d 3h 45m 30s")
     */
    function formatTime(totalSeconds: number): string {
      if (totalSeconds <= 0) {
        return "0s";
      }

      const days = Math.floor(totalSeconds / 86400); // 24 * 60 * 60
      const hours = Math.floor((totalSeconds % 86400) / 3600); // 60 * 60
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      const parts: string[] = [];

      if (days > 0) parts.push(`${days}d`);
      if (hours > 0) parts.push(`${hours}h`);
      if (minutes > 0) parts.push(`${minutes}m`);
      if (seconds > 0) parts.push(`${seconds}s`);

      // If no time parts, return "0s"
      if (parts.length === 0) {
        return "0s";
      }

      return parts.join(" ");
    }

    it("simulate reward distribution", async function () {
      // ============================================================================
      // CONTRACT UPGRADES
      // ============================================================================

      await upgradeContracts();

      await dlpRewardDeployer
        .connect(admin)
        .initializeEpochRewards(6n, (3600 * 24) / 6, 90, (3600 * 24) / 6);
      await dlpRewardDeployer
        .connect(admin)
        .updateNumberOfBlocksBetweenTranches((3600 * 2) / 60);

      // ============================================================================
      // EPOCH PREPARATION
      // ============================================================================

      const epochId = 6; //await vanaEpoch.epochsCount();
      const epoch = await vanaEpoch.epochs(epochId);

      console.log("📅 REWARD DISTRIBUTION SIMULATION");
      console.log(`Current Epoch: ${epochId}`);
      console.log(
        `Epoch reward amount: ${formatEther(epoch.rewardAmount)} VANA`,
      );
      console.log("═".repeat(70));

      // ============================================================================
      // GET ELIGIBLE DLPS
      // ============================================================================

      const eligibleDlps = await vanaEpoch.epochDlpIds(epochId);
      console.log(
        `\n🎯 Found ${eligibleDlps.length} eligible DLPs for reward distribution\n`,
      );

      // Build DLP map
      const dlpMap = await buildDlpMapForRewardDistribution(eligibleDlps);

      // ============================================================================
      // TRACK DLP REWARD DEPLOYER TREASURY VANA BALANCE
      // ============================================================================

      const dlpRewardDeployerTreasuryBalanceBefore =
        await getDlpRewardDeployerTreasuryBalance();

      // ============================================================================
      // PRE-DISTRIBUTION DATA COLLECTION
      // ============================================================================

      const preDistributionData = await collectLPData(dlpMap, "pre");

      // ============================================================================
      // REWARD DISTRIBUTION
      // ============================================================================

      const distributionResults = await executeRewardDistribution(
        epochId,
        dlpMap,
      );

      // ============================================================================
      // POST-DISTRIBUTION DATA COLLECTION
      // ============================================================================

      const postDistributionData = await collectLPData(
        dlpMap,
        "post",
        preDistributionData,
      );

      // ============================================================================
      // REWARD DISTRIBUTION SUMMARY
      // ============================================================================

      await logRewardDistributionSummary(
        epochId,
        distributionResults,
        dlpMap,
        preDistributionData,
        postDistributionData,
      );

      // ============================================================================
      // DLP REWARD DEPLOYER TREASURY BALANCE SUMMARY
      // ============================================================================

      await logDlpRewardDeployerTreasurySummary(
        dlpRewardDeployerTreasuryBalanceBefore,
        distributionResults,
      );

      console.log("✅ REWARD DISTRIBUTION SIMULATION COMPLETED");
    });

    // ============================================================================
    // EXTRACTED HELPER METHODS
    // ============================================================================

    /**
     * Build DLP map for reward distribution
     */
    async function buildDlpMapForRewardDistribution(
      eligibleDlps: readonly bigint[],
    ): Promise<Record<number, DlpInfo>> {
      const dlpMap: Record<number, DlpInfo> = {};
      for (const dlpId of eligibleDlps) {
        const dlp = await dlpRegistry.dlps(dlpId);
        dlpMap[Number(dlpId)] = {
          dlpAddress: dlp.dlpAddress,
          ownerAddress: await ethers.getSigner(dlp.ownerAddress),
          treasuryAddress: dlp.treasuryAddress,
          tokenAddress: dlp.tokenAddress,
          name: dlp.name,
          lpTokenId: dlp.lpTokenId,
        };
      }
      return dlpMap;
    }

    /**
     * Get DLP Reward Deployer treasury balance
     */
    async function getDlpRewardDeployerTreasuryBalance(): Promise<bigint> {
      return await ethers.provider.getBalance(dlpRewardDeployerTreasuryAddress);
    }

    /**
     * Collect LP data for all DLPs
     */
    async function collectLPData(
      dlpMap: Record<number, DlpInfo>,
      phase: "pre" | "post",
      preDistributionData?: Record<number, LPData>,
    ): Promise<Record<number, LPData>> {
      const lpData: Record<number, LPData> = {};

      for (const [dlpIdStr, dlpInfo] of Object.entries(dlpMap)) {
        const dlpId = Number(dlpIdStr);

        // For post-distribution, only collect data if we have pre-distribution data
        if (
          phase === "post" &&
          preDistributionData &&
          !preDistributionData[dlpId]
        ) {
          continue;
        }

        const data = await getLPData(dlpId, dlpInfo);
        if (data) {
          lpData[dlpId] = data;
        }
      }

      return lpData;
    }

    /**
     * Execute reward distribution for all DLPs
     */
    async function executeRewardDistribution(
      epochId: number,
      dlpMap: Record<number, DlpInfo>,
    ): Promise<Record<number, any>> {
      const distributionResults: Record<number, any> = {};

      for (const [dlpIdStr, dlpInfo] of Object.entries(dlpMap)) {
        const dlpId = Number(dlpIdStr);

        // Check current distribution status
        const currentRewardInfo = await dlpRewardDeployer.epochDlpRewards(
          epochId,
          dlpId,
        );

        const tx = await dlpRewardDeployer
          .connect(admin)
          .distributeRewards(epochId, [dlpId]);

        const receipt = await getReceipt(tx);

        // Parse events from the transaction
        const distributedEvents = receipt.logs
          .map((log) => {
            try {
              return dlpRewardDeployer.interface.parseLog(log);
            } catch {
              return null;
            }
          })
          .filter(
            (event) => event && event.name === "EpochDlpRewardDistributed",
          );

        // Log detailed event information
        for (const event of distributedEvents) {
          // @ts-ignore
          const args = event.args;

          distributionResults[dlpId] = {
            trancheId: args.trancheId.toString(),
            trancheAmount: args.trancheAmount,
            tokenRewardAmount: args.tokenRewardAmount,
            spareToken: args.spareToken,
            spareVana: args.spareVana,
            usedVanaAmount: args.usedVanaAmount,
          };
        }
      }

      return distributionResults;
    }

    /**
     * Log reward distribution summary
     */
    async function logRewardDistributionSummary(
      epochId: number,
      distributionResults: Record<number, any>,
      dlpMap: Record<number, DlpInfo>,
      preDistributionData: Record<number, LPData>,
      postDistributionData: Record<number, LPData>,
    ): Promise<void> {
      console.log("\n🎯 REWARD DISTRIBUTION SUMMARY");
      console.log("═".repeat(70));

      let totalDistributed = 0n;
      let totalTokenRewards = 0n;
      let totalSpareTokens = 0n;
      let totalSpareVana = 0n;
      let totalUsedVana = 0n;

      for (const [dlpIdStr, result] of Object.entries(distributionResults)) {
        const dlpId = Number(dlpIdStr);
        const dlpInfo = dlpMap[dlpId];

        if (!result || !dlpInfo) continue;

        totalDistributed += result.trancheAmount;
        totalTokenRewards += result.tokenRewardAmount;
        totalSpareTokens += result.spareToken;
        totalSpareVana += result.spareVana;
        totalUsedVana += result.usedVanaAmount;

        console.log(`\n🏢 ${dlpInfo.name} (DLP #${dlpId}):`);

        // ============================================================================
        // NEW: ADDITIONAL DLP INFORMATION (BEFORE DISTRIBUTION)
        // ============================================================================
        await logAdditionalDlpInfo(epochId, dlpId);

        console.log(
          `  💰 Tranche amount: ${formatEther(result.trancheAmount)} VANA`,
        );
        // console.log(
        //   `  🪙 Token Rewards: ${formatEther(result.tokenRewardAmount)} tokens`,
        // );
        console.log(
          `  🔄 VANA Used for Increasing Liquidity: ${formatEther(result.usedVanaAmount)} VANA`,
        );
        console.log(
          `  💎 Spare Tokens: ${formatEther(result.spareToken)} tokens`,
        );
        console.log(`  💰 Spare VANA: ${formatEther(result.spareVana)} VANA`);

        // Token price information
        await logPriceAndLiquidityChanges(
          dlpId,
          dlpInfo,
          preDistributionData,
          postDistributionData,
        );
      }

      console.log(`\n🌟 TOTALS:`);
      console.log(
        `  • Total VANA Distributed: ${formatEther(totalDistributed)} VANA`,
      );
      // console.log(
      //   `  • Total Token Rewards: ${formatEther(totalTokenRewards)} tokens`,
      // );
      console.log(`  • Total VANA Used: ${formatEther(totalUsedVana)} VANA`);
      // console.log(
      //   `  • Total Spare Tokens: ${formatEther(totalSpareTokens)} tokens`,
      // );
      console.log(`  • Total Spare VANA: ${formatEther(totalSpareVana)} VANA`);

      const overallSwapEfficiency =
        totalUsedVana > 0 && totalDistributed > 0
          ? (
              (Number(totalUsedVana.toString()) /
                Number(totalDistributed.toString())) *
              100
            ).toFixed(2)
          : "0.00";
      console.log(`  • Overall Swap Efficiency: ${overallSwapEfficiency}%`);
    }

    /**
     * Log additional DLP information (new requirement) - BEFORE distribution
     */
    async function logAdditionalDlpInfo(
      epochId: number,
      dlpId: number,
    ): Promise<void> {
      try {
        // Get epoch DLP info
        const epochDlp = await vanaEpoch.epochDlps(epochId, dlpId);

        // Get reward deployer info (before distribution)
        const epochDlpRewards = await dlpRewardDeployer.epochDlpRewards(
          epochId,
          dlpId,
        );

        // Get number of tranches from the contract
        const numberOfTranches = (await dlpRewardDeployer.epochRewards(epochId))
          .numberOfTranches;

        console.log(`  📊 DLP Status (After Distribution):`);
        console.log(
          `    • Distributed Tranches: ${epochDlpRewards.tranchesCount}/${numberOfTranches}`,
        );
        console.log(
          `    • Epoch DLP Reward Amount: ${formatEther(epochDlp.rewardAmount)} VANA`,
        );
        console.log(
          `    • Epoch DLP Penalty Amount: ${formatEther(epochDlp.penaltyAmount)} VANA`,
        );
        console.log(
          `    • Total Distributed Amount: ${formatEther(epochDlpRewards.totalDistributedAmount)} VANA`,
        );
      } catch (error) {
        console.log(
          `    ⚠️ Could not get additional DLP info: ${error.message}`,
        );
      }
    }

    /**
     * Log price and liquidity changes
     */
    async function logPriceAndLiquidityChanges(
      dlpId: number,
      dlpInfo: DlpInfo,
      preDistributionData: Record<number, LPData>,
      postDistributionData: Record<number, LPData>,
    ): Promise<void> {
      const preData = preDistributionData[dlpId];
      const postData = postDistributionData[dlpId];

      if (preData && postData) {
        const otherTokenSymbol = preData.isWVanaToken0
          ? preData.token1Symbol
          : preData.token0Symbol;

        // Calculate price changes
        const vanaPriceChange =
          parseFloat(postData.price) - parseFloat(preData.price);
        const vanaPriceChangePercent =
          parseFloat(preData.price) > 0
            ? (vanaPriceChange / parseFloat(preData.price)) * 100
            : 0;

        const tokenPriceChange =
          parseFloat(postData.tokenPriceInVana) -
          parseFloat(preData.tokenPriceInVana);
        const tokenPriceChangePercent =
          parseFloat(preData.tokenPriceInVana) > 0
            ? (tokenPriceChange / parseFloat(preData.tokenPriceInVana)) * 100
            : 0;

        // Calculate token balance changes
        const token0Change =
          postData.positionToken0Amount - preData.positionToken0Amount;
        const token1Change =
          postData.positionToken1Amount - preData.positionToken1Amount;

        const token0ChangeFormatted = ethers.formatUnits(
          token0Change,
          preData.token0Decimals,
        );
        const token1ChangeFormatted = ethers.formatUnits(
          token1Change,
          preData.token1Decimals,
        );

        const preToken0AmountFormatted = ethers.formatUnits(
          preData.positionToken0Amount,
          preData.token0Decimals,
        );
        const preToken1AmountFormatted = ethers.formatUnits(
          preData.positionToken1Amount,
          preData.token1Decimals,
        );
        const postToken0AmountFormatted = ethers.formatUnits(
          postData.positionToken0Amount,
          postData.token0Decimals,
        );
        const postToken1AmountFormatted = ethers.formatUnits(
          postData.positionToken1Amount,
          postData.token1Decimals,
        );

        console.log(`  📊 Price Changes:`);
        console.log(
          `    • Before: 1 VANA = ${preData.price} ${otherTokenSymbol} | 1 ${otherTokenSymbol} = ${preData.tokenPriceInVana} VANA`,
        );
        console.log(
          `    • After:  1 VANA = ${postData.price} ${otherTokenSymbol} | 1 ${otherTokenSymbol} = ${postData.tokenPriceInVana} VANA`,
        );
        console.log(
          `    • VANA Price Impact: ${vanaPriceChangePercent > 0 ? "+" : ""}${vanaPriceChangePercent.toFixed(4)}%`,
        );
        console.log(
          `    • ${otherTokenSymbol} Price Impact: ${tokenPriceChangePercent > 0 ? "+" : ""}${tokenPriceChangePercent.toFixed(4)}%`,
        );

        console.log(
          `  💰 LP Position Token Changes (LP ID: ${dlpInfo.lpTokenId}):`,
        );
        console.log(
          `    • ${preData.token0Symbol}: ${preToken0AmountFormatted} → ${postToken0AmountFormatted} (${token0Change > 0 ? "+" : ""}${token0ChangeFormatted})`,
        );
        console.log(
          `    • ${preData.token1Symbol}: ${preToken1AmountFormatted} → ${postToken1AmountFormatted} (${token1Change > 0 ? "+" : ""}${token1ChangeFormatted})`,
        );
      } else if (preData) {
        const otherTokenSymbol = preData.isWVanaToken0
          ? preData.token1Symbol
          : preData.token0Symbol;
        const preToken0AmountFormatted = ethers.formatUnits(
          preData.positionToken0Amount,
          preData.token0Decimals,
        );
        const preToken1AmountFormatted = ethers.formatUnits(
          preData.positionToken1Amount,
          preData.token1Decimals,
        );

        console.log(`  📊 Price Info:`);
        console.log(
          `    • Before: 1 VANA = ${preData.price} ${otherTokenSymbol} | 1 ${otherTokenSymbol} = ${preData.tokenPriceInVana} VANA`,
        );
        console.log(`    • After:  Unable to get post-distribution price`);
        console.log(
          `  💰 LP Position Tokens (LP ID: ${dlpInfo.lpTokenId}, before): ${preToken0AmountFormatted} ${preData.token0Symbol} | ${preToken1AmountFormatted} ${preData.token1Symbol}`,
        );
      } else {
        console.log(`  📊 Price Info: Unable to get price data`);
      }
    }

    /**
     * Log DLP Reward Deployer treasury summary
     */
    async function logDlpRewardDeployerTreasurySummary(
      dlpRewardDeployerTreasuryBalanceBefore: bigint,
      distributionResults: Record<number, any>,
    ): Promise<void> {
      console.log(`\n💼 DLP REWARD DEPLOYER TREASURY SUMMARY:`);
      console.log("━".repeat(50));

      const dlpRewardDeployerTreasuryBalanceAfter =
        await getDlpRewardDeployerTreasuryBalance();
      const dlpRewardDeployerBalanceChange =
        dlpRewardDeployerTreasuryBalanceAfter -
        dlpRewardDeployerTreasuryBalanceBefore;

      // Calculate total used VANA from results
      let totalUsedVana = 0n;
      for (const result of Object.values(distributionResults)) {
        if (result && result.usedVanaAmount) {
          totalUsedVana += result.usedVanaAmount;
        }
      }

      console.log(
        `  • Balance Before: ${formatEther(dlpRewardDeployerTreasuryBalanceBefore)} VANA`,
      );
      console.log(
        `  • Balance After: ${formatEther(dlpRewardDeployerTreasuryBalanceAfter)} VANA`,
      );
      console.log(
        `  • Balance Change: ${formatEther(dlpRewardDeployerBalanceChange)} VANA`,
      );
      console.log(
        `  • Total VANA Used for increasing liquidity: ${formatEther(totalUsedVana)} VANA`,
      );

      // Calculate the difference - should be close to zero if accounting is correct
      const accountingDifference =
        dlpRewardDeployerBalanceChange + totalUsedVana;
      console.log(
        `  • Accounting Difference: ${formatEther(accountingDifference)} VANA`,
      );
    }

    /**
     * Get LP and price data for a DLP
     */
    async function getLPData(
      dlpId: number,
      dlpInfo: DlpInfo,
    ): Promise<LPData | null> {
      try {
        // ============================================================================
        // UNISWAP V3 INTERFACES (for LP and price data)
        // ============================================================================

        const UniswapV3PoolABI = [
          "function token0() external view returns (address)",
          "function token1() external view returns (address)",
          "function liquidity() external view returns (uint128)",
          "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
          "function fee() external view returns (uint24)",
        ];

        const UniswapV3PositionManagerABI = [
          "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
          "function collect(tuple(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external returns (uint256 amount0, uint256 amount1)",
        ];

        const ERC20ABI = [
          "function symbol() external view returns (string)",
          "function decimals() external view returns (uint8)",
          "function balanceOf(address) external view returns (uint256)",
        ];

        const positionManager = await ethers.getContractAt(
          UniswapV3PositionManagerABI,
          uniswapPositionManagerAddress,
        );

        // Get position info from Uniswap V3 Position Manager
        const position = await positionManager.positions(dlpInfo.lpTokenId);

        // Check if position exists
        if (
          !position ||
          !position.token0 ||
          position.token0 === "0x0000000000000000000000000000000000000000"
        ) {
          console.log(
            `    ⚠️ LP position ${dlpInfo.lpTokenId} does not exist or is closed`,
          );
          return null;
        }

        const token0 = position.token0;
        const token1 = position.token1;
        const fee = position.fee;
        const positionLiquidity = position.liquidity;

        // Get token details
        const token0Contract = await ethers.getContractAt(ERC20ABI, token0);
        const token1Contract = await ethers.getContractAt(ERC20ABI, token1);
        const token0Symbol = await token0Contract.symbol();
        const token1Symbol = await token1Contract.symbol();
        const token0Decimals = await token0Contract.decimals();
        const token1Decimals = await token1Contract.decimals();

        // Get pool address - try different factory addresses
        let poolAddress = "0x0000000000000000000000000000000000000000";

        try {
          const UniswapV3Factory = await ethers.getContractAt(
            [
              "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
            ],
            uniswapFactoryAddress,
          );
          poolAddress = await UniswapV3Factory.getPool(token0, token1, fee);
        } catch (factoryError) {
          console.log(
            `    ⚠️ Could not access factory at ${uniswapFactoryAddress}: ${factoryError.message}`,
          );
          return null;
        }

        if (poolAddress === "0x0000000000000000000000000000000000000000") {
          console.log(
            `    ⚠️ Pool does not exist for ${token0Symbol}/${token1Symbol} with fee ${fee}`,
          );
          return null;
        }

        const pool = await ethers.getContractAt(UniswapV3PoolABI, poolAddress);

        // Get pool data
        const poolLiquidity = await pool.liquidity();
        const slot0 = await pool.slot0();
        const sqrtPriceX96 = slot0.sqrtPriceX96;
        const tick = slot0.tick;

        // Determine if WVANA is token0 or token1
        const isWVanaToken0 =
          token0.toLowerCase() === wvanaAddress.toLowerCase();

        // Calculate prices
        const { vanaPrice, tokenPriceInVana } = calculatePrice(
          sqrtPriceX96,
          isWVanaToken0,
        );

        let positionToken0Amount = 0n;
        let positionToken1Amount = 0n;

        const tickLower = Number(position.tickLower);
        const tickUpper = Number(position.tickUpper);

        if (
          tickLower < -887272 ||
          tickLower > 887272 ||
          tickUpper < -887272 ||
          tickUpper > 887272
        ) {
          console.log(`⚠️ Invalid tick range: [${tickLower}, ${tickUpper}]`);
        }

        const sqrtRatioAX96 = BigInt(
          UniswapTickMath.getSqrtRatioAtTick(tickLower).toString(),
        );
        const sqrtRatioBX96 = BigInt(
          UniswapTickMath.getSqrtRatioAtTick(tickUpper).toString(),
        );

        if (positionLiquidity > 0n) {
          if (sqrtPriceX96 <= sqrtRatioAX96) {
            // Current price is below the position range - all liquidity is in token0
            positionToken0Amount = LiquidityAmounts.getAmount0ForLiquidity(
              sqrtRatioAX96,
              sqrtRatioBX96,
              positionLiquidity,
            );
          } else if (sqrtPriceX96 >= sqrtRatioBX96) {
            // Current price is above the position range - all liquidity is in token1
            positionToken1Amount = LiquidityAmounts.getAmount1ForLiquidity(
              sqrtRatioAX96,
              sqrtRatioBX96,
              positionLiquidity,
            );
          } else {
            // Current price is within the position range - liquidity is split
            positionToken0Amount = LiquidityAmounts.getAmount0ForLiquidity(
              sqrtPriceX96,
              sqrtRatioBX96,
              positionLiquidity,
            );
            positionToken1Amount = LiquidityAmounts.getAmount1ForLiquidity(
              sqrtRatioAX96,
              sqrtPriceX96,
              positionLiquidity,
            );
          }
        }
        return {
          token0,
          token1,
          token0Symbol,
          token1Symbol,
          token0Decimals,
          token1Decimals,
          fee,
          poolAddress,
          liquidity: poolLiquidity,
          sqrtPriceX96,
          tick,
          positionLiquidity,
          isWVanaToken0,
          price: vanaPrice,
          tokenPriceInVana,
          positionToken0Amount,
          positionToken1Amount,
        };
      } catch (error) {
        console.log(
          `    ⚠️ Could not get LP data for DLP #${dlpId}: ${error.message}`,
        );
        return null;
      }
    }

    /**
     * Calculate token amounts from liquidity and price
     */
    function calculateTokenAmounts(
      liquidity: bigint,
      sqrtPriceX96: bigint,
      tickLower: number,
      tickUpper: number,
    ): { amount0: bigint; amount1: bigint } {
      try {
        // This is a simplified calculation - in practice you'd need more complex math
        // For now, we'll use the tokensOwed from the position which represents fees owed
        // The actual position value calculation requires complex Uniswap V3 math
        return { amount0: 0n, amount1: 0n };
      } catch (error) {
        return { amount0: 0n, amount1: 0n };
      }
    }

    function calculatePrice(
      sqrtPriceX96: bigint,
      isWVanaToken0: boolean,
    ): { vanaPrice: string; tokenPriceInVana: string } {
      try {
        // Convert sqrtPriceX96 to price
        // price = (sqrtPriceX96 / 2^96)^2
        const Q96 = BigInt(2) ** BigInt(96);

        // Convert to string first, then to number to avoid BigInt conversion error
        const sqrtPriceNum =
          parseFloat(sqrtPriceX96.toString()) / parseFloat(Q96.toString());
        let price = sqrtPriceNum * sqrtPriceNum;

        if (isWVanaToken0) {
          // VANA is token0, price is token1/token0 (how many token1 per VANA)
          return {
            vanaPrice: price.toFixed(8),
            tokenPriceInVana: (1 / price).toFixed(8),
          };
        } else {
          // VANA is token1, price is token0/token1 (how many token0 per VANA)
          return {
            vanaPrice: (1 / price).toFixed(8),
            tokenPriceInVana: price.toFixed(8),
          };
        }
      } catch (error) {
        return {
          vanaPrice: "0.00000000",
          tokenPriceInVana: "0.00000000",
        };
      }
    }

    interface LPData {
      token0: string;
      token1: string;
      token0Symbol: string;
      token1Symbol: string;
      token0Decimals: number;
      token1Decimals: number;
      fee: number;
      poolAddress: string;
      liquidity: bigint;
      sqrtPriceX96: bigint;
      tick: number;
      positionLiquidity: bigint;
      isWVanaToken0: boolean;
      price: string; // WVANA price in terms of the other token
      tokenPriceInVana: string; // Other token price in VANA terms
      positionToken0Amount: bigint;
      positionToken1Amount: bigint;
    }

    const LiquidityAmounts = {
      getAmount0ForLiquidity: (
        sqrtRatioAX96: bigint,
        sqrtRatioBX96: bigint,
        liquidity: bigint,
      ): bigint => {
        if (sqrtRatioAX96 > sqrtRatioBX96)
          [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];

        if (sqrtRatioBX96 === 0n || sqrtRatioAX96 === 0n || liquidity === 0n)
          return 0n;

        try {
          // For amount0: liquidity * (sqrtRatioBX96 - sqrtRatioAX96) / (sqrtRatioBX96 * sqrtRatioAX96) * 2^96
          const Q96 = BigInt(2) ** BigInt(96);

          // Use intermediate calculations to avoid overflow
          const numerator1 = liquidity * (sqrtRatioBX96 - sqrtRatioAX96);
          const numerator2 = numerator1 * Q96;
          const denominator = sqrtRatioBX96 * sqrtRatioAX96;

          if (denominator === 0n) return 0n;

          return numerator2 / denominator;
        } catch (error) {
          return 0n;
        }
      },

      getAmount1ForLiquidity: (
        sqrtRatioAX96: bigint,
        sqrtRatioBX96: bigint,
        liquidity: bigint,
      ): bigint => {
        if (sqrtRatioAX96 > sqrtRatioBX96)
          [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];

        if (liquidity === 0n) return 0n;

        try {
          // For amount1: liquidity * (sqrtRatioBX96 - sqrtRatioAX96) / 2^96
          const Q96 = BigInt(2) ** BigInt(96);

          const numerator = liquidity * (sqrtRatioBX96 - sqrtRatioAX96);

          return numerator / Q96;
        } catch (error) {
          return 0n;
        }
      },
    };
  });
});
