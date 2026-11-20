/**
 * Fork simulation of the Hashlock 6th audit upgrade batch against Vana mainnet.
 *
 *   VANA_RPC_URL=https://rpc.vana.org npx hardhat run scripts/dataPortabilityV2/simulateHashlock6Upgrade.ts
 *
 * 1. Forks mainnet (latest block), deploys the four implementations through the
 *    CREATE2 factory exactly as the Ledger will, and checks they land at the
 *    predicted addresses.
 * 2. Replays the Safe batch file (BATCH_FILE, default
 *    docs/dataPortability/mainnet-safe/1-upgrade-dp-v2-hashlock6.json) from the
 *    Safe address, transaction by transaction, so the simulated payload is the
 *    one the signers will see.
 * 3. Asserts: implementation slots, versions, escrow.feeRegistry, roles, and that
 *    sampled live records (latest permission, server, data point, escrow deposit
 *    found in recent logs) read identically before and after.
 * 4. Smoke-tests the new behaviour: payee-pinned settle, server proof registration,
 *    duplicate-scope rejection, StatusSequenceConsumed on direct setStatus.
 *
 * Never sends anything to mainnet.
 */
import * as fs from "fs";
import { artifacts, ethers, network } from "hardhat";
import { FACTORY, FEE_REGISTRY, IMPL_SLOT, SAFE, UPGRADES, predictImplementation, saltHashFor } from "./hashlock6";

const BATCH_FILE = process.env.BATCH_FILE || "docs/dataPortability/mainnet-safe/1-upgrade-dp-v2-hashlock6.json";
// FACILITATOR_ROLE holders read from the escrow's RoleGranted logs on 2026-11-20 (7 keys since 2026-09-16).
const FACILITATORS = [
  "0x80534af0b80ae88d653cae0a8f5d2667439538a0",
  "0x465abe7414f7c8eac47d93d2311e50eb9480f925",
  "0xf83eadb2f59cb22857199b6a7e013cf42b6e1491",
  "0x91b588883c6b9a1367c5cf9a2246d63bd201d978",
  "0xb7fb80fa86a8d1ce84da3f6b9ce2e4f2afa1cfbf",
  "0xdb0e92d683b3cd08a7fdba731110953450303051",
  "0xd8183d7007d78eac677c7f60b2e3f550be1ab7c2",
].map(ethers.getAddress);
const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const FACILITATOR_ROLE = ethers.id("FACILITATOR_ROLE");
const LOG_WINDOW = 50_000; // blocks scanned for samples, newest first, in small chunks (PermissionSet is frequent; big ranges overflow the fork provider)
const LOG_CHUNK = 2_500;

