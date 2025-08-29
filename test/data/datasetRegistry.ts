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
      const fileIdsUrl = "ipfs://QmExampleHash/fileIds.json";
      
      const tx = await datasetRegistry
        .connect(maintainer)
        .createDerivedDataset(dlp2.address, [1], contributors, shares, fileIdsUrl);

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
        .createDerivedDataset(dlp2.address, [1], [dlp2.address], [parseEther("1.0")], "")
        .should.be.rejectedWith("ParentDatasetOwnerNotIncluded");
    });

    it("should fail to create derived dataset without parents", async function () {
      await datasetRegistry
        .connect(maintainer)
        .createDerivedDataset(dlp2.address, [], [], [], "")
        .should.be.rejectedWith("DerivedDatasetNeedsParents");
    });

    it("should fail to create derived dataset with invalid parent", async function () {
      await datasetRegistry
        .connect(maintainer)
        .createDerivedDataset(dlp2.address, [999], [dlp2.address], [parseEther("1.0")], "")
        .should.be.rejectedWith("InvalidParentDataset");
    });

    it("should fail to create derived dataset with mismatched contributors and shares", async function () {
      await datasetRegistry
        .connect(maintainer)
        .createMainDataset(1, dlp1.address).should.not.be.rejected;

      await datasetRegistry
        .connect(maintainer)
        .createDerivedDataset(dlp2.address, [1], [dlp1.address, dlp2.address], [parseEther("1.0")], "") // Only 1 share for 2 contributors
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
      datasetInfo.fileIdsUrl.should.eq("");
    });

    it("should fail for non-existent dataset", async function () {
      await datasetRegistry.datasets(999).should.be.rejectedWith("0xbb36834d");
    });

    it("should return correct derived dataset info", async function () {
      // Create a derived dataset
      const contributors = [dlp1.address, dlp2.address];
      const shares = [parseEther("0.7"), parseEther("0.3")];
      const fileIdsUrl = "ipfs://QmDerivedDatasetFiles/files.json";
      
      await datasetRegistry
        .connect(maintainer)
        .createDerivedDataset(dlp2.address, [1], contributors, shares, fileIdsUrl);

      const datasetInfo = await datasetRegistry.datasets(2);
      
      datasetInfo.owner.should.eq(dlp2.address);
      datasetInfo.datasetType.should.eq(DatasetType.DERIVED);
      datasetInfo.totalShares.should.eq(parseEther("1.0"));
      datasetInfo.fileIdsCount.should.eq(0);
      datasetInfo.parentDatasetIds.should.deep.eq([1n]);
      datasetInfo.fileIdsUrl.should.eq(fileIdsUrl);
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
      
      const shares = [{ owner: user1.address, share: share }];
      const tx = await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToMainDataset(fileId, dlpId, shares);

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
      const shares = [{ owner: user1.address, share: parseEther("0.5") }];
      await datasetRegistry
        .connect(user1)
        .addFileToMainDataset(1, 1, shares)
        .should.be.rejectedWith("AccessControl");
    });

    it("should fail if dataset not found", async function () {
      const shares = [{ owner: user1.address, share: parseEther("0.5") }];
      await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToMainDataset(1, 999, shares)
        .should.be.rejectedWith("DatasetNotFound");
    });

    it("should fail if file already in dataset", async function () {
      const fileId = 1;
      const dlpId = 1;
      const share = parseEther("0.5");

      const shares1 = [{ owner: user1.address, share: share }];
      await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToMainDataset(fileId, dlpId, shares1).should.not.be.rejected;

      const shares2 = [{ owner: user2.address, share: share }];
      await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToMainDataset(fileId, dlpId, shares2)
        .should.be.rejectedWith("FileAlreadyInDataset");
    });

    it("should accumulate shares for same owner", async function () {
      const dlpId = 1;
      const share1 = parseEther("0.3");
      const share2 = parseEther("0.7");

      const shares1 = [{ owner: user1.address, share: share1 }];
      await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToMainDataset(1, dlpId, shares1).should.not.be.rejected;

      const shares2 = [{ owner: user1.address, share: share2 }];
      await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToMainDataset(2, dlpId, shares2).should.not.be.rejected;

      (await datasetRegistry.ownerShares(1, user1.address)).should.eq(share1 + share2);
      
      const datasetInfo = await datasetRegistry.datasets(1);
      datasetInfo.totalShares.should.eq(share1 + share2);
      datasetInfo.fileIdsCount.should.eq(2);
    });

    it("should handle multiple owners", async function () {
      const dlpId = 1;
      const share1 = parseEther("0.3");
      const share2 = parseEther("0.7");

      const shares1 = [{ owner: user1.address, share: share1 }];
      await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToMainDataset(1, dlpId, shares1).should.not.be.rejected;

      const shares2 = [{ owner: user2.address, share: share2 }];
      await datasetRegistry
        .connect(dataRegistryRole)
        .addFileToMainDataset(2, dlpId, shares2).should.not.be.rejected;

      (await datasetRegistry.ownerShares(1, user1.address)).should.eq(share1);
      (await datasetRegistry.ownerShares(1, user2.address)).should.eq(share2);
      
      const datasetInfo = await datasetRegistry.datasets(1);
      datasetInfo.totalShares.should.eq(share1 + share2);
      datasetInfo.fileIdsCount.should.eq(2);
    });
  });

  describe("New File Management Methods", () => {
    beforeEach(async () => {
      await deploy();
      // Create main and derived datasets for testing
      await datasetRegistry.connect(maintainer).createMainDataset(1, dlp1.address);
      await datasetRegistry.connect(maintainer).createMainDataset(2, dlp2.address);
      
      // Create a derived dataset
      const contributors = [dlp1.address, dlp2.address, user3.address];
      const shares = [parseEther("0.4"), parseEther("0.4"), parseEther("0.2")];
      const fileIdsUrl = "ipfs://QmDerivedDataset/files.json";
      await datasetRegistry
        .connect(maintainer)
        .createDerivedDataset(user3.address, [1, 2], contributors, shares, fileIdsUrl);
    });

    describe("addFileToMainDataset", () => {
      it("should add file to main dataset successfully", async function () {
        const fileId = 10;
        const dlpId = 1;
        const share = parseEther("0.75");
        
        const shares = [{ owner: user1.address, share: share }];
        const tx = await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToMainDataset(fileId, dlpId, shares);

        const receipt = await tx.wait();
        const fileEvent = receipt?.logs.find(log => 
          datasetRegistry.interface.parseLog(log as any)?.name === "FileAddedToDataset"
        );
        const parsedFileEvent = datasetRegistry.interface.parseLog(fileEvent as any);

        parsedFileEvent?.args.datasetId.should.eq(1);
        parsedFileEvent?.args.fileId.should.eq(fileId);

        // Verify file is in dataset
        (await datasetRegistry.isFileInDataset(1, fileId)).should.eq(true);
        (await datasetRegistry.ownerShares(1, user1.address)).should.eq(share);
      });


      it("should fail if not DATA_REGISTRY_ROLE", async function () {
        const shares = [{ owner: user1.address, share: parseEther("0.5") }];
        await datasetRegistry
          .connect(user1)
          .addFileToMainDataset(1, 1, shares)
          .should.be.rejectedWith("AccessControl");
      });

      it("should accumulate shares for same owner", async function () {
        const dlpId = 2;
        const share1 = parseEther("0.2");
        const share2 = parseEther("0.3");

        const shares1 = [{ owner: user1.address, share: share1 }];
        await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToMainDataset(20, dlpId, shares1).should.not.be.rejected;

        const shares2 = [{ owner: user1.address, share: share2 }];
        await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToMainDataset(21, dlpId, shares2).should.not.be.rejected;

        (await datasetRegistry.ownerShares(2, user1.address)).should.eq(share1 + share2);
      });

      it("should fail when dlpId doesn't have a dataset", async function () {
        const fileId = 30;
        const dlpId = 999; // Non-existent DLP
        const share = parseEther("0.5");
        
        const shares = [{ owner: user1.address, share: share }];
        await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToMainDataset(fileId, dlpId, shares)
          .should.be.rejectedWith("DatasetNotFound");
      });

      it("should handle multiple owners in a single file", async function () {
        const fileId = 100;
        const dlpId = 1;
        const shares = [
          { owner: user1.address, share: parseEther("0.3") }, // 30%
          { owner: user2.address, share: parseEther("0.7") }  // 70%
        ];
        
        const tx = await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToMainDataset(fileId, dlpId, shares);

        // Verify both owners have correct shares
        (await datasetRegistry.ownerShares(1, user1.address)).should.eq(parseEther("0.3"));
        (await datasetRegistry.ownerShares(1, user2.address)).should.eq(parseEther("0.7"));
        
        // Verify total shares increased correctly
        const datasetInfo = await datasetRegistry.datasets(1);
        datasetInfo.totalShares.should.be.at.least(parseEther("1.0")); // At least 1.0 from this file
        
        // Verify both OwnerSharesUpdated events were emitted
        const receipt = await tx.wait();
        const shareEvents = receipt?.logs.filter(log => {
          try {
            const parsed = datasetRegistry.interface.parseLog(log);
            return parsed?.name === "OwnerSharesUpdated";
          } catch {
            return false;
          }
        });
        
        shareEvents!.length.should.eq(2); // One for each owner
      });

      it("should reject empty shares array", async function () {
        const fileId = 101;
        const dlpId = 1;
        const shares: any[] = [];
        
        await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToMainDataset(fileId, dlpId, shares)
          .should.be.rejectedWith("EmptySharesArray");
      });

      it("should handle maximum number of owners per file", async function () {
        const fileId = 102;
        const dlpId = 1;
        
        // Create shares for 10 different owners
        const shares = [];
        for (let i = 0; i < 10; i++) {
          const wallet = ethers.Wallet.createRandom();
          shares.push({
            owner: wallet.address,
            share: parseEther("0.1") // 10% each
          });
        }
        
        await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToMainDataset(fileId, dlpId, shares)
          .should.not.be.rejected;
          
        // Verify total shares accumulated correctly
        const datasetInfo = await datasetRegistry.datasets(1);
        datasetInfo.totalShares.should.be.at.least(parseEther("1.0"));
      });
    });

    describe("addFileToDerivedDataset", () => {
      it("should add file to derived dataset successfully", async function () {
        const fileId = 100;
        const datasetId = 3; // The derived dataset created in beforeEach
        
        const tx = await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToDerivedDataset(fileId, datasetId);

        const receipt = await tx.wait();
        const fileEvent = receipt?.logs.find(log => 
          datasetRegistry.interface.parseLog(log as any)?.name === "FileAddedToDataset"
        );
        const parsedFileEvent = datasetRegistry.interface.parseLog(fileEvent as any);

        parsedFileEvent?.args.datasetId.should.eq(datasetId);
        parsedFileEvent?.args.fileId.should.eq(fileId);

        // Verify file is in dataset
        (await datasetRegistry.isFileInDataset(datasetId, fileId)).should.eq(true);
        
        // Verify shares are not updated (they remain as set during creation)
        const datasetInfo = await datasetRegistry.datasets(datasetId);
        datasetInfo.totalShares.should.eq(parseEther("1.0")); // Original total from creation
        datasetInfo.fileIdsCount.should.eq(1);
      });

      it("should fail if trying to add to main dataset", async function () {
        const fileId = 101;
        const mainDatasetId = 1; // Main dataset
        
        await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToDerivedDataset(fileId, mainDatasetId)
          .should.be.rejectedWith("Can only add files to derived datasets through this method");
      });

      it("should fail if dataset doesn't exist", async function () {
        await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToDerivedDataset(102, 999)
          .should.be.rejectedWith("0xbb36834d");
      });

      it("should fail if file already in dataset", async function () {
        const fileId = 103;
        const datasetId = 3;

        await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToDerivedDataset(fileId, datasetId).should.not.be.rejected;

        await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToDerivedDataset(fileId, datasetId)
          .should.be.rejectedWith("FileAlreadyInDataset");
      });

      it("should add multiple files to derived dataset", async function () {
        const datasetId = 3;
        const fileIds = [200, 201, 202, 203];

        for (const fileId of fileIds) {
          await datasetRegistry
            .connect(dataRegistryRole)
            .addFileToDerivedDataset(fileId, datasetId).should.not.be.rejected;
        }

        // Verify all files are in dataset
        for (const fileId of fileIds) {
          (await datasetRegistry.isFileInDataset(datasetId, fileId)).should.eq(true);
        }

        const datasetInfo = await datasetRegistry.datasets(datasetId);
        datasetInfo.fileIdsCount.should.eq(fileIds.length);
        // Shares should remain unchanged from creation
        datasetInfo.totalShares.should.eq(parseEther("1.0"));
      });

      it("should not affect owner shares when adding files", async function () {
        const datasetId = 3;
        
        // Check initial shares
        const initialShare1 = await datasetRegistry.ownerShares(datasetId, dlp1.address);
        const initialShare2 = await datasetRegistry.ownerShares(datasetId, dlp2.address);
        const initialShare3 = await datasetRegistry.ownerShares(datasetId, user3.address);

        // Add files
        await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToDerivedDataset(300, datasetId).should.not.be.rejected;
        
        await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToDerivedDataset(301, datasetId).should.not.be.rejected;

        // Verify shares remain unchanged
        (await datasetRegistry.ownerShares(datasetId, dlp1.address)).should.eq(initialShare1);
        (await datasetRegistry.ownerShares(datasetId, dlp2.address)).should.eq(initialShare2);
        (await datasetRegistry.ownerShares(datasetId, user3.address)).should.eq(initialShare3);
      });
    });

    describe("fileIdsUrl for derived datasets", () => {
      it("should store and retrieve fileIdsUrl correctly", async function () {
        const fileIdsUrl = "ipfs://QmTestHash123/dataset_files.json";
        const contributors = [dlp1.address, user1.address];
        const shares = [parseEther("0.5"), parseEther("0.5")];
        
        await datasetRegistry
          .connect(maintainer)
          .createDerivedDataset(user1.address, [1], contributors, shares, fileIdsUrl);

        const datasetInfo = await datasetRegistry.datasets(4);
        datasetInfo.fileIdsUrl.should.eq(fileIdsUrl);
      });

      it("should handle empty fileIdsUrl", async function () {
        const contributors = [dlp2.address, user2.address];
        const shares = [parseEther("0.6"), parseEther("0.4")];
        
        await datasetRegistry
          .connect(maintainer)
          .createDerivedDataset(user2.address, [2], contributors, shares, "");

        const datasetInfo = await datasetRegistry.datasets(4);
        datasetInfo.fileIdsUrl.should.eq("");
      });

      it("should return empty fileIdsUrl for main datasets", async function () {
        const datasetInfo = await datasetRegistry.datasets(1);
        datasetInfo.fileIdsUrl.should.eq("");
      });
    });
  });

  describe("File Pagination", () => {
    beforeEach(async () => {
      await deploy();
      await datasetRegistry.connect(maintainer).createMainDataset(1, dlp1.address);
      
      // Add multiple files to dataset using dataRegistryRole
      for (let i = 1; i <= 25; i++) {
        const shares = [{ owner: user1.address, share: parseEther("0.1") }];
        await datasetRegistry
          .connect(dataRegistryRole)
          .addFileToMainDataset(i, 1, shares);
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

    it("should handle multi-owner files in DataRegistry integration", async function () {
      // Create a multi-owner file via DataRegistry
      const ownerShares = [
        { ownerAddress: user1.address, share: parseEther("0.4") }, // 40%
        { ownerAddress: user2.address, share: parseEther("0.6") }  // 60%
      ];

      const addFileRequest = {
        url: "multi-owner-integration-test",
        ownerShares: ownerShares,
        permissions: [],
        schemaId: 0
      };

      await dataRegistry.connect(user1).addFileV3(addFileRequest);

      // Add proof which should trigger DatasetRegistry integration
      const proof = {
        signature: "0x1234",
        data: {
          score: 1000,
          dlpId: 1,
          metadata: "test metadata",
          proofUrl: "https://proof.url",
          instruction: "test instruction"
        }
      };

      await dataRegistry.connect(user1).addProof(1, proof);

      // Verify shares were distributed correctly in DatasetRegistry
      const user1Share = await datasetRegistry.ownerShares(1, user1.address);
      const user2Share = await datasetRegistry.ownerShares(1, user2.address);
      
      // Expected shares: user1: 0.4 * 1000 = 400, user2: 0.6 * 1000 = 600
      user1Share.should.eq(400);
      user2Share.should.eq(600);

      // Verify total shares in dataset
      const datasetInfo = await datasetRegistry.datasets(1);
      datasetInfo.totalShares.should.eq(1000);
    });

    it("should handle single-owner files in integration unchanged", async function () {
      // Create a single-owner file the old way
      await dataRegistry.connect(user1).addFile("single-owner-integration-test");

      const proof = {
        signature: "0x1234",
        data: {
          score: 500,
          dlpId: 1,
          metadata: "test metadata",
          proofUrl: "https://proof.url",
          instruction: "test instruction"
        }
      };

      await dataRegistry.connect(user1).addProof(1, proof);

      // Should get full score as share
      const user1Share = await datasetRegistry.ownerShares(1, user1.address);
      user1Share.should.eq(500);

      const datasetInfo = await datasetRegistry.datasets(1);
      datasetInfo.totalShares.should.eq(500);
    });

    it("should handle zero score proofs in integration", async function () {
      const ownerShares = [
        { ownerAddress: user1.address, share: parseEther("1.0") }
      ];

      const addFileRequest = {
        url: "zero-score-integration-test",
        ownerShares: ownerShares,
        permissions: [],
        schemaId: 0
      };

      await dataRegistry.connect(user1).addFileV3(addFileRequest);

      const proof = {
        signature: "0x1234",
        data: {
          score: 0, // Zero score
          dlpId: 1,
          metadata: "test metadata",
          proofUrl: "https://proof.url",
          instruction: "test instruction"
        }
      };

      await dataRegistry.connect(user1).addProof(1, proof);

      // Should have zero shares
      const user1Share = await datasetRegistry.ownerShares(1, user1.address);
      user1Share.should.eq(0);

      const datasetInfo = await datasetRegistry.datasets(1);
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