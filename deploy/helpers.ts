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
    // console.log(`⚠️ Implementation verification issue:\n`, e);
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
    // console.log(`⚠️ Proxy verification issue:\n`, e);
  }
}

export async function verifyBeacon(
  beaconAddress: string,
  implementationAddress: string,
  ownerAddress: string,
  beaconContractPath: string,
) {
  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Verify the contracts on blockscout **********`);
  console.log("!!!! There might be errors but you can ignore them");

  try {
    await run("verify:verify", {
      address: implementationAddress,
      force: true,
      constructorArguments: [],
    });
  } catch (e) {
    console.log(e);
  }

  try {
    await run("verify:verify", {
      address: beaconAddress,
      force: true,
      contract: beaconContractPath,
      constructorArguments: [implementationAddress, ownerAddress],
    });
  } catch (e) {
    console.log(e);
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
    // console.log(`⚠️ Verification failed or already verified:\n`, e);
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

export async function deterministicDeployProxy(
  deployer: HardhatEthersSigner,
  proxyContractName: string,
  implementationContractName: string,
  initializeParams:
    | (string | number | bigint | object)[]
    | (string | number | bigint)[][],
  salt: string,
): Promise<{
  proxyAddress: string;
  implementationAddress: string;
  initializeData: string;
}> {
  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Deploying ${proxyContractName} **********`);

  // Deploy the implementation contract
  const implementationFactory = await ethers.getContractFactory(
    implementationContractName,
  );

  const implementationDeploy = await deployments.deploy(
    implementationContractName,
    {
      from: deployer.address,
      args: [],
      log: true,
      deterministicDeployment: ethers.keccak256(ethers.toUtf8Bytes(salt)),
    },
  );

  // Encode the initializer function call
  const initializeData = implementationFactory.interface.encodeFunctionData(
    "initialize",
    initializeParams,
  );

  const proxyDeploy = await deployments.deploy(proxyContractName, {
    from: deployer.address,
    args: [implementationDeploy.address, initializeData],
    log: true,
    deterministicDeployment: ethers.keccak256(ethers.toUtf8Bytes(salt)),
    gasLimit: 5000000, // Adjust gas limit as needed
  });

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Save contract to .openzeppelin file **********`);
  await upgrades.forceImport(proxyDeploy.address, implementationFactory, {
    kind: "uups",
  });

  return {
    proxyAddress: proxyDeploy.address,
    implementationAddress: implementationDeploy.address,
    initializeData,
  };
}

export async function deployBeaconProxy(
  deployer: HardhatEthersSigner,
  beaconContractName: string,
  implementationContractName: string,
  beaconOwner: string,
  salt: string,
): Promise<{
  beaconAddress: string;
  implementationAddress: string;
}> {
  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Deploying ${beaconContractName} **********`);

  // Deploy the implementation contract
  const implementationFactory = await ethers.getContractFactory(
    implementationContractName,
  );

  const implementationDeploy = await deployments.deploy(
    implementationContractName,
    {
      from: deployer.address,
      args: [],
      log: true,
      deterministicDeployment: ethers.keccak256(ethers.toUtf8Bytes(salt)),
    },
  );

  const beaconDeploy = await deployments.deploy(beaconContractName, {
    from: deployer.address,
    args: [implementationDeploy.address, beaconOwner],
    log: true,
    deterministicDeployment: ethers.keccak256(ethers.toUtf8Bytes(salt)),
  });

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Save contract to .openzeppelin file **********`);
  await upgrades.forceImport(beaconDeploy.address, implementationFactory, {
    kind: "beacon",
  });

  return {
    beaconAddress: beaconDeploy.address,
    implementationAddress: implementationDeploy.address,
  };
}

export async function getNextDeploymentAddress(
  walletAddress: string,
  nonce: number,
): Promise<string> {
  try {
    if (!ethers.isAddress(walletAddress)) {
      throw new Error("Invalid wallet address");
    }

    // Convert nonce to hex string for RLP encoding
    const nonceHex = ethers.toBeHex(nonce);

    const rlpEncoded = ethers.encodeRlp([walletAddress, nonceHex]);

    const hash = ethers.keccak256(rlpEncoded);
    const futureAddress = `0x${hash.slice(26)}`;

    return ethers.getAddress(futureAddress);
  } catch (error) {
    throw {
      code: "ADDRESS_CALCULATION_ERROR",
      reason: (error as Error).message,
      ...(error as Error),
    };
  }
}