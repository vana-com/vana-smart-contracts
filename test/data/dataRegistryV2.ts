import chai, { expect, should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  DataRegistryV2Implementation,
  DataPortabilityServersV2Implementation,
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

chai.use(chaiAsPromised);
should();

describe("DataRegistryV2", () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner; // admin of the registry
  let user1: HardhatEthersSigner; // data owner
  let user2: HardhatEthersSigner; // second data owner
  let relayer: HardhatEthersSigner; // submits signed txs
  let recorder: HardhatEthersSigner; // holds ACCESS_RECORDER_ROLE
  let server1: HardhatEthersSigner; // personal server key
  let server2: HardhatEthersSigner; // second personal server key
  let other: HardhatEthersSigner; // unrelated key

  let registry: DataRegistryV2Implementation;
  let servers: DataPortabilityServersV2Implementation;

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const ACCESS_RECORDER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("ACCESS_RECORDER_ROLE"),
  );

  // Status enum
  const Status = { None: 0n, Active: 1n, Inactive: 2n, Unavailable: 3n };

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  const SCOPE = "instagram.profile";
  const DATA_HASH = ethers.keccak256(ethers.toUtf8Bytes("data-1"));
  const META_HASH = ethers.keccak256(ethers.toUtf8Bytes("meta-1"));
  const DATA_HASH_2 = ethers.keccak256(ethers.toUtf8Bytes("data-2"));
  const META_HASH_2 = ethers.keccak256(ethers.toUtf8Bytes("meta-2"));

  const dpId = (ownerAddress: string, scope: string) =>
    ethers.keccak256(
      abiCoder.encode(["address", "string"], [ownerAddress, scope]),
    );

  const commitmentOf = (dataHash: string, metadataHash: string) =>
    ethers.keccak256(
      abiCoder.encode(["bytes32", "bytes32"], [dataHash, metadataHash]),
    );

  // ====================== EIP-712 helpers ======================

  const eip712Domain = async (verifyingContract: string) => ({
    name: "Vana Data Portability",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract,
  });

  const AddDataTypes = {
    AddData: [
      { name: "ownerAddress", type: "address" },
      { name: "scope", type: "string" },
      { name: "dataHash", type: "bytes32" },
      { name: "metadataHash", type: "bytes32" },
      { name: "expectedVersion", type: "uint256" },
    ],
  };

  const RecordDataAccessTypes = {
    RecordDataAccess: [
      { name: "ownerAddress", type: "address" },
      { name: "scope", type: "string" },
      { name: "version", type: "uint256" },
      { name: "accessor", type: "address" },
      { name: "recordId", type: "bytes32" },
    ],
  };

  const SetStatusTypes = {
    SetStatus: [
      { name: "ownerAddress", type: "address" },
      { name: "scope", type: "string" },
      { name: "newStatus", type: "uint8" },
      { name: "expectedSequence", type: "uint256" },
    ],
  };

  const ServerRegistrationTypes = {
    ServerRegistration: [
      { name: "ownerAddress", type: "address" },
      { name: "serverAddress", type: "address" },
      { name: "publicKey", type: "string" },
      { name: "serverUrl", type: "string" },
    ],
  };

  const ServerDeregistrationTypes = {
    ServerDeregistration: [
      { name: "ownerAddress", type: "address" },
      { name: "serverAddress", type: "address" },
      { name: "serverId", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const signAddData = async (
    signer: HardhatEthersSigner,
    ownerAddress: string,
    scope: string,
    dataHash: string,
    metadataHash: string,
    expectedVersion: bigint,
  ) =>
    signer.signTypedData(
      await eip712Domain(await registry.getAddress()),
      AddDataTypes,
      { ownerAddress, scope, dataHash, metadataHash, expectedVersion },
    );

  const signSetStatus = async (
    signer: HardhatEthersSigner,
    ownerAddress: string,
    scope: string,
    newStatus: bigint,
    expectedSequence: bigint,
  ) =>
    signer.signTypedData(
      await eip712Domain(await registry.getAddress()),
      SetStatusTypes,
      { ownerAddress, scope, newStatus, expectedSequence },
    );

  const signRecordDataAccess = async (
    signer: HardhatEthersSigner,
    ownerAddress: string,
    scope: string,
    version: bigint,
    accessor: string,
    recordId: string,
  ) =>
    signer.signTypedData(
      await eip712Domain(await registry.getAddress()),
      RecordDataAccessTypes,
      { ownerAddress, scope, version, accessor, recordId },
    );

  // Registers `serverSigner` as a personal server owned by `serverOwner` in
  // the ServersV2 registry. Returns the serverId.
  const registerServer = async (
    serverOwner: HardhatEthersSigner,
    serverSigner: HardhatEthersSigner,
    publicKey = "test-public-key",
    serverUrl = "https://server.example.com",
  ): Promise<string> => {
    const input = {
      ownerAddress: serverOwner.address,
      serverAddress: serverSigner.address,
      publicKey,
      serverUrl,
    };
    const signature = await serverOwner.signTypedData(
      await eip712Domain(await servers.getAddress()),
      ServerRegistrationTypes,
      input,
    );
    await servers
      .connect(relayer)
      .registerServerWithSignature(input, signature);
    return await servers.computeServerId(
      serverSigner.address,
      publicKey,
      serverUrl,
    );
  };

  const deregisterServer = async (
    serverOwner: HardhatEthersSigner,
    serverSigner: HardhatEthersSigner,
    serverId: string,
  ) => {
    const deadline = BigInt(await time.latest()) + 1000n;
    const input = {
      ownerAddress: serverOwner.address,
      serverAddress: serverSigner.address,
      serverId,
      deadline,
    };
    const signature = await serverOwner.signTypedData(
      await eip712Domain(await servers.getAddress()),
      ServerDeregistrationTypes,
      input,
    );
    await servers
      .connect(relayer)
      .deregisterServerWithSignature(input, signature);
  };

  const deploy = async () => {
    [
      deployer,
      owner,
      user1,
      user2,
      relayer,
      recorder,
      server1,
      server2,
      other,
    ] = await ethers.getSigners();

    const registryDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DataRegistryV2Implementation"),
      [owner.address],
      { kind: "uups" },
    );
    registry = await ethers.getContractAt(
      "DataRegistryV2Implementation",
      registryDeploy.target,
    );

    const serversDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory(
        "DataPortabilityServersV2Implementation",
      ),
      [ethers.ZeroAddress, owner.address],
      { kind: "uups" },
    );
    servers = await ethers.getContractAt(
      "DataPortabilityServersV2Implementation",
      serversDeploy.target,
    );
  };

  const wireServers = async () => {
    await registry
      .connect(owner)
      .setDataPortabilityServers(await servers.getAddress());
  };

  // ====================== Setup ======================

  describe("Setup", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should have correct params after deploy", async function () {
      (await registry.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(true);
      (await registry.hasRole(DEFAULT_ADMIN_ROLE, deployer)).should.eq(false);
      (await registry.version()).should.eq(1);
      (await registry.dataPortabilityServers()).should.eq(ethers.ZeroAddress);
      (await registry.paused()).should.eq(false);
    });

    it("should reject re-initialization", async function () {
      await expect(
        registry.initialize(user1.address),
      ).to.be.revertedWithCustomError(registry, "InvalidInitialization");
    });

    it("should reject zero owner at initialization", async function () {
      const implFactory = await ethers.getContractFactory(
        "DataRegistryV2Implementation",
      );
      const impl = await implFactory.deploy();
      await impl.waitForDeployment();
      const proxyFactory = await ethers.getContractFactory(
        "DataRegistryV2Proxy",
      );

      await expect(
        proxyFactory.deploy(
          await impl.getAddress(),
          implFactory.interface.encodeFunctionData("initialize", [
            ethers.ZeroAddress,
          ]),
        ),
      ).to.be.revertedWithCustomError(implFactory, "ZeroAddress");
    });

    it("should expose the expected EIP-712 typehashes", async function () {
      (await registry.ADD_DATA_TYPEHASH()).should.eq(
        ethers.keccak256(
          ethers.toUtf8Bytes(
            "AddData(address ownerAddress,string scope,bytes32 dataHash,bytes32 metadataHash,uint256 expectedVersion)",
          ),
        ),
      );
      (await registry.RECORD_ACCESS_TYPEHASH()).should.eq(
        ethers.keccak256(
          ethers.toUtf8Bytes(
            "RecordDataAccess(address ownerAddress,string scope,uint256 version,address accessor,bytes32 recordId)",
          ),
        ),
      );
      (await registry.SET_STATUS_TYPEHASH()).should.eq(
        ethers.keccak256(
          ethers.toUtf8Bytes(
            "SetStatus(address ownerAddress,string scope,uint8 newStatus,uint256 expectedSequence)",
          ),
        ),
      );
    });
  });

  // ====================== Pure helpers ======================

  describe("Pure helpers", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("dataPointId should equal keccak256(abi.encode(owner, scope))", async function () {
      (await registry.dataPointId(user1.address, SCOPE)).should.eq(
        dpId(user1.address, SCOPE),
      );
      (await registry.dataPointId(user2.address, "another.scope")).should.eq(
        dpId(user2.address, "another.scope"),
      );
    });

    it("computeCommitment should equal keccak256(abi.encode(dataHash, metadataHash))", async function () {
      (await registry.computeCommitment(DATA_HASH, META_HASH)).should.eq(
        commitmentOf(DATA_HASH, META_HASH),
      );
    });

    it("dataPointById should return zero defaults for an unregistered id", async function () {
      // Natspec: owner == address(0) signals "not found".
      const unknownId = ethers.id("no-such-data-point");
      const info = await registry.dataPointById(unknownId);
      info.id.should.eq(unknownId);
      info.owner.should.eq(ethers.ZeroAddress);
      info.scope.should.eq("");
      info.status.should.eq(Status.None);
      info.currentVersion.should.eq(0n);
      info.currentCommitment.should.eq(ethers.ZeroHash);
      info.createdAt.should.eq(0n);
      info.modifiedAt.should.eq(0n);
      info.totalAccesses.should.eq(0n);
    });
  });

  // ====================== addData ======================

  describe("addData", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should create a data point with version 1 and correct fields", async function () {
      const id = dpId(user1.address, SCOPE);

      const [retId, retVersion] = await registry
        .connect(user1)
        .addData.staticCall(SCOPE, DATA_HASH, META_HASH);
      retId.should.eq(id);
      retVersion.should.eq(1n);

      const tx = await registry
        .connect(user1)
        .addData(SCOPE, DATA_HASH, META_HASH);
      const receipt = await tx.wait();
      const blockTs = (await ethers.provider.getBlock(receipt!.blockNumber))!
        .timestamp;

      const commitment = commitmentOf(DATA_HASH, META_HASH);

      await expect(tx)
        .to.emit(registry, "DataPointCreated")
        .withArgs(
          id,
          user1.address,
          ethers.keccak256(ethers.toUtf8Bytes(SCOPE)),
          SCOPE,
        );
      await expect(tx)
        .to.emit(registry, "DataVersionAdded")
        .withArgs(id, 1n, DATA_HASH, META_HASH, commitment);

      const info = await registry.dataPoints(user1.address, SCOPE);
      info.id.should.eq(id);
      info.owner.should.eq(user1.address);
      info.scope.should.eq(SCOPE);
      info.status.should.eq(Status.Active);
      info.currentVersion.should.eq(1n);
      info.currentCommitment.should.eq(commitment);
      info.createdAt.should.eq(BigInt(blockTs));
      info.modifiedAt.should.eq(BigInt(blockTs));
      info.totalAccesses.should.eq(0n);

      // by-id lookup matches
      const infoById = await registry.dataPointById(id);
      infoById.owner.should.eq(user1.address);
      infoById.currentVersion.should.eq(1n);

      // views
      (await registry.currentVersion(user1.address, SCOPE)).should.eq(1n);
      (await registry.currentCommitment(user1.address, SCOPE)).should.eq(
        commitment,
      );
      (await registry.dataCommitment(user1.address, SCOPE, 1)).should.eq(
        commitment,
      );
    });

    it("should append a new version for the same (owner, scope)", async function () {
      const id = dpId(user1.address, SCOPE);
      await registry.connect(user1).addData(SCOPE, DATA_HASH, META_HASH);
      const createdAt = (await registry.dataPoints(user1.address, SCOPE))
        .createdAt;

      await time.increase(100);

      const [, retVersion] = await registry
        .connect(user1)
        .addData.staticCall(SCOPE, DATA_HASH_2, META_HASH_2);
      retVersion.should.eq(2n);

      const tx = await registry
        .connect(user1)
        .addData(SCOPE, DATA_HASH_2, META_HASH_2);
      const receipt = await tx.wait();
      const blockTs = (await ethers.provider.getBlock(receipt!.blockNumber))!
        .timestamp;

      const commitment2 = commitmentOf(DATA_HASH_2, META_HASH_2);

      // No second creation event on append, and no status event either —
      // the point is already Active, so an always-emit mutant would fail here.
      await expect(tx).to.not.emit(registry, "DataPointCreated");
      await expect(tx).to.not.emit(registry, "DataPointStatusChanged");
      await expect(tx)
        .to.emit(registry, "DataVersionAdded")
        .withArgs(id, 2n, DATA_HASH_2, META_HASH_2, commitment2);

      const info = await registry.dataPoints(user1.address, SCOPE);
      info.currentVersion.should.eq(2n);
      info.currentCommitment.should.eq(commitment2);
      info.createdAt.should.eq(createdAt);
      info.modifiedAt.should.eq(BigInt(blockTs));
      (BigInt(blockTs) > createdAt).should.eq(true);

      // Version-1 commitment still retrievable.
      (await registry.dataCommitment(user1.address, SCOPE, 1)).should.eq(
        commitmentOf(DATA_HASH, META_HASH),
      );
      (await registry.dataCommitment(user1.address, SCOPE, 2)).should.eq(
        commitment2,
      );
      (await registry.currentCommitment(user1.address, SCOPE)).should.eq(
        commitment2,
      );
    });

    it("should auto-revive an Inactive data point on addData", async function () {
      const id = dpId(user1.address, SCOPE);
      await registry.connect(user1).addData(SCOPE, DATA_HASH, META_HASH);
      await registry.connect(user1).setStatus(SCOPE, Status.Inactive);
      (await registry.dataPoints(user1.address, SCOPE)).status.should.eq(
        Status.Inactive,
      );

      const tx = await registry
        .connect(user1)
        .addData(SCOPE, DATA_HASH_2, META_HASH_2);
      await expect(tx)
        .to.emit(registry, "DataPointStatusChanged")
        .withArgs(id, Status.Active);

      const info = await registry.dataPoints(user1.address, SCOPE);
      info.status.should.eq(Status.Active);
      info.currentVersion.should.eq(2n);
    });

    it("should auto-revive an Unavailable data point on addData", async function () {
      // Natspec: auto-revives Inactive AND Unavailable.
      const id = dpId(user1.address, SCOPE);
      await registry.connect(user1).addData(SCOPE, DATA_HASH, META_HASH);
      await registry.connect(user1).setStatus(SCOPE, Status.Unavailable);

      const tx = await registry
        .connect(user1)
        .addData(SCOPE, DATA_HASH_2, META_HASH_2);
      await expect(tx)
        .to.emit(registry, "DataPointStatusChanged")
        .withArgs(id, Status.Active);
      (await registry.dataPoints(user1.address, SCOPE)).status.should.eq(
        Status.Active,
      );
    });

    it("should reject an empty scope", async function () {
      await expect(
        registry.connect(user1).addData("", DATA_HASH, META_HASH),
      ).to.be.revertedWithCustomError(registry, "EmptyScope");
    });

    it("should reject a scope longer than 256 bytes", async function () {
      await expect(
        registry
          .connect(user1)
          .addData("s".repeat(257), DATA_HASH, META_HASH),
      ).to.be.revertedWithCustomError(registry, "ScopeTooLong");
    });

    it("should accept a 256-byte scope (boundary)", async function () {
      const scope256 = "s".repeat(256);
      await registry.connect(user1).addData(scope256, DATA_HASH, META_HASH)
        .should.be.fulfilled;
      (await registry.currentVersion(user1.address, scope256)).should.eq(1n);
    });
  });

  // ====================== Scope enumeration ======================

  describe("Scope enumeration", () => {
    const sharedScope = "shared.scope";
    let id1: string;
    let id2: string;

    beforeEach(async () => {
      await deploy();
      await registry.connect(user1).addData(sharedScope, DATA_HASH, META_HASH);
      await registry
        .connect(user2)
        .addData(sharedScope, DATA_HASH_2, META_HASH_2);
      id1 = dpId(user1.address, sharedScope);
      id2 = dpId(user2.address, sharedScope);
    });

    it("should count data points per scope", async function () {
      (await registry.scopeDataPointsCount(sharedScope)).should.eq(2n);
      (await registry.scopeDataPointsCount("unknown.scope")).should.eq(0n);
    });

    it("should not double-count appended versions", async function () {
      await registry
        .connect(user1)
        .addData(sharedScope, DATA_HASH_2, META_HASH_2);
      (await registry.scopeDataPointsCount(sharedScope)).should.eq(2n);
    });

    it("should expose scopeDataPointIdAt", async function () {
      (await registry.scopeDataPointIdAt(sharedScope, 0)).should.eq(id1);
      (await registry.scopeDataPointIdAt(sharedScope, 1)).should.eq(id2);
    });

    it("should paginate scopeDataPointIds", async function () {
      (await registry.scopeDataPointIds(sharedScope, 0, 1)).should.deep.eq([
        id1,
      ]);
      (await registry.scopeDataPointIds(sharedScope, 1, 10)).should.deep.eq([
        id2,
      ]);
      (await registry.scopeDataPointIds(sharedScope, 0, 10)).should.deep.eq([
        id1,
        id2,
      ]);
      // offset >= total → empty
      (await registry.scopeDataPointIds(sharedScope, 2, 10)).should.deep.eq(
        [],
      );
      (await registry.scopeDataPointIds(sharedScope, 100, 10)).should.deep.eq(
        [],
      );
    });
  });

  // ====================== setStatus ======================

  describe("setStatus", () => {
    beforeEach(async () => {
      await deploy();
      await registry.connect(user1).addData(SCOPE, DATA_HASH, META_HASH);
    });

    it("should change status and update modifiedAt", async function () {
      const id = dpId(user1.address, SCOPE);
      await time.increase(50);

      const tx = await registry
        .connect(user1)
        .setStatus(SCOPE, Status.Unavailable);
      const receipt = await tx.wait();
      const blockTs = (await ethers.provider.getBlock(receipt!.blockNumber))!
        .timestamp;

      await expect(tx)
        .to.emit(registry, "DataPointStatusChanged")
        .withArgs(id, Status.Unavailable);

      const info = await registry.dataPoints(user1.address, SCOPE);
      info.status.should.eq(Status.Unavailable);
      info.modifiedAt.should.eq(BigInt(blockTs));
      (info.modifiedAt > info.createdAt).should.eq(true);
    });

    it("should be a silent no-op when the status is unchanged", async function () {
      // data point is already Active
      const modifiedBefore = (await registry.dataPoints(user1.address, SCOPE))
        .modifiedAt;
      await time.increase(100);

      const tx = await registry.connect(user1).setStatus(SCOPE, Status.Active);
      await expect(tx).to.not.emit(registry, "DataPointStatusChanged");

      const info = await registry.dataPoints(user1.address, SCOPE);
      info.status.should.eq(Status.Active);
      // A true no-op: modifiedAt must not be bumped on the early-return path.
      info.modifiedAt.should.eq(modifiedBefore);
    });

    it("should reject Status.None", async function () {
      await expect(
        registry.connect(user1).setStatus(SCOPE, Status.None),
      ).to.be.revertedWithCustomError(registry, "InvalidStatus");
    });

    it("should reject a nonexistent data point", async function () {
      const missingScope = "does.not.exist";
      await expect(
        registry.connect(user1).setStatus(missingScope, Status.Inactive),
      )
        .to.be.revertedWithCustomError(registry, "DataPointNotFound")
        .withArgs(dpId(user1.address, missingScope));
    });
  });

  // ====================== setDataPortabilityServers ======================

  describe("setDataPortabilityServers", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should set the servers registry and emit event", async function () {
      const serversAddress = await servers.getAddress();
      await expect(
        registry.connect(owner).setDataPortabilityServers(serversAddress),
      )
        .to.emit(registry, "DataPortabilityServersUpdated")
        .withArgs(ethers.ZeroAddress, serversAddress);
      (await registry.dataPortabilityServers()).should.eq(serversAddress);
    });

    it("should track the previous address on update", async function () {
      const serversAddress = await servers.getAddress();
      await registry.connect(owner).setDataPortabilityServers(serversAddress);
      await expect(
        registry.connect(owner).setDataPortabilityServers(other.address),
      )
        .to.emit(registry, "DataPortabilityServersUpdated")
        .withArgs(serversAddress, other.address);
    });

    it("should reject non-admin", async function () {
      await expect(
        registry
          .connect(user1)
          .setDataPortabilityServers(await servers.getAddress()),
      ).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should reject zero address", async function () {
      await expect(
        registry.connect(owner).setDataPortabilityServers(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });
  });

  // ====================== addDataWithSignature (owner-signed) ======================

  describe("addDataWithSignature - owner-signed", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should add data via relayer with owner signature", async function () {
      const id = dpId(user1.address, SCOPE);
      const signature = await signAddData(
        user1,
        user1.address,
        SCOPE,
        DATA_HASH,
        META_HASH,
        1n,
      );

      const tx = await registry
        .connect(relayer)
        .addDataWithSignature(
          user1.address,
          SCOPE,
          DATA_HASH,
          META_HASH,
          1n,
          signature,
        );

      await expect(tx)
        .to.emit(registry, "DataPointCreated")
        .withArgs(
          id,
          user1.address,
          ethers.keccak256(ethers.toUtf8Bytes(SCOPE)),
          SCOPE,
        );
      await expect(tx)
        .to.emit(registry, "DataVersionAdded")
        .withArgs(id, 1n, DATA_HASH, META_HASH, commitmentOf(DATA_HASH, META_HASH));
      // Owner self-signed → no delegate event.
      await expect(tx).to.not.emit(registry, "DataSignedByDelegate");

      const info = await registry.dataPoints(user1.address, SCOPE);
      info.owner.should.eq(user1.address);
      info.currentVersion.should.eq(1n);
    });

    it("should reject a wrong expectedVersion", async function () {
      const signature = await signAddData(
        user1,
        user1.address,
        SCOPE,
        DATA_HASH,
        META_HASH,
        5n,
      );
      await expect(
        registry
          .connect(relayer)
          .addDataWithSignature(
            user1.address,
            SCOPE,
            DATA_HASH,
            META_HASH,
            5n,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "UnexpectedVersion")
        .withArgs(1n, 5n);
    });

    it("should reject replay of the same signature", async function () {
      const signature = await signAddData(
        user1,
        user1.address,
        SCOPE,
        DATA_HASH,
        META_HASH,
        1n,
      );
      await registry
        .connect(relayer)
        .addDataWithSignature(
          user1.address,
          SCOPE,
          DATA_HASH,
          META_HASH,
          1n,
          signature,
        );

      await expect(
        registry
          .connect(relayer)
          .addDataWithSignature(
            user1.address,
            SCOPE,
            DATA_HASH,
            META_HASH,
            1n,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "UnexpectedVersion")
        .withArgs(2n, 1n);
    });

    it("should reject a signature from an unrelated key", async function () {
      const signature = await signAddData(
        other,
        user1.address,
        SCOPE,
        DATA_HASH,
        META_HASH,
        1n,
      );
      await expect(
        registry
          .connect(relayer)
          .addDataWithSignature(
            user1.address,
            SCOPE,
            DATA_HASH,
            META_HASH,
            1n,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "OwnerMismatch")
        .withArgs(user1.address, other.address);
    });
  });

  // ====================== addDataWithSignature (delegate) ======================

  describe("addDataWithSignature - delegate-signed", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should accept a signature from a server registered to the owner", async function () {
      await wireServers();
      await registerServer(user1, server1);

      const id = dpId(user1.address, SCOPE);
      const signature = await signAddData(
        server1,
        user1.address,
        SCOPE,
        DATA_HASH,
        META_HASH,
        1n,
      );

      const tx = await registry
        .connect(relayer)
        .addDataWithSignature(
          user1.address,
          SCOPE,
          DATA_HASH,
          META_HASH,
          1n,
          signature,
        );

      await expect(tx)
        .to.emit(registry, "DataSignedByDelegate")
        .withArgs(id, user1.address, server1.address);
      await expect(tx).to.emit(registry, "DataVersionAdded");

      const info = await registry.dataPoints(user1.address, SCOPE);
      info.owner.should.eq(user1.address);
      info.currentVersion.should.eq(1n);
    });

    it("should accept a delegate append on an existing data point (expectedVersion 2)", async function () {
      await wireServers();
      await registerServer(user1, server1);

      // Owner creates version 1 directly; the delegate then appends v2.
      await registry.connect(user1).addData(SCOPE, DATA_HASH, META_HASH);

      const id = dpId(user1.address, SCOPE);
      const signature = await signAddData(
        server1,
        user1.address,
        SCOPE,
        DATA_HASH_2,
        META_HASH_2,
        2n,
      );

      const tx = await registry
        .connect(relayer)
        .addDataWithSignature(
          user1.address,
          SCOPE,
          DATA_HASH_2,
          META_HASH_2,
          2n,
          signature,
        );

      await expect(tx)
        .to.emit(registry, "DataVersionAdded")
        .withArgs(
          id,
          2n,
          DATA_HASH_2,
          META_HASH_2,
          commitmentOf(DATA_HASH_2, META_HASH_2),
        );
      await expect(tx)
        .to.emit(registry, "DataSignedByDelegate")
        .withArgs(id, user1.address, server1.address);
      (await registry.currentVersion(user1.address, SCOPE)).should.eq(2n);
    });

    it("should reject a server registered to a different owner", async function () {
      await wireServers();
      await registerServer(user2, server1); // server1 belongs to user2

      const signature = await signAddData(
        server1,
        user1.address,
        SCOPE,
        DATA_HASH,
        META_HASH,
        1n,
      );
      await expect(
        registry
          .connect(relayer)
          .addDataWithSignature(
            user1.address,
            SCOPE,
            DATA_HASH,
            META_HASH,
            1n,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "OwnerMismatch")
        .withArgs(user1.address, server1.address);
    });

    it("should reject a server signature after deregistration", async function () {
      await wireServers();
      const serverId = await registerServer(user1, server1);
      await deregisterServer(user1, server1, serverId);

      const signature = await signAddData(
        server1,
        user1.address,
        SCOPE,
        DATA_HASH,
        META_HASH,
        1n,
      );
      await expect(
        registry
          .connect(relayer)
          .addDataWithSignature(
            user1.address,
            SCOPE,
            DATA_HASH,
            META_HASH,
            1n,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "OwnerMismatch")
        .withArgs(user1.address, server1.address);
    });

    it("should reject a server signature when servers registry is unset", async function () {
      // servers registry NOT wired on the data registry, but the server is
      // registered in ServersV2 — only owner-self-signed accepted.
      await registerServer(user1, server1);

      const signature = await signAddData(
        server1,
        user1.address,
        SCOPE,
        DATA_HASH,
        META_HASH,
        1n,
      );
      await expect(
        registry
          .connect(relayer)
          .addDataWithSignature(
            user1.address,
            SCOPE,
            DATA_HASH,
            META_HASH,
            1n,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "OwnerMismatch")
        .withArgs(user1.address, server1.address);
    });
  });

  // ====================== setStatusWithSignature ======================

  describe("setStatusWithSignature", () => {
    beforeEach(async () => {
      await deploy();
      await registry.connect(user1).addData(SCOPE, DATA_HASH, META_HASH);
    });

    it("should change status via relayer with owner signature", async function () {
      const id = dpId(user1.address, SCOPE);
      (await registry.statusSequence(user1.address, SCOPE)).should.eq(0n);

      const signature = await signSetStatus(
        user1,
        user1.address,
        SCOPE,
        Status.Inactive,
        1n,
      );
      const tx = await registry
        .connect(relayer)
        .setStatusWithSignature(
          user1.address,
          SCOPE,
          Status.Inactive,
          1n,
          signature,
        );

      await expect(tx)
        .to.emit(registry, "DataPointStatusChanged")
        .withArgs(id, Status.Inactive);
      await expect(tx).to.not.emit(registry, "StatusSignedByDelegate");

      (await registry.dataPoints(user1.address, SCOPE)).status.should.eq(
        Status.Inactive,
      );
      (await registry.statusSequence(user1.address, SCOPE)).should.eq(1n);
    });

    it("should reject a wrong expectedSequence", async function () {
      const signature = await signSetStatus(
        user1,
        user1.address,
        SCOPE,
        Status.Inactive,
        3n,
      );
      await expect(
        registry
          .connect(relayer)
          .setStatusWithSignature(
            user1.address,
            SCOPE,
            Status.Inactive,
            3n,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "UnexpectedVersion")
        .withArgs(1n, 3n);
    });

    it("should reject replay of the same signature", async function () {
      const signature = await signSetStatus(
        user1,
        user1.address,
        SCOPE,
        Status.Inactive,
        1n,
      );
      await registry
        .connect(relayer)
        .setStatusWithSignature(
          user1.address,
          SCOPE,
          Status.Inactive,
          1n,
          signature,
        );

      await expect(
        registry
          .connect(relayer)
          .setStatusWithSignature(
            user1.address,
            SCOPE,
            Status.Inactive,
            1n,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "UnexpectedVersion")
        .withArgs(2n, 1n);
    });

    it("should reject Status.None", async function () {
      const signature = await signSetStatus(
        user1,
        user1.address,
        SCOPE,
        Status.None,
        1n,
      );
      await expect(
        registry
          .connect(relayer)
          .setStatusWithSignature(
            user1.address,
            SCOPE,
            Status.None,
            1n,
            signature,
          ),
      ).to.be.revertedWithCustomError(registry, "InvalidStatus");
    });

    it("should reject an unknown data point", async function () {
      const missingScope = "does.not.exist";
      const signature = await signSetStatus(
        user1,
        user1.address,
        missingScope,
        Status.Inactive,
        1n,
      );
      await expect(
        registry
          .connect(relayer)
          .setStatusWithSignature(
            user1.address,
            missingScope,
            Status.Inactive,
            1n,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "DataPointNotFound")
        .withArgs(dpId(user1.address, missingScope));
    });

    it("should consume the sequence without emitting on a signed no-op", async function () {
      // Data point is Active; sign a change to Active with the correct next
      // sequence. Tx succeeds, sequence is consumed, but no status event.
      const signature = await signSetStatus(
        user1,
        user1.address,
        SCOPE,
        Status.Active,
        1n,
      );
      const tx = await registry
        .connect(relayer)
        .setStatusWithSignature(
          user1.address,
          SCOPE,
          Status.Active,
          1n,
          signature,
        );

      await expect(tx).to.not.emit(registry, "DataPointStatusChanged");
      (await registry.statusSequence(user1.address, SCOPE)).should.eq(1n);
      (await registry.dataPoints(user1.address, SCOPE)).status.should.eq(
        Status.Active,
      );

      // Replay of the consumed signature must fail.
      await expect(
        registry
          .connect(relayer)
          .setStatusWithSignature(
            user1.address,
            SCOPE,
            Status.Active,
            1n,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "UnexpectedVersion")
        .withArgs(2n, 1n);
    });

    it("should accept a delegate signature and emit StatusSignedByDelegate", async function () {
      await wireServers();
      await registerServer(user1, server1);

      const id = dpId(user1.address, SCOPE);
      const signature = await signSetStatus(
        server1,
        user1.address,
        SCOPE,
        Status.Unavailable,
        1n,
      );
      const tx = await registry
        .connect(relayer)
        .setStatusWithSignature(
          user1.address,
          SCOPE,
          Status.Unavailable,
          1n,
          signature,
        );

      await expect(tx)
        .to.emit(registry, "DataPointStatusChanged")
        .withArgs(id, Status.Unavailable);
      await expect(tx)
        .to.emit(registry, "StatusSignedByDelegate")
        .withArgs(id, user1.address, server1.address);
    });

    it("should emit StatusSignedByDelegate even on a delegate-signed no-op", async function () {
      // Status is already Active; the delegate signs Active again. No status
      // event, but the delegate attribution still fires and the sequence is
      // consumed (impl's dedicated no-op branch for delegates).
      await wireServers();
      await registerServer(user1, server1);

      const id = dpId(user1.address, SCOPE);
      const signature = await signSetStatus(
        server1,
        user1.address,
        SCOPE,
        Status.Active,
        1n,
      );
      const tx = await registry
        .connect(relayer)
        .setStatusWithSignature(
          user1.address,
          SCOPE,
          Status.Active,
          1n,
          signature,
        );

      await expect(tx).to.not.emit(registry, "DataPointStatusChanged");
      await expect(tx)
        .to.emit(registry, "StatusSignedByDelegate")
        .withArgs(id, user1.address, server1.address);
      (await registry.statusSequence(user1.address, SCOPE)).should.eq(1n);
    });

    it("should keep the status sequence independent of the data version", async function () {
      // Sign a status flip at sequence 1, then bump the data version — the
      // pending status signature must still be valid.
      const signature = await signSetStatus(
        user1,
        user1.address,
        SCOPE,
        Status.Inactive,
        1n,
      );

      await registry.connect(user1).addData(SCOPE, DATA_HASH_2, META_HASH_2);
      (await registry.currentVersion(user1.address, SCOPE)).should.eq(2n);

      await registry
        .connect(relayer)
        .setStatusWithSignature(
          user1.address,
          SCOPE,
          Status.Inactive,
          1n,
          signature,
        ).should.be.fulfilled;

      (await registry.dataPoints(user1.address, SCOPE)).status.should.eq(
        Status.Inactive,
      );
      (await registry.statusSequence(user1.address, SCOPE)).should.eq(1n);
    });

    it("should reject a signature from an unrelated key", async function () {
      const signature = await signSetStatus(
        user2,
        user1.address,
        SCOPE,
        Status.Inactive,
        1n,
      );
      await expect(
        registry
          .connect(relayer)
          .setStatusWithSignature(
            user1.address,
            SCOPE,
            Status.Inactive,
            1n,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "OwnerMismatch")
        .withArgs(user1.address, user2.address);
      (await registry.statusSequence(user1.address, SCOPE)).should.eq(0n);
    });

    it("should reject a delegate registered to a different owner", async function () {
      await wireServers();
      await registerServer(user2, server1); // server1 belongs to user2

      const signature = await signSetStatus(
        server1,
        user1.address,
        SCOPE,
        Status.Inactive,
        1n,
      );
      await expect(
        registry
          .connect(relayer)
          .setStatusWithSignature(
            user1.address,
            SCOPE,
            Status.Inactive,
            1n,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "OwnerMismatch")
        .withArgs(user1.address, server1.address);
    });

    it("should reject a delegate signature after deregistration", async function () {
      await wireServers();
      const serverId = await registerServer(user1, server1);
      await deregisterServer(user1, server1, serverId);

      const signature = await signSetStatus(
        server1,
        user1.address,
        SCOPE,
        Status.Inactive,
        1n,
      );
      await expect(
        registry
          .connect(relayer)
          .setStatusWithSignature(
            user1.address,
            SCOPE,
            Status.Inactive,
            1n,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "OwnerMismatch")
        .withArgs(user1.address, server1.address);
    });

    it("should reject a delegate signature when the servers registry is unset", async function () {
      // server1 is registered in ServersV2, but the registry contract has not
      // been wired to it — only owner-self-signed signatures are accepted.
      await registerServer(user1, server1);

      const signature = await signSetStatus(
        server1,
        user1.address,
        SCOPE,
        Status.Inactive,
        1n,
      );
      await expect(
        registry
          .connect(relayer)
          .setStatusWithSignature(
            user1.address,
            SCOPE,
            Status.Inactive,
            1n,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "OwnerMismatch")
        .withArgs(user1.address, server1.address);
    });

    it("should keep status sequences isolated per data point", async function () {
      const otherScope = "other.scope";
      await registry.connect(user2).addData(SCOPE, DATA_HASH, META_HASH);
      await registry.connect(user1).addData(otherScope, DATA_HASH, META_HASH);

      // Consume sequence 1 on (user1, SCOPE) only.
      const signature = await signSetStatus(
        user1,
        user1.address,
        SCOPE,
        Status.Inactive,
        1n,
      );
      await registry
        .connect(relayer)
        .setStatusWithSignature(
          user1.address,
          SCOPE,
          Status.Inactive,
          1n,
          signature,
        );

      (await registry.statusSequence(user1.address, SCOPE)).should.eq(1n);
      (await registry.statusSequence(user2.address, SCOPE)).should.eq(0n);
      (await registry.statusSequence(user1.address, otherScope)).should.eq(0n);

      // A sequence-1 signature for the other data points must still work.
      const signature2 = await signSetStatus(
        user2,
        user2.address,
        SCOPE,
        Status.Unavailable,
        1n,
      );
      await registry
        .connect(relayer)
        .setStatusWithSignature(
          user2.address,
          SCOPE,
          Status.Unavailable,
          1n,
          signature2,
        ).should.be.fulfilled;
      (await registry.dataPoints(user2.address, SCOPE)).status.should.eq(
        Status.Unavailable,
      );
      // The first data point is untouched by the second flip.
      (await registry.dataPoints(user1.address, SCOPE)).status.should.eq(
        Status.Inactive,
      );
    });
  });

  // ====================== recordDataAccess ======================

  describe("recordDataAccess", () => {
    const recordId1 = ethers.keccak256(ethers.toUtf8Bytes("record-1"));
    const recordId2 = ethers.keccak256(ethers.toUtf8Bytes("record-2"));
    const recordId3 = ethers.keccak256(ethers.toUtf8Bytes("record-3"));

    beforeEach(async () => {
      await deploy();
      await registry.connect(user1).addData(SCOPE, DATA_HASH, META_HASH);
      await registry
        .connect(owner)
        .grantRole(ACCESS_RECORDER_ROLE, recorder.address);
    });

    const setupTrustedServer = async () => {
      await wireServers();
      await registerServer(user1, server1);
    };

    it("should reject a caller without ACCESS_RECORDER_ROLE", async function () {
      await setupTrustedServer();
      const signature = await signRecordDataAccess(
        server1,
        user1.address,
        SCOPE,
        1n,
        other.address,
        recordId1,
      );
      await expect(
        registry
          .connect(user1)
          .recordDataAccess(
            user1.address,
            SCOPE,
            1n,
            other.address,
            recordId1,
            signature,
          ),
      ).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should reject when the servers registry is unset", async function () {
      // role granted, but no servers registry wired
      const signature = await signRecordDataAccess(
        server1,
        user1.address,
        SCOPE,
        1n,
        other.address,
        recordId1,
      );
      await expect(
        registry
          .connect(recorder)
          .recordDataAccess(
            user1.address,
            SCOPE,
            1n,
            other.address,
            recordId1,
            signature,
          ),
      ).to.be.revertedWithCustomError(registry, "DataPortabilityServersNotSet");
    });

    it("should record an access signed by a trusted server", async function () {
      await setupTrustedServer();
      const id = dpId(user1.address, SCOPE);
      const signature = await signRecordDataAccess(
        server1,
        user1.address,
        SCOPE,
        1n,
        other.address,
        recordId1,
      );

      (await registry.isRecordIdUsed(recordId1)).should.eq(false);

      await expect(
        registry
          .connect(recorder)
          .recordDataAccess(
            user1.address,
            SCOPE,
            1n,
            other.address,
            recordId1,
            signature,
          ),
      )
        .to.emit(registry, "DataAccessRecorded")
        .withArgs(id, 1n, other.address, server1.address, recordId1, 1n, 1n);

      (await registry.accessCount(user1.address, SCOPE, 1)).should.eq(1n);
      (await registry.totalAccesses(user1.address, SCOPE)).should.eq(1n);
      (await registry.dataPoints(user1.address, SCOPE)).totalAccesses.should.eq(
        1n,
      );
      (await registry.isRecordIdUsed(recordId1)).should.eq(true);
    });

    it("should reject a duplicate recordId", async function () {
      await setupTrustedServer();
      const signature = await signRecordDataAccess(
        server1,
        user1.address,
        SCOPE,
        1n,
        other.address,
        recordId1,
      );
      await registry
        .connect(recorder)
        .recordDataAccess(
          user1.address,
          SCOPE,
          1n,
          other.address,
          recordId1,
          signature,
        );

      await expect(
        registry
          .connect(recorder)
          .recordDataAccess(
            user1.address,
            SCOPE,
            1n,
            other.address,
            recordId1,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "RecordIdAlreadyUsed")
        .withArgs(recordId1);
    });

    it("should reject a reused recordId even with a different payload", async function () {
      // Single-use must key on the recordId itself, not the full digest — a
      // fresh signature over a different accessor with the same recordId
      // must still be rejected.
      await setupTrustedServer();
      const signature = await signRecordDataAccess(
        server1,
        user1.address,
        SCOPE,
        1n,
        other.address,
        recordId1,
      );
      await registry
        .connect(recorder)
        .recordDataAccess(
          user1.address,
          SCOPE,
          1n,
          other.address,
          recordId1,
          signature,
        );

      const differentPayloadSig = await signRecordDataAccess(
        server1,
        user1.address,
        SCOPE,
        1n,
        user2.address, // different accessor
        recordId1, // same recordId
      );
      await expect(
        registry
          .connect(recorder)
          .recordDataAccess(
            user1.address,
            SCOPE,
            1n,
            user2.address,
            recordId1,
            differentPayloadSig,
          ),
      )
        .to.be.revertedWithCustomError(registry, "RecordIdAlreadyUsed")
        .withArgs(recordId1);
    });

    it("should reject version 0 and versions above currentVersion", async function () {
      await setupTrustedServer();
      const id = dpId(user1.address, SCOPE);

      const sigV0 = await signRecordDataAccess(
        server1,
        user1.address,
        SCOPE,
        0n,
        other.address,
        recordId1,
      );
      await expect(
        registry
          .connect(recorder)
          .recordDataAccess(
            user1.address,
            SCOPE,
            0n,
            other.address,
            recordId1,
            sigV0,
          ),
      )
        .to.be.revertedWithCustomError(registry, "UnknownVersion")
        .withArgs(id, 0n);

      const sigV2 = await signRecordDataAccess(
        server1,
        user1.address,
        SCOPE,
        2n,
        other.address,
        recordId2,
      );
      await expect(
        registry
          .connect(recorder)
          .recordDataAccess(
            user1.address,
            SCOPE,
            2n,
            other.address,
            recordId2,
            sigV2,
          ),
      )
        .to.be.revertedWithCustomError(registry, "UnknownVersion")
        .withArgs(id, 2n);
    });

    it("should reject a signature from a non-trusted key", async function () {
      await setupTrustedServer();
      const signature = await signRecordDataAccess(
        server2, // not registered as anyone's server
        user1.address,
        SCOPE,
        1n,
        other.address,
        recordId1,
      );
      await expect(
        registry
          .connect(recorder)
          .recordDataAccess(
            user1.address,
            SCOPE,
            1n,
            other.address,
            recordId1,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "UntrustedServer")
        .withArgs(user1.address, server2.address);
    });

    it("should reject a server trusted by a different owner", async function () {
      await wireServers();
      await registerServer(user2, server1); // server1 belongs to user2

      const signature = await signRecordDataAccess(
        server1,
        user1.address,
        SCOPE,
        1n,
        other.address,
        recordId1,
      );
      await expect(
        registry
          .connect(recorder)
          .recordDataAccess(
            user1.address,
            SCOPE,
            1n,
            other.address,
            recordId1,
            signature,
          ),
      )
        .to.be.revertedWithCustomError(registry, "UntrustedServer")
        .withArgs(user1.address, server1.address);
    });

    it("should track per-version counters and the aggregate total", async function () {
      await setupTrustedServer();
      const id = dpId(user1.address, SCOPE);
      await registry.connect(user1).addData(SCOPE, DATA_HASH_2, META_HASH_2); // v2

      // record against v1
      const sig1 = await signRecordDataAccess(
        server1,
        user1.address,
        SCOPE,
        1n,
        other.address,
        recordId1,
      );
      await registry
        .connect(recorder)
        .recordDataAccess(
          user1.address,
          SCOPE,
          1n,
          other.address,
          recordId1,
          sig1,
        );

      // record twice against v2
      const sig2 = await signRecordDataAccess(
        server1,
        user1.address,
        SCOPE,
        2n,
        other.address,
        recordId2,
      );
      await registry
        .connect(recorder)
        .recordDataAccess(
          user1.address,
          SCOPE,
          2n,
          other.address,
          recordId2,
          sig2,
        );

      const sig3 = await signRecordDataAccess(
        server1,
        user1.address,
        SCOPE,
        2n,
        user2.address,
        recordId3,
      );
      await expect(
        registry
          .connect(recorder)
          .recordDataAccess(
            user1.address,
            SCOPE,
            2n,
            user2.address,
            recordId3,
            sig3,
          ),
      )
        .to.emit(registry, "DataAccessRecorded")
        .withArgs(id, 2n, user2.address, server1.address, recordId3, 2n, 3n);

      (await registry.accessCount(user1.address, SCOPE, 1)).should.eq(1n);
      (await registry.accessCount(user1.address, SCOPE, 2)).should.eq(2n);
      (await registry.totalAccesses(user1.address, SCOPE)).should.eq(3n);
    });
  });

  // ====================== Pause ======================

  describe("Pause", () => {
    beforeEach(async () => {
      await deploy();
      await registry.connect(user1).addData(SCOPE, DATA_HASH, META_HASH);
      await registry
        .connect(owner)
        .grantRole(ACCESS_RECORDER_ROLE, recorder.address);
    });

    it("should only allow admin to pause and unpause", async function () {
      await expect(
        registry.connect(user1).pause(),
      ).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );

      await registry.connect(owner).pause();
      (await registry.paused()).should.eq(true);

      await expect(
        registry.connect(user1).unpause(),
      ).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );

      await registry.connect(owner).unpause();
      (await registry.paused()).should.eq(false);
    });

    it("should gate all write entrypoints while paused and restore on unpause", async function () {
      const addDataSig = await signAddData(
        user1,
        user1.address,
        SCOPE,
        DATA_HASH_2,
        META_HASH_2,
        2n,
      );
      const setStatusSig = await signSetStatus(
        user1,
        user1.address,
        SCOPE,
        Status.Inactive,
        1n,
      );
      const recordSig = await signRecordDataAccess(
        server1,
        user1.address,
        SCOPE,
        1n,
        other.address,
        ethers.keccak256(ethers.toUtf8Bytes("paused-record")),
      );

      await registry.connect(owner).pause();

      await expect(
        registry.connect(user1).addData(SCOPE, DATA_HASH_2, META_HASH_2),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");

      await expect(
        registry.connect(user1).setStatus(SCOPE, Status.Inactive),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");

      await expect(
        registry
          .connect(relayer)
          .addDataWithSignature(
            user1.address,
            SCOPE,
            DATA_HASH_2,
            META_HASH_2,
            2n,
            addDataSig,
          ),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");

      await expect(
        registry
          .connect(relayer)
          .setStatusWithSignature(
            user1.address,
            SCOPE,
            Status.Inactive,
            1n,
            setStatusSig,
          ),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");

      await expect(
        registry
          .connect(recorder)
          .recordDataAccess(
            user1.address,
            SCOPE,
            1n,
            other.address,
            ethers.keccak256(ethers.toUtf8Bytes("paused-record")),
            recordSig,
          ),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");

      // Unpause restores writes.
      await registry.connect(owner).unpause();
      await registry.connect(user1).addData(SCOPE, DATA_HASH_2, META_HASH_2)
        .should.be.fulfilled;
      (await registry.currentVersion(user1.address, SCOPE)).should.eq(2n);
    });
  });

  // ====================== Upgrade authorization ======================

  describe("Upgrade authorization", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should reject upgradeToAndCall from non-admin", async function () {
      const newImpl = await (
        await ethers.getContractFactory("DataRegistryV2Implementation")
      ).deploy();
      await newImpl.waitForDeployment();

      await expect(
        registry
          .connect(user1)
          .upgradeToAndCall(await newImpl.getAddress(), "0x"),
      ).to.be.revertedWithCustomError(
        registry,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should allow admin to upgrade and preserve data state", async function () {
      // Populate real state first so the upgrade proves storage survival,
      // not just that the call didn't revert.
      await registry.connect(user1).addData(SCOPE, DATA_HASH, META_HASH);
      await registry.connect(user1).addData(SCOPE, DATA_HASH_2, META_HASH_2);
      await registry.connect(user1).setStatus(SCOPE, Status.Inactive);

      const newImpl = await (
        await ethers.getContractFactory("DataRegistryV2Implementation")
      ).deploy();
      await newImpl.waitForDeployment();

      await registry
        .connect(owner)
        .upgradeToAndCall(await newImpl.getAddress(), "0x").should.be
        .fulfilled;

      (await registry.version()).should.eq(1);
      const info = await registry.dataPoints(user1.address, SCOPE);
      info.currentVersion.should.eq(2n);
      info.status.should.eq(Status.Inactive);
      info.currentCommitment.should.eq(commitmentOf(DATA_HASH_2, META_HASH_2));
      (await registry.dataCommitment(user1.address, SCOPE, 1)).should.eq(
        commitmentOf(DATA_HASH, META_HASH),
      );
      (await registry.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).should.eq(
        true,
      );
    });
  });
});
