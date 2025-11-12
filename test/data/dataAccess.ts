// test/data/dataAccess.ts
import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther } from "../../utils/helpers";
import {
  DatasetRegistryImplementation,
  ProtocolConfigImplementation,
  AttestationPolicyImplementation,
  AccessSettlementImplementation,
  VanaRuntimePermissionsImplementation,
  VanaRuntimeServersImplementation,
  DLPRegistryV1Implementation,
} from "../../typechain-types";

chai.use(chaiAsPromised);
should();

describe("DataAccessV1", () => {
  // Signers
  let owner: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let securityCouncil: HardhatEthersSigner;
  let datasetOwner: HardhatEthersSigner;
  let dlpOwner: HardhatEthersSigner;
  let runtimeOwner: HardhatEthersSigner;
  let dataBuyer: HardhatEthersSigner;
  let contributor: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  // Contract instances
  let datasetRegistry: DatasetRegistryImplementation;
  let protocolConfig: ProtocolConfigImplementation;
  let attestationPolicy: AttestationPolicyImplementation;
  let accessSettlement: AccessSettlementImplementation;
  let vanaRuntimePermissions: VanaRuntimePermissionsImplementation;
  let vanaRuntimeServers: VanaRuntimeServersImplementation;
  let dlpRegistry: DLPRegistryV1Implementation;

  // Constants
  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const DATASET_MANAGER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("DATASET_MANAGER_ROLE"),
  );
  const FILE_MANAGER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("FILE_MANAGER_ROLE"),
  );
  const PROTOCOL_GOVERNANCE_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("PROTOCOL_GOVERNANCE_ROLE"),
  );
  const SECURITY_COUNCIL_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("SECURITY_COUNCIL_ROLE"),
  );
  const VANA_RUNTIME_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("VANA_RUNTIME_ROLE"),
  );
  const PERMISSION_MANAGER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("PERMISSION_MANAGER_ROLE"),
  );
  const RUNTIME_REGISTRAR_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("RUNTIME_REGISTRAR_ROLE"),
  );
  const DLP_REGISTRAR_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("DLP_REGISTRAR_ROLE"),
  );

  const INITIAL_PGE_PUBLIC_KEY = "0x1234567890abcdef";
  const TEST_SCHEMA_ID = 1;
  const TEST_FILE_ID_1 = 100;
  const TEST_FILE_ID_2 = 200;
  const TEST_FILE_ID_3 = 300;

  async function deployContracts() {
    [
      owner,
      admin,
      securityCouncil,
      datasetOwner,
      dlpOwner,
      runtimeOwner,
      dataBuyer,
      contributor,
      user1,
      user2,
    ] = await ethers.getSigners();

    // Deploy ProtocolConfig
    const ProtocolConfig = await ethers.getContractFactory(
      "ProtocolConfigImplementation",
    );
    protocolConfig = (await upgrades.deployProxy(
      ProtocolConfig,
      [admin.address, INITIAL_PGE_PUBLIC_KEY, ethers.ZeroAddress, []],
      { kind: "uups" },
    )) as unknown as ProtocolConfigImplementation;
    await protocolConfig.waitForDeployment();

    // Deploy AttestationPolicy
    const AttestationPolicy = await ethers.getContractFactory(
      "AttestationPolicyImplementation",
    );
    attestationPolicy = (await upgrades.deployProxy(
      AttestationPolicy,
      [admin.address, securityCouncil.address],
      { kind: "uups" },
    )) as unknown as AttestationPolicyImplementation;
    await attestationPolicy.waitForDeployment();

    // Update ProtocolConfig with AttestationPolicy
    await protocolConfig
      .connect(admin)
      .updateAttestationPolicy(attestationPolicy.target);

    // Deploy DatasetRegistry
    const DatasetRegistry = await ethers.getContractFactory(
      "DatasetRegistryImplementation",
    );
    datasetRegistry = (await upgrades.deployProxy(
      DatasetRegistry,
      [admin.address],
      { kind: "uups" },
    )) as unknown as DatasetRegistryImplementation;
    await datasetRegistry.waitForDeployment();

    // Deploy VanaRuntimeServers
    const VanaRuntimeServers = await ethers.getContractFactory(
      "VanaRuntimeServersImplementation",
    );
    vanaRuntimeServers = (await upgrades.deployProxy(
      VanaRuntimeServers,
      [admin.address],
      { kind: "uups" },
    )) as unknown as VanaRuntimeServersImplementation;
    await vanaRuntimeServers.waitForDeployment();

    // Deploy VanaRuntimePermissions
    const VanaRuntimePermissions = await ethers.getContractFactory(
      "VanaRuntimePermissionsImplementation",
    );
    vanaRuntimePermissions = (await upgrades.deployProxy(
      VanaRuntimePermissions,
      [admin.address, datasetRegistry.target],
      { kind: "uups" },
    )) as unknown as VanaRuntimePermissionsImplementation;
    await vanaRuntimePermissions.waitForDeployment();

    // Deploy AccessSettlement
    const AccessSettlement = await ethers.getContractFactory(
      "AccessSettlementImplementation",
    );
    accessSettlement = (await upgrades.deployProxy(
      AccessSettlement,
      [admin.address],
      { kind: "uups" },
    )) as unknown as AccessSettlementImplementation;
    await accessSettlement.waitForDeployment();

    // Deploy DLPRegistryV1
    const DLPRegistry = await ethers.getContractFactory(
      "DLPRegistryV1Implementation",
    );
    const dlpRegistryProxy = await upgrades.deployProxy(DLPRegistry, [admin.address], {
      kind: "uups",
    });
    await dlpRegistryProxy.waitForDeployment();

    // Get the contract at the proxy address with the correct ABI
    dlpRegistry = await ethers.getContractAt(
      "DLPRegistryV1Implementation",
      await dlpRegistryProxy.getAddress()
    ) as unknown as DLPRegistryV1Implementation;
  }

  describe("DatasetRegistry", () => {
    beforeEach(async () => {
      await deployContracts();
    });

    it("should deploy successfully", async () => {
      (await datasetRegistry.getAddress()).should.not.equal(ethers.ZeroAddress);
    });

    it("should create a new dataset", async () => {
      await datasetRegistry
        .connect(admin)
        .createDataset(datasetOwner.address, TEST_SCHEMA_ID);

      const dataset = await datasetRegistry.getDataset(1);
      dataset.owner.should.equal(datasetOwner.address);
      dataset.schemaId.should.equal(TEST_SCHEMA_ID);
    });

    it("should add pending file to dataset", async () => {
      await datasetRegistry
        .connect(admin)
        .createDataset(datasetOwner.address, TEST_SCHEMA_ID);

      await datasetRegistry
        .connect(admin)
        .addPendingFile(1, TEST_FILE_ID_1);

      const pendingFiles = await datasetRegistry.getPendingFiles(1);
      pendingFiles.length.should.equal(1);
      pendingFiles[0].should.equal(BigInt(TEST_FILE_ID_1));
    });

    it("should accept pending file", async () => {
      await datasetRegistry
        .connect(admin)
        .createDataset(datasetOwner.address, TEST_SCHEMA_ID);

      await datasetRegistry
        .connect(admin)
        .addPendingFile(1, TEST_FILE_ID_1);

      await datasetRegistry.connect(datasetOwner).acceptFile(1, TEST_FILE_ID_1);

      const files = await datasetRegistry.getDatasetFiles(1);
      const pendingFiles = await datasetRegistry.getPendingFiles(1);

      files.length.should.equal(1);
      files[0].should.equal(BigInt(TEST_FILE_ID_1));
      pendingFiles.length.should.equal(0);
    });

    it("should reject pending file", async () => {
      await datasetRegistry
        .connect(admin)
        .createDataset(datasetOwner.address, TEST_SCHEMA_ID);

      await datasetRegistry
        .connect(admin)
        .addPendingFile(1, TEST_FILE_ID_1);

      await datasetRegistry.connect(datasetOwner).rejectFile(1, TEST_FILE_ID_1);

      const files = await datasetRegistry.getDatasetFiles(1);
      const pendingFiles = await datasetRegistry.getPendingFiles(1);

      files.length.should.equal(0);
      pendingFiles.length.should.equal(0);
    });

    it("should transfer dataset ownership", async () => {
      await datasetRegistry
        .connect(admin)
        .createDataset(datasetOwner.address, TEST_SCHEMA_ID);

      await datasetRegistry
        .connect(datasetOwner)
        .transferDatasetOwnership(1, user1.address);

      const dataset = await datasetRegistry.getDataset(1);
      dataset.owner.should.equal(user1.address);
    });

    it("should revert when non-owner tries to accept file", async () => {
      await datasetRegistry
        .connect(admin)
        .createDataset(datasetOwner.address, TEST_SCHEMA_ID);

      await datasetRegistry
        .connect(admin)
        .addPendingFile(1, TEST_FILE_ID_1);

      await datasetRegistry
        .connect(user1)
        .acceptFile(1, TEST_FILE_ID_1)
        .should.be.rejectedWith("Not authorized");
    });

    it("should revert when adding duplicate pending file", async () => {
      await datasetRegistry
        .connect(admin)
        .createDataset(datasetOwner.address, TEST_SCHEMA_ID);

      await datasetRegistry
        .connect(admin)
        .addPendingFile(1, TEST_FILE_ID_1);

      await datasetRegistry
        .connect(admin)
        .addPendingFile(1, TEST_FILE_ID_1)
        .should.be.rejectedWith("File already pending");
    });

    it("should emit events correctly", async () => {
      const tx = await datasetRegistry
        .connect(admin)
        .createDataset(datasetOwner.address, TEST_SCHEMA_ID);

      await tx.should.emit(datasetRegistry, "DatasetCreated");
    });
  });

  describe("ProtocolConfig", () => {
    beforeEach(async () => {
      await deployContracts();
    });

    it("should deploy with initial configuration", async () => {
      const pgeKey = await protocolConfig.getPGEPublicKey();
      pgeKey.should.equal(INITIAL_PGE_PUBLIC_KEY);

      const attestationPolicyAddr = await protocolConfig.getAttestationPolicy();
      attestationPolicyAddr.should.equal(attestationPolicy.target);
    });

    it("should update PGE public key", async () => {
      const newKey = "0xabcdef1234567890";

      await protocolConfig.connect(admin).updatePGEPublicKey(newKey);

      const updatedKey = await protocolConfig.getPGEPublicKey();
      updatedKey.should.equal(newKey);
    });

    it("should update attestation policy", async () => {
      const newAddress = user1.address;

      await protocolConfig.connect(admin).updateAttestationPolicy(newAddress);

      const updatedAddress = await protocolConfig.getAttestationPolicy();
      updatedAddress.should.equal(newAddress);
    });

    it("should update PGE recovery committee", async () => {
      const newCommittee = [user1.address, user2.address];

      await protocolConfig
        .connect(admin)
        .updatePGERecoveryCommittee(newCommittee);

      const committeeAddresses =
        await protocolConfig.getPGERecoveryCommitteeAddresses();
      committeeAddresses.length.should.equal(2);
      committeeAddresses[0].should.equal(user1.address);
      committeeAddresses[1].should.equal(user2.address);
    });

    it("should revert when non-governance tries to update", async () => {
      await protocolConfig
        .connect(user1)
        .updatePGEPublicKey("0x1234")
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${PROTOCOL_GOVERNANCE_ROLE}")`,
        );
    });

    it("should revert on invalid PGE key", async () => {
      await protocolConfig
        .connect(admin)
        .updatePGEPublicKey("0x")
        .should.be.rejectedWith("Invalid public key");
    });
  });

  describe("AttestationPolicy", () => {
    beforeEach(async () => {
      await deployContracts();
    });

    it("should trust a TEE pool", async () => {
      await attestationPolicy
        .connect(securityCouncil)
        .trustTeePool(user1.address);

      const isTrusted = await attestationPolicy.isTeePoolTrusted(user1.address);
      isTrusted.should.be.true;
    });

    it("should untrust a TEE pool", async () => {
      await attestationPolicy
        .connect(securityCouncil)
        .trustTeePool(user1.address);

      await attestationPolicy
        .connect(securityCouncil)
        .untrustTeePool(user1.address);

      const isTrusted = await attestationPolicy.isTeePoolTrusted(user1.address);
      isTrusted.should.be.false;
    });

    it("should trust a Vana Runtime image", async () => {
      const imageVersion = "vana-runtime:v1.0.0";

      await attestationPolicy
        .connect(securityCouncil)
        .trustVanaRuntimeImage(imageVersion);

      const isTrusted =
        await attestationPolicy.isVanaRuntimeImageTrusted(imageVersion);
      isTrusted.should.be.true;
    });

    it("should untrust a Vana Runtime image", async () => {
      const imageVersion = "vana-runtime:v1.0.0";

      await attestationPolicy
        .connect(securityCouncil)
        .trustVanaRuntimeImage(imageVersion);

      await attestationPolicy
        .connect(securityCouncil)
        .untrustVanaRuntimeImage(imageVersion);

      const isTrusted =
        await attestationPolicy.isVanaRuntimeImageTrusted(imageVersion);
      isTrusted.should.be.false;
    });

    it("should get trusted TEE pools", async () => {
      await attestationPolicy
        .connect(securityCouncil)
        .trustTeePool(user1.address);
      await attestationPolicy
        .connect(securityCouncil)
        .trustTeePool(user2.address);

      const trustedPools = await attestationPolicy.getTrustedTeePools();
      trustedPools.length.should.equal(2);
    });

    it("should revert when non-security-council tries to trust", async () => {
      await attestationPolicy
        .connect(user1)
        .trustTeePool(user2.address)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${SECURITY_COUNCIL_ROLE}")`,
        );
    });
  });

  describe("AccessSettlement", () => {
    beforeEach(async () => {
      await deployContracts();
      // Grant VANA_RUNTIME_ROLE to runtimeOwner for testing
      await accessSettlement
        .connect(admin)
        .grantRole(VANA_RUNTIME_ROLE, runtimeOwner.address);
    });

    it("should log an operation", async () => {
      const operationId = ethers.toUtf8Bytes("operation-123");
      const price = parseEther(1);

      await accessSettlement
        .connect(runtimeOwner)
        .logOperation(operationId, dataBuyer.address, price, ethers.ZeroAddress);

      const invoice = await accessSettlement.getOperationInvoice(operationId);
      invoice.issuer.should.equal(runtimeOwner.address);
      invoice.grantee.should.equal(dataBuyer.address);
      invoice.price.should.equal(price);
      invoice.isSettled.should.be.false;
    });

    it("should settle payment with native VANA", async () => {
      const operationId = ethers.toUtf8Bytes("operation-456");
      const price = parseEther(1);

      await accessSettlement
        .connect(runtimeOwner)
        .logOperation(operationId, dataBuyer.address, price, ethers.ZeroAddress);

      await accessSettlement
        .connect(dataBuyer)
        .settlePaymentWithNative(operationId, { value: price });

      const invoice = await accessSettlement.getOperationInvoice(operationId);
      invoice.isSettled.should.be.true;
    });

    it("should revert on incorrect payment amount", async () => {
      const operationId = ethers.toUtf8Bytes("operation-789");
      const price = parseEther(1);

      await accessSettlement
        .connect(runtimeOwner)
        .logOperation(operationId, dataBuyer.address, price, ethers.ZeroAddress);

      await accessSettlement
        .connect(dataBuyer)
        .settlePaymentWithNative(operationId, { value: parseEther(0.5) })
        .should.be.rejectedWith("Incorrect payment amount");
    });

    it("should revert when non-runtime logs operation", async () => {
      const operationId = ethers.toUtf8Bytes("operation-999");
      const price = parseEther(1);

      await accessSettlement
        .connect(user1)
        .logOperation(operationId, dataBuyer.address, price, ethers.ZeroAddress)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${VANA_RUNTIME_ROLE}")`,
        );
    });

    it("should emit PaymentSettled event", async () => {
      const operationId = ethers.toUtf8Bytes("operation-event");
      const price = parseEther(1);

      await accessSettlement
        .connect(runtimeOwner)
        .logOperation(operationId, dataBuyer.address, price, ethers.ZeroAddress);

      const tx = await accessSettlement
        .connect(dataBuyer)
        .settlePaymentWithNative(operationId, { value: price });

      await tx.should.emit(accessSettlement, "PaymentSettled");
    });
  });

  describe("VanaRuntimePermissions", () => {
    beforeEach(async () => {
      await deployContracts();
      // Create a dataset first
      await datasetRegistry
        .connect(admin)
        .createDataset(datasetOwner.address, TEST_SCHEMA_ID);
    });

    it("should create a permission", async () => {
      const granteeId = 1;
      const grant = "ipfs://Qm...";
      const startBlock = (await ethers.provider.getBlockNumber()) + 1;
      const endBlock = startBlock + 1000;

      await vanaRuntimePermissions
        .connect(datasetOwner)
        .createPermission(1, granteeId, grant, startBlock, endBlock);

      const permission = await vanaRuntimePermissions.getPermission(1);
      permission.datasetId.should.equal(1);
      permission.granteeId.should.equal(BigInt(granteeId));
      permission.grant.should.equal(grant);
    });

    it("should check if permission is active", async () => {
      const granteeId = 1;
      const grant = "ipfs://Qm...";
      const startBlock = (await ethers.provider.getBlockNumber()) + 1;
      const endBlock = startBlock + 1000;

      await vanaRuntimePermissions
        .connect(datasetOwner)
        .createPermission(1, granteeId, grant, startBlock, endBlock);

      // Mine a block to get past start block
      await ethers.provider.send("evm_mine", []);

      const isActive = await vanaRuntimePermissions.isPermissionActive(1);
      isActive.should.be.true;
    });

    it("should revoke a permission", async () => {
      const granteeId = 1;
      const grant = "ipfs://Qm...";
      const startBlock = (await ethers.provider.getBlockNumber()) + 1;
      const endBlock = startBlock + 1000;

      await vanaRuntimePermissions
        .connect(datasetOwner)
        .createPermission(1, granteeId, grant, startBlock, endBlock);

      await vanaRuntimePermissions.connect(datasetOwner).revokePermission(1);

      const permission = await vanaRuntimePermissions.getPermission(1);
      const currentBlock = await ethers.provider.getBlockNumber();
      permission.endBlock.should.equal(BigInt(currentBlock));
    });

    it("should update permission grant", async () => {
      const granteeId = 1;
      const grant = "ipfs://Qm...";
      const startBlock = (await ethers.provider.getBlockNumber()) + 1;
      const endBlock = startBlock + 1000;

      await vanaRuntimePermissions
        .connect(datasetOwner)
        .createPermission(1, granteeId, grant, startBlock, endBlock);

      const newGrant = "ipfs://Qm...updated";
      await vanaRuntimePermissions
        .connect(datasetOwner)
        .updatePermission(1, newGrant);

      const permission = await vanaRuntimePermissions.getPermission(1);
      permission.grant.should.equal(newGrant);
      permission.nonce.should.equal(1);
    });

    it("should revert when non-owner creates permission", async () => {
      const granteeId = 1;
      const grant = "ipfs://Qm...";
      const startBlock = (await ethers.provider.getBlockNumber()) + 1;
      const endBlock = startBlock + 1000;

      await vanaRuntimePermissions
        .connect(user1)
        .createPermission(1, granteeId, grant, startBlock, endBlock)
        .should.be.rejectedWith("Not authorized");
    });
  });

  describe("VanaRuntimeServers", () => {
    beforeEach(async () => {
      await deployContracts();
    });

    it("should register a runtime server", async () => {
      const runtimeAddress = ethers.Wallet.createRandom().address;
      const publicKey = "0x1234567890abcdef";
      const escrowedPrivateKey = "0xabcdef1234567890";
      const url = "https://runtime.vana.com/123";

      await vanaRuntimeServers
        .connect(runtimeOwner)
        .registerServer(
          runtimeOwner.address,
          runtimeAddress,
          publicKey,
          escrowedPrivateKey,
          url,
        );

      const server = await vanaRuntimeServers.getServerByAddress(
        runtimeAddress,
      );
      server.owner.should.equal(runtimeOwner.address);
      server.runtimeAddress.should.equal(runtimeAddress);
      server.url.should.equal(url);
      server.isActive.should.be.true;
    });

    it("should deactivate a runtime server", async () => {
      const runtimeAddress = ethers.Wallet.createRandom().address;
      const publicKey = "0x1234567890abcdef";
      const escrowedPrivateKey = "0xabcdef1234567890";
      const url = "https://runtime.vana.com/123";

      await vanaRuntimeServers
        .connect(runtimeOwner)
        .registerServer(
          runtimeOwner.address,
          runtimeAddress,
          publicKey,
          escrowedPrivateKey,
          url,
        );

      await vanaRuntimeServers.connect(runtimeOwner).deactivateServer(1);

      const server = await vanaRuntimeServers.getServer(1);
      server.isActive.should.be.false;
    });

    it("should reactivate a runtime server", async () => {
      const runtimeAddress = ethers.Wallet.createRandom().address;
      const publicKey = "0x1234567890abcdef";
      const escrowedPrivateKey = "0xabcdef1234567890";
      const url = "https://runtime.vana.com/123";

      await vanaRuntimeServers
        .connect(runtimeOwner)
        .registerServer(
          runtimeOwner.address,
          runtimeAddress,
          publicKey,
          escrowedPrivateKey,
          url,
        );

      await vanaRuntimeServers.connect(runtimeOwner).deactivateServer(1);
      await vanaRuntimeServers.connect(runtimeOwner).reactivateServer(1);

      const server = await vanaRuntimeServers.getServer(1);
      server.isActive.should.be.true;
    });

    it("should update server URL", async () => {
      const runtimeAddress = ethers.Wallet.createRandom().address;
      const publicKey = "0x1234567890abcdef";
      const escrowedPrivateKey = "0xabcdef1234567890";
      const url = "https://runtime.vana.com/123";

      await vanaRuntimeServers
        .connect(runtimeOwner)
        .registerServer(
          runtimeOwner.address,
          runtimeAddress,
          publicKey,
          escrowedPrivateKey,
          url,
        );

      const newUrl = "https://runtime.vana.com/456";
      await vanaRuntimeServers.connect(runtimeOwner).updateServerUrl(1, newUrl);

      const server = await vanaRuntimeServers.getServer(1);
      server.url.should.equal(newUrl);
    });

    it("should get servers by owner", async () => {
      const runtimeAddress1 = ethers.Wallet.createRandom().address;
      const runtimeAddress2 = ethers.Wallet.createRandom().address;
      const publicKey = "0x1234567890abcdef";
      const escrowedPrivateKey = "0xabcdef1234567890";

      await vanaRuntimeServers
        .connect(runtimeOwner)
        .registerServer(
          runtimeOwner.address,
          runtimeAddress1,
          publicKey,
          escrowedPrivateKey,
          "https://runtime1.vana.com",
        );

      await vanaRuntimeServers
        .connect(runtimeOwner)
        .registerServer(
          runtimeOwner.address,
          runtimeAddress2,
          publicKey,
          escrowedPrivateKey,
          "https://runtime2.vana.com",
        );

      const servers =
        await vanaRuntimeServers.getServersByOwner(runtimeOwner.address);
      servers.length.should.equal(2);
    });

    it("should revert when registering duplicate runtime", async () => {
      const runtimeAddress = ethers.Wallet.createRandom().address;
      const publicKey = "0x1234567890abcdef";
      const escrowedPrivateKey = "0xabcdef1234567890";
      const url = "https://runtime.vana.com/123";

      await vanaRuntimeServers
        .connect(runtimeOwner)
        .registerServer(
          runtimeOwner.address,
          runtimeAddress,
          publicKey,
          escrowedPrivateKey,
          url,
        );

      await vanaRuntimeServers
        .connect(runtimeOwner)
        .registerServer(
          runtimeOwner.address,
          runtimeAddress,
          publicKey,
          escrowedPrivateKey,
          url,
        )
        .should.be.rejectedWith("Runtime already registered");
    });
  });

  describe("DLPRegistryV1", () => {
    let vanaEpoch: any;
    let treasury: any;

    beforeEach(async () => {
      await deployContracts();

      // Create a dataset for DLP linking
      await datasetRegistry
        .connect(admin)
        .createDataset(datasetOwner.address, TEST_SCHEMA_ID);

      // Deploy MockVanaEpoch (lightweight mock for testing)
      const MockVanaEpoch = await ethers.getContractFactory("MockVanaEpoch");
      vanaEpoch = await MockVanaEpoch.deploy();
      await vanaEpoch.waitForDeployment();

      // Deploy Treasury
      const Treasury = await ethers.getContractFactory("TreasuryImplementation");
      treasury = await upgrades.deployProxy(
        Treasury,
        [admin.address, admin.address], // ownerAddress, initCustodian
        { kind: "uups" }
      );
      await treasury.waitForDeployment();

      // Configure DLP Registry
      await dlpRegistry.connect(admin).updateVanaEpoch(await vanaEpoch.getAddress());
      await dlpRegistry.connect(admin).updateTreasury(await treasury.getAddress());
      await dlpRegistry.connect(admin).updateDlpRegistrationDepositAmount(parseEther(1));
    });

    it("should register a DLP", async () => {
      const dlpAddress = ethers.Wallet.createRandom().address;
      const registrationInfo = {
        dlpAddress: dlpAddress,
        ownerAddress: dlpOwner.address,
        treasuryAddress: dlpOwner.address,
        name: "Test DLP",
        iconUrl: "https://icon.url",
        website: "https://website.url",
        metadata: "{}",
      };

      await dlpRegistry
        .connect(dlpOwner)
        .registerDlp(registrationInfo, { value: parseEther(1) });

      const dlp = await dlpRegistry.dlps(1);
      dlp.dlpAddress.should.equal(dlpAddress);
      dlp.ownerAddress.should.equal(dlpOwner.address);
      dlp.name.should.equal("Test DLP");

      // Check dataset separately (datasetId not in DlpInfo struct)
      const datasetId = await dlpRegistry.getDlpDataset(1);
      datasetId.should.equal(0); // Initially 0
    });

    it("should link DLP to dataset", async () => {
      const dlpAddress = ethers.Wallet.createRandom().address;
      const registrationInfo = {
        dlpAddress: dlpAddress,
        ownerAddress: dlpOwner.address,
        treasuryAddress: dlpOwner.address,
        name: "Test DLP",
        iconUrl: "https://icon.url",
        website: "https://website.url",
        metadata: "{}",
      };

      await dlpRegistry
        .connect(dlpOwner)
        .registerDlp(registrationInfo, { value: parseEther(1) });

      // Link to dataset
      await dlpRegistry.connect(dlpOwner).updateDlpDataset(1, 1);

      const datasetId = await dlpRegistry.getDlpDataset(1);
      datasetId.should.equal(1);

      // Verify DLP info is correct
      const dlp = await dlpRegistry.dlps(1);
      dlp.dlpAddress.should.not.equal(ethers.ZeroAddress);
    });

    it("should update DLP dataset", async () => {
      const dlpAddress = ethers.Wallet.createRandom().address;
      const registrationInfo = {
        dlpAddress: dlpAddress,
        ownerAddress: dlpOwner.address,
        treasuryAddress: dlpOwner.address,
        name: "Test DLP",
        iconUrl: "https://icon.url",
        website: "https://website.url",
        metadata: "{}",
      };

      await dlpRegistry
        .connect(dlpOwner)
        .registerDlp(registrationInfo, { value: parseEther(1) });

      await dlpRegistry.connect(dlpOwner).updateDlpDataset(1, 1);

      const datasetId = await dlpRegistry.getDlpDataset(1);
      datasetId.should.equal(1);
    });

    it("should remove DLP dataset link", async () => {
      const dlpAddress = ethers.Wallet.createRandom().address;
      const registrationInfo = {
        dlpAddress: dlpAddress,
        ownerAddress: dlpOwner.address,
        treasuryAddress: dlpOwner.address,
        name: "Test DLP",
        iconUrl: "https://icon.url",
        website: "https://website.url",
        metadata: "{}",
      };

      await dlpRegistry
        .connect(dlpOwner)
        .registerDlp(registrationInfo, { value: parseEther(1) });

      await dlpRegistry.connect(dlpOwner).updateDlpDataset(1, 1);

      // Remove link by setting to 0
      await dlpRegistry.connect(dlpOwner).updateDlpDataset(1, 0);

      const datasetId = await dlpRegistry.getDlpDataset(1);
      datasetId.should.equal(0);
    });

    it("should revert when non-owner tries to update dataset", async () => {
      const dlpAddress = ethers.Wallet.createRandom().address;
      const registrationInfo = {
        dlpAddress: dlpAddress,
        ownerAddress: dlpOwner.address,
        treasuryAddress: dlpOwner.address,
        name: "Test DLP",
        iconUrl: "https://icon.url",
        website: "https://website.url",
        metadata: "{}",
      };

      await dlpRegistry
        .connect(dlpOwner)
        .registerDlp(registrationInfo, { value: parseEther(1) });

      await dlpRegistry
        .connect(user1)
        .updateDlpDataset(1, 1)
        .should.be.rejected;
    });

    it("should deregister a DLP", async () => {
      const dlpAddress = ethers.Wallet.createRandom().address;
      const registrationInfo = {
        dlpAddress: dlpAddress,
        ownerAddress: dlpOwner.address,
        treasuryAddress: dlpOwner.address,
        name: "Test DLP",
        iconUrl: "https://icon.url",
        website: "https://website.url",
        metadata: "{}",
      };

      await dlpRegistry
        .connect(dlpOwner)
        .registerDlp(registrationInfo, { value: parseEther(1) });

      await dlpRegistry.connect(dlpOwner).deregisterDlp(1);

      const dlp = await dlpRegistry.dlps(1);
      dlp.status.should.equal(3); // Deregistered status
    });

    it("should revert when registering duplicate DLP address", async () => {
      const dlpAddress = ethers.Wallet.createRandom().address;
      const registrationInfo = {
        dlpAddress: dlpAddress,
        ownerAddress: dlpOwner.address,
        treasuryAddress: dlpOwner.address,
        name: "Test DLP",
        iconUrl: "https://icon.url",
        website: "https://website.url",
        metadata: "{}",
      };

      await dlpRegistry
        .connect(dlpOwner)
        .registerDlp(registrationInfo, { value: parseEther(1) });

      await dlpRegistry
        .connect(dlpOwner)
        .registerDlp(registrationInfo, { value: parseEther(1) })
        .should.be.rejected;
    });
  });

  describe("Integration: Complete Data Access Flow", () => {
    let datasetId: number;
    let permissionId: number;
    let runtimeAddress: string;
    let vanaEpoch: any;
    let treasury: any;

    beforeEach(async () => {
      await deployContracts();

      // Deploy MockVanaEpoch (lightweight mock for testing)
      const MockVanaEpoch = await ethers.getContractFactory("MockVanaEpoch");
      vanaEpoch = await MockVanaEpoch.deploy();
      await vanaEpoch.waitForDeployment();

      const Treasury = await ethers.getContractFactory("TreasuryImplementation");
      treasury = await upgrades.deployProxy(
        Treasury,
        [admin.address, admin.address], // ownerAddress, initCustodian
        { kind: "uups" }
      );
      await treasury.waitForDeployment();

      await dlpRegistry.connect(admin).updateVanaEpoch(await vanaEpoch.getAddress());
      await dlpRegistry.connect(admin).updateTreasury(await treasury.getAddress());
      await dlpRegistry.connect(admin).updateDlpRegistrationDepositAmount(parseEther(1));

      // 1. Create dataset
      await datasetRegistry
        .connect(admin)
        .createDataset(datasetOwner.address, TEST_SCHEMA_ID);
      datasetId = 1;

      // 2. Register DLP
      const dlpAddress = ethers.Wallet.createRandom().address;
      const registrationInfo = {
        dlpAddress: dlpAddress,
        ownerAddress: dlpOwner.address,
        treasuryAddress: dlpOwner.address,
        name: "Integration DLP",
        iconUrl: "https://icon.url",
        website: "https://website.url",
        metadata: "{}",
      };

      await dlpRegistry
        .connect(dlpOwner)
        .registerDlp(registrationInfo, { value: parseEther(1) });

      // Link DLP to dataset
      await dlpRegistry.connect(dlpOwner).updateDlpDataset(1, datasetId);

      // 3. Register runtime server
      runtimeAddress = ethers.Wallet.createRandom().address;
      await vanaRuntimeServers
        .connect(runtimeOwner)
        .registerServer(
          runtimeOwner.address,
          runtimeAddress,
          "0x1234567890abcdef",
          "0xabcdef1234567890",
          "https://runtime.vana.com/integration",
        );

      // 4. Grant VANA_RUNTIME_ROLE to runtime
      await accessSettlement
        .connect(admin)
        .grantRole(VANA_RUNTIME_ROLE, runtimeOwner.address);
    });

    it("should complete full data contribution flow", async () => {
      // Add files to pending
      await datasetRegistry
        .connect(admin)
        .addPendingFile(datasetId, TEST_FILE_ID_1);
      await datasetRegistry
        .connect(admin)
        .addPendingFile(datasetId, TEST_FILE_ID_2);

      // Accept files (simulating proof-of-contribution)
      await datasetRegistry
        .connect(datasetOwner)
        .acceptFile(datasetId, TEST_FILE_ID_1);
      await datasetRegistry
        .connect(datasetOwner)
        .acceptFile(datasetId, TEST_FILE_ID_2);

      // Verify files are in dataset
      const files = await datasetRegistry.getDatasetFiles(datasetId);
      files.length.should.equal(2);

      // Verify pending is empty
      const pendingFiles = await datasetRegistry.getPendingFiles(datasetId);
      pendingFiles.length.should.equal(0);
    });

    it("should complete full data access and payment flow", async () => {
      // 1. Dataset owner creates permission for data buyer
      const granteeId = 1;
      const grant = "ipfs://Qm.../barbarika-permission.json";
      const startBlock = (await ethers.provider.getBlockNumber()) + 1;
      const endBlock = startBlock + 10000;

      await vanaRuntimePermissions
        .connect(datasetOwner)
        .createPermission(datasetId, granteeId, grant, startBlock, endBlock);
      permissionId = 1;

      // Mine a block
      await ethers.provider.send("evm_mine", []);

      // 2. Verify permission is active
      const isActive =
        await vanaRuntimePermissions.isPermissionActive(permissionId);
      isActive.should.be.true;

      // 3. Runtime processes operation and logs invoice
      const operationId = ethers.toUtf8Bytes("barbarika-train-001");
      const price = parseEther(5);

      await accessSettlement
        .connect(runtimeOwner)
        .logOperation(operationId, dataBuyer.address, price, ethers.ZeroAddress);

      // 4. Verify invoice is created
      const invoice = await accessSettlement.getOperationInvoice(operationId);
      invoice.price.should.equal(price);
      invoice.isSettled.should.be.false;

      // 5. Data buyer settles payment
      await accessSettlement
        .connect(dataBuyer)
        .settlePaymentWithNative(operationId, { value: price });

      // 6. Verify payment is settled
      const settledInvoice =
        await accessSettlement.getOperationInvoice(operationId);
      settledInvoice.isSettled.should.be.true;
    });

    it("should handle Barbarika demo scenario", async () => {
      // Scenario: Thinker DLP with dataset, Linguistics Researcher buys access

      // 1. Add files to dataset (contributions)
      await datasetRegistry
        .connect(admin)
        .addPendingFile(datasetId, TEST_FILE_ID_1);
      await datasetRegistry
        .connect(datasetOwner)
        .acceptFile(datasetId, TEST_FILE_ID_1);

      // 2. Create permission for linguistics researcher
      const granteeId = 1; // Linguistics researcher ID
      const grant = JSON.stringify({
        grantee: dataBuyer.address,
        task: "thinker/task:v1",
        operation: "analyze",
        pricing: {
          price_per_file_vana: 0.5,
        },
        parameters: {
          num_samples: "5000",
        },
      });

      const startBlock = await ethers.provider.getBlockNumber();
      const endBlock = startBlock + 10000;

      await vanaRuntimePermissions
        .connect(datasetOwner)
        .createPermission(datasetId, granteeId, grant, startBlock, endBlock);

      // 3. Runtime executes operation
      const operationId = ethers.toUtf8Bytes("thinker-analyze-001");
      const price = parseEther(0.5);

      await accessSettlement
        .connect(runtimeOwner)
        .logOperation(operationId, dataBuyer.address, price, ethers.ZeroAddress);

      // 4. Researcher pays for access
      await accessSettlement
        .connect(dataBuyer)
        .settlePaymentWithNative(operationId, { value: price });

      // 5. Verify complete flow
      const settledInvoice =
        await accessSettlement.getOperationInvoice(operationId);
      settledInvoice.isSettled.should.be.true;

      const files = await datasetRegistry.getDatasetFiles(datasetId);
      files.length.should.equal(1);
    });
  });

  describe("Upgradeability", () => {
    beforeEach(async () => {
      await deployContracts();
    });

    it("should upgrade DatasetRegistry", async () => {
      // Create a dataset before upgrade to verify state persistence
      await datasetRegistry
        .connect(admin)
        .createDataset(datasetOwner.address, TEST_SCHEMA_ID);

      const datasetBeforeUpgrade = await datasetRegistry.getDataset(1);
      datasetBeforeUpgrade.owner.should.equal(datasetOwner.address);

      // Upgrade the contract
      const DatasetRegistryV2 = await ethers.getContractFactory(
        "DatasetRegistryImplementation",
        admin,
      );

      await upgrades.upgradeProxy(
        await datasetRegistry.getAddress(),
        DatasetRegistryV2,
      );

      // Verify state was preserved after upgrade
      const datasetAfterUpgrade = await datasetRegistry.getDataset(1);
      datasetAfterUpgrade.owner.should.equal(datasetOwner.address);

      // Verify contract still works after upgrade - create another dataset
      await datasetRegistry
        .connect(admin)
        .createDataset(user1.address, TEST_SCHEMA_ID);

      const newDataset = await datasetRegistry.getDataset(2);
      newDataset.owner.should.equal(user1.address);
    });

    it("should revert upgrade by non-admin", async () => {
      const DatasetRegistryV2 = await ethers.getContractFactory(
        "DatasetRegistryImplementation",
        user1, // Non-admin signer
      );

      await upgrades
        .upgradeProxy(await datasetRegistry.getAddress(), DatasetRegistryV2)
        .should.be.rejected;
    });
  });
});