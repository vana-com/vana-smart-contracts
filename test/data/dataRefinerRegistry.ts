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

  describe("addRefiner with Schema", () => {
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

    it("should addRefiner with valid schema ID only when DLP owner", async function () {
      (await dataRefinerRegistry.dlpRegistry()).should.eq(DLPRegistryMock);
      (await DLPRegistryMock.dlps(1)).ownerAddress.should.eq(dlp1Owner.address);

      const tx = await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "refiner1", schemaId1, "instruction1");

      await expect(tx).to.emit(dataRefinerRegistry, "RefinerAdded")
        .withArgs(1, 1, "refiner1", schemaId1, "instruction1");

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "refiner2", schemaId2, "instruction2");

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
          .addRefiner(1, "refiner3", schemaId1, "instruction3")
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "NotDlpOwner");
    });

    it("should reject addRefiner with invalid schema ID", async function () {
      // Try with schema ID 0
      await expect(
        dataRefinerRegistry
          .connect(dlp1Owner)
          .addRefiner(1, "refiner1", 0, "instruction1")
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "InvalidSchemaId")
        .withArgs(0);

      // Try with schema ID that doesn't exist yet
      await expect(
        dataRefinerRegistry
          .connect(dlp1Owner)
          .addRefiner(1, "refiner1", 3, "instruction1")
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "InvalidSchemaId")
        .withArgs(3);
    });

    it("should updateSchemaId for existing refiner", async function () {
      // Add a refiner with schema 1
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "refiner1", schemaId1, "instruction1");

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
        .addRefiner(1, "refiner1", schemaId1, "instruction1");

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
        .addRefiner(1, "refiner1", schemaId1, "instruction1");

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
          .addRefiner(1, "refiner1", schemaId1, "instruction1")
      ).to.be.revertedWithCustomError(dataRefinerRegistry, "EnforcedPause");

      await dataRefinerRegistry.connect(maintainer).unpause().should.be
        .fulfilled;

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "refiner1", schemaId1, "instruction1")
        .should.be.fulfilled;
    });

    it("should not updateSchemaId when paused", async function () {
      // Add refiner first
      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "refiner1", schemaId1, "instruction1");

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
        .addRefiner(1, "refiner1", 1, "instruction1");

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "refiner2", 2, "instruction2");

      // Should return both refiner IDs
      const refiners = await dataRefinerRegistry.dlpRefiners(1);
      refiners.should.deep.eq([1n, 2n]);
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
        .addRefiner(1, "refiner1", 1, "instruction1");

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