/**
 * Measures `recordAccessAndSettleBatch` gas on a Hardhat fork of Vana
 * mainnet with the REAL deployed stack (ServersV2, USDC.e FiatTokenV2 proxy,
 * the production payer / payee of tx 0xfc0bb1…) and the upgraded
 * DataRegistryV2 + DataPortabilityEscrow implementations from this branch.
 *
 * Nothing is broadcast. The upgrade is applied by writing the ERC-1967
 * implementation slot of each proxy on the fork, so no admin key is needed.
 *
 * Scenario (the expensive, realistic shape):
 *   - N distinct data owners, each with its own freshly registered trusted
 *     server (production-length public key + relay URL) and its own data
 *     point (16-byte scope), first access each
 *   - one USDC.e leg per item, prod fee (10,000 units), prod payer → prod payee
 *
 *   VANA_RPC_URL=https://rpc.vana.org npx hardhat run scripts/gas/measureBatchOnFork.ts
 */
import { ethers, network } from "hardhat";

const REGISTRY = "0x8f1eFCdff3d0d5BB535e32620721c7EBed151867";
const ESCROW = "0x07d7769081adc3a3DBe91f5E4B98E9A5a6B292e3";
const SERVERS = "0xCae2CE0e9caa6643ed28186cF57bd40Bd9E17Eab";
const USDC_E = "0xF1815bd50389c46847f0Bda824eC8da914045D14";
const RELAYER = "0x80534af0b80ae88d653cae0a8f5d2667439538a0"; // FACILITATOR_ROLE holder (prod)
const PAYER = "0x2903623Cf9b275601BdF711A37Fa55e219FF6EeF"; // builder in tx 0xfc0bb1…
const PAYEE = "0xa5105914755cF2158be2D2C5c2392C4ba963f78F"; // fee recipient in tx 0xfc0bb1…
const FEE = 10_000n;
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const SIZES = [1, 10, 25, 50, 100, 200];
// Production server registrations carry a 132-char uncompressed public key
// and a ~47-char relay URL (measured on the server that signed tx 0xfc0bb1…).
// `_isTrustedServer` copies both strings out of storage per record, so the
// fixtures must match or the per-read cost is understated by ~16k gas.
const prodPublicKey = (i: number) => "0x04" + i.toString(16).padStart(130, "0");
const prodServerUrl = (i: number) => `https://${i.toString(16).padStart(24, "0")}.relay.vana.com`;

const setSlot = (addr: string, slot: string, value: string) =>
  network.provider.request({ method: "hardhat_setStorageAt", params: [addr, slot, value] });

