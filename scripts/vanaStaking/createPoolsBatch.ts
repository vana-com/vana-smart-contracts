/**
 * Safe Transaction Builder batch that creates staking pools on VanaPoolEntity and
 * configures each one's max APY and commission, all from the maintainer multisig.
 *
 * Per pool, in order: createEntity{value: minRegistrationStake}(owner, name) ->
 * updateEntityMaxAPY -> proposeCommissionRate -> approveCommissionRate. The
 * maintainer may both propose and approve, so the two-phase commission completes
 * inside the batch. The registration stake is paid by the Safe and credited to the
 * pool OWNER as bonded shares (it is also the owner's registration floor).
 *
 * Entity ids are assigned sequentially from entitiesCount + 1 at EXECUTION time;
 * the batch encodes them, so it must execute while entitiesCount is still the value
 * read here (a name collision would revert the whole batch anyway).
 *
 *   npx hardhat run scripts/vanaStaking/createPoolsBatch.ts --network vana
 *
 * Env:
 *   POOLS                  "Name:owner,Name:owner,…"                              (required)
 *   POOL_MAX_APY_PERCENT   e.g. 40                                                 (required)
 *   POOL_COMMISSION_PERCENT e.g. 5 (0 skips the commission calls)                  (required)
 *   SAFE_ADDRESS / VANA_POOL_ENTITY_PROXY_ADDRESS / CHAIN_ID / OUT_DIR / OUT_FILE   (mainnet defaults)
 */
import { ethers, network } from "hardhat";
import { tx, writeBatch } from "./safeBatch";

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`${k} is required`);
  return v;
};

async function main() {
  const SAFE = ethers.getAddress(env("SAFE_ADDRESS", "0x5eca5208f29e32879a711467916965b2d753baf4"));
  const ENTITY = ethers.getAddress(env("VANA_POOL_ENTITY_PROXY_ADDRESS", "0x44f20490A82e1f1F1cC25Dd3BA8647034eDdce30"));
  const CHAIN_ID = env("CHAIN_ID", String((await ethers.provider.getNetwork()).chainId));
  const OUT_DIR = env("OUT_DIR", "docs/vanaStaking/mainnet-safe");
  const OUT_FILE = env("OUT_FILE", "5-pools.json");
  const apy = ethers.parseUnits(env("POOL_MAX_APY_PERCENT"), 18); // percent * 1e18
  const commission = ethers.parseUnits(env("POOL_COMMISSION_PERCENT"), 18); // percent * 1e18, 100e18 = 100%
  const pools = env("POOLS").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [name, owner] = s.split(":").map((x) => x.trim());
    return { name, owner: ethers.getAddress(owner) };
  });

  const entity = await ethers.getContractAt("VanaPoolEntityImplementation", ENTITY);
  const [count, minStake] = await Promise.all([entity.entitiesCount(), entity.minRegistrationStake()]);
  // VanaPoolEntityImplementation.MAX_COMMISSION (100% = 100e18); a constant in source, and the
  // getter does not exist on a pre-v4 entity, which is where this batch may be prepared.
  const maxCommission = ethers.parseUnits("100", 18);
  if (commission > maxCommission) throw new Error(`commission ${commission} > MAX_COMMISSION ${maxCommission}`);
  for (const p of pools) {
    if ((await entity.entityNameToId(p.name)) !== 0n) throw new Error(`name "${p.name}" already taken`);
  }
  console.log(`${network.name}: entitiesCount=${count}, minRegistrationStake=${ethers.formatEther(minStake)} VANA; ` +
    `new ids ${Number(count) + 1}..${Number(count) + pools.length}; Safe must hold ${ethers.formatEther(minStake * BigInt(pools.length))} VANA`);

  const iface = new ethers.Interface([
    "function createEntity((address ownerAddress,string name))",
    "function updateEntityMaxAPY(uint256,uint256)",
    "function proposeCommissionRate(uint256,uint256)",
    "function approveCommissionRate(uint256,uint256)",
  ]);
  const enc = (fn: string, args: unknown[]) => iface.encodeFunctionData(fn, args);

  const txs = pools.flatMap((p, i) => {
    const id = count + BigInt(i) + 1n;
    const t = [
      tx(ENTITY, enc("createEntity", [{ ownerAddress: p.owner, name: p.name }]),
        `createEntity("${p.name}", owner ${p.owner}) -> entity ${id}; Safe pays the ${ethers.formatEther(minStake)} VANA registration stake, credited to the owner`, minStake.toString()),
      tx(ENTITY, enc("updateEntityMaxAPY", [id, apy]), `updateEntityMaxAPY(${id}, ${ethers.formatUnits(apy, 18)}%)`),
    ];
    if (commission > 0n) {
      t.push(tx(ENTITY, enc("proposeCommissionRate", [id, commission]), `proposeCommissionRate(${id}, ${ethers.formatUnits(commission, 18)}%)`));
      t.push(tx(ENTITY, enc("approveCommissionRate", [id, commission]), `approveCommissionRate(${id}, ${ethers.formatUnits(commission, 18)}%)`));
    }
    return t;
  });

  writeBatch(OUT_DIR, OUT_FILE, SAFE, CHAIN_ID,
    `VanaPool: create ${pools.map((p) => p.name).join(", ")}`,
    `Create ${pools.length} pools on VanaPoolEntity ${ENTITY} at ${ethers.formatUnits(apy, 18)}% max APY, ${ethers.formatUnits(commission, 18)}% commission. Requires entitiesCount == ${count} at execution and ${ethers.formatEther(minStake * BigInt(pools.length))} VANA in the Safe.`,
    txs);
  console.log(`\nPreconditions at execution: Entity v4 + Staking v4 live (floor recorded on creation); entitiesCount == ${count}; Safe balance >= ${ethers.formatEther(minStake * BigInt(pools.length))} VANA.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
