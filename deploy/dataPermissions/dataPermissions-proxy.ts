import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deployProxy, verifyProxy } from "../helpers";

const implementationContractName = "DataPermissionsImplementation";
const proxyContractName = "DataPermissionsProxy";
const proxyContractPath =
  "contracts/dataPermissions/DataPermissionsProxy.sol:DataPermissionsProxy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );

  const proxyDeploy = await deployProxy(
    deployer,
    proxyContractName,
    implementationContractName,
    [ethers.ZeroAddress, ownerAddress],
  );

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** VanaEpoch Deployment Completed **********`);

  const proxy = await ethers.getContractAt(
    implementationContractName,
    proxyDeploy.proxyAddress,
  );

  // Configure the contract
  await proxy.connect(deployer).grantRole(MAINTAINER_ROLE, deployer);

  await verifyProxy(
    proxyDeploy.proxyAddress,
    proxyDeploy.implementationAddress,
    proxyDeploy.initializeData,
    proxyContractPath,
  );

  return;
};

export default func;
func.tags = ["DataPermissionsProxy"];
