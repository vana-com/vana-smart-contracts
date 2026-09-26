/**
 * Emit the multisig transactions for the VanaPool staking upgrade as Safe
 * Transaction Builder batches (one JSON per step, importable in the Safe UI),
 * with every address derived offline:
 *
 *   - the four implementations are CREATE2 deployments through the shared factory
 *     (0x4e59…956C) with the salts the deploy scripts use, so their addresses
 *     follow from the compiled artifacts alone;
 *   - the RewardSplitter proxy address follows from RewardSplitterDeployer.computeAddress.
 *
 * Because nothing here depends on who deploys or when, the batches can be built,
 * reviewed and signed before the implementations exist on chain; they simply must
 * not be EXECUTED before the matching `deploy --network vana --tags …` run
 * (with DEPLOY_ONLY=true) has put the bytecode at the predicted addresses.
 *
 *   npx hardhat run scripts/vanaStaking/mainnetSafeBatches.ts
 *
 * Env (all optional; defaults are the Vana mainnet values):
 *   SAFE_ADDRESS               multisig that executes (admin + maintainer)      0x5eca…baf4
 *   VANA_POOL_ENTITY_PROXY_ADDRESS / VANA_POOL_STAKING_PROXY_ADDRESS / VANA_POOL_TREASURY_PROXY_ADDRESS
 *   BACKFILL_REGISTRATIONS     "entityId:registrant:shares,…"                   1:<safe>:1e17
 *   SPLITTER_OWNER             splitter admin/maintainer/distributor            SAFE_ADDRESS
 *   CREATE2_SALT               splitter salt                                    RewardSplitterProxySalt
 *   REWARD_VESTING_DURATION    seconds; adds updateRewardVestingDuration to the splitter batch
 *   DISTRIBUTOR_ADDRESS        adds grantRole(DISTRIBUTOR_ROLE) to the splitter batch
 *   CHAIN_ID                   1480
 *   OUT_DIR                    docs/vanaStaking/mainnet-safe
 */
