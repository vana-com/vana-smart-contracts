import { deployments, ethers, upgrades } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "./helpers";

const implementationContractName = "DataRegistryImplementation";
const previousImplementationContractName = "DataRegistryImplementationOld";
const proxyContractName = "DataRegistryProxy";

//data = addFile(TestUpgrade1)
// 0xeb9b9b640000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b54657374557067726164653100000000000000000000000000000000000000000

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Deploy new ${implementationContractName} **********`);

  await upgrades.validateUpgrade(
    await ethers.getContractFactory(previousImplementationContractName),
    await ethers.getContractFactory(implementationContractName),
  );

  const implementationDeploy = await deployments.deploy(
    implementationContractName,
    {
      from: deployer.address,
      args: [],
      log: true,
    },
  );

  console.log(implementationContractName, implementationDeploy.address);

  await verifyContract(implementationDeploy.address, []);

  const proxyAddress = (await deployments.get(proxyContractName)).address;
  const proxy = await ethers.getContractAt(implementationContractName, proxyAddress);
  
  await proxy.upgradeToAndCall(implementationDeploy.address, "0x", { from: deployer.address });
};

export default func;
func.tags = ["DataRegistryUpgrade"];
