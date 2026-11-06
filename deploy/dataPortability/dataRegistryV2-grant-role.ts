import { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Grants ACCESS_RECORDER_ROLE on DataRegistryV2 to a recipient. Defaults to
 * the DataPortabilityEscrow proxy so the future recordAccessAndSettle flow
 * works once it ships.
 *
 * Env vars:
 *   DATA_REGISTRY_V2_PROXY      default: 0x0850226E939A5C949633200cf0b1F4665CA74931
 *   ACCESS_RECORDER_RECIPIENT   default: DataPortabilityEscrow proxy (0xcF50fAb402e2025a92e1bF811049820b6428910A)
 */
const DATA_REGISTRY_DEFAULT = "0x0850226E939A5C949633200cf0b1F4665CA74931";
const ESCROW_PROXY_DEFAULT = "0xcF50fAb402e2025a92e1bF811049820b6428910A";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [admin] = await ethers.getSigners();
  const proxyAddress = process.env.DATA_REGISTRY_V2_PROXY ?? DATA_REGISTRY_DEFAULT;
  const recipient = process.env.ACCESS_RECORDER_RECIPIENT ?? ESCROW_PROXY_DEFAULT;

  console.log("Admin signer:        ", admin.address);
  console.log("DataRegistryV2 proxy:", proxyAddress);
  console.log("Grant to:            ", recipient);

  const ACCESS_RECORDER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ACCESS_RECORDER_ROLE"));
  const registry = await ethers.getContractAt("DataRegistryV2Implementation", proxyAddress);

  const already: boolean = await registry.hasRole(ACCESS_RECORDER_ROLE, recipient);
  if (already) {
    console.log("Recipient already has ACCESS_RECORDER_ROLE — nothing to do.");
  } else {
    const tx = await registry.connect(admin).grantRole(ACCESS_RECORDER_ROLE, recipient);
    await tx.wait();
    console.log("grantRole tx:        ", tx.hash);
  }

  const ok: boolean = await registry.hasRole(ACCESS_RECORDER_ROLE, recipient);
  if (!ok) throw new Error("Role grant failed");

  console.log("\nACCESS_RECORDER_ROLE holders (confirmed):");
  // Existing owner address held the role from initial deploy.
  const owner = process.env.OWNER_ADDRESS ?? admin.address;
  console.log("  -", owner, await registry.hasRole(ACCESS_RECORDER_ROLE, owner) ? "✓" : "—");
  console.log("  -", recipient, "✓ (just granted)");
};

export default func;
func.tags = ["DataRegistryV2GrantAccessRecorder"];