import { artifacts, ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const ZERO32 = ethers.ZeroHash;

const env = (k: string, d: string) => process.env[k] || d;
const SAFE = ethers.getAddress(env("SAFE_ADDRESS", "0x5eca5208f29e32879a711467916965b2d753baf4"));
const ENTITY = ethers.getAddress(env("VANA_POOL_ENTITY_PROXY_ADDRESS", "0x44f20490A82e1f1F1cC25Dd3BA8647034eDdce30"));
const STAKING = ethers.getAddress(env("VANA_POOL_STAKING_PROXY_ADDRESS", "0x641C18E2F286c86f96CE95C8ec1EB9fC0415Ca0e"));
const TREASURY = ethers.getAddress(env("VANA_POOL_TREASURY_PROXY_ADDRESS", "0x143BE72CF2541604A7691933CAccd6D9cC17c003"));
const SPLITTER_OWNER = ethers.getAddress(env("SPLITTER_OWNER", SAFE));
const BACKFILLS = env("BACKFILL_REGISTRATIONS", `1:${SAFE}:100000000000000000`);
const SPLITTER_SALT = ethers.keccak256(ethers.toUtf8Bytes(env("CREATE2_SALT", "RewardSplitterProxySalt")));
const CHAIN_ID = env("CHAIN_ID", "1480");
const OUT_DIR = env("OUT_DIR", "docs/vanaStaking/mainnet-safe");

// ---- Safe Transaction Builder checksum (port of apps/tx-builder/src/lib/checksum.ts) ----
const replacer = (_: string, v: unknown) => (v === undefined ? null : v);
function serialize(json: unknown): string {
  if (Array.isArray(json)) return `[${json.map(serialize).join(",")}]`;
  if (typeof json === "object" && json !== null) {
    const keys = Object.keys(json).sort();
    let acc = `{${JSON.stringify(keys, replacer)}`;
    for (const k of keys) acc += `${serialize((json as Record<string, unknown>)[k])},`;
    return `${acc}}`;
  }
  return `${JSON.stringify(json, replacer)}`;
}
function withChecksum(batch: { meta: Record<string, unknown> }) {
  const checksum = ethers.keccak256(ethers.toUtf8Bytes(serialize({ ...batch, meta: { ...batch.meta, name: null } })));
  return { ...batch, meta: { ...batch.meta, checksum } };
}

type Tx = { to: string; value: string; data: string; contractMethod: null; contractInputsValues: null; note: string };
const tx = (to: string, data: string, note: string): Tx => ({ to, value: "0", data, contractMethod: null, contractInputsValues: null, note });

function batchFile(name: string, description: string, txs: Tx[]) {
  const transactions = txs.map(({ note, ...t }) => t);
  return withChecksum({
    version: "1.0",
    chainId: CHAIN_ID,
    createdAt: Date.now(),
    meta: { name, description, txBuilderVersion: "1.16.5", createdFromSafeAddress: SAFE, createdFromOwnerAddress: "" },
    transactions,
  });
}

// ---- deterministic addresses ----
async function create2Impl(contract: string, salt: string): Promise<string> {
  const { bytecode } = await artifacts.readArtifact(contract);
  return ethers.getCreate2Address(FACTORY, ethers.keccak256(ethers.toUtf8Bytes(salt)), ethers.keccak256(bytecode));
}

async function main() {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const iface = new ethers.Interface([
    "function upgradeToAndCall(address,bytes)",
    "function checkpointPrincipal(uint256)",
    "function backfillRegistration(uint256,address,uint256)",
    "function updateVanaPool(address)",
    "function updateVanaPoolEntity(address)",
    "function revokeRole(bytes32,address)",
    "function grantRole(bytes32,address)",
    "function deploy(bytes32,address,address,address)",
    "function updateRewardSplitter(address)",
    "function updateRewardVestingDuration(uint32)",
  ]);
  const enc = (fn: string, args: unknown[]) => iface.encodeFunctionData(fn, args);

  const entityImpl = await create2Impl("VanaPoolEntityImplementation", "VanaPoolEntityImplementation-v4");
  const stakingImpl = await create2Impl("VanaPoolStakingImplementation", "VanaPoolStakingImplementation-v4");
  const treasuryImpl = await create2Impl("VanaPoolTreasuryImplementation", "VanaPoolTreasuryImplementation-v2");
  const splitterDeployer = await create2Impl("RewardSplitterDeployer", "VanaRewardSplitterDeployer");
  const splitterImpl = await create2Impl("RewardSplitterImplementation", "RewardSplitterProxySalt");
  // RewardSplitterDeployer.computeAddress, offline
  const proxyArtifact = await artifacts.readArtifact("RewardSplitterProxy");
  const proxyInitCodeHash = ethers.keccak256(ethers.concat([proxyArtifact.bytecode, abi.encode(["address", "bytes"], [splitterImpl, "0x"])]));
  const boundSalt = ethers.keccak256(abi.encode(["address", "bytes32"], [ENTITY, SPLITTER_SALT]));
  const splitterProxy = ethers.getCreate2Address(splitterDeployer, boundSalt, proxyInitCodeHash);

  console.log(`Predicted (CREATE2, signer-independent; this commit's bytecode):`);
  console.log(`  VanaPoolEntityImplementation  v4  ${entityImpl}`);
  console.log(`  VanaPoolStakingImplementation v4  ${stakingImpl}`);
  console.log(`  VanaPoolTreasuryImplementation v2 ${treasuryImpl}`);
  console.log(`  RewardSplitterDeployer            ${splitterDeployer}`);
  console.log(`  RewardSplitterImplementation      ${splitterImpl}`);
  console.log(`  RewardSplitter proxy              ${splitterProxy}`);

  const backfills = BACKFILLS.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [id, registrant, shares] = s.split(":");
    return tx(STAKING, enc("backfillRegistration", [BigInt(id), ethers.getAddress(registrant), BigInt(shares)]),
      `backfillRegistration(${id}, ${registrant}, ${shares}): legacy entity's registration floor`);
  });

  const steps = [
    {
      file: "1-entity.json", name: "VanaPool step 1: Entity v4",
      description: `Upgrade VanaPoolEntity ${ENTITY} to ${entityImpl}; seed entity 1 principal-seconds.`,
      txs: [
        tx(ENTITY, enc("upgradeToAndCall", [entityImpl, "0x"]), `upgradeToAndCall(${entityImpl}, 0x)`),
        tx(ENTITY, enc("checkpointPrincipal", [1n]), `checkpointPrincipal(1): seed legacy principal from the share supply`),
      ],
    },
    {
      file: "2-staking.json", name: "VanaPool step 2: Staking v4",
      description: `Upgrade VanaPoolStaking ${STAKING} to ${stakingImpl}; backfill legacy registration floors.`,
      txs: [tx(STAKING, enc("upgradeToAndCall", [stakingImpl, "0x"]), `upgradeToAndCall(${stakingImpl}, 0x)`), ...backfills],
    },
    {
      file: "3-treasury.json", name: "VanaPool step 3: Treasury v2",
      description: `Upgrade VanaPoolTreasury ${TREASURY} to ${treasuryImpl} with the atomic SPENDER grant to Staking; grant Entity; drop Staking's admin.`,
      txs: [
        tx(TREASURY, enc("upgradeToAndCall", [treasuryImpl, enc("updateVanaPool", [STAKING])]),
          `upgradeToAndCall(${treasuryImpl}, updateVanaPool(${STAKING})): atomic SPENDER_ROLE for Staking`),
        tx(TREASURY, enc("updateVanaPoolEntity", [ENTITY]), `updateVanaPoolEntity(${ENTITY}): SPENDER_ROLE for Entity`),
        tx(TREASURY, enc("revokeRole", [ZERO32, STAKING]), `revokeRole(DEFAULT_ADMIN_ROLE, ${STAKING})`),
      ],
    },
    {
      file: "4-splitter.json", name: "VanaPool step 4: RewardSplitter",
      description: `Create the RewardSplitter proxy at ${splitterProxy} (owner ${SPLITTER_OWNER}) and wire it into VanaPoolEntity.`,
      txs: [
        tx(splitterDeployer, enc("deploy", [SPLITTER_SALT, splitterImpl, ENTITY, SPLITTER_OWNER]),
          `RewardSplitterDeployer.deploy(salt, ${splitterImpl}, ${ENTITY}, ${SPLITTER_OWNER}) -> ${splitterProxy}`),
        tx(ENTITY, enc("updateRewardSplitter", [splitterProxy]), `updateRewardSplitter(${splitterProxy}): REWARD_SPLITTER_ROLE`),
        ...(process.env.REWARD_VESTING_DURATION
          ? [tx(splitterProxy, enc("updateRewardVestingDuration", [Number(process.env.REWARD_VESTING_DURATION)]),
              `updateRewardVestingDuration(${process.env.REWARD_VESTING_DURATION}) (Safe must be the splitter owner)`)]
          : []),
        ...(process.env.DISTRIBUTOR_ADDRESS
          ? [tx(splitterProxy, enc("grantRole", [ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE")), ethers.getAddress(process.env.DISTRIBUTOR_ADDRESS)]),
              `grantRole(DISTRIBUTOR_ROLE, ${process.env.DISTRIBUTOR_ADDRESS}) (Safe must be the splitter owner)`)]
          : []),
      ],
    },
  ];

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const s of steps) {
    const out = path.join(OUT_DIR, s.file);
    fs.writeFileSync(out, JSON.stringify(batchFile(s.name, s.description, s.txs), null, 2) + "\n");
    console.log(`\n${s.name}  ->  ${out}`);
    s.txs.forEach((t, i) => {
      console.log(`  ${i + 1}. to   ${t.to}\n     data ${t.data}\n     // ${t.note}`);
    });
  }
  console.log(`\nExecute each batch only after its implementation(s) exist at the predicted address(es).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
