import { ethers, deployments } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployProxy, verifyProxy } from "./helpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  console.log("\n🚀 Starting Data Access V1 deployment...");
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

  console.log("\nConfiguration:");
  console.log("─".repeat(80));
  console.log("Owner address:", ownerAddress);
  console.log("Security Council:", securityCouncilAddress);
  console.log("Committee members:", initialCommittee.length);
  console.log("═".repeat(80) + "\n");

  // 1. Deploy ProtocolConfig
  console.log("📦 [1/7] Deploying ProtocolConfig...");
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
  console.log("\n📦 [2/7] Deploying AttestationPolicy...");
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
  console.log("\n📦 [3/7] Deploying DatasetRegistry...");
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
  console.log("\n📦 [4/7] Deploying VanaRuntimeServers...");
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
  console.log("\n📦 [5/7] Deploying VanaRuntimePermissions...");
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
  console.log("\n📦 [6/7] Deploying AccessSettlement...");
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

  // 7. Deploy DLPRegistryV1
  console.log("\n📦 [7/7] Deploying DLPRegistryV1...");
  const dlpRegistryDeploy = await deployProxy(
    deployer,
    "DLPRegistryV1Proxy",
    "DLPRegistryV1Implementation",
    [ownerAddress],
  );
  console.log(
    "✅ DLPRegistryV1 deployed at:",
    dlpRegistryDeploy.proxyAddress,
  );
  console.log("   Implementation:", dlpRegistryDeploy.implementationAddress);

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

  await verifyProxy(
    dlpRegistryDeploy.proxyAddress,
    dlpRegistryDeploy.implementationAddress,
    dlpRegistryDeploy.initializeData,
    "contracts/data/dataAccessV1/DLPRegistryV1Proxy.sol:DLPRegistryV1Proxy",
  );

  // Summary
  console.log("\n" + "═".repeat(80));
  console.log("🎉 DATA ACCESS V1 DEPLOYMENT COMPLETE!");
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
  console.log("DLPRegistryV1:            ", dlpRegistryDeploy.proxyAddress);

  console.log("\n📝 Next Steps:");
  console.log("─".repeat(80));
  console.log("1. Add trusted TEE pools to AttestationPolicy");
  console.log("   → attestationPolicy.trustTeePool(teePoolAddress)");
  console.log("\n2. Add trusted Vana Runtime images to AttestationPolicy");
  console.log("   → attestationPolicy.trustVanaRuntimeImage(imageVersion)");
  console.log("\n3. Grant VANA_RUNTIME_ROLE to runtime addresses");
  console.log("   → accessSettlement.grantRole(VANA_RUNTIME_ROLE, runtimeAddress)");
  console.log("\n4. Register DLPs and create datasets");
  console.log("   → dlpRegistry.registerDLP(...)");
  console.log("   → datasetRegistry.createDataset(...)");
  console.log("\n5. Test the full data contribution and access flow");

  console.log("\n" + "═".repeat(80));
  console.log("✨ All systems ready for Data Access V1!");
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
      dlpRegistryV1: {
        proxy: dlpRegistryDeploy.proxyAddress,
        implementation: dlpRegistryDeploy.implementationAddress,
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

  const filename = `dataAccessV1-${hre.network.name}-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(deploymentInfo, null, 2),
  );

  console.log(`💾 Deployment info saved to: deployments/${filename}\n`);
};

export default func;
func.tags = ["DataAccessV1", "DataAccessV1Deploy"];
func.dependencies = []; // Add any dependencies if needed