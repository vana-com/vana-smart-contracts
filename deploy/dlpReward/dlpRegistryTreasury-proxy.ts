import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { parseEther } from "ethers";
import { getCurrentBlockNumber } from "../utils/timeAndBlockManipulation";
import { deployProxy, verifyProxy } from "./helpers";

const implementationContractName = "TreasuryImplementation";
const proxyContractName = "DLPRegistryTreasuryProxy";
const proxyContractPath = "contracts/treasury/DLPRegistryTreasuryProxy.sol:DLPRegistryTreasuryProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const CUSTODIAN_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("CUSTODIAN_ROLE"),
  );

  // Get DLPRegistry address from previous deployment
  const dlpRegistryAddress = (await deployments.get("DLPRegistryProxy")).address;

  // Update the DLPRegistry with the Treasury address
  const dlpRegistry = await ethers.getContractAt(
    "DLPRegistryImplementation",
    dlpRegistryAddress
  );

  const proxyDeploy = await deployProxy(
    deployer,
    proxyContractName,
    implementationContractName,
    [deployer.address, dlpRegistryAddress],
  );

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Treasury Deployment Completed **********`);

  const proxy = await ethers.getContractAt(
    implementationContractName,
    proxyDeploy.proxyAddress,
  );

  await dlpRegistry.connect(deployer).updateTreasury(proxyDeploy.proxyAddress);

  console.log(`Treasury proxy address: ${proxyDeploy.proxyAddress}`);
  console.log(`Treasury implementation address: ${proxyDeploy.implementationAddress}`);
  console.log(`DLPRegistry updated with Treasury address`);

  await verifyProxy(
    proxyDeploy.proxyAddress,
    proxyDeploy.implementationAddress,
    proxyDeploy.initializeData,
    proxyContractPath,
  );

  return;
};

export default func;
func.tags = ["DLPRegistryTreasuryDeploy"];