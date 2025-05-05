// scripts/test-vesting.ts
import { ethers } from "hardhat";
import { DAT, VestingFactory } from "../typechain-types";

const {
  MOKSHA_RPC_URL,
  DEPLOYER_PRIVATE_KEY,
  OWNER_PRIVATE_KEY,
  DAT_ADDRESS,
  VESTING_FACTORY_ADDRESS,
} = process.env;

if (!MOKSHA_RPC_URL || !DEPLOYER_PRIVATE_KEY || !OWNER_PRIVATE_KEY || !DAT_ADDRESS || !VESTING_FACTORY_ADDRESS) {
  throw new Error("Set MOKSHA_RPC_URL, DEPLOYER_PRIVATE_KEY, OWNER_PRIVATE_KEY, DAT_ADDRESS, VESTING_FACTORY_ADDRESS in env");
}

async function main() {
  /* ------------------------------------------------------------------ */
  /* 1. provider & signers                                              */
  /* ------------------------------------------------------------------ */
  const provider  = new ethers.JsonRpcProvider(MOKSHA_RPC_URL as string);
  const deployer  = new ethers.Wallet(DEPLOYER_PRIVATE_KEY as string, provider);
  const owner     = new ethers.Wallet(OWNER_PRIVATE_KEY as string,    provider);

  console.log(`Deployer: ${deployer.address}`);
  console.log(`Owner:    ${owner.address}\n`);

  /* ------------------------------------------------------------------ */
  /* 2. connect to deployed contracts                                   */
  /* ------------------------------------------------------------------ */
  const dat      = (await ethers.getContractAt("DAT", DAT_ADDRESS as string))   as DAT;
  const factory  = (await ethers.getContractAt(
                      "VestingFactory",
                      VESTING_FACTORY_ADDRESS as string
                    )) as VestingFactory;

  /* ------------------------------------------------------------------ */
  /* 3. parameters                                                      */
  /* ------------------------------------------------------------------ */
  const GRANT_L  = ethers.parseEther("1000");   // linear
  const GRANT_C  = ethers.parseEther("500");    // cliff
  const GRANT_U  = ethers.parseEther("250");    // unlocked

  const latestBlock = await provider.getBlock("latest");
  const now = latestBlock ? Number(latestBlock.timestamp) : Math.floor(Date.now() / 1000);
  const LINEAR_DUR = 90n * 24n * 60n * 60n;               // 90 days
  const CLIFF_DUR  = 30n * 24n * 60n * 60n;               // 30-day cliff
  const TOTAL_DUR  = 180n * 24n * 60n * 60n;              // 180-day vest

  /* ------------------------------------------------------------------ */
  /* 4. helper to parse VestingCreated event                            */
  /* ------------------------------------------------------------------ */
  async function createWallet(
    fn: "createLinearVesting" | "createCliffVesting" | "createNoVesting",
    args: any[],  // Using any[] since we need flexibility across different function signatures
    label: string
  ): Promise<string> {
    // Type assertion to handle the function call
    const contractFunction = factory.connect(owner)[fn] as (...args: any[]) => Promise<any>;
    const tx = await contractFunction(...args);
    const rc = await tx.wait();
    
    if (!rc) throw new Error(`${label}: Transaction failed`);
    
    // Find VestingCreated event
    const vestingCreatedEvent = rc.logs
      .filter((log: { topics: string[], data: string }) => {
        try {
          const parsed = factory.interface.parseLog({ 
            topics: log.topics as string[], 
            data: log.data 
          });
          return parsed && parsed.name === "VestingCreated";
        } catch {
          return false;
        }
      })
      .map((log: { topics: string[], data: string }) => factory.interface.parseLog({ 
        topics: log.topics as string[], 
        data: log.data 
      }))[0];
    
    if (!vestingCreatedEvent) throw new Error(`${label}: VestingCreated event not found`);
    
    const walletAddr: string = vestingCreatedEvent.args[0];
    console.log(`${label} wallet created → ${walletAddr}`);
    return walletAddr;
  }

  /* ------------------------------------------------------------------ */
  /* 5. create wallets & verify balances                                */
  /* ------------------------------------------------------------------ */
  console.log("Creating LinearVestingWallet …");
  const linearWallet = await createWallet(
    "createLinearVesting",
    [ owner.address, GRANT_L, now + 60, LINEAR_DUR ],
    "Linear"
  );

  try {
    await factory.connect(owner).createCliffVesting.staticCall(
      owner.address,
      GRANT_C,
      now + 60,
      CLIFF_DUR,
      TOTAL_DUR
    );
    console.log("did not create any error");
  } catch (e: any) {
    console.error("staticCall revert:", e.shortMessage || e);
    return;
  }

  const gasLimit = (await factory.connect(owner)
  .createCliffVesting.estimateGas(
    owner.address, GRANT_C, now + 60, CLIFF_DUR, TOTAL_DUR
  ))*12n/10n;            // +20 % safety margin

  console.log(`gasLimit is set to ${gasLimit}`);

  console.log("Creating CliffVestingWallet …");
  const cliffWallet = await createWallet(
    "createCliffVesting",
    [ owner.address, GRANT_C, now + 60, CLIFF_DUR, TOTAL_DUR, {gasLimit} ],
    "Cliff"
  );

  const gasLimit2 = (await factory.connect(owner)
  .createNoVesting.estimateGas(
    owner.address, GRANT_U
  ))*12n/10n;            // +20 % safety margin


  console.log("Creating NoVestingWallet …");
  const unlockedWallet = await createWallet(
    "createNoVesting",
    [ owner.address, GRANT_U, {gasLimit: gasLimit2} ],
    "Unlocked"
  );

  /* ------------------------------------------------------------------ */
  /* 6. sanity-check balances                                           */
  /* ------------------------------------------------------------------ */
  const balLinear   = await dat.balanceOf(linearWallet);
  const balCliff    = await dat.balanceOf(cliffWallet);
  const balUnlocked = await dat.balanceOf(unlockedWallet);

  console.log("\n--- Token balances ---");
  console.log(`Linear   : ${ethers.formatEther(balLinear)} DAT`);
  console.log(`Cliff    : ${ethers.formatEther(balCliff)} DAT`);
  console.log(`Unlocked : ${ethers.formatEther(balUnlocked)} DAT`);

  // Compare BigInts using comparison operators instead of !== 
  if (balLinear != GRANT_L || balCliff != GRANT_C || balUnlocked != GRANT_U) {
    throw new Error("❌ One or more wallets did not receive the expected token amount");
  }
  console.log("✅ All wallets funded correctly");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
