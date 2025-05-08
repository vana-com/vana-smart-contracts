import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { parseEther } from "ethers";
import type { DATFactory, DAT } from "../typechain-types";

/**
 * Helper: current UNIX timestamp (seconds)
 */
const now = (): number => Math.floor(Date.now() / 1000);

/**
 * Create a DAT token using the deployed DATFactory
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { log } = deployments;
  const [deployer] = await ethers.getSigners();

  /* ───────────────────────────── signers ──────────────────────────────── */
  log("Deployer:", deployer.address);

  /* ────────────────── get deployed factory address ─────────────────────── */
  log("\n**************************************************************");
  
  const factoryDeployment = await deployments.get("DATFactory");
  log("Using DATFactory at:", factoryDeployment.address);
  
  const factory = await ethers.getContractAt("DATFactory", factoryDeployment.address) as DATFactory;

  /* ───────────────────────── token parameters ─────────────────────────── */
  const name   = process.env.NAME   || "DAT Token";
  const symbol = process.env.SYMBOL || "DAT";

  const owner  = process.env.OWNER  || deployer.address;
  const capStr = process.env.CAP    || "0"; // 0 → uncapped
  const cap    = capStr === "0" ? 0n : parseEther(capStr);

  /* Vesting schedule example – customise as required */
  const start  = parseInt(process.env.VEST_START  || (now() + 60).toString()); // default: +60s
  const cliff  = parseInt(process.env.VEST_CLIFF  || (60 * 60 * 24 * 30).toString()); // 30 days
  
  // IMPORTANT: duration is the TOTAL period including cliff
  const duration = parseInt(process.env.VEST_DURATION || 
                           ((60 * 60 * 24 * 365).toString())); // 1 year vesting
  
  const beneficiary = process.env.BENEFICIARY || deployer.address;
  const amount      = parseEther(process.env.VEST_AMOUNT || "100000");

  log(`Vesting Details:
  - Beneficiary: ${beneficiary}
  - Start: ${new Date(start * 1000).toISOString()} (unix: ${start})
  - Cliff: ${cliff / (60 * 60 * 24)} days
  - Duration: ${duration / (60 * 60 * 24)} days (including cliff)
  - Amount: ${ethers.formatEther(amount)} tokens`);

  const schedules: DATFactory.VestingParamsStruct[] = [
    {
      beneficiary,
      start,
      cliff,
      duration,
      amount,
    },
  ];

  /* Optional deterministic salt → pass ZERO hash for non-deterministic */
  const salt = process.env.SALT ? (process.env.SALT as `0x${string}`) : ethers.ZeroHash;

  log(`Creating token with the following parameters:
  - Name: ${name}
  - Symbol: ${symbol}
  - Owner: ${owner}
  - Cap: ${capStr === "0" ? "Uncapped" : capStr}
  - Vesting schedule: ${schedules.length} recipient(s)`);
  
  log("Creating token…");
  const createTx = await factory.createToken(name, symbol, owner, cap, schedules, salt);
  const receipt  = await createTx.wait();

  // Find the DATCreated event in the logs
  const evt = receipt!.logs.find((l) => {
    return 'fragment' in l && l.fragment?.name === "DATCreated";
  });
  
  if (!evt || !('args' in evt)) throw new Error("DATCreated event not found, cannot continue");

  const tokenAddr = evt.args.token as string;
  log(`Token deployed → ${tokenAddr}`);

  /* ───── attach to clone and print some state ───── */
  const token = (await ethers.getContractAt("DAT", tokenAddr)) as DAT;
  await token.waitForDeployment();

  log("Total supply:", ethers.formatEther(await token.totalSupply()));
  log("Cap:", cap === 0n ? "Uncapped" : ethers.formatEther(await token.cap()));
  log("Owner (DEFAULT_ADMIN_ROLE):", owner);
  
  // Get vesting wallet events to display created wallets
  const vestingEvents = receipt!.logs.filter((l) => {
    return 'fragment' in l && l.fragment?.name === "VestingWalletCreated";
  });
  
  if (vestingEvents.length > 0) {
    log("\nCreated Vesting Wallets:");
    for (const evt of vestingEvents) {
      if ('args' in evt) {
        const walletAddr = evt.args.wallet;
        const beneficiary = evt.args.beneficiary;
        log(`- Wallet: ${walletAddr} for beneficiary: ${beneficiary}`);
      }
    }
  }
  
  log("\n✅  DAT token creation complete");
};

export default func;
func.tags = ["DATToken"];
