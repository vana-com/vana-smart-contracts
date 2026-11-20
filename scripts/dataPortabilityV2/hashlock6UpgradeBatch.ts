/**
 * Emit the Safe Transaction Builder batch that upgrades the four data-portability
 * V2 proxies to the Hashlock 6th audit fix set (fix-review commit b8ed895).
 *
 * One batch, four upgradeToAndCall calls, executed atomically by the Safe:
 *   1. DataRegistryV2                 upgradeToAndCall(impl, 0x)
 *   2. DataPortabilityServersV2       upgradeToAndCall(impl, 0x)        requireServerProof stays false
 *   3. DataPortabilityPermissionsV2   upgradeToAndCall(impl, 0x)
 *   4. DataPortabilityEscrow          upgradeToAndCall(impl, setFeeRegistry(FeeRegistry))
 *
 * Implementation addresses are derived offline (CREATE2 through the shared factory,
 * fixed salts, this commit's bytecode), so the batch can be reviewed and signed before
 * the Ledger deploys them. It must not be EXECUTED before
 * `npx hardhat deploy --network vana --tags DPV2Hashlock6Implementations` has put the
 * bytecode at those addresses; the Safe UI simulation fails otherwise.
 *
 *   npx hardhat run scripts/dataPortabilityV2/hashlock6UpgradeBatch.ts
 *
 * Env (optional; defaults are the Vana mainnet values): SAFE_ADDRESS, FEE_REGISTRY_PROXY_ADDRESS,
 * DATA_REGISTRY_V2_PROXY_ADDRESS, DATA_PORTABILITY_SERVERS_V2_PROXY_ADDRESS,
 * DATA_PORTABILITY_PERMISSIONS_V2_PROXY_ADDRESS, DATA_PORTABILITY_ESCROW_PROXY_ADDRESS,
 * CHAIN_ID (1480), OUT_DIR (docs/dataPortability/mainnet-safe), OUT_FILE (1-upgrade-dp-v2-hashlock6.json)
 */
import { tx, writeBatch } from "../vanaStaking/safeBatch";
import { FEE_REGISTRY, SAFE, UPGRADES, predictImplementation, saltFor, upgradeCalldata } from "./hashlock6";

const env = (k: string, d: string) => process.env[k] || d;
const CHAIN_ID = env("CHAIN_ID", "1480");
const OUT_DIR = env("OUT_DIR", "docs/dataPortability/mainnet-safe");
const OUT_FILE = env("OUT_FILE", "1-upgrade-dp-v2-hashlock6.json");

async function main() {
  console.log("Predicted implementations (CREATE2, signer-independent; this commit's bytecode):");
  const txs = [];
  for (const u of UPGRADES) {
    const impl = await predictImplementation(u.contract);
    console.log(`  ${u.contract.padEnd(44)} salt "${saltFor(u.contract)}"  ${impl}`);
    const { data, note } = upgradeCalldata(u, impl);
    txs.push(tx(u.proxy, data, note));
  }

  writeBatch(
    OUT_DIR,
    OUT_FILE,
    SAFE,
    CHAIN_ID,
    "Data portability V2: Hashlock 6th audit fixes (b8ed895)",
    `Upgrade DataRegistryV2, DataPortabilityServersV2, DataPortabilityPermissionsV2 and DataPortabilityEscrow to the implementations ` +
      `deployed from commit b8ed895 (Hashlock fix review). The escrow upgrade sets its FeeRegistry to ${FEE_REGISTRY} in the same call; ` +
      `every settlement now pays only the FeeRegistry payee for its OpKind. ServersV2.requireServerProof stays off until the gateway, ` +
      `SDK and personal server send server proofs. Execute only after the implementations exist on chain.`,
    txs,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
