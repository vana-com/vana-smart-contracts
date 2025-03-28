import { deployments, ethers, upgrades } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract, verifyProxy } from "./helpers";

const implementationContractName = "ComputeEngineImplementation";
const proxyContractName = "ComputeEngineProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Deploy new ${implementationContractName} **********`);

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
func.tags = ["ComputeEngineUpgrade"];
