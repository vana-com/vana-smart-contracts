import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";
import { UPGRADES, liveImplementation, predictImplementation, saltFor, saltHashFor } from "../../scripts/dataPortabilityV2/hashlock6";

/**
 * Deploys the four implementations that ship the Hashlock 6th audit fixes
 * (fix-review commit b8ed895): DataRegistryV2, DataPortabilityServersV2,
 * DataPortabilityPermissionsV2, DataPortabilityEscrow. FeeRegistry is unchanged.
 *
 * It never upgrades anything and needs no admin: the proxies' DEFAULT_ADMIN_ROLE
 * is the mainnet Safe, which executes the batch that
 * `scripts/dataPortabilityV2/hashlock6UpgradeBatch.ts` writes.
 *
 * Every implementation is a CREATE2 deployment through the shared factory with the
 * salt `<ContractName>-hashlock6`, so its address is known before this runs and the
 * Safe batch can be prepared (and signed) first. Re-running is a no-op for any
 * implementation whose code is already at its predicted address.
 *
 *   LEDGER_ADDRESS=0x… npx hardhat deploy --network vana --tags DPV2Hashlock6Implementations
 *
 * Mainnet signs only through the Ledger (`vana` network: accounts "remote" +
 * ledgerAccounts). Ethereum app open, blind signing enabled: each deploy is a call
 * to the factory with data. Optional: GAS_PRICE_MULTIPLIER (default 2).
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const chainId = Number(hre.network.config.chainId ?? (await ethers.provider.getNetwork()).chainId);
  console.log(`Deployer: ${deployer.address}   chain: ${hre.network.name} (${chainId})`);

  const mainnet = hre.network.name === "vana";
  if (mainnet && !process.env.LEDGER_ADDRESS) {
    throw new Error("Mainnet implementations must be deployed from the hardware wallet: set LEDGER_ADDRESS");
  }
  if (mainnet && deployer.address.toLowerCase() !== process.env.LEDGER_ADDRESS!.toLowerCase()) {
    throw new Error(`Signer ${deployer.address} is not LEDGER_ADDRESS ${process.env.LEDGER_ADDRESS}`);
  }

  const feeData = await ethers.provider.getFeeData();
  const multiplier = BigInt(process.env.GAS_PRICE_MULTIPLIER || "2");
  const gasPrice = (feeData.gasPrice ?? 0n) * multiplier;
  console.log(`Gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei (${multiplier}x current)`);

  const summary: { contract: string; proxy: string; live: string; predicted: string; deployed: string }[] = [];

  for (const u of UPGRADES) {
    console.log(`\n********** ${u.contract} **********`);
    const predicted = await predictImplementation(u.contract);
    const live = await liveImplementation(u.proxy);
    console.log(`proxy ${u.proxy}  live impl ${live}`);
    console.log(`salt "${saltFor(u.contract)}"  -> predicted ${predicted}`);
    if (live.toLowerCase() === predicted.toLowerCase()) {
      console.log("Proxy already points at this implementation; nothing to deploy.");
      summary.push({ contract: u.contract, proxy: u.proxy, live, predicted, deployed: predicted });
      continue;
    }

    const existing = await ethers.provider.getCode(predicted);
    if (existing !== "0x") {
      console.log("Code already present at the predicted address (previous run); skipping deploy.");
    }

    const result = await deployments.deploy(u.contract, {
      from: deployer.address,
      args: [],
      deterministicDeployment: saltHashFor(u.contract),
      log: true,
      gasPrice: gasPrice.toString(),
    });
    if (result.address.toLowerCase() !== predicted.toLowerCase()) {
      throw new Error(`${u.contract}: deployed at ${result.address}, expected ${predicted}. Artifacts differ from the batch's commit?`);
    }
    console.log(`${u.contract} at ${result.address}${result.newlyDeployed ? " (new)" : " (already deployed)"}`);
    summary.push({ contract: u.contract, proxy: u.proxy, live, predicted, deployed: result.address });

    if (result.newlyDeployed) {
      await delay(6000);
      await verifyContract(result.address, []);
    }
  }

  console.log("\n=== Summary ===");
  for (const s of summary) {
    console.log(`${s.contract.padEnd(44)} proxy ${s.proxy}  live ${s.live}  new ${s.deployed}`);
  }
  console.log("\nNo upgrade was performed. Next: the Safe executes docs/dataPortability/mainnet-safe/1-upgrade-dp-v2-hashlock6.json");
  console.log("(built by `npx hardhat run scripts/dataPortabilityV2/hashlock6UpgradeBatch.ts`; its addresses must equal the ones above).");
};

export default func;
func.tags = ["DPV2Hashlock6Implementations"];
