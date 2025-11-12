import { ethers, deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployProxy, verifyProxy } from "./helpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  console.log("\n🚀 Starting Data Access V1 deployment (without DLP Registry)...");
  console.log("═".repeat(80));
  console.log("Deployer address:", deployer.address);
  console.log(
    "Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "VANA",
  );

  // Configuration
  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;
  const securityCouncilAddress =
    process.env.SECURITY_COUNCIL_ADDRESS ?? deployer.address;
  const initialPGEPublicKey =
    process.env.INITIAL_PGE_PUBLIC_KEY ??
    "0x" + "04".repeat(65); // 65 bytes for uncompressed EC public key
  const initialCommittee = process.env.COMMITTEE_ADDRESSES?.split(",") ?? [];
  const existingDlpRegistry = process.env.DLP_REGISTRY_PROXY_ADDRESS;

  console.log("\nConfiguration:");
  console.log("─".repeat(80));
  console.log("Owner address:", ownerAddress);
  console.log("Security Council:", securityCouncilAddress);
  console.log("Committee members:", initialCommittee.length);
  console.log("Existing DLP Registry:", existingDlpRegistry || "Not set (will deploy new)");
  console.log("═".repeat(80) + "\n");

  // 1. Deploy ProtocolConfig
  console.log("📦 [1/6] Deploying ProtocolConfig...");
  const protocolConfigDeploy = await deployProxy(
    deployer,
    "ProtocolConfigProxy",
    "ProtocolConfigImplementation",
    [
      ownerAddress,
      initialPGEPublicKey,
      ethers.ZeroAddress, // Will update after AttestationPolicy
      initialCommittee,
    ],
  );
  console.log(
    "✅ ProtocolConfig deployed at:",
    protocolConfigDeploy.proxyAddress,
  );
  console.log(
    "   Implementation:",
    protocolConfigDeploy.implementationAddress,
  );

  // 2. Deploy AttestationPolicy
  console.log("\n📦 [2/6] Deploying AttestationPolicy...");
  const attestationPolicyDeploy = await deployProxy(
    deployer,
    "AttestationPolicyProxy",
    "AttestationPolicyImplementation",
    [ownerAddress, securityCouncilAddress],
  );
  console.log(
    "✅ AttestationPolicy deployed at:",
    attestationPolicyDeploy.proxyAddress,
  );
  console.log(
    "   Implementation:",
    attestationPolicyDeploy.implementationAddress,
  );

  // Update ProtocolConfig with AttestationPolicy address
  console.log("\n🔗 Updating ProtocolConfig with AttestationPolicy address...");
  const protocolConfig = await ethers.getContractAt(
    "ProtocolConfigImplementation",
    protocolConfigDeploy.proxyAddress,
  );
  const updateTx = await protocolConfig.updateAttestationPolicy(
    attestationPolicyDeploy.proxyAddress,
  );
  await updateTx.wait();
  console.log("✅ ProtocolConfig updated");

  // 3. Deploy DatasetRegistry
  console.log("\n📦 [3/6] Deploying DatasetRegistry...");
  const datasetRegistryDeploy = await deployProxy(
    deployer,
    "DatasetRegistryProxy",
    "DatasetRegistryImplementation",
    [ownerAddress],
  );
  console.log(
    "✅ DatasetRegistry deployed at:",
    datasetRegistryDeploy.proxyAddress,
  );
  console.log(
    "   Implementation:",
    datasetRegistryDeploy.implementationAddress,
  );

  // 4. Deploy VanaRuntimeServers
  console.log("\n📦 [4/6] Deploying VanaRuntimeServers...");
  const runtimeServersDeploy = await deployProxy(
    deployer,
    "VanaRuntimeServersProxy",
    "VanaRuntimeServersImplementation",
    [ownerAddress],
  );
  console.log(
    "✅ VanaRuntimeServers deployed at:",
    runtimeServersDeploy.proxyAddress,
  );
  console.log(
    "   Implementation:",
    runtimeServersDeploy.implementationAddress,
  );

  // 5. Deploy VanaRuntimePermissions
  console.log("\n📦 [5/6] Deploying VanaRuntimePermissions...");
  const runtimePermissionsDeploy = await deployProxy(
    deployer,
    "VanaRuntimePermissionsProxy",
    "VanaRuntimePermissionsImplementation",
    [ownerAddress, datasetRegistryDeploy.proxyAddress],
  );
  console.log(
    "✅ VanaRuntimePermissions deployed at:",
    runtimePermissionsDeploy.proxyAddress,
  );
  console.log(
    "   Implementation:",
    runtimePermissionsDeploy.implementationAddress,
  );

  // 6. Deploy AccessSettlement
  console.log("\n📦 [6/6] Deploying AccessSettlement...");
  const accessSettlementDeploy = await deployProxy(
    deployer,
    "AccessSettlementProxy",
    "AccessSettlementImplementation",
    [ownerAddress],
  );
  console.log(
    "✅ AccessSettlement deployed at:",
    accessSettlementDeploy.proxyAddress,
  );
  console.log(
    "   Implementation:",
    accessSettlementDeploy.implementationAddress,
  );

  // 7. DLP Registry - SKIPPED (will upgrade separately)
  console.log("\n⏭️  [7/7] Skipping DLP Registry deployment");
  if (existingDlpRegistry) {
    console.log("   Existing proxy:", existingDlpRegistry);
    console.log("   Run dlpRegistry-upgrade.ts to upgrade to V2");
  } else {
    console.log("   ⚠️  Warning: DLP_REGISTRY_PROXY_ADDRESS not set!");
    console.log("   Set this before running upgrade script");
  }

  // Verification
  console.log("\n🔍 Starting contract verification...");
  console.log("═".repeat(80));

  await verifyProxy(
    protocolConfigDeploy.proxyAddress,
    protocolConfigDeploy.implementationAddress,
    protocolConfigDeploy.initializeData,
    "contracts/data/dataAccessV1/ProtocolConfigProxy.sol:ProtocolConfigProxy",
  );

  await verifyProxy(
    attestationPolicyDeploy.proxyAddress,
    attestationPolicyDeploy.implementationAddress,
    attestationPolicyDeploy.initializeData,
    "contracts/data/dataAccessV1/AttestationPolicyProxy.sol:AttestationPolicyProxy",
  );

  await verifyProxy(
    datasetRegistryDeploy.proxyAddress,
    datasetRegistryDeploy.implementationAddress,
    datasetRegistryDeploy.initializeData,
    "contracts/data/dataAccessV1/DatasetRegistryProxy.sol:DatasetRegistryProxy",
  );

  await verifyProxy(
    runtimeServersDeploy.proxyAddress,
    runtimeServersDeploy.implementationAddress,
    runtimeServersDeploy.initializeData,
    "contracts/data/dataAccessV1/VanaRuntimeServersProxy.sol:VanaRuntimeServersProxy",
  );

  await verifyProxy(
    runtimePermissionsDeploy.proxyAddress,
    runtimePermissionsDeploy.implementationAddress,
    runtimePermissionsDeploy.initializeData,
    "contracts/data/dataAccessV1/VanaRuntimePermissionsProxy.sol:VanaRuntimePermissionsProxy",
  );

  await verifyProxy(
    accessSettlementDeploy.proxyAddress,
    accessSettlementDeploy.implementationAddress,
    accessSettlementDeploy.initializeData,
    "contracts/data/dataAccessV1/AccessSettlementProxy.sol:AccessSettlementProxy",
  );

  // Summary
  console.log("\n" + "═".repeat(80));
  console.log("🎉 DATA ACCESS V1 NEW CONTRACTS DEPLOYED!");
  console.log("═".repeat(80));
  console.log("\n📋 Contract Addresses:");
  console.log("─".repeat(80));
  console.log(
    "ProtocolConfig:           ",
    protocolConfigDeploy.proxyAddress,
  );
  console.log(
    "AttestationPolicy:        ",
    attestationPolicyDeploy.proxyAddress,
  );
  console.log(
    "DatasetRegistry:          ",
    datasetRegistryDeploy.proxyAddress,
  );
  console.log(
    "VanaRuntimeServers:       ",
    runtimeServersDeploy.proxyAddress,
  );
  console.log(
    "VanaRuntimePermissions:   ",
    runtimePermissionsDeploy.proxyAddress,
  );
  console.log(
    "AccessSettlement:         ",
    accessSettlementDeploy.proxyAddress,
  );
  if (existingDlpRegistry) {
    console.log("DLPRegistry (existing):   ", existingDlpRegistry);
  }

  console.log("\n📝 CRITICAL NEXT STEP:");
  console.log("─".repeat(80));
  console.log("🔄 UPGRADE DLP REGISTRY:");
  console.log("\n1. Set environment variable:");
  console.log("   export DLP_REGISTRY_PROXY_ADDRESS=" + (existingDlpRegistry || "0x..."));
  console.log("\n2. Run upgrade script:");
  console.log("   SKIP_CONFIRMATION=true npx hardhat deploy \\");
  console.log("     --network moksha \\");
  console.log("     --tags DLPRegistryUpgrade");
  console.log("\n   This will:");
  console.log("   ✓ Preserve all existing DLP data");
  console.log("   ✓ Add dataset linking functionality");
  console.log("   ✓ Upgrade to version 2");

  console.log("\n📝 After Upgrade - Configuration Steps:");
  console.log("─".repeat(80));
  console.log("1. Add trusted TEE pools to AttestationPolicy");
  console.log("   → attestationPolicy.trustTeePool(teePoolAddress)");
  console.log("\n2. Add trusted Vana Runtime images to AttestationPolicy");
  console.log("   → attestationPolicy.trustVanaRuntimeImage(imageVersion)");
  console.log("\n3. Grant VANA_RUNTIME_ROLE to runtime addresses");
  console.log("   → accessSettlement.grantRole(VANA_RUNTIME_ROLE, runtimeAddress)");

  console.log("\n" + "═".repeat(80));
  console.log("✨ New contracts ready! Next: Upgrade DLP Registry");
  console.log("═".repeat(80) + "\n");

  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    owner: ownerAddress,
    securityCouncil: securityCouncilAddress,
    timestamp: new Date().toISOString(),
    contracts: {
      protocolConfig: {
        proxy: protocolConfigDeploy.proxyAddress,
        implementation: protocolConfigDeploy.implementationAddress,
      },
      attestationPolicy: {
        proxy: attestationPolicyDeploy.proxyAddress,
        implementation: attestationPolicyDeploy.implementationAddress,
      },
      datasetRegistry: {
        proxy: datasetRegistryDeploy.proxyAddress,
        implementation: datasetRegistryDeploy.implementationAddress,
      },
      vanaRuntimeServers: {
        proxy: runtimeServersDeploy.proxyAddress,
        implementation: runtimeServersDeploy.implementationAddress,
      },
      vanaRuntimePermissions: {
        proxy: runtimePermissionsDeploy.proxyAddress,
        implementation: runtimePermissionsDeploy.implementationAddress,
      },
      accessSettlement: {
        proxy: accessSettlementDeploy.proxyAddress,
        implementation: accessSettlementDeploy.implementationAddress,
      },
      dlpRegistry: {
        proxy: existingDlpRegistry || "NOT_DEPLOYED_YET",
        implementation: "NEEDS_UPGRADE",
        note: "Run dlpRegistry-upgrade.ts to upgrade existing registry",
      },
    },
  };

  // Write to deployments directory
  const fs = require("fs");
  const path = require("path");

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = `dataAccessV1-new-${hre.network.name}-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(deploymentInfo, null, 2),
  );

  console.log(`💾 Deployment info saved to: deployments/${filename}\n`);
};

export default func;
func.tags = ["DataAccessV1"];
func.dependencies = [];