async function main() {
  const rpc = process.env.VANA_RPC_URL || "https://rpc.vana.org";
  const remote = new ethers.JsonRpcProvider(rpc);
  const forkBlock = (await remote.getBlockNumber()) - 10;
  console.log("fork block", forkBlock);
  await network.provider.request({
    method: "hardhat_reset",
    params: [{ forking: { jsonRpcUrl: rpc, blockNumber: forkBlock } }],
  });
  // Hardhat's default block gas limit is 30M; mainnet blocks are 60M.
  await network.provider.request({ method: "evm_setBlockGasLimit", params: [ethers.toBeHex(60_000_000)] });

  // Before swapping implementations: prepare one item and measure the single
  // path on the DEPLOYED implementations, so the new code is compared with
  // what mainnet runs today on identical input (same fork block, same state).
  const deployedSingleGas = await measureDeployedSingle();

  // Deploy the new implementations and point the proxies at them.
  const regImpl = await (await ethers.getContractFactory("DataRegistryV2Implementation")).deploy();
  const escImpl = await (await ethers.getContractFactory("DataPortabilityEscrowImplementation")).deploy();
  await regImpl.waitForDeployment();
  await escImpl.waitForDeployment();
  const pad = (a: string) => ethers.zeroPadValue(a, 32);
  const oldReg = await ethers.provider.getStorage(REGISTRY, IMPL_SLOT);
  const oldEsc = await ethers.provider.getStorage(ESCROW, IMPL_SLOT);
  await setSlot(REGISTRY, IMPL_SLOT, pad(await regImpl.getAddress()));
  await setSlot(ESCROW, IMPL_SLOT, pad(await escImpl.getAddress()));
  console.log("registry impl", "0x" + oldReg.slice(-40), "→", await regImpl.getAddress());
  console.log("escrow impl  ", "0x" + oldEsc.slice(-40), "→", await escImpl.getAddress());

  const registry = await ethers.getContractAt("DataRegistryV2Implementation", REGISTRY);
  const escrow = await ethers.getContractAt("DataPortabilityEscrowImplementation", ESCROW);
  const servers = await ethers.getContractAt("DataPortabilityServersV2Implementation", SERVERS);
  const usdc = await ethers.getContractAt("IERC20", USDC_E);

  // Sanity: wiring as deployed.
  console.log("escrow.dataRegistry", await escrow.dataRegistry());
  console.log("registry.servers   ", await registry.dataPortabilityServers());
  console.log("relayer has FACILITATOR_ROLE", await escrow.hasRole(await escrow.FACILITATOR_ROLE(), RELAYER));
  console.log("escrow has ACCESS_RECORDER_ROLE", await registry.hasRole(await registry.ACCESS_RECORDER_ROLE(), ESCROW));
  console.log("MAX_ACCESS_BATCH", (await escrow.MAX_ACCESS_BATCH()).toString());

  // Fund the payer's escrow balance for the largest batch (storage write on
  // `_balances[PAYER][USDC_E]`, slot 0 of DataPortabilityEscrowStorageV1) and
  // make sure the escrow holds enough USDC.e to pay out.
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const balSlot = ethers.keccak256(
    abi.encode(["address", "bytes32"], [USDC_E, ethers.keccak256(abi.encode(["address", "uint256"], [PAYER, 0]))]),
  );
  const before = await escrow.balanceOf(PAYER, USDC_E);
  const need = FEE * BigInt(Math.max(...SIZES)) * 2n;
  await setSlot(ESCROW, balSlot, ethers.toBeHex(before + need, 32));
  console.log("payer escrow USDC.e", before.toString(), "→", (await escrow.balanceOf(PAYER, USDC_E)).toString());
  const escrowUsdc = await usdc.balanceOf(ESCROW);
  console.log("escrow USDC.e token balance", escrowUsdc.toString());
  if (escrowUsdc < need) throw new Error("escrow holds too little USDC.e for the payout");

  // Relayer: impersonate + fund gas.
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [RELAYER] });
  await network.provider.request({ method: "hardhat_setBalance", params: [RELAYER, ethers.toBeHex(10n ** 21n)] });
  const relayer = await ethers.getSigner(RELAYER);

  // Build N distinct owners / servers / data points on the fork.
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const serversDomain = { name: "Vana Data Portability", version: "1", chainId, verifyingContract: SERVERS };
  const registryDomain = { name: "Vana Data Portability", version: "1", chainId, verifyingContract: REGISTRY };
  const grantRef = ethers.id("grant-ref");
  const items: any[] = [];
  const N = Math.max(...SIZES);
  for (let i = 0; i < N; i++) {
    const dataOwner = ethers.Wallet.createRandom();
    const server = ethers.Wallet.createRandom();
    const scope = `linkedin.profil${String(i % 10)}`; // 16 bytes, prod-length
    const registration = {
      ownerAddress: dataOwner.address,
      serverAddress: server.address,
      publicKey: prodPublicKey(i),
      serverUrl: prodServerUrl(i),
    };
    const regSig = await dataOwner.signTypedData(
      serversDomain,
      {
        ServerRegistration: [
          { name: "ownerAddress", type: "address" },
          { name: "serverAddress", type: "address" },
          { name: "publicKey", type: "string" },
          { name: "serverUrl", type: "string" },
        ],
      },
      registration,
    );
    await servers.connect(relayer).registerServerWithSignature(registration, regSig);
    const dataHash = ethers.id("data-" + i);
    const metadataHash = ethers.id("meta-" + i);
    const addSig = await dataOwner.signTypedData(
      registryDomain,
      {
        AddData: [
          { name: "ownerAddress", type: "address" },
          { name: "scope", type: "string" },
          { name: "dataHash", type: "bytes32" },
          { name: "metadataHash", type: "bytes32" },
          { name: "expectedVersion", type: "uint256" },
        ],
      },
      { ownerAddress: dataOwner.address, scope, dataHash, metadataHash, expectedVersion: 1n },
    );
    await registry.connect(relayer).addDataWithSignature(dataOwner.address, scope, dataHash, metadataHash, 1n, addSig);
    const recordId = ethers.id("fork-record-" + i + "-" + forkBlock);
    const record = { ownerAddress: dataOwner.address, scope, version: 1n, accessor: PAYER, recordId };
    const signature = await server.signTypedData(
      registryDomain,
      {
        RecordDataAccess: [
          { name: "ownerAddress", type: "address" },
          { name: "scope", type: "string" },
          { name: "version", type: "uint256" },
          { name: "accessor", type: "address" },
          { name: "recordId", type: "bytes32" },
        ],
      },
      record,
    );
    items.push({
      record: { ...record, signature },
      ops: [{ from: PAYER, to: PAYEE, asset: USDC_E, amount: FEE, opKind: 5n, ref: grantRef }],
    });
    if ((i + 1) % 50 === 0) console.log("prepared", i + 1, "items");
  }

  const snapshot = async () => (await network.provider.request({ method: "evm_snapshot", params: [] })) as string;
  const revert = async (id: string) => network.provider.request({ method: "evm_revert", params: [id] });

  // Reference: single path with the upgraded impl, same item shape.
  {
    const s = await snapshot();
    const r = items[0].record;
    const tx = await escrow
      .connect(relayer)
      .recordAccessAndSettle(r.ownerAddress, r.scope, r.version, r.accessor, r.recordId, r.signature, items[0].ops);
    const rc = await tx.wait();
    console.log(`\nrecordAccessAndSettle (single, DEPLOYED impl, real USDC.e, same input shape): gas=${deployedSingleGas}`);
    console.log(`recordAccessAndSettle (single, THIS BRANCH impl, real USDC.e): gas=${rc!.gasUsed} calldata=${(tx.data.length - 2) / 2}B`);
    await revert(s);
  }

  const rows: { n: number; gas: bigint; calldata: number }[] = [];
  for (const n of SIZES) {
    const s = await snapshot();
    const tx = await escrow.connect(relayer).recordAccessAndSettleBatch(items.slice(0, n), { gasLimit: 58_000_000 });
    const rc = await tx.wait();
    if (rc!.status !== 1) throw new Error("batch reverted");
    const recordedLogs = rc!.logs.filter((l) => l.address.toLowerCase() === REGISTRY.toLowerCase()).length;
    if (recordedLogs !== n) throw new Error(`expected ${n} registry logs, got ${recordedLogs}`);
    rows.push({ n, gas: rc!.gasUsed, calldata: (tx.data.length - 2) / 2 });
    await revert(s);
  }

  const BLOCK = 60_000_000n;
  console.log("\n| batch | gasUsed | gas/read | marginal gas/read vs prev | calldata bytes | % of 60M block |");
  console.log("|---:|---:|---:|---:|---:|---:|");
  let prev: { n: number; gas: bigint } | null = null;
  for (const row of rows) {
    const marginal = prev ? (row.gas - prev.gas) / BigInt(row.n - prev.n) : null;
    console.log(
      `| ${row.n} | ${row.gas.toLocaleString("en-US")} | ${(row.gas / BigInt(row.n)).toLocaleString("en-US")} | ${
        marginal === null ? "—" : marginal.toLocaleString("en-US")
      } | ${row.calldata.toLocaleString("en-US")} | ${(Number((row.gas * 10000n) / BLOCK) / 100).toFixed(2)}% |`,
    );
    prev = row;
  }
}

