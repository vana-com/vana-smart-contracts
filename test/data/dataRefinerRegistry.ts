import chai, { should } from "chai";
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
        .revokeRole(DEFAULT_ADMIN_ROLE, owner.address);
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

    it("should upgradeTo when owner", async function () {
      await upgrades.upgradeProxy(
        dataRefinerRegistry,
        await ethers.getContractFactory(
          "DataRefinerRegistryImplementationV0Mock",
          owner,
        ),
      );

      const newImpl = await ethers.getContractAt(
        "DataRefinerRegistryImplementationV0Mock",
        dataRefinerRegistry,
      );
      (await newImpl.version()).should.eq(0);

      (await newImpl.test()).should.eq("test");
    });

    it("should not upgradeTo when non owner", async function () {
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

      await dataRefinerRegistry
        .connect(owner)
        .upgradeToAndCall(newImpl, "0x")
        .should.emit(dataRefinerRegistry, "Upgraded")
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

  describe("addRefiner", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should addRefiner only when DLP owner", async function () {
      (await dataRefinerRegistry.dlpRegistry()).should.eq(DLPRegistryMock);
      (await DLPRegistryMock.dlps(1)).ownerAddress.should.eq(dlp1Owner.address);

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "refiner1", "schema1", "instruction1")
        .should.emit(dataRefinerRegistry, "RefinerAdded")
        .withArgs(1, 1, "refiner1", "schema1", "instruction1");

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "refiner2", "schema2", "instruction2")
        .should.emit(dataRefinerRegistry, "RefinerAdded")
        .withArgs(2, 1, "refiner2", "schema2", "instruction2");

      const refiner1 = await dataRefinerRegistry.refiners(1);
      refiner1.dlpId.should.eq(1);
      refiner1.owner.should.eq(dlp1Owner.address);
      refiner1.name.should.eq("refiner1");
      refiner1.schemaDefinitionUrl.should.eq("schema1");
      refiner1.refinementInstructionUrl.should.eq("instruction1");

      const refiner2 = await dataRefinerRegistry.refiners(2);
      refiner2.dlpId.should.eq(1);
      refiner2.owner.should.eq(dlp1Owner.address);
      refiner2.name.should.eq("refiner2");
      refiner2.schemaDefinitionUrl.should.eq("schema2");
      refiner2.refinementInstructionUrl.should.eq("instruction2");

      await dataRefinerRegistry
        .connect(dlp2Owner)
        .addRefiner(1, "refiner2", "schema2", "instruction2")
        .should.be.rejectedWith("NotDlpOwner()");
    });

    it("should not addRefiner when pause", async function () {
      await dataRefinerRegistry.connect(maintainer).pause().should.be.fulfilled;

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "refiner1", "schema1", "instruction1")
        .should.be.rejectedWith("EnforcedPause");

      await dataRefinerRegistry.connect(maintainer).unpause().should.be
        .fulfilled;

      await dataRefinerRegistry
        .connect(dlp1Owner)
        .addRefiner(1, "refiner1", "schema1", "instruction1")
        .should.be.fulfilled;
    });
  });
});
