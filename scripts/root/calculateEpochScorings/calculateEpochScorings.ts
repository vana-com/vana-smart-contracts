import { abi as DLPRootAbi } from "./abis/DLPRootAbi.json";
import { abi as DLPRootEpochAbi } from "./abis/DLPRootEpochAbi.json";
import { abi as Multicall3Abi } from "./abis/Multicall3Abi.json";
import { ethers } from "ethers";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";

// Load environment variables
dotenv.config();

// Parse command line arguments
interface Arguments {
  epochId: number;
  stakeStartId: number;
  stakeEndId: string;
  multicallChunkSize: number;
  freshRun: boolean;
  saveScoringsOnContract: boolean;
}

const parseArgs = () => {
  return yargs(hideBin(process.argv))
    .option("epochId", {
      type: "number",
      default: 1,
    })
    .option("stakeStartId", {
      type: "number",
      default: 1,
    })
    .option("stakeEndId", {
      type: "string",
      default: "lastId",
    })
    .option("multicallChunkSize", {
      type: "number",
      default: 1000,
    })
    .option("freshRun", {
      type: "boolean",
      default: true,
    })
    .option("saveScoringsOnContract", {
      type: "boolean",
      default: false,
    }).argv;
};

const argv = parseArgs() as Arguments;

// Configuration
const PROVIDER_URL = process.env.JSON_RPC_URL ?? "";
const DLP_ROOT_ADDRESS = process.env.DLP_ROOT_ADDRESS ?? "";
const DLP_ROOT_EPOCH_ADDRESS = process.env.DLP_ROOT_EPOCH_ADDRESS ?? "";
const MULTICALL3_ADDRESS = process.env.MULTICALL3_ADDRESS ?? "";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";

// Parameters from command line
const FRESH_RUN = argv.freshRun;
const SAVE_SCORINGS_ON_CONTRACT = argv.saveScoringsOnContract;
const EPOCH_ID = argv.epochId;
const STAKE_START_ID = argv.stakeStartId;
const STAKE_END_ID = argv.stakeEndId as number | "lastId";
const MULTICALL_CHUNK_SIZE = argv.multicallChunkSize;

// Parameters
const MAX_RETRIES = 10;
const RETRY_DELAY = 5000;

// File paths
const BASE_DIR = `./scoringResults/epoch${EPOCH_ID}`;
const STAKES_CSV = path.join(BASE_DIR, "stakes_data.csv");
const DLP_SCORES_CSV = path.join(BASE_DIR, "dlp_scores.csv");

// Types
interface StakeInfo {
  id: bigint;
  stakerAddress: string;
  dlpId: bigint;
  amount: bigint;
  startBlock: bigint;
  endBlock: bigint;
  withdrawn: boolean;
  lastClaimedEpochId: bigint;
}

interface DlpScore {
  dlpId: number;
  totalScore: bigint;
}

// Validation
if (!PROVIDER_URL || !DLP_ROOT_ADDRESS || !MULTICALL3_ADDRESS) {
  throw new Error("Missing required environment variables");
}

if (SAVE_SCORINGS_ON_CONTRACT && !DEPLOYER_PRIVATE_KEY) {
  throw new Error(
    "DEPLOYER_PRIVATE_KEY is required when SAVE_SCORINGS_ON_CONTRACT is true"
  );
}

// Utility functions
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

function getMultiplier(index: number | bigint): bigint {
  if (typeof index === "bigint") {
    index = Number(index);
  }

  if (index >= 83) {
    return 30000n;
  }

  const multiplier = [
    476, 952, 1428, 1904, 2380, 2857, 3333, 3809, 4285, 4761, 5238, 5714, 6190,
    6666, 7142, 7619, 8095, 8571, 9047, 9523, 10000, 10200, 10500, 10700, 11000,
    11200, 11400, 11700, 11900, 12100, 12400, 12600, 12900, 13100, 13300, 13600,
    13800, 14000, 14300, 14500, 14800, 15000, 15600, 16200, 16800, 17400, 18000,
    18600, 19200, 19800, 20400, 21000, 21500, 22100, 22700, 23300, 23900, 24500,
    25100, 25700, 26300, 26900, 27500, 27600, 27700, 27900, 28000, 28100, 28200,
    28300, 28500, 28600, 28700, 28800, 28900, 29000, 29200, 29300, 29400, 29500,
    29600, 29800, 29900, 30000,
  ];

  return BigInt(multiplier[index]);
}

