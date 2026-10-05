import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import { takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  DataPortabilityEscrowImplementation,
  DataPortabilityServersV2Implementation,
  DataRegistryV2Implementation,
  ERC20Mock,
} from "../../typechain-types";

chai.use(chaiAsPromised);
should();

/**
 * Gas measurement for `recordAccessAndSettleBatch`, printed as a table.
 *
 * Scenario (chosen to be the EXPENSIVE, realistic shape, not the cheapest):
 *   - every item is a different data owner with its own trusted server
 *     (production-length public key + relay URL) and its own data point →
 *     every registry slot touched is cold, every counter goes 0 → nonzero,
 *     every `_isTrustedServer` lookup is a fresh server
 *   - first access on each data point (both counters zero → nonzero)
 *   - one ERC-20 payment leg per item, one payer (the accessor / builder),
 *     one payee (the protocol fee recipient) — the production shape
 *   - 16-byte scopes, as in production (`vana.profile`-length)
 *
 * Numbers with the real USDC.e (FiatTokenV2 proxy) come from the mainnet
 * fork script `scripts/gas/measureBatchOnFork.ts`; this suite uses
 * ERC20Mock so it runs offline and is deterministic.
 */
describe("recordAccessAndSettleBatch gas", () => {
  const SIZES = [1, 10, 25, 50, 100, 200];
  const MAX = Math.max(...SIZES);
  const FEE = 10_000n; // 0.01 USDC (6 decimals), the production access fee
  const scopeFor = (i: number) => `vana.profile.${String(i).padStart(3, "0")}`; // 16 bytes
  // Production server registrations: 132-char uncompressed public key and a
  // ~47-char relay URL. `_isTrustedServer` copies both out of storage per
  // record, so short fixture strings would understate the per-read cost.
  const prodPublicKey = (i: number) => "0x04" + i.toString(16).padStart(130, "0");
  const prodServerUrl = (i: number) => `https://${i.toString(16).padStart(24, "0")}.relay.vana.com`;

  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let facilitator: HardhatEthersSigner;
  let relayer: HardhatEthersSigner;
  let builder: HardhatEthersSigner; // accessor + payer
  let payee: HardhatEthersSigner;

  let escrow: DataPortabilityEscrowImplementation;
  let servers: DataPortabilityServersV2Implementation;
  let registry: DataRegistryV2Implementation;
  let token: ERC20Mock;

  type Item = {
    record: {
      ownerAddress: string;
      scope: string;
      version: bigint;
      accessor: string;
      recordId: string;
      signature: string;
    };
    ops: {
      from: string;
      to: string;
      asset: string;
      amount: bigint;
      opKind: bigint;
      ref: string;
    }[];
  };
  const items: Item[] = [];

  const domain = async (verifyingContract: string) => ({
    name: "Vana Data Portability",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract,
  });

  before(async function () {
    this.timeout(0);
    [deployer, owner, facilitator, relayer, builder, payee] =
      await ethers.getSigners();

    escrow = await ethers.getContractAt(
      "DataPortabilityEscrowImplementation",
      (
        await upgrades.deployProxy(
          await ethers.getContractFactory("DataPortabilityEscrowImplementation"),
          [owner.address, facilitator.address],
          { kind: "uups" },
        )
      ).target,
    );
    servers = await ethers.getContractAt(
      "DataPortabilityServersV2Implementation",
      (
        await upgrades.deployProxy(
          await ethers.getContractFactory("DataPortabilityServersV2Implementation"),
          [ethers.ZeroAddress, owner.address],
          { kind: "uups" },
        )
      ).target,
    );
    registry = await ethers.getContractAt(
      "DataRegistryV2Implementation",
      (
        await upgrades.deployProxy(
          await ethers.getContractFactory("DataRegistryV2Implementation"),
          [owner.address],
          { kind: "uups" },
        )
      ).target,
    );
    token = await (await ethers.getContractFactory("ERC20Mock")).deploy("USD Coin", "USDC");
    await token.waitForDeployment();

    await registry.connect(owner).setDataPortabilityServers(await servers.getAddress());
    await registry.connect(owner).grantRole(await registry.ACCESS_RECORDER_ROLE(), await escrow.getAddress());
    await escrow.connect(owner).setDataRegistry(await registry.getAddress());
    await escrow.connect(owner).setTokenWhitelisted(await token.getAddress(), true);

    // Builder funds its escrow account once.
    const tokenAddr = await token.getAddress();
    await token.connect(deployer).transfer(builder.address, FEE * BigInt(MAX) * 10n);
    await token.connect(builder).approve(await escrow.getAddress(), FEE * BigInt(MAX) * 10n);
    await escrow.connect(builder).depositToken(builder.address, tokenAddr, FEE * BigInt(MAX) * 10n);

    const serversDomain = await domain(await servers.getAddress());
    const registryDomain = await domain(await registry.getAddress());
    const grantRef = ethers.id("grant-ref");

    for (let i = 0; i < MAX; i++) {
      const dataOwner = ethers.Wallet.createRandom();
      const server = ethers.Wallet.createRandom();
      const scope = scopeFor(i);

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
      await registry
        .connect(relayer)
        .addDataWithSignature(dataOwner.address, scope, dataHash, metadataHash, 1n, addSig);

      const recordId = ethers.id("record-" + i);
      const record = {
        ownerAddress: dataOwner.address,
        scope,
        version: 1n,
        accessor: builder.address,
        recordId,
      };
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
        ops: [
          {
            from: builder.address,
            to: payee.address,
            asset: tokenAddr,
            amount: FEE,
            opKind: 5n, // DataAccess
            ref: grantRef,
          },
        ],
      });
    }
  });

  it("prints gas per batch size (distinct owners, first access, one ERC-20 leg each)", async function () {
    this.timeout(0);
    const rows: { n: number; gas: bigint; calldata: number }[] = [];

    // Reference: the single-record path, same item.
    {
      const snap = await takeSnapshot();
      const r = items[0].record;
      const tx = await escrow
        .connect(facilitator)
        .recordAccessAndSettle(r.ownerAddress, r.scope, r.version, r.accessor, r.recordId, r.signature, items[0].ops);
      const rc = await tx.wait();
      const calldata = (tx.data.length - 2) / 2;
      console.log(`\n  recordAccessAndSettle (single, reference): gas=${rc!.gasUsed} calldata=${calldata}B`);
      await snap.restore();
    }

    for (const n of SIZES) {
      const snap = await takeSnapshot();
      const bundles = items.slice(0, n);
      const tx = await escrow.connect(facilitator).recordAccessAndSettleBatch(bundles);
      const rc = await tx.wait();
      rc!.status!.should.eq(1);
      (await registry.isRecordIdUsed(items[n - 1].record.recordId)).should.eq(true);
      rows.push({ n, gas: rc!.gasUsed, calldata: (tx.data.length - 2) / 2 });
      await snap.restore();
    }

    const BLOCK = 60_000_000n;
    const BUDGET = (BLOCK * 80n) / 100n;
    console.log("\n  | batch | gasUsed | gas/read | marginal gas/read vs prev | calldata bytes | % of 60M block |");
    console.log("  |---:|---:|---:|---:|---:|---:|");
    let prev: { n: number; gas: bigint } | null = null;
    for (const row of rows) {
      const marginal = prev ? (row.gas - prev.gas) / BigInt(row.n - prev.n) : null;
      console.log(
        `  | ${row.n} | ${row.gas.toLocaleString("en-US")} | ${(row.gas / BigInt(row.n)).toLocaleString("en-US")} | ${
          marginal === null ? "—" : marginal.toLocaleString("en-US")
        } | ${row.calldata.toLocaleString("en-US")} | ${(Number((row.gas * 10000n) / BLOCK) / 100).toFixed(2)}% |`,
      );
      prev = row;
    }
    const last = rows[rows.length - 1];
    const marginal200 = (last.gas - rows[rows.length - 2].gas) / BigInt(last.n - rows[rows.length - 2].n);
    console.log(`\n  block gas budget with 20% margin: ${BUDGET.toLocaleString("en-US")}`);
    console.log(`  largest measured batch: ${last.n} at ${last.gas.toLocaleString("en-US")} gas (${(Number((last.gas * 10000n) / BLOCK) / 100).toFixed(2)}% of block)`);
    console.log(`  marginal gas per read at the top of the range: ${marginal200.toLocaleString("en-US")}`);
    console.log(`  MAX_ACCESS_BATCH (contract cap): ${await escrow.MAX_ACCESS_BATCH()}\n`);

    // Guard: the largest allowed batch must fit a block with 20% margin.
    (last.gas < BUDGET).should.eq(true, `batch of ${last.n} exceeds 80% of a 60M block`);
  });
});
