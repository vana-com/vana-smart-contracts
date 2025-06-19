import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { parseEther } from "ethers";
import { deployProxy, verifyProxy } from "./helpers";

const implementationContractName = "DLPRegistryImplementation";
const proxyContractName = "DLPRegistryProxy";
const proxyContractPath = "contracts/dlpRegistry/DLPRegistryProxy.sol:DLPRegistryProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  // Configuration values
  const dlpRegistrationDepositAmount = parseEther("1");

  const proxyDeploy = await deployProxy(
    deployer,
    proxyContractName,
    implementationContractName,
    [ownerAddress],
  );

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** DLP Registry Deployment Completed **********`);

  const proxy = await ethers.getContractAt(
    implementationContractName,
    proxyDeploy.proxyAddress,
  );

  // Configure the contract
  // await proxy.connect(deployer).grantRole(MAINTAINER_ROLE, deployer);
  // await proxy.connect(deployer).updateDlpRegistrationDepositAmount(dlpRegistrationDepositAmount);

  console.log(`Registry proxy address: ${proxyDeploy.proxyAddress}`);
  console.log(`Registry implementation address: ${proxyDeploy.implementationAddress}`);

  await verifyProxy(
    proxyDeploy.proxyAddress,
    proxyDeploy.implementationAddress,
    proxyDeploy.initializeData,
    proxyContractPath,
  );

  return;
};

export default func;
func.tags = ["DLPRegistryProxy"];