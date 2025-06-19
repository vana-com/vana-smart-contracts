import { deployments, ethers, upgrades } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "./helpers";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const implementationContractName = "DLPRewardSwapImplementation";
const proxyContractName = "DLPRewardSwapProxy";

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

  if (implementationDeploy.receipt && implementationDeploy.receipt.status === 1) {
    console.log("Deployment confirmed and successful.");
  } else {
    throw new Error("Deployment failed or was reverted.");
  }

  console.log(implementationContractName, implementationDeploy.address);

  await verifyContract(implementationDeploy.address, []);

  const proxyAddress = (await deployments.get(proxyContractName)).address;
  const proxy = await ethers.getContractAt(implementationContractName, proxyAddress);

  console.log("Upgrading proxy contract...");
  console.log("Proxy address:", proxyAddress);
  const tx = await proxy.upgradeToAndCall(implementationDeploy.address, "0x", { from: deployer.address });
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    console.error("Transaction failed");
    throw new Error("Transaction failed"); // Throw an error to force early return
  }
  console.log("Transaction confirmed.");
};

export default func;
func.tags = ["DlpRewardSwapUpgrade"];
