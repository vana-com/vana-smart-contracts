// deploy/dlpRegistry-upgrade.ts
import { ethers, upgrades } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  console.log("\n🔄 Starting DLP Registry Upgrade...");
  console.log("═".repeat(80));
  console.log("Network:", hre.network.name);
  console.log("Deployer address:", deployer.address);
  console.log(
    "Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "VANA",
  );

  // IMPORTANT: Update this with the actual proxy address on Moksha
  const EXISTING_DLP_REGISTRY_PROXY = process.env.DLP_REGISTRY_PROXY_ADDRESS;

  if (!EXISTING_DLP_REGISTRY_PROXY) {
    throw new Error("DLP_REGISTRY_PROXY_ADDRESS not set in environment");
  }

  console.log("\n📍 Existing DLP Registry Proxy:", EXISTING_DLP_REGISTRY_PROXY);

  // Get current implementation
  const currentImplementation = await upgrades.erc1967.getImplementationAddress(
    EXISTING_DLP_REGISTRY_PROXY
  );
  console.log("📍 Current Implementation:", currentImplementation);

  // Get current version
  const currentRegistry = await ethers.getContractAt(
    "DLPRegistryImplementation", // Old implementation
    EXISTING_DLP_REGISTRY_PROXY
  );
  
  try {
    const currentVersion = await currentRegistry.version();
    console.log("📍 Current Version:", currentVersion.toString());
  } catch (error) {
    console.log("⚠️  Could not read current version (may not exist)");
  }

  // Check some critical data before upgrade
  console.log("\n🔍 Pre-upgrade State Check:");
  console.log("─".repeat(80));
  
  const dlpsCount = await currentRegistry.dlpsCount();
  console.log("Total DLPs registered:", dlpsCount.toString());

  if (dlpsCount > 0n) {
    // Check first DLP
    const dlp1 = await currentRegistry.dlps(1);
    console.log("\nSample DLP (ID 1):");
    console.log("  Address:", dlp1.dlpAddress);
    console.log("  Owner:", dlp1.ownerAddress);
    console.log("  Name:", dlp1.name);
    console.log("  Status:", dlp1.status);
  }

  // Confirmation prompt
  console.log("\n" + "═".repeat(80));
  console.log("⚠️  WARNING: About to upgrade DLP Registry!");
  console.log("═".repeat(80));
  console.log("This will:");
  console.log("  ✓ Preserve all existing DLP data");
  console.log("  ✓ Add dataset linking functionality (V2)");
  console.log("  ✓ Keep all existing roles and permissions");
  console.log("  ✓ Maintain backward compatibility");
  console.log("\nProxy address will remain: " + EXISTING_DLP_REGISTRY_PROXY);
  console.log("Implementation will be replaced with: DLPRegistryV1Implementation");
  
  if (process.env.SKIP_CONFIRMATION !== "true") {
    console.log("\n⏸️  Set SKIP_CONFIRMATION=true to proceed");
    return;
  }

  console.log("\n" + "═".repeat(80));
  console.log("🚀 Proceeding with upgrade...");
  console.log("═".repeat(80) + "\n");

  // Deploy new implementation
  console.log("📦 Deploying new implementation...");
  const DLPRegistryV1 = await ethers.getContractFactory("DLPRegistryV1Implementation");
  
  const upgraded = await upgrades.upgradeProxy(
    EXISTING_DLP_REGISTRY_PROXY,
    DLPRegistryV1,
    {
      kind: "uups",
      call: { fn: "version", args: [] }, // Call version() after upgrade to verify
    }
  );

  await upgraded.waitForDeployment();

  const newImplementation = await upgrades.erc1967.getImplementationAddress(
    EXISTING_DLP_REGISTRY_PROXY
  );

  console.log("✅ Upgrade complete!");
  console.log("   New Implementation:", newImplementation);

  // Verify upgrade
  console.log("\n🔍 Post-upgrade Verification:");
  console.log("─".repeat(80));

  const upgradedRegistry = await ethers.getContractAt(
    "DLPRegistryV1Implementation",
    EXISTING_DLP_REGISTRY_PROXY
  );

  const newVersion = await upgradedRegistry.version();
  console.log("✓ New Version:", newVersion.toString());

  if (newVersion !== 2n) {
    throw new Error("Version mismatch! Expected 2, got " + newVersion.toString());
  }

  const postDlpsCount = await upgradedRegistry.dlpsCount();
  console.log("✓ DLPs Count (preserved):", postDlpsCount.toString());

  if (postDlpsCount !== dlpsCount) {
    throw new Error("DLP count changed during upgrade!");
  }

  if (dlpsCount > 0n) {
    const dlp1 = await upgradedRegistry.dlps(1);
    console.log("\n✓ Sample DLP (ID 1) preserved:");
    console.log("  Address:", dlp1.dlpAddress);
    console.log("  Owner:", dlp1.ownerAddress);
    console.log("  Name:", dlp1.name);
    console.log("  Status:", dlp1.status);

    // Test new V2 function
    const datasetId = await upgradedRegistry.getDlpDataset(1);
    console.log("  Dataset ID:", datasetId.toString(), "(new V2 field)");
  }

  // Verify implementation contract
  console.log("\n🔍 Verifying new implementation on Etherscan...");
  try {
    await hre.run("verify:verify", {
      address: newImplementation,
      constructorArguments: [],
    });
    console.log("✅ Implementation verified");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("✅ Implementation already verified");
    } else {
      console.log("⚠️  Verification failed:", error.message);
      console.log("   You may need to verify manually");
    }
  }

  // Summary
  console.log("\n" + "═".repeat(80));
  console.log("🎉 DLP REGISTRY UPGRADE COMPLETE!");
  console.log("═".repeat(80));
  console.log("\n📋 Upgrade Summary:");
  console.log("─".repeat(80));
  console.log("Proxy Address:          ", EXISTING_DLP_REGISTRY_PROXY);
  console.log("Old Implementation:     ", currentImplementation);
  console.log("New Implementation:     ", newImplementation);
  console.log("Version:                ", "1 → 2");
  console.log("DLPs Preserved:         ", postDlpsCount.toString());

  console.log("\n✨ New V2 Features Available:");
  console.log("─".repeat(80));
  console.log("1. getDlpDataset(dlpId) - Query dataset linked to DLP");
  console.log("2. updateDlpDataset(dlpId, datasetId) - Link DLP to dataset");
  console.log("3. Backward compatible - all V1 functions still work");

  console.log("\n📝 Next Steps:");
  console.log("─".repeat(80));
  console.log("1. Test the upgrade:");
  console.log("   → Call dlps(1) - should work as before");
  console.log("   → Call getDlpDataset(1) - should return 0 (no dataset yet)");
  console.log("\n2. Start linking DLPs to datasets:");
  console.log("   → dlpRegistry.updateDlpDataset(dlpId, datasetId)");
  console.log("\n3. Update frontend/backend to use new dataset functionality");

  console.log("\n" + "═".repeat(80) + "\n");

  // Save upgrade info
  const upgradeInfo = {
    network: hre.network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    timestamp: new Date().toISOString(),
    upgrader: deployer.address,
    proxyAddress: EXISTING_DLP_REGISTRY_PROXY,
    oldImplementation: currentImplementation,
    newImplementation: newImplementation,
    oldVersion: "1",
    newVersion: "2",
    dlpsPreserved: postDlpsCount.toString(),
  };

  const fs = require("fs");
  const path = require("path");

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = `dlpRegistry-upgrade-${hre.network.name}-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(upgradeInfo, null, 2)
  );

  console.log(`💾 Upgrade info saved to: deployments/${filename}\n`);
};

export default func;
func.tags = ["DLPRegistryUpgrade"];
