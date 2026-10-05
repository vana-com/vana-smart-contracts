import { deployments, ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Seeds the DataPortabilityEscrow.allowlist with the two canonical bundles:
 *   - PermissionsV2.addPermissionWithSignature   (replaces direct registerAndSettle)
 *   - DataRegistryV2.recordDataAccess            (replaces direct recordAccessAndSettle)
 *
 * Run only after the runOpAndSettle upgrade is live.
 * `setOpAllowed` is idempotent — re-running is a no-op.
 */
const ESCROW_PROXY = "0x07d7769081adc3a3DBe91f5E4B98E9A5a6B292e3";

const ALLOWED_OPS_BY_CHAIN: Record<number, { name: string; target: string; signature: string }[]> = {
  // Moksha
  14800: [
    {
      name: "PermissionsV2.addPermissionWithSignature",
      target: "0x4d3FA76064D88e0454cFc4CaD7e5FeC3e3124011",
      signature: "addPermissionWithSignature((address,bytes32,string[],uint256,uint256),bytes)",
    },
    {
      name: "DataRegistryV2.recordDataAccess",
      target: "0x8f1eFCdff3d0d5BB535e32620721c7EBed151867",
      signature: "recordDataAccess(address,string,uint256,address,bytes32,bytes)",
    },
  ],
  // Vana mainnet — same canonical addresses
  1480: [
    {
      name: "PermissionsV2.addPermissionWithSignature",
      target: "0x4d3FA76064D88e0454cFc4CaD7e5FeC3e3124011",
      signature: "addPermissionWithSignature((address,bytes32,string[],uint256,uint256),bytes)",
    },
    {
      name: "DataRegistryV2.recordDataAccess",
      target: "0x8f1eFCdff3d0d5BB535e32620721c7EBed151867",
      signature: "recordDataAccess(address,string,uint256,address,bytes32,bytes)",
    },
  ],
};

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const [deployer] = await ethers.getSigners();
  const chainId = Number(hre.network.config.chainId ?? (await ethers.provider.getNetwork()).chainId);

  console.log("Deployer:     ", deployer.address);
  console.log("Chain:        ", hre.network.name, `(chainId=${chainId})`);
  console.log("Escrow proxy: ", ESCROW_PROXY);

  const ops = ALLOWED_OPS_BY_CHAIN[chainId];
  if (!ops) throw new Error(`No allowlist seed defined for chainId ${chainId}`);

  const escrow = await ethers.getContractAt("DataPortabilityEscrowImplementation", ESCROW_PROXY);

  const DEFAULT_ADMIN_ROLE = "0x" + "00".repeat(32);
  const canAdmin = await escrow.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
  if (!canAdmin) {
    console.log("\nDeployer is NOT admin — generating calldata for the admin wallet instead.\n");
  }

  const iface = new ethers.Interface([
    "function setOpAllowed(address target, bytes4 selector, bool allowed)",
  ]);

  for (const op of ops) {
    const selector = ethers.dataSlice(ethers.id(op.signature), 0, 4); // ethers.id == keccak256(toUtf8Bytes(...))
    console.log("\n---", op.name, "---");
    console.log("  target:  ", op.target);
    console.log("  sig:     ", op.signature);
    console.log("  selector:", selector);

    const alreadyAllowed: boolean = await escrow.isAllowedOp(op.target, selector);
    if (alreadyAllowed) {
      console.log("  status:   already allowed (no-op)");
      continue;
    }

    if (canAdmin) {
      const tx = await escrow.connect(deployer).setOpAllowed(op.target, selector, true);
      console.log("  tx:      ", tx.hash);
      await tx.wait();
      const nowAllowed: boolean = await escrow.isAllowedOp(op.target, selector);
      if (!nowAllowed) throw new Error("setOpAllowed did not take effect");
      console.log("  status:   ALLOWED");
    } else {
      const data = iface.encodeFunctionData("setOpAllowed", [op.target, selector, true]);
      console.log("  CALLDATA (admin to sign):");
      console.log("    to:    " + ESCROW_PROXY);
      console.log("    data:  " + data);
      console.log("    value: 0");
    }
  }

  console.log("\n=== Final allowlist on chain ===");
  const targets: string[] = await escrow.getAllowedTargets();
  for (const t of targets) {
    const sels: string[] = await escrow.getAllowedSelectors(t);
    console.log(`  ${t}: ${sels.join(", ")}`);
  }
};

export default func;
func.tags = ["DataPortabilityEscrowSetAllowedOps"];
