import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "./helpers";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();

  const ownerAddress = process.env.OWNER_ADDRESS ?? deployer.address;

  const tokenContractName = "DAT";
  const tokenName = process.env.DLP_TOKEN_NAME ?? "Custom Data Autonomy Token";
  const tokenSymbol = process.env.DLP_TOKEN_SYMBOL ?? "CUSTOMDAT";

  console.log(``);
  console.log(``);
  console.log(``);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`**************************************************************`);
  console.log(`********** Deploying ${tokenContractName} **********`);

  // const dlpRoot = await ethers.getContractAt(
  //   "DataLiquidityPoolsRootImplementation",
  //   "0xf408A064d640b620219F510963646Ed2bD5606BB",
  // );
  //
  // const dlps = await dlpRoot.getAllDlpAddressesThatAreNotAContract(1, 500);
  // console.log(
  //   JSON.stringify(
  //     dlps,
  //     (key, value) => (typeof value === "bigint" ? Number(value) : value),
  //     2,
  //   ),
  // );
  //
  // return;

  const deploy = await deployments.deploy(
    "DataLiquidityPoolsRootImplementation",
    {
      from: deployer.address,
      args: [],
      log: true,
    },
  );

  await verifyContract(deploy.address, []);

  return;

  const tokenDeploy = await deployments.deploy(tokenContractName, {
    from: deployer.address,
    args: [tokenName, tokenSymbol, ownerAddress],
    log: true,
  });

  await verifyContract(tokenDeploy.address, [
    tokenName,
    tokenSymbol,
    ownerAddress,
  ]);
};

export default func;
func.tags = ["Deploy"];