const ser = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));
let failures = 0;
function check(cond: unknown, msg: string) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${msg}`);
  if (!cond) failures++;
}
async function impersonate(addr: string) {
  await network.provider.send("hardhat_impersonateAccount", [addr]);
  await network.provider.send("hardhat_setBalance", [addr, "0x3635C9ADC5DEA00000"]); // 1000 VANA
  return ethers.getSigner(addr);
}
/** Latest log of `event` on `contract` in the last LOG_WINDOW blocks, or null. */
async function latestLog(contract: any, event: string, head: number) {
  for (let to = head; to > head - LOG_WINDOW; to -= LOG_CHUNK) {
    const from = Math.max(to - LOG_CHUNK + 1, head - LOG_WINDOW);
    const logs = await contract.queryFilter(contract.filters[event](), from, to);
    if (logs.length) return logs[logs.length - 1];
  }
  return null;
}

async function main() {
  const rpc = process.env.VANA_RPC_URL;
  if (!rpc) throw new Error("VANA_RPC_URL is required");
  await network.provider.send("hardhat_reset", [{ forking: { jsonRpcUrl: rpc } }]);
  const head = await ethers.provider.getBlockNumber();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  console.log(`Forked Vana mainnet at block ${head} (chainId ${chainId})`);
  check(chainId === 1480n, "fork chainId is 1480 (EIP-712 domains match mainnet)");

  const [funder] = await ethers.getSigners();
  const batch = JSON.parse(fs.readFileSync(BATCH_FILE, "utf8"));
  check(batch.chainId === "1480", `batch ${BATCH_FILE} is for chain 1480`);
  check(ethers.getAddress(batch.meta.createdFromSafeAddress) === SAFE, `batch created for Safe ${SAFE}`);
  check(batch.transactions.length === UPGRADES.length, `batch has ${UPGRADES.length} transactions`);

  // ---- contracts (new ABI; pre-upgrade reads only use functions that exist on both) ----
  const at = async (u: (typeof UPGRADES)[number]) => ethers.getContractAt(u.contract, u.proxy);
  const [dataRegistry, servers, permissions, escrow] = await Promise.all(UPGRADES.map(at));
  const feeRegistry = await ethers.getContractAt("FeeRegistryImplementation", FEE_REGISTRY);

  // ---- 1. deploy implementations through the factory, as the Ledger will ----
  console.log("\n== 1. Implementations (CREATE2 through the factory)");
  const predicted: Record<string, string> = {};
  for (const u of UPGRADES) {
    const impl = await predictImplementation(u.contract);
    predicted[u.key] = impl;
    if ((await ethers.provider.getCode(impl)) === "0x") {
      const { bytecode } = await artifacts.readArtifact(u.contract);
      const rcpt = await (await funder.sendTransaction({ to: FACTORY, data: ethers.concat([saltHashFor(u.contract), bytecode]) })).wait();
      console.log(`  deployed ${u.contract} via factory: gas ${rcpt?.gasUsed}`);
    }
    check((await ethers.provider.getCode(impl)) !== "0x", `${u.contract} code at predicted ${impl}`);
    const inBatch = batch.transactions[UPGRADES.indexOf(u)].data.toLowerCase().includes(impl.slice(2).toLowerCase());
    check(inBatch, `batch tx ${UPGRADES.indexOf(u) + 1} targets ${impl}`);
  }

  // ---- 2. pre-upgrade snapshot ----
  console.log("\n== 2. Pre-upgrade snapshot");
  const pre = {
    impls: await Promise.all(UPGRADES.map((u) => ethers.provider.getStorage(u.proxy, IMPL_SLOT))),
    versions: await Promise.all([dataRegistry, servers, permissions, escrow].map((c) => c.version())),
    allowedTargets: [...(await escrow.getAllowedTargets())],
    allowedSelectors: {} as Record<string, string[]>,
    escrowPermissions: await escrow.permissions(),
    escrowDataRegistry: await escrow.dataRegistry(),
    serversCount: await servers.serversCount(),
    permsServers: await permissions.dataPortabilityServers(),
    drServers: await dataRegistry.dataPortabilityServers(),
    permsDomain: await permissions.domainSeparator(),
    serversDomain: await servers.domainSeparator(),
  };
  for (const t of pre.allowedTargets) pre.allowedSelectors[t] = [...(await escrow.getAllowedSelectors(t))];
  check(pre.versions.map(String).join(",") === UPGRADES.map((u) => u.liveVersion).join(","), `live versions ${pre.versions.join("/")} as expected`);
  console.log(`  escrow allowlist: ${pre.allowedTargets.length} targets, serversCount ${pre.serversCount}`);

  // samples from recent logs (best effort)
  const sample: Record<string, any> = {};
  const permLog = await latestLog(permissions, "PermissionSet", head);
  if (permLog) { sample.permId = permLog.args.id ?? permLog.args[0]; sample.perm = await permissions.permissions(sample.permId); sample.permActive = await permissions.isActive(sample.permId); }
  const srvLog = await latestLog(servers, "ServerRegistered", head);
  if (srvLog) { sample.serverId = srvLog.args.serverId ?? srvLog.args[0]; sample.server = await servers.getServer(sample.serverId); }
  const dpLog = await latestLog(dataRegistry, "DataPointCreated", head);
  if (dpLog) { sample.dpId = dpLog.args.id ?? dpLog.args[0]; sample.dp = await dataRegistry.dataPointById(sample.dpId); }
  const depLog = await latestLog(escrow, "Deposited", head);
  if (depLog) { sample.depAccount = depLog.args.account; sample.depAsset = depLog.args.asset; sample.depBalance = await escrow.balanceOf(sample.depAccount, sample.depAsset); }
  console.log(`  samples: permission ${sample.permId ?? "-"}, server ${sample.serverId ?? "-"}, data point ${sample.dpId ?? "-"}, deposit ${sample.depAccount ?? "-"} (${sample.depBalance ?? "-"} of ${sample.depAsset ?? "-"})`);

  // ---- 3. replay the batch from the Safe ----
  console.log("\n== 3. Replay batch from the Safe");
  const safe = await impersonate(SAFE);
  for (const [i, t] of batch.transactions.entries()) {
    const rcpt = await (await safe.sendTransaction({ to: t.to, data: t.data, value: t.value })).wait();
    check(rcpt?.status === 1, `tx ${i + 1} -> ${t.to} succeeded (gas ${rcpt?.gasUsed})`);
  }

  // ---- 4. post-upgrade assertions ----
  console.log("\n== 4. Post-upgrade state");
  for (const [i, u] of UPGRADES.entries()) {
    const raw = await ethers.provider.getStorage(u.proxy, IMPL_SLOT);
    check(ethers.getAddress("0x" + raw.slice(-40)) === predicted[u.key], `${u.contract} proxy -> ${predicted[u.key]}`);
    check(raw !== pre.impls[i], `${u.contract} implementation changed`);
  }
  const post = await Promise.all([dataRegistry, servers, permissions, escrow].map((c) => c.version()));
  check(post.map(String).join(",") === UPGRADES.map((u) => u.targetVersion).join(","), `versions now ${post.join("/")}`);
  check((await escrow.feeRegistry()) === FEE_REGISTRY, `escrow.feeRegistry() == ${FEE_REGISTRY}`);
  check((await escrow.permissions()) === pre.escrowPermissions && (await escrow.dataRegistry()) === pre.escrowDataRegistry, "escrow permissions/dataRegistry wiring unchanged");
  const targetsNow = [...(await escrow.getAllowedTargets())];
  check(ser(targetsNow) === ser(pre.allowedTargets), `escrow allowlist targets unchanged (${targetsNow.length})`);
  for (const t of pre.allowedTargets) check(ser([...(await escrow.getAllowedSelectors(t))]) === ser(pre.allowedSelectors[t]), `escrow selectors for ${t} unchanged`);
  check((await servers.serversCount()) === pre.serversCount, `serversCount unchanged (${pre.serversCount})`);
  check((await servers.requireServerProof()) === false, "servers.requireServerProof() is false (legacy registration still works)");
  check((await permissions.dataPortabilityServers()) === pre.permsServers && (await dataRegistry.dataPortabilityServers()) === pre.drServers, "PermissionsV2/DataRegistryV2 -> ServersV2 wiring unchanged");
  check((await permissions.domainSeparator()) === pre.permsDomain && (await servers.domainSeparator()) === pre.serversDomain, "EIP-712 domain separators unchanged (pending client signatures stay valid)");
  check((await permissions.MAX_SCOPES()) === 64n && (await permissions.MAX_SCOPE_LENGTH()) === 128n && (await permissions.MAX_GRANT_VERSION_STEP()) === 1n << 64n, "PermissionsV2 limits: 64 scopes, 128 bytes, step 2^64");
  for (const c of [dataRegistry, servers, permissions, escrow]) check(await c.hasRole(DEFAULT_ADMIN_ROLE, SAFE), `Safe keeps DEFAULT_ADMIN_ROLE on ${await c.getAddress()}`);
  for (const f of FACILITATORS) check(await escrow.hasRole(FACILITATOR_ROLE, f), `facilitator ${f} keeps FACILITATOR_ROLE`);
  for (const c of [dataRegistry, servers, permissions, escrow]) check(!(await c.paused()), `${await c.getAddress()} not paused`);
  if (sample.permId) check(ser(await permissions.permissions(sample.permId)) === ser(sample.perm) && (await permissions.isActive(sample.permId)) === sample.permActive, `sampled permission ${sample.permId} reads identically`);
  if (sample.serverId) check(ser(await servers.getServer(sample.serverId)) === ser(sample.server), `sampled server ${sample.serverId} reads identically`);
  if (sample.dpId) check(ser(await dataRegistry.dataPointById(sample.dpId)) === ser(sample.dp), `sampled data point ${sample.dpId} reads identically`);
  if (sample.depAccount) check((await escrow.balanceOf(sample.depAccount, sample.depAsset)) === sample.depBalance, `sampled escrow balance unchanged (${sample.depBalance})`);

  // ---- 5. behaviour smoke tests ----
  console.log("\n== 5. New behaviour");
  // Escrow: payee pinning
  const dataAccessOp = await escrow.feeOperation(5); // OpKind.DataAccess
  const payee = (await feeRegistry.fees(dataAccessOp)).payee;
  console.log(`  FeeRegistry payee for DataAccess: ${payee}`);
  check(payee !== ethers.ZeroAddress, "DataAccess has a payee set in the FeeRegistry");
  const facilitator = await impersonate(FACILITATORS[0]);
  if (sample.depAccount && sample.depBalance > 0n) {
    const ref = ethers.id("simulation");
    await check_revert(escrow.connect(facilitator).settle(sample.depAccount, funder.address, sample.depAsset, 1n, 5, ref), "UnexpectedPayee", "settle to a non-payee reverts UnexpectedPayee");
    const payeeBefore = sample.depAsset === ethers.ZeroAddress ? await ethers.provider.getBalance(payee) : 0n;
    const ok = await (await escrow.connect(facilitator).settle(sample.depAccount, payee, sample.depAsset, 1n, 5, ref)).wait();
    check(ok?.status === 1, "settle(DataAccess) to the FeeRegistry payee succeeds");
    if (sample.depAsset === ethers.ZeroAddress) check((await ethers.provider.getBalance(payee)) === payeeBefore + 1n, "payee received the settled wei");
    await check_revert(escrow.connect(facilitator).settle(sample.depAccount, payee, sample.depAsset, 1n, 0, ref), "UnexpectedPayee", "settle with OpKind.Unspecified reverts UnexpectedPayee");
  } else {
    console.log("  (no recent deposit sample with balance; settle smoke test skipped)");
  }

  // ServersV2: proof registration and legacy registration (flag off)
  const owner = ethers.Wallet.createRandom().connect(ethers.provider);
  const serverKey = ethers.Wallet.createRandom().connect(ethers.provider);
  const dom = await servers.eip712Domain();
  const domain = { name: dom.name, version: dom.version, chainId: dom.chainId, verifyingContract: dom.verifyingContract };
  const regTypes = { ServerRegistration: [
    { name: "ownerAddress", type: "address" }, { name: "serverAddress", type: "address" }, { name: "publicKey", type: "string" }, { name: "serverUrl", type: "string" } ] };
  const proofTypes = { ServerProof: [
    { name: "ownerAddress", type: "address" }, { name: "serverAddress", type: "address" }, { name: "publicKey", type: "string" }, { name: "serverUrl", type: "string" }, { name: "deadline", type: "uint256" } ] };
  const reg = { ownerAddress: owner.address, serverAddress: serverKey.address, publicKey: "0x04sim", serverUrl: "https://sim.example" };
  const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
  const ownerSig = await owner.signTypedData(domain, regTypes, reg);
  const serverSig = await serverKey.signTypedData(domain, proofTypes, { ...reg, deadline });
  const r1 = await (await servers.connect(funder).registerServerWithProof(reg, deadline, ownerSig, serverSig)).wait();
  check(r1?.status === 1 && (await servers.activeServerId(serverKey.address)) !== ethers.ZeroHash, "registerServerWithProof (owner + server signatures) registers");
  const owner2 = ethers.Wallet.createRandom(); const server2 = ethers.Wallet.createRandom();
  const reg2 = { ownerAddress: owner2.address, serverAddress: server2.address, publicKey: "0x04sim2", serverUrl: "https://sim2.example" };
  const r2 = await (await servers.connect(funder).registerServerWithSignature(reg2, await owner2.signTypedData(domain, regTypes, reg2))).wait();
  check(r2?.status === 1, "registerServerWithSignature (owner only) still works while requireServerProof is off");
  check((await servers.serversCount()) === pre.serversCount + 2n, "serversCount advanced by 2");

  // PermissionsV2: duplicate scopes rejected, normal grant accepted
  const grantor = funder;
  const granteeId = ethers.id("sim-grantee");
  await check_revert(permissions.connect(grantor).addPermission({ grantorAddress: grantor.address, granteeId, scopes: ["profile", "profile"], grantVersion: 1, expiresAt: 0 }), "DuplicateScope", "addPermission with duplicate scopes reverts DuplicateScope");
  const p1 = await (await permissions.connect(grantor).addPermission({ grantorAddress: grantor.address, granteeId, scopes: ["profile", "messages"], grantVersion: 1, expiresAt: 0 })).wait();
  check(p1?.status === 1 && (await permissions.isActive(await permissions.grantId(grantor.address, granteeId))), "addPermission with unique scopes is active");
  await check_revert(permissions.connect(grantor).addPermission({ grantorAddress: grantor.address, granteeId, scopes: ["profile"], grantVersion: (1n << 64n) + 2n, expiresAt: 0 }), "InvalidGrantVersion", "grantVersion jump > 2^64 reverts InvalidGrantVersion (L-01)");

  // DataRegistryV2: direct setStatus consumes the status sequence and logs it
  const scope = "sim-scope";
  await (await dataRegistry.connect(funder).addData(scope, ethers.id("data"), ethers.id("meta"))).wait();
  const seqBefore = await dataRegistry.statusSequence(funder.address, scope);
  const st = await (await dataRegistry.connect(funder).setStatus(scope, 2)).wait(); // Inactive
  const consumed = st!.logs.map((l) => { try { return dataRegistry.interface.parseLog(l as any)?.name; } catch { return null; } });
  check(consumed.includes("StatusSequenceConsumed") && (await dataRegistry.statusSequence(funder.address, scope)) === seqBefore + 1n, "direct setStatus emits StatusSequenceConsumed and advances the sequence (Q-02/Q-03)");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  if (failures) process.exit(1);
}

async function check_revert(p: Promise<any>, errorName: string, msg: string) {
  try { await p; check(false, `${msg} (did not revert)`); }
  catch (e: any) { const s = String(e?.message ?? e); check(s.includes(errorName), `${msg}${s.includes(errorName) ? "" : ` — got: ${s.slice(0, 160)}`}`); }
}

main().catch((e) => { console.error(e); process.exit(1); });