function calculateStakeScore(
  stakeAmount: bigint,
  stakeStartBlock: bigint,
  blockNumber: bigint,
  daySize: bigint,
  epoch3StartBlock: bigint
): bigint {
  if (blockNumber < stakeStartBlock) {
    return 0n;
  }

  let daysStaked = Math.floor(
    Number((blockNumber - stakeStartBlock) / daySize)
  );

  daysStaked += stakeStartBlock < epoch3StartBlock ? 20 : 0;

  return (stakeAmount * getMultiplier(daysStaked)) / 10000n;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Contract interaction functions
function encodeStakesCall(stakeId: number): string {
  const dlpRootInterface = new ethers.Interface(DLPRootAbi);
  return dlpRootInterface.encodeFunctionData("stakes", [stakeId]);
}

function decodeStakesResponse(data: string): StakeInfo {
  const dlpRootInterface = new ethers.Interface(DLPRootAbi);
  const result = dlpRootInterface.decodeFunctionResult("stakes", data);
  const stakeInfo = result[0];
  return {
    id: stakeInfo[0],
    stakerAddress: stakeInfo[1],
    dlpId: stakeInfo[2],
    amount: stakeInfo[3],
    startBlock: stakeInfo[4],
    endBlock: stakeInfo[5],
    withdrawn: stakeInfo[6],
    lastClaimedEpochId: stakeInfo[7],
  };
}

function convertStakeToCsvRow(
  stake: StakeInfo,
  epochEndBlock: bigint,
  score: bigint
): string {
  return [
    stake.id.toString(),
    stake.stakerAddress,
    stake.dlpId.toString(),
    stake.amount.toString(),
    stake.startBlock.toString(),
    stake.endBlock.toString(),
    stake.withdrawn.toString(),
    stake.lastClaimedEpochId.toString(),
    epochEndBlock.toString(),
    score.toString(),
  ].join(",");
}

async function getStakesInfoChunk(
  provider: ethers.JsonRpcProvider,
  startId: number,
  endId: number,
  multicall: ethers.Contract,
  retryCount = 0
): Promise<StakeInfo[]> {
  const calls = Array.from({ length: endId - startId + 1 }, (_, i) => ({
    target: DLP_ROOT_ADDRESS,
    allowFailure: false,
    callData: encodeStakesCall(startId + i),
  }));

  try {
    const results = await multicall.aggregate3.staticCall(calls);
    return results.map((result: any, index: number) => {
      if (!result.success) {
        throw new Error(
          `Failed to fetch stake info for stakeId: ${startId + index}`
        );
      }
      return decodeStakesResponse(result.returnData);
    });
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.log(
        `Retry ${retryCount + 1}/${MAX_RETRIES} for chunk ${startId}-${endId}`
      );
      await sleep(RETRY_DELAY);
      return getStakesInfoChunk(
        provider,
        startId,
        endId,
        multicall,
        retryCount + 1
      );
    }
    throw error;
  }
}

