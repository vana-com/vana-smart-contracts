// deploy/01_deploy_token_and_vesting.ts
import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "./helpers";

/* ---- helpers ---- */
const toStrArray = (arr: (string | number)[]) => arr.map(String);

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { log } = deployments;
  const [deployer] = await ethers.getSigners();

  /* ---------------------------------------------------------------------- */
  /* configuration from env (or sensible defaults)                          */
  /* ---------------------------------------------------------------------- */
  const ownerAddress =
    process.env.OWNER_ADDRESS && ethers.isAddress(process.env.OWNER_ADDRESS)
      ? process.env.OWNER_ADDRESS
      : deployer.address;

  const tokenName   = process.env.DLP_TOKEN_NAME   || "Custom Data Autonomy Token";
  const tokenSymbol = process.env.DLP_TOKEN_SYMBOL || "CUSTOMDAT";

  /* ---------------------------------------------------------------------- */
  /* 1. DAT token                                                           */
  /* ---------------------------------------------------------------------- */
  log("\n**************************************************************");
  log(`Deploying ${tokenName} token …`);
  const datDeploy = await deployments.deploy("DAT", {
    from: deployer.address,
    args: [tokenName, tokenSymbol, ownerAddress, 0], // uncapped
    log: true,
  });

  await verifyContract(datDeploy.address, [
    tokenName,
    tokenSymbol,
    ownerAddress,
    "0",
  ]);

  /* ---------------------------------------------------------------------- */
  /* 2. VestingFactory                                                      */
  /* ---------------------------------------------------------------------- */
  log(`\nDeploying VestingFactory …`);
  const factoryDeploy = await deployments.deploy("VestingFactory", {
    from: deployer.address,
    args: [datDeploy.address],
    log: true,
  });

  await verifyContract(factoryDeploy.address, [datDeploy.address]);

  /* ---------------------------------------------------------------------- */
  /* 3. Template vesting-wallet instances (for verification / reference)    */
  /*    NOTE: these are NOT used by the factory; they're just handy         */
  /*          verified contracts so explorers recognise the byte-code.      */
  /* ---------------------------------------------------------------------- */
  const now = Math.floor(Date.now() / 1000);

  // LinearVestingWallet (1-second duration, all tokens immediately vested)
  const linearArgs: (string | number)[] = [ownerAddress, now, 1]; // beneficiary, start, duration
  const linearDeploy = await deployments.deploy("LinearVestingWallet", {
    from: deployer.address,
    args: linearArgs,
    log: true,
  });
  
  const linearContractPath = "contracts/token/vestingWallet/LinearVestingWallet.sol:LinearVestingWallet";
  await verifyContract(linearDeploy.address, toStrArray(linearArgs),linearContractPath);

  // CliffVestingWallet (cliff < total)
  const cliffArgs: (string | number)[] = [ownerAddress, now, 1, 2]; // start, 1-sec cliff, 2-sec total
  const cliffDeploy = await deployments.deploy("CliffVestingWallet", {
    from: deployer.address,
    args: cliffArgs,
    log: true,
  });
  await verifyContract(cliffDeploy.address, toStrArray(cliffArgs));

  // NoVestingWallet
  const noVestArgs = [ownerAddress];
  const noVestDeploy = await deployments.deploy("NoVestingWallet", {
    from: deployer.address,
    args: noVestArgs,
    log: true,
  });
  await verifyContract(noVestDeploy.address, noVestArgs);

  /* ---------------------------------------------------------------------- */
  /* 4. Give the factory permission to mint DAT                             */
  /* ---------------------------------------------------------------------- */
  const dat = await ethers.getContractAt("DAT", datDeploy.address);
  const MINTER_ROLE = await dat.MINTER_ROLE();
  const tx = await dat.grantRole(MINTER_ROLE, factoryDeploy.address);
  await tx.wait();

  log(`\n✅  Deployment complete`);
};

export default func;
func.tags = ["VestingTokenStack"];
