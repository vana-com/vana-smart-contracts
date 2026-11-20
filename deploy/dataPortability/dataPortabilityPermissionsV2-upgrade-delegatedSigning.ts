import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";

/**
 * Upgrades DataPortabilityPermissionsV2 to accept a delegated signature from a
 * personal server currently registered to the grantor in DataPortabilityServersV2.
 *
 * Adds:
 *   - storage field `dataPortabilityServers`
 *   - admin `setDataPortabilityServers(address)`
 *   - new event `PermissionSignedByDelegate`, `DataPortabilityServersUpdated`
 *   - delegation branch in `addPermissionWithSignature` (selector unchanged)
 *
 * Selector preserved: `addPermissionWithSignature((address,bytes32,string[],uint256,uint256),bytes)`
 * → `0xdb503733`. The escrow runOpAndSettle allowlist entry stays valid.
 *
 * Per chain:
 *   - Moksha:  deployer has admin → upgrade + wire servers.
 *   - Mainnet: deployer has no admin → deploys impl only, prints calldata
 *              for the admin and a follow-up `setDataPortabilityServers` call.
 */
const PERMISSIONS_PROXY = "0x4d3FA76064D88e0454cFc4CaD7e5FeC3e3124011";
const SERVERS_PROXY = "0xCae2CE0e9caa6643ed28186cF57bd40Bd9E17Eab";
const MAINNET_ADMIN = "0x5ECA5208F29e32879a711467916965B2D753bAf4";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const chainId = Number(hre.network.config.chainId ?? (await ethers.provider.getNetwork()).chainId);

  console.log("Deployer:           ", deployer.address);
  console.log("Chain:              ", hre.network.name, `(chainId=${chainId})`);
  console.log("Permissions proxy:  ", PERMISSIONS_PROXY);
  console.log("Servers proxy:      ", SERVERS_PROXY);

  // 1. Deploy new impl
  console.log("\n=== Deploying new DataPortabilityPermissionsV2Implementation ===");
  const implDeploy = await deployments.deploy("DataPortabilityPermissionsV2Implementation", {
    from: deployer.address,
    args: [],
    log: true,
  });
  console.log("New impl:           ", implDeploy.address);

  // 2. Snapshot current impl
  const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const beforeRaw = await ethers.provider.getStorage(PERMISSIONS_PROXY, IMPL_SLOT);
  const beforeImpl = ethers.getAddress("0x" + beforeRaw.slice(-40));
  console.log("Current impl:       ", beforeImpl);

  const proxyAsImpl = await ethers.getContractAt(
    "DataPortabilityPermissionsV2Implementation",
    PERMISSIONS_PROXY,
  );

  const DEFAULT_ADMIN_ROLE = "0x" + "00".repeat(32);
  const canAdmin: boolean = await proxyAsImpl.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);

  // ---------- Upgrade ----------
  if (beforeImpl.toLowerCase() !== implDeploy.address.toLowerCase()) {
    if (canAdmin) {
      console.log("\n=== Deployer has admin — performing upgradeToAndCall ===");
      const tx = await proxyAsImpl.connect(deployer).upgradeToAndCall(implDeploy.address, "0x");
      console.log("upgrade tx:         ", tx.hash);
      await tx.wait();

      const afterRaw = await ethers.provider.getStorage(PERMISSIONS_PROXY, IMPL_SLOT);
      const afterImpl = ethers.getAddress("0x" + afterRaw.slice(-40));
      if (afterImpl.toLowerCase() !== implDeploy.address.toLowerCase()) {
        throw new Error(`Upgrade did not take effect: ${afterImpl}`);
      }
      console.log("Confirmed: proxy now at", afterImpl);
    } else {
      console.log("\n=== Deployer does NOT have admin — printing upgrade calldata ===");
      const iface = new ethers.Interface(["function upgradeToAndCall(address,bytes)"]);
      const data = iface.encodeFunctionData("upgradeToAndCall", [implDeploy.address, "0x"]);
      console.log("Admin wallet must send:");
      console.log("  to:    " + PERMISSIONS_PROXY);
      console.log("  data:  " + data);
      console.log("  value: 0");
    }
  } else {
    console.log("Proxy already on this impl — skipping upgradeToAndCall.");
  }

  // ---------- Wire servers ----------
  console.log("\n=== Wiring dataPortabilityServers ===");
  let currentServers: string;
  try {
    currentServers = await proxyAsImpl.dataPortabilityServers();
  } catch (e) {
    // Function not yet present (proxy still on old impl on mainnet). That's fine.
    currentServers = ethers.ZeroAddress;
    console.log("Note: dataPortabilityServers() not callable yet (proxy still on old impl).");
  }
  console.log("Current servers:    ", currentServers);

  if (currentServers.toLowerCase() === SERVERS_PROXY.toLowerCase()) {
    console.log("Already wired — no-op.");
  } else if (canAdmin && beforeImpl.toLowerCase() !== implDeploy.address.toLowerCase()) {
    // Only run live setter if we actually have admin AND the new impl is live now.
    const tx = await proxyAsImpl
      .connect(deployer)
      .setDataPortabilityServers(SERVERS_PROXY);
    console.log("setDataPortabilityServers tx:", tx.hash);
    await tx.wait();
    const after = await proxyAsImpl.dataPortabilityServers();
    if (after.toLowerCase() !== SERVERS_PROXY.toLowerCase()) {
      throw new Error(`Wiring did not take effect: ${after}`);
    }
    console.log("Confirmed: dataPortabilityServers ->", after);
  } else if (canAdmin) {
    // Edge: deployer is admin but proxy was already on this impl (re-run).
    const tx = await proxyAsImpl
      .connect(deployer)
      .setDataPortabilityServers(SERVERS_PROXY);
    console.log("setDataPortabilityServers tx:", tx.hash);
    await tx.wait();
    console.log("Confirmed.");
  } else {
    console.log("Deployer is NOT admin — printing follow-up calldata for admin:");
    const iface = new ethers.Interface(["function setDataPortabilityServers(address)"]);
    const data = iface.encodeFunctionData("setDataPortabilityServers", [SERVERS_PROXY]);
    console.log("Admin wallet must send (AFTER upgrade goes through):");
    console.log("  to:    " + PERMISSIONS_PROXY);
    console.log("  data:  " + data);
    console.log("  value: 0");
  }

  // ---------- Verify ----------
  console.log("\n=== Verifying new impl on Blockscout ===");
  await verifyContract(implDeploy.address, []);

  console.log("\n=== Summary ===");
  console.log("Permissions proxy:  ", PERMISSIONS_PROXY);
  console.log("Previous impl:      ", beforeImpl);
  console.log("New impl:           ", implDeploy.address);
};

export default func;
func.tags = ["DataPortabilityPermissionsV2UpgradeDelegatedSigning"];
