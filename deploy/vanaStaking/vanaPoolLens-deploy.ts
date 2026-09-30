import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { verifyContract } from "../helpers";

/**
 * Deploy VanaPoolLens (read-only APY views over VanaPoolEntity) through the
 * shared CREATE2 factory. It holds no funds or roles and needs no configuration,
 * so any funded signer may deploy it; with the same bytecode, salt and entity
 * address it lands at the same address on every chain.
 *
 *   VANA_POOL_ENTITY_PROXY_ADDRESS=0x44f2… npx hardhat deploy --network <moksha|vana> --tags VanaPoolLensDeploy
 */
const LENS_SALT = "VanaPoolLens-v1";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const entity = process.env.VANA_POOL_ENTITY_PROXY_ADDRESS;
  if (!entity) throw new Error("VANA_POOL_ENTITY_PROXY_ADDRESS environment variable is required");

  const lens = await deployments.deploy("VanaPoolLens", {
    from: deployer.address,
    args: [entity],
    log: true,
    deterministicDeployment: ethers.keccak256(ethers.toUtf8Bytes(LENS_SALT)),
  });
  console.log(`VanaPoolLens at ${lens.address} (entity ${entity}, salt "${LENS_SALT}")`);

  const view = await ethers.getContractAt("VanaPoolLens", lens.address);
  const r = await view.entityAPY(1);
  console.log(`smoke: entityAPY(1).apy = ${ethers.formatUnits(r.apy, 18)}%`);

  await verifyContract(lens.address, [entity]);
};

export default func;
func.tags = ["VanaPoolLensDeploy"];
