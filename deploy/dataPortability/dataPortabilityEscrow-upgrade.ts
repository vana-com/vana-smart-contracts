import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";

/**
 * Upgrades the deployed DataPortabilityEscrow UUPS proxy to a freshly compiled
 * implementation. Storage layout is unchanged in this upgrade (SettleOp.ref ->
 * SettleOp.opKind is calldata-only; OpKind enum is type-only; Settled event
 * topic shape changes are off-chain).
 *
 * Env vars used:
 *   DATA_PORTABILITY_ESCROW_PROXY  - proxy address (override default)
 */
const ESCROW_PROXY_DEFAULT = "0xcF50fAb402e2025a92e1bF811049820b6428910A";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const proxyAddress =
    process.env.DATA_PORTABILITY_ESCROW_PROXY ?? ESCROW_PROXY_DEFAULT;

  console.log("Deployer:           ", deployer.address);
  console.log("Escrow proxy:       ", proxyAddress);

  // 1. Deploy the new implementation (no constructor args).
  console.log("\n=== Deploying new DataPortabilityEscrowImplementation ===");
  const implDeploy = await deployments.deploy("DataPortabilityEscrowImplementation", {
    from: deployer.address,
    args: [],
    log: true,
  });
  console.log("New implementation:  ", implDeploy.address);

  // 2. Read the current impl slot on the proxy for the before snapshot.
  const IMPL_SLOT =
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const beforeImplRaw = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
  const beforeImpl = ethers.getAddress("0x" + beforeImplRaw.slice(-40));
  console.log("Previous impl:       ", beforeImpl);

  if (beforeImpl.toLowerCase() === implDeploy.address.toLowerCase()) {
    console.log("Already at this implementation — nothing to do.");
  } else {
    // 3. Call upgradeToAndCall(newImpl, "") on the proxy (UUPS).
    console.log("\n=== Calling upgradeToAndCall on proxy ===");
    const proxyAsUUPS = await ethers.getContractAt(
      "DataPortabilityEscrowImplementation",
      proxyAddress,
    );

    const tx = await proxyAsUUPS
      .connect(deployer)
      .upgradeToAndCall(implDeploy.address, "0x");
    console.log("upgrade tx:         ", tx.hash);
    const receipt = await tx.wait();
    console.log("upgrade mined in:   ", receipt?.blockNumber);

    // 4. Confirm the slot moved.
    const afterImplRaw = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
    const afterImpl = ethers.getAddress("0x" + afterImplRaw.slice(-40));
    console.log("New impl in proxy:  ", afterImpl);

    if (afterImpl.toLowerCase() !== implDeploy.address.toLowerCase()) {
      throw new Error(
        `Upgrade did not take effect: proxy impl is ${afterImpl}, expected ${implDeploy.address}`,
      );
    }
  }

  // 5. Sanity-check: round-trip a view through the proxy to confirm the new
  //    impl is wired and not bricked.
  const escrow = await ethers.getContractAt(
    "DataPortabilityEscrowImplementation",
    proxyAddress,
  );
  const v = await escrow.version();
  const permissionsPtr = await escrow.permissions();
  console.log("\n=== Post-upgrade sanity ===");
  console.log("escrow.version():           ", v.toString());
  console.log("escrow.permissions():       ", permissionsPtr);

  // 6. Blockscout verification (best-effort).
  console.log("\n=== Verifying new impl on Blockscout (may 403 from Cloudflare) ===");
  await verifyContract(implDeploy.address, []);

  console.log("\n=== Upgrade summary ===");
  console.log("Proxy:                  ", proxyAddress);
  console.log("Previous impl:          ", beforeImpl);
  console.log("New impl:               ", implDeploy.address);
};

export default func;
func.tags = ["DataPortabilityEscrowUpgrade"];
