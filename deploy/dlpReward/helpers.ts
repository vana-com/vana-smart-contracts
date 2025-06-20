import { deployments, ethers, run, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export async function getUUPSImplementationAddress(
  proxyAddress: string,
): Promise<string> {
  // The storage slot where the implementation address is stored for UUPS proxies
  const IMPLEMENTATION_SLOT =
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

  const provider = ethers.provider;

  // Fetch the implementation address from the specified storage slot
  const implementationAddressHex = await provider.getStorage(
    proxyAddress,
    IMPLEMENTATION_SLOT,
  );

  // Strip leading zeros
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
      address: rootImplementationAddress,
      force: true,
      constructorArguments: [],
    });
  } catch (e) {
    console.log(e);
  }

  try {
    await run("verify:verify", {
      address: rootProxyAddress,
      force: true,
      contract: proxyContractPath,
      constructorArguments: [rootImplementationAddress, initializeData],
    });
  } catch (e) {
    console.log(e);
  }
}

export async function verifyContract(
  address: string,
  constructorArguments: string[],
) {
  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Verify the contract on blockscout **********`);
  console.log("!!!! There might be errors but you can ignore them");

  try {
    await run("verify:verify", {
      address: address,
      force: true,
      constructorArguments: constructorArguments,
    });
  } catch (e) {
    console.log(e);
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
