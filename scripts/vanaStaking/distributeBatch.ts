/**
 * Safe Transaction Builder batch for one RewardSplitter.distribute(budget, ids)
 * round from the multisig (it holds DISTRIBUTOR_ROLE).
 *
 * A round in which every id is unseen only records baselines and pays nothing,
 * so the budget for such a round can be 1 wei. Any later round pays and advances
 * baselines: give it the budget you mean to pay.
 *
 *   ENTITY_IDS=2,3,4 BUDGET_WEI=1 OUT_FILE=8-baseline.json npx hardhat run scripts/vanaStaking/distributeBatch.ts
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
  const OUT_FILE = env("OUT_FILE");
  const ids = env("ENTITY_IDS").split(",").map((s) => BigInt(s.trim()));
  const budget = BigInt(env("BUDGET_WEI"));
  if (ids.length === 0 || budget === 0n) throw new Error("ENTITY_IDS and a non-zero BUDGET_WEI are required");

  const iface = new ethers.Interface(["function distribute(uint256,uint256[])"]);
  const note = `distribute(${budget} wei, [${ids.join(",")}])` +
    (budget === 1n ? " — baseline round: records each pool's principal-seconds, pays nothing" : "");
  writeBatch(OUT_DIR, OUT_FILE, SAFE, CHAIN_ID, `VanaPool: distribute round [${ids.join(",")}]`,
    `RewardSplitter ${SPLITTER}: ${note}.`, [tx(SPLITTER, iface.encodeFunctionData("distribute", [budget, ids]), note)]);
}

main().catch((e) => { console.error(e); process.exit(1); });
