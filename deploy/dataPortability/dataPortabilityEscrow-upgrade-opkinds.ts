import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";

/**
 * Upgrades DataPortabilityEscrow to expand the OpKind enum:
 *   Unspecified, DataRegistration, ServerRegistration,
 *   BuilderRegistration, GrantRegistration (was: Registration), DataAccess.
 *
 * No storage layout change (enum is type-only). Safe UUPS upgrade.
 *
 * Behavior on each chain:
 *   - Moksha:  deployer holds DEFAULT_ADMIN_ROLE -> performs full upgrade
 *   - Mainnet: admin renounced from deployer -> only deploys new impl;
 *              the canonical admin (0x5ECA…3BaF4) must call upgradeToAndCall
 *              separately.
 */
const ESCROW_PROXY = "0x07d7769081adc3a3DBe91f5E4B98E9A5a6B292e3";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const chainId = Number(hre.network.config.chainId ?? (await ethers.provider.getNetwork()).chainId);

  console.log("Deployer:     ", deployer.address);
  console.log("Chain:        ", hre.network.name, `(chainId=${chainId})`);
  console.log("Escrow proxy: ", ESCROW_PROXY);

  // 1. Deploy new impl
  console.log("\n=== Deploying new DataPortabilityEscrowImplementation ===");
  const implDeploy = await deployments.deploy("DataPortabilityEscrowImplementation", {
    from: deployer.address,
    args: [],
    log: true,
  });
  console.log("New impl:     ", implDeploy.address);

  // 2. Snapshot current impl
  const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const beforeRaw = await ethers.provider.getStorage(ESCROW_PROXY, IMPL_SLOT);
  const beforeImpl = ethers.getAddress("0x" + beforeRaw.slice(-40));
  console.log("Current impl: ", beforeImpl);
  if (beforeImpl.toLowerCase() === implDeploy.address.toLowerCase()) {
    console.log("Already at this implementation — nothing to do.");
    return;
  }

  // 3. Authorization check
  const DEFAULT_ADMIN_ROLE = "0x" + "00".repeat(32);
  const proxyAsImpl = await ethers.getContractAt(
    "DataPortabilityEscrowImplementation",
    ESCROW_PROXY,
  );
  const canUpgrade: boolean = await proxyAsImpl.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);

  if (canUpgrade) {
    console.log("\n=== Deployer has admin — performing upgradeToAndCall ===");
    const tx = await proxyAsImpl.connect(deployer).upgradeToAndCall(implDeploy.address, "0x");
    console.log("upgrade tx:   ", tx.hash);
    await tx.wait();

    const afterRaw = await ethers.provider.getStorage(ESCROW_PROXY, IMPL_SLOT);
    const afterImpl = ethers.getAddress("0x" + afterRaw.slice(-40));
    if (afterImpl.toLowerCase() !== implDeploy.address.toLowerCase()) {
      throw new Error(`Upgrade did not take effect: ${afterImpl}`);
    }
    console.log("Confirmed: proxy now at", afterImpl);
  } else {
    const admin = await proxyAsImpl.hasRole(DEFAULT_ADMIN_ROLE, "0x5ECA5208F29e32879a711467916965B2D753bAf4");
    console.log("\n=== Deployer does NOT have admin on this chain ===");
    console.log("Mainnet admin holds DEFAULT_ADMIN_ROLE — must sign the upgrade.");
    if (admin) console.log("Confirmed: 0x5ECA5208F29e32879a711467916965B2D753bAf4 has DEFAULT_ADMIN_ROLE.");
    console.log("");
    console.log("Action required from the admin wallet:");
    console.log(`  await escrow.upgradeToAndCall("${implDeploy.address}", "0x");`);
    console.log("");
    console.log("Calldata for a multisig / manual tx:");
    const iface = new ethers.Interface(["function upgradeToAndCall(address,bytes)"]);
    const data = iface.encodeFunctionData("upgradeToAndCall", [implDeploy.address, "0x"]);
    console.log("  to:    " + ESCROW_PROXY);
    console.log("  data:  " + data);
    console.log("  value: 0");
  }

  // 4. Best-effort verification
  console.log("\n=== Verifying new impl on Blockscout ===");
  await verifyContract(implDeploy.address, []);

  console.log("\n=== Summary ===");
  console.log("Proxy:        ", ESCROW_PROXY);
  console.log("Previous impl:", beforeImpl);
  console.log("New impl:     ", implDeploy.address);
};

export default func;
func.tags = ["DataPortabilityEscrowUpgradeOpKinds"];
