import { deployments, ethers, upgrades } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract, verifyProxy } from "./helpers";

const implementationContractName = "DataRefinerRegistryImplementation";
const proxyContractName = "DataRefinerRegistryProxy";

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
      // maxFeePerGas:  ethers.parseUnits("200", "gwei").toString(),
      // maxPriorityFeePerGas: ethers.parseUnits("200", "gwei").toString(),
    },
  );

  console.log(implementationContractName, implementationDeploy.address);

  await verifyContract(implementationDeploy.address, []);

  const proxyAddress = (await deployments.get(proxyContractName)).address;
  const proxy = await ethers.getContractAt(implementationContractName, proxyAddress);

  console.log("Upgrading to new implementation...");
  console.log(`Proxy address: ${proxyAddress}`);

  const tx = await proxy.upgradeToAndCall(implementationDeploy.address, "0x", { from: deployer.address });
  await tx.wait();

  console.log("Upgrade complete.");
};

export default func;
func.tags = ["DataRefinerRegistryUpgrade"];
