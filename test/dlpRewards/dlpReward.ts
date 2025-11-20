import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, network, upgrades } from "hardhat";
import {
  DLPRegistryImplementation,
  VanaEpochImplementation,
  TreasuryImplementation,
  DLPPerformanceImplementation,
  DLPRewardDeployerImplementation,
  DLPRewardSwapImplementation,
  DLPRewardSwapImplementationMock,
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  advanceBlockNTimes,
  advanceToBlockN,
  getCurrentBlockNumber,
} from "../../utils/timeAndBlockManipulation";
import { getReceipt, parseEther } from "../../utils/helpers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

chai.use(chaiAsPromised);
should();

describe("DLP System Tests", () => {
  enum DlpStatus {
    None,
    Registered,
    Eligible,
    Deregistered,
  }

  let admin: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let manager: HardhatEthersSigner;
  let dlp1Owner: HardhatEthersSigner;
  let dlp2Owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let token1: HardhatEthersSigner;
  let token2: HardhatEthersSigner;
  let token3: HardhatEthersSigner;
  let token4: HardhatEthersSigner;
  let token5: HardhatEthersSigner;
  let rewardDeployer: HardhatEthersSigner;

  let dlpRegistry: DLPRegistryImplementation;
  let vanaEpoch: VanaEpochImplementation;
  let dlpRegistryTreasury: TreasuryImplementation;
  let dlpPerformance: DLPPerformanceImplementation;
  let dlpRewardDeployer: DLPRewardDeployerImplementation;
  let dlpRewardSwap: DLPRewardSwapImplementationMock;
  let dlpRewardDeployerTreasury: TreasuryImplementation;

  // Configuration constants
  const DLP_REGISTRATION_DEPOSIT = parseEther(1); // 1 VANA
  const EPOCH_START_BLOCK = 100; // blocks
  const DAY_SIZE = 100; // blocks
  const EPOCH_SIZE = 10; // days
  const EPOCH_REWARD_AMOUNT = parseEther(10); // 10 VANA

  const MAXIMUM_SLIPPAGE = parseEther(10); // 10%
  const REWARD_PERCENTAGE = parseEther(60); // 60%
  const NUMBER_OF_TRANCHES = 90n;

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );
  const MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MANAGER_ROLE"));
  const CUSTODIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CUSTODIAN_ROLE"));
  const REWARD_DEPLOYER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("REWARD_DEPLOYER_ROLE"),
  );
  const DLP_REWARD_DEPLOYER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("DLP_REWARD_DEPLOYER_ROLE"),
  );

  type DlpRegistration = {
    dlpAddress: string;
    ownerAddress: HardhatEthersSigner;
    treasuryAddress: string;
    name: string;
    iconUrl: string;
    website: string;
    metadata: string;
  };

  type DlpPerformanceInput = {
    dlpId: number;
    tradingVolume: bigint;
    uniqueContributors: bigint;
    dataAccessFees: bigint;
    tradingVolumeScore: bigint;
    uniqueContributorsScore: bigint;
    dataAccessFeesScore: bigint;
  };

  let dlp1Info: DlpRegistration;
  let dlp2Info: DlpRegistration;

  const deploy = async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });

    [
      admin,
      maintainer,
      manager,
      user1,
      user2,
      token1,
      token2,
      token3,
      token4,
      token5,
      dlp1Owner,
      dlp2Owner,
      rewardDeployer,
    ] = await ethers.getSigners();

    // Deploy DLPRegistry
    const dlpRegistryDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DLPRegistryImplementation"),
      [admin.address],
      {
        kind: "uups",
      },
    );

    dlpRegistry = await ethers.getContractAt(
      "DLPRegistryImplementation",
      dlpRegistryDeploy.target,
    );

    // Deploy Treasury
    const dlpRegistryTreasuryDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("TreasuryImplementation"),
      [admin.address, dlpRegistry.target],
      {
        kind: "uups",
      },
    );

    dlpRegistryTreasury = await ethers.getContractAt(
      "TreasuryImplementation",
      dlpRegistryTreasuryDeploy.target,
    );

    // Deploy VanaEpoch with parameters
    const vanaEpochDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("VanaEpochImplementation"),
      [
        {
          ownerAddress: admin.address,
          dlpRegistryAddress: dlpRegistry.target,
          daySize: DAY_SIZE,
          epochSize: EPOCH_SIZE,
          epochRewardAmount: EPOCH_REWARD_AMOUNT,
        },
      ],
      {
        kind: "uups",
      },
    );

    vanaEpoch = await ethers.getContractAt(
      "VanaEpochImplementation",
      vanaEpochDeploy.target,
    );

    // Deploy DLPPerformance
    const dlpPerformanceDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DLPPerformanceImplementation"),
      [admin.address, dlpRegistry.target],
      {
        kind: "uups",
      },
    );

    dlpPerformance = await ethers.getContractAt(
      "DLPPerformanceImplementation",
      dlpPerformanceDeploy.target,
    );

    dlpRewardSwap = await ethers.deployContract(
      "DLPRewardSwapImplementationMock",
      [],
    );

    const dlpRewardDeployerDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DLPRewardDeployerImplementation"),
      [
        admin.address,
        dlpRegistry.target,
        vanaEpoch.target,
        dlpRewardSwap.target,
        NUMBER_OF_TRANCHES,
        REWARD_PERCENTAGE,
        MAXIMUM_SLIPPAGE,
      ],
      {
        kind: "uups",
      },
    );

    dlpRewardDeployer = await ethers.getContractAt(
      "DLPRewardDeployerImplementation",
      dlpRewardDeployerDeploy.target,
    );

    const dlpRewardDeployerTreasuryDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("TreasuryImplementation"),
      [admin.address, dlpRewardDeployer.target],
      {
        kind: "uups",
      },
    );

    dlpRewardDeployerTreasury = await ethers.getContractAt(
      "TreasuryImplementation",
      dlpRewardDeployerTreasuryDeploy.target,
    );

    // Configure contracts
    await dlpRegistry
      .connect(admin)
      .updateDlpRegistrationDepositAmount(DLP_REGISTRATION_DEPOSIT);
    await dlpRegistry.connect(admin).updateVanaEpoch(vanaEpoch.target);
    await dlpRegistry.connect(admin).updateTreasury(dlpRegistryTreasury.target);

    await dlpRewardDeployer
      .connect(admin)
      .updateTreasury(dlpRewardDeployerTreasury.target);
    await dlpRegistry
      .connect(admin)
      .updateTreasury(dlpRegistryTreasuryDeploy.target);

    await dlpPerformance.connect(admin).updateVanaEpoch(vanaEpoch.target);
    await vanaEpoch.connect(admin).updateDlpPerformance(dlpPerformance.target);
    await vanaEpoch
      .connect(admin)
      .updateDlpRewardDeployer(dlpRewardDeployer.target);

    // Set default metric weights (must sum to 1e18)
    await dlpPerformance.connect(admin).updateMetricWeights({
      tradingVolume: parseEther("0.3"),
      uniqueContributors: parseEther("0.3"),
      dataAccessFees: parseEther("0.4"),
    });

    // Set up roles
    await dlpRegistry.connect(admin).grantRole(MAINTAINER_ROLE, maintainer);
    await vanaEpoch.connect(admin).grantRole(MAINTAINER_ROLE, maintainer);
    await vanaEpoch
      .connect(admin)
      .grantRole(DLP_REWARD_DEPLOYER_ROLE, rewardDeployer);
    await vanaEpoch
      .connect(admin)
      .grantRole(DLP_REWARD_DEPLOYER_ROLE, dlpRewardDeployer.target);
    await dlpPerformance.connect(admin).grantRole(MAINTAINER_ROLE, maintainer);
    await dlpPerformance.connect(admin).grantRole(MANAGER_ROLE, manager);
    await dlpRewardDeployer
      .connect(admin)
      .grantRole(MAINTAINER_ROLE, maintainer);
    await dlpRewardDeployer
      .connect(admin)
      .grantRole(REWARD_DEPLOYER_ROLE, rewardDeployer);

    // Prepare DLP info
    dlp1Info = {
      dlpAddress: "0x0000000000000000000000000000000000000001",
      ownerAddress: dlp1Owner,
      treasuryAddress: dlp1Owner.address, // Using same address for simplicity
      name: "Test DLP 1",
      iconUrl: "https://example.com/icon1.png",
      website: "https://example.com",
      metadata: "Test DLP 1 metadata",
    };

    dlp2Info = {
      dlpAddress: "0x0000000000000000000000000000000000000002",
      ownerAddress: dlp2Owner,
      treasuryAddress: dlp2Owner.address, // Using same address for simplicity
      name: "Test DLP 2",
      iconUrl: "https://example.com/icon2.png",
      website: "https://example2.com",
      metadata: "Test DLP 2 metadata",
    };

    await vanaEpoch.updateEpoch(0, 0, EPOCH_START_BLOCK - 1, 0, [], true);
    // await vanaEpoch.updateEpoch(1, EPOCH_START_BLOCK, EPOCH_START_BLOCK + DAY_SIZE * EPOCH_SIZE, EPOCH_REWARD_AMOUNT, [], false);

    // Set lastEpoch to a high number to allow tests to create multiple epochs
    // Individual tests can override this if they need to test the lastEpoch limit
    await vanaEpoch.connect(admin).setLastEpoch(1000);
  };

  async function advanceToEpochN(epochNumber: number) {
    const epochNStartBlock =
      EPOCH_START_BLOCK + (epochNumber - 1) * DAY_SIZE * EPOCH_SIZE;

    await advanceToBlockN(epochNStartBlock);
  }

  describe("Setup", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should have correct params after deploy", async function () {
      // DLPRegistry checks
      (await dlpRegistry.hasRole(DEFAULT_ADMIN_ROLE, admin)).should.eq(true);
      (await dlpRegistry.hasRole(MAINTAINER_ROLE, admin)).should.eq(true);
      (await dlpRegistry.hasRole(MAINTAINER_ROLE, maintainer)).should.eq(true);
      (await dlpRegistry.dlpRegistrationDepositAmount()).should.eq(
        DLP_REGISTRATION_DEPOSIT,
      );
      (await dlpRegistry.vanaEpoch()).should.eq(vanaEpoch.target);
      (await dlpRegistry.treasury()).should.eq(dlpRegistryTreasury.target);
      (await dlpRegistry.dlpsCount()).should.eq(0);

      // VanaEpoch checks
      (await vanaEpoch.daySize()).should.eq(DAY_SIZE);
      (await vanaEpoch.epochSize()).should.eq(EPOCH_SIZE);
      (await vanaEpoch.epochRewardAmount()).should.eq(EPOCH_REWARD_AMOUNT);
      (await vanaEpoch.dlpRegistry()).should.eq(dlpRegistry.target);

      // Treasury checks
      (await dlpRegistryTreasury.custodian()).should.eq(dlpRegistry);
      (
        await dlpRegistryTreasury.hasRole(CUSTODIAN_ROLE, dlpRegistry)
      ).should.eq(true);

      // DLPPerformance checks
      (await dlpPerformance.dlpRegistry()).should.eq(dlpRegistry.target);
      (await dlpPerformance.hasRole(DEFAULT_ADMIN_ROLE, admin)).should.eq(true);
      (await dlpPerformance.hasRole(MAINTAINER_ROLE, admin)).should.eq(true);
      (await dlpPerformance.hasRole(MAINTAINER_ROLE, maintainer)).should.eq(
        true,
      );
      (await dlpPerformance.hasRole(MANAGER_ROLE, admin)).should.eq(true);
      (await dlpPerformance.hasRole(MANAGER_ROLE, manager)).should.eq(true);
      (await dlpPerformance.version()).should.eq(1);

      // DLPRewardDeployer checks
      (await dlpRewardDeployer.dlpRegistry()).should.eq(dlpRegistry.target);
      (await dlpRewardDeployer.vanaEpoch()).should.eq(vanaEpoch.target);
      (await dlpRewardDeployer.dlpRewardSwap()).should.eq(dlpRewardSwap.target);
      (await dlpRewardDeployer.rewardPercentage()).should.eq(REWARD_PERCENTAGE);
      (await dlpRewardDeployer.maximumSlippagePercentage()).should.eq(
        MAXIMUM_SLIPPAGE,
      );
      (await dlpRewardDeployer.hasRole(DEFAULT_ADMIN_ROLE, admin)).should.eq(
        true,
      );
      (await dlpRewardDeployer.hasRole(MAINTAINER_ROLE, admin)).should.eq(true);

      // DLPRewardDeployerTreasury checks
      (await dlpRewardDeployerTreasury.custodian()).should.eq(
        dlpRewardDeployer,
      );
      (
        await dlpRewardDeployerTreasury.hasRole(
          CUSTODIAN_ROLE,
          dlpRewardDeployer,
        )
      ).should.eq(true);
      (
        await dlpRewardDeployerTreasury.hasRole(DEFAULT_ADMIN_ROLE, admin)
      ).should.eq(true);
    });

    it("should initialize DLPPerformance correctly", async function () {
      // Check initialization values
      (await dlpPerformance.dlpRegistry()).should.eq(dlpRegistry.target);

      // Check role configuration
      (await dlpPerformance.hasRole(DEFAULT_ADMIN_ROLE, admin)).should.eq(true);
      (await dlpPerformance.hasRole(MAINTAINER_ROLE, maintainer)).should.eq(
        true,
      );
      (await dlpPerformance.hasRole(MANAGER_ROLE, manager)).should.eq(true);

      // Check that MAINTAINER_ROLE is admin of MANAGER_ROLE
      const managerRoleAdmin = await dlpPerformance.getRoleAdmin(MANAGER_ROLE);
      managerRoleAdmin.should.eq(MAINTAINER_ROLE);
    });

    it("should pause DLPPerformance when maintainer", async function () {
      await dlpPerformance
        .connect(maintainer)
        .pause()
        .should.emit(dlpPerformance, "Paused")
        .withArgs(maintainer.address);
      (await dlpPerformance.paused()).should.be.equal(true);
    });

    it("should reject pause DLPPerformance when non-maintainer", async function () {
      await dlpPerformance
        .connect(user1)
        .pause()
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
      (await dlpPerformance.paused()).should.be.equal(false);
    });

    it("should upgradeTo DLPPerformance when admin", async function () {
      await upgrades.upgradeProxy(
        dlpPerformance,
        await ethers.getContractFactory("DLPPerformanceImplementation", admin),
      );

      const version = await dlpPerformance.version();
      version.should.eq(1);
    });

    it("should reject upgradeTo DLPPerformance when non admin", async function () {
      const DLPPerformanceFactory = await ethers.getContractFactory(
        "DLPPerformanceImplementation",
        user1,
      );
      await upgrades
        .upgradeProxy(dlpPerformance, DLPPerformanceFactory)
        .should.be.rejectedWith("AccessControl");
    });
  });

  describe("DLPPerformance Configuration", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should updateDlpRegistry when maintainer", async function () {
      await dlpPerformance.connect(maintainer).updateDlpRegistry(user1.address);

      (await dlpPerformance.dlpRegistry()).should.eq(user1.address);
    });

    it("should reject updateDlpRegistry when non-maintainer", async function () {
      await dlpPerformance
        .connect(user1)
        .updateDlpRegistry(user2.address)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );

      (await dlpPerformance.dlpRegistry()).should.eq(dlpRegistry.target);
    });
  });

  describe("DLPPerformance - Epoch Performance Management", () => {
    beforeEach(async () => {
      await deploy();

      // Register and make DLPs eligible
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });
      await dlpRegistry
        .connect(dlp2Owner)
        .registerDlp(dlp2Info, { value: DLP_REGISTRATION_DEPOSIT });

      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(1, token1.address, 1);
      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(2, token2.address, 2);

      await dlpRegistry.connect(maintainer).updateDlpVerificationBlock(1, 1);
      await dlpRegistry.connect(maintainer).updateDlpVerificationBlock(2, 1);

      // Create epoch
      await vanaEpoch.connect(user1).createEpochs();
    });

    it("should save epoch performances", async function () {
      await advanceToEpochN(2);
      // Prepare performance data
      const dlpPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.3),
          uniqueContributorsScore: parseEther(0.3),
          dataAccessFeesScore: parseEther(0.4),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.7),
          uniqueContributorsScore: parseEther(0.7),
          dataAccessFeesScore: parseEther(0.6),
        },
      ];

      // Save performances without finalizing
      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances)
        .should.emit(dlpPerformance, "EpochDlpPerformancesSaved")
        .withArgs(
          1,
          1,
          parseEther(1000),
          50,
          parseEther(5),
          parseEther(0.3),
          parseEther(0.3),
          parseEther(0.4),
        )
        .and.emit(dlpPerformance, "EpochDlpPerformancesSaved")
        .withArgs(
          1,
          2,
          parseEther(2000),
          100,
          parseEther(10),
          parseEther(0.7),
          parseEther(0.7),
          parseEther(0.6),
        );

      // Check performance data saved correctly
      const dlp1Performance = await dlpPerformance.epochDlpPerformances(1, 1);
      dlp1Performance.tradingVolume.should.eq(parseEther(1000));
      dlp1Performance.uniqueContributors.should.eq(50);
      dlp1Performance.dataAccessFees.should.eq(parseEther(5));
      dlp1Performance.tradingVolumeScore.should.eq(parseEther(0.3));
      dlp1Performance.uniqueContributorsScore.should.eq(parseEther(0.3));
      dlp1Performance.dataAccessFeesScore.should.eq(parseEther(0.4));

      const dlp2Performance = await dlpPerformance.epochDlpPerformances(1, 2);
      dlp2Performance.tradingVolume.should.eq(parseEther(2000));
      dlp2Performance.uniqueContributors.should.eq(100);
      dlp2Performance.dataAccessFees.should.eq(parseEther(10));
      dlp2Performance.tradingVolumeScore.should.eq(parseEther(0.7));
      dlp2Performance.uniqueContributorsScore.should.eq(parseEther(0.7));
      dlp2Performance.dataAccessFeesScore.should.eq(parseEther(0.6));
    });

    it("should save and finalize epoch performances", async function () {
      await advanceToEpochN(2);
      // Prepare performance data
      const dlpPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.1),
          uniqueContributorsScore: parseEther(0.1),
          dataAccessFeesScore: parseEther(0.1),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.9),
          uniqueContributorsScore: parseEther(0.9),
          dataAccessFeesScore: parseEther(0.9),
        },
      ];

      // Save performances and finalize
      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances)
        .should.emit(dlpPerformance, "EpochDlpPerformancesSaved")
        .withArgs(
          1,
          1,
          parseEther(1000),
          50,
          parseEther(5),
          parseEther(0.1),
          parseEther(0.1),
          parseEther(0.1),
        )
        .and.emit(dlpPerformance, "EpochDlpPerformancesSaved")
        .withArgs(
          1,
          2,
          parseEther(2000),
          100,
          parseEther(10),
          parseEther(0.9),
          parseEther(0.9),
          parseEther(0.9),
        );
    });

    it("should reject saving performances to already finalized epoch", async function () {
      await advanceToEpochN(3);
      // Prepare performance data
      const dlpPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.4),
          uniqueContributorsScore: parseEther(0.3),
          dataAccessFeesScore: parseEther(0.3),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.6),
          uniqueContributorsScore: parseEther(0.7),
          dataAccessFeesScore: parseEther(0.7),
        },
      ];

      // Save performances
      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances);

      // Finalize the epoch by confirming scores
      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      // Try to save again - should fail because epoch is finalized
      const newPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1500),
          uniqueContributors: 75n,
          dataAccessFees: parseEther(7.5),
          tradingVolumeScore: parseEther(0.4),
          uniqueContributorsScore: parseEther(0.3),
          dataAccessFeesScore: parseEther(0.3),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2500),
          uniqueContributors: 125n,
          dataAccessFees: parseEther(12.5),
          tradingVolumeScore: parseEther(0.6),
          uniqueContributorsScore: parseEther(0.7),
          dataAccessFeesScore: parseEther(0.7),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, newPerformances)
        .should.be.rejectedWith("EpochAlreadyFinalized()");
    });

    it("should reject saving performances when not manager", async function () {
      const dlpPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.4),
          uniqueContributorsScore: parseEther(0.3),
          dataAccessFeesScore: parseEther(0.3),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.6),
          uniqueContributorsScore: parseEther(0.7),
          dataAccessFeesScore: parseEther(0.7),
        },
      ];

      await dlpPerformance
        .connect(user1)
        .saveEpochPerformances(1, dlpPerformances)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MANAGER_ROLE}")`,
        );
    });

    it("should save performance data for multiple epochs", async function () {
      // Mine blocks to go beyond epoch end
      const blocksToMine = EPOCH_SIZE * DAY_SIZE + 10;
      await advanceBlockNTimes(blocksToMine);

      // Create epoch 2
      await vanaEpoch.connect(user1).createEpochs();

      // Save performances for epoch 1
      const epoch1Performances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.4),
          uniqueContributorsScore: parseEther(0.3),
          dataAccessFeesScore: parseEther(0.3),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.6),
          uniqueContributorsScore: parseEther(0.7),
          dataAccessFeesScore: parseEther(0.7),
        },
      ];

      await advanceToEpochN(3);

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, epoch1Performances);

      // Save performances for epoch 2
      const epoch2Performances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1500),
          uniqueContributors: 75n,
          dataAccessFees: parseEther(7.5),
          tradingVolumeScore: parseEther(0.35),
          uniqueContributorsScore: parseEther(0.25),
          dataAccessFeesScore: parseEther(0.25),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2500),
          uniqueContributors: 125n,
          dataAccessFees: parseEther(12.5),
          tradingVolumeScore: parseEther(0.65),
          uniqueContributorsScore: parseEther(0.75),
          dataAccessFeesScore: parseEther(0.75),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(2, epoch2Performances);

      const dlp1Epoch1 = await dlpPerformance.epochDlpPerformances(1, 1);
      dlp1Epoch1.tradingVolumeScore.should.eq(parseEther(0.4));
      dlp1Epoch1.uniqueContributorsScore.should.eq(parseEther(0.3));
      dlp1Epoch1.dataAccessFeesScore.should.eq(parseEther(0.3));

      const dlp1Epoch2 = await dlpPerformance.epochDlpPerformances(2, 1);
      dlp1Epoch2.tradingVolumeScore.should.eq(parseEther(0.35));
      dlp1Epoch2.uniqueContributorsScore.should.eq(parseEther(0.25));
      dlp1Epoch2.dataAccessFeesScore.should.eq(parseEther(0.25));
    });

    it("should reject saving performances when paused", async function () {
      // Pause the contract
      await dlpPerformance.connect(maintainer).pause();

      const dlpPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.4),
          uniqueContributorsScore: parseEther(0.3),
          dataAccessFeesScore: parseEther(0.3),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.6),
          uniqueContributorsScore: parseEther(0.7),
          dataAccessFeesScore: parseEther(0.7),
        },
      ];
      await advanceToEpochN(2);

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances)
        .should.be.rejectedWith("EnforcedPause()");
    });

    it("should allow updating performance before finalizing", async function () {
      // Save initial performance data
      const initialPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.4),
          uniqueContributorsScore: parseEther(0.3),
          dataAccessFeesScore: parseEther(0.3),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.6),
          uniqueContributorsScore: parseEther(0.7),
          dataAccessFeesScore: parseEther(0.7),
        },
      ];

      await advanceToEpochN(2);

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, initialPerformances);

      // Update performance data
      const updatedPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1500),
          uniqueContributors: 75n,
          dataAccessFees: parseEther(7.5),
          tradingVolumeScore: parseEther(0.45),
          uniqueContributorsScore: parseEther(0.35),
          dataAccessFeesScore: parseEther(0.35),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2500),
          uniqueContributors: 125n,
          dataAccessFees: parseEther(12.5),
          tradingVolumeScore: parseEther(0.55),
          uniqueContributorsScore: parseEther(0.65),
          dataAccessFeesScore: parseEther(0.65),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, updatedPerformances);

      // Check updated data
      const updatedDlp1Performance = await dlpPerformance.epochDlpPerformances(
        1,
        1,
      );
      updatedDlp1Performance.tradingVolumeScore.should.eq(parseEther(0.45));
      updatedDlp1Performance.uniqueContributorsScore.should.eq(
        parseEther(0.35),
      );
      updatedDlp1Performance.dataAccessFeesScore.should.eq(parseEther(0.35));
      updatedDlp1Performance.tradingVolume.should.eq(parseEther(1500));
      updatedDlp1Performance.uniqueContributors.should.eq(75);
      updatedDlp1Performance.dataAccessFees.should.eq(parseEther(7.5));
    });

    it("should reject saving performances with duplicate dlpIds", async function () {
      await advanceToEpochN(2);

      const dlpPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
        {
          dlpId: 1, // Duplicate dlpId
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances)
        .should.be.rejectedWith("DuplicateDlpId(1)");
    });
  });

  describe("DLPPerformance Integration", () => {
    beforeEach(async () => {
      await deploy();

      // Register DLPs
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });
      await dlpRegistry
        .connect(dlp2Owner)
        .registerDlp(dlp2Info, { value: DLP_REGISTRATION_DEPOSIT });

      // Make DLPs eligible
      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(1, token1.address, 1);
      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(2, token2.address, 2);
      await dlpRegistry.connect(maintainer).updateDlpVerificationBlock(1, 1);
      await dlpRegistry.connect(maintainer).updateDlpVerificationBlock(2, 1);
    });

    it("should handle full epoch and performance flow", async function () {
      // Create epoch
      await vanaEpoch.connect(user1).createEpochs();

      // Mine blocks to go beyond epoch end
      const blocksToMine = EPOCH_SIZE * DAY_SIZE + 10;
      await advanceBlockNTimes(blocksToMine);

      // Create epoch 2
      await vanaEpoch.connect(user1).createEpochs();

      // Save and finalize performance data for epoch 1
      const epoch1Performances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.6),
          uniqueContributorsScore: parseEther(0.2),
          dataAccessFeesScore: parseEther(0.2),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.4),
          uniqueContributorsScore: parseEther(0.8),
          dataAccessFeesScore: parseEther(0.8),
        },
      ];

      await advanceToEpochN(2);

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, epoch1Performances);

      const dlp1Epoch1 = await dlpPerformance.epochDlpPerformances(1, 1);
      dlp1Epoch1.tradingVolumeScore.should.eq(parseEther(0.6));
      dlp1Epoch1.uniqueContributorsScore.should.eq(parseEther(0.2));
      dlp1Epoch1.dataAccessFeesScore.should.eq(parseEther(0.2));

      const dlp2Epoch1 = await dlpPerformance.epochDlpPerformances(1, 2);
      dlp2Epoch1.tradingVolumeScore.should.eq(parseEther(0.4));
      dlp2Epoch1.uniqueContributorsScore.should.eq(parseEther(0.8));
      dlp2Epoch1.dataAccessFeesScore.should.eq(parseEther(0.8));
    });
  });

  // Keep the other existing test sections...
  describe("Configuration", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should updateDlpRegistrationDepositAmount when maintainer", async function () {
      const newDepositAmount = parseEther(2);
      await dlpRegistry
        .connect(maintainer)
        .updateDlpRegistrationDepositAmount(newDepositAmount)
        .should.emit(dlpRegistry, "DlpRegistrationDepositAmountUpdated")
        .withArgs(newDepositAmount);

      (await dlpRegistry.dlpRegistrationDepositAmount()).should.eq(
        newDepositAmount,
      );
    });

    it("should reject updateDlpRegistrationDepositAmount when non-maintainer", async function () {
      const newDepositAmount = parseEther(2);
      await dlpRegistry
        .connect(user1)
        .updateDlpRegistrationDepositAmount(newDepositAmount)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );

      (await dlpRegistry.dlpRegistrationDepositAmount()).should.eq(
        DLP_REGISTRATION_DEPOSIT,
      );
    });

    it("should updateVanaEpoch when maintainer", async function () {
      await dlpRegistry.connect(maintainer).updateVanaEpoch(user1.address);

      (await dlpRegistry.vanaEpoch()).should.eq(user1.address);
    });

    it("should updateTreasury when maintainer", async function () {
      await dlpRegistry.connect(maintainer).updateTreasury(user1.address);

      (await dlpRegistry.treasury()).should.eq(user1.address);
    });

    it("should updateEpochSize when admin in VanaEpoch", async function () {
      const newEpochSize = 50;
      await vanaEpoch
        .connect(admin)
        .updateEpochSize(newEpochSize)
        .should.emit(vanaEpoch, "EpochSizeUpdated")
        .withArgs(newEpochSize);

      (await vanaEpoch.epochSize()).should.eq(newEpochSize);
    });

    it("should updateEpochRewardAmount when admin in VanaEpoch", async function () {
      const newRewardAmount = parseEther(20);
      await vanaEpoch
        .connect(admin)
        .updateEpochRewardAmount(newRewardAmount)
        .should.emit(vanaEpoch, "EpochRewardAmountUpdated")
        .withArgs(newRewardAmount);

      (await vanaEpoch.epochRewardAmount()).should.eq(newRewardAmount);
    });

    it("should updateCustodian when admin in Treasury", async function () {
      await dlpRegistryTreasury.connect(admin).updateCustodian(user1.address);

      (await dlpRegistryTreasury.custodian()).should.eq(user1.address);
      (
        await dlpRegistryTreasury.hasRole(CUSTODIAN_ROLE, dlpRegistry)
      ).should.eq(false);
      (await dlpRegistryTreasury.hasRole(CUSTODIAN_ROLE, user1)).should.eq(
        true,
      );
    });
  });

  describe("DLP Registration", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should registerDlp successfully", async function () {
      const blockNumber = await getCurrentBlockNumber();

      const tx = await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });

      const receipt = await getReceipt(tx);

      receipt.should
        .emit(dlpRegistry, "DlpRegistered")
        .withArgs(
          1,
          dlp1Info.dlpAddress,
          dlp1Info.ownerAddress.address,
          dlp1Info.treasuryAddress,
          dlp1Info.name,
          dlp1Info.iconUrl,
          dlp1Info.website,
          dlp1Info.metadata,
        )
        .and.emit(dlpRegistry, "DlpStatusUpdated")
        .withArgs(1, DlpStatus.Registered);

      (await dlpRegistry.dlpsCount()).should.eq(1);

      const dlp1 = await dlpRegistry.dlps(1);
      dlp1.id.should.eq(1);
      dlp1.dlpAddress.should.eq(dlp1Info.dlpAddress);
      dlp1.ownerAddress.should.eq(dlp1Info.ownerAddress.address);
      dlp1.treasuryAddress.should.eq(dlp1Info.treasuryAddress);
      dlp1.name.should.eq(dlp1Info.name);
      dlp1.iconUrl.should.eq(dlp1Info.iconUrl);
      dlp1.website.should.eq(dlp1Info.website);
      dlp1.metadata.should.eq(dlp1Info.metadata);
      dlp1.status.should.eq(DlpStatus.Registered);
      dlp1.verificationBlockNumber.should.eq(0);
      dlp1.registrationBlockNumber.should.eq(blockNumber + 1);

      (await dlpRegistry.dlpsByAddress(dlp1Info.dlpAddress)).should.deep.eq(
        dlp1,
      );
      (await dlpRegistry.dlpNameToId(dlp1Info.name)).should.deep.eq(1);
      (await dlpRegistry.dlpsByName(dlp1Info.name)).should.deep.eq(dlp1);

      // Check treasury received deposit
      (await ethers.provider.getBalance(dlpRegistryTreasury.target)).should.eq(
        DLP_REGISTRATION_DEPOSIT,
      );
    });

    it("should reject registerDlp when insufficient deposit", async function () {
      const insufficientDeposit = DLP_REGISTRATION_DEPOSIT - 1n;

      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: insufficientDeposit })
        .should.be.rejectedWith("InvalidDepositAmount");
    });

    it("should reject registerDlp when already registered", async function () {
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });

      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT })
        .should.be.rejectedWith("InvalidDlpStatus");
    });

    it("should reject registerDlp when name already taken", async function () {
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });

      const duplicateNameDlp = {
        ...dlp2Info,
        name: dlp1Info.name,
      };

      await dlpRegistry
        .connect(dlp2Owner)
        .registerDlp(duplicateNameDlp, { value: DLP_REGISTRATION_DEPOSIT })
        .should.be.rejectedWith("InvalidName");
    });

    it("should reject registerDlp with empty name", async function () {
      const invalidNameDlp = {
        ...dlp1Info,
        name: "",
      };

      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(invalidNameDlp, { value: DLP_REGISTRATION_DEPOSIT })
        .should.be.rejectedWith("InvalidName");
    });

    it("should updateDlp when owner", async function () {
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });

      const updatedDlp = {
        ...dlp1Info,
        ownerAddress: user1,
        treasuryAddress: user2.address,
        name: "Updated DLP 1",
        iconUrl: "https://updated.com/icon.png",
        website: "https://updated.com",
        metadata: "Updated metadata",
      };

      await dlpRegistry
        .connect(dlp1Owner)
        .updateDlp(1, updatedDlp)
        .should.emit(dlpRegistry, "DlpUpdated")
        .withArgs(
          1,
          updatedDlp.dlpAddress,
          updatedDlp.ownerAddress.address,
          updatedDlp.treasuryAddress,
          updatedDlp.name,
          updatedDlp.iconUrl,
          updatedDlp.website,
          updatedDlp.metadata,
        );

      const dlp1 = await dlpRegistry.dlps(1);
      dlp1.ownerAddress.should.eq(updatedDlp.ownerAddress.address);
      dlp1.treasuryAddress.should.eq(updatedDlp.treasuryAddress);
      dlp1.name.should.eq(updatedDlp.name);
      dlp1.iconUrl.should.eq(updatedDlp.iconUrl);
      dlp1.website.should.eq(updatedDlp.website);
      dlp1.metadata.should.eq(updatedDlp.metadata);
    });

    it("should reject updateDlp when not owner", async function () {
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });

      await dlpRegistry
        .connect(user1)
        .updateDlp(1, dlp1Info)
        .should.be.rejectedWith("NotDlpOwner");
    });

    it("should reject updateDlp when trying to change DLP address", async function () {
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });

      const updatedDlp = {
        ...dlp1Info,
        dlpAddress: "0x0000000000000000000000000000000000000003",
      };

      await dlpRegistry
        .connect(dlp1Owner)
        .updateDlp(1, updatedDlp)
        .should.be.rejectedWith("DlpAddressCannotBeChanged");
    });

    it("should deregisterDlp when owner", async function () {
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });

      await dlpRegistry
        .connect(dlp1Owner)
        .deregisterDlp(1)
        .should.emit(dlpRegistry, "DlpStatusUpdated")
        .withArgs(1, DlpStatus.Deregistered);

      const dlp1 = await dlpRegistry.dlps(1);
      dlp1.status.should.eq(DlpStatus.Deregistered);
    });

    it("should reject deregisterDlp when not owner", async function () {
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });

      await dlpRegistry
        .connect(user1)
        .deregisterDlp(1)
        .should.be.rejectedWith("NotDlpOwner");
    });

    it("should updateDlpToken when maintainer", async function () {
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });

      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(1, token1, 1)
        .should.emit(dlpRegistry, "DlpTokenUpdated")
        .withArgs(1, token1)
        .and.emit(dlpRegistry, "DlpLpTokenIdUpdated")
        .withArgs(1, 1);

      const dlp1 = await dlpRegistry.dlps(1);
      dlp1.tokenAddress.should.eq(token1);
    });

    it("should updateDlpVerificationBlock and change eligibility", async function () {
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });

      // Set token first
      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(1, token1.address, 1);

      // Verify DLP
      await dlpRegistry
        .connect(maintainer)
        .updateDlpVerificationBlock(1, 123)
        .should.emit(dlpRegistry, "DlpVerificationBlockUpdated")
        .withArgs(1, 123)
        .and.emit(dlpRegistry, "DlpStatusUpdated")
        .withArgs(1, DlpStatus.Eligible);

      let dlp1 = await dlpRegistry.dlps(1);
      dlp1.verificationBlockNumber.should.eq(123);
      dlp1.status.should.eq(DlpStatus.Eligible);

      // Should be in eligible list
      (await dlpRegistry.eligibleDlpsListCount()).should.eq(1);
      (await dlpRegistry.eligibleDlpsListAt(0)).should.eq(1);
      (await dlpRegistry.eligibleDlpsListValues()).should.deep.eq([1n]);

      // Remove verification
      await dlpRegistry
        .connect(maintainer)
        .updateDlpVerificationBlock(1, 0)
        .should.emit(dlpRegistry, "DlpVerificationBlockUpdated")
        .withArgs(1, 0)
        .and.emit(dlpRegistry, "DlpStatusUpdated")
        .withArgs(1, DlpStatus.Registered);

      dlp1 = await dlpRegistry.dlps(1);
      dlp1.verificationBlockNumber.should.eq(0);
      dlp1.status.should.eq(DlpStatus.Registered);

      // Should not be in eligible list
      (await dlpRegistry.eligibleDlpsListCount()).should.eq(0);
    });
  });

  describe("Epoch Creation", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should createEpochs properly", async function () {
      await advanceToEpochN(1);

      await vanaEpoch.connect(user1).createEpochs();

      (await vanaEpoch.epochsCount()).should.eq(1);

      const epoch1 = await vanaEpoch.epochs(1);
      const currentBlockNum = await ethers.provider.getBlockNumber();

      epoch1.startBlock.should.be.lte(currentBlockNum);
      epoch1.rewardAmount.should.eq(EPOCH_REWARD_AMOUNT);
    });

    it("should create multiple epochs when needed", async function () {
      await advanceToEpochN(1);
      // Create first epoch
      await vanaEpoch.connect(user1).createEpochs();
      const epoch1 = await vanaEpoch.epochs(1);

      await advanceToEpochN(2);

      // Create epochs again
      await vanaEpoch.connect(user1).createEpochs();

      (await vanaEpoch.epochsCount()).should.eq(2);

      const epoch2 = await vanaEpoch.epochs(2);
      epoch2.startBlock.should.eq(epoch1.endBlock + 1n);
      epoch2.rewardAmount.should.eq(EPOCH_REWARD_AMOUNT);
    });

    it("should createEpochsUntilBlockNumber properly", async function () {
      await advanceToEpochN(1);

      await vanaEpoch.connect(user1).createEpochs();

      // Should create 1 epoch (since we're still in epoch 1)
      (await vanaEpoch.epochsCount()).should.eq(1);

      // Mine blocks to create a need for more epochs
      await advanceBlockNTimes(EPOCH_SIZE * DAY_SIZE + 5);

      // Create epochs up to a specific block
      const specificBlock = (await ethers.provider.getBlockNumber()) + 10;
      await vanaEpoch
        .connect(user1)
        .createEpochsUntilBlockNumber(specificBlock);

      // Should now have 2 epochs
      (await vanaEpoch.epochsCount()).should.eq(2);
    });

    it("should setLastEpoch successfully", async function () {
      // Reset and deploy fresh contract
      await network.provider.request({
        method: "hardhat_reset",
        params: [],
      });

      [admin, maintainer, manager, user1, user2, token1, token2, token3, token4, token5, dlp1Owner, dlp2Owner, rewardDeployer] = await ethers.getSigners();

      const dlpRegistryDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory("DLPRegistryImplementation"),
        [admin.address],
        { kind: "uups" }
      );
      dlpRegistry = await ethers.getContractAt("DLPRegistryImplementation", dlpRegistryDeploy.target);

      const vanaEpochDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory("VanaEpochImplementation"),
        [{ ownerAddress: admin.address, dlpRegistryAddress: dlpRegistry.target, daySize: DAY_SIZE, epochSize: EPOCH_SIZE, epochRewardAmount: EPOCH_REWARD_AMOUNT }],
        { kind: "uups" }
      );
      vanaEpoch = await ethers.getContractAt("VanaEpochImplementation", vanaEpochDeploy.target);

      // Initially lastEpoch should be 0
      (await vanaEpoch.lastEpoch()).should.eq(0);

      // Set lastEpoch to 3 for testing
      await vanaEpoch.connect(admin).setLastEpoch(3);

      // Verify it was set
      (await vanaEpoch.lastEpoch()).should.eq(3);
    });

    it("should revert when trying to set lastEpoch twice", async function () {
      // lastEpoch was already set to 1000 in deploy, so this should revert
      await vanaEpoch
        .connect(admin)
        .setLastEpoch(7)
        .should.be.revertedWithCustomError(vanaEpoch, "LastEpochAlreadySet");
    });

    it("should revert when trying to set lastEpoch to 0", async function () {
      // Reset and deploy fresh contract
      await network.provider.request({
        method: "hardhat_reset",
        params: [],
      });

      [admin, maintainer, manager, user1, user2, token1, token2, token3, token4, token5, dlp1Owner, dlp2Owner, rewardDeployer] = await ethers.getSigners();

      const dlpRegistryDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory("DLPRegistryImplementation"),
        [admin.address],
        { kind: "uups" }
      );
      dlpRegistry = await ethers.getContractAt("DLPRegistryImplementation", dlpRegistryDeploy.target);

      const vanaEpochDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory("VanaEpochImplementation"),
        [{ ownerAddress: admin.address, dlpRegistryAddress: dlpRegistry.target, daySize: DAY_SIZE, epochSize: EPOCH_SIZE, epochRewardAmount: EPOCH_REWARD_AMOUNT }],
        { kind: "uups" }
      );
      vanaEpoch = await ethers.getContractAt("VanaEpochImplementation", vanaEpochDeploy.target);

      await vanaEpoch
        .connect(admin)
        .setLastEpoch(0)
        .should.be.revertedWithCustomError(vanaEpoch, "InvalidEpoch");
    });

    it("should revert when trying to create epoch beyond lastEpoch", async function () {
      // Reset and deploy fresh contract
      await network.provider.request({
        method: "hardhat_reset",
        params: [],
      });

      [admin, maintainer, manager, user1, user2, token1, token2, token3, token4, token5, dlp1Owner, dlp2Owner, rewardDeployer] = await ethers.getSigners();

      const dlpRegistryDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory("DLPRegistryImplementation"),
        [admin.address],
        { kind: "uups" }
      );
      dlpRegistry = await ethers.getContractAt("DLPRegistryImplementation", dlpRegistryDeploy.target);

      const vanaEpochDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory("VanaEpochImplementation"),
        [{ ownerAddress: admin.address, dlpRegistryAddress: dlpRegistry.target, daySize: DAY_SIZE, epochSize: EPOCH_SIZE, epochRewardAmount: EPOCH_REWARD_AMOUNT }],
        { kind: "uups" }
      );
      vanaEpoch = await ethers.getContractAt("VanaEpochImplementation", vanaEpochDeploy.target);

      await vanaEpoch.updateEpoch(0, 0, EPOCH_START_BLOCK - 1, 0, [], true);

      // Set lastEpoch to 2 for testing
      await vanaEpoch.connect(admin).setLastEpoch(2);

      // Create epochs up to the limit (epoch 2)
      await advanceToEpochN(1);
      await vanaEpoch.connect(user1).createEpochs(); // Creates epoch 1

      await advanceToEpochN(2);
      await vanaEpoch.connect(user1).createEpochs(); // Creates epoch 2

      // Verify we're at epoch 2
      (await vanaEpoch.epochsCount()).should.eq(2);

      // Advance blocks to trigger epoch 3 creation attempt
      await advanceToEpochN(3);

      // Should revert when trying to create epoch 3
      await vanaEpoch
        .connect(user1)
        .createEpochs()
        .should.be.revertedWithCustomError(vanaEpoch, "LastEpochExceeded")
        .withArgs(2);
    });

    it("should revert when trying to create epochs beyond lastEpoch using createEpochsUntilBlockNumber", async function () {
      // Reset and deploy fresh contract
      await network.provider.request({
        method: "hardhat_reset",
        params: [],
      });

      [admin, maintainer, manager, user1, user2, token1, token2, token3, token4, token5, dlp1Owner, dlp2Owner, rewardDeployer] = await ethers.getSigners();

      const dlpRegistryDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory("DLPRegistryImplementation"),
        [admin.address],
        { kind: "uups" }
      );
      dlpRegistry = await ethers.getContractAt("DLPRegistryImplementation", dlpRegistryDeploy.target);

      const vanaEpochDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory("VanaEpochImplementation"),
        [{ ownerAddress: admin.address, dlpRegistryAddress: dlpRegistry.target, daySize: DAY_SIZE, epochSize: EPOCH_SIZE, epochRewardAmount: EPOCH_REWARD_AMOUNT }],
        { kind: "uups" }
      );
      vanaEpoch = await ethers.getContractAt("VanaEpochImplementation", vanaEpochDeploy.target);

      await vanaEpoch.updateEpoch(0, 0, EPOCH_START_BLOCK - 1, 0, [], true);

      // Set lastEpoch to 2 for testing
      await vanaEpoch.connect(admin).setLastEpoch(2);

      // Create epochs up to the limit
      await advanceToEpochN(2);
      await vanaEpoch.connect(user1).createEpochs(); // Creates epochs 1 and 2

      // Advance blocks significantly (3 epochs worth)
      await advanceBlockNTimes(DAY_SIZE * EPOCH_SIZE * 3);
      const futureBlock = await getCurrentBlockNumber();

      // Should revert when trying to create epochs beyond 2
      await vanaEpoch
        .connect(user1)
        .createEpochsUntilBlockNumber(futureBlock)
        .should.be.revertedWithCustomError(vanaEpoch, "LastEpochExceeded")
        .withArgs(2);
    });
  });

  describe("Treasury Operations", () => {
    beforeEach(async () => {
      await deploy();

      // Send some ETH to treasury for testing
      await admin.sendTransaction({
        to: dlpRegistryTreasury.target,
        value: parseEther(10),
      });
    });

    it("should accept ETH transfers", async function () {
      const amount = parseEther(1);
      const balanceBefore = await ethers.provider.getBalance(
        dlpRegistryTreasury.target,
      );

      await user1.sendTransaction({
        to: dlpRegistryTreasury.target,
        value: amount,
      });

      const balanceAfter = await ethers.provider.getBalance(
        dlpRegistryTreasury.target,
      );
      (balanceAfter - balanceBefore).should.eq(amount);
    });

    it("should transfer ETH when custodian", async function () {
      const amount = parseEther(1);
      const recipientBalanceBefore = await ethers.provider.getBalance(
        user1.address,
      );

      await dlpRegistryTreasury
        .connect(admin)
        .transfer(
          user1.address,
          "0x0000000000000000000000000000000000000000",
          amount,
        )
        .should.emit(dlpRegistryTreasury, "Transfer")
        .withArgs(
          user1.address,
          "0x0000000000000000000000000000000000000000",
          amount,
        );

      const recipientBalanceAfter = await ethers.provider.getBalance(
        user1.address,
      );
      (recipientBalanceAfter - recipientBalanceBefore).should.eq(amount);
    });

    it("should reject transfer with zero amount", async function () {
      await dlpRegistryTreasury
        .connect(admin)
        .transfer(
          user1.address,
          "0x0000000000000000000000000000000000000000",
          0,
        )
        .should.be.rejectedWith("ZeroAmount");
    });

    it("should reject transfer when not custodian", async function () {
      await dlpRegistryTreasury
        .connect(user1)
        .transfer(
          user2.address,
          "0x0000000000000000000000000000000000000000",
          parseEther(1),
        )
        .should.be.rejectedWith("AccessControl");
    });
  });

  describe("DLP Bonus Rewards", () => {
    beforeEach(async () => {
      await deploy();

      // Register and make DLPs eligible
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });
      await dlpRegistry
        .connect(dlp2Owner)
        .registerDlp(dlp2Info, { value: DLP_REGISTRATION_DEPOSIT });

      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(1, token1.address, 1);
      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(2, token2.address, 2);

      await dlpRegistry.connect(maintainer).updateDlpVerificationBlock(1, 1);
      await dlpRegistry.connect(maintainer).updateDlpVerificationBlock(2, 1);

      // Advance to epoch 1 start block and create epoch
      await advanceToEpochN(1);
      await vanaEpoch.connect(user1).createEpochs();
    });

    it("should add bonus amount to DLP", async function () {
      const bonusAmount = parseEther(5);

      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 1, bonusAmount)
        .should.emit(vanaEpoch, "EpochDlpBonusUpdated")
        .withArgs(1, 1, 0, bonusAmount);

      const epochDlp = await vanaEpoch.epochDlps(1, 1);
      epochDlp.bonusAmount.should.eq(bonusAmount);

      // Check DLP is in bonus list
      const dlpIdsWithBonus = await vanaEpoch.epochDlpIdsWithBonus(1);
      dlpIdsWithBonus.should.include(1n);
    });

    it("should accumulate multiple bonus amounts for same DLP", async function () {
      const firstBonus = parseEther(3);
      const secondBonus = parseEther(2);
      const totalBonus = firstBonus + secondBonus;

      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 1, firstBonus)
        .should.emit(vanaEpoch, "EpochDlpBonusUpdated")
        .withArgs(1, 1, 0, firstBonus);

      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 1, secondBonus)
        .should.emit(vanaEpoch, "EpochDlpBonusUpdated")
        .withArgs(1, 1, firstBonus, totalBonus);

      const epochDlp = await vanaEpoch.epochDlps(1, 1);
      epochDlp.bonusAmount.should.eq(totalBonus);
    });

    it("should add bonus to multiple DLPs", async function () {
      const dlp1Bonus = parseEther(3);
      const dlp2Bonus = parseEther(4);

      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 1, dlp1Bonus);

      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 2, dlp2Bonus);

      const epochDlp1 = await vanaEpoch.epochDlps(1, 1);
      epochDlp1.bonusAmount.should.eq(dlp1Bonus);

      const epochDlp2 = await vanaEpoch.epochDlps(1, 2);
      epochDlp2.bonusAmount.should.eq(dlp2Bonus);

      // Check both DLPs are in bonus list
      const dlpIdsWithBonus = await vanaEpoch.epochDlpIdsWithBonus(1);
      dlpIdsWithBonus.should.include(1n);
      dlpIdsWithBonus.should.include(2n);
      dlpIdsWithBonus.length.should.eq(2);
    });

    it("should reject adding bonus when not DLP_REWARD_DEPLOYER_ROLE", async function () {
      const bonusAmount = parseEther(5);

      await vanaEpoch
        .connect(user1)
        .addEpochDlpBonusAmount(1, 1, bonusAmount)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${DLP_REWARD_DEPLOYER_ROLE}")`,
        );
    });

    it("should add bonus to non-participating DLP", async function () {
      // Add bonus to a DLP that hasn't participated in the epoch (no performance data)
      const bonusAmount = parseEther(5);

      // Register a third DLP
      const dlp3Info = {
        dlpAddress: "0x0000000000000000000000000000000000000003",
        ownerAddress: user1,
        treasuryAddress: user1.address,
        name: "Test DLP 3",
        iconUrl: "https://example.com/icon3.png",
        website: "https://example3.com",
        metadata: "Test DLP 3 metadata",
      };

      await dlpRegistry
        .connect(user1)
        .registerDlp(dlp3Info, { value: DLP_REGISTRATION_DEPOSIT });

      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(3, token3.address, 3);

      await dlpRegistry.connect(maintainer).updateDlpVerificationBlock(3, 1);

      // Add bonus without performance data
      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 3, bonusAmount)
        .should.emit(vanaEpoch, "EpochDlpBonusUpdated")
        .withArgs(1, 3, 0, bonusAmount);

      const epochDlp = await vanaEpoch.epochDlps(1, 3);
      epochDlp.bonusAmount.should.eq(bonusAmount);
    });

    it("should include bonus DLPs in epoch dlpIds after finalization", async function () {
      // Register DLP 3 before starting the epoch but don't verify it
      const dlp3Info = {
        dlpAddress: "0x0000000000000000000000000000000000000003",
        ownerAddress: user1,
        treasuryAddress: user1.address,
        name: "Test DLP 3",
        iconUrl: "https://example.com/icon3.png",
        website: "https://example3.com",
        metadata: "Test DLP 3 metadata",
      };

      await dlpRegistry
        .connect(user1)
        .registerDlp(dlp3Info, { value: DLP_REGISTRATION_DEPOSIT });

      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(3, token3.address, 3);

      // Don't verify DLP 3 yet, so it won't be eligible for regular rewards

      // Add bonus to DLP 3 (not eligible, no performance data) while epoch 1 is current
      const bonusAmount = parseEther(2);
      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 3, bonusAmount);

      await advanceToEpochN(2);

      // Save performance data for DLPs 1 and 2 (the only eligible ones)
      const dlpPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.4),
          uniqueContributorsScore: parseEther(0.4),
          dataAccessFeesScore: parseEther(0.4),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.6),
          uniqueContributorsScore: parseEther(0.6),
          dataAccessFeesScore: parseEther(0.6),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances);

      // Check before finalization
      let epochDlpIds = await vanaEpoch.epochDlpIds(1);
      epochDlpIds.should.not.include(3n);

      // Finalize the epoch
      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      // Check after finalization - DLP 3 should be included now (due to bonus)
      epochDlpIds = await vanaEpoch.epochDlpIds(1);
      epochDlpIds.should.include(1n);
      epochDlpIds.should.include(2n);
      epochDlpIds.should.include(3n);
      epochDlpIds.length.should.eq(3);
    });

    it("should handle bonus distribution with rewards", async function () {
      // Add bonus to DLP 1 first (while epoch 1 is current)
      const bonusAmount = parseEther(3);
      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 1, bonusAmount);

      await advanceToEpochN(2);

      // Save performance data
      const dlpPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.4),
          uniqueContributorsScore: parseEther(0.4),
          dataAccessFeesScore: parseEther(0.4),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.6),
          uniqueContributorsScore: parseEther(0.6),
          dataAccessFeesScore: parseEther(0.6),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances);

      // Finalize the epoch
      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      // Check that DLP 1 has both regular rewards and bonus
      const epochDlp1 = await vanaEpoch.epochDlps(1, 1);
      epochDlp1.rewardAmount.should.be.greaterThan(0);
      epochDlp1.bonusAmount.should.eq(bonusAmount);

      // DLP 2 should only have regular rewards
      const epochDlp2 = await vanaEpoch.epochDlps(1, 2);
      epochDlp2.rewardAmount.should.be.greaterThan(0);
      epochDlp2.bonusAmount.should.eq(0);
    });

    it("should not allow bonus addition to past epochs", async function () {
      await advanceToEpochN(2);

      // Save performance data and finalize epoch 1
      const dlpPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances);

      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      // Try to add bonus to past epoch (epoch 1) - should fail
      const bonusAmount = parseEther(5);

      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 1, bonusAmount)
        .should.be.rejectedWith("InvalidEpoch()");

      // But adding to current epoch should work
      await vanaEpoch.connect(user1).createEpochs();

      // The contract allows adding bonus only to epochsCount
      // After createEpochs(), epochsCount is 2, so we can only add to epoch 2
      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(2, 1, bonusAmount)
        .should.emit(vanaEpoch, "EpochDlpBonusUpdated")
        .withArgs(2, 1, 0, bonusAmount);
    });

    it("should track multiple epochs with different bonuses", async function () {
      // Add bonus for epoch 1 (current epoch)
      const epoch1Bonus = parseEther(2);
      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 1, epoch1Bonus);

      await advanceToEpochN(2);

      const epoch1Performances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, epoch1Performances);

      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      // Create epoch 2 and add bonuses to it (now current epoch)
      await vanaEpoch.connect(user1).createEpochs();

      // Add different bonuses for epoch 2 - but can only add to epochsCount
      // After createEpochs, epochsCount is 2, so we can only add to epoch 2
      const epoch2Dlp1Bonus = parseEther(3);
      const epoch2Dlp2Bonus = parseEther(1);

      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(2, 1, epoch2Dlp1Bonus);

      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(2, 2, epoch2Dlp2Bonus);

      await advanceToEpochN(3); // Advance to epoch 3 so we can save epoch 2 performances

      const epoch2Performances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1500),
          uniqueContributors: 75n,
          dataAccessFees: parseEther(7.5),
          tradingVolumeScore: parseEther(0.4),
          uniqueContributorsScore: parseEther(0.4),
          dataAccessFeesScore: parseEther(0.4),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2500),
          uniqueContributors: 125n,
          dataAccessFees: parseEther(12.5),
          tradingVolumeScore: parseEther(0.6),
          uniqueContributorsScore: parseEther(0.6),
          dataAccessFeesScore: parseEther(0.6),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(2, epoch2Performances);

      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(2);

      // Verify epoch 1 bonuses
      const epoch1Dlp1 = await vanaEpoch.epochDlps(1, 1);
      epoch1Dlp1.bonusAmount.should.eq(epoch1Bonus);

      const epoch1Dlp2 = await vanaEpoch.epochDlps(1, 2);
      epoch1Dlp2.bonusAmount.should.eq(0);

      // Verify epoch 2 bonuses (where we added them)
      const epoch2Dlp1 = await vanaEpoch.epochDlps(2, 1);
      epoch2Dlp1.bonusAmount.should.eq(epoch2Dlp1Bonus);

      const epoch2Dlp2 = await vanaEpoch.epochDlps(2, 2);
      epoch2Dlp2.bonusAmount.should.eq(epoch2Dlp2Bonus);

      // Verify bonus lists
      const epoch1BonusDlps = await vanaEpoch.epochDlpIdsWithBonus(1);
      epoch1BonusDlps.should.include(1n);
      epoch1BonusDlps.length.should.eq(1);

      const epoch2BonusDlps = await vanaEpoch.epochDlpIdsWithBonus(2);
      epoch2BonusDlps.should.include(1n);
      epoch2BonusDlps.should.include(2n);
      epoch2BonusDlps.length.should.eq(2);
    });

    it("should handle zero bonus amount", async function () {
      // This tests edge case of adding zero bonus
      const zeroBonus = parseEther(0);

      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 1, zeroBonus)
        .should.emit(vanaEpoch, "EpochDlpBonusUpdated")
        .withArgs(1, 1, 0, zeroBonus);

      const epochDlp = await vanaEpoch.epochDlps(1, 1);
      epochDlp.bonusAmount.should.eq(0);

      // DLP should still be in bonus list even with zero amount
      const dlpIdsWithBonus = await vanaEpoch.epochDlpIdsWithBonus(1);
      dlpIdsWithBonus.should.include(1n);
    });

    it("should include bonus in total reward distribution calculation", async function () {
      // Add bonus to DLP 1 first (while epoch 1 is current)
      const bonusAmount = parseEther(2);
      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 1, bonusAmount);

      await advanceToEpochN(2);

      // Save performance data
      const dlpPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances);

      // Finalize the epoch
      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      // Initialize epoch rewards for distribution
      await dlpRewardDeployer.connect(maintainer).initializeEpochRewards(
        1, // epochId
        100, // distributionInterval (blocks)
        10, // numberOfTranches
        10, // remediationWindow (blocks)
      );

      // Fund the treasury
      await setBalance(
        dlpRewardDeployerTreasury.target.toString(),
        parseEther(100000),
      );

      // Get DLP 1's rewards before distribution
      const epochDlp1 = await vanaEpoch.epochDlps(1, 1);
      const regularReward = epochDlp1.rewardAmount;
      const totalWithBonus = regularReward + bonusAmount;

      // Setup mock swap response
      const trancheAmount = totalWithBonus / 10n; // 10 tranches
      const tokenRewardAmount = trancheAmount * 2n;
      const spareVana = trancheAmount / 100n;
      const spareToken = tokenRewardAmount / 50n;
      const usedVanaAmount = (trancheAmount * 9n) / 10n;

      await dlpRewardSwap.setSplitRewardSwapResponse(
        tokenRewardAmount,
        spareToken,
        spareVana,
        usedVanaAmount,
      );

      // Advance blocks to meet distribution requirements
      await advanceBlockNTimes(120);

      // Distribute rewards
      await dlpRewardDeployer
        .connect(rewardDeployer)
        .distributeRewards(1, [1])
        .should.emit(dlpRewardDeployer, "EpochDlpRewardDistributed")
        .withArgs(
          1, // epochId
          1, // dlpId
          1, // trancheId
          trancheAmount,
          tokenRewardAmount,
          spareToken,
          spareVana,
          usedVanaAmount,
        );

      // Verify the distributed amount includes the bonus
      const epochDlp1Rewards = await dlpRewardDeployer.epochDlpRewards(1, 1);
      epochDlp1Rewards.totalDistributedAmount.should.eq(trancheAmount);

      // The tranche amount should be based on (rewardAmount + bonusAmount) / numberOfTranches
      trancheAmount.should.eq(totalWithBonus / 10n);
    });

    it("should override bonus amount with overrideEpochDlpBonusAmount", async function () {
      // First add a bonus amount
      const initialBonus = parseEther(5);
      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 1, initialBonus);

      let epochDlp = await vanaEpoch.epochDlps(1, 1);
      epochDlp.bonusAmount.should.eq(initialBonus);

      // Now override it with a new amount
      const overrideAmount = parseEther(3);
      await vanaEpoch
        .connect(maintainer)
        .overrideEpochDlpBonusAmount(1, 1, overrideAmount)
        .should.emit(vanaEpoch, "EpochDlpBonusUpdated")
        .withArgs(1, 1, initialBonus, overrideAmount);

      epochDlp = await vanaEpoch.epochDlps(1, 1);
      epochDlp.bonusAmount.should.eq(overrideAmount);

      // Check DLP is still in bonus list
      const dlpIdsWithBonus = await vanaEpoch.epochDlpIdsWithBonus(1);
      dlpIdsWithBonus.should.include(1n);
    });

    it("should override bonus to zero and remove from bonus list", async function () {
      // First add a bonus amount
      const initialBonus = parseEther(5);
      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 1, initialBonus);

      // Verify DLP is in bonus list
      let dlpIdsWithBonus = await vanaEpoch.epochDlpIdsWithBonus(1);
      dlpIdsWithBonus.should.include(1n);

      // Override to zero
      await vanaEpoch
        .connect(maintainer)
        .overrideEpochDlpBonusAmount(1, 1, 0)
        .should.emit(vanaEpoch, "EpochDlpBonusUpdated")
        .withArgs(1, 1, initialBonus, 0);

      const epochDlp = await vanaEpoch.epochDlps(1, 1);
      epochDlp.bonusAmount.should.eq(0);

      // Check DLP is removed from bonus list
      dlpIdsWithBonus = await vanaEpoch.epochDlpIdsWithBonus(1);
      dlpIdsWithBonus.should.not.include(1n);
    });

    it("should reject overriding bonus when not MAINTAINER_ROLE", async function () {
      const overrideAmount = parseEther(5);

      await vanaEpoch
        .connect(user1)
        .overrideEpochDlpBonusAmount(1, 1, overrideAmount)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });

    it("should set initial bonus using override for DLP with no bonus", async function () {
      const overrideAmount = parseEther(7);

      // Override without any initial bonus
      await vanaEpoch
        .connect(maintainer)
        .overrideEpochDlpBonusAmount(1, 2, overrideAmount)
        .should.emit(vanaEpoch, "EpochDlpBonusUpdated")
        .withArgs(1, 2, 0, overrideAmount);

      const epochDlp = await vanaEpoch.epochDlps(1, 2);
      epochDlp.bonusAmount.should.eq(overrideAmount);

      // Check DLP is in bonus list
      const dlpIdsWithBonus = await vanaEpoch.epochDlpIdsWithBonus(1);
      dlpIdsWithBonus.should.include(2n);
    });

    it("should override multiple times with different values", async function () {
      const firstOverride = parseEther(3);
      const secondOverride = parseEther(8);
      const thirdOverride = parseEther(1);

      // First override
      await vanaEpoch
        .connect(maintainer)
        .overrideEpochDlpBonusAmount(1, 1, firstOverride)
        .should.emit(vanaEpoch, "EpochDlpBonusUpdated")
        .withArgs(1, 1, 0, firstOverride);

      let epochDlp = await vanaEpoch.epochDlps(1, 1);
      epochDlp.bonusAmount.should.eq(firstOverride);

      // Second override
      await vanaEpoch
        .connect(maintainer)
        .overrideEpochDlpBonusAmount(1, 1, secondOverride)
        .should.emit(vanaEpoch, "EpochDlpBonusUpdated")
        .withArgs(1, 1, firstOverride, secondOverride);

      epochDlp = await vanaEpoch.epochDlps(1, 1);
      epochDlp.bonusAmount.should.eq(secondOverride);

      // Third override
      await vanaEpoch
        .connect(maintainer)
        .overrideEpochDlpBonusAmount(1, 1, thirdOverride)
        .should.emit(vanaEpoch, "EpochDlpBonusUpdated")
        .withArgs(1, 1, secondOverride, thirdOverride);

      epochDlp = await vanaEpoch.epochDlps(1, 1);
      epochDlp.bonusAmount.should.eq(thirdOverride);
    });

    it("should handle override after add operations", async function () {
      // Add some bonuses first
      const firstAdd = parseEther(2);
      const secondAdd = parseEther(3);
      const totalAdded = firstAdd + secondAdd;

      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 1, firstAdd);

      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 1, secondAdd);

      let epochDlp = await vanaEpoch.epochDlps(1, 1);
      epochDlp.bonusAmount.should.eq(totalAdded);

      // Now override, which should replace the total
      const overrideAmount = parseEther(10);
      await vanaEpoch
        .connect(maintainer)
        .overrideEpochDlpBonusAmount(1, 1, overrideAmount)
        .should.emit(vanaEpoch, "EpochDlpBonusUpdated")
        .withArgs(1, 1, totalAdded, overrideAmount);

      epochDlp = await vanaEpoch.epochDlps(1, 1);
      epochDlp.bonusAmount.should.eq(overrideAmount);

      // Add more after override
      const additionalAdd = parseEther(1);
      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 1, additionalAdd)
        .should.emit(vanaEpoch, "EpochDlpBonusUpdated")
        .withArgs(1, 1, overrideAmount, overrideAmount + additionalAdd);

      epochDlp = await vanaEpoch.epochDlps(1, 1);
      epochDlp.bonusAmount.should.eq(overrideAmount + additionalAdd);
    });

    it("should rollover unused VANA to next epoch as bonus", async function () {
      // Epoch 1 is already created in beforeEach
      // Now create epoch 2 manually by advancing to epoch 2 start
      await advanceToEpochN(2);
      await vanaEpoch.connect(user1).createEpochs();

      // Set up performances for epoch 2 (the last epoch)
      const dlpPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.25),
          uniqueContributorsScore: parseEther(0.25),
          dataAccessFeesScore: parseEther(0.25),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(3000),
          uniqueContributors: 150n,
          dataAccessFees: parseEther(15),
          tradingVolumeScore: parseEther(0.75),
          uniqueContributorsScore: parseEther(0.75),
          dataAccessFeesScore: parseEther(0.75),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances);

      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      await setBalance(
        dlpRewardDeployerTreasury.target.toString(),
        parseEther(100000),
      );

      const distributionInterval = DAY_SIZE;
      const numberOfTranches = 5;
      const remediationWindow = 1;

      await dlpRewardDeployer
        .connect(maintainer)
        .initializeEpochRewards(
          1,
          distributionInterval,
          numberOfTranches,
          remediationWindow,
        );

      const epoch1Dlp1 = await vanaEpoch.epochDlps(1, 1);
      const epoch1Dlp2 = await vanaEpoch.epochDlps(1, 2);

      const epochRewardAmount = await vanaEpoch.epochRewardAmount();
      const epoch1Dlp1RewardAmount = epochRewardAmount / 4n; // 25% for DLP 1
      const epoch1Dlp2RewardAmount = (epochRewardAmount * 3n) / 4n; // 75% for DLP 2

      epoch1Dlp1.rewardAmount.should.eq(epoch1Dlp1RewardAmount);
      epoch1Dlp2.rewardAmount.should.eq(epoch1Dlp2RewardAmount);

      const epoch1Dlp1TranchAmount =
        epoch1Dlp1RewardAmount / BigInt(numberOfTranches);

      // Setup mock swap where usedVanaAmount is less than trancheAmount (unused VANA)
      const tokenRewardAmount = epoch1Dlp1TranchAmount * 2n;
      const spareVana = epoch1Dlp1TranchAmount / 100n;
      const spareToken = tokenRewardAmount / 50n;
      const usedVanaAmount = (epoch1Dlp1TranchAmount * 7n) / 10n; // Only use 70%, leaving 30% unused
      const expectedUnusedVana = epoch1Dlp1TranchAmount - usedVanaAmount;

      await dlpRewardSwap.setSplitRewardSwapResponse(
        tokenRewardAmount,
        spareToken,
        spareVana,
        usedVanaAmount,
      );

      await dlpRewardDeployer
        .connect(rewardDeployer)
        .distributeRewards(1, [1])
        .should.emit(dlpRewardDeployer, "EpochDlpRewardDistributed")
        .withArgs(
          1, // epochId
          1, // dlpId
          1, // trancheId
          epoch1Dlp1TranchAmount,
          tokenRewardAmount,
          spareToken,
          spareVana,
          usedVanaAmount,
        )
        .and.emit(vanaEpoch, "EpochDlpBonusUpdated") // Rollover emits bonus updated;
        .withArgs(2, 1, 0, expectedUnusedVana); // First bonus for next epoch is 0 -> expectedUnusedVana

      const epoch2Dlp1 = await vanaEpoch.epochDlps(2, 1);
      epoch2Dlp1.bonusAmount.should.eq(expectedUnusedVana);
      epoch2Dlp1.rewardAmount.should.eq(0);
      epoch2Dlp1.penaltyAmount.should.eq(0);
    });

    it("should limit unused VANA rollover to not exceed reward amount", async function () {
      // Epoch 1 is already created in beforeEach
      // Now create epoch 2 manually by advancing to epoch 2 start
      await advanceToEpochN(2);
      await vanaEpoch.connect(user1).createEpochs();

      // Set up performances for epoch 1
      const dlpPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances);

      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      await setBalance(
        dlpRewardDeployerTreasury.target.toString(),
        parseEther(100000),
      );

      await dlpRewardDeployer
        .connect(maintainer)
        .initializeEpochRewards(1, 100, 1, 10);

      const epoch1Dlp1 = await vanaEpoch.epochDlps(1, 1);

      // Pre-add bonus to epoch 2 that's already close to the reward amount limit
      const existingBonus = (epoch1Dlp1.rewardAmount * 9n) / 10n; // 90% of reward amount
      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(2, 1, existingBonus);

      const trancheAmount = epoch1Dlp1.rewardAmount;

      // Setup mock swap with large unused VANA that would exceed limit if added fully
      const usedVanaAmount = trancheAmount / 2n; // Only use 50%, leaving 50% unused
      const actualUnusedVana = trancheAmount - usedVanaAmount;

      // The expected rollover should be limited to: rewardAmount - existingBonus = 10% of rewardAmount
      const expectedLimitedRollover = epoch1Dlp1.rewardAmount - existingBonus;

      await dlpRewardSwap.setSplitRewardSwapResponse(
        trancheAmount * 2n,
        trancheAmount / 50n,
        trancheAmount / 100n,
        usedVanaAmount,
      );

      await advanceBlockNTimes(120);

      // Distribute rewards
      await dlpRewardDeployer.connect(rewardDeployer).distributeRewards(1, [1]);

      // Check that rollover was limited
      const epoch2Dlp1 = await vanaEpoch.epochDlps(2, 1);
      epoch2Dlp1.bonusAmount.should.eq(existingBonus + expectedLimitedRollover);

      // Verify it equals exactly the reward amount (the maximum allowed)
      epoch2Dlp1.bonusAmount.should.eq(epoch1Dlp1.rewardAmount);
    });

    it("should not rollover unused VANA when trancheAmount equals usedVanaAmount", async function () {
      // Epoch 1 is already created in beforeEach

      const dlpPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances);

      // Advance past epoch 1 end block (1099) to allow finalization
      const epoch1EndBlock = EPOCH_START_BLOCK + DAY_SIZE * EPOCH_SIZE - 1; // 100 + 100*10 - 1 = 1099
      await advanceToBlockN(epoch1EndBlock + 1); // Advance to block 1100

      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      await dlpRewardDeployer
        .connect(maintainer)
        .initializeEpochRewards(1, 100, 1, 10);

      await setBalance(
        dlpRewardDeployerTreasury.target.toString(),
        parseEther(100000),
      );

      // Epoch 2 will be created automatically when needed for rollover

      const epochDlp1 = await vanaEpoch.epochDlps(1, 1);
      const trancheAmount = epochDlp1.rewardAmount;

      // Setup mock swap where all VANA is used (no unused VANA)
      const usedVanaAmount = trancheAmount; // Use 100%

      await dlpRewardSwap.setSplitRewardSwapResponse(
        trancheAmount * 2n,
        trancheAmount / 50n,
        trancheAmount / 100n,
        usedVanaAmount,
      );

      await advanceBlockNTimes(120);

      // Get initial bonus amount for epoch 2
      const initialEpoch2Dlp1 = await vanaEpoch.epochDlps(2, 1);
      const initialBonusAmount = initialEpoch2Dlp1.bonusAmount;

      // Distribute rewards
      await dlpRewardDeployer.connect(rewardDeployer).distributeRewards(1, [1]);

      // Check that bonus amount didn't change (no unused VANA to rollover)
      const updatedEpoch2Dlp1 = await vanaEpoch.epochDlps(2, 1);
      updatedEpoch2Dlp1.bonusAmount.should.eq(initialBonusAmount);
    });

    it("should rollover unused VANA with existing bonus amount within limit", async function () {
      // Epoch 1 is already created in beforeEach
      // Now create epoch 2 manually by advancing to epoch 2 start
      await advanceToEpochN(2);
      await vanaEpoch.connect(user1).createEpochs();

      // Set up performances for epoch 1
      const dlpPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances);

      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      await setBalance(
        dlpRewardDeployerTreasury.target.toString(),
        parseEther(100000),
      );

      await dlpRewardDeployer
        .connect(maintainer)
        .initializeEpochRewards(1, 100, 1, 10);

      const epoch1Dlp1 = await vanaEpoch.epochDlps(1, 1);

      // Pre-add some existing bonus to epoch 2 (within limit)
      const existingBonus = epoch1Dlp1.rewardAmount / 4n; // 25% of reward amount
      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(2, 1, existingBonus);

      const trancheAmount = epoch1Dlp1.rewardAmount;

      // Setup mock swap with unused VANA that won't exceed limit when added
      const usedVanaAmount = (trancheAmount * 8n) / 10n; // Use 80%, leaving 20% unused
      const expectedUnusedVana = trancheAmount - usedVanaAmount;

      await dlpRewardSwap.setSplitRewardSwapResponse(
        trancheAmount * 2n,
        trancheAmount / 50n,
        trancheAmount / 100n,
        usedVanaAmount,
      );

      await advanceBlockNTimes(120);

      // Distribute rewards
      await dlpRewardDeployer.connect(rewardDeployer).distributeRewards(1, [1]);

      // Check that rollover was added to existing bonus
      const epoch2Dlp1 = await vanaEpoch.epochDlps(2, 1);
      epoch2Dlp1.bonusAmount.should.eq(existingBonus + expectedUnusedVana);
    });

    it("should handle rollover with zero existing bonus", async function () {
      // Epoch 1 is already created in beforeEach
      // Now create epoch 2 manually by advancing to epoch 2 start
      await advanceToEpochN(2);
      await vanaEpoch.connect(user1).createEpochs();

      // Set up performances for epoch 1
      const dlpPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances);

      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      await setBalance(
        dlpRewardDeployerTreasury.target.toString(),
        parseEther(100000),
      );

      await dlpRewardDeployer
        .connect(maintainer)
        .initializeEpochRewards(1, 100, 1, 10);

      const epoch1Dlp1 = await vanaEpoch.epochDlps(1, 1);
      const trancheAmount = epoch1Dlp1.rewardAmount;

      // Verify epoch 2 has zero initial bonus
      const initialEpoch2Dlp1 = await vanaEpoch.epochDlps(2, 1);
      initialEpoch2Dlp1.bonusAmount.should.eq(0);

      // Setup mock swap with unused VANA
      const usedVanaAmount = (trancheAmount * 7n) / 10n; // Use 70%, leaving 30% unused
      const expectedUnusedVana = trancheAmount - usedVanaAmount;

      await dlpRewardSwap.setSplitRewardSwapResponse(
        trancheAmount * 2n,
        trancheAmount / 50n,
        trancheAmount / 100n,
        usedVanaAmount,
      );

      await advanceBlockNTimes(120);

      // Distribute rewards
      await dlpRewardDeployer.connect(rewardDeployer).distributeRewards(1, [1]);

      // Check that rollover created bonus from zero
      const epoch2Dlp1 = await vanaEpoch.epochDlps(2, 1);
      epoch2Dlp1.bonusAmount.should.eq(expectedUnusedVana);
    });

    it("should handle multiple tranches with unused VANA rollover", async function () {
      // Epoch 1 is already created in beforeEach
      // Now create epoch 2 manually by advancing to epoch 2 start
      await advanceToEpochN(2);
      await vanaEpoch.connect(user1).createEpochs();

      // Set up performances for epoch 1
      const dlpPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances);

      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      await setBalance(
        dlpRewardDeployerTreasury.target.toString(),
        parseEther(100000),
      );

      // Initialize with multiple tranches
      await dlpRewardDeployer
        .connect(maintainer)
        .initializeEpochRewards(1, 100, 2, 10); // 2 tranches

      const epoch1Dlp1 = await vanaEpoch.epochDlps(1, 1);
      const trancheAmount = epoch1Dlp1.rewardAmount / 2n; // 2 tranches

      // Setup mock swap with unused VANA for each tranche
      const usedVanaAmount = (trancheAmount * 3n) / 4n; // Use 75%, leaving 25% unused
      const expectedUnusedVanaPerTranche = trancheAmount - usedVanaAmount;

      await dlpRewardSwap.setSplitRewardSwapResponse(
        trancheAmount * 2n,
        trancheAmount / 50n,
        trancheAmount / 100n,
        usedVanaAmount,
      );

      await advanceBlockNTimes(120);

      // First tranche distribution
      await dlpRewardDeployer.connect(rewardDeployer).distributeRewards(1, [1]);

      // Check rollover from first tranche
      let epoch2Dlp1 = await vanaEpoch.epochDlps(2, 1);
      epoch2Dlp1.bonusAmount.should.eq(expectedUnusedVanaPerTranche);

      await advanceBlockNTimes(120);

      // Second tranche distribution
      await dlpRewardDeployer.connect(rewardDeployer).distributeRewards(1, [1]);

      // Check cumulative rollover from both tranches
      epoch2Dlp1 = await vanaEpoch.epochDlps(2, 1);
      epoch2Dlp1.bonusAmount.should.eq(expectedUnusedVanaPerTranche * 2n);
    });

    it("should not rollover unused VANA when next epoch bonus equals reward amount", async function () {
      // Epoch 1 is already created in beforeEach
      // Now create epoch 2 manually by advancing to epoch 2 start
      await advanceToEpochN(2);
      await vanaEpoch.connect(user1).createEpochs();

      // Set up performances for epoch 1
      const dlpPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances);

      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      await setBalance(
        dlpRewardDeployerTreasury.target.toString(),
        parseEther(100000),
      );

      await dlpRewardDeployer
        .connect(maintainer)
        .initializeEpochRewards(1, 100, 1, 10);

      const epoch1Dlp1 = await vanaEpoch.epochDlps(1, 1);

      // Pre-add bonus to epoch 2 exactly equal to reward amount (max allowed)
      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(2, 1, epoch1Dlp1.rewardAmount);

      const trancheAmount = epoch1Dlp1.rewardAmount;

      // Setup mock swap with unused VANA that would exceed limit
      const usedVanaAmount = trancheAmount / 2n; // Use 50%, leaving 50% unused

      await dlpRewardSwap.setSplitRewardSwapResponse(
        trancheAmount * 2n,
        trancheAmount / 50n,
        trancheAmount / 100n,
        usedVanaAmount,
      );

      await advanceBlockNTimes(120);

      // Distribute rewards
      await dlpRewardDeployer.connect(rewardDeployer).distributeRewards(1, [1]);

      // Check that no rollover happened (bonus stays at reward amount)
      const epoch2Dlp1 = await vanaEpoch.epochDlps(2, 1);
      epoch2Dlp1.bonusAmount.should.eq(epoch1Dlp1.rewardAmount);
    });

    it("should rollover to correct epoch when multiple DLPs have unused VANA", async function () {
      // Epoch 1 is already created in beforeEach
      // Now create epoch 2 manually by advancing to epoch 2 start
      await advanceToEpochN(2);
      await vanaEpoch.connect(user1).createEpochs();

      // Set up performances for epoch 1
      const dlpPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.25),
          uniqueContributorsScore: parseEther(0.25),
          dataAccessFeesScore: parseEther(0.25),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(3000),
          uniqueContributors: 150n,
          dataAccessFees: parseEther(15),
          tradingVolumeScore: parseEther(0.75),
          uniqueContributorsScore: parseEther(0.75),
          dataAccessFeesScore: parseEther(0.75),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances);

      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      await setBalance(
        dlpRewardDeployerTreasury.target.toString(),
        parseEther(100000),
      );

      await dlpRewardDeployer
        .connect(maintainer)
        .initializeEpochRewards(1, 100, 1, 10);

      const epoch1Dlp1 = await vanaEpoch.epochDlps(1, 1);
      const epoch1Dlp2 = await vanaEpoch.epochDlps(1, 2);

      // Setup different swap responses for each DLP
      // DLP 1: 80% used, 20% unused
      const dlp1TranchAmount = epoch1Dlp1.rewardAmount;
      const dlp1UsedAmount = (dlp1TranchAmount * 8n) / 10n;
      const dlp1UnusedAmount = dlp1TranchAmount - dlp1UsedAmount;

      await dlpRewardSwap.setSplitRewardSwapResponse(
        dlp1TranchAmount * 2n,
        dlp1TranchAmount / 50n,
        dlp1TranchAmount / 100n,
        dlp1UsedAmount,
      );

      await advanceBlockNTimes(120);

      // Distribute rewards for DLP 1
      await dlpRewardDeployer.connect(rewardDeployer).distributeRewards(1, [1]);

      // Check rollover for DLP 1
      let epoch2Dlp1 = await vanaEpoch.epochDlps(2, 1);
      epoch2Dlp1.bonusAmount.should.eq(dlp1UnusedAmount);

      // Setup swap for DLP 2: 60% used, 40% unused
      const dlp2TranchAmount = epoch1Dlp2.rewardAmount;
      const dlp2UsedAmount = (dlp2TranchAmount * 6n) / 10n;
      const dlp2UnusedAmount = dlp2TranchAmount - dlp2UsedAmount;

      await dlpRewardSwap.setSplitRewardSwapResponse(
        dlp2TranchAmount * 2n,
        dlp2TranchAmount / 50n,
        dlp2TranchAmount / 100n,
        dlp2UsedAmount,
      );

      // Distribute rewards for DLP 2
      await dlpRewardDeployer.connect(rewardDeployer).distributeRewards(1, [2]);

      // Check rollover for DLP 2
      const epoch2Dlp2 = await vanaEpoch.epochDlps(2, 2);
      epoch2Dlp2.bonusAmount.should.eq(dlp2UnusedAmount);

      // Verify DLP 1 rollover remains unchanged
      epoch2Dlp1 = await vanaEpoch.epochDlps(2, 1);
      epoch2Dlp1.bonusAmount.should.eq(dlp1UnusedAmount);
    });

    it("should handle bonus-only DLP distribution", async function () {
      // Register DLP 3 that will only receive bonus (not verified/eligible)
      const dlp3Info = {
        dlpAddress: "0x0000000000000000000000000000000000000003",
        ownerAddress: user1,
        treasuryAddress: user1.address,
        name: "Test DLP 3",
        iconUrl: "https://example.com/icon3.png",
        website: "https://example3.com",
        metadata: "Test DLP 3 metadata",
      };

      await dlpRegistry
        .connect(user1)
        .registerDlp(dlp3Info, { value: DLP_REGISTRATION_DEPOSIT });

      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(3, token3.address, 3);

      // Don't verify DLP 3 - it won't be eligible for regular rewards

      // Add bonus to DLP 3 (not eligible, no regular rewards) while epoch 1 is current
      const bonusAmount = parseEther(3);
      await vanaEpoch
        .connect(rewardDeployer)
        .addEpochDlpBonusAmount(1, 3, bonusAmount);

      await advanceToEpochN(2);

      // Save performance data for eligible DLPs only
      const dlpPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.5),
          uniqueContributorsScore: parseEther(0.5),
          dataAccessFeesScore: parseEther(0.5),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances);

      // Finalize the epoch
      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      // Initialize epoch rewards
      await dlpRewardDeployer.connect(maintainer).initializeEpochRewards(
        1, // epochId
        100, // distributionInterval
        5, // numberOfTranches
        10, // remediationWindow
      );

      // Fund the treasury
      await setBalance(
        dlpRewardDeployerTreasury.target.toString(),
        parseEther(100000),
      );

      // Setup mock swap response for DLP 3
      const trancheAmount = bonusAmount / 5n; // 5 tranches
      const tokenRewardAmount = trancheAmount * 2n;
      const spareVana = trancheAmount / 100n;
      const spareToken = tokenRewardAmount / 50n;
      const usedVanaAmount = (trancheAmount * 9n) / 10n;

      await dlpRewardSwap.setSplitRewardSwapResponse(
        tokenRewardAmount,
        spareToken,
        spareVana,
        usedVanaAmount,
      );

      // Advance blocks
      await advanceBlockNTimes(120);

      // Distribute rewards for DLP 3 (bonus only)
      await dlpRewardDeployer
        .connect(rewardDeployer)
        .distributeRewards(1, [3])
        .should.emit(dlpRewardDeployer, "EpochDlpRewardDistributed")
        .withArgs(
          1, // epochId
          3, // dlpId
          1, // trancheId
          trancheAmount,
          tokenRewardAmount,
          spareToken,
          spareVana,
          usedVanaAmount,
        );

      // Verify DLP 3 received its bonus distribution
      const epochDlp3Rewards = await dlpRewardDeployer.epochDlpRewards(1, 3);
      epochDlp3Rewards.totalDistributedAmount.should.eq(trancheAmount);

      // Verify the epoch DLP info shows only bonus
      const epochDlp3 = await vanaEpoch.epochDlps(1, 3);
      epochDlp3.rewardAmount.should.eq(0); // No regular rewards
      epochDlp3.bonusAmount.should.eq(bonusAmount); // Only bonus
    });
  });

  describe("Comprehensive Integration", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should handle full flow from registration to performance evaluation", async function () {
      // 1. Register DLPs
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });
      await dlpRegistry
        .connect(dlp2Owner)
        .registerDlp(dlp2Info, { value: DLP_REGISTRATION_DEPOSIT });

      // 2. Set token addresses and make DLPs eligible
      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(1, token1.address, 1);
      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(2, token2.address, 2);
      await dlpRegistry.connect(maintainer).updateDlpVerificationBlock(1, 1);
      await dlpRegistry.connect(maintainer).updateDlpVerificationBlock(2, 1);

      // 3. Create first epoch
      await vanaEpoch.connect(user1).createEpochs();

      // 4. Advance beyond epoch end
      await advanceBlockNTimes(EPOCH_SIZE * DAY_SIZE + 10);

      // 5. Create second epoch
      await vanaEpoch.connect(user1).createEpochs();

      // 6. Record performance data for epoch 1
      const epoch1Performances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.3),
          uniqueContributorsScore: parseEther(0.2),
          dataAccessFeesScore: parseEther(0.1),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.7),
          uniqueContributorsScore: parseEther(0.8),
          dataAccessFeesScore: parseEther(0.9),
        },
      ];

      await advanceToEpochN(2);

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, epoch1Performances);

      // 7. Verify all state is correct

      // Check DLP registry state
      (await dlpRegistry.dlpsCount()).should.eq(2);
      (await dlpRegistry.eligibleDlpsListCount()).should.eq(2);

      // Check epoch state
      (await vanaEpoch.epochsCount()).should.eq(2);

      const dlp1Performance = await dlpPerformance.epochDlpPerformances(1, 1);
      dlp1Performance.tradingVolumeScore.should.eq(parseEther(0.3));
      dlp1Performance.uniqueContributorsScore.should.eq(parseEther(0.2));
      dlp1Performance.dataAccessFeesScore.should.eq(parseEther(0.1));

      const dlp2Performance = await dlpPerformance.epochDlpPerformances(1, 2);
      dlp2Performance.tradingVolumeScore.should.eq(parseEther(0.7));
      dlp2Performance.uniqueContributorsScore.should.eq(parseEther(0.8));
      dlp2Performance.dataAccessFeesScore.should.eq(parseEther(0.9));

      // 8. Verify treasury has received deposits
      (await ethers.provider.getBalance(dlpRegistryTreasury.target)).should.eq(
        DLP_REGISTRATION_DEPOSIT * 2n,
      );
    });

    it("should handle DLP deregistration and performance impacts", async function () {
      // 1. Register DLPs
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });
      await dlpRegistry
        .connect(dlp2Owner)
        .registerDlp(dlp2Info, { value: DLP_REGISTRATION_DEPOSIT });

      // 2. Make them eligible
      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(1, token1.address, 1);
      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(2, token2.address, 2);
      await dlpRegistry.connect(maintainer).updateDlpVerificationBlock(1, 1);
      await dlpRegistry.connect(maintainer).updateDlpVerificationBlock(2, 1);

      // 3. Create first epoch
      await vanaEpoch.connect(user1).createEpochs();

      // 4. Record initial performance data
      const initialPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.3),
          uniqueContributorsScore: parseEther(0.2),
          dataAccessFeesScore: parseEther(0.1),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.7),
          uniqueContributorsScore: parseEther(0.8),
          dataAccessFeesScore: parseEther(0.9),
        },
      ];

      await advanceToEpochN(2);

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, initialPerformances);

      // 4.5. Finalize the epoch
      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      // Need to advance to next epoch and finalize it to deregister
      await advanceToEpochN(3);
      await vanaEpoch.connect(user1).createEpochs();

      // Save performance data for epoch 2 and finalize it
      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(2, initialPerformances);
      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(2);

      // 5. Deregister one DLP (requires last epoch to be finalized)
      await dlpRegistry.connect(dlp1Owner).deregisterDlp(1);

      // 6. Verify eligible list is updated
      (await dlpRegistry.eligibleDlpsListCount()).should.eq(1);
      (await dlpRegistry.eligibleDlpsListAt(0)).should.eq(2);

      // 7. Check DLP is deregistered but performance data persists
      const dlp1 = await dlpRegistry.dlps(1);
      dlp1.status.should.eq(DlpStatus.Deregistered);

      const dlp1Performance = await dlpPerformance.epochDlpPerformances(1, 1);
      dlp1Performance.tradingVolume.should.eq(parseEther(1000));
      dlp1Performance.uniqueContributors.should.eq(50);
      dlp1Performance.dataAccessFees.should.eq(parseEther(5));
    });
  });

  describe("Dlp Reward Deployer", () => {
    const dlp1PerformanceDefault = {
      dlpId: 1,
      tradingVolume: parseEther(1000),
      uniqueContributors: 50n,
      dataAccessFees: parseEther(5),
      tradingVolumeScore: parseEther(0.4),
      uniqueContributorsScore: parseEther(0.4),
      dataAccessFeesScore: parseEther(0.4),
    };

    const dlp2PerformanceDefault = {
      dlpId: 2,
      tradingVolume: parseEther(2000),
      uniqueContributors: 100n,
      dataAccessFees: parseEther(10),
      tradingVolumeScore: parseEther(0.6),
      uniqueContributorsScore: parseEther(0.6),
      dataAccessFeesScore: parseEther(0.6),
    };

    const dlpPerformancesDefault = [
      dlp1PerformanceDefault,
      dlp2PerformanceDefault,
    ];

    const dlpRewardDeployerTreasuryInitialBalance = parseEther(1000000);
    beforeEach(async () => {
      await deploy();

      await dlpRewardDeployerTreasury;

      await setBalance(
        dlpRewardDeployerTreasury.target.toString(),
        dlpRewardDeployerTreasuryInitialBalance,
      );

      // Register and make DLPs eligible
      await dlpRegistry
        .connect(dlp1Owner)
        .registerDlp(dlp1Info, { value: DLP_REGISTRATION_DEPOSIT });
      await dlpRegistry
        .connect(dlp2Owner)
        .registerDlp(dlp2Info, { value: DLP_REGISTRATION_DEPOSIT });

      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(1, token1.address, 1);
      await dlpRegistry
        .connect(maintainer)
        .updateDlpToken(2, token2.address, 2);

      await dlpRegistry.connect(maintainer).updateDlpVerificationBlock(1, 1);
      await dlpRegistry.connect(maintainer).updateDlpVerificationBlock(2, 1);
    });

    it("should updateTreasury when maintainer", async function () {
      await dlpRewardDeployer.connect(admin).updateTreasury(user1.address);

      (await dlpRewardDeployer.treasury()).should.eq(user1.address);
    });

    it("should reject updateTreasury when not admin", async function () {
      await dlpRewardDeployer
        .connect(user1)
        .updateTreasury(user1.address)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });

    //updateVanaEpoch
    it("should updateVanaEpoch when maintainer", async function () {
      await dlpRewardDeployer.connect(admin).updateVanaEpoch(user1.address);

      (await dlpRewardDeployer.vanaEpoch()).should.eq(user1.address);
    });

    it("should reject updateVanaEpoch when not maintainer", async function () {
      await dlpRewardDeployer
        .connect(user1)
        .updateVanaEpoch(user1.address)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });

    it("should updateDlpRegistry when maintainer", async function () {
      await dlpRewardDeployer.connect(admin).updateDlpRegistry(user1.address);

      (await dlpRewardDeployer.dlpRegistry()).should.eq(user1.address);
    });

    it("should reject updateDlpRegistry when not maintainer", async function () {
      await dlpRewardDeployer
        .connect(user1)
        .updateDlpRegistry(user1.address)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });

    it("should updateDlpRewardSwap when maintainer", async function () {
      await dlpRewardDeployer.connect(admin).updateDlpRewardSwap(user1.address);

      (await dlpRewardDeployer.dlpRewardSwap()).should.eq(user1.address);
    });

    it("should reject updateDlpRewardSwap when not maintainer", async function () {
      await dlpRewardDeployer
        .connect(user1)
        .updateDlpRewardSwap(user1.address)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });

    it("should distributeRewards", async function () {
      await advanceToEpochN(2);

      await vanaEpoch.connect(user1).createEpochs();

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformancesDefault);

      // Finalize the epoch to calculate rewards
      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      // Initialize epoch rewards for distribution
      await dlpRewardDeployer.connect(maintainer).initializeEpochRewards(
        1, // epochId
        100, // distributionInterval (blocks)
        NUMBER_OF_TRANCHES, // numberOfTranches
        10, // remediationWindow (blocks)
      );

      const epoch1Dlp1 = await vanaEpoch.epochDlps(1, 1);
      epoch1Dlp1.rewardAmount.should.eq(
        (parseEther(0.4) * EPOCH_REWARD_AMOUNT) / parseEther(1),
      );

      const epoch1Dlp2 = await vanaEpoch.epochDlps(1, 2);
      epoch1Dlp2.rewardAmount.should.eq(
        (parseEther(0.6) * EPOCH_REWARD_AMOUNT) / parseEther(1),
      );

      const trancheAmount = epoch1Dlp1.rewardAmount / NUMBER_OF_TRANCHES;
      const usedVanaAmount = (trancheAmount * 9n) / 10n;
      const tokenRewardAmount = trancheAmount * 2n;
      const spareVana = trancheAmount / 100n;
      const spareToken = tokenRewardAmount / 50n;

      await dlpRewardSwap.setSplitRewardSwapResponse(
        tokenRewardAmount,
        spareToken,
        spareVana,
        usedVanaAmount,
      );

      // Advance blocks to meet the distribution interval requirements
      await advanceBlockNTimes(110);

      await dlpRewardDeployer
        .connect(rewardDeployer)
        .distributeRewards(1, [1])
        .should.emit(dlpRewardDeployer, "EpochDlpRewardDistributed")
        .withArgs(
          1,
          1,
          1,
          trancheAmount,
          tokenRewardAmount,
          spareToken,
          spareVana,
          usedVanaAmount,
        );

      const epoch1Dlp1DistributedRewards =
        await dlpRewardDeployer.epochDlpDistributedRewards(1, 1);

      epoch1Dlp1DistributedRewards[0].amount.should.eq(trancheAmount);
      epoch1Dlp1DistributedRewards[0].blockNumber.should.eq(
        await ethers.provider.getBlockNumber(),
      );
      epoch1Dlp1DistributedRewards[0].tokenRewardAmount.should.eq(
        tokenRewardAmount,
      );
      epoch1Dlp1DistributedRewards[0].spareToken.should.eq(spareToken);
      epoch1Dlp1DistributedRewards[0].spareVana.should.eq(spareVana);
      epoch1Dlp1DistributedRewards[0].usedVanaAmount.should.eq(usedVanaAmount);
    });

    it("should distributeRewards multiple times", async function () {
      await advanceToEpochN(2);

      await vanaEpoch.connect(user1).createEpochs();

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformancesDefault);

      // Finalize the epoch to calculate rewards
      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      // Initialize epoch rewards for distribution
      await dlpRewardDeployer.connect(maintainer).initializeEpochRewards(
        1, // epochId
        100, // distributionInterval (blocks)
        NUMBER_OF_TRANCHES, // numberOfTranches
        10, // remediationWindow (blocks)
      );

      const epoch1Dlp1 = await vanaEpoch.epochDlps(1, 1);
      epoch1Dlp1.rewardAmount.should.eq(
        (parseEther(0.4) * EPOCH_REWARD_AMOUNT) / parseEther(1),
      );

      const epoch1Dlp2 = await vanaEpoch.epochDlps(1, 2);
      epoch1Dlp2.rewardAmount.should.eq(
        (parseEther(0.6) * EPOCH_REWARD_AMOUNT) / parseEther(1),
      );

      const trancheAmount = epoch1Dlp1.rewardAmount / NUMBER_OF_TRANCHES;
      const usedVanaAmount1 = (trancheAmount * 9n) / 10n;
      const tokenRewardAmount1 = trancheAmount * 2n;
      const spareVana1 = trancheAmount / 100n;
      const spareToken1 = tokenRewardAmount1 / 50n;

      await dlpRewardSwap.setSplitRewardSwapResponse(
        tokenRewardAmount1,
        spareToken1,
        spareVana1,
        usedVanaAmount1,
      );

      // Advance blocks to meet the distribution interval requirements
      await advanceBlockNTimes(110);

      await dlpRewardDeployer
        .connect(rewardDeployer)
        .distributeRewards(1, [1])
        .should.emit(dlpRewardDeployer, "EpochDlpRewardDistributed")
        .withArgs(
          1,
          1,
          1,
          trancheAmount,
          tokenRewardAmount1,
          spareToken1,
          spareVana1,
          usedVanaAmount1,
        );

      let epoch1Dlp1DistributedRewards =
        await dlpRewardDeployer.epochDlpDistributedRewards(1, 1);

      epoch1Dlp1DistributedRewards.length.should.eq(1);
      epoch1Dlp1DistributedRewards[0].amount.should.eq(trancheAmount);
      epoch1Dlp1DistributedRewards[0].blockNumber.should.eq(
        await ethers.provider.getBlockNumber(),
      );
      epoch1Dlp1DistributedRewards[0].tokenRewardAmount.should.eq(
        tokenRewardAmount1,
      );
      epoch1Dlp1DistributedRewards[0].spareToken.should.eq(spareToken1);
      epoch1Dlp1DistributedRewards[0].spareVana.should.eq(spareVana1);
      epoch1Dlp1DistributedRewards[0].usedVanaAmount.should.eq(usedVanaAmount1);

      const usedVanaAmount2 = (trancheAmount * 8n) / 10n;
      const tokenRewardAmount2 = trancheAmount * 3n;
      const spareVana2 = trancheAmount;
      const spareToken2 = tokenRewardAmount2 / 10n;

      await dlpRewardSwap.setSplitRewardSwapResponse(
        tokenRewardAmount2,
        spareToken2,
        spareVana2,
        usedVanaAmount2,
      );

      // Advance more blocks for the next tranche
      await advanceBlockNTimes(100);

      await dlpRewardDeployer
        .connect(rewardDeployer)
        .distributeRewards(1, [1])
        .should.emit(dlpRewardDeployer, "EpochDlpRewardDistributed")
        .withArgs(
          1,
          1,
          2,
          trancheAmount,
          tokenRewardAmount2,
          spareToken2,
          spareVana2,
          usedVanaAmount2,
        );

      epoch1Dlp1DistributedRewards =
        await dlpRewardDeployer.epochDlpDistributedRewards(1, 1);

      epoch1Dlp1DistributedRewards.length.should.eq(2);
      epoch1Dlp1DistributedRewards[0].amount.should.eq(trancheAmount);
      // First distribution was 100 blocks ago
      epoch1Dlp1DistributedRewards[0].blockNumber.should.be.lessThan(
        await ethers.provider.getBlockNumber(),
      );
      epoch1Dlp1DistributedRewards[0].tokenRewardAmount.should.eq(
        tokenRewardAmount1,
      );
      epoch1Dlp1DistributedRewards[0].spareToken.should.eq(spareToken1);
      epoch1Dlp1DistributedRewards[0].spareVana.should.eq(spareVana1);
      epoch1Dlp1DistributedRewards[0].usedVanaAmount.should.eq(usedVanaAmount1);

      epoch1Dlp1DistributedRewards[1].amount.should.eq(trancheAmount);
      epoch1Dlp1DistributedRewards[1].blockNumber.should.eq(
        await ethers.provider.getBlockNumber(),
      );
      epoch1Dlp1DistributedRewards[1].tokenRewardAmount.should.eq(
        tokenRewardAmount2,
      );
      epoch1Dlp1DistributedRewards[1].spareToken.should.eq(spareToken2);
      epoch1Dlp1DistributedRewards[1].spareVana.should.eq(spareVana2);
      epoch1Dlp1DistributedRewards[1].usedVanaAmount.should.eq(usedVanaAmount2);
    });

    it("should handle metric weights configuration", async function () {
      // Test updating metric weights
      const newWeights = {
        tradingVolume: parseEther(0.5),
        uniqueContributors: parseEther(0.3),
        dataAccessFees: parseEther(0.2),
      };

      await dlpPerformance
        .connect(maintainer)
        .updateMetricWeights(newWeights)
        .should.emit(dlpPerformance, "MetricWeightsUpdated")
        .withArgs(
          newWeights.tradingVolume,
          newWeights.uniqueContributors,
          newWeights.dataAccessFees,
        );

      const retrievedWeights = await dlpPerformance.metricWeights();
      retrievedWeights.tradingVolume.should.eq(newWeights.tradingVolume);
      retrievedWeights.uniqueContributors.should.eq(
        newWeights.uniqueContributors,
      );
      retrievedWeights.dataAccessFees.should.eq(newWeights.dataAccessFees);
    });

    it("should reject invalid metric weights", async function () {
      // Test weights that don't sum to 1e18
      const invalidWeights = {
        tradingVolume: parseEther(0.5),
        uniqueContributors: parseEther(0.3),
        dataAccessFees: parseEther(0.3), // Total = 1.1, should fail
      };

      await dlpPerformance
        .connect(maintainer)
        .updateMetricWeights(invalidWeights)
        .should.be.rejectedWith("InvalidMetricWeights()");
    });

    it("should handle DLP performance calculations correctly", async function () {
      await advanceToEpochN(2);
      await vanaEpoch.connect(user1).createEpochs();

      const testPerformances = [
        {
          dlpId: 1,
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
          tradingVolumeScore: parseEther(0.4),
          uniqueContributorsScore: parseEther(0.4),
          dataAccessFeesScore: parseEther(0.4),
        },
        {
          dlpId: 2,
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
          tradingVolumeScore: parseEther(0.6),
          uniqueContributorsScore: parseEther(0.6),
          dataAccessFeesScore: parseEther(0.6),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, testPerformances);

      // Finalize the epoch to calculate rewards properly
      await dlpPerformance.connect(maintainer).confirmEpochFinalScores(1);

      // Get the actual rewards from the epoch
      const epoch1Dlp1 = await vanaEpoch.epochDlps(1, 1);
      const epoch1Dlp2 = await vanaEpoch.epochDlps(1, 2);

      // Rewards should be calculated based on scores and epoch reward amount
      epoch1Dlp1.rewardAmount.should.be.greaterThan(0);
      epoch1Dlp2.rewardAmount.should.be.greaterThan(0);
      epoch1Dlp1.penaltyAmount.should.eq(0); // No penalties set in this test
      epoch1Dlp2.penaltyAmount.should.eq(0);

      // The sum of rewards should approximately equal the epoch reward amount
      const totalRewards = epoch1Dlp1.rewardAmount + epoch1Dlp2.rewardAmount;
      totalRewards.should.be.closeTo(EPOCH_REWARD_AMOUNT, parseEther(0.000001));
    });

    it("should handle treasury operations correctly", async function () {
      const initialBalance = await ethers.provider.getBalance(
        dlpRewardDeployerTreasury.target,
      );

      // Test treasury transfer
      const transferAmount = parseEther(100);
      await dlpRewardDeployerTreasury
        .connect(admin)
        .transfer(
          user1.address,
          "0x0000000000000000000000000000000000000000",
          transferAmount,
        );

      const finalBalance = await ethers.provider.getBalance(
        dlpRewardDeployerTreasury.target,
      );
      (initialBalance - finalBalance).should.eq(transferAmount);
    });
  });

  describe("LAST_EPOCH Limit", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("Should have lastEpoch set to 1000 by default", async () => {
      const lastEpoch = await vanaEpoch.lastEpoch();
      lastEpoch.should.eq(1000);
    });

    it("Should revert when trying to create epoch 8", async () => {
      // Set lastEpoch to 7 for this test
      await network.provider.request({
        method: "hardhat_reset",
        params: [],
      });
      await deploy();

      // Override lastEpoch - need to deploy fresh since it can only be set once
      await network.provider.request({
        method: "hardhat_reset",
        params: [],
      });

      // Redeploy without setting lastEpoch in deploy function
      [admin, maintainer, manager, user1, user2, token1, token2, token3, token4, token5, dlp1Owner, dlp2Owner, rewardDeployer] = await ethers.getSigners();

      const dlpRegistryDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory("DLPRegistryImplementation"),
        [admin.address],
        { kind: "uups" }
      );
      dlpRegistry = await ethers.getContractAt("DLPRegistryImplementation", dlpRegistryDeploy.target);

      const vanaEpochDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory("VanaEpochImplementation"),
        [{ ownerAddress: admin.address, dlpRegistryAddress: dlpRegistry.target, daySize: DAY_SIZE, epochSize: EPOCH_SIZE, epochRewardAmount: EPOCH_REWARD_AMOUNT }],
        { kind: "uups" }
      );
      vanaEpoch = await ethers.getContractAt("VanaEpochImplementation", vanaEpochDeploy.target);

      await vanaEpoch.updateEpoch(0, 0, EPOCH_START_BLOCK - 1, 0, [], true);
      await vanaEpoch.connect(admin).setLastEpoch(7);

      // Create epochs up to epoch 7
      while ((await vanaEpoch.epochsCount()) < 7) {
        await advanceBlockNTimes(DAY_SIZE * EPOCH_SIZE + 1);
        await vanaEpoch.createEpochs();
      }

      // Verify we're at epoch 7
      const epochCount = await vanaEpoch.epochsCount();
      epochCount.should.eq(7);

      // Advance blocks to trigger epoch 8 creation attempt
      await advanceBlockNTimes(DAY_SIZE * EPOCH_SIZE + 1);

      // Should revert when trying to create epoch 8
      await vanaEpoch
        .createEpochs()
        .should.be.revertedWithCustomError(vanaEpoch, "LastEpochExceeded")
        .withArgs(7);
    });

    it("Should revert when trying to create epochs beyond 7 using createEpochsUntilBlockNumber", async () => {
      // Set lastEpoch to 7 for this test
      await network.provider.request({
        method: "hardhat_reset",
        params: [],
      });

      // Redeploy without setting lastEpoch in deploy function
      [admin, maintainer, manager, user1, user2, token1, token2, token3, token4, token5, dlp1Owner, dlp2Owner, rewardDeployer] = await ethers.getSigners();

      const dlpRegistryDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory("DLPRegistryImplementation"),
        [admin.address],
        { kind: "uups" }
      );
      dlpRegistry = await ethers.getContractAt("DLPRegistryImplementation", dlpRegistryDeploy.target);

      const vanaEpochDeploy = await upgrades.deployProxy(
        await ethers.getContractFactory("VanaEpochImplementation"),
        [{ ownerAddress: admin.address, dlpRegistryAddress: dlpRegistry.target, daySize: DAY_SIZE, epochSize: EPOCH_SIZE, epochRewardAmount: EPOCH_REWARD_AMOUNT }],
        { kind: "uups" }
      );
      vanaEpoch = await ethers.getContractAt("VanaEpochImplementation", vanaEpochDeploy.target);

      await vanaEpoch.updateEpoch(0, 0, EPOCH_START_BLOCK - 1, 0, [], true);
      await vanaEpoch.connect(admin).setLastEpoch(7);

      // Create epochs up to epoch 7
      while ((await vanaEpoch.epochsCount()) < 7) {
        await advanceBlockNTimes(DAY_SIZE * EPOCH_SIZE + 1);
        await vanaEpoch.createEpochs();
      }

      // Advance blocks significantly (3 epochs worth)
      await advanceBlockNTimes(DAY_SIZE * EPOCH_SIZE * 3);
      const futureBlock = await getCurrentBlockNumber();

      // Should revert when trying to create epochs beyond 7
      await vanaEpoch
        .createEpochsUntilBlockNumber(futureBlock)
        .should.be.revertedWithCustomError(vanaEpoch, "LastEpochExceeded")
        .withArgs(7);
    });
  });
});
