/**
 * Safe Transaction Builder batch that configures the RewardSplitter from its
 * maintainer multisig: vesting duration (required before any distribute(); no
 * default), burn rate, and optionally a distributor grant.
 *
 *   REWARD_VESTING_DURATION=2592000 BURN_RATE_PERCENT=25 [DISTRIBUTOR_ADDRESS=0x…] \
 *   npx hardhat run scripts/vanaStaking/splitterConfigBatch.ts
 *
 * Targets the splitter proxy address (default: the CREATE2 parity address), so the
 * batch can be queued before the proxy exists; it executes after the batch that
 * creates it.
 */
import { ethers } from "hardhat";
import { tx, writeBatch } from "./safeBatch";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`${k} is required`);
  return v;
};

async function main() {
  const SAFE = ethers.getAddress(env("SAFE_ADDRESS", "0x5eca5208f29e32879a711467916965b2d753baf4"));
  const SPLITTER = ethers.getAddress(env("SPLITTER_ADDRESS", "0x7A7B89b6925A8156b9A51E520327c0701023b344"));
  const CHAIN_ID = env("CHAIN_ID", "1480");
  const OUT_DIR = env("OUT_DIR", "docs/vanaStaking/mainnet-safe");
  const OUT_FILE = env("OUT_FILE", "6-splitter-config.json");
  const duration = Number(env("REWARD_VESTING_DURATION"));
  const burn = ethers.parseUnits(env("BURN_RATE_PERCENT"), 18); // percent * 1e18; 100e18 = 100%
  if (!(duration > 0 && duration < 2 ** 32)) throw new Error("REWARD_VESTING_DURATION must be a positive uint32");
  if (burn > ethers.parseUnits("100", 18)) throw new Error("BURN_RATE_PERCENT > 100");

  const iface = new ethers.Interface([
    "function updateRewardVestingDuration(uint32)",
    "function updateBurnRate(uint256)",
    "function grantRole(bytes32,address)",
  ]);
  const enc = (fn: string, args: unknown[]) => iface.encodeFunctionData(fn, args);

  const txs = [
    tx(SPLITTER, enc("updateRewardVestingDuration", [duration]),
      `updateRewardVestingDuration(${duration}) = ${(duration / 86400).toFixed(2)} days; distribute() reverts VestingDurationNotSet until set`),
    tx(SPLITTER, enc("updateBurnRate", [burn]), `updateBurnRate(${ethers.formatUnits(burn, 18)}%): share of each distribute() budget reserved for burn`),
  ];
  if (process.env.DISTRIBUTOR_ADDRESS) {
    const d = ethers.getAddress(process.env.DISTRIBUTOR_ADDRESS);
    txs.push(tx(SPLITTER, enc("grantRole", [ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE")), d]), `grantRole(DISTRIBUTOR_ROLE, ${d})`));
  }
  writeBatch(OUT_DIR, OUT_FILE, SAFE, CHAIN_ID, "VanaPool: configure RewardSplitter",
    `RewardSplitter ${SPLITTER}: vesting ${duration}s, burn ${ethers.formatUnits(burn, 18)}%. Execute after the batch that creates the splitter.`, txs);
}

main().catch((e) => { console.error(e); process.exit(1); });
