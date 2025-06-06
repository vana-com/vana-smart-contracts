import { deployments, ethers, upgrades } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract, verifyProxy } from "./helpers";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const implementationContractName = "QueryEngineImplementation";
const proxyContractName = "QueryEngineProxy";

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

  await delay(6000);

  console.log(`***************************************************`);
  console.log(`***************************************************`);
  console.log(`***************************************************`);
  console.log(`********** Upgrade to new implementation **********`);

  const proxyAddress = (await deployments.get(proxyContractName)).address;
  const proxy = await ethers.getContractAt(implementationContractName, proxyAddress);

  const tx = await proxy.upgradeToAndCall(implementationDeploy.address, "0x", { from: deployer.address });
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    console.error("Upgrade transaction failed");
    throw new Error("Upgrade transaction failed"); // Throw an error to force early return
  }
  console.log("Upgrade transaction confirmed.");
  
  await verifyContract(implementationDeploy.address, []);
};

export default func;
func.tags = ["QueryEngineUpgrade"];
