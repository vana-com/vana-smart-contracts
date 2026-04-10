import { ethers } from "hardhat";

const implementationContractName = "VanaPoolEntityImplementation";

async function main() {
  const proxyAddress = process.env.VANA_POOL_ENTITY_PROXY_ADDRESS;
  if (!proxyAddress) {
    throw new Error("VANA_POOL_ENTITY_PROXY_ADDRESS environment variable is required");
  }

  const proxy = await ethers.getContractAt(implementationContractName, proxyAddress);

  const entitiesCount = await proxy.entitiesCount();
  console.log(`Total entities: ${entitiesCount}`);

  // Paginate event queries to stay within the 10,000 block RPC limit
  const CONTRACT_DEPLOY_BLOCK = Number(process.env.VANA_POOL_ENTITY_DEPLOY_BLOCK ?? 2101776);
  const latestBlock = await ethers.provider.getBlockNumber();
  const endBlock = process.env.VANA_POOL_ENTITY_END_BLOCK
    ? Number(process.env.VANA_POOL_ENTITY_END_BLOCK)
    : latestBlock;
  const currentBlock = Math.min(endBlock, latestBlock);
  const BATCH_SIZE = 9999;

  async function queryFilterPaginated(filter: any) {
    const events: any[] = [];
    for (let from = CONTRACT_DEPLOY_BLOCK; from <= currentBlock; from += BATCH_SIZE + 1) {
      const to = Math.min(from + BATCH_SIZE, currentBlock);
      const batch = await proxy.queryFilter(filter, from, to);
      events.push(...batch);
    }
    return events;
  }

  const totalBatches = Math.ceil((currentBlock - CONTRACT_DEPLOY_BLOCK) / BATCH_SIZE);
  console.log(`Scanning events from block ${CONTRACT_DEPLOY_BLOCK} to ${currentBlock} (${totalBatches} batches)\n`);

  const rewardsProcessedEvents = await queryFilterPaginated(proxy.filters.RewardsProcessed());
  const forfeitedEvents = await queryFilterPaginated(proxy.filters.ForfeitedRewardsReturned());

  console.log(`RewardsProcessed events: ${rewardsProcessedEvents.length}`);
  console.log(`ForfeitedRewardsReturned events: ${forfeitedEvents.length}\n`);

  // Aggregate per entity
  const distributed: Record<string, bigint> = {};

  for (const event of rewardsProcessedEvents) {
    const args = (event as any).args;
    const entityId = args.entityId.toString();
    distributed[entityId] = (distributed[entityId] ?? 0n) + args.distributedAmount;
  }

  for (const event of forfeitedEvents) {
    const args = (event as any).args;
    const entityId = args.entityId.toString();
    distributed[entityId] = (distributed[entityId] ?? 0n) - args.amount;
  }

  // Print results
  let grandTotal = 0n;
  const entityIds: bigint[] = [];
  const values: bigint[] = [];

  for (let i = 1; i <= Number(entitiesCount); i++) {
    const val = distributed[i.toString()] ?? 0n;
    const entity = await proxy.entities(i);
    console.log(`Entity ${i} (${entity.name}):`);
    console.log(`  totalDistributedRewards: ${ethers.formatEther(val)} VANA`);
    console.log(`  activeRewardPool:        ${ethers.formatEther(entity.activeRewardPool)} VANA`);
    console.log(`  lockedRewardPool:        ${ethers.formatEther(entity.lockedRewardPool)} VANA`);
    console.log(`  totalShares:             ${entity.totalShares}`);

    if (val > 0n) {
      entityIds.push(BigInt(i));
      values.push(val);
    }
    grandTotal += val;
  }

  console.log(`\nGrand total distributed: ${ethers.formatEther(grandTotal)} VANA`);

  // Output arrays for initializeV2
  console.log(`\n--- initializeV2 parameters ---`);
  console.log(`entityIds: [${entityIds.join(", ")}]`);
  console.log(`values:    [${values.map((v) => v.toString()).join(", ")}]`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
