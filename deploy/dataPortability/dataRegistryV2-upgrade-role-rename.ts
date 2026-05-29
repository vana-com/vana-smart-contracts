import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";

/**
 * Upgrades DataRegistryV2 to rename FACILITATOR_ROLE -> ACCESS_RECORDER_ROLE.
 *
 * Role rename is a CONSTANT change, not a storage change — safe upgrade.
 * However, the on-chain role hash differs (keccak256("FACILITATOR_ROLE") vs
 * keccak256("ACCESS_RECORDER_ROLE")), so existing role grants do NOT carry
 * over. Re-grant ACCESS_RECORDER_ROLE to the previous holder after the upgrade.
 *
 * Env vars used:
 *   DATA_REGISTRY_V2_PROXY       - default 0x0850226E939A5C949633200cf0b1F4665CA74931
 *   DATA_REGISTRY_FACILITATOR    - address to grant the renamed role to.
 *                                  Defaults to OWNER_ADDRESS.
 *   OWNER_ADDRESS                - fallback for the role grant
 */
const PROXY_DEFAULT = "0x0850226E939A5C949633200cf0b1F4665CA74931";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const proxyAddress = process.env.DATA_REGISTRY_V2_PROXY ?? PROXY_DEFAULT;
  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;
  const recorderAddress = process.env.DATA_REGISTRY_FACILITATOR ?? ownerAddress;

  console.log("Deployer:                       ", deployer.address);
  console.log("DataRegistryV2 proxy:           ", proxyAddress);
  console.log("Grant ACCESS_RECORDER_ROLE to:  ", recorderAddress);

  // ----------------------------------------------------------------
  // 1. Deploy new implementation
  // ----------------------------------------------------------------
  console.log("\n=== Deploying new DataRegistryV2Implementation ===");
  const implDeploy = await deployments.deploy("DataRegistryV2Implementation", {
    from: deployer.address,
    args: [],
    log: true,
  });
  console.log("New implementation:  ", implDeploy.address);

  // ----------------------------------------------------------------
  // 2. Read current impl slot for before snapshot
  // ----------------------------------------------------------------
  const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const beforeImplRaw = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
  const beforeImpl = ethers.getAddress("0x" + beforeImplRaw.slice(-40));
  console.log("Previous impl:       ", beforeImpl);

  // ----------------------------------------------------------------
  // 3. Upgrade
  // ----------------------------------------------------------------
  if (beforeImpl.toLowerCase() === implDeploy.address.toLowerCase()) {
    console.log("Already at this implementation — skipping upgrade.");
  } else {
    console.log("\n=== Calling upgradeToAndCall on proxy ===");
    const proxyAsUUPS = await ethers.getContractAt(
      "DataRegistryV2Implementation",
      proxyAddress,
    );
    const tx = await proxyAsUUPS.connect(deployer).upgradeToAndCall(implDeploy.address, "0x");
    console.log("upgrade tx:         ", tx.hash);
    await tx.wait();

    const afterImplRaw = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
    const afterImpl = ethers.getAddress("0x" + afterImplRaw.slice(-40));
    console.log("New impl in proxy:  ", afterImpl);
    if (afterImpl.toLowerCase() !== implDeploy.address.toLowerCase()) {
      throw new Error(
        `Upgrade did not take effect: proxy impl is ${afterImpl}, expected ${implDeploy.address}`,
      );
    }
  }

  // ----------------------------------------------------------------
  // 4. Grant ACCESS_RECORDER_ROLE
  // ----------------------------------------------------------------
  console.log("\n=== Granting ACCESS_RECORDER_ROLE ===");
  const ACCESS_RECORDER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ACCESS_RECORDER_ROLE"));
  const registry = await ethers.getContractAt(
    "DataRegistryV2Implementation",
    proxyAddress,
  );
  const hasRole: boolean = await registry.hasRole(ACCESS_RECORDER_ROLE, recorderAddress);
  if (hasRole) {
    console.log("Already has ACCESS_RECORDER_ROLE.");
  } else {
    const grantTx = await registry
      .connect(deployer)
      .grantRole(ACCESS_RECORDER_ROLE, recorderAddress);
    await grantTx.wait();
    console.log("grantRole tx:", grantTx.hash);
  }

  const verifyRole: boolean = await registry.hasRole(ACCESS_RECORDER_ROLE, recorderAddress);
  if (!verifyRole) {
    throw new Error(`grantRole failed: ${recorderAddress} does not have ACCESS_RECORDER_ROLE`);
  }
  console.log("Role grant verified.");

  // Inform about stale role (old grant on FACILITATOR_ROLE hash). Not removed
  // automatically — it's harmless (dead storage; new code doesn't check this).
  const STALE_FACILITATOR = ethers.keccak256(ethers.toUtf8Bytes("FACILITATOR_ROLE"));
  const stillHasStale: boolean = await registry.hasRole(STALE_FACILITATOR, recorderAddress);
  if (stillHasStale) {
    console.log(
      "Note: stale FACILITATOR_ROLE grant still in storage for",
      recorderAddress,
      "— harmless (no code checks it now). Revoke if you want a clean access-control table.",
    );
  }

  // ----------------------------------------------------------------
  // 5. Blockscout verification
  // ----------------------------------------------------------------
  console.log("\n=== Verifying new impl on Blockscout ===");
  await verifyContract(implDeploy.address, []);

  console.log("\n=== Upgrade summary ===");
  console.log("Proxy:                            ", proxyAddress);
  console.log("Previous impl:                    ", beforeImpl);
  console.log("New impl:                         ", implDeploy.address);
  console.log("ACCESS_RECORDER_ROLE holder:      ", recorderAddress);
};

export default func;
func.tags = ["DataRegistryV2UpgradeRoleRename"];