async function processStakes(
  provider: ethers.JsonRpcProvider,
  multicall: ethers.Contract,
  epochEndBlock: bigint,
  daySize: bigint,
  startId: number,
  endId: number,
  epoch3StartBlock: bigint
): Promise<void> {
  console.log("\n📊 Processing stakes...");

  // Initialize files
  const csvHeader =
    "id,stakerAddress,dlpId,amount,startBlock,endBlock,withdrawn,lastClaimedEpochId,epochEndBlock,score\n";
  await fs.promises.writeFile(STAKES_CSV, csvHeader);

  const dlpScores: { [key: number]: bigint } = {};
  let processedStakes = 0;
  const totalStakes = endId - startId + 1;

  // Process stakes in chunks
  for (
    let currentId = startId;
    currentId <= endId;
    currentId += MULTICALL_CHUNK_SIZE
  ) {
    const chunkEndId = Math.min(currentId + MULTICALL_CHUNK_SIZE - 1, endId);
    const stakes = await getStakesInfoChunk(
      provider,
      currentId,
      chunkEndId,
      multicall
    );

    const csvRows = stakes
      .map((stake) => {
        let score = 0n;

        if (
          stake.startBlock < epochEndBlock &&
          (stake.endBlock === 0n || stake.endBlock > epochEndBlock)
        ) {
          score = calculateStakeScore(
            stake.amount,
            stake.startBlock,
            epochEndBlock,
            daySize,
            epoch3StartBlock
          );

          const dlpId = Number(stake.dlpId);
          dlpScores[dlpId] = (dlpScores[dlpId] || 0n) + score;
        }

        return convertStakeToCsvRow(stake, epochEndBlock, score);
      })
      .join("\n");

    await fs.promises.appendFile(STAKES_CSV, csvRows + "\n");

    processedStakes += stakes.length;
    const progress = (processedStakes / totalStakes) * 100;
    console.log(
      `Progress: ${processedStakes}/${totalStakes} (${progress.toFixed(2)}%)`
    );
  }

  // Save DLP scores
  const dlpScoresArray: DlpScore[] = Object.entries(dlpScores).map(
    ([dlpId, totalScore]) => ({
      dlpId: Number(dlpId),
      totalScore,
    })
  );

  const dlpCsvHeader = "epochId,dlpId,totalScore\n";
  const dlpCsvRows = dlpScoresArray
    .map((score) =>
      [
        EPOCH_ID.toString(),
        score.dlpId.toString(),
        score.totalScore.toString(),
      ].join(",")
    )
    .join("\n");

  await fs.promises.writeFile(DLP_SCORES_CSV, dlpCsvHeader + dlpCsvRows + "\n");

  // Save to contract if required
  if (SAVE_SCORINGS_ON_CONTRACT) {
    console.log("\n💫 Saving DLP scores to contract...");
    const wallet = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
    const dlpRootEpochWithSigner = new ethers.Contract(
      DLP_ROOT_EPOCH_ADDRESS,
      DLPRootEpochAbi,
      wallet
    );

    const dlpScoringsObj = dlpScoresArray.map((score) => ({
      epochId: EPOCH_ID,
      dlpId: score.dlpId,
      totalStakesScore: score.totalScore,
    }));

    try {
      const tx = await dlpRootEpochWithSigner.saveEpochDlpsTotalStakesScore(
        dlpScoringsObj
      );
      console.log(`   Transaction hash: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`   Transaction confirmed in block ${receipt.blockNumber}`);
    } catch (error) {
      console.error("❌ Failed to save scores to contract:", error);
      throw error;
    }
  }
}

async function main() {
  const startTime = new Date();
  console.log(`\n🚀 Script started at: ${startTime.toISOString()}`);

  // Create or clean directories based on FRESH_RUN
  if (FRESH_RUN) {
    console.log("\n🗑️ Fresh run requested, cleaning epoch directory...");
    await fs.promises.rm(BASE_DIR, { recursive: true, force: true });
  }

  await fs.promises.mkdir(BASE_DIR, { recursive: true });

  const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
  const dlpRoot = new ethers.Contract(DLP_ROOT_ADDRESS, DLPRootAbi, provider);
  const dlpRootEpoch = new ethers.Contract(
    DLP_ROOT_EPOCH_ADDRESS,
    DLPRootEpochAbi,
    provider
  );
  const multicall = new ethers.Contract(
    MULTICALL3_ADDRESS,
    Multicall3Abi,
    provider
  );

  // Get epoch and day size information
  const epoch = await dlpRootEpoch.epochs(EPOCH_ID);
  const daySize = await dlpRootEpoch.daySize();
  const epoch3StartBlock = (await dlpRootEpoch.epochs(3)).startBlock;

  console.log(`\n📊 Processing stakes for epoch ${EPOCH_ID}`);
  console.log(`   Epoch end block: ${epoch.endBlock}`);
  console.log(`   Day size: ${daySize}`);
  console.log(`   Epoch startBlock: ${epoch3StartBlock}`);

  // Get the actual last stake ID if STAKE_END_ID is 'lastId'
  const actualEndId =
    STAKE_END_ID === "lastId"
      ? Number(await dlpRoot.stakesCount())
      : STAKE_END_ID;

  console.log(`   Last stake ID: ${actualEndId}`);

  // Process all stakes
  await processStakes(
    provider,
    multicall,
    epoch.endBlock,
    daySize,
    STAKE_START_ID,
    actualEndId,
    epoch3StartBlock
  );

  const endTime = new Date();
  const duration = endTime.getTime() - startTime.getTime();

  console.log("\n✨ Processing completed!");
  console.log(`   Start time: ${startTime.toISOString()}`);
  console.log(`   End time: ${endTime.toISOString()}`);
  console.log(`   Total duration: ${formatDuration(duration)}`);
  console.log(`\n📁 Output files:`);
  console.log(`   Stakes data: ${path.resolve(STAKES_CSV)}`);
  console.log(`   DLP scores: ${path.resolve(DLP_SCORES_CSV)}\n`);
}

main().catch((error) => {
  console.error("❌ Script failed:", error);
  process.exit(1);
});
