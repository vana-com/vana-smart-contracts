import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import { Wallet } from "ethers";
import { DataRegistryImplementation, DataRefinerRegistryImplementation } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getCurrentBlockNumber } from "../../utils/timeAndBlockManipulation";
import { proofs } from "../helpers/dataRegistryHelpers";

chai.use(chaiAsPromised);
should();

describe("DataRegistry", () => {
  let trustedForwarder: HardhatEthersSigner;
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let tee1: HardhatEthersSigner;
  let tee2: HardhatEthersSigner;
  let tee3: HardhatEthersSigner;
  let dlp1: HardhatEthersSigner;
  let dlp2: HardhatEthersSigner;
  let dlp3: HardhatEthersSigner;
  let queryEngine: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;

  let dataRegistry: DataRegistryImplementation;
  let dataRefinerRegistry: DataRefinerRegistryImplementation;

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );
  const REFINEMENT_SERVICE_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("REFINEMENT_SERVICE_ROLE"),
  );

  const deploy = async () => {
    [
      trustedForwarder,
      deployer,
      owner,
      maintainer,
      tee1,
      tee2,
      tee3,
      dlp1,
      dlp2,
      dlp3,
      queryEngine,
      user1,
      user2,
      user3,
    ] = await ethers.getSigners();

    const dataRegistryDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DataRegistryImplementation"),
      [trustedForwarder.address, owner.address],
      {
        kind: "uups",
      },
    );

    dataRegistry = await ethers.getContractAt(
      "DataRegistryImplementation",
      dataRegistryDeploy.target,
    );

    await dataRegistry
      .connect(owner)
      .grantRole(MAINTAINER_ROLE, maintainer.address);
  };

  describe("Setup", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should have correct params after deploy", async function () {
      (await dataRegistry.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(true);
      (await dataRegistry.hasRole(MAINTAINER_ROLE, owner)).should.eq(true);
      (await dataRegistry.hasRole(MAINTAINER_ROLE, maintainer)).should.eq(true);
      (await dataRegistry.version()).should.eq(2);
    });

    it("should change admin", async function () {
      await dataRegistry
        .connect(owner)
        .grantRole(MAINTAINER_ROLE, user1.address).should.not.be.rejected;

      await dataRegistry
        .connect(owner)
        .grantRole(DEFAULT_ADMIN_ROLE, user1.address).should.be.fulfilled;

      await dataRegistry
        .connect(user1)
        .revokeRole(DEFAULT_ADMIN_ROLE, owner.address);

      await dataRegistry
        .connect(owner)
        .grantRole(DEFAULT_ADMIN_ROLE, user2.address)
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${owner.address}", "${DEFAULT_ADMIN_ROLE}`,
        );

      await dataRegistry
        .connect(user1)
        .grantRole(DEFAULT_ADMIN_ROLE, user2.address).should.be.fulfilled;
    });

    it("Should upgradeTo when owner", async function () {
      await upgrades.upgradeProxy(
        dataRegistry,
        await ethers.getContractFactory(
          "DataRegistryImplementationV0Mock",
          owner,
        ),
      );

      const newRoot = await ethers.getContractAt(
        "DataRegistryImplementationV0Mock",
        dataRegistry,
      );
      (await newRoot.version()).should.eq(0);

      (await newRoot.test()).should.eq("test");
    });

    it("Should upgradeTo when owner and emit event", async function () {
      const newRootImplementation = await ethers.deployContract(
        "DataRegistryImplementationV0Mock",
      );

      await dataRegistry
        .connect(owner)
        .upgradeToAndCall(newRootImplementation, "0x")
        .should.emit(dataRegistry, "Upgraded")
        .withArgs(newRootImplementation);

      const newRoot = await ethers.getContractAt(
        "DataRegistryImplementationV0Mock",
        dataRegistry,
      );

      (await newRoot.version()).should.eq(0);

      (await newRoot.test()).should.eq("test");
    });

    it("Should reject upgradeTo when storage layout is incompatible", async function () {
      await upgrades
        .upgradeProxy(
          dataRegistry,
          await ethers.getContractFactory(
            "DataRegistryImplementationV3Mock",
            owner,
          ),
        )
        .should.be.rejectedWith("New storage layout is incompatible");
    });

    it("Should reject upgradeTo when non owner", async function () {
      const newRootImplementation = await ethers.deployContract(
        "DataRegistryImplementationV0Mock",
      );

      await dataRegistry
        .connect(user1)
        .upgradeToAndCall(newRootImplementation, "0x")
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
        );
    });
  });

  describe("AddFile", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should addFile", async function () {
      await dataRegistry
        .connect(user1)
        .addFile("file1")
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user1, "file1");

      (await dataRegistry.filesCount()).should.eq(1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user1.address);
      file1.addedAtBlock.should.eq(await getCurrentBlockNumber());

      (await dataRegistry.fileIdByUrl("file1")).should.eq(1);
    });

    it("should addFile multiple times", async function () {
      const currentBlockNumber = await getCurrentBlockNumber();

      await dataRegistry
        .connect(user1)
        .addFile("file1")
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user1, "file1");

      await dataRegistry
        .connect(user2)
        .addFile("file2")
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(2, user2, "file2");

      await dataRegistry
        .connect(user1)
        .addFile("file3")
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(3, user1, "file3");

      (await dataRegistry.filesCount()).should.eq(3);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user1);
      file1.url.should.eq("file1");
      file1.addedAtBlock.should.eq(currentBlockNumber + 1);

      const file2 = await dataRegistry.files(2);
      file2.id.should.eq(2);
      file2.ownerAddress.should.eq(user2);
      file2.url.should.eq("file2");
      file2.addedAtBlock.should.eq(currentBlockNumber + 2);

      const file3 = await dataRegistry.files(3);
      file3.id.should.eq(3);
      file3.ownerAddress.should.eq(user1);
      file3.url.should.eq("file3");
      file3.addedAtBlock.should.eq(currentBlockNumber + 3);

      (await dataRegistry.fileIdByUrl("file1")).should.eq(1);
      (await dataRegistry.fileIdByUrl("file2")).should.eq(2);
      (await dataRegistry.fileIdByUrl("file3")).should.eq(3);
    });

    it("should reject addFiles with used fileUrl", async function () {
      const currentBlockNumber = await getCurrentBlockNumber();

      await dataRegistry
        .connect(user1)
        .addFile("file1")
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user1, "file1");

      await dataRegistry
        .connect(user2)
        .addFile("file1")
        .should.rejectedWith("FileUrlAlreadyUsed()");

      await dataRegistry
        .connect(user1)
        .addFile("file1")
        .should.rejectedWith("FileUrlAlreadyUsed()");

      (await dataRegistry.filesCount()).should.eq(1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user1);
      file1.url.should.eq("file1");
      file1.addedAtBlock.should.eq(currentBlockNumber + 1);
    });

    it("should reject addFile when paused", async function () {
      await dataRegistry.connect(owner).pause();

      await dataRegistry
        .connect(user1)
        .addFile("file1")
        .should.be.rejectedWith("EnforcedPause()");
    });
  });

  describe("Proof", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should addProof, one file, one tee", async function () {
      await dataRegistry.connect(user1).addFile("file1");

      await dataRegistry
        .connect(tee1)
        .addProof(1, proofs[1])
        .should.emit(dataRegistry, "ProofAdded")
        .withArgs(
          1,
          user1,
          1,
          proofs[1].data.dlpId,
          proofs[1].data.score,
          proofs[1].data.proofUrl,
        );

      const file1Proof1 = await dataRegistry.fileProofs(1, 1);
      file1Proof1.signature.should.eq(proofs[1].signature);
      file1Proof1.data.score.should.eq(proofs[1].data.score);
      file1Proof1.data.dlpId.should.eq(proofs[1].data.dlpId);
      file1Proof1.data.metadata.should.eq(proofs[1].data.metadata);
      file1Proof1.data.proofUrl.should.eq(proofs[1].data.proofUrl);
      file1Proof1.data.instruction.should.eq(proofs[1].data.instruction);
    });

    it("should addProof, one file, multiple tee", async function () {
      await dataRegistry.connect(user1).addFile("file1");

      await dataRegistry
        .connect(tee1)
        .addProof(1, proofs[1])
        .should.emit(dataRegistry, "ProofAdded")
        .withArgs(
          1,
          user1,
          1,
          proofs[1].data.dlpId,
          proofs[1].data.score,
          proofs[1].data.proofUrl,
        );

      await dataRegistry
        .connect(tee2)
        .addProof(1, proofs[2])
        .should.emit(dataRegistry, "ProofAdded")
        .withArgs(
          1,
          user1,
          2,
          proofs[2].data.dlpId,
          proofs[2].data.score,
          proofs[2].data.proofUrl,
        );

      const file1Proof1 = await dataRegistry.fileProofs(1, 1);
      file1Proof1.signature.should.eq(proofs[1].signature);
      file1Proof1.data.score.should.eq(proofs[1].data.score);
      file1Proof1.data.dlpId.should.eq(proofs[1].data.dlpId);
      file1Proof1.data.metadata.should.eq(proofs[1].data.metadata);
      file1Proof1.data.proofUrl.should.eq(proofs[1].data.proofUrl);
      file1Proof1.data.instruction.should.eq(proofs[1].data.instruction);

      const file1Proof2 = await dataRegistry.fileProofs(1, 2);
      file1Proof2.signature.should.eq(proofs[2].signature);
      file1Proof2.data.score.should.eq(proofs[2].data.score);
      file1Proof2.data.dlpId.should.eq(proofs[2].data.dlpId);
      file1Proof2.data.metadata.should.eq(proofs[2].data.metadata);
      file1Proof2.data.proofUrl.should.eq(proofs[2].data.proofUrl);
      file1Proof2.data.instruction.should.eq(proofs[2].data.instruction);
    });

    it("should addProof, multiple files, one tee", async function () {
      await dataRegistry.connect(user1).addFile("file1");
      await dataRegistry.connect(user2).addFile("file2");
      await dataRegistry.connect(user1).addFile("file3");

      await dataRegistry
        .connect(tee1)
        .addProof(2, proofs[1])
        .should.emit(dataRegistry, "ProofAdded")
        .withArgs(
          2,
          user2,
          1,
          proofs[1].data.dlpId,
          proofs[1].data.score,
          proofs[1].data.proofUrl,
        );
      await dataRegistry
        .connect(tee1)
        .addProof(3, proofs[2])
        .should.emit(dataRegistry, "ProofAdded")
        .withArgs(
          3,
          user1,
          1,
          proofs[2].data.dlpId,
          proofs[2].data.score,
          proofs[2].data.proofUrl,
        );

      const file1Proof1 = await dataRegistry.fileProofs(1, 1);
      file1Proof1.signature.should.eq("0x");
      file1Proof1.data.score.should.eq(0);
      file1Proof1.data.dlpId.should.eq(0);
      file1Proof1.data.metadata.should.eq("");
      file1Proof1.data.proofUrl.should.eq("");
      file1Proof1.data.instruction.should.eq("");

      const file2Proof1 = await dataRegistry.fileProofs(2, 1);
      file2Proof1.signature.should.eq(proofs[1].signature);
      file2Proof1.data.score.should.eq(proofs[1].data.score);
      file2Proof1.data.dlpId.should.eq(proofs[1].data.dlpId);
      file2Proof1.data.metadata.should.eq(proofs[1].data.metadata);
      file2Proof1.data.proofUrl.should.eq(proofs[1].data.proofUrl);
      file2Proof1.data.instruction.should.eq(proofs[1].data.instruction);

      const file3Proof1 = await dataRegistry.fileProofs(3, 1);
      file3Proof1.signature.should.eq(proofs[2].signature);
      file3Proof1.data.score.should.eq(proofs[2].data.score);
      file3Proof1.data.dlpId.should.eq(proofs[2].data.dlpId);
      file3Proof1.data.metadata.should.eq(proofs[2].data.metadata);
      file3Proof1.data.proofUrl.should.eq(proofs[2].data.proofUrl);
      file3Proof1.data.instruction.should.eq(proofs[2].data.instruction);
    });

    it("should addProof, multiple files, multiple tees", async function () {
      await dataRegistry.connect(user1).addFile("file1");
      await dataRegistry.connect(user2).addFile("file2");
      await dataRegistry.connect(user3).addFile("file3");
      await dataRegistry.connect(user1).addFile("file4");
      await dataRegistry.connect(user2).addFile("file5");
      await dataRegistry.connect(user2).addFile("file6");

      await dataRegistry.connect(tee1).addProof(2, proofs[1]);
      await dataRegistry.connect(tee1).addProof(3, proofs[2]);
      await dataRegistry.connect(tee2).addProof(3, proofs[3]);
      await dataRegistry.connect(tee3).addProof(3, proofs[4]);
      await dataRegistry.connect(tee2).addProof(6, proofs[5]);

      const file1Proof1 = await dataRegistry.fileProofs(1, 1);
      file1Proof1.signature.should.eq("0x");
      file1Proof1.data.score.should.eq(0);
      file1Proof1.data.dlpId.should.eq(0);
      file1Proof1.data.metadata.should.eq("");
      file1Proof1.data.proofUrl.should.eq("");
      file1Proof1.data.instruction.should.eq("");

      const file2Proof1 = await dataRegistry.fileProofs(2, 1);
      file2Proof1.signature.should.eq(proofs[1].signature);
      file2Proof1.data.score.should.eq(proofs[1].data.score);
      file2Proof1.data.dlpId.should.eq(proofs[1].data.dlpId);
      file2Proof1.data.metadata.should.eq(proofs[1].data.metadata);
      file2Proof1.data.proofUrl.should.eq(proofs[1].data.proofUrl);
      file2Proof1.data.instruction.should.eq(proofs[1].data.instruction);

      const file3Proof1 = await dataRegistry.fileProofs(3, 1);
      file3Proof1.signature.should.eq(proofs[2].signature);
      file3Proof1.data.score.should.eq(proofs[2].data.score);
      file3Proof1.data.dlpId.should.eq(proofs[2].data.dlpId);
      file3Proof1.data.metadata.should.eq(proofs[2].data.metadata);
      file3Proof1.data.proofUrl.should.eq(proofs[2].data.proofUrl);
      file3Proof1.data.instruction.should.eq(proofs[2].data.instruction);

      const file3Proof2 = await dataRegistry.fileProofs(3, 2);
      file3Proof2.signature.should.eq(proofs[3].signature);
      file3Proof2.data.score.should.eq(proofs[3].data.score);
      file3Proof2.data.dlpId.should.eq(proofs[3].data.dlpId);
      file3Proof2.data.metadata.should.eq(proofs[3].data.metadata);
      file3Proof2.data.proofUrl.should.eq(proofs[3].data.proofUrl);
      file3Proof2.data.instruction.should.eq(proofs[3].data.instruction);

      const file3Proof3 = await dataRegistry.fileProofs(3, 3);
      file3Proof3.signature.should.eq(proofs[4].signature);
      file3Proof3.data.score.should.eq(proofs[4].data.score);
      file3Proof3.data.dlpId.should.eq(proofs[4].data.dlpId);
      file3Proof3.data.metadata.should.eq(proofs[4].data.metadata);
      file3Proof3.data.proofUrl.should.eq(proofs[4].data.proofUrl);
      file3Proof3.data.instruction.should.eq(proofs[4].data.instruction);

      const file6Proof1 = await dataRegistry.fileProofs(6, 1);
      file6Proof1.signature.should.eq(proofs[5].signature);
      file6Proof1.data.score.should.eq(proofs[5].data.score);
      file6Proof1.data.dlpId.should.eq(proofs[5].data.dlpId);
      file6Proof1.data.metadata.should.eq(proofs[5].data.metadata);
      file6Proof1.data.proofUrl.should.eq(proofs[5].data.proofUrl);
      file6Proof1.data.instruction.should.eq(proofs[5].data.instruction);
    });

    it("should reject addProof when paused", async function () {
      await dataRegistry.connect(user1).addFile("file1");
      await dataRegistry.connect(owner).pause();

      await dataRegistry
        .connect(tee1)
        .addProof(1, proofs[1])
        .should.be.rejectedWith("EnforcedPause()");
    });
  });

  describe("FilePermission", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should addFilePermission, one file, one dlp", async function () {
      await dataRegistry.connect(user1).addFile("file1");

      await dataRegistry
        .connect(user1)
        .addFilePermission(1, dlp1, "key1")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(1, dlp2)).should.eq("");
    });

    it("should addFilePermission, one file, multiple dlps #1", async function () {
      await dataRegistry.connect(user1).addFile("file1");

      await dataRegistry
        .connect(user1)
        .addFilePermission(1, dlp1, "key1")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      await dataRegistry
        .connect(user1)
        .addFilePermission(1, dlp2, "key2")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp2);

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(1, dlp2)).should.eq("key2");
    });

    it("should addFilePermission, one file, multiple dlps #2", async function () {
      await dataRegistry.connect(user1).addFile("file1");

      await dataRegistry
        .connect(user1)
        .addFilePermission(1, dlp1, "key1")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      await dataRegistry
        .connect(user1)
        .addFilePermission(1, dlp2, "key2")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp2);

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(1, dlp2)).should.eq("key2");
    });

    it("should addFilePermission, multiple files, one dlp", async function () {
      await dataRegistry.connect(user1).addFile("file1");
      await dataRegistry.connect(user2).addFile("file2");
      await dataRegistry.connect(user1).addFile("file3");

      await dataRegistry
        .connect(user2)
        .addFilePermission(2, dlp1, "key1")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(2, dlp1);
      await dataRegistry
        .connect(user1)
        .addFilePermission(3, dlp1, "key2")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(3, dlp1);

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("");
      (await dataRegistry.filePermissions(2, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(3, dlp1)).should.eq("key2");
    });

    it("should addFilePermission, multiple files, multiple dlps", async function () {
      await dataRegistry.connect(user1).addFile("file1");
      await dataRegistry.connect(user2).addFile("file2");
      await dataRegistry.connect(user3).addFile("file3");
      await dataRegistry.connect(user1).addFile("file4");
      await dataRegistry.connect(user2).addFile("file5");
      await dataRegistry.connect(user2).addFile("file6");

      await dataRegistry
        .connect(user2)
        .addFilePermission(2, dlp1, "key1")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(2, dlp1);
      await dataRegistry
        .connect(user3)
        .addFilePermission(3, dlp1, "key2")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(3, dlp1);
      await dataRegistry
        .connect(user3)
        .addFilePermission(3, dlp2, "key3")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(3, dlp2);
      await dataRegistry
        .connect(user3)
        .addFilePermission(3, dlp3, "key4")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(3, dlp3);
      await dataRegistry
        .connect(user2)
        .addFilePermission(6, dlp2, "key5")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(6, dlp2);

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("");
      (await dataRegistry.filePermissions(2, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(3, dlp1)).should.eq("key2");
      (await dataRegistry.filePermissions(3, dlp2)).should.eq("key3");
      (await dataRegistry.filePermissions(3, dlp3)).should.eq("key4");
      (await dataRegistry.filePermissions(6, dlp2)).should.eq("key5");
    });

    it("should reject addFilePermission when non-owner", async function () {
      await dataRegistry.connect(user1).addFile("file1");

      await dataRegistry
        .connect(user2)
        .addFilePermission(1, dlp1, "key1")
        .should.be.rejectedWith("NotFileOwner()");
    });

    it("should reject addFilePermission when paused", async function () {
      await dataRegistry.connect(user1).addFile("file1");
      await dataRegistry.connect(owner).pause();

      await dataRegistry
        .connect(user1)
        .addFilePermission(1, dlp1, "key1")
        .should.be.rejectedWith("EnforcedPause()");
    });
  });

  describe("AddFileWithPermissions", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should addFileWithPermissions, one file, one dlp", async function () {
      await dataRegistry
        .connect(user1)
        .addFileWithPermissions("file1", user2, [
          { account: dlp1, key: "key1" },
        ])
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user2.address);
      file1.addedAtBlock.should.eq(await getCurrentBlockNumber());

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(1, dlp2)).should.eq("");
    });

    it("should addFilePermission, one file, multiple dlps #1", async function () {
      await dataRegistry.connect(user1).addFile("file1");

      await dataRegistry
        .connect(user1)
        .addFilePermission(1, dlp1, "key1")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      await dataRegistry
        .connect(user1)
        .addFilePermission(1, dlp2, "key2")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp2);

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(1, dlp2)).should.eq("key2");
    });

    it("should addFilePermission, one file, multiple dlps #2", async function () {
      await dataRegistry.connect(user1).addFile("file1");

      await dataRegistry
        .connect(user1)
        .addFilePermission(1, dlp1, "key1")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      await dataRegistry
        .connect(user1)
        .addFilePermission(1, dlp2, "key2")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp2);

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(1, dlp2)).should.eq("key2");
    });

    it("should addFilePermission, multiple files, one dlp", async function () {
      await dataRegistry.connect(user1).addFile("file1");
      await dataRegistry.connect(user2).addFile("file2");
      await dataRegistry.connect(user1).addFile("file3");

      await dataRegistry
        .connect(user2)
        .addFilePermission(2, dlp1, "key1")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(2, dlp1);
      await dataRegistry
        .connect(user1)
        .addFilePermission(3, dlp1, "key2")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(3, dlp1);

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("");
      (await dataRegistry.filePermissions(2, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(3, dlp1)).should.eq("key2");
    });

    it("should addFilePermission, multiple files, multiple dlps", async function () {
      await dataRegistry.connect(user1).addFile("file1");
      await dataRegistry.connect(user2).addFile("file2");
      await dataRegistry.connect(user3).addFile("file3");
      await dataRegistry.connect(user1).addFile("file4");
      await dataRegistry.connect(user2).addFile("file5");
      await dataRegistry.connect(user2).addFile("file6");

      await dataRegistry
        .connect(user2)
        .addFilePermission(2, dlp1, "key1")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(2, dlp1);
      await dataRegistry
        .connect(user3)
        .addFilePermission(3, dlp1, "key2")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(3, dlp1);
      await dataRegistry
        .connect(user3)
        .addFilePermission(3, dlp2, "key3")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(3, dlp2);
      await dataRegistry
        .connect(user3)
        .addFilePermission(3, dlp3, "key4")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(3, dlp3);
      await dataRegistry
        .connect(user2)
        .addFilePermission(6, dlp2, "key5")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(6, dlp2);

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("");
      (await dataRegistry.filePermissions(2, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(3, dlp1)).should.eq("key2");
      (await dataRegistry.filePermissions(3, dlp2)).should.eq("key3");
      (await dataRegistry.filePermissions(3, dlp3)).should.eq("key4");
      (await dataRegistry.filePermissions(6, dlp2)).should.eq("key5");
    });

    it("should reject addFilePermission when non-owner", async function () {
      await dataRegistry.connect(user1).addFile("file1");

      await dataRegistry
        .connect(user2)
        .addFilePermission(1, dlp1, "key1")
        .should.be.rejectedWith("NotFileOwner()");
    });

    it("should reject addFilePermission when paused", async function () {
      await dataRegistry.connect(user1).addFile("file1");
      await dataRegistry.connect(owner).pause();

      await dataRegistry
        .connect(user1)
        .addFilePermission(1, dlp1, "key1")
        .should.be.rejectedWith("EnforcedPause()");
    });
  });

  describe("AddFileWithSchema", () => {
    beforeEach(async () => {
      await deploy();

      const DLPRegistryMockFactory =
        await ethers.getContractFactory("DLPRegistryMock");
      const DLPRegistryMock = await DLPRegistryMockFactory.deploy();

      await DLPRegistryMock.connect(dlp1).registerDlp();

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

      await dataRegistry
        .connect(owner)
        .updateDataRefinerRegistry(dataRefinerRegistry.target);
    });

    it("should addFileWithSchema with valid schemaId", async function () {
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("Schema1", "JSON", "https://example.com/schema1.json");

      await dataRegistry
        .connect(user1)
        .addFileWithSchema("file1", 1)
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user1, "file1");

      (await dataRegistry.filesCount()).should.eq(1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user1.address);
      file1.url.should.eq("file1");
      file1.addedAtBlock.should.eq(await getCurrentBlockNumber());

      (await dataRegistry.fileIdByUrl("file1")).should.eq(1);
    });

    it("should addFileWithSchema with schemaId 0 (no schema)", async function () {
      await dataRegistry
        .connect(user1)
        .addFileWithSchema("file1", 0)
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user1, "file1");

      (await dataRegistry.filesCount()).should.eq(1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user1.address);
      file1.url.should.eq("file1");
    });

    it("should reject addFileWithSchema with invalid schemaId", async function () {
      await dataRegistry
        .connect(user1)
        .addFileWithSchema("file1", 999)
        .should.be.rejectedWith("InvalidSchemaId(999)");
    });

    it("should reject addFileWithSchema with duplicate URL", async function () {
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("Schema1", "JSON", "https://example.com/schema1.json");

      await dataRegistry
        .connect(user1)
        .addFileWithSchema("file1", 1)
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user1, "file1");

      await dataRegistry
        .connect(user2)
        .addFileWithSchema("file1", 1)
        .should.be.rejectedWith("FileUrlAlreadyUsed()");
    });

    it("should reject addFileWithSchema when paused", async function () {
      await dataRegistry.connect(owner).pause();

      await dataRegistry
        .connect(user1)
        .addFileWithSchema("file1", 0)
        .should.be.rejectedWith("EnforcedPause()");
    });

    it("should addFile (without schema) as backward compatibility", async function () {
      await dataRegistry
        .connect(user1)
        .addFile("file1")
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user1, "file1");

      (await dataRegistry.filesCount()).should.eq(1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user1.address);
      file1.url.should.eq("file1");
    });
  });

  describe("AddFileWithPermissionsAndSchema", () => {
    beforeEach(async () => {
      await deploy();

      const DLPRegistryMockFactory =
        await ethers.getContractFactory("DLPRegistryMock");
      const DLPRegistryMock = await DLPRegistryMockFactory.deploy();

      await DLPRegistryMock.connect(dlp1).registerDlp();

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

      await dataRegistry
        .connect(owner)
        .updateDataRefinerRegistry(dataRefinerRegistry.target);
    });

    it("should addFileWithPermissionsAndSchema with valid schemaId", async function () {
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("Schema1", "JSON", "https://example.com/schema1.json");

      await dataRegistry
        .connect(user1)
        .addFileWithPermissionsAndSchema("file1", user2, [
          { account: dlp1, key: "key1" },
          { account: dlp2, key: "key2" },
        ], 1)
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1)
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp2);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user2.address);
      file1.url.should.eq("file1");
      file1.addedAtBlock.should.eq(await getCurrentBlockNumber());

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(1, dlp2)).should.eq("key2");
      (await dataRegistry.filePermissions(1, dlp3)).should.eq("");
    });

    it("should addFileWithPermissionsAndSchema with schemaId 0 (no schema)", async function () {
      await dataRegistry
        .connect(user1)
        .addFileWithPermissionsAndSchema("file1", user2, [
          { account: dlp1, key: "key1" },
        ], 0)
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user2.address);
      file1.url.should.eq("file1");

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
    });

    it("should reject addFileWithPermissionsAndSchema with invalid schemaId", async function () {
      await dataRegistry
        .connect(user1)
        .addFileWithPermissionsAndSchema("file1", user2, [
          { account: dlp1, key: "key1" },
        ], 999)
        .should.be.rejectedWith("InvalidSchemaId(999)");
    });

    it("should reject addFileWithPermissionsAndSchema with duplicate URL", async function () {
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("Schema1", "JSON", "https://example.com/schema1.json");

      await dataRegistry
        .connect(user1)
        .addFileWithPermissionsAndSchema("file1", user2, [
          { account: dlp1, key: "key1" },
        ], 1)
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1");

      await dataRegistry
        .connect(user2)
        .addFileWithPermissionsAndSchema("file1", user3, [
          { account: dlp2, key: "key2" },
        ], 1)
        .should.be.rejectedWith("FileUrlAlreadyUsed()");
    });

    it("should reject addFileWithPermissionsAndSchema when paused", async function () {
      await dataRegistry.connect(owner).pause();

      await dataRegistry
        .connect(user1)
        .addFileWithPermissionsAndSchema("file1", user2, [
          { account: dlp1, key: "key1" },
        ], 0)
        .should.be.rejectedWith("EnforcedPause()");
    });

    it("should addFileWithPermissions (without schema) as backward compatibility", async function () {
      await dataRegistry
        .connect(user1)
        .addFileWithPermissions("file1", user2, [
          { account: dlp1, key: "key1" },
        ])
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user2.address);
      file1.url.should.eq("file1");

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
    });

    it("should handle empty permissions array", async function () {
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("Schema1", "JSON", "https://example.com/schema1.json");

      await dataRegistry
        .connect(user1)
        .addFileWithPermissionsAndSchema("file1", user2, [], 1)
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1");

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user2.address);
      file1.url.should.eq("file1");

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("");
    });

    it("should handle multiple permissions for same file", async function () {
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("Schema1", "JSON", "https://example.com/schema1.json");

      await dataRegistry
        .connect(user1)
        .addFileWithPermissionsAndSchema("file1", user2, [
          { account: dlp1, key: "key1" },
          { account: dlp2, key: "key2" },
          { account: dlp3, key: "key3" },
          { account: queryEngine, key: "key4" },
        ], 1)
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1)
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp2)
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp3)
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, queryEngine);

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(1, dlp2)).should.eq("key2");
      (await dataRegistry.filePermissions(1, dlp3)).should.eq("key3");
      (await dataRegistry.filePermissions(1, queryEngine)).should.eq("key4");
    });
  });

  describe("AddRefinementWithPermission", () => {
    let refinementService: HardhatEthersSigner;

    beforeEach(async () => {
      await deploy();

      const DLPRegistryMockFactory =
        await ethers.getContractFactory("DLPRegistryMock");
      const DLPRegistryMock = await DLPRegistryMockFactory.deploy();

      await DLPRegistryMock.connect(dlp1).registerDlp();

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

      const signers = await ethers.getSigners();
      refinementService = signers[signers.length - 1];

      await dataRegistry
        .connect(owner)
        .setRoleAdmin(REFINEMENT_SERVICE_ROLE, MAINTAINER_ROLE);

      await dataRegistry
        .connect(owner)
        .updateDataRefinerRegistry(dataRefinerRegistry.target);

      await dataRegistry
        .connect(maintainer)
        .grantRole(REFINEMENT_SERVICE_ROLE, refinementService.address);

      (await dataRegistry.hasRole(REFINEMENT_SERVICE_ROLE, refinementService))
        .should.be.true;
    });

    it("should addRefinementWithPermission when REFINEMENT_SERVICE_ROLE", async function () {
      await dataRegistry
        .connect(user1)
        .addFileWithPermissions("file1", user2, [
          { account: dlp1, key: "key1" },
        ])
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user2.address);
      file1.addedAtBlock.should.eq(await getCurrentBlockNumber());

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(1, dlp2)).should.eq("");

      await dataRegistry
        .connect(refinementService)
        .addRefinementWithPermission(1, 1, "refinement1", queryEngine, "key2")
        .should.emit(dataRegistry, "RefinementAdded")
        .withArgs(1, 1, "refinement1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, queryEngine);

      (await dataRegistry.filePermissions(1, queryEngine)).should.eq("key2");
      (await dataRegistry.fileRefinements(1, 1)).should.eq("refinement1");
    });

    it("should addRefinementWithPermission when authorized by DLP", async function () {
      const signers = await ethers.getSigners();
      const dlpRefinementService = signers[signers.length - 2];
      
      await dataRegistry
        .connect(user1)
        .addFileWithPermissions("file1", user2, [
          { account: dlp1, key: "key1" },
        ])
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user2.address);
      file1.addedAtBlock.should.eq(await getCurrentBlockNumber());

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(1, dlp2)).should.eq("");

      await dataRegistry
        .connect(dlpRefinementService)
        .addRefinementWithPermission(1, 1, "refinement1", queryEngine, "key2")
        .should.rejectedWith("NoPermission()");

      await dataRefinerRegistry
        .connect(dlp1)
        .addRefinementService(1, dlpRefinementService.address)
        .should.be.fulfilled;

      // Add schema first
      await dataRefinerRegistry
        .connect(user1)
        .addSchema("Schema1", "JSON", "https://example.com/schema1.json");

      await dataRefinerRegistry
        .connect(dlp1)
        .addRefinerWithSchemaId(1, "refiner1", 1, "instruction1")
        .should.emit(dataRefinerRegistry, "RefinerAdded")
        .withArgs(1, 1, "refiner1", 1, "https://example.com/schema1.json", "instruction1");

      (await dataRefinerRegistry.isRefinementService(1, dlpRefinementService.address)).should.be.true;

      await dataRegistry
        .connect(dlpRefinementService)
        .addRefinementWithPermission(1, 1, "refinement1", queryEngine, "key2")
        .should.emit(dataRegistry, "RefinementAdded")
        .withArgs(1, 1, "refinement1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, queryEngine);

      (await dataRegistry.filePermissions(1, queryEngine)).should.eq("key2");
      (await dataRegistry.fileRefinements(1, 1)).should.eq("refinement1");
    });

    it("should not addRefinementWithPermission even when having permissions", async function () {
      await dataRegistry
        .connect(user1)
        .addFileWithPermissions("file1", user2, [
          { account: dlp1, key: "key1" },
        ])
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user2.address);
      file1.addedAtBlock.should.eq(await getCurrentBlockNumber());

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(1, dlp2)).should.eq("");

      await dataRegistry
        .connect(dlp1)
        .addRefinementWithPermission(1, 1, "refinement1", queryEngine, "key2")
        .should.be.rejectedWith("NoPermission()");
    });

    it("should addRefinementWithPermission against multiple refiners", async function () {
      await dataRegistry
        .connect(user1)
        .addFileWithPermissions("file1", user2, [
          { account: dlp1, key: "key1" },
        ])
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);
      file1.ownerAddress.should.eq(user2.address);
      file1.addedAtBlock.should.eq(await getCurrentBlockNumber());

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(1, dlp2)).should.eq("");

      await dataRegistry
        .connect(refinementService)
        .addRefinementWithPermission(1, 1, "refinement1", queryEngine, "key2")
        .should.emit(dataRegistry, "RefinementAdded")
        .withArgs(1, 1, "refinement1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, queryEngine);

      // No PermissionGranted as permission for queryEngine is already granted
      await dataRegistry
        .connect(refinementService)
        .addRefinementWithPermission(1, 2, "refinement2", queryEngine, "key3")
        .should.emit(dataRegistry, "RefinementAdded")
        .withArgs(1, 2, "refinement2");

      (await dataRegistry.filePermissions(1, queryEngine)).should.eq("key2");
      (await dataRegistry.fileRefinements(1, 1)).should.eq("refinement1");
      (await dataRegistry.fileRefinements(1, 2)).should.eq("refinement2");
    });

    it("should not addRefinementWithPermission with invalid fileId", async function () {
      await dataRegistry
        .connect(user1)
        .addFileWithPermissions("file1", user2, [
          { account: dlp1, key: "key1" },
        ])
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);

      await dataRegistry
        .connect(refinementService)
        .addRefinementWithPermission(0, 1, "refinement1", queryEngine, "key2")
        .should.be.rejectedWith("FileNotFound()");

      await dataRegistry
        .connect(refinementService)
        .addRefinementWithPermission(2, 1, "refinement1", queryEngine, "key2")
        .should.be.rejectedWith("FileNotFound()");
    });

    it("should not allow unauthorized users to addRefinementWithPermission", async function () {
      await dataRegistry
        .connect(user1)
        .addFileWithPermissions("file1", user2, [
          { account: dlp1, key: "key1" },
        ])
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      (await dataRegistry.filePermissions(1, dlp1)).should.eq("key1");
      (await dataRegistry.filePermissions(1, dlp2)).should.eq("");

      await dataRegistry
        .connect(dlp2)
        .addRefinementWithPermission(1, 1, "refinement1", queryEngine, "key2")
        .should.be.rejectedWith("NoPermission()");

      const file1 = await dataRegistry.files(1);
      file1.ownerAddress.should.eq(user2.address);

      // File owner should not be able to add refinement with or without permission
      await dataRegistry
        .connect(user2)
        .addRefinementWithPermission(1, 1, "refinement1", queryEngine, "key2")
        .should.be.rejectedWith("NoPermission()");

      await dataRegistry
        .connect(user2)
        .addFilePermission(1, user2, "key3")
        .should.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, user2);

      await dataRegistry
        .connect(user2)
        .addRefinementWithPermission(1, 1, "refinement1", queryEngine, "key2")
        .should.be.rejectedWith("NoPermission()");
    });

    it("should not addRefinementWithPermission with empty URL", async function () {
      await dataRegistry
        .connect(user1)
        .addFileWithPermissions("file1", user2, [
          { account: dlp1, key: "key1" },
        ])
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);

      await dataRegistry
        .connect(refinementService)
        .addRefinementWithPermission(1, 1, "", queryEngine, "key2")
        .should.be.rejectedWith("InvalidUrl()");
    });

    it("should addRefinementWithPermission more than once against the same refiner", async function () {
      await dataRegistry
        .connect(user1)
        .addFileWithPermissions("file1", user2, [
          { account: dlp1, key: "key1" },
        ])
        .should.emit(dataRegistry, "FileAdded")
        .withArgs(1, user2, "file1")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, dlp1);

      const file1 = await dataRegistry.files(1);
      file1.id.should.eq(1);

      await dataRegistry
        .connect(refinementService)
        .addRefinementWithPermission(1, 1, "refinement1a", queryEngine, "key2")
        .should.emit(dataRegistry, "RefinementAdded")
        .withArgs(1, 1, "refinement1a")
        .and.emit(dataRegistry, "PermissionGranted")
        .withArgs(1, queryEngine);

      await dataRegistry
        .connect(refinementService)
        .addRefinementWithPermission(1, 1, "refinement1b", queryEngine, "key2")
        .should.emit(dataRegistry, "RefinementUpdated")
        .withArgs(1, 1, "refinement1b");
    });
  });
});