async function measureDeployedSingle(): Promise<bigint> {
  const snap = (await network.provider.request({ method: "evm_snapshot", params: [] })) as string;
  const registry = await ethers.getContractAt("DataRegistryV2Implementation", REGISTRY);
  const escrow = await ethers.getContractAt("DataPortabilityEscrowImplementation", ESCROW);
  const servers = await ethers.getContractAt("DataPortabilityServersV2Implementation", SERVERS);
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const balSlot = ethers.keccak256(
    abi.encode(["address", "bytes32"], [USDC_E, ethers.keccak256(abi.encode(["address", "uint256"], [PAYER, 0]))]),
  );
  const before = await escrow.balanceOf(PAYER, USDC_E);
  await setSlot(ESCROW, balSlot, ethers.toBeHex(before + FEE * 10n, 32));
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [RELAYER] });
  await network.provider.request({ method: "hardhat_setBalance", params: [RELAYER, ethers.toBeHex(10n ** 21n)] });
  const relayer = await ethers.getSigner(RELAYER);
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const serversDomain = { name: "Vana Data Portability", version: "1", chainId, verifyingContract: SERVERS };
  const registryDomain = { name: "Vana Data Portability", version: "1", chainId, verifyingContract: REGISTRY };
  const dataOwner = ethers.Wallet.createRandom();
  const server = ethers.Wallet.createRandom();
  const scope = "linkedin.profil0";
  const registration = { ownerAddress: dataOwner.address, serverAddress: server.address, publicKey: prodPublicKey(999999), serverUrl: prodServerUrl(999999) };
  const regSig = await dataOwner.signTypedData(
    serversDomain,
    { ServerRegistration: [
      { name: "ownerAddress", type: "address" }, { name: "serverAddress", type: "address" },
      { name: "publicKey", type: "string" }, { name: "serverUrl", type: "string" } ] },
    registration,
  );
  await servers.connect(relayer).registerServerWithSignature(registration, regSig);
  const dataHash = ethers.id("data-ref");
  const metadataHash = ethers.id("meta-ref");
  const addSig = await dataOwner.signTypedData(
    registryDomain,
    { AddData: [
      { name: "ownerAddress", type: "address" }, { name: "scope", type: "string" }, { name: "dataHash", type: "bytes32" },
      { name: "metadataHash", type: "bytes32" }, { name: "expectedVersion", type: "uint256" } ] },
    { ownerAddress: dataOwner.address, scope, dataHash, metadataHash, expectedVersion: 1n },
  );
  await registry.connect(relayer).addDataWithSignature(dataOwner.address, scope, dataHash, metadataHash, 1n, addSig);
  const recordId = ethers.id("fork-record-ref-" + Date.now());
  const record = { ownerAddress: dataOwner.address, scope, version: 1n, accessor: PAYER, recordId };
  const signature = await server.signTypedData(
    registryDomain,
    { RecordDataAccess: [
      { name: "ownerAddress", type: "address" }, { name: "scope", type: "string" }, { name: "version", type: "uint256" },
      { name: "accessor", type: "address" }, { name: "recordId", type: "bytes32" } ] },
    record,
  );
  const tx = await escrow
    .connect(relayer)
    .recordAccessAndSettle(record.ownerAddress, record.scope, record.version, record.accessor, record.recordId, signature, [
      { from: PAYER, to: PAYEE, asset: USDC_E, amount: FEE, opKind: 5n, ref: ethers.id("grant-ref") },
    ]);
  const rc = await tx.wait();
  await network.provider.request({ method: "evm_revert", params: [snap] });
  return rc!.gasUsed;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
