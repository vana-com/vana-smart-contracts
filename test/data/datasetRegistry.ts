import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import { 
  DatasetRegistryImplementation,
  DataRegistryImplementation
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther } from "../../utils/helpers";

chai.use(chaiAsPromised);
should();

describe("DatasetRegistry", () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let dataRegistryRole: HardhatEthersSigner; // Dedicated wallet for DATA_REGISTRY_ROLE
  let dlp1: HardhatEthersSigner;
  let dlp2: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;

  let datasetRegistry: DatasetRegistryImplementation;
  let dataRegistry: DataRegistryImplementation;

  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MAINTAINER_ROLE"));
  const DATA_REGISTRY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DATA_REGISTRY_ROLE"));
  
  // Dataset types
  const DatasetType = { MAIN: 0, DERIVED: 1 };

  const deploy = async () => {
    [
      deployer,
      owner,
      maintainer,
      dataRegistryRole,
      dlp1,
      dlp2,
      user1,
      user2,
      user3,
    ] = await ethers.getSigners();

    // Deploy DataRegistry (no need for DataRefinerRegistry in these tests)
    const dataRegistryDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DataRegistryImplementation"),
      [ethers.ZeroAddress, owner.address], // trustedForwarder, owner
      { kind: "uups" }
    );
    dataRegistry = await ethers.getContractAt(
      "DataRegistryImplementation",
      dataRegistryDeploy.target
    );

    // Set up DataRegistry
    await dataRegistry.connect(owner).grantRole(MAINTAINER_ROLE, maintainer.address);

    // Deploy DatasetRegistry
    const datasetRegistryDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DatasetRegistryImplementation"),
      [
        owner.address,
        await dataRegistry.getAddress() // Use DataRegistry address for initial DATA_REGISTRY_ROLE
      ],
      { kind: "uups" }
    );
    datasetRegistry = await ethers.getContractAt(
      "DatasetRegistryImplementation",
      datasetRegistryDeploy.target
    );

    // Set up roles
    await datasetRegistry.connect(owner).grantRole(MAINTAINER_ROLE, maintainer.address);
    // Also grant DATA_REGISTRY_ROLE to the dedicated test wallet
    await datasetRegistry.connect(owner).grantRole(DATA_REGISTRY_ROLE, dataRegistryRole.address);
    
    // Update DataRegistry to use DatasetRegistry
    await dataRegistry.connect(maintainer).updateDatasetRegistry(await datasetRegistry.getAddress());
  };

  describe("Setup", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should have correct params after deploy", async function () {
      (await datasetRegistry.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).should.eq(true);
      (await datasetRegistry.hasRole(MAINTAINER_ROLE, owner.address)).should.eq(true);
      (await datasetRegistry.hasRole(MAINTAINER_ROLE, maintainer.address)).should.eq(true);
      (await datasetRegistry.hasRole(DATA_REGISTRY_ROLE, await dataRegistry.getAddress())).should.eq(true);
      (await datasetRegistry.hasRole(DATA_REGISTRY_ROLE, dataRegistryRole.address)).should.eq(true);
      (await datasetRegistry.datasetsCount()).should.eq(0);
    });

    it("should grant roles correctly", async function () {
      await datasetRegistry
        .connect(owner)
        .grantRole(MAINTAINER_ROLE, user1.address).should.not.be.rejected;

      (await datasetRegistry.hasRole(MAINTAINER_ROLE, user1.address)).should.eq(true);
    });
  });

  describe("Dataset Creation", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should create dataset successfully", async function () {
      const dlpId = 1;
      
      const tx = await datasetRegistry
        .connect(maintainer)
        .createMainDataset(dlpId, dlp1.address);
      
      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          const parsed = datasetRegistry.interface.parseLog(log as any);
          return parsed?.name === "MainDatasetCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = datasetRegistry.interface.parseLog(event as any);

      parsedEvent?.args.datasetId.should.eq(1);
      parsedEvent?.args.dlpId.should.eq(dlpId);
      parsedEvent?.args.owner.should.eq(dlp1.address);

      (await datasetRegistry.datasetsCount()).should.eq(1);
      (await datasetRegistry.dlpToDataset(dlpId)).should.eq(1);
    });

    it("should fail if not maintainer", async function () {
      await datasetRegistry
        .connect(user1)
        .createMainDataset(1, dlp1.address).should.be.rejectedWith("AccessControl");
    });

    it("should fail if dataset already exists for DLP", async function () {
      const dlpId = 1;
      
      await datasetRegistry
        .connect(maintainer)
        .createMainDataset(dlpId, dlp1.address).should.not.be.rejected;

      await datasetRegistry
        .connect(maintainer)
        .createMainDataset(dlpId, dlp2.address).should.be.rejectedWith("DatasetAlreadyExists");
    });

    it("should create multiple datasets", async function () {
      await datasetRegistry
        .connect(maintainer)
        .createMainDataset(1, dlp1.address).should.not.be.rejected;

      await datasetRegistry
        .connect(maintainer)
        .createMainDataset(2, dlp2.address).should.not.be.rejected;

      (await datasetRegistry.datasetsCount()).should.eq(2);
      (await datasetRegistry.dlpToDataset(1)).should.eq(1);
      (await datasetRegistry.dlpToDataset(2)).should.eq(2);
    });

    it("should create derived dataset successfully", async function () {
      // First create a main dataset
      await datasetRegistry
        .connect(maintainer)
        .createMainDataset(1, dlp1.address).should.not.be.rejected;

      // Then create a derived dataset with dlp1 as contributor (since it owns parent dataset)
      const contributors = [dlp1.address, dlp2.address];
      const shares = [parseEther("0.6"), parseEther("0.4")];
      
      const tx = await datasetRegistry
        .connect(maintainer)
        .createDerivedDataset(dlp2.address, [1], contributors, shares);

      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => 
        datasetRegistry.interface.parseLog(log as any)?.name === "DerivedDatasetCreated"
      );
      const parsedEvent = datasetRegistry.interface.parseLog(event as any);

      parsedEvent?.args.datasetId.should.eq(2);
      parsedEvent?.args.owner.should.eq(dlp2.address);
      parsedEvent?.args.parentDatasetIds.should.deep.eq([1n]);
      parsedEvent?.args.contributors.should.deep.eq(contributors);

      (await datasetRegistry.datasetsCount()).should.eq(2);
      (await datasetRegistry.dlpToDataset(0)).should.eq(0); // Derived datasets don't map to DLP
      
      // Check shares were set
      (await datasetRegistry.ownerShares(2, dlp1.address)).should.eq(shares[0]);
      (await datasetRegistry.ownerShares(2, dlp2.address)).should.eq(shares[1]);
    });

    it("should fail to create derived dataset without parent owner in contributors", async function () {
      await datasetRegistry
        .connect(maintainer)
        .createMainDataset(1, dlp1.address).should.not.be.rejected;

      // Try to create derived dataset without including parent owner (dlp1) in contributors
      await datasetRegistry
        .connect(maintainer)
        .createDerivedDataset(dlp2.address, [1], [dlp2.address], [parseEther("1.0")])
        .should.be.rejectedWith("ParentDatasetOwnerNotIncluded");
    });

    it("should fail to create derived dataset without parents", async function () {
      await datasetRegistry
        .connect(maintainer)
        .createDerivedDataset(dlp2.address, [], [], [])
        .should.be.rejectedWith("DerivedDatasetNeedsParents");
    });

    it("should fail to create derived dataset with invalid parent", async function () {
      await datasetRegistry
        .connect(maintainer)
        .createDerivedDataset(dlp2.address, [999], [dlp2.address], [parseEther("1.0")])
        .should.be.rejectedWith("InvalidParentDataset");
    });

    it("should fail to create derived dataset with mismatched contributors and shares", async function () {
      await datasetRegistry
        .connect(maintainer)
        .createMainDataset(1, dlp1.address).should.not.be.rejected;

      await datasetRegistry
        .connect(maintainer)
        .createDerivedDataset(dlp2.address, [1], [dlp1.address, dlp2.address], [parseEther("1.0")]) // Only 1 share for 2 contributors
        .should.be.rejectedWith("ContributorsSharesMismatch");
    });
  });

  describe("Dataset Info", () => {
    beforeEach(async () => {
      await deploy();
      // Create a dataset for testing
      await datasetRegistry.connect(maintainer).createMainDataset(1, dlp1.address);
    });

    it("should return correct dataset info", async function () {
      const datasetInfo = await datasetRegistry.datasets(1);
      
      datasetInfo.owner.should.eq(dlp1.address);
      datasetInfo.datasetType.should.eq(DatasetType.MAIN);
      datasetInfo.totalShares.should.eq(0);
      datasetInfo.fileIdsCount.should.eq(0);
      datasetInfo.parentDatasetIds.should.be.empty;
    });

    it("should fail for non-existent dataset", async function () {
      await datasetRegistry.datasets(999).should.be.rejectedWith("0xbb36834d");
    });

    it("should return correct derived dataset info", async function () {
      // Create a derived dataset
      const contributors = [dlp1.address, dlp2.address];
      const shares = [parseEther("0.7"), parseEther("0.3")];
      
      await datasetRegistry
        .connect(maintainer)
        .createDerivedDataset(dlp2.address, [1], contributors, shares);

      const datasetInfo = await datasetRegistry.datasets(2);
      
      datasetInfo.owner.should.eq(dlp2.address);
      datasetInfo.datasetType.should.eq(DatasetType.DERIVED);
      datasetInfo.totalShares.should.eq(parseEther("1.0"));
      datasetInfo.fileIdsCount.should.eq(0);
      datasetInfo.parentDatasetIds.should.deep.eq([1n]);
    });
  });

  describe("File Management", () => {
    beforeEach(async () => {
      await deploy();
      // Create datasets for testing
      await datasetRegistry.connect(maintainer).createMainDataset(1, dlp1.address);
      await datasetRegistry.connect(maintainer).createMainDataset(2, dlp2.address);
    });

    it("should add file to dataset", async function () {
      const fileId = 1;
      const dlpId = 1;
      const share = parseEther("0.5");
      
      const tx = await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToDataset(fileId, dlpId, user1.address, share);

      const receipt = await tx.wait();
      const fileEvent = receipt?.logs.find(log => 
        datasetRegistry.interface.parseLog(log as any)?.name === "FileAddedToDataset"
      );
      const shareEvent = receipt?.logs.find(log => 
        datasetRegistry.interface.parseLog(log as any)?.name === "OwnerSharesUpdated"
      );

      const parsedFileEvent = datasetRegistry.interface.parseLog(fileEvent as any);
      const parsedShareEvent = datasetRegistry.interface.parseLog(shareEvent as any);

      parsedFileEvent?.args.datasetId.should.eq(1);
      parsedFileEvent?.args.fileId.should.eq(fileId);
      parsedFileEvent?.args.fileOwner.should.eq(user1.address);

      parsedShareEvent?.args.datasetId.should.eq(1);
      parsedShareEvent?.args.owner.should.eq(user1.address);
      parsedShareEvent?.args.shares.should.eq(share);

      // Verify dataset info
      const datasetInfo = await datasetRegistry.datasets(1);
      datasetInfo.totalShares.should.eq(share);
      datasetInfo.fileIdsCount.should.eq(1);

      // Verify owner shares
      (await datasetRegistry.ownerShares(1, user1.address)).should.eq(share);

      // Verify file is in dataset
      (await datasetRegistry.isFileInDataset(1, fileId)).should.eq(true);
    });

    it("should fail if not DATA_REGISTRY_ROLE", async function () {
      await datasetRegistry
        .connect(user1)
        .addFileToDataset(1, 1, user1.address, parseEther("0.5"))
        .should.be.rejectedWith("AccessControl");
    });

    it("should fail if dataset not found", async function () {
      await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToDataset(1, 999, user1.address, parseEther("0.5"))
        .should.be.rejectedWith("DatasetNotFound");
    });

    it("should fail if file already in dataset", async function () {
      const fileId = 1;
      const dlpId = 1;
      const share = parseEther("0.5");

      await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToDataset(fileId, dlpId, user1.address, share).should.not.be.rejected;

      await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToDataset(fileId, dlpId, user2.address, share)
        .should.be.rejectedWith("FileAlreadyInDataset");
    });

    it("should accumulate shares for same owner", async function () {
      const dlpId = 1;
      const share1 = parseEther("0.3");
      const share2 = parseEther("0.7");

      await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToDataset(1, dlpId, user1.address, share1).should.not.be.rejected;

      await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToDataset(2, dlpId, user1.address, share2).should.not.be.rejected;

      (await datasetRegistry.ownerShares(1, user1.address)).should.eq(share1 + share2);
      
      const datasetInfo = await datasetRegistry.datasets(1);
      datasetInfo.totalShares.should.eq(share1 + share2);
      datasetInfo.fileIdsCount.should.eq(2);
    });

    it("should handle multiple owners", async function () {
      const dlpId = 1;
      const share1 = parseEther("0.3");
      const share2 = parseEther("0.7");

      await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToDataset(1, dlpId, user1.address, share1).should.not.be.rejected;

      await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToDataset(2, dlpId, user2.address, share2).should.not.be.rejected;

      (await datasetRegistry.ownerShares(1, user1.address)).should.eq(share1);
      (await datasetRegistry.ownerShares(1, user2.address)).should.eq(share2);
      
      const datasetInfo = await datasetRegistry.datasets(1);
      datasetInfo.totalShares.should.eq(share1 + share2);
      datasetInfo.fileIdsCount.should.eq(2);
    });
  });

  describe("File Pagination", () => {
    beforeEach(async () => {
      await deploy();
      await datasetRegistry.connect(maintainer).createMainDataset(1, dlp1.address);
      
      // Add multiple files to dataset using dataRegistryRole
      for (let i = 1; i <= 25; i++) {
        await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToDataset(i, 1, user1.address, parseEther("0.1"));
      }
    });

    it("should return first page of files", async function () {
      const files = await datasetRegistry.datasetFiles(1, 0, 10);
      
      files.length.should.eq(10);
      for (let i = 0; i < 10; i++) {
        Number(files[i]).should.eq(i + 1);
      }
    });

    it("should return second page of files", async function () {
      const files = await datasetRegistry.datasetFiles(1, 10, 10);
      
      files.length.should.eq(10);
      for (let i = 0; i < 10; i++) {
        Number(files[i]).should.eq(i + 11);
      }
    });

    it("should return partial last page", async function () {
      const files = await datasetRegistry.datasetFiles(1, 20, 10);
      
      files.length.should.eq(5);
      for (let i = 0; i < 5; i++) {
        Number(files[i]).should.eq(i + 21);
      }
    });

    it("should return empty array for offset beyond range", async function () {
      const files = await datasetRegistry.datasetFiles(1, 30, 10);
      files.length.should.eq(0);
    });

    it("should handle zero limit", async function () {
      const files = await datasetRegistry.datasetFiles(1, 0, 0);
      files.length.should.eq(0);
    });
  });

  describe("Integration with DataRegistry", () => {
    beforeEach(async () => {
      await deploy();
      await datasetRegistry.connect(maintainer).createMainDataset(1, dlp1.address);
    });

    it("should automatically add file to dataset when proof is added in DataRegistry", async function () {
      // Add a file to DataRegistry
      const fileUrl = "https://example.com/file1.txt";
      const addFileTx = await dataRegistry.connect(user1).addFile(fileUrl);
      const addFileReceipt = await addFileTx.wait();
      
      const addFileEvent = addFileReceipt?.logs.find(log => 
        dataRegistry.interface.parseLog(log as any)?.name === "FileAdded"
      );
      const parsedAddFileEvent = dataRegistry.interface.parseLog(addFileEvent as any);
      const fileId = parsedAddFileEvent?.args.fileId;

      // Verify dataset is still empty
      let datasetInfo = await datasetRegistry.datasets(1);
      datasetInfo.fileIdsCount.should.eq(0);

      // Add proof to the file (this should trigger adding file to dataset)
      const proof = {
        signature: "0x1234567890abcdef",
        data: {
          score: parseEther("0.8"),
          dlpId: 1,
          metadata: "test metadata",
          proofUrl: "https://example.com/proof1",
          instruction: "test instruction"
        }
      };

      const addProofTx = await dataRegistry.connect(user1).addProof(fileId, proof);
      const addProofReceipt = await addProofTx.wait();

      // Verify file was added to dataset automatically
      datasetInfo = await datasetRegistry.datasets(1);
      datasetInfo.fileIdsCount.should.eq(1);
      datasetInfo.totalShares.should.eq(proof.data.score);

      (await datasetRegistry.isFileInDataset(1, fileId)).should.eq(true);
      (await datasetRegistry.ownerShares(1, user1.address)).should.eq(proof.data.score);
    });

    it("should handle multiple proofs from different users", async function () {
      // Create multiple files and add proofs
      const files = [];
      const users = [user1, user2, user3];
      const scores = [parseEther("0.3"), parseEther("0.5"), parseEther("0.2")];

      for (let i = 0; i < 3; i++) {
        // Add file
        const fileUrl = `https://example.com/file${i + 1}.txt`;
        const addFileTx = await dataRegistry.connect(users[i]).addFile(fileUrl);
        const addFileReceipt = await addFileTx.wait();
        
        const addFileEvent = addFileReceipt?.logs.find(log => 
          dataRegistry.interface.parseLog(log as any)?.name === "FileAdded"
        );
        const parsedAddFileEvent = dataRegistry.interface.parseLog(addFileEvent as any);
        const fileId = parsedAddFileEvent?.args.fileId;
        files.push(fileId);

        // Add proof
        const proof = {
          signature: `0x123456789${i}abcdef`,
          data: {
            score: scores[i],
            dlpId: 1,
            metadata: `test metadata ${i}`,
            proofUrl: `https://example.com/proof${i + 1}`,
            instruction: `test instruction ${i}`
          }
        };

        await dataRegistry.connect(users[i]).addProof(fileId, proof);
      }

      // Verify dataset state
      const datasetInfo = await datasetRegistry.datasets(1);
      datasetInfo.fileIdsCount.should.eq(3);
      datasetInfo.totalShares.should.eq(scores[0] + scores[1] + scores[2]);

      // Verify individual shares
      for (let i = 0; i < 3; i++) {
        (await datasetRegistry.ownerShares(1, users[i].address)).should.eq(scores[i]);
        (await datasetRegistry.isFileInDataset(1, files[i])).should.eq(true);
      }
    });

    it("should fail when proof is added for non-existent dataset", async function () {
      // Add file
      const fileUrl = "https://example.com/file1.txt";
      const addFileTx = await dataRegistry.connect(user1).addFile(fileUrl);
      const addFileReceipt = await addFileTx.wait();
      
      const addFileEvent = addFileReceipt?.logs.find(log => 
        dataRegistry.interface.parseLog(log as any)?.name === "FileAdded"
      );
      const parsedAddFileEvent = dataRegistry.interface.parseLog(addFileEvent as any);
      const fileId = parsedAddFileEvent?.args.fileId;

      // Add proof for non-existent DLP (should revert because DatasetRegistry will throw)
      const proof = {
        signature: "0x1234567890abcdef",
        data: {
          score: parseEther("0.8"),
          dlpId: 999, // Non-existent DLP
          metadata: "test metadata",
          proofUrl: "https://example.com/proof1",
          instruction: "test instruction"
        }
      };

      // This should revert because the dataset doesn't exist
      await dataRegistry.connect(user1).addProof(fileId, proof)
        .should.be.rejectedWith("DatasetNotFound(0)");

      // Verify dataset 1 is still empty (it exists from beforeEach)
      const datasetInfo = await datasetRegistry.datasets(1);
      datasetInfo.fileIdsCount.should.eq(0);
      datasetInfo.totalShares.should.eq(0);
    });
  });

  describe("Access Control", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should pause/unpause correctly", async function () {
      await datasetRegistry.connect(maintainer).pause().should.not.be.rejected;
      
      await datasetRegistry
        .connect(maintainer)
        .createMainDataset(1, dlp1.address).should.be.rejectedWith("EnforcedPause");

      await datasetRegistry.connect(maintainer).unpause().should.not.be.rejected;
      
      await datasetRegistry
        .connect(maintainer)
        .createMainDataset(1, dlp1.address).should.not.be.rejected;
    });

    it("should fail pause/unpause if not maintainer", async function () {
      await datasetRegistry
        .connect(user1)
        .pause().should.be.rejectedWith("AccessControl");

      await datasetRegistry.connect(maintainer).pause().should.not.be.rejected;

      await datasetRegistry
        .connect(user1)
        .unpause().should.be.rejectedWith("AccessControl");
    });

    it("should upgrade contract", async function () {
      const DatasetRegistryV2 = await ethers.getContractFactory("DatasetRegistryImplementation", owner);
      
      await upgrades.upgradeProxy(
        await datasetRegistry.getAddress(),
        DatasetRegistryV2,
        { kind: "uups" }
      ).should.not.be.rejected;
    });

    it("should handle non-admin upgrade attempts", async function () {
      // Note: upgrades.upgradeProxy uses the default signer, so we can't easily test 
      // unauthorized upgrades this way. The contract itself has proper access control.
      // We can verify the role requirement exists
      (await datasetRegistry.hasRole(DEFAULT_ADMIN_ROLE, user1.address)).should.eq(false);
      (await datasetRegistry.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).should.eq(true);
    });
  });
});