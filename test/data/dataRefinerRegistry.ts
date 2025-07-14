import chai, { expect, should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import {
  DataRefinerRegistryImplementation,
  DLPRegistryMock,
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

chai.use(chaiAsPromised);
should();

describe("DataRefinerRegistry", () => {
  let owner: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let dlp1Owner: HardhatEthersSigner;
  let dlp2Owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  let dataRefinerRegistry: DataRefinerRegistryImplementation;
  let DLPRegistryMock: DLPRegistryMock;

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );

  const deploy = async () => {
    [owner, maintainer, dlp1Owner, dlp2Owner, user1, user2] =
      await ethers.getSigners();

    const DLPRegistryMockFactory =
      await ethers.getContractFactory("DLPRegistryMock");
    DLPRegistryMock = await DLPRegistryMockFactory.deploy();

    await DLPRegistryMock.connect(dlp1Owner).registerDlp();

    const dataRefinerRegistryDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DataRefinerRegistryImplementation"),
      [owner.address, DLPRegistryMock.target],
      {
        kind: "uups",
      },
    );

    dataRefinerRegistry = await ethers.getContractAt(
      "DataRefinerRegistryImplementation",
      dataRefinerRegistryDeploy.target,
    );

    await dataRefinerRegistry
      .connect(owner)
      .grantRole(MAINTAINER_ROLE, maintainer.address);
  };

  describe("Setup", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should have correct params after deploy", async function () {
      (await dataRefinerRegistry.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(
        true,
      );
      (await dataRefinerRegistry.hasRole(MAINTAINER_ROLE, owner)).should.eq(
        true,
      );
      (
        await dataRefinerRegistry.hasRole(MAINTAINER_ROLE, maintainer)
      ).should.eq(true);
      (await dataRefinerRegistry.version()).should.eq(1);
      (await dataRefinerRegistry.dlpRegistry()).should.eq(DLPRegistryMock);
    });

    it("should grant or revoke roles when admin", async function () {
      await dataRefinerRegistry
        .connect(owner)
        .grantRole(MAINTAINER_ROLE, user1.address).should.not.be.rejected;
      (await dataRefinerRegistry.hasRole(MAINTAINER_ROLE, user1)).should.eq(
        true,
      );
      (await dataRefinerRegistry.hasRole(DEFAULT_ADMIN_ROLE, user1)).should.eq(
        false,
      );
      (await dataRefinerRegistry.hasRole(MAINTAINER_ROLE, user2)).should.eq(
        false,
      );

      await dataRefinerRegistry
        .connect(user1)
        .grantRole(DEFAULT_ADMIN_ROLE, user1.address)
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}`,
        );

      await dataRefinerRegistry
        .connect(owner)
        .grantRole(DEFAULT_ADMIN_ROLE, user1.address).should.be.fulfilled;
      (await dataRefinerRegistry.hasRole(DEFAULT_ADMIN_ROLE, user1)).should.eq(
        true,
      );

      await dataRefinerRegistry
        .connect(user1)
        .revokeRole(DEFAULT_ADMIN_ROLE, owner.address).should.be.fulfilled;
      (await dataRefinerRegistry.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(
        false,
      );

      await dataRefinerRegistry
        .connect(owner)
        .grantRole(DEFAULT_ADMIN_ROLE, user2.address)
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${owner.address}", "${DEFAULT_ADMIN_ROLE}`,
        );

      await dataRefinerRegistry
        .connect(user1)
        .grantRole(DEFAULT_ADMIN_ROLE, user2.address).should.be.fulfilled;
      (await dataRefinerRegistry.hasRole(DEFAULT_ADMIN_ROLE, user2)).should.eq(
        true,
      );
    });
  });

  describe("proxy", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should initialize only once", async function () {
      await dataRefinerRegistry
        .connect(owner)
        .initialize(user1.address, user1.address)
        .should.be.rejectedWith("InvalidInitialization");
    });

    it("should reject upgradeTo when not owner", async function () {
      const newImpl = await ethers.deployContract(
        "DataRefinerRegistryImplementationV0Mock",
      );

      await dataRefinerRegistry
        .connect(user1)
        .upgradeToAndCall(newImpl, "0x")
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
        );
    });

    it("should upgradeTo when owner and emit event", async function () {
      const newImpl = await ethers.deployContract(
        "DataRefinerRegistryImplementationV0Mock",
      );

      await expect(
        dataRefinerRegistry
          .connect(owner)
          .upgradeToAndCall(newImpl, "0x")
      ).to.emit(dataRefinerRegistry, "Upgraded")
        .withArgs(newImpl);

      const newRoot = await ethers.getContractAt(
        "DataRefinerRegistryImplementationV0Mock",
        dataRefinerRegistry,
      );

      (await newRoot.version()).should.eq(0);

      (await newRoot.test()).should.eq("test");
    });

    it("should reject upgradeTo when storage layout is incompatible", async function () {
      await upgrades
        .upgradeProxy(
          dataRefinerRegistry,
          await ethers.getContractFactory(
            "DataRefinerRegistryImplementationIncompatibleMock",
            owner,
          ),
        )
        .should.be.rejectedWith("New storage layout is incompatible");
    });

    it("should pause and unpause only when maintainer", async function () {
      await dataRefinerRegistry.connect(maintainer).pause().should.be.fulfilled;
      (await dataRefinerRegistry.paused()).should.eq(true);

      await dataRefinerRegistry.connect(maintainer).unpause().should.be
        .fulfilled;
      (await dataRefinerRegistry.paused()).should.eq(false);

      await dataRefinerRegistry
        .connect(user1)
        .pause()
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );

      await dataRefinerRegistry
        .connect(user1)
        .unpause()
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });

    it("should updateDlpRegistry only when maintainer", async function () {
      const newImpl = await ethers.deployContract("DLPRootCoreImplementation");

      await dataRefinerRegistry
        .connect(maintainer)
        .updateDlpRegistry(newImpl.target).should.be.fulfilled;
      (await dataRefinerRegistry.dlpRegistry()).should.eq(newImpl.target);

      const newImpl1 = await ethers.deployContract("DLPRootCoreImplementation");
      newImpl1.should.not.eq(newImpl);

      await dataRefinerRegistry
        .connect(owner)
        .updateDlpRegistry(newImpl1.target).should.be.fulfilled;
      (await dataRefinerRegistry.dlpRegistry()).should.eq(newImpl1.target);

      await dataRefinerRegistry
        .connect(user1)
        .updateDlpRegistry(newImpl.target)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });
  });

  describe("Schema Management", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should add schema successfully", async function () {
      const tx = await dataRefinerRegistry
        .connect(user1)
        .addSchema("TestSchema", "JSON", "https://example.com/schema.json");

      await expect(tx).to.emit(dataRefinerRegistry, "SchemaAdded")
        .withArgs(1, "TestSchema", "JSON", "https://example.com/schema.json");

      (await dataRefinerRegistry.schemasCount()).should.eq(1);

      const schema = await dataRefinerRegistry.schemas(1);
      schema.name.should.eq("TestSchema");
      schema.typ.should.eq("JSON");
      schema.definitionUrl.should.eq("https://example.com/schema.json");
    });

    it("should add multiple schemas", async function () {
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("Schema1", "JSON", "https://example.com/schema1.json");

      await dataRefinerRegistry
        .connect(user2)
        .addSchema("Schema2", "AVRO", "https://example.com/schema2.avro");

      (await dataRefinerRegistry.schemasCount()).should.eq(2);

      const schema1 = await dataRefinerRegistry.schemas(1);
      schema1.name.should.eq("Schema1");
      schema1.typ.should.eq("JSON");

      const schema2 = await dataRefinerRegistry.schemas(2);
      schema2.name.should.eq("Schema2");
      schema2.typ.should.eq("AVRO");
    });

    it("should revert when querying invalid schema ID", async function () {
      await expect(
        dataRefinerRegistry.schemas(0)
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "InvalidSchemaId")
        .withArgs(0);

      await expect(
        dataRefinerRegistry.schemas(1)
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "InvalidSchemaId")
        .withArgs(1);

      // Add one schema
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("Schema1", "JSON", "https://example.com/schema1.json");

      // Should work for schema ID 1
      await dataRefinerRegistry.schemas(1).should.not.be.rejected;

      // Should fail for schema ID 2
      await expect(
        dataRefinerRegistry.schemas(2)
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "InvalidSchemaId")
        .withArgs(2);
    });

    it("should not add schema when paused", async function () {
      await dataRefinerRegistry.connect(maintainer).pause();

      await expect(
        dataRefinerRegistry
          .connect(user1)
          .addSchema("Schema1", "JSON", "https://example.com/schema1.json")
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "EnforcedPause");

      await dataRefinerRegistry.connect(maintainer).unpause();

      await dataRefinerRegistry
        .connect(user1)
        .addSchema("Schema1", "JSON", "https://example.com/schema1.json")
        .should.not.be.rejected;
    });
  });

  describe("addRefiner and addRefinerWithSchemaId", () => {
    let schemaId1: bigint;
    let schemaId2: bigint;

    beforeEach(async () => {
      await deploy();
      
      // Add schemas before testing refiners
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("DataSchema1", "JSON", "https://example.com/schema1.json");
      schemaId1 = 1n;

      await dataRefinerRegistry
        .connect(user1)
        .addSchema("DataSchema2", "AVRO", "https://example.com/schema2.avro");
      schemaId2 = 2n;
    });

    it("should addRefiner (backward compatible) only when DLP owner", async function () {
      (await dataRefinerRegistry.dlpRegistry()).should.eq(DLPRegistryMock);
      (await DLPRegistryMock.dlps(1)).ownerAddress.should.eq(dlp1Owner.address);

      // Test addRefiner with direct schema URL (backward compatible)
      const tx = await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "refiner1", "https://custom.com/schema1.json", "instruction1");

      await expect(tx).to.emit(dataRefinerRegistry, "RefinerAdded")
        .withArgs(1, 1, "refiner1", 0, "https://custom.com/schema1.json", "instruction1");

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "refiner2", "https://custom.com/schema2.avro", "instruction2");

      const refiner1 = await dataRefinerRegistry.refiners(1);
      refiner1.dlpId.should.eq(1);
      refiner1.owner.should.eq(dlp1Owner.address);
      refiner1.name.should.eq("refiner1");
      refiner1.schemaDefinitionUrl.should.eq("https://custom.com/schema1.json");
      refiner1.refinementInstructionUrl.should.eq("instruction1");

      const refiner2 = await dataRefinerRegistry.refiners(2);
      refiner2.dlpId.should.eq(1);
      refiner2.owner.should.eq(dlp1Owner.address);
      refiner2.name.should.eq("refiner2");
      refiner2.schemaDefinitionUrl.should.eq("https://custom.com/schema2.avro");
      refiner2.refinementInstructionUrl.should.eq("instruction2");

      await expect(
        dataRefinerRegistry
          .connect(dlp2Owner)
          .addRefiner(1, "refiner3", "https://custom.com/schema3.json", "instruction3")
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "NotDlpOwner");
    });

    it("should addRefinerWithSchemaId with valid schema ID only when DLP owner", async function () {
      const tx = await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "refiner1", schemaId1, "instruction1");

      await expect(tx).to.emit(dataRefinerRegistry, "RefinerAdded")
        .withArgs(1, 1, "refiner1", schemaId1, "https://example.com/schema1.json", "instruction1");

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "refiner2", schemaId2, "instruction2");

      const refiner1 = await dataRefinerRegistry.refiners(1);
      refiner1.dlpId.should.eq(1);
      refiner1.owner.should.eq(dlp1Owner.address);
      refiner1.name.should.eq("refiner1");
      refiner1.schemaDefinitionUrl.should.eq("https://example.com/schema1.json");
      refiner1.refinementInstructionUrl.should.eq("instruction1");

      const refiner2 = await dataRefinerRegistry.refiners(2);
      refiner2.dlpId.should.eq(1);
      refiner2.owner.should.eq(dlp1Owner.address);
      refiner2.name.should.eq("refiner2");
      refiner2.schemaDefinitionUrl.should.eq("https://example.com/schema2.avro");
      refiner2.refinementInstructionUrl.should.eq("instruction2");

      await expect(
        dataRefinerRegistry
          .connect(dlp2Owner)
          .addRefinerWithSchemaId(1, "refiner3", schemaId1, "instruction3")
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "NotDlpOwner");
    });

    it("should reject addRefinerWithSchemaId with invalid schema ID", async function () {
      // Try with schema ID 0
      await expect(
        dataRefinerRegistry
          .connect(dlp1Owner)
          .addRefinerWithSchemaId(1, "refiner1", 0, "instruction1")
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "InvalidSchemaId")
        .withArgs(0);

      // Try with schema ID that doesn't exist yet
      await expect(
        dataRefinerRegistry
          .connect(dlp1Owner)
          .addRefinerWithSchemaId(1, "refiner1", 3, "instruction1")
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "InvalidSchemaId")
        .withArgs(3);
    });

    it("should updateSchemaId for existing refiner", async function () {
      // Add a refiner with schema 1
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "refiner1", schemaId1, "instruction1");

      // Verify initial schema
      let refiner = await dataRefinerRegistry.refiners(1);
      refiner.schemaDefinitionUrl.should.eq("https://example.com/schema1.json");

      // Update to schema 2
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .updateSchemaId(1, schemaId2);

      // Verify updated schema
      refiner = await dataRefinerRegistry.refiners(1);
      refiner.schemaDefinitionUrl.should.eq("https://example.com/schema2.avro");
    });

    it("should reject updateSchemaId with invalid schema ID", async function () {
      // Add a refiner
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "refiner1", schemaId1, "instruction1");

      // Try to update with invalid schema ID
      await expect(
        dataRefinerRegistry
          .connect(dlp1Owner)
          .updateSchemaId(1, 0)
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "InvalidSchemaId")
        .withArgs(0);

      await expect(
        dataRefinerRegistry
          .connect(dlp1Owner)
          .updateSchemaId(1, 999)
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "InvalidSchemaId")
        .withArgs(999);
    });

    it("should reject updateSchemaId when not DLP owner", async function () {
      // Add a refiner
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "refiner1", schemaId1, "instruction1");

      // Try to update as non-owner
      await expect(
        dataRefinerRegistry
          .connect(dlp2Owner)
          .updateSchemaId(1, schemaId2)
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "NotDlpOwner");
    });

    it("should not addRefiner when paused", async function () {
      await dataRefinerRegistry.connect(maintainer).pause().should.be.fulfilled;

      await expect(
        dataRefinerRegistry
          .connect(dlp1Owner)
          .addRefiner(1, "refiner1", "https://custom.com/schema.json", "instruction1")
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "EnforcedPause");

      await dataRefinerRegistry.connect(maintainer).unpause().should.be
        .fulfilled;

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "refiner1", "https://custom.com/schema.json", "instruction1")
        .should.be.fulfilled;
    });

    it("should not addRefinerWithSchemaId when paused", async function () {
      await dataRefinerRegistry.connect(maintainer).pause().should.be.fulfilled;

      await expect(
        dataRefinerRegistry
          .connect(dlp1Owner)
          .addRefinerWithSchemaId(1, "refiner1", schemaId1, "instruction1")
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "EnforcedPause");

      await dataRefinerRegistry.connect(maintainer).unpause().should.be
        .fulfilled;

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "refiner1", schemaId1, "instruction1")
        .should.be.fulfilled;
    });

    it("should not updateSchemaId when paused", async function () {
      // Add refiner first
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "refiner1", schemaId1, "instruction1");

      await dataRefinerRegistry.connect(maintainer).pause();

      await expect(
        dataRefinerRegistry
          .connect(dlp1Owner)
          .updateSchemaId(1, schemaId2)
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "EnforcedPause");

      await dataRefinerRegistry.connect(maintainer).unpause();

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .updateSchemaId(1, schemaId2)
        .should.not.be.rejected;
    });
  });

  describe("Additional addRefinerWithSchemaId Tests", () => {
    let schemaId1: bigint;
    let schemaId2: bigint;
    let schemaId3: bigint;

    beforeEach(async () => {
      await deploy();
      
      // Add multiple schemas for testing
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("UserProfileSchema", "JSON", "https://example.com/user-profile.json");
      schemaId1 = 1n;

      await dataRefinerRegistry
        .connect(user1)
        .addSchema("TransactionSchema", "AVRO", "https://example.com/transaction.avro");
      schemaId2 = 2n;

      await dataRefinerRegistry
        .connect(user1)
        .addSchema("EventLogSchema", "PROTOBUF", "https://example.com/event-log.proto");
      schemaId3 = 3n;
    });

    it("should create multiple refiners with different schemas for same DLP", async function () {
      // Add three refiners using different schemas
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "UserProfileRefiner", schemaId1, "https://refinement.com/user-profile");

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "TransactionRefiner", schemaId2, "https://refinement.com/transaction");

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "EventLogRefiner", schemaId3, "https://refinement.com/event-log");

      // Verify all refiners were created correctly
      const refiner1 = await dataRefinerRegistry.refiners(1);
      refiner1.name.should.eq("UserProfileRefiner");
      refiner1.schemaDefinitionUrl.should.eq("https://example.com/user-profile.json");

      const refiner2 = await dataRefinerRegistry.refiners(2);
      refiner2.name.should.eq("TransactionRefiner");
      refiner2.schemaDefinitionUrl.should.eq("https://example.com/transaction.avro");

      const refiner3 = await dataRefinerRegistry.refiners(3);
      refiner3.name.should.eq("EventLogRefiner");
      refiner3.schemaDefinitionUrl.should.eq("https://example.com/event-log.proto");

      // Check DLP refiners list
      const dlpRefiners = await dataRefinerRegistry.dlpRefiners(1);
      dlpRefiners.should.deep.eq([1n, 2n, 3n]);
    });

    it("should allow different DLPs to use same schema", async function () {
      // Register DLP2
      await DLPRegistryMock.connect(dlp2Owner).registerDlp();

      // Both DLPs create refiners with the same schema
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "DLP1-UserRefiner", schemaId1, "https://dlp1.com/refiner");

      await dataRefinerRegistry
        .connect(dlp2Owner)
        .addRefinerWithSchemaId(2, "DLP2-UserRefiner", schemaId1, "https://dlp2.com/refiner");

      // Verify both refiners use the same schema
      const refiner1 = await dataRefinerRegistry.refiners(1);
      const refiner2 = await dataRefinerRegistry.refiners(2);
      
      refiner1.schemaDefinitionUrl.should.eq(refiner2.schemaDefinitionUrl);
      refiner1.schemaDefinitionUrl.should.eq("https://example.com/user-profile.json");
      
      // But have different owners and refinement URLs
      refiner1.owner.should.eq(dlp1Owner.address);
      refiner2.owner.should.eq(dlp2Owner.address);
      refiner1.refinementInstructionUrl.should.not.eq(refiner2.refinementInstructionUrl);
    });

    it("should emit correct RefinerAdded event with schema details", async function () {
      const tx = await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "EventRefiner", schemaId3, "https://refinement.com/events");

      await expect(tx).to.emit(dataRefinerRegistry, "RefinerAdded")
        .withArgs(
          1, // refinerId
          1, // dlpId
          "EventRefiner", // name
          schemaId3, // schemaId
          "https://example.com/event-log.proto", // schemaDefinitionUrl from schema registry
          "https://refinement.com/events" // refinementInstructionUrl
        );
    });

    it("should handle edge case of maximum uint256 schema ID", async function () {
      // This should fail because schema ID is out of range
      const maxUint256 = ethers.MaxUint256;
      
      await expect(
        dataRefinerRegistry
          .connect(dlp1Owner)
          .addRefinerWithSchemaId(1, "MaxRefiner", maxUint256, "https://max.com/refiner")
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "InvalidSchemaId")
        .withArgs(maxUint256);
    });

    it("should correctly update refiner counts and IDs", async function () {
      // Initial count should be 0
      (await dataRefinerRegistry.refinersCount()).should.eq(0);

      // Add first refiner
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "Refiner1", schemaId1, "https://refiner1.com");
      (await dataRefinerRegistry.refinersCount()).should.eq(1);

      // Add second refiner  
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "Refiner2", schemaId2, "https://refiner2.com");
      (await dataRefinerRegistry.refinersCount()).should.eq(2);

      // Verify refiner IDs are sequential
      const refiner1 = await dataRefinerRegistry.refiners(1);
      const refiner2 = await dataRefinerRegistry.refiners(2);
      refiner1.name.should.eq("Refiner1");
      refiner2.name.should.eq("Refiner2");
    });
  });

  describe("Mixed addRefiner and addRefinerWithSchemaId Usage", () => {
    beforeEach(async () => {
      await deploy();
      
      // Add a schema for testing
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("MixedSchema", "JSON", "https://example.com/mixed.json");
    });

    it("should allow mixing addRefiner and addRefinerWithSchemaId for same DLP", async function () {
      // Add refiner with direct URL (backward compatible)
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "DirectURLRefiner", "https://direct.com/schema.json", "https://direct.com/refiner");

      // Add refiner with schema ID
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "SchemaIDRefiner", 1, "https://schema.com/refiner");

      // Verify both refiners exist
      const refiner1 = await dataRefinerRegistry.refiners(1);
      const refiner2 = await dataRefinerRegistry.refiners(2);

      refiner1.name.should.eq("DirectURLRefiner");
      refiner1.schemaDefinitionUrl.should.eq("https://direct.com/schema.json");

      refiner2.name.should.eq("SchemaIDRefiner");
      refiner2.schemaDefinitionUrl.should.eq("https://example.com/mixed.json");

      // Both should belong to same DLP
      refiner1.dlpId.should.eq(1);
      refiner2.dlpId.should.eq(1);

      const dlpRefiners = await dataRefinerRegistry.dlpRefiners(1);
      dlpRefiners.should.deep.eq([1n, 2n]);
    });

    it("should handle updateSchemaId for refiners created with addRefiner", async function () {
      // Create refiner with direct URL
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "DirectRefiner", "https://old.com/schema.json", "https://refiner.com");

      // Should be able to update to use a schema ID
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .updateSchemaId(1, 1);

      // Verify schema was updated
      const refiner = await dataRefinerRegistry.refiners(1);
      refiner.schemaDefinitionUrl.should.eq("https://example.com/mixed.json");
    });
  });

  describe("DLP Refiners", () => {
    beforeEach(async () => {
      await deploy();
      
      // Add schemas
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("Schema1", "JSON", "https://example.com/schema1.json");
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("Schema2", "AVRO", "https://example.com/schema2.avro");
    });

    it("should return correct dlpRefiners", async function () {
      // Initially empty
      (await dataRefinerRegistry.dlpRefiners(1)).should.deep.eq([]);

      // Add refiners
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "refiner1", 1, "instruction1");

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "refiner2", 2, "instruction2");

      // Should return both refiner IDs
      const refiners = await dataRefinerRegistry.dlpRefiners(1);
      refiners.should.deep.eq([1n, 2n]);
    });
  });

  describe("Edge Cases and Error Scenarios", () => {
    beforeEach(async () => {
      await deploy();
      
      // Add a schema for testing
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("TestSchema", "JSON", "https://example.com/test.json");
    });

    it("should accept empty strings in addRefiner", async function () {
      // The contract allows empty strings - this is a design choice
      // Empty name
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "", "https://schema.com", "https://refiner.com")
        .should.not.be.rejected;

      // Empty schema URL
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "Refiner", "", "https://refiner.com")
        .should.not.be.rejected;

      // Empty refinement URL
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "Refiner", "https://schema.com", "")
        .should.not.be.rejected;
    });

    it("should accept empty strings in addRefinerWithSchemaId", async function () {
      // The contract allows empty strings - this is a design choice
      // Empty name
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "", 1, "https://refiner.com")
        .should.not.be.rejected;

      // Empty refinement URL
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "Refiner", 1, "")
        .should.not.be.rejected;
    });

    it("should reject operations on non-existent DLP", async function () {
      // DLP 999 doesn't exist
      await expect(
        dataRefinerRegistry
          .connect(user1)
          .addRefiner(999, "Refiner", "https://schema.com", "https://refiner.com")
      ).to.be.reverted;

      await expect(
        dataRefinerRegistry
          .connect(user1)
          .addRefinerWithSchemaId(999, "Refiner", 1, "https://refiner.com")
      ).to.be.reverted;
    });

    it("should reject updateSchemaId on non-existent refiner", async function () {
      await expect(
        dataRefinerRegistry
          .connect(dlp1Owner)
          .updateSchemaId(999, 1)
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "NotDlpOwner");
    });

    it("should handle very long strings correctly", async function () {
      const longName = "A".repeat(1000);
      const longUrl = "https://example.com/" + "x".repeat(1000);

      // Should succeed with long strings
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, longName, longUrl, longUrl)
        .should.not.be.rejected;

      const refiner = await dataRefinerRegistry.refiners(1);
      refiner.name.should.eq(longName);
      refiner.schemaDefinitionUrl.should.eq(longUrl);
    });

    it("should handle special characters in names and URLs", async function () {
      const specialName = "Refiner-123_v2.0 (Beta) @2024!";
      const specialUrl = "https://example.com/path?param=value&other=123#fragment";

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, specialName, specialUrl, specialUrl)
        .should.not.be.rejected;

      const refiner = await dataRefinerRegistry.refiners(1);
      refiner.name.should.eq(specialName);
      refiner.schemaDefinitionUrl.should.eq(specialUrl);
    });

    it("should maintain consistency when mixing addRefiner and updateSchemaId", async function () {
      // Create refiner with direct URL
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "TestRefiner", "https://direct.com/schema.json", "https://refiner.com");

      // Check initial state
      let refiner = await dataRefinerRegistry.refiners(1);
      refiner.schemaDefinitionUrl.should.eq("https://direct.com/schema.json");

      // Update to schema ID
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .updateSchemaId(1, 1);

      // Check updated state
      refiner = await dataRefinerRegistry.refiners(1);
      refiner.schemaDefinitionUrl.should.eq("https://example.com/test.json");

      // The refiner should still be accessible and functional
      const dlpRefiners = await dataRefinerRegistry.dlpRefiners(1);
      dlpRefiners.should.deep.eq([1n]);
    });

    it("should correctly handle refiner ownership after DLP transfer", async function () {
      // Note: This test assumes DLP ownership can change in the DLPRegistry
      // Create a refiner
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "TestRefiner", 1, "https://refiner.com");

      // dlp2Owner should not be able to update it
      await expect(
        dataRefinerRegistry
          .connect(dlp2Owner)
          .updateSchemaId(1, 1)
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "NotDlpOwner");
    });
  });

  describe("Refinement Services", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should add and remove refinement services", async function () {
      const service1 = user1.address;
      const service2 = user2.address;

      // Initially empty
      (await dataRefinerRegistry.dlpRefinementServices(1)).should.deep.eq([]);

      // Add services
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinementService(1, service1);

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinementService(1, service2);

      // Check services
      const services = await dataRefinerRegistry.dlpRefinementServices(1);
      services.should.deep.eq([service1, service2]);

      // Remove service1
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .removeRefinementService(1, service1);

      // Check remaining services
      const remainingServices = await dataRefinerRegistry.dlpRefinementServices(1);
      remainingServices.should.deep.eq([service2]);
    });

    it("should check isRefinementService correctly", async function () {
      // Add schema and refiner
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("Schema1", "JSON", "https://example.com/schema1.json");

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinerWithSchemaId(1, "refiner1", 1, "instruction1");

      const service1 = user1.address;

      // Initially false
      (await dataRefinerRegistry.isRefinementService(1, service1)).should.eq(false);

      // Add service
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefinementService(1, service1);

      // Now true
      (await dataRefinerRegistry.isRefinementService(1, service1)).should.eq(true);

      // Remove service
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .removeRefinementService(1, service1);

      // False again
      (await dataRefinerRegistry.isRefinementService(1, service1)).should.eq(false);
    });

    it("should reject adding/removing services when not DLP owner", async function () {
      const service1 = user1.address;

      await expect(
        dataRefinerRegistry
          .connect(dlp2Owner)
          .addRefinementService(1, service1)
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "NotDlpOwner");

      await expect(
        dataRefinerRegistry
          .connect(dlp2Owner)
          .removeRefinementService(1, service1)
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "NotDlpOwner");
    });
  });
});