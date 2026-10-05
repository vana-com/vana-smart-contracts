import { ethers } from "hardhat";

const FEE_REGISTRY = "0xb4FA18443E0FA6cdC0280D20b8cCDB2377D13Bf2";

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log("chainId:        ", chainId);
  console.log("FeeRegistry:    ", FEE_REGISTRY);

  const fr = await ethers.getContractAt("FeeRegistryImplementation", FEE_REGISTRY);

  const candidates = ["DATA_ACCESS", "DataAccess", "data_access", "RECORD_DATA_ACCESS", "DATA_ACCESS_FEE"];
  for (const name of candidates) {
    const key = await fr.operationKey(name);
    const registered: boolean = await fr.isFeeRegistered(key);
    if (!registered) {
      console.log(`\n${name}  →  ${key}  → not registered`);
      continue;
    }
    const fee = await fr.fees(key);
    const amount: bigint = await fr.feeAmount(key);
    console.log(`\n${name}  →  ${key}`);
    console.log(`  registered: true`);
    console.log(`  amount:     ${amount} (${ethers.formatEther(amount)} VANA-equivalent)`);
    console.log(`  asset:      ${fee.asset}${fee.asset === ethers.ZeroAddress ? "  (native VANA)" : ""}`);
    console.log(`  payee:      ${fee.payee}`);
    console.log(`  enabled:    ${fee.enabled}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
