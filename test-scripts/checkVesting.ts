// test-scripts/checkVesting.ts
// Enhanced script to check vesting details by token address or creation transaction hash

import { ethers } from "ethers";
import * as dotenv from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

dotenv.config();

// Configure command line arguments
const argv = yargs(hideBin(process.argv))
  .option('txhash', {
    alias: 'tx',
    description: 'Transaction hash of the DAT token creation',
    type: 'string',
    demandOption: true
  })
  .option('release', {
    alias: 'r',
    description: 'Automatically release available tokens',
    type: 'boolean',
    default: false
  })
  .option('date', {
    alias: 'd',
    description: 'Check vesting at specific date (format: YYYY-MM-DD)',
    type: 'string',
  })
  .help()
  .alias('help', 'h')
  .parseSync();

const {
  MOKSHA_RPC_URL,
  DEPLOYER_PRIVATE_KEY,
} = process.env;

if (!MOKSHA_RPC_URL || !DEPLOYER_PRIVATE_KEY) {
  throw new Error("Missing env vars: MOKSHA_RPC_URL, DEPLOYER_PRIVATE_KEY");
}

// ABIs
const VESTING_WALLET_ABI = [
  // Query functions
  "function releasable(address token) view returns (uint256)",
  "function released(address token) view returns (uint256)",
  "function start() view returns (uint256)",
  "function duration() view returns (uint256)",
  "function owner() view returns (address)",  // Ownable function - returns the beneficiary
  "function vestedAmount(address token, uint64 timestamp) view returns (uint256)",
  // Actions
  "function release(address token)",
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  // Events
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

const DAT_FACTORY_ABI = [
  // Events
  "event DATCreated(address indexed token, bytes32 indexed salt, string name, string symbol, address owner, uint256 cap)",
  "event VestingWalletCreated(address indexed wallet, address indexed beneficiary, uint64 start, uint64 cliff, uint64 duration, uint256 amount)",
];

// Type for parsed events
interface VestingWallet {
  walletAddress: string;
  beneficiary?: string;
  start?: number;
  cliff?: number;
  duration?: number;
  amount?: bigint;
  isVestingWallet?: boolean;
}

// Helper functions
function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

function progressBar(percent: number, width = 40): string {
  const filled = Math.round(width * percent / 100);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${bar}] ${percent.toFixed(2)}%`;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  return `${days} days, ${hours} hours`;
}

/**
 * Retrieves vesting wallet data from transaction receipt logs
 */
async function getVestingInfoFromTxHash(
  provider: ethers.Provider,
  txHash: string
): Promise<{
  tokenAddress: string | null;
  vestingWallets: VestingWallet[];
}> {
  console.log(`\n🔍 Analyzing transaction: ${txHash}`);
  
  // Get the transaction receipt
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error(`Transaction not found: ${txHash}`);
  }
  
  const factoryAddress = receipt.from;
  console.log(`DATFactory address (transaction sender): ${factoryAddress}`);
  
  // Create interface to parse logs
  const factoryInterface = new ethers.Interface(DAT_FACTORY_ABI);
  
  // Extract data from logs
  let tokenAddress: string | null = null;
  const vestingWallets: VestingWallet[] = [];
  
  // Find the DATCreated and VestingWalletCreated events in the logs
  for (const log of receipt.logs) {
    try {
      const parsedLog = factoryInterface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
      
      if (!parsedLog || !parsedLog.args) continue;
      
      if (parsedLog.name === 'DATCreated') {
        tokenAddress = parsedLog.args[0] || parsedLog.args.token;
        console.log(`📝 Found DAT Token: ${tokenAddress}`);
      }
      
      if (parsedLog.name === 'VestingWalletCreated') {
        const wallet = parsedLog.args[0] || parsedLog.args.wallet;
        const beneficiary = parsedLog.args[1] || parsedLog.args.beneficiary;
        const start = Number(parsedLog.args[2] || parsedLog.args.start);
        const cliff = Number(parsedLog.args[3] || parsedLog.args.cliff);
        const duration = Number(parsedLog.args[4] || parsedLog.args.duration);
        const amount = parsedLog.args[5] || parsedLog.args.amount;
        
        vestingWallets.push({
          walletAddress: wallet,
          beneficiary,
          start,
          cliff, 
          duration,
          amount,
        });
        console.log(`📝 Found Vesting Wallet: ${wallet} for beneficiary: ${beneficiary}`);
      }
    } catch (e) {
      // Skip logs that aren't from the factory or can't be parsed
      continue;
    }
  }
  
  console.log(`Found ${vestingWallets.length} vesting wallets`);
  
  return { tokenAddress, vestingWallets };
}


/**
 * Analyze vesting wallet details and status
 */
async function analyzeVestingWallet(
  provider: ethers.Provider,
  signer: ethers.Signer,
  tokenAddress: string,
  walletData: VestingWallet,
  checkTimestamp: number,
  autoRelease: boolean
) {
  const walletAddress = walletData.walletAddress;
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Analyzing Vesting Wallet: ${walletAddress}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const vestingWallet = new ethers.Contract(walletAddress, VESTING_WALLET_ABI, signer);
  
  // Get token details
  const symbol = await token.symbol();
  const name = await token.name();
  let tokenDecimals = 18;
  try {
    tokenDecimals = await token.decimals();
  } catch (e) {
    console.log("Using default decimals: 18");
  }
  
  // Get wallet details - these are the OpenZeppelin VestingWallet parameters
  const ozStart = Number(await vestingWallet.start());
  const ozDuration = Number(await vestingWallet.duration());
  let beneficiaryAddress: string;
  
  try {
    beneficiaryAddress = await vestingWallet.owner();
  } catch (e) {
    beneficiaryAddress = walletData.beneficiary || "Unknown";
    console.log("Could not retrieve owner/beneficiary from wallet, using provided value");
  }
  
  // Original parameters (either provided or inferred)
  const originalStart = walletData.start !== undefined ? walletData.start : ozStart - (walletData.cliff || 0);
  const originalCliff = walletData.cliff !== undefined ? walletData.cliff : 0; // We can't infer cliff without the event
  const originalDuration = walletData.duration !== undefined ? walletData.duration : ozDuration + originalCliff;
  
  // Get token balances and vesting status
  const beneficiaryBalance = await token.balanceOf(beneficiaryAddress);
  const walletBalance = await token.balanceOf(walletAddress);
  const totalVesting = walletData.amount || (walletBalance + await vestingWallet.released(tokenAddress));
  const releasable = await vestingWallet.releasable(tokenAddress);
  const released = await vestingWallet.released(tokenAddress);
  
  // Calculate vesting progress
  const vestingEndTime = ozStart + ozDuration;
  const vestedAmount = await vestingWallet.vestedAmount(tokenAddress, checkTimestamp < vestingEndTime ? checkTimestamp : vestingEndTime);
  const vestedPercent = Number(totalVesting) > 0 ? Number((vestedAmount * 100n) / totalVesting) : 0;
  const releasedPercent = Number(totalVesting) > 0 ? Number((released * 100n) / totalVesting) : 0;
  
  // Time calculations
  const currentTime = Math.floor(Date.now() / 1000);
  const timeUntilStart = Math.max(0, ozStart - currentTime);
  const timeUntilEnd = Math.max(0, vestingEndTime - currentTime);
  const isVestingActive = currentTime >= ozStart && currentTime < vestingEndTime;
  const isVestingComplete = currentTime >= vestingEndTime;
  
  // Display token and wallet info
  console.log(`🔑 Token:       ${name} (${symbol})`);
  console.log(`📍 Address:     ${tokenAddress}`);
  console.log(`👛 Wallet:      ${walletAddress}`);
  console.log(`👤 Beneficiary: ${beneficiaryAddress}`);
  
  // Display original parameters (if available from event or inferred)
  console.log(`\n📋 Original Vesting Parameters`);
  console.log(`- Start date:  ${formatDate(originalStart)} (unix: ${originalStart})`);
  console.log(`- Cliff:       ${formatDuration(originalCliff)} (${originalCliff} seconds)`);
  console.log(`- Duration:    ${formatDuration(originalDuration)} (${originalDuration} seconds, including cliff)`);
  
  // Display OpenZeppelin parameters
  console.log(`\n📋 OpenZeppelin VestingWallet Parameters`);
  console.log(`- Start date:  ${formatDate(ozStart)} (unix: ${ozStart})`);
  console.log(`- Duration:    ${formatDuration(ozDuration)} (${ozDuration} seconds)`);
  console.log(`- End date:    ${formatDate(vestingEndTime)} (unix: ${vestingEndTime})`);
  
  // Display timeline status
  if (timeUntilStart > 0) {
    console.log(`\n⏳ Vesting starts in ${formatDuration(timeUntilStart)}`);
  } else if (isVestingActive) {
    console.log(`\n⏳ Vesting is ACTIVE - ends in ${formatDuration(timeUntilEnd)}`);
  } else {
    console.log(`\n✅ Vesting period is COMPLETE`);
  }
  
  // Display token amounts
  console.log(`\n💰 Token Amounts`);
  console.log(`- Total vesting:      ${ethers.formatUnits(totalVesting, tokenDecimals)} ${symbol}`);
  console.log(`- Vested so far:      ${ethers.formatUnits(vestedAmount, tokenDecimals)} ${symbol} (${vestedPercent.toFixed(2)}%)`);
  console.log(`- Released:           ${ethers.formatUnits(released, tokenDecimals)} ${symbol} (${releasedPercent.toFixed(2)}%)`);
  console.log(`- Currently releasable: ${ethers.formatUnits(releasable, tokenDecimals)} ${symbol}`);
  console.log(`- Remaining in wallet: ${ethers.formatUnits(walletBalance, tokenDecimals)} ${symbol}`);
  console.log(`- Beneficiary balance: ${ethers.formatUnits(beneficiaryBalance, tokenDecimals)} ${symbol}`);
  
  // Show progress visualization
  console.log(`\n📈 Vesting Progress`);
  if (currentTime >= ozStart) {
    console.log(`Vested:  ${progressBar(vestedPercent)}`);
    console.log(`Released: ${progressBar(releasedPercent)}`);
  } else {
    console.log(`Vesting has not started yet.`);
  }
  
  // If checking a future date that's different from now
  if (checkTimestamp > currentTime) {
    const futureVestedAmount = await vestingWallet.vestedAmount(tokenAddress, checkTimestamp);
    const futureVestedPercent = Number(totalVesting) > 0 ? Number((futureVestedAmount * 100n) / totalVesting) : 0;
    
    console.log(`\n🔮 Projection for ${formatDate(checkTimestamp)}:`);
    console.log(`- Vested amount: ${ethers.formatUnits(futureVestedAmount, tokenDecimals)} ${symbol} (${futureVestedPercent.toFixed(2)}%)`);
    console.log(`- Progress: ${progressBar(futureVestedPercent)}`);
  }
  
  // Release tokens if requested and available
  if (autoRelease && releasable > 0n) {
    console.log(`\n🚀 Releasing ${ethers.formatUnits(releasable, tokenDecimals)} ${symbol}...`);
    try {
      const tx = await vestingWallet.release(tokenAddress);
      await tx.wait();
      
      // Update balances after release
      const balanceAfter = await token.balanceOf(beneficiaryAddress);
      const releasedAfter = await vestingWallet.released(tokenAddress);
      const received = balanceAfter - beneficiaryBalance;
      
      console.log(`\n✅ Released:`);
      console.log(`- Tokens released: ${ethers.formatUnits(received, tokenDecimals)} ${symbol}`);
      console.log(`- New beneficiary balance: ${ethers.formatUnits(balanceAfter, tokenDecimals)} ${symbol}`);
      console.log(`- Total released to date: ${ethers.formatUnits(releasedAfter, tokenDecimals)} ${symbol}`);
    } catch (error) {
      console.error(`\n❌ Release failed:`, error);
    }
  } else if (releasable > 0n) {
    console.log(`\n💡 ${ethers.formatUnits(releasable, tokenDecimals)} ${symbol} available to release.`);
    console.log(`   Use --release flag to automatically release tokens.`);
  } else {
    console.log(`\n⚠️  No tokens available to release at this time.`);
  }
}

async function main() {
  try {
    const provider = new ethers.JsonRpcProvider(MOKSHA_RPC_URL);
    const signer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY as string, provider);
    
    // Get current time or use provided date
    const now = Math.floor(Date.now() / 1000);
    let checkTimestamp = now;
    if (argv.date) {
      const date = new Date(argv.date as string);
      if (isNaN(date.getTime())) {
        console.error(`Invalid date format: ${argv.date}`);
        return;
      }
      checkTimestamp = Math.floor(date.getTime() / 1000);
      if (checkTimestamp > now) {
        console.log(`🔮 Projecting vesting status for: ${formatDate(checkTimestamp)}`);
      }
    }
    
    // Get token and vesting info from transaction hash
    const txHash = argv.txhash as string;
    const { tokenAddress, vestingWallets } = await getVestingInfoFromTxHash(provider, txHash);
    
    if (!tokenAddress) {
      throw new Error(`No DAT token creation found in transaction: ${txHash}`);
    }
    
    if (vestingWallets.length === 0) {
      console.log(`\n⚠️  No vesting wallets found for token: ${tokenAddress}`);
      return;
    }
    
    // Analyze each vesting wallet
    console.log(`\n📊 Found ${vestingWallets.length} vesting wallets for token: ${tokenAddress}`);
    
    for (const wallet of vestingWallets) {
      await analyzeVestingWallet(
        provider,
        signer,
        tokenAddress,
        wallet,
        checkTimestamp,
        argv.release as boolean
      );
    }
    
    console.log(`\n✅ Analysis complete for ${vestingWallets.length} vesting wallets`);
    
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
