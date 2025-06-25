import { deployments, ethers, upgrades } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "./helpers";

const implementationContractName = "VanaEpochImplementation";
const previousImplementationContractName = "VanaEpochImplementationOld";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Deploy new ${implementationContractName} **********`);

  // await upgrades.validateUpgrade(
  //   await ethers.getContractFactory(previousImplementationContractName),
  //   await ethers.getContractFactory(implementationContractName),
  // );

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
};

export default func;
func.tags = ["VanaEpochImplementation"];
