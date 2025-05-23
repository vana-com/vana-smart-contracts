import { deployments, ethers, run, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export async function getUUPSImplementationAddress(
  proxyAddress: string,
): Promise<string> {
  const IMPLEMENTATION_SLOT =
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

  const provider = ethers.provider;

  const implementationAddressHex = await provider.getStorage(
    proxyAddress,
    IMPLEMENTATION_SLOT,
  );

  const strippedImplementationAddress =
    "0x" + implementationAddressHex.substring(26);

  return ethers.getAddress(strippedImplementationAddress);
}

export async function verifyProxy(
  rootProxyAddress: string,
  rootImplementationAddress: string,
  initializeData: string,
  proxyContractPath: string,
) {
  console.log(`\n🔍 Starting verification of contracts on Blockscout`);
  console.log(`   Note: You might see errors (e.g., already verified), you can safely ignore them.\n`);

  try {
    console.log(`🔹 Verifying implementation contract at: ${rootImplementationAddress}`);
    await run("verify:verify", {
      address: rootImplementationAddress,
      force: true,
      constructorArguments: [],
    });
    console.log(`✅ Implementation verified successfully!\n`);
  } catch (e) {
    console.log(`⚠️ Implementation verification issue:\n`, e);
  }

  try {
    console.log(`🔹 Verifying proxy contract at: ${rootProxyAddress}`);
    await run("verify:verify", {
      address: rootProxyAddress,
      force: true,
      contract: proxyContractPath,
      constructorArguments: [rootImplementationAddress, initializeData],
    });
    console.log(`✅ Proxy verified successfully!\n`);
  } catch (e) {
    console.log(`⚠️ Proxy verification issue:\n`, e);
  }
}

export async function verifyContract(
  address: string,
  constructorArguments: string[],
  contractPath?: string
) {
  console.log(`\n🔍 Starting contract verification on Blockscout`);
  console.log(`   Note: Errors may appear (e.g., contract already verified), these can be ignored.\n`);

  try {
    const args: any = {
      address,
      constructorArguments,
      force: true,
    };

    if (contractPath) {
      args.contract = contractPath;
    }

    await run("verify:verify", args);
    console.log(`✅ Contract verified successfully at: ${address}\n`);
  } catch (e) {
    console.log(`⚠️ Verification failed or already verified:\n`, e);
  }
}

export async function deployProxy(
  deployer: HardhatEthersSigner,
  proxyContractName: string,
  implementationContractName: string,
  initializeParams:
    | (string | number | bigint | object)[]
    | (string | number | bigint)[][],
): Promise<{
  proxyAddress: string;
  implementationAddress: string;
  initializeData: string;
}> {
  console.log(`\n🚀 Starting deployment of ${proxyContractName}`);

  const implementationFactory = await ethers.getContractFactory(
    implementationContractName,
  );

  const implementationDeploy = await deployments.deploy(
    implementationContractName,
    {
      from: deployer.address,
      args: [],
      log: true,
    },
  );

  console.log(`✅ ${implementationContractName} deployed at: ${implementationDeploy.address}`);

  const initializeData = implementationFactory.interface.encodeFunctionData(
    "initialize",
    initializeParams,
  );

  const proxyDeploy = await deployments.deploy(proxyContractName, {
    from: deployer.address,
    args: [implementationDeploy.address, initializeData],
    log: true,
  });

  console.log(`✅ ${proxyContractName} proxy deployed at: ${proxyDeploy.address}`);

  console.log(`📝 Registering proxy with OpenZeppelin upgrades system...`);
  await upgrades.forceImport(proxyDeploy.address, implementationFactory, {
    kind: "uups",
  });

  console.log(`🎉 Deployment complete. Proxy and implementation are live and registered.\n`);

  return {
    proxyAddress: proxyDeploy.address,
    implementationAddress: implementationDeploy.address,
    initializeData,
  };
}