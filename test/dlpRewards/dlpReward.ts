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
    totalScore: bigint;
    tradingVolume: bigint;
    uniqueContributors: bigint;
    dataAccessFees: bigint;
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

    // Set up roles
    await dlpRegistry.connect(admin).grantRole(MAINTAINER_ROLE, maintainer);
    await vanaEpoch.connect(admin).grantRole(MAINTAINER_ROLE, maintainer);
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
      (await dlpRewardDeployer.numberOfTranches()).should.eq(
        NUMBER_OF_TRANCHES,
      );
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

      await dlpRegistry.connect(maintainer).updateDlpVerification(1, true);
      await dlpRegistry.connect(maintainer).updateDlpVerification(2, true);

      // Create epoch
      await vanaEpoch.connect(user1).createEpochs();
    });

    it("should save epoch performances", async function () {
      await advanceToEpochN(2);
      // Prepare performance data
      const dlpPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          totalScore: parseEther(0.3),
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
        },
        {
          dlpId: 2,
          totalScore: parseEther(0.7),
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
        },
      ];

      // Save performances without finalizing
      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances, false)
        .should.emit(dlpPerformance, "EpochDlpPerformancesSaved")
        .withArgs(1, 1, parseEther(0.3), parseEther(1000), 50, parseEther(5))
        .and.emit(dlpPerformance, "EpochDlpPerformancesSaved")
        .withArgs(1, 2, parseEther(0.7), parseEther(2000), 100, parseEther(10));

      // Check performance data saved correctly
      const dlp1Performance = await dlpPerformance.epochDlpPerformances(1, 1);
      dlp1Performance.totalScore.should.eq(parseEther(0.3));
      dlp1Performance.tradingVolume.should.eq(parseEther(1000));
      dlp1Performance.uniqueContributors.should.eq(50);
      dlp1Performance.dataAccessFees.should.eq(parseEther(5));

      const dlp2Performance = await dlpPerformance.epochDlpPerformances(1, 2);
      dlp2Performance.totalScore.should.eq(parseEther(0.7));
      dlp2Performance.tradingVolume.should.eq(parseEther(2000));
      dlp2Performance.uniqueContributors.should.eq(100);
      dlp2Performance.dataAccessFees.should.eq(parseEther(10));
    });

    it("should save and finalize epoch performances", async function () {
      await advanceToEpochN(2);
      // Prepare performance data
      const dlpPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          totalScore: parseEther(0.1),
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
        },
        {
          dlpId: 2,
          totalScore: parseEther(0.9),
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
        },
      ];

      // Save performances and finalize
      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances, true)
        .should.emit(dlpPerformance, "EpochDlpPerformancesSaved")
        .withArgs(1, 1, parseEther(0.1), parseEther(1000), 50, parseEther(5))
        .and.emit(dlpPerformance, "EpochDlpPerformancesSaved")
        .withArgs(1, 2, parseEther(0.9), parseEther(2000), 100, parseEther(10))
        .and.emit(vanaEpoch, "EpochFinalized")
        .withArgs(1);
    });

    it("should reject saving performances to already finalized epoch", async function () {
      await advanceToEpochN(3);
      // Prepare performance data
      const dlpPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          totalScore: parseEther(1),
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
        },
      ];

      // Save and finalize epoch
      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances, true);

      // Try to save again
      const newPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          totalScore: parseEther(1),
          tradingVolume: parseEther(1500),
          uniqueContributors: 75n,
          dataAccessFees: parseEther(7.5),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, newPerformances, true)
        .should.be.rejectedWith("EpochAlreadyFinalized()");
    });

    it("should reject saving performances when not manager", async function () {
      const dlpPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          totalScore: parseEther(1),
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
        },
      ];

      await dlpPerformance
        .connect(user1)
        .saveEpochPerformances(1, dlpPerformances, false)
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
          totalScore: parseEther(1),
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
        },
      ];

      await advanceToEpochN(3);

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, epoch1Performances, true);

      // Save performances for epoch 2
      const epoch2Performances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          totalScore: parseEther(1),
          tradingVolume: parseEther(1500),
          uniqueContributors: 75n,
          dataAccessFees: parseEther(7.5),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(2, epoch2Performances, false);

      const dlp1Epoch1 = await dlpPerformance.epochDlpPerformances(1, 1);
      dlp1Epoch1.totalScore.should.eq(parseEther(1));

      const dlp1Epoch2 = await dlpPerformance.epochDlpPerformances(2, 1);
      dlp1Epoch2.totalScore.should.eq(parseEther(1));
    });

    it("should reject saving performances when paused", async function () {
      // Pause the contract
      await dlpPerformance.connect(maintainer).pause();

      const dlpPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          totalScore: parseEther(1),
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
        },
      ];
      await advanceToEpochN(2);

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, dlpPerformances, false)
        .should.be.rejectedWith("EnforcedPause()");
    });

    it("should allow updating performance before finalizing", async function () {
      // Save initial performance data
      const initialPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          totalScore: parseEther(1),
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
        },
      ];

      await advanceToEpochN(2);

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, initialPerformances, false);

      // Update performance data
      const updatedPerformances: DlpPerformanceInput[] = [
        {
          dlpId: 1,
          totalScore: parseEther(1),
          tradingVolume: parseEther(1500),
          uniqueContributors: 75n,
          dataAccessFees: parseEther(7.5),
        },
      ];

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, updatedPerformances, false);

      // Check updated data
      const updatedDlp1Performance = await dlpPerformance.epochDlpPerformances(
        1,
        1,
      );
      updatedDlp1Performance.totalScore.should.eq(parseEther(1));
      updatedDlp1Performance.tradingVolume.should.eq(parseEther(1500));
      updatedDlp1Performance.uniqueContributors.should.eq(75);
      updatedDlp1Performance.dataAccessFees.should.eq(parseEther(7.5));
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
      await dlpRegistry.connect(maintainer).updateDlpVerification(1, true);
      await dlpRegistry.connect(maintainer).updateDlpVerification(2, true);
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
          totalScore: parseEther(1),
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
        },
        {
          dlpId: 2,
          totalScore: parseEther(0),
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
        },
      ];

      await advanceToEpochN(2);

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, epoch1Performances, true);

      const dlp1Epoch1 = await dlpPerformance.epochDlpPerformances(1, 1);
      dlp1Epoch1.totalScore.should.eq(parseEther(1));

      const dlp2Epoch1 = await dlpPerformance.epochDlpPerformances(1, 2);
      dlp2Epoch1.totalScore.should.eq(parseEther(0));
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
      dlp1.isVerified.should.eq(false);
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

    it("should updateDlpVerification and change eligibility", async function () {
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
        .updateDlpVerification(1, true)
        .should.emit(dlpRegistry, "DlpVerificationUpdated")
        .withArgs(1, true)
        .and.emit(dlpRegistry, "DlpStatusUpdated")
        .withArgs(1, DlpStatus.Eligible);

      let dlp1 = await dlpRegistry.dlps(1);
      dlp1.isVerified.should.eq(true);
      dlp1.status.should.eq(DlpStatus.Eligible);

      // Should be in eligible list
      (await dlpRegistry.eligibleDlpsListCount()).should.eq(1);
      (await dlpRegistry.eligibleDlpsListAt(0)).should.eq(1);
      (await dlpRegistry.eligibleDlpsListValues()).should.deep.eq([1n]);

      // Remove verification
      await dlpRegistry
        .connect(maintainer)
        .updateDlpVerification(1, false)
        .should.emit(dlpRegistry, "DlpVerificationUpdated")
        .withArgs(1, false)
        .and.emit(dlpRegistry, "DlpStatusUpdated")
        .withArgs(1, DlpStatus.Registered);

      dlp1 = await dlpRegistry.dlps(1);
      dlp1.isVerified.should.eq(false);
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
      await dlpRegistry.connect(maintainer).updateDlpVerification(1, true);
      await dlpRegistry.connect(maintainer).updateDlpVerification(2, true);

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
          totalScore: parseEther(0.6),
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
        },
        {
          dlpId: 2,
          totalScore: parseEther(0.4),
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
        },
      ];

      await advanceToEpochN(2);

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, epoch1Performances, true);

      // 7. Verify all state is correct

      // Check DLP registry state
      (await dlpRegistry.dlpsCount()).should.eq(2);
      (await dlpRegistry.eligibleDlpsListCount()).should.eq(2);

      // Check epoch state
      (await vanaEpoch.epochsCount()).should.eq(2);

      const dlp1Performance = await dlpPerformance.epochDlpPerformances(1, 1);
      dlp1Performance.totalScore.should.eq(parseEther(0.6));

      const dlp2Performance = await dlpPerformance.epochDlpPerformances(1, 2);
      dlp2Performance.totalScore.should.eq(parseEther(0.4));

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
      await dlpRegistry.connect(maintainer).updateDlpVerification(1, true);
      await dlpRegistry.connect(maintainer).updateDlpVerification(2, true);

      // 3. Create first epoch
      await vanaEpoch.connect(user1).createEpochs();

      // 4. Record initial performance data
      const initialPerformances = [
        {
          dlpId: 1,
          totalScore: parseEther(0.6),
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
        },
        {
          dlpId: 2,
          totalScore: parseEther(0.4),
          tradingVolume: parseEther(2000),
          uniqueContributors: 100n,
          dataAccessFees: parseEther(10),
        },
      ];

      await advanceToEpochN(2);

      await dlpPerformance
        .connect(manager)
        .saveEpochPerformances(1, initialPerformances, true);

      // 5. Deregister one DLP
      await dlpRegistry.connect(dlp1Owner).deregisterDlp(1);

      // 6. Verify eligible list is updated
      (await dlpRegistry.eligibleDlpsListCount()).should.eq(1);
      (await dlpRegistry.eligibleDlpsListAt(0)).should.eq(2);

      // 7. Check DLP is deregistered but performance data persists
      const dlp1 = await dlpRegistry.dlps(1);
      dlp1.status.should.eq(DlpStatus.Deregistered);

      const dlp1Performance = await dlpPerformance.epochDlpPerformances(1, 1);
      dlp1Performance.totalScore.should.eq(parseEther(0.6));
    });
  });

  describe("Dlp Reward Deployer", () => {
    const dlp1PerformanceDefault = {
      dlpId: 1,
      totalScore: parseEther(0.6),
      tradingVolume: parseEther(1000),
      uniqueContributors: 50n,
      dataAccessFees: parseEther(5),
    };

    const dlp2PerformanceDefault = {
      dlpId: 2,
      totalScore: parseEther(0.4),
      tradingVolume: parseEther(2000),
      uniqueContributors: 100n,
      dataAccessFees: parseEther(10),
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

      await dlpRegistry.connect(maintainer).updateDlpVerification(1, true);
      await dlpRegistry.connect(maintainer).updateDlpVerification(2, true);
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
        .saveEpochPerformances(1, dlpPerformancesDefault, true);

      const epoch1Dlp1 = await vanaEpoch.epochDlps(1, 1);
      epoch1Dlp1.rewardAmount.should.eq(
        (parseEther(0.6) * EPOCH_REWARD_AMOUNT) / parseEther(1),
      );

      const epoch1Dlp2 = await vanaEpoch.epochDlps(1, 2);
      epoch1Dlp2.rewardAmount.should.eq(
        (parseEther(0.4) * EPOCH_REWARD_AMOUNT) / parseEther(1),
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
        .saveEpochPerformances(1, dlpPerformancesDefault, true);

      const epoch1Dlp1 = await vanaEpoch.epochDlps(1, 1);
      epoch1Dlp1.rewardAmount.should.eq(
        (parseEther(0.6) * EPOCH_REWARD_AMOUNT) / parseEther(1),
      );

      const epoch1Dlp2 = await vanaEpoch.epochDlps(1, 2);
      epoch1Dlp2.rewardAmount.should.eq(
        (parseEther(0.4) * EPOCH_REWARD_AMOUNT) / parseEther(1),
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
      epoch1Dlp1DistributedRewards[0].blockNumber.should.eq(
        (await ethers.provider.getBlockNumber()) - 2,
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
  });
});
