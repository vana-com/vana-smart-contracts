import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, network, upgrades } from "hardhat";
import { BaseWallet, formatEther, Wallet } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import {
  DLPRootCoreImplementation,
  DLPRootEpochImplementation,
  DLPRootImplementation,
  DLPRootMetricsImplementation,
  DLPRootTreasuryImplementation,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  advanceBlockNTimes,
  advanceToBlockN,
  getCurrentBlockNumber,
} from "../utils/timeAndBlockManipulation";
import { getReceipt, parseEther } from "../utils/helpers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

chai.use(chaiAsPromised);
should();

chai.Assertion.addMethod(
  "almostEq",
  function (expected: bigint, tolerance: bigint = 1000n) {
    const actual = this._obj as bigint;

    this.assert(
      actual >= expected - tolerance && actual <= expected + tolerance,
      `expected ${actual} to be almost equal to ${expected} within tolerance of ${tolerance}`,
      `expected ${actual} not to be almost equal to ${expected} within tolerance of ${tolerance}`,
      expected,
      actual,
    );
  },
);

chai.Assertion.addMethod(
  "withAlmostArgs",
  function (
    expectedArgs: Array<any>,
    toleranceIndices: number[],
    tolerance: bigint = 1000n,
  ) {
    const actualArgs = this._obj as unknown[];

    this.assert(
      actualArgs.length === expectedArgs.length &&
        actualArgs.every((actual: any, index) => {
          const expected = expectedArgs[index];
          if (toleranceIndices.includes(index)) {
            const actualBigInt = BigInt(actual.toString());
            const expectedBigInt = BigInt(expected.toString());
            return (
              actualBigInt >= expectedBigInt - tolerance &&
              actualBigInt <= expectedBigInt + tolerance
            );
          } else {
            return actual === expected;
          }
        }),
      `expected arguments #{act} to be almost equal to #{exp} within tolerance of #{tolerance} at indices ${toleranceIndices}`,
      `expected arguments #{act} not to be almost equal to #{exp} within tolerance of #{tolerance} at indices ${toleranceIndices}`,
      expectedArgs,
      actualArgs,
    );
  },
);

describe("DLPRoot", () => {
  enum DlpStatus {
    None,
    Registered,
    Eligible,
    SubEligible,
    Deregistered,
  }

  enum RatingType {
    Stake,
    Performance,
  }

  type DlpPerformanceRating = {
    dlpId: bigint;
    performanceRating: bigint;
  };

  let trustedForwarder: HardhatEthersSigner;
  let foundation: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let manager: HardhatEthersSigner;
  let dlp1: BaseWallet;
  let dlp1Owner: HardhatEthersSigner;
  let dlp1Treasury: BaseWallet;
  let dlp2: BaseWallet;
  let dlp2Owner: HardhatEthersSigner;
  let dlp2Treasury: BaseWallet;
  let dlp3: BaseWallet;
  let dlp3Owner: HardhatEthersSigner;
  let dlp3Treasury: BaseWallet;
  let dlp4: BaseWallet;
  let dlp4Owner: HardhatEthersSigner;
  let dlp4Treasury: BaseWallet;
  let dlp5: BaseWallet;
  let dlp5Owner: HardhatEthersSigner;
  let dlp5Treasury: BaseWallet;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;
  let user4: HardhatEthersSigner;
  let user5: HardhatEthersSigner;

  let rootStaking: DLPRootImplementation;
  let rootMetrics: DLPRootMetricsImplementation;
  let rootCore: DLPRootCoreImplementation;
  let rootEpoch: DLPRootEpochImplementation;
  let rewardsTreasury: DLPRootTreasuryImplementation;
  let stakesTreasury: DLPRootTreasuryImplementation;

  const epochDlpsLimit = 3;
  let epochSize = 210;
  let daySize = 10;
  const minStakeAmount = parseEther(0.1);
  let minDlpStakersPercentage = parseEther(50);
  let maxDlpStakersPercentage = parseEther(90);
  let minDlpRegistrationStake = parseEther(1);
  const dlpEligibilityThreshold = parseEther(100);
  const dlpSubEligibilityThreshold = parseEther(50);
  const stakeRatingPercentage = parseEther(80);
  const performanceRatingPercentage = parseEther(20);
  const stakeWithdrawalDelay = 70;
  const rewardClaimDelay = 100;
  let deployBlock: number;
  let startBlock: number;
  let epochRewardAmount = parseEther(2);

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );
  const MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MANAGER_ROLE"));
  const DLP_ROOT_METRICS_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("DLP_ROOT_METRICS_ROLE"),
  );
  const DLP_ROOT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DLP_ROOT_ROLE"));

  type DlpInfo = {
    dlpAddress: BaseWallet;
    ownerAddress: HardhatEthersSigner;
    treasuryAddress: BaseWallet;
    stakersPercentage: bigint;
    name: string;
    iconUrl: string;
    website: string;
    metadata: string;
  };

  let dlpInfo: Record<number, DlpInfo>;

  const deploy = async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });

    [
      owner,
      maintainer,
      manager,
      trustedForwarder,
      foundation,
      user1,
      user2,
      user3,
      user4,
      user5,
      dlp1Owner,
      dlp2Owner,
      dlp3Owner,
      dlp4Owner,
      dlp5Owner,
    ] = await ethers.getSigners();

    [dlp1, dlp2, dlp3, dlp4, dlp5] = Array.from({ length: 5 }, () =>
      ethers.Wallet.createRandom(),
    );
    [dlp1Treasury, dlp2Treasury, dlp3Treasury, dlp4Treasury, dlp5Treasury] =
      Array.from({ length: 5 }, () => ethers.Wallet.createRandom());

    deployBlock = await getCurrentBlockNumber();
    startBlock = deployBlock + 200;

    const dlpRootDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DLPRootImplementation", {}),
      [owner.address],
      {
        kind: "uups",
      },
    );

    rootStaking = await ethers.getContractAt(
      "DLPRootImplementation",
      dlpRootDeploy.target,
    );

    const dlpRootMetricsDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DLPRootMetricsImplementation"),
      [
        owner.address,
        rootStaking.target,
        stakeRatingPercentage,
        performanceRatingPercentage,
      ],
      {
        kind: "uups",
      },
    );

    rootMetrics = await ethers.getContractAt(
      "DLPRootMetricsImplementation",
      dlpRootMetricsDeploy.target,
    );

    const dlpRootCoreDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DLPRootCoreImplementation"),
      [owner.address, rootStaking.target],
      {
        kind: "uups",
      },
    );

    rootCore = await ethers.getContractAt(
      "DLPRootCoreImplementation",
      dlpRootCoreDeploy.target,
    );

    const dlpRootEpochDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DLPRootEpochImplementation"),
      [owner.address, rootStaking.target, daySize],
      {
        kind: "uups",
      },
    );

    rootEpoch = await ethers.getContractAt(
      "DLPRootEpochImplementation",
      dlpRootEpochDeploy.target,
    );

    await rootStaking.connect(owner).grantRole(MAINTAINER_ROLE, owner);
    await rootStaking.connect(owner).grantRole(MANAGER_ROLE, owner);
    await rootStaking.connect(owner).updateTrustedForwarder(trustedForwarder);
    await rootStaking.connect(owner).updateDlpRootMetrics(rootMetrics);
    await rootStaking.connect(owner).updateDlpRootCore(rootCore);
    await rootStaking.connect(owner).updateDlpRootEpoch(rootEpoch);

    await rootEpoch.connect(owner).updateEpochDlpsLimit(epochDlpsLimit);
    await rootCore
      .connect(owner)
      .updateDlpStakersPercentages(
        minDlpStakersPercentage,
        maxDlpStakersPercentage,
      );
    await rootCore
      .connect(owner)
      .updateDlpEligibilityThresholds(
        dlpSubEligibilityThreshold,
        dlpEligibilityThreshold,
      );
    await rootCore
      .connect(owner)
      .updateMinDlpRegistrationStake(minDlpRegistrationStake);
    await rootStaking.connect(owner).updateMinStakeAmount(minStakeAmount);
    await rootStaking
      .connect(owner)
      .updateStakeWithdrawalDelay(stakeWithdrawalDelay);
    await rootStaking.connect(owner).updateRewardClaimDelay(rewardClaimDelay);

    await rootEpoch.connect(owner).updateEpochSize(epochSize);
    await rootEpoch.connect(owner).updateEpochRewardAmount(epochRewardAmount);

    await rootEpoch.connect(owner).overrideEpoch(0, 0, startBlock - 1, 0);

    const dlpRootRewardsTreasuryDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DLPRootTreasuryImplementation"),
      [owner.address, rootStaking.target],
      {
        kind: "uups",
      },
    );

    rewardsTreasury = await ethers.getContractAt(
      "DLPRootTreasuryImplementation",
      dlpRootRewardsTreasuryDeploy.target,
    );

    const dlpRootStakesTreasuryDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DLPRootTreasuryImplementation"),
      [owner.address, rootStaking.target],
      {
        kind: "uups",
      },
    );

    stakesTreasury = await ethers.getContractAt(
      "DLPRootTreasuryImplementation",
      dlpRootStakesTreasuryDeploy.target,
    );

    await rootStaking.connect(owner).grantRole(MAINTAINER_ROLE, maintainer);
    await rootStaking.connect(owner).grantRole(MANAGER_ROLE, manager);

    await rootStaking.connect(owner).updateDlpRootMetrics(rootMetrics);
    await rootStaking
      .connect(owner)
      .updateDlpRootRewardsTreasury(rewardsTreasury);
    await rootStaking
      .connect(owner)
      .updateDlpRootStakesTreasury(stakesTreasury);

    await rewardsTreasury
      .connect(owner)
      .grantRole(DEFAULT_ADMIN_ROLE, rootEpoch);
    await rootCore.connect(owner).grantRole(MAINTAINER_ROLE, maintainer);
    await rootEpoch.connect(owner).grantRole(MAINTAINER_ROLE, maintainer);
    await rootEpoch.connect(owner).grantRole(MANAGER_ROLE, manager);
    await rootEpoch
      .connect(owner)
      .grantRole(DLP_ROOT_METRICS_ROLE, rootMetrics);

    await rootStaking
      .connect(owner)
      .grantRole(DLP_ROOT_METRICS_ROLE, rootMetrics);

    await rootMetrics.connect(owner).grantRole(MAINTAINER_ROLE, maintainer);
    await rootMetrics.connect(owner).grantRole(MANAGER_ROLE, manager);
    await rootMetrics.connect(owner).grantRole(DLP_ROOT_ROLE, rootStaking);
    await rootMetrics
      .connect(maintainer)
      .updateFoundationWalletAddress(foundation);

    dlpInfo = {
      1: {
        dlpAddress: dlp1,
        ownerAddress: dlp1Owner,
        treasuryAddress: dlp1Treasury,
        stakersPercentage: minDlpStakersPercentage,
        name: "dlp1Name",
        iconUrl: "dlp1IconUrl",
        website: "dlp1Website",
        metadata: "dlp1Metadata",
      },
      2: {
        dlpAddress: dlp2,
        ownerAddress: dlp2Owner,
        treasuryAddress: dlp2Treasury,
        stakersPercentage: minDlpStakersPercentage,
        name: "dlp2Name",
        iconUrl: "dlp2IconUrl",
        website: "dlp2Website",
        metadata: "dlp2Metadata",
      },
      3: {
        dlpAddress: dlp3,
        ownerAddress: dlp3Owner,
        treasuryAddress: dlp3Treasury,
        stakersPercentage: minDlpStakersPercentage,
        name: "dlp3Name",
        iconUrl: "dlp3IconUrl",
        website: "dlp3Website",
        metadata: "dlp3Metadata",
      },
      4: {
        dlpAddress: dlp4,
        ownerAddress: dlp4Owner,
        treasuryAddress: dlp4Treasury,
        stakersPercentage: minDlpStakersPercentage,
        name: "dlp4Name",
        iconUrl: "dlp4IconUrl",
        website: "dlp4Website",
        metadata: "dlp4Metadata",
      },
      5: {
        dlpAddress: dlp5,
        ownerAddress: dlp5Owner,
        treasuryAddress: dlp5Treasury,
        stakersPercentage: minDlpStakersPercentage,
        name: "dlp5Name",
        iconUrl: "dlp5IconUrl",
        website: "dlp5Website",
        metadata: "dlp5Metadata",
      },
    };
  };

  async function advanceToEpochN(epochNumber: number) {
    const epochNStartBlock = startBlock + (epochNumber - 1) * epochSize;

    await advanceToBlockN(epochNStartBlock);
  }

  async function register5Dlps() {
    await rootCore
      .connect(dlp1Owner)
      .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });
    await rootCore
      .connect(dlp2Owner)
      .registerDlp(dlpInfo[2], { value: dlpEligibilityThreshold });

    await rootCore
      .connect(dlp3Owner)
      .registerDlp(dlpInfo[3], { value: dlpEligibilityThreshold });

    await rootCore
      .connect(dlp4Owner)
      .registerDlp(dlpInfo[4], { value: dlpEligibilityThreshold });

    await rootCore
      .connect(dlp5Owner)
      .registerDlp(dlpInfo[5], { value: dlpEligibilityThreshold });

    await rootCore.connect(maintainer).updateDlpVerification(1, true);
    await rootCore.connect(maintainer).updateDlpVerification(2, true);
    await rootCore.connect(maintainer).updateDlpVerification(3, true);
    await rootCore.connect(maintainer).updateDlpVerification(4, true);
    await rootCore.connect(maintainer).updateDlpVerification(5, true);
  }

  async function registerNDlps(stakes: bigint[], verify: boolean = true) {
    const lastDlpId = Number(await rootCore.dlpsCount());
    for (let i = 1; i <= stakes.length; i++) {
      await rootCore.connect(dlp1Owner).registerDlp(
        {
          dlpAddress: Wallet.createRandom(),
          ownerAddress: dlp1Owner,
          treasuryAddress: Wallet.createRandom(),
          stakersPercentage: minDlpStakersPercentage,
          name: `dlp${lastDlpId + i}Name`,
          iconUrl: `dlp${lastDlpId + i}IconUrl`,
          website: `dlp${lastDlpId + i}Website`,
          metadata: `dlp${lastDlpId + i}Metadata`,
        },
        { value: stakes[i - 1] },
      );

      if (verify)
        await rootCore
          .connect(maintainer)
          .updateDlpVerification(lastDlpId + i, true);
    }
  }

  async function registerNDlpsExtended(
    stakes: bigint[],
    stakerPercentages: bigint[],
    verify: boolean = true,
  ) {
    const lastDlpId = Number(await rootCore.dlpsCount());
    for (let i = 1; i <= stakes.length; i++) {
      await rootCore.connect(dlp1Owner).registerDlp(
        {
          dlpAddress: Wallet.createRandom(),
          ownerAddress: dlp1Owner,
          treasuryAddress: Wallet.createRandom(),
          stakersPercentage: stakerPercentages[i - 1],
          name: `dlp${lastDlpId + i}Name`,
          iconUrl: `dlp${lastDlpId + i}IconUrl`,
          website: `dlp${lastDlpId + i}Website`,
          metadata: `dlp${lastDlpId + i}Metadata`,
        },
        { value: stakes[i - 1] },
      );

      if (verify)
        await rootCore
          .connect(maintainer)
          .updateDlpVerification(lastDlpId + i, true);
    }
  }

  function randomBigint(min: bigint, max: bigint): bigint {
    return (
      min + BigInt(Math.floor(Math.random() * Number(max - min + BigInt(1))))
    );
  }

  function generateStakes(length: number, min: bigint, max: bigint): bigint[] {
    return Array.from({ length }, () => randomBigint(min, max));
  }

  function getTopKStakes(arr: bigint[], k: number): number[] {
    // Create an array of tuples where each tuple is [value, index]
    const indexedArr = arr.map(
      (value, index) => [value, index] as [bigint, number],
    );

    // Sort the array of tuples based on the value in descending order
    indexedArr.sort((a, b) => (b[0] >= a[0] ? 1 : -1));

    // Extract the indexes of the top k elements
    const topKIndexes = indexedArr.slice(0, k).map((tuple) => tuple[1] + 1);

    return topKIndexes;
  }

  function getMultiplier(index: number | bigint): bigint {
    if (typeof index === "bigint") {
      index = Number(index);
    }

    if (index >= 83) {
      return 30000n;
    }

    const multiplier = [
      476, 952, 1428, 1904, 2380, 2857, 3333, 3809, 4285, 4761, 5238, 5714,
      6190, 6666, 7142, 7619, 8095, 8571, 9047, 9523, 10000, 10200, 10500,
      10700, 11000, 11200, 11400, 11700, 11900, 12100, 12400, 12600, 12900,
      13100, 13300, 13600, 13800, 14000, 14300, 14500, 14800, 15000, 15600,
      16200, 16800, 17400, 18000, 18600, 19200, 19800, 20400, 21000, 21500,
      22100, 22700, 23300, 23900, 24500, 25100, 25700, 26300, 26900, 27500,
      27600, 27700, 27900, 28000, 28100, 28200, 28300, 28500, 28600, 28700,
      28800, 28900, 29000, 29200, 29300, 29400, 29500, 29600, 29800, 29900,
      30000,
    ];

    return BigInt(multiplier[index]);
  }

  function calculateStakeScore(
    stakeAmount: bigint,
    stakeStartBlock: number | bigint,
    blockNumber: number | bigint,
    firstTwoEpochs: boolean = false,
  ): bigint {
    let daysStaked = Math.floor(
      (Number(blockNumber) - Number(stakeStartBlock)) / daySize,
    );

    daysStaked += firstTwoEpochs ? 20 : 0;

    return (stakeAmount * getMultiplier(daysStaked)) / 10000n;
  }

  function calculateStakeScoreByDay(
    stakeAmount: bigint,
    daysStaked: number,
    firstTwoEpochs: boolean = false,
  ): bigint {
    daysStaked += firstTwoEpochs ? 20 : 0;
    return (stakeAmount * getMultiplier(daysStaked)) / 10000n;
  }

  function dlpPerformanceRating(
    dlpId: number | bigint,
    rating: bigint,
  ): DlpPerformanceRating {
    return {
      dlpId: BigInt(dlpId),
      performanceRating: rating,
    };
  }

  async function saveDefaultEpochPerformanceRatings(epochId: number) {
    await rootMetrics.connect(manager).saveEpochPerformanceRatings(
      epochId,
      (await rootCore.eligibleDlpsListValues()).map((id) =>
        dlpPerformanceRating(id, 1n),
      ),
    );
    await rootMetrics.connect(manager).finalizeEpoch(epochId);
  }

  describe("Setup", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should have correct params after deploy", async function () {
      (await rootStaking.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(true);
      (await rootStaking.hasRole(MAINTAINER_ROLE, owner)).should.eq(true);
      (await rootStaking.hasRole(MANAGER_ROLE, owner)).should.eq(true);
      (await rootStaking.hasRole(MAINTAINER_ROLE, maintainer)).should.eq(true);
      (await rootStaking.hasRole(MANAGER_ROLE, manager)).should.eq(true);
      (await rootStaking.hasRole(DLP_ROOT_METRICS_ROLE, rootMetrics)).should.eq(
        true,
      );
      (await rootEpoch.epochDlpsLimit()).should.eq(epochDlpsLimit);
      (await rootCore.minDlpRegistrationStake()).should.eq(
        minDlpRegistrationStake,
      );
      (await rootCore.minDlpStakersPercentage()).should.eq(
        minDlpStakersPercentage,
      );
      (await rootCore.maxDlpStakersPercentage()).should.eq(
        maxDlpStakersPercentage,
      );
      (await rootCore.dlpEligibilityThreshold()).should.eq(
        dlpEligibilityThreshold,
      );
      (await rootCore.dlpSubEligibilityThreshold()).should.eq(
        dlpSubEligibilityThreshold,
      );
      (await rootEpoch.epochSize()).should.eq(epochSize);
      (await rootEpoch.epochRewardAmount()).should.eq(epochRewardAmount);
      (await rootStaking.paused()).should.eq(false);
      (await rootStaking.version()).should.eq(4);
      (await rootStaking.dlpRootMetrics()).should.eq(rootMetrics);
      (await rootStaking.dlpRootRewardsTreasury()).should.eq(rewardsTreasury);
      (await rootStaking.dlpRootStakesTreasury()).should.eq(stakesTreasury);

      (await rootEpoch.epochsCount()).should.eq(0);

      const epoch = await rootEpoch.epochs(0);
      epoch.startBlock.should.eq(0);
      epoch.endBlock.should.eq(startBlock - 1);
      epoch.dlpIds.should.deep.eq([]);
    });

    it("should pause when maintainer", async function () {
      await rootStaking
        .connect(maintainer)
        .pause()
        .should.emit(rootStaking, "Paused")
        .withArgs(maintainer.address);
      (await rootStaking.paused()).should.be.equal(true);
    });

    it("should reject pause when non-maintainer", async function () {
      await rootStaking
        .connect(manager)
        .pause()
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${manager.address}", "${MAINTAINER_ROLE}")`,
        );
      (await rootStaking.paused()).should.be.equal(false);
    });

    it("should unpause when maintainer", async function () {
      await rootStaking.connect(maintainer).pause();
      await rootStaking
        .connect(owner)
        .unpause()
        .should.emit(rootStaking, "Unpaused")
        .withArgs(owner.address);
      (await rootStaking.paused()).should.be.equal(false);
    });

    it("should reject unpause when non-maintainer", async function () {
      await rootStaking.connect(owner).pause();
      await rootStaking
        .connect(manager)
        .unpause()
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${manager.address}", "${MAINTAINER_ROLE}")`,
        );
      (await rootStaking.paused()).should.be.equal(true);
    });

    it("should updateEpochDlpsLimit when maintainer", async function () {
      await rootEpoch
        .connect(maintainer)
        .updateEpochDlpsLimit(123)
        .should.emit(rootEpoch, "EpochDlpsLimitUpdated")
        .withArgs(123);

      (await rootEpoch.epochDlpsLimit()).should.eq(123);
    });

    it("should reject updateEpochDlpsLimit when non-maintainer", async function () {
      await rootEpoch
        .connect(manager)
        .updateEpochDlpsLimit(123)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${manager.address}", "${MAINTAINER_ROLE}")`,
        );

      (await rootEpoch.epochDlpsLimit()).should.eq(epochDlpsLimit);
    });

    it("should updateEpochSize when maintainer", async function () {
      await rootEpoch
        .connect(owner)
        .updateEpochSize(123)
        .should.emit(rootEpoch, "EpochSizeUpdated")
        .withArgs(123);

      (await rootEpoch.epochSize()).should.eq(123);
    });

    it("should reject updateEpochSize when non-maintainer", async function () {
      await rootEpoch
        .connect(manager)
        .updateEpochSize(123)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${manager.address}", "${DEFAULT_ADMIN_ROLE}")`,
        );

      (await rootEpoch.epochSize()).should.eq(epochSize);
    });

    it("should updateEpochRewardAmount when maintainer", async function () {
      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();

      (await rootEpoch.epochs(1)).rewardAmount.should.eq(epochRewardAmount);

      await rootEpoch
        .connect(owner)
        .updateEpochRewardAmount(123)
        .should.emit(rootEpoch, "EpochRewardAmountUpdated")
        .withArgs(123);

      (await rootEpoch.epochRewardAmount()).should.eq(123);

      (await rootEpoch.epochs(1)).rewardAmount.should.eq(epochRewardAmount);
    });

    it("should reject updateEpochSize when non-maintainer", async function () {
      await rootEpoch
        .connect(manager)
        .updateEpochRewardAmount(123)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${manager.address}", "${DEFAULT_ADMIN_ROLE}")`,
        );

      (await rootEpoch.epochRewardAmount()).should.eq(epochRewardAmount);
    });

    it("should updateMinStakeAmount when maintainer", async function () {
      await rootStaking
        .connect(maintainer)
        .updateMinStakeAmount(minStakeAmount + 1n)
        .should.emit(rootStaking, "MinStakeAmountUpdated")
        .withArgs(minStakeAmount + 1n);

      (await rootStaking.minStakeAmount()).should.eq(minStakeAmount + 1n);
    });

    it("should reject updateMinStakeAmount when non-maintainer", async function () {
      await rootStaking
        .connect(manager)
        .updateMinStakeAmount(minStakeAmount + 1n)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${manager.address}", "${MAINTAINER_ROLE}")`,
        );

      (await rootStaking.minStakeAmount()).should.eq(minStakeAmount);
    });

    it("should updateDlpStakersPercentages when maintainer", async function () {
      await registerNDlpsExtended(
        [
          minDlpRegistrationStake,
          minDlpRegistrationStake,
          minDlpRegistrationStake,
          minDlpRegistrationStake,
          minDlpRegistrationStake,
        ],
        [
          parseEther(50),
          parseEther(90),
          parseEther(61),
          parseEther(62),
          parseEther(61.5),
        ],
      );
      await rootCore
        .connect(maintainer)
        .updateDlpStakersPercentages(parseEther(61), parseEther(62))
        .should.emit(rootCore, "MinDlpStakersPercentageUpdated")
        .withArgs(parseEther(61))
        .and.emit(rootCore, "MaxDlpStakersPercentageUpdated")
        .withArgs(parseEther(62));

      (await rootCore.minDlpStakersPercentage()).should.eq(parseEther(61));
      (await rootCore.maxDlpStakersPercentage()).should.eq(parseEther(62));

      (await rootCore.dlps(1)).stakersPercentage.should.eq(parseEther(61));
      (await rootCore.dlps(2)).stakersPercentage.should.eq(parseEther(62));
      (await rootCore.dlps(3)).stakersPercentage.should.eq(parseEther(61));
      (await rootCore.dlps(4)).stakersPercentage.should.eq(parseEther(62));
      (await rootCore.dlps(5)).stakersPercentage.should.eq(parseEther(61.5));
    });

    it("should reject updateDlpStakersPercentages when non-maintainer", async function () {
      await rootCore
        .connect(manager)
        .updateDlpStakersPercentages(parseEther(0.2), parseEther(0.3))
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${manager.address}", "${MAINTAINER_ROLE}")`,
        );

      (await rootCore.minDlpStakersPercentage()).should.eq(
        minDlpStakersPercentage,
      );
    });

    it("should updateMinDlpRegistrationStake when maintainer", async function () {
      await rootCore
        .connect(maintainer)
        .updateMinDlpRegistrationStake(parseEther(0.2))
        .should.emit(rootCore, "MinDlpRegistrationStakeUpdated")
        .withArgs(parseEther(0.2));

      (await rootCore.minDlpRegistrationStake()).should.eq(parseEther(0.2));
    });

    it("should reject updateMinDlpRegistrationStake when non-maintainer", async function () {
      await rootCore
        .connect(manager)
        .updateMinDlpRegistrationStake(parseEther(0.2))
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${manager.address}", "${MAINTAINER_ROLE}")`,
        );

      (await rootCore.minDlpRegistrationStake()).should.eq(
        minDlpRegistrationStake,
      );
    });

    it("should updateDlpEligibilityThresholds when maintainer", async function () {
      await rootCore
        .connect(maintainer)
        .updateDlpEligibilityThresholds(parseEther(99), parseEther(101))
        .should.emit(rootCore, "DlpSubEligibilityThresholdUpdated")
        .withArgs(parseEther(99))
        .and.emit(rootCore, "DlpEligibilityThresholdUpdated")
        .withArgs(parseEther(101));

      (await rootCore.dlpSubEligibilityThreshold()).should.eq(parseEther(99));
      (await rootCore.dlpEligibilityThreshold()).should.eq(parseEther(101));
    });

    it("should reject updateDlpEligibilityThresholds when non-maintainer", async function () {
      await rootCore
        .connect(manager)
        .updateDlpEligibilityThresholds(parseEther(101), parseEther(101))
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${manager.address}", "${MAINTAINER_ROLE}")`,
        );

      (await rootCore.dlpEligibilityThreshold()).should.eq(
        dlpEligibilityThreshold,
      );
    });

    it("should updateStakeWithdrawalDelay when maintainer", async function () {
      await rootStaking
        .connect(maintainer)
        .updateStakeWithdrawalDelay(stakeWithdrawalDelay + 1)
        .should.emit(rootStaking, "StakeWithdrawalDelayUpdated")
        .withArgs(stakeWithdrawalDelay + 1);

      (await rootStaking.stakeWithdrawalDelay()).should.eq(
        stakeWithdrawalDelay + 1,
      );
    });

    it("should reject updateStakeWithdrawalDelay when non-maintainer", async function () {
      await rootStaking
        .connect(manager)
        .updateStakeWithdrawalDelay(stakeWithdrawalDelay + 1)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${manager.address}", "${MAINTAINER_ROLE}")`,
        );

      (await rootStaking.stakeWithdrawalDelay()).should.eq(
        stakeWithdrawalDelay,
      );
    });

    it("should updateTrustedForwarder when maintainer", async function () {
      await rootStaking.connect(maintainer).updateTrustedForwarder(user1);

      (await rootStaking.trustedForwarder()).should.eq(user1);
    });

    it("should reject updateTrustedForwarder when non-maintainer", async function () {
      await rootStaking
        .connect(manager)
        .updateTrustedForwarder(user1)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${manager.address}", "${MAINTAINER_ROLE}")`,
        );

      (await rootStaking.trustedForwarder()).should.eq(trustedForwarder);
    });

    it("should updateDlpRootMetrics when maintainer", async function () {
      await rootStaking.connect(maintainer).updateDlpRootMetrics(user1);

      (await rootStaking.dlpRootMetrics()).should.eq(user1);
    });

    it("should reject updateDlpRootMetrics when non-maintainer", async function () {
      await rootStaking
        .connect(manager)
        .updateDlpRootMetrics(user1)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${manager.address}", "${MAINTAINER_ROLE}")`,
        );

      (await rootStaking.dlpRootMetrics()).should.eq(rootMetrics);
    });

    it("should change admin", async function () {
      await rootStaking.connect(owner).grantRole(MAINTAINER_ROLE, user1.address)
        .should.not.be.rejected;

      await rootStaking
        .connect(owner)
        .grantRole(DEFAULT_ADMIN_ROLE, user1.address).should.be.fulfilled;

      await rootStaking
        .connect(user1)
        .revokeRole(DEFAULT_ADMIN_ROLE, owner.address);

      await rootStaking
        .connect(owner)
        .updateDlpRootRewardsTreasury(dlp1Treasury)
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${owner.address}", "${DEFAULT_ADMIN_ROLE}`,
        );

      await rootStaking
        .connect(user1)
        .updateDlpRootRewardsTreasury(dlp1Treasury).should.be.fulfilled;
    });

    it("should upgradeTo when owner", async function () {
      await upgrades.upgradeProxy(
        rootStaking,
        await ethers.getContractFactory("DLPRootImplementationV2Mock", owner),
      );

      const newRoot = await ethers.getContractAt(
        "DLPRootImplementationV2Mock",
        rootStaking,
      );

      (await newRoot.paused()).should.eq(false);
      (await newRoot.version()).should.eq(2);

      (await newRoot.test()).should.eq("test");
    });

    it("should upgradeTo when owner and emit event", async function () {
      const newRootImplementation = await ethers.deployContract(
        "DLPRootImplementationV2Mock",
      );

      await rootStaking
        .connect(owner)
        .upgradeToAndCall(newRootImplementation, "0x")
        .should.emit(rootStaking, "Upgraded")
        .withArgs(newRootImplementation);

      const newRoot = await ethers.getContractAt(
        "DLPRootImplementationV2Mock",
        rootStaking,
      );

      (await newRoot.paused()).should.eq(false);
      (await newRoot.version()).should.eq(2);

      (await newRoot.test()).should.eq("test");
    });

    it("should reject upgradeTo when storage layout is incompatible", async function () {
      await upgrades
        .upgradeProxy(
          rootStaking,
          await ethers.getContractFactory("DLPRootImplementationV3Mock", owner),
        )
        .should.be.rejectedWith("New storage layout is incompatible");
    });

    it("should reject upgradeTo when non owner", async function () {
      const newRootImplementation = await ethers.deployContract(
        "DLPRootImplementationV2Mock",
      );

      await rootStaking
        .connect(user1)
        .upgradeToAndCall(newRootImplementation, "0x")
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
        );
    });
  });

  describe("Dlps - registration", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should registerDlp when stake <  dlpEligibilityThreshold", async function () {
      const dlp1OwnerInitialBalance =
        await ethers.provider.getBalance(dlp1Owner);

      const registrationAmount = minDlpRegistrationStake;
      const stakerPercentage = minDlpStakersPercentage;

      const blockNumber = await getCurrentBlockNumber();
      const tx = await rootCore.connect(user1).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: stakerPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: registrationAmount },
      );

      const receipt = await getReceipt(tx);

      receipt.should
        .emit(rootStaking, "DlpRegistered")
        .withArgs(
          1,
          dlp1,
          dlp1Owner,
          dlp1Treasury,
          stakerPercentage,
          "dlp1Name",
          "dlp1IconUrl",
          "dlp1Website",
          "dlp1Metadata",
        )
        .emit(rootStaking, "StakeCreated")
        .withArgs(1, dlp1Owner, 1, registrationAmount);

      (await rootCore.dlpsCount()).should.eq(1);

      const dlp1Info = await rootCore.dlps(1);

      dlp1Info.id.should.eq(1);
      dlp1Info.dlpAddress.should.eq(dlp1);
      dlp1Info.ownerAddress.should.eq(dlp1Owner.address);
      dlp1Info.treasuryAddress.should.eq(dlp1Treasury);
      dlp1Info.stakersPercentage.should.eq(stakerPercentage);
      dlp1Info.stakersPercentageEpoch.should.eq(minDlpStakersPercentage);
      dlp1Info.name.should.eq("dlp1Name");
      dlp1Info.iconUrl.should.eq("dlp1IconUrl");
      dlp1Info.website.should.eq("dlp1Website");
      dlp1Info.metadata.should.eq("dlp1Metadata");

      dlp1Info.stakeAmount.should.eq(registrationAmount);
      dlp1Info.status.should.eq(DlpStatus.Registered);
      dlp1Info.registrationBlockNumber.should.eq(blockNumber + 1);

      (await rootCore.dlpsByAddress(dlp1)).should.deep.eq(dlp1Info);
      (await rootCore.dlpNameToId("dlp1Name")).should.deep.eq(1);
      (await rootCore.dlpsByName("dlp1Name")).should.deep.eq(dlp1Info);

      (await ethers.provider.getBalance(user1)).should.eq(
        dlp1OwnerInitialBalance - registrationAmount - receipt.fee,
      );
      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        registrationAmount,
      );
    });

    it("should registerDlp when stake = dlpEligibilityThreshold", async function () {
      const dlp1OwnerInitialBalance =
        await ethers.provider.getBalance(dlp1Owner);

      const registrationAmount = dlpEligibilityThreshold;
      const stakerPercentage = minDlpStakersPercentage;

      const blockNumber = await getCurrentBlockNumber();
      const tx = await rootCore.connect(user1).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: stakerPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: registrationAmount },
      );

      const receipt = await getReceipt(tx);

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      receipt.should
        .emit(rootStaking, "DlpRegistered")
        .withArgs(
          1,
          dlp1,
          dlp1Owner,
          dlp1Treasury,
          stakerPercentage,
          "dlp1Name",
          "dlp1IconUrl",
          "dlp1Website",
          "dlp1Metadata",
        )
        .emit(rootStaking, "StakeCreated")
        .withArgs(1, dlp1Owner, 1, registrationAmount)
        .emit(rootStaking, "DlpBecameEligible")
        .withArgs(1);

      (await rootCore.dlpsCount()).should.eq(1);

      const dlp1Info = await rootCore.dlps(1);

      dlp1Info.id.should.eq(1);
      dlp1Info.dlpAddress.should.eq(dlp1);
      dlp1Info.ownerAddress.should.eq(dlp1Owner.address);
      dlp1Info.treasuryAddress.should.eq(dlp1Treasury);
      dlp1Info.stakersPercentage.should.eq(stakerPercentage);
      dlp1Info.stakersPercentageEpoch.should.eq(minDlpStakersPercentage);
      dlp1Info.name.should.eq("dlp1Name");
      dlp1Info.iconUrl.should.eq("dlp1IconUrl");
      dlp1Info.website.should.eq("dlp1Website");
      dlp1Info.metadata.should.eq("dlp1Metadata");

      dlp1Info.stakeAmount.should.eq(registrationAmount);
      dlp1Info.status.should.eq(DlpStatus.Eligible);
      dlp1Info.registrationBlockNumber.should.eq(blockNumber + 1);

      (await rootCore.dlpsByAddress(dlp1)).should.deep.eq(dlp1Info);

      (await rootCore.eligibleDlpsListCount()).should.eq(1);
      (await rootCore.eligibleDlpsListAt(0)).should.eq(1);
      (await rootCore.eligibleDlpsListValues()).should.deep.eq([1n]);

      (await ethers.provider.getBalance(user1)).should.eq(
        dlp1OwnerInitialBalance - registrationAmount - receipt.fee,
      );
      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        registrationAmount,
      );
    });

    it("should change eligibility after staking and unstaking", async function () {
      const dlp1OwnerInitialBalance =
        await ethers.provider.getBalance(dlp1Owner);

      const registrationAmount = minDlpRegistrationStake;
      const stakerPercentage = minDlpStakersPercentage;

      const blockNumber = await getCurrentBlockNumber();
      const tx = await rootCore.connect(user1).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: stakerPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: registrationAmount },
      );

      const receipt = await getReceipt(tx);

      receipt.should
        .emit(rootStaking, "DlpRegistered")
        .withArgs(
          1,
          dlp1,
          dlp1Owner,
          dlp1Treasury,
          stakerPercentage,
          "dlp1Name",
          "dlp1IconUrl",
          "dlp1Website",
          "dlp1Metadata",
        )
        .emit(rootStaking, "StakeCreated")
        .withArgs(1, dlp1Owner, 1, registrationAmount);

      (await rootCore.dlpsCount()).should.eq(1);

      let dlp1Info = await rootCore.dlps(1);

      dlp1Info.id.should.eq(1);
      dlp1Info.dlpAddress.should.eq(dlp1);
      dlp1Info.ownerAddress.should.eq(dlp1Owner.address);
      dlp1Info.treasuryAddress.should.eq(dlp1Treasury);
      dlp1Info.stakersPercentage.should.eq(stakerPercentage);
      dlp1Info.stakersPercentageEpoch.should.eq(stakerPercentage);
      dlp1Info.name.should.eq("dlp1Name");
      dlp1Info.iconUrl.should.eq("dlp1IconUrl");
      dlp1Info.website.should.eq("dlp1Website");
      dlp1Info.metadata.should.eq("dlp1Metadata");

      dlp1Info.stakeAmount.should.eq(registrationAmount);
      dlp1Info.status.should.eq(DlpStatus.Registered);
      dlp1Info.registrationBlockNumber.should.eq(blockNumber + 1);

      (await rootCore.dlpsByAddress(dlp1)).should.deep.eq(dlp1Info);

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      (await ethers.provider.getBalance(user1)).should.eq(
        dlp1OwnerInitialBalance - registrationAmount - receipt.fee,
      );
      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        registrationAmount,
      );

      await rootStaking.connect(user1).createStake(1, {
        value: dlpEligibilityThreshold - registrationAmount,
      });

      dlp1Info = await rootCore.dlps(1);
      dlp1Info.stakeAmount.should.eq(dlpEligibilityThreshold);
      dlp1Info.status.should.eq(DlpStatus.Eligible);
      (await rootCore.eligibleDlpsListValues()).should.deep.eq([1n]);

      await rootStaking.connect(user1).closeStakes([2]);

      dlp1Info = await rootCore.dlps(1);
      dlp1Info.stakeAmount.should.eq(minDlpRegistrationStake);
      dlp1Info.status.should.eq(DlpStatus.Registered);

      (await rootCore.eligibleDlpsListValues()).should.deep.eq([]);
    });

    it("should registerDlp after epoch1.startBlock", async function () {
      await advanceToEpochN(1);

      const dlp1OwnerInitialBalance =
        await ethers.provider.getBalance(dlp1Owner);

      const registrationAmount = dlpEligibilityThreshold;
      const stakerPercentage = minDlpStakersPercentage;

      const blockNumber = await getCurrentBlockNumber();
      const tx = await rootCore.connect(user1).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: stakerPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: registrationAmount },
      );

      const receipt = await getReceipt(tx);

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      receipt.should
        .emit(rootStaking, "DlpRegistered")
        .withArgs(
          1,
          dlp1,
          dlp1Owner,
          dlp1Treasury,
          stakerPercentage,
          "dlp1Name",
          "dlp1IconUrl",
          "dlp1Website",
          "dlp1Metadata",
        )
        .emit(rootStaking, "StakeCreated")
        .withArgs(1, dlp1Owner, 1, registrationAmount)
        .emit(rootStaking, "DlpBecameEligible")
        .withArgs(1);

      (await rootCore.dlpsCount()).should.eq(1);

      const dlp1Info = await rootCore.dlps(1);

      dlp1Info.id.should.eq(1);
      dlp1Info.dlpAddress.should.eq(dlp1);
      dlp1Info.ownerAddress.should.eq(dlp1Owner.address);
      dlp1Info.treasuryAddress.should.eq(dlp1Treasury);
      dlp1Info.stakersPercentage.should.eq(stakerPercentage);
      dlp1Info.stakersPercentageEpoch.should.eq(minDlpStakersPercentage);
      dlp1Info.name.should.eq("dlp1Name");
      dlp1Info.iconUrl.should.eq("dlp1IconUrl");
      dlp1Info.website.should.eq("dlp1Website");
      dlp1Info.metadata.should.eq("dlp1Metadata");

      dlp1Info.stakeAmount.should.eq(registrationAmount);
      dlp1Info.status.should.eq(DlpStatus.Eligible);
      dlp1Info.registrationBlockNumber.should.eq(blockNumber + 1);

      (await rootCore.dlpsByAddress(dlp1)).should.deep.eq(dlp1Info);

      (await rootCore.eligibleDlpsListCount()).should.eq(1);
      (await rootCore.eligibleDlpsListAt(0)).should.eq(1);
      (await rootCore.eligibleDlpsListValues()).should.deep.eq([1n]);

      (await ethers.provider.getBalance(user1)).should.eq(
        dlp1OwnerInitialBalance - registrationAmount - receipt.fee,
      );
      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        registrationAmount,
      );
    });

    it("should registerDlp and add stake", async function () {
      const dlp1OwnerInitialBalance =
        await ethers.provider.getBalance(dlp1Owner);

      const registrationAmount = minDlpRegistrationStake;
      const stakerPercentage = minDlpStakersPercentage;

      const blockNumber = await getCurrentBlockNumber();
      const tx = await rootCore.connect(user1).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: stakerPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: registrationAmount },
      );

      const receipt = await getReceipt(tx);

      receipt.should
        .emit(rootStaking, "DlpRegistered")
        .withArgs(
          1,
          dlp1,
          dlp1Owner,
          dlp1Treasury,
          stakerPercentage,
          "dlp1Name",
          "dlp1IconUrl",
          "dlp1Website",
          "dlp1Metadata",
        )
        .emit(rootStaking, "StakeCreated")
        .withArgs(1, dlp1Owner, 1, registrationAmount);

      (await rootCore.dlpsCount()).should.eq(1);

      const dlp1Info = await rootCore.dlps(1);

      dlp1Info.id.should.eq(1);
      dlp1Info.dlpAddress.should.eq(dlp1);
      dlp1Info.ownerAddress.should.eq(dlp1Owner.address);
      dlp1Info.treasuryAddress.should.eq(dlp1Treasury);
      dlp1Info.stakersPercentage.should.eq(stakerPercentage);
      dlp1Info.name.should.eq("dlp1Name");
      dlp1Info.iconUrl.should.eq("dlp1IconUrl");
      dlp1Info.website.should.eq("dlp1Website");
      dlp1Info.metadata.should.eq("dlp1Metadata");

      dlp1Info.stakeAmount.should.eq(registrationAmount);
      dlp1Info.status.should.eq(DlpStatus.Registered);
      dlp1Info.registrationBlockNumber.should.eq(blockNumber + 1);

      (await rootCore.dlpsByAddress(dlp1)).should.deep.eq(dlp1Info);

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      (await ethers.provider.getBalance(user1)).should.eq(
        dlp1OwnerInitialBalance - registrationAmount - receipt.fee,
      );
      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        registrationAmount,
      );

      const stake = await rootStaking.stakes(1);
      stake.id.should.eq(1);
      stake.stakerAddress.should.eq(dlp1Owner.address);
      stake.dlpId.should.eq(1);
      stake.amount.should.eq(registrationAmount);
      stake.startBlock.should.eq(blockNumber + 1);
      stake.endBlock.should.eq(0);
      stake.withdrawn.should.eq(false);
      stake.lastClaimedEpochId.should.eq(0);

      (await rootStaking.stakerDlpsListCount(dlp1Owner.address)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(dlp1Owner.address, 0)).should.eq(1);
      (
        await rootStaking.stakerDlpsListValues(dlp1Owner.address)
      ).should.deep.eq([1]);

      (await rootStaking.stakerStakesListCount(dlp1Owner.address)).should.eq(1);
      (await rootStaking.stakerStakesListAt(dlp1Owner.address, 0)).should.eq(1);
      (
        await rootStaking.stakerStakesListValues(dlp1Owner.address)
      ).should.deep.eq([1]);

      (await rootStaking.stakerDlpStakeAmount(dlp1Owner.address, 1)).should.eq(
        registrationAmount,
      );
      (await rootStaking.stakerTotalStakeAmount(dlp1Owner.address)).should.eq(
        registrationAmount,
      );
    });

    it("should registerDlp multiple times", async function () {
      const dlp1OwnerInitialBalance =
        await ethers.provider.getBalance(dlp1Owner);

      const registrationAmount = minDlpRegistrationStake;
      const stakerPercentage = minDlpStakersPercentage;

      const blockNumber = await getCurrentBlockNumber();
      const tx1 = await rootCore.connect(user1).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: stakerPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: registrationAmount },
      );

      const receipt1 = await getReceipt(tx1);

      receipt1.should
        .emit(rootStaking, "DlpRegistered")
        .withArgs(
          1,
          dlp1,
          dlp1Owner,
          dlp1Treasury,
          stakerPercentage,
          "dlp1Name",
          "dlp1IconUrl",
          "dlp1Website",
          "dlp1Metadata",
        )
        .emit(rootStaking, "StakeCreated")
        .withArgs(1, dlp1Owner, 1, registrationAmount);

      const tx2 = await rootCore.connect(user1).registerDlp(
        {
          dlpAddress: dlp2,
          ownerAddress: dlp2Owner,
          treasuryAddress: dlp2Treasury,
          stakersPercentage: stakerPercentage,
          name: "dlp2Name",
          iconUrl: "dlp2IconUrl",
          website: "dlp2Website",
          metadata: "dlp2Metadata",
        },
        { value: registrationAmount },
      );

      const receipt2 = await getReceipt(tx2);

      receipt2.should
        .emit(rootStaking, "DlpRegistered")
        .withArgs(
          2,
          dlp2,
          dlp2Owner,
          dlp2Treasury,
          stakerPercentage,
          "dlp2Name",
          "dlp2IconUrl",
          "dlp2Website",
          "dlp2Metadata",
        )
        .emit(rootStaking, "StakeCreated")
        .withArgs(2, dlp2Owner, 2, registrationAmount);

      (await rootCore.dlpsCount()).should.eq(2);

      const dlp1Info = await rootCore.dlps(1);

      dlp1Info.id.should.eq(1);
      dlp1Info.dlpAddress.should.eq(dlp1);
      dlp1Info.ownerAddress.should.eq(dlp1Owner.address);
      dlp1Info.treasuryAddress.should.eq(dlp1Treasury);
      dlp1Info.stakersPercentage.should.eq(stakerPercentage);
      dlp1Info.stakersPercentageEpoch.should.eq(minDlpStakersPercentage);
      dlp1Info.name.should.eq("dlp1Name");
      dlp1Info.iconUrl.should.eq("dlp1IconUrl");
      dlp1Info.website.should.eq("dlp1Website");
      dlp1Info.metadata.should.eq("dlp1Metadata");

      dlp1Info.stakeAmount.should.eq(registrationAmount);
      dlp1Info.status.should.eq(DlpStatus.Registered);
      dlp1Info.registrationBlockNumber.should.eq(blockNumber + 1);

      (await rootCore.dlpsByAddress(dlp1)).should.deep.eq(dlp1Info);
      (await rootCore.dlpNameToId("dlp1Name")).should.deep.eq(1);
      (await rootCore.dlpsByName("dlp1Name")).should.deep.eq(dlp1Info);

      const dlp2Info = await rootCore.dlps(2);

      dlp2Info.id.should.eq(2);
      dlp2Info.dlpAddress.should.eq(dlp2);
      dlp2Info.ownerAddress.should.eq(dlp2Owner.address);
      dlp2Info.treasuryAddress.should.eq(dlp2Treasury);
      dlp2Info.stakersPercentage.should.eq(stakerPercentage);
      dlp2Info.stakersPercentageEpoch.should.eq(minDlpStakersPercentage);
      dlp2Info.name.should.eq("dlp2Name");
      dlp2Info.iconUrl.should.eq("dlp2IconUrl");
      dlp2Info.website.should.eq("dlp2Website");
      dlp2Info.metadata.should.eq("dlp2Metadata");

      dlp2Info.stakeAmount.should.eq(registrationAmount);
      dlp2Info.status.should.eq(DlpStatus.Registered);
      dlp2Info.registrationBlockNumber.should.eq(blockNumber + 2);

      (await rootCore.dlpsByAddress(dlp2)).should.deep.eq(dlp2Info);
      (await rootCore.dlpNameToId("dlp2Name")).should.deep.eq(2);
      (await rootCore.dlpsByName("dlp2Name")).should.deep.eq(dlp2Info);

      (await ethers.provider.getBalance(user1)).should.eq(
        dlp1OwnerInitialBalance -
          registrationAmount -
          registrationAmount -
          receipt1.fee -
          receipt2.fee,
      );
      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        registrationAmount + registrationAmount,
      );
    });

    it("should reject registerDlp when paused", async function () {
      await rootStaking.connect(owner).pause();
      await rootCore
        .connect(user1)
        .registerDlp(
          {
            dlpAddress: dlp1,
            ownerAddress: dlp1Owner,
            treasuryAddress: dlp1Treasury,
            stakersPercentage: minDlpStakersPercentage,
            name: "dlp1Name",
            iconUrl: "dlp1IconUrl",
            website: "dlp1Website",
            metadata: "dlp1Metadata",
          },
          { value: minDlpRegistrationStake },
        )
        .should.be.rejectedWith(`EnforcedPause()`);
    });

    it("should reject registerDlp when stake amount too small", async function () {
      await rootCore
        .connect(user1)
        .registerDlp(
          {
            dlpAddress: dlp1,
            ownerAddress: dlp1Owner,
            treasuryAddress: dlp1Treasury,
            stakersPercentage: minDlpStakersPercentage,
            name: "dlp1Name",
            iconUrl: "dlp1IconUrl",
            website: "dlp1Website",
            metadata: "dlp1Metadata",
          },
          { value: minDlpRegistrationStake - 1n },
        )
        .should.be.rejectedWith(`InvalidStakeAmount()`);
    });

    it("should reject registerDlp when stakersPercentage too small", async function () {
      await rootCore
        .connect(user1)
        .registerDlp(
          {
            dlpAddress: dlp1,
            ownerAddress: dlp1Owner,
            treasuryAddress: dlp1Treasury,
            stakersPercentage: minDlpStakersPercentage - 1n,
            name: "dlp1Name",
            iconUrl: "dlp1IconUrl",
            website: "dlp1Website",
            metadata: "dlp1Metadata",
          },
          { value: minDlpRegistrationStake },
        )
        .should.be.rejectedWith(`InvalidStakersPercentage()`);
    });

    it("should reject registerDlp when stakersPercentage too big", async function () {
      await rootCore
        .connect(user1)
        .registerDlp(
          {
            dlpAddress: dlp1,
            ownerAddress: dlp1Owner,
            treasuryAddress: dlp1Treasury,
            stakersPercentage: parseEther(100) + 1n,
            name: "dlp1Name",
            iconUrl: "dlp1IconUrl",
            website: "dlp1Website",
            metadata: "dlp1Metadata",
          },
          { value: minDlpRegistrationStake },
        )
        .should.be.rejectedWith(`InvalidStakersPercentage()`);
    });

    it("should reject registerDlp when already registered", async function () {
      await rootCore.connect(user1).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: minDlpStakersPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: minDlpRegistrationStake },
      );
      await rootCore
        .connect(user1)
        .registerDlp(
          {
            dlpAddress: dlp1,
            ownerAddress: dlp1Owner,
            treasuryAddress: dlp1Treasury,
            stakersPercentage: minDlpStakersPercentage,
            name: "dlp1Name",
            iconUrl: "dlp1IconUrl",
            website: "dlp1Website",
            metadata: "dlp1Metadata",
          },
          { value: minDlpRegistrationStake },
        )
        .should.be.rejectedWith(`InvalidDlpStatus()`);
    });

    it("should reject registerDlp when deregistered", async function () {
      await rootCore.connect(user1).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: minDlpStakersPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: minDlpRegistrationStake },
      );
      await rootCore.connect(dlp1Owner).deregisterDlp(1);
      await rootCore
        .connect(user1)
        .registerDlp(
          {
            dlpAddress: dlp1,
            ownerAddress: dlp1Owner,
            treasuryAddress: dlp1Treasury,
            stakersPercentage: minDlpStakersPercentage,
            name: "dlp1Name",
            iconUrl: "dlp1IconUrl",
            website: "dlp1Website",
            metadata: "dlp1Metadata",
          },
          { value: minDlpRegistrationStake },
        )
        .should.be.rejectedWith(`InvalidDlpStatus()`);
    });

    it("should reject registerDlp when name already taken", async function () {
      await rootCore.connect(user1).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: minDlpStakersPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: minDlpRegistrationStake },
      );
      await rootCore
        .connect(user1)
        .registerDlp(
          {
            dlpAddress: dlp2,
            ownerAddress: dlp1Owner,
            treasuryAddress: dlp1Treasury,
            stakersPercentage: minDlpStakersPercentage,
            name: "dlp1Name",
            iconUrl: "dlp1IconUrl",
            website: "dlp1Website",
            metadata: "dlp1Metadata",
          },
          { value: minDlpRegistrationStake },
        )
        .should.be.rejectedWith(`InvalidName()`);
    });

    it("should reject registerDlp with empty name", async function () {
      await rootCore
        .connect(user1)
        .registerDlp(
          {
            dlpAddress: dlp2,
            ownerAddress: dlp1Owner,
            treasuryAddress: dlp1Treasury,
            stakersPercentage: minDlpStakersPercentage,
            name: "",
            iconUrl: "dlp1IconUrl",
            website: "dlp1Website",
            metadata: "dlp1Metadata",
          },
          { value: minDlpRegistrationStake },
        )
        .should.be.rejectedWith(`InvalidName()`);
    });

    it("should deregisterDlp when dlp owner", async function () {
      const dlp1OwnerInitialBalance =
        await ethers.provider.getBalance(dlp1Owner);
      const tx1 = await rootCore.connect(dlp1Owner).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: minDlpStakersPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: minDlpRegistrationStake },
      );
      const receipt1 = await getReceipt(tx1);

      const stake1 = await rootStaking.stakes(1);
      stake1.id.should.eq(1);
      stake1.stakerAddress.should.eq(dlp1Owner.address);
      stake1.dlpId.should.eq(1);
      stake1.amount.should.eq(minDlpRegistrationStake);
      stake1.endBlock.should.eq(0);
      stake1.withdrawn.should.eq(false);
      stake1.lastClaimedEpochId.should.eq(0);

      (await rootStaking.stakerDlpsListCount(dlp1Owner.address)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(dlp1Owner.address, 0)).should.eq(1);
      (
        await rootStaking.stakerDlpsListValues(dlp1Owner.address)
      ).should.deep.eq([1]);

      (await rootStaking.stakerStakesListCount(dlp1Owner.address)).should.eq(1);
      (await rootStaking.stakerStakesListAt(dlp1Owner.address, 0)).should.eq(1);
      (
        await rootStaking.stakerStakesListValues(dlp1Owner.address)
      ).should.deep.eq([1]);

      (await rootStaking.stakerDlpStakeAmount(dlp1Owner.address, 1)).should.eq(
        minDlpRegistrationStake,
      );
      (await rootStaking.stakerTotalStakeAmount(dlp1Owner.address)).should.eq(
        minDlpRegistrationStake,
      );

      const tx2 = await rootCore.connect(dlp1Owner).deregisterDlp(1);
      const receipt2 = await getReceipt(tx2);

      await tx2.should.emit(rootCore, `DlpStatusUpdated`).withArgs(1, 4);

      (await rootCore.eligibleDlpsListCount()).should.eq(0);
      (await rootCore.eligibleDlpsListValues()).should.deep.eq([]);

      (await rootCore.dlpsCount()).should.eq(1);
      const dlp1Info = await rootCore.dlps(1);

      (await rootCore.dlpsByAddress(dlp1)).should.deep.eq(dlp1Info);

      const stake1After = await rootStaking.stakes(1);
      stake1After.id.should.eq(1);
      stake1After.stakerAddress.should.eq(dlp1Owner.address);
      stake1After.dlpId.should.eq(1);
      stake1After.amount.should.eq(minDlpRegistrationStake);
      stake1After.endBlock.should.eq(0);
      stake1After.withdrawn.should.eq(false);
      stake1After.lastClaimedEpochId.should.eq(0);

      (await rootStaking.stakerDlpsListCount(dlp1Owner.address)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(dlp1Owner.address, 0)).should.eq(1);
      (
        await rootStaking.stakerDlpsListValues(dlp1Owner.address)
      ).should.deep.eq([1]);

      (await rootStaking.stakerStakesListCount(dlp1Owner.address)).should.eq(1);
      (await rootStaking.stakerStakesListAt(dlp1Owner.address, 0)).should.eq(1);
      (
        await rootStaking.stakerStakesListValues(dlp1Owner.address)
      ).should.deep.eq([1]);

      (await rootStaking.stakerDlpStakeAmount(dlp1Owner.address, 1)).should.eq(
        minDlpRegistrationStake,
      );
      (await rootStaking.stakerTotalStakeAmount(dlp1Owner.address)).should.eq(
        minDlpRegistrationStake,
      );

      (await ethers.provider.getBalance(dlp1Owner)).should.eq(
        dlp1OwnerInitialBalance -
          minDlpRegistrationStake -
          receipt1.fee -
          receipt2.fee,
      );
      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        minDlpRegistrationStake,
      );
    });

    it("should reject deregisterDlp when non dlp owner", async function () {
      await rootCore.connect(dlp1Owner).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: minDlpStakersPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: minDlpRegistrationStake },
      );

      await rootCore
        .connect(owner)
        .deregisterDlp(1)
        .should.be.rejectedWith("NotDlpOwner()");

      await rootCore
        .connect(user1)
        .deregisterDlp(1)
        .should.be.rejectedWith("NotDlpOwner()");
    });

    it("should reject deregisterDlp when deregistered", async function () {
      await rootCore.connect(dlp1Owner).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: minDlpStakersPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: minDlpRegistrationStake },
      );

      await rootCore.connect(dlp1Owner).deregisterDlp(1);

      await rootCore
        .connect(dlp1Owner)
        .deregisterDlp(1)
        .should.be.rejectedWith(`InvalidDlpStatus()`);
    });

    it("should updateDlp when dlp owner", async function () {
      const blockNumber = await getCurrentBlockNumber();
      await rootCore.connect(dlp1Owner).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: minDlpStakersPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: dlpEligibilityThreshold },
      );

      await rootCore
        .connect(dlp1Owner)
        .updateDlp(1, {
          dlpAddress: dlp1,
          ownerAddress: dlp2Owner,
          treasuryAddress: dlp2Treasury,
          stakersPercentage: minDlpStakersPercentage + 1n,
          name: "dlp1Name2",
          iconUrl: "dlp1IconUrl2",
          website: "dlp1Website2",
          metadata: "dlp1Metadata2",
        })
        .should.emit(rootCore, "DlpUpdated")
        .withArgs(
          1,
          dlp1,
          dlp2Owner,
          dlp2Treasury,
          minDlpStakersPercentage + 1n,
          "dlp1Name2",
          "dlp1IconUrl2",
          "dlp1Website2",
          "dlp1Metadata2",
        );
      (await rootCore.dlpsCount()).should.eq(1);

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      const dlp1Info = await rootCore.dlps(1);

      dlp1Info.id.should.eq(1);
      dlp1Info.dlpAddress.should.eq(dlp1);
      dlp1Info.ownerAddress.should.eq(dlp2Owner.address);
      dlp1Info.treasuryAddress.should.eq(dlp2Treasury);
      dlp1Info.stakersPercentage.should.eq(minDlpStakersPercentage + 1n);
      // dlp1Info.stakersPercentageEpoch.should.eq(minDlpStakersPercentage); //todo: uncomment when the fix is implemented
      dlp1Info.name.should.eq("dlp1Name2");
      dlp1Info.iconUrl.should.eq("dlp1IconUrl2");
      dlp1Info.website.should.eq("dlp1Website2");
      dlp1Info.metadata.should.eq("dlp1Metadata2");

      dlp1Info.stakeAmount.should.eq(dlpEligibilityThreshold);
      dlp1Info.status.should.eq(DlpStatus.Eligible);
      dlp1Info.registrationBlockNumber.should.eq(blockNumber + 1);

      (await rootCore.dlpsByAddress(dlp1)).should.deep.eq(dlp1Info);

      (await rootCore.eligibleDlpsListCount()).should.eq(1);
      (await rootCore.eligibleDlpsListAt(0)).should.eq(1);
      (await rootCore.eligibleDlpsListValues()).should.deep.eq([1n]);
    });
    it("should updateDlp when dlp owner", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      const updatedInfo = {
        ...dlpInfo[1],
        ownerAddress: dlp2Owner,
        treasuryAddress: dlp2Treasury,
        stakersPercentage: minDlpStakersPercentage + parseEther(1),
        name: "dlp1Name2",
        iconUrl: "dlp1IconUrl2",
        website: "dlp1Website2",
        metadata: "dlp1Metadata2",
      };

      const tx = await rootCore.connect(dlp1Owner).updateDlp(1, updatedInfo);

      await tx.should
        .emit(rootCore, "DlpUpdated")
        .withArgs(
          1,
          dlp1.address,
          dlp2Owner.address,
          dlp2Treasury.address,
          minDlpStakersPercentage + parseEther(1),
          "dlp1Name2",
          "dlp1IconUrl2",
          "dlp1Website2",
          "dlp1Metadata2",
        );

      const updatedDlp = await rootCore.dlps(1);
      updatedDlp.ownerAddress.should.eq(dlp2Owner.address);
      updatedDlp.treasuryAddress.should.eq(dlp2Treasury.address);
      updatedDlp.stakersPercentage.should.eq(
        minDlpStakersPercentage + parseEther(1),
      );
      updatedDlp.name.should.eq("dlp1Name2");
      updatedDlp.iconUrl.should.eq("dlp1IconUrl2");
      updatedDlp.website.should.eq("dlp1Website2");
      updatedDlp.metadata.should.eq("dlp1Metadata2");
    });

    it("should reject updateDlp when not dlp owner", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore
        .connect(user1)
        .updateDlp(1, dlpInfo[1])
        .should.be.rejectedWith("NotDlpOwner()");
    });

    it("should reject updateDlp when owner address is zero", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      const invalidInfo = {
        ...dlpInfo[1],
        ownerAddress: ethers.ZeroAddress,
      };

      await rootCore
        .connect(dlp1Owner)
        .updateDlp(1, invalidInfo)
        .should.be.rejectedWith("InvalidAddress()");
    });

    it("should reject updateDlp when treasury address is zero", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      const invalidInfo = {
        ...dlpInfo[1],
        treasuryAddress: ethers.ZeroAddress,
      };

      await rootCore
        .connect(dlp1Owner)
        .updateDlp(1, invalidInfo)
        .should.be.rejectedWith("InvalidAddress()");
    });

    it("should reject updateDlp when stakers percentage below minimum", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      const invalidInfo = {
        ...dlpInfo[1],
        stakersPercentage: minDlpStakersPercentage - 1n,
      };

      await rootCore
        .connect(dlp1Owner)
        .updateDlp(1, invalidInfo)
        .should.be.rejectedWith("InvalidStakersPercentage()");
    });

    it("should reject updateDlp when stakers percentage above 100%", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      const invalidInfo = {
        ...dlpInfo[1],
        stakersPercentage: parseEther(100) + 1n,
      };

      await rootCore
        .connect(dlp1Owner)
        .updateDlp(1, invalidInfo)
        .should.be.rejectedWith("InvalidStakersPercentage()");
    });

    it("should reject updateDlp when trying to change DLP address", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      const invalidInfo = {
        ...dlpInfo[1],
        dlpAddress: dlp2,
      };

      await rootCore
        .connect(dlp1Owner)
        .updateDlp(1, invalidInfo)
        .should.be.rejectedWith("DlpAddressCannotBeChanged()");
    });

    it("should updateDlp and update stakersPercentage in next epoch", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();

      const updatedInfo = {
        ...dlpInfo[1],
        stakersPercentage: minDlpStakersPercentage + parseEther(1),
      };

      await rootCore.connect(dlp1Owner).updateDlp(1, updatedInfo);

      const dlpInfo1 = await rootCore.dlps(1);
      dlpInfo1.stakersPercentage.should.eq(
        minDlpStakersPercentage + parseEther(1),
      );
      // dlpInfo1.stakersPercentageEpoch.should.eq(minDlpStakersPercentage); //todo: uncomment this line after fixing the bug

      await advanceToEpochN(2);
      await rootEpoch.connect(owner).createEpochs();

      const dlpInfo2 = await rootCore.dlps(1);
      dlpInfo2.stakersPercentage.should.eq(
        minDlpStakersPercentage + parseEther(1),
      );
      dlpInfo2.stakersPercentageEpoch.should.eq(
        minDlpStakersPercentage + parseEther(1),
      );
    });

    it("should reject updateDlp when paused", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });
      await rootCore.connect(maintainer).pause();

      await rootCore
        .connect(dlp1Owner)
        .updateDlp(1, dlpInfo[1])
        .should.be.rejectedWith("EnforcedPause()");
    });

    it("should updateDlp stakerPercentage in the next epoch", async function () {
      await rootCore.connect(dlp1Owner).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: minDlpStakersPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: dlpEligibilityThreshold },
      );

      await rootCore.connect(dlp1Owner).updateDlp(1, {
        dlpAddress: dlp1,
        ownerAddress: dlp2Owner,
        treasuryAddress: dlp2Treasury,
        stakersPercentage: minDlpStakersPercentage + 1n,
        name: "dlp1Name2",
        iconUrl: "dlp1IconUrl2",
        website: "dlp1Website2",
        metadata: "dlp1Metadata2",
      });
      (await rootCore.dlpsCount()).should.eq(1);

      const dlp1Info1 = await rootCore.dlps(1);
      dlp1Info1.stakersPercentage.should.eq(minDlpStakersPercentage + 1n);
      // dlp1Info1.stakersPercentageEpoch.should.eq(minDlpStakersPercentage); //todo: uncomment this line after fixing the bug

      await advanceToEpochN(1);
      await rootEpoch.createEpochs();

      const dlp1Info2 = await rootCore.dlps(1);
      dlp1Info2.stakersPercentage.should.eq(minDlpStakersPercentage + 1n);
      dlp1Info2.stakersPercentageEpoch.should.eq(minDlpStakersPercentage + 1n);

      await rootCore.connect(dlp2Owner).updateDlp(1, {
        dlpAddress: dlp1,
        ownerAddress: dlp2Owner,
        treasuryAddress: dlp2Treasury,
        stakersPercentage: minDlpStakersPercentage + 2n,
        name: "dlp1Name2",
        iconUrl: "dlp1IconUrl2",
        website: "dlp1Website2",
        metadata: "dlp1Metadata2",
      });

      const dlp1Info3 = await rootCore.dlps(1);
      dlp1Info3.stakersPercentage.should.eq(minDlpStakersPercentage + 2n);
      // dlp1Info3.stakersPercentageEpoch.should.eq(minDlpStakersPercentage + 1n); //todo: uncomment this line after fixing the bug

      await advanceToEpochN(2);
      await rootEpoch.createEpochs();

      const dlp1Info4 = await rootCore.dlps(1);
      dlp1Info4.stakersPercentage.should.eq(minDlpStakersPercentage + 2n);
      dlp1Info4.stakersPercentageEpoch.should.eq(minDlpStakersPercentage + 2n);
    });

    it("should reject updateDlp when non dlp owner", async function () {
      const blockNumber = await getCurrentBlockNumber();
      await rootCore.connect(dlp1Owner).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: minDlpStakersPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: dlpEligibilityThreshold },
      );

      await rootCore
        .connect(owner)
        .updateDlp(1, {
          dlpAddress: dlp2,
          ownerAddress: dlp2Owner,
          treasuryAddress: dlp2Treasury,
          stakersPercentage: minDlpStakersPercentage + 1n,
          name: "dlp1Name2",
          iconUrl: "dlp1IconUrl2",
          website: "dlp1Website2",
          metadata: "dlp1Metadata2",
        })
        .should.be.rejectedWith("NotDlpOwner()");
    });

    it("should reject updateDlp when invalid stakersPercentage", async function () {
      const blockNumber = await getCurrentBlockNumber();
      await rootCore.connect(dlp1Owner).registerDlp(
        {
          dlpAddress: dlp1,
          ownerAddress: dlp1Owner,
          treasuryAddress: dlp1Treasury,
          stakersPercentage: minDlpStakersPercentage,
          name: "dlp1Name",
          iconUrl: "dlp1IconUrl",
          website: "dlp1Website",
          metadata: "dlp1Metadata",
        },
        { value: dlpEligibilityThreshold },
      );

      await rootCore
        .connect(dlp1Owner)
        .updateDlp(1, {
          dlpAddress: dlp2,
          ownerAddress: dlp2Owner,
          treasuryAddress: dlp2Treasury,
          stakersPercentage: minDlpStakersPercentage - 1n,
          name: "dlp1Name2",
          iconUrl: "dlp1IconUrl2",
          website: "dlp1Website2",
          metadata: "dlp1Metadata2",
        })
        .should.be.rejectedWith("InvalidStakersPercentage()");

      await rootCore
        .connect(dlp1Owner)
        .updateDlp(1, {
          dlpAddress: dlp2,
          ownerAddress: dlp2Owner,
          treasuryAddress: dlp2Treasury,
          stakersPercentage: parseEther(101),
          name: "dlp1Name2",
          iconUrl: "dlp1IconUrl2",
          website: "dlp1Website2",
          metadata: "dlp1Metadata2",
        })
        .should.be.rejectedWith("InvalidStakersPercentage()");
    });

    it("should updateDlpVerification when maintainer #true, #registered", async function () {
      await registerNDlps([minDlpRegistrationStake], false);

      const dlpBefore = await rootCore.dlps(1);
      dlpBefore.isVerified.should.eq(false);
      dlpBefore.status.should.eq(DlpStatus.Registered);
      await rootCore.connect(maintainer).updateDlpVerification(1, true);
      const dlpAfter = await rootCore.dlps(1);
      dlpAfter.isVerified.should.eq(true);
      dlpAfter.status.should.eq(DlpStatus.Registered);

      (await rootCore.eligibleDlpsListValues()).should.deep.eq([]);
    });

    it("should updateDlpVerification when maintainer #true, #subEligible", async function () {
      await registerNDlps([dlpEligibilityThreshold - 1n], false);

      const dlpBefore = await rootCore.dlps(1);
      dlpBefore.isVerified.should.eq(false);
      dlpBefore.status.should.eq(DlpStatus.Registered);
      await rootCore.connect(maintainer).updateDlpVerification(1, true);
      const dlpAfter = await rootCore.dlps(1);
      dlpAfter.isVerified.should.eq(true);
      dlpAfter.status.should.eq(DlpStatus.Registered);

      (await rootCore.eligibleDlpsListValues()).should.deep.eq([]);
    });

    it("should updateDlpVerification when maintainer #true, #eligible", async function () {
      await registerNDlps([dlpEligibilityThreshold], false);

      const dlpBefore = await rootCore.dlps(1);
      dlpBefore.isVerified.should.eq(false);
      dlpBefore.status.should.eq(DlpStatus.Registered);
      await rootCore.connect(maintainer).updateDlpVerification(1, true);
      const dlpAfter = await rootCore.dlps(1);
      dlpAfter.isVerified.should.eq(true);
      dlpAfter.status.should.eq(DlpStatus.Eligible);

      (await rootCore.eligibleDlpsListValues()).should.deep.eq([1n]);
    });

    it("should updateDlpVerification when maintainer #false, #registered", async function () {
      await registerNDlps([minDlpRegistrationStake], false);

      const dlpBefore = await rootCore.dlps(1);
      dlpBefore.isVerified.should.eq(false);
      dlpBefore.status.should.eq(DlpStatus.Registered);
      await rootCore.connect(maintainer).updateDlpVerification(1, true);
      await rootCore.connect(maintainer).updateDlpVerification(1, false);
      const dlpAfter = await rootCore.dlps(1);
      dlpAfter.isVerified.should.eq(false);
      dlpAfter.status.should.eq(DlpStatus.Registered);

      (await rootCore.eligibleDlpsListValues()).should.deep.eq([]);
    });

    it("should updateDlpVerification when maintainer #false, #subEligible", async function () {
      await registerNDlps([dlpEligibilityThreshold - 1n], false);

      const dlpBefore = await rootCore.dlps(1);
      dlpBefore.isVerified.should.eq(false);
      dlpBefore.status.should.eq(DlpStatus.Registered);
      await rootCore.connect(maintainer).updateDlpVerification(1, true);
      await rootCore.connect(maintainer).updateDlpVerification(1, false);
      const dlpAfter = await rootCore.dlps(1);
      dlpAfter.isVerified.should.eq(false);
      dlpAfter.status.should.eq(DlpStatus.Registered);

      (await rootCore.eligibleDlpsListValues()).should.deep.eq([]);
    });

    it("should updateDlpVerification when maintainer #false, #eligible", async function () {
      await registerNDlps([dlpEligibilityThreshold], false);

      const dlpBefore = await rootCore.dlps(1);
      dlpBefore.isVerified.should.eq(false);
      dlpBefore.status.should.eq(DlpStatus.Registered);
      await rootCore.connect(maintainer).updateDlpVerification(1, true);
      const dlpAfter1 = await rootCore.dlps(1);
      dlpAfter1.isVerified.should.eq(true);
      dlpAfter1.status.should.eq(DlpStatus.Eligible);
      (await rootCore.eligibleDlpsListValues()).should.deep.eq([1n]);

      await rootCore.connect(maintainer).updateDlpVerification(1, false);
      const dlpAfter2 = await rootCore.dlps(1);
      dlpAfter2.isVerified.should.eq(false);
      dlpAfter2.status.should.eq(DlpStatus.Registered);
      (await rootCore.eligibleDlpsListValues()).should.deep.eq([]);
    });

    it("should reject updateDlpVerification when non-maintainer", async function () {
      await rootCore
        .connect(manager)
        .updateDlpVerification(1, true)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${manager.address}", "${MAINTAINER_ROLE}")`,
        );

      (await rootStaking.dlpRootMetrics()).should.eq(rootMetrics);
    });
  });

  describe("Epochs", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should createEpochs after the end of the previous one", async function () {
      await advanceToEpochN(1);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount);
      await advanceToEpochN(2);

      const epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      let epoch2 = await rootEpoch.epochs(2);
      epoch2.startBlock.should.eq(0);
      epoch2.endBlock.should.eq(0);
      epoch2.rewardAmount.should.eq(0);
      epoch2.dlpIds.should.deep.eq([]);

      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(2);

      epoch2 = await rootEpoch.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.rewardAmount.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([]);
    });

    it("should createEpochs after updating rewardAmount", async function () {
      await advanceToEpochN(1);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount);

      await rootEpoch
        .connect(owner)
        .updateEpochRewardAmount(epochRewardAmount * 2n);
      await advanceToEpochN(2);

      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount * 2n,
        );

      (await rootEpoch.epochsCount()).should.eq(2);

      const epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      const epoch2 = await rootEpoch.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.rewardAmount.should.eq(epochRewardAmount * 2n);
      epoch2.dlpIds.should.deep.eq([]);
    });

    it("should createEpochs after updating epochSize", async function () {
      await advanceToEpochN(1);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount);

      await rootEpoch.connect(owner).updateEpochSize(epochSize * 3);
      await advanceToEpochN(2);

      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 4 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(2);

      const epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      const epoch2 = await rootEpoch.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 4 * epochSize - 1);
      epoch2.rewardAmount.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([]);
    });

    it("should createEpochs after long time", async function () {
      (await rootEpoch.epochsCount()).should.eq(0);

      await advanceToEpochN(4);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount,
        )
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(
          3,
          startBlock + 2 * epochSize,
          startBlock + 3 * epochSize - 1,
          epochRewardAmount,
        )
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(
          4,
          startBlock + 3 * epochSize,
          startBlock + 4 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(4);

      const epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      const epoch2 = await rootEpoch.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.rewardAmount.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([]);

      const epoch3 = await rootEpoch.epochs(3);
      epoch3.startBlock.should.eq(startBlock + 2 * epochSize);
      epoch3.endBlock.should.eq(startBlock + 3 * epochSize - 1);
      epoch3.rewardAmount.should.eq(epochRewardAmount);
      epoch3.dlpIds.should.deep.eq([]);
    });

    it("should createEpochsUntilBlockNumber after long time", async function () {
      (await rootEpoch.epochsCount()).should.eq(0);

      await advanceToEpochN(4);
      await rootEpoch
        .connect(owner)
        .createEpochsUntilBlockNumber(await getCurrentBlockNumber())
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount,
        )
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(
          3,
          startBlock + 2 * epochSize,
          startBlock + 3 * epochSize - 1,
          epochRewardAmount,
        )
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(
          4,
          startBlock + 3 * epochSize,
          startBlock + 4 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(4);

      const epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      const epoch2 = await rootEpoch.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.rewardAmount.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([]);

      const epoch3 = await rootEpoch.epochs(3);
      epoch3.startBlock.should.eq(startBlock + 2 * epochSize);
      epoch3.endBlock.should.eq(startBlock + 3 * epochSize - 1);
      epoch3.rewardAmount.should.eq(epochRewardAmount);
      epoch3.dlpIds.should.deep.eq([]);
    });

    it("should createEpochsUntilBlockNumber with limit", async function () {
      (await rootEpoch.epochsCount()).should.eq(0);

      await advanceToEpochN(4);
      await rootEpoch
        .connect(owner)
        .createEpochsUntilBlockNumber(startBlock + epochSize)
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(2);

      const epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);
    });

    it("should createEpochsUntilBlockNumber just until current block number", async function () {
      (await rootEpoch.epochsCount()).should.eq(0);

      await advanceToEpochN(4);
      await rootEpoch
        .connect(owner)
        .createEpochsUntilBlockNumber(
          (await getCurrentBlockNumber()) + epochSize * 100,
        )
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount,
        )
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(
          3,
          startBlock + 2 * epochSize,
          startBlock + 3 * epochSize - 1,
          epochRewardAmount,
        )
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(
          4,
          startBlock + 3 * epochSize,
          startBlock + 4 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(4);
    });

    it("should create epochs with no active dlps", async function () {
      await advanceToEpochN(3);
      await rootEpoch.connect(owner).createEpochs();

      for (let i = 1; i <= 2; i++) {
        (await rootEpoch.epochs(i)).dlpIds.should.deep.eq([]);
      }
    });

    it("should createEpochs with one registered dlp #1", async function () {
      await advanceToEpochN(1);

      (await rootMetrics.topDlps(epochDlpsLimit)).should.deep.eq([]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount);

      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(2);

      let epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      let epoch2 = await rootEpoch.epochs(2);
      epoch2.startBlock.should.eq(0);
      epoch2.endBlock.should.eq(0);
      epoch2.rewardAmount.should.eq(0);
      epoch2.dlpIds.should.deep.eq([]);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([1n]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(2);

      await saveDefaultEpochPerformanceRatings(1);

      epoch1 = await rootEpoch.epochs(1);
      epoch1.dlpIds.should.deep.eq([1n]);

      epoch2 = await rootEpoch.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.rewardAmount.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([]);

      const dlp1Epoch1 = await rootEpoch.epochDlps(1, 1);
      dlp1Epoch1.stakeAmount.should.eq(dlpEligibilityThreshold);
      dlp1Epoch1.isTopDlp.should.eq(true);
      dlp1Epoch1.ownerRewardAmount.should.eq(
        (epochRewardAmount * minDlpStakersPercentage) / parseEther(100),
      );
      dlp1Epoch1.stakersPercentage.should.eq(minDlpStakersPercentage);
    });

    it("should createEpochs after dlpStakersPercentage changes", async function () {
      await advanceToEpochN(1);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount);

      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await rootCore.connect(dlp1Owner).updateDlp(1, {
        ...dlpInfo[1],
        stakersPercentage: minDlpStakersPercentage + 1n,
      });

      await advanceToEpochN(2);

      let epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      let epoch2 = await rootEpoch.epochs(2);
      epoch2.startBlock.should.eq(0);
      epoch2.endBlock.should.eq(0);
      epoch2.rewardAmount.should.eq(0);
      epoch2.dlpIds.should.deep.eq([]);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([1n]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(2);

      await saveDefaultEpochPerformanceRatings(1);

      epoch1 = await rootEpoch.epochs(1);
      epoch1.dlpIds.should.deep.eq([1n]);

      epoch2 = await rootEpoch.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.rewardAmount.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([]);

      const dlp1Epoch1 = await rootEpoch.epochDlps(1, 1);
      dlp1Epoch1.stakeAmount.should.eq(dlpEligibilityThreshold);
      dlp1Epoch1.isTopDlp.should.eq(true);
      dlp1Epoch1.ownerRewardAmount.should.eq(
        (epochRewardAmount * minDlpStakersPercentage) / parseEther(100),
      );
      // dlp1Epoch1.stakersPercentage.should.eq(minDlpStakersPercentage); todo: uncomment this line after fixing the bug

      await advanceToEpochN(3);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(
          3,
          startBlock + 2 * epochSize,
          startBlock + 3 * epochSize - 1,
          epochRewardAmount,
        );

      await saveDefaultEpochPerformanceRatings(2);

      epoch2 = await rootEpoch.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.rewardAmount.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([1n]);

      const dlp1Epoch2 = await rootEpoch.epochDlps(2, 1);
      dlp1Epoch2.stakeAmount.should.eq(dlpEligibilityThreshold);
      dlp1Epoch2.isTopDlp.should.eq(true);
      dlp1Epoch2.ownerRewardAmount.should.eq(
        (epochRewardAmount * minDlpStakersPercentage) / parseEther(100),
      );
      dlp1Epoch2.stakersPercentage.should.eq(minDlpStakersPercentage + 1n);
    });

    it("should createEpochs with multiple registered dlps #1", async function () {
      await advanceToEpochN(1);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount);

      await registerNDlps([
        parseEther(101),
        parseEther(102),
        parseEther(103),
        parseEther(104),
        parseEther(105),
      ]);

      await advanceToEpochN(2);

      let epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([
        5n,
        4n,
        3n,
      ]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(2);

      await saveDefaultEpochPerformanceRatings(1);

      epoch1 = await rootEpoch.epochs(1);
      epoch1.dlpIds.should.deep.eq([5n, 4n, 3n]);
    });

    it("should createEpochs with multiple registered dlps #2", async function () {
      await advanceToEpochN(1);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount);

      await registerNDlps([
        parseEther(101),
        parseEther(106),
        parseEther(103),
        parseEther(103),
        parseEther(103),
      ]);

      await advanceToEpochN(2);

      let epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([
        2n,
        3n,
        4n,
      ]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(2);

      await saveDefaultEpochPerformanceRatings(1);

      epoch1 = await rootEpoch.epochs(1);
      epoch1.dlpIds.should.deep.eq([2n, 3n, 4n]);
    });

    it("should createEpochs with multiple registered dlps #3", async function () {
      await advanceToEpochN(1);
      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount);

      await registerNDlps([
        parseEther(101),
        parseEther(102),
        parseEther(102),
        parseEther(101),
        parseEther(101),
      ]);

      await advanceToEpochN(2);

      let epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([
        2n,
        3n,
        1n,
      ]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(2);

      await saveDefaultEpochPerformanceRatings(1);

      epoch1 = await rootEpoch.epochs(1);
      epoch1.dlpIds.should.deep.eq([2n, 3n, 1n]);
    });

    it("should createEpochs with multiple registered dlps #4", async function () {
      await advanceToEpochN(1);
      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount);

      await registerNDlps([
        dlpEligibilityThreshold - 1n,
        dlpEligibilityThreshold - 1n,
        dlpEligibilityThreshold - 1n,
        dlpEligibilityThreshold - 1n,
        dlpEligibilityThreshold - 1n,
      ]);

      await advanceToEpochN(2);

      let epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(2);

      epoch1 = await rootEpoch.epochs(1);
      epoch1.dlpIds.should.deep.eq([]);
    });

    it("should createEpochs with multiple registered dlps #5", async function () {
      await advanceToEpochN(1);
      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount);

      await registerNDlps([
        dlpEligibilityThreshold - 1n,
        dlpEligibilityThreshold,
        dlpEligibilityThreshold - 1n,
        dlpEligibilityThreshold - 1n,
        dlpEligibilityThreshold + 1n,
      ]);

      await advanceToEpochN(2);

      let epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5n, 2n]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(2);

      await saveDefaultEpochPerformanceRatings(1);

      epoch1 = await rootEpoch.epochs(1);
      epoch1.dlpIds.should.deep.eq([5n, 2n]);
    });

    it("should createEpochs after staking", async function () {
      await advanceToEpochN(1);
      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount);

      await registerNDlps([
        parseEther(101),
        parseEther(102),
        parseEther(103),
        parseEther(104),
        parseEther(105),
      ]);

      await advanceToEpochN(2);

      let epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([
        5n,
        4n,
        3n,
      ]);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(2);

      await saveDefaultEpochPerformanceRatings(1);

      epoch1 = await rootEpoch.epochs(1);
      epoch1.dlpIds.should.deep.eq([5n, 4n, 3n]);

      await rootStaking
        .connect(user1)
        .createStake(1, { value: parseEther(10) });

      await advanceToEpochN(3);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(
          3,
          startBlock + 2 * epochSize,
          startBlock + 3 * epochSize - 1,
          epochRewardAmount,
        );

      await saveDefaultEpochPerformanceRatings(2);

      let epoch2 = await rootEpoch.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.rewardAmount.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([1n, 5n, 4n]);

      // (await rootCore.dlps(1)).epochIds.should.deep.eq([2n]);
      // (await rootCore.dlps(2)).epochIds.should.deep.eq([]);
      // (await rootCore.dlps(3)).epochIds.should.deep.eq([1n]);
      // (await rootCore.dlps(4)).epochIds.should.deep.eq([1n, 2n]);
      // (await rootCore.dlps(5)).epochIds.should.deep.eq([1n, 2n]);
    });

    it("should createEpochs when 100 dlps and 16  epochDlpsLimit", async function () {
      await rootEpoch.connect(owner).updateEpochDlpsLimit(16);
      await rootStaking.connect(owner).updateMinStakeAmount(1);
      await rootCore.connect(owner).updateMinDlpRegistrationStake(1);
      await rootCore.connect(owner).updateDlpEligibilityThresholds(1, 1);
      const stakes = generateStakes(100, parseEther(1), parseEther(2));
      const topStakes = getTopKStakes(stakes, 16);
      await registerNDlps(stakes);

      await advanceToEpochN(5);

      (await rootMetrics.topDlpIds(16)).should.deep.eq(topStakes);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated");

      (await rootEpoch.epochsCount()).should.eq(5);

      await saveDefaultEpochPerformanceRatings(1);
      await saveDefaultEpochPerformanceRatings(2);
      await saveDefaultEpochPerformanceRatings(3);
      await saveDefaultEpochPerformanceRatings(4);

      (await rootEpoch.epochs(1)).dlpIds.should.deep.eq(topStakes);
      (await rootEpoch.epochs(2)).dlpIds.should.deep.eq(topStakes);
      (await rootEpoch.epochs(3)).dlpIds.should.deep.eq(topStakes);
      (await rootEpoch.epochs(4)).dlpIds.should.deep.eq(topStakes);
      (await rootEpoch.epochs(5)).dlpIds.should.deep.eq([]);
    });

    xit("should createEpochs when 1000 dlps and 32  epochDlpsLimit", async function () {
      await rootEpoch.connect(owner).updateEpochSize(2000);
      await advanceToEpochN(1);
      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1);

      epochSize = 2000;

      await rootEpoch.connect(owner).updateEpochDlpsLimit(32);
      await rootCore.connect(owner).updateMinDlpRegistrationStake(1);
      await rootCore.connect(owner).updateDlpEligibilityThresholds(1, 1);
      const stakes = generateStakes(1000, parseEther(1), parseEther(2));
      const topStakes = getTopKStakes(stakes, 32);
      await registerNDlps(stakes);

      await advanceToEpochN(2);

      (await rootMetrics.topDlpIds(32)).should.deep.eq(topStakes);

      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(2);

      (await rootEpoch.epochsCount()).should.eq(2);

      const epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.rewardAmount.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq(topStakes);

      const epoch2 = await rootEpoch.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.rewardAmount.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([]);
    });

    it("should overrideEpoch when maintainer", async function () {
      await advanceToEpochN(1);

      await rootEpoch.connect(owner).createEpochs();

      await rootEpoch.connect(owner).overrideEpoch(1, 1, 2, 3);
      const epoch1 = await rootEpoch.epochs(1);
      epoch1.startBlock.should.eq(1);
      epoch1.endBlock.should.eq(2);
      epoch1.rewardAmount.should.eq(3);
    });

    it("should revert overrideEpoch when not maintainer", async function () {
      await advanceToEpochN(1);

      await rootEpoch
        .connect(owner)
        .createEpochs()
        .should.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount);

      await rootEpoch
        .connect(manager)
        .overrideEpoch(1, 1, 2, 3)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${manager.address}", "${MAINTAINER_ROLE}")`,
        );
    });
  });

  describe("Staking", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should createStake and emit event", async function () {
      const blockNumber = await getCurrentBlockNumber();

      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      const stakeAmount = parseEther(10);

      const user1InitialBalance = await ethers.provider.getBalance(user1);

      const tx = await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount });
      const receipt = await getReceipt(tx);

      await tx.should
        .emit(rootStaking, "StakeCreated")
        .withArgs(2, user1, 1, stakeAmount);

      (await rootStaking.stakersListCount()).should.eq(2);
      (await rootStaking.stakersListAt(0)).should.eq(dlp1Owner.address);
      (await rootStaking.stakersListAt(1)).should.eq(user1.address);

      const stake1 = await rootStaking.stakes(1);
      stake1.id.should.eq(1);
      stake1.stakerAddress.should.eq(dlp1Owner.address);
      stake1.dlpId.should.eq(1);
      stake1.amount.should.eq(dlpEligibilityThreshold);
      stake1.startBlock.should.eq(blockNumber + 1);
      stake1.endBlock.should.eq(0);
      stake1.withdrawn.should.eq(false);
      stake1.lastClaimedEpochId.should.eq(0);

      (await rootStaking.stakerDlpsListCount(dlp1Owner.address)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(dlp1Owner.address, 0)).should.eq(1);
      (
        await rootStaking.stakerDlpsListValues(dlp1Owner.address)
      ).should.deep.eq([1]);

      (await rootStaking.stakerStakesListCount(dlp1Owner.address)).should.eq(1);
      (await rootStaking.stakerStakesListAt(dlp1Owner.address, 0)).should.eq(1);
      (
        await rootStaking.stakerStakesListValues(dlp1Owner.address)
      ).should.deep.eq([1]);

      (await rootStaking.stakerDlpStakeAmount(dlp1Owner.address, 1)).should.eq(
        dlpEligibilityThreshold,
      );
      (await rootStaking.stakerTotalStakeAmount(dlp1Owner.address)).should.eq(
        dlpEligibilityThreshold,
      );

      const stakes2 = await rootStaking.stakes(2);
      stakes2.id.should.eq(2);
      stakes2.stakerAddress.should.eq(user1.address);
      stakes2.dlpId.should.eq(1);
      stakes2.amount.should.eq(stakeAmount);
      stakes2.startBlock.should.eq(blockNumber + 3);
      stakes2.endBlock.should.eq(0);
      stakes2.withdrawn.should.eq(false);
      stakes2.lastClaimedEpochId.should.eq(0);

      (await rootStaking.stakerDlpsListCount(user1.address)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(user1.address, 0)).should.eq(1);
      (await rootStaking.stakerDlpsListValues(user1.address)).should.deep.eq([
        1,
      ]);

      (await rootStaking.stakerStakesListCount(user1.address)).should.eq(1);
      (await rootStaking.stakerStakesListAt(user1.address, 0)).should.eq(2);
      (await rootStaking.stakerStakesListValues(user1.address)).should.deep.eq([
        2,
      ]);

      (await rootStaking.stakerDlpStakeAmount(user1.address, 1)).should.eq(
        stakeAmount,
      );
      (await rootStaking.stakerTotalStakeAmount(user1.address)).should.eq(
        stakeAmount,
      );

      const dlp1Info = await rootCore.dlps(1);
      dlp1Info.stakeAmount.should.eq(dlpEligibilityThreshold + stakeAmount);

      (await rootStaking.stakerDlpsListValues(user1)).should.deep.eq([1]);
      (await rootStaking.stakerDlpsListCount(user1)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(user1, 0)).should.deep.eq(1);

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance - stakeAmount - receipt.fee,
      );
      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        dlpEligibilityThreshold + stakeAmount,
      );
    });

    it("should create missing epochs when createStake", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      const stakeAmount = parseEther(10);

      await advanceToEpochN(5);
      (await rootEpoch.epochsCount()).should.eq(0);

      const tx = await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount });

      const epoch1 = await rootEpoch.epochs(1);
      const epoch2 = await rootEpoch.epochs(2);
      const epoch3 = await rootEpoch.epochs(3);
      const epoch4 = await rootEpoch.epochs(4);
      const epoch5 = await rootEpoch.epochs(5);

      await tx.should
        .emit(rootStaking, "StakeCreated")
        .withArgs(2, user1, 1, stakeAmount)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(1, epoch1.startBlock, epoch1.endBlock, epoch1.rewardAmount)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(2, epoch2.startBlock, epoch2.endBlock, epoch2.rewardAmount)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(3, epoch3.startBlock, epoch3.endBlock, epoch3.rewardAmount)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(4, epoch4.startBlock, epoch4.endBlock, epoch4.rewardAmount)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(5, epoch5.startBlock, epoch5.endBlock, epoch5.rewardAmount);

      (await rootEpoch.epochsCount()).should.eq(5);
    });

    it(`should reject createStake when dlp doesn't exist`, async function () {
      await rootStaking
        .connect(user1)
        .createStake(1, { value: parseEther(10) })
        .should.be.rejectedWith("InvalidDlpStatus()");
    });

    it(`should reject createStake when dlp is deregistered`, async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await rootCore.connect(dlp1Owner).deregisterDlp(1);

      await rootStaking
        .connect(user1)
        .createStake(1, { value: parseEther(10) })
        .should.be.rejectedWith("InvalidDlpStatus()");
    });

    it(`should reject createStake when stakeAmount < minStakeAmount`, async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await rootStaking
        .connect(user1)
        .createStake(1, { value: minStakeAmount - 1n })
        .should.be.rejectedWith("InvalidStakeAmount()");
    });

    it("should createStake multiple times, one dlp", async function () {
      const blockNumber = await getCurrentBlockNumber();

      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      const stakeAmount1 = parseEther(10);
      const stakeAmount2 = parseEther(15);

      const user1InitialBalance = await ethers.provider.getBalance(user1);

      const tx1 = await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount1 });
      const receipt1 = await getReceipt(tx1);

      await tx1.should
        .emit(rootStaking, "StakeCreated")
        .withArgs(2, user1, 1, stakeAmount1);

      const tx2 = await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount2 });
      const receipt2 = await getReceipt(tx2);

      await tx2.should
        .emit(rootStaking, "StakeCreated")
        .withArgs(3, user1, 1, stakeAmount2);

      const stake1 = await rootStaking.stakes(1);
      stake1.id.should.eq(1);
      stake1.stakerAddress.should.eq(dlp1Owner.address);
      stake1.dlpId.should.eq(1);
      stake1.amount.should.eq(dlpEligibilityThreshold);
      stake1.startBlock.should.eq(blockNumber + 1);
      stake1.endBlock.should.eq(0);
      stake1.withdrawn.should.eq(false);
      stake1.lastClaimedEpochId.should.eq(0);

      (await rootStaking.stakerDlpsListCount(dlp1Owner.address)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(dlp1Owner.address, 0)).should.eq(1);
      (
        await rootStaking.stakerDlpsListValues(dlp1Owner.address)
      ).should.deep.eq([1]);

      (await rootStaking.stakerStakesListCount(dlp1Owner.address)).should.eq(1);
      (await rootStaking.stakerStakesListAt(dlp1Owner.address, 0)).should.eq(1);
      (
        await rootStaking.stakerStakesListValues(dlp1Owner.address)
      ).should.deep.eq([1]);

      (await rootStaking.stakerDlpStakeAmount(dlp1Owner.address, 1)).should.eq(
        dlpEligibilityThreshold,
      );
      (await rootStaking.stakerTotalStakeAmount(dlp1Owner.address)).should.eq(
        dlpEligibilityThreshold,
      );

      const stakes2 = await rootStaking.stakes(2);
      stakes2.id.should.eq(2);
      stakes2.stakerAddress.should.eq(user1.address);
      stakes2.dlpId.should.eq(1);
      stakes2.amount.should.eq(stakeAmount1);
      stakes2.startBlock.should.eq(blockNumber + 3);
      stakes2.endBlock.should.eq(0);
      stakes2.withdrawn.should.eq(false);
      stakes2.lastClaimedEpochId.should.eq(0);

      const stakes3 = await rootStaking.stakes(3);
      stakes3.id.should.eq(3);
      stakes3.stakerAddress.should.eq(user1.address);
      stakes3.dlpId.should.eq(1);
      stakes3.amount.should.eq(stakeAmount2);
      stakes3.startBlock.should.eq(blockNumber + 4);
      stakes3.endBlock.should.eq(0);
      stakes3.withdrawn.should.eq(false);
      stakes3.lastClaimedEpochId.should.eq(0);

      (await rootStaking.stakerDlpsListCount(user1.address)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(user1.address, 0)).should.eq(1);
      (await rootStaking.stakerDlpsListValues(user1.address)).should.deep.eq([
        1,
      ]);

      (await rootStaking.stakerStakesListCount(user1.address)).should.eq(2);
      (await rootStaking.stakerStakesListAt(user1.address, 0)).should.eq(2);
      (await rootStaking.stakerStakesListAt(user1.address, 1)).should.eq(3);
      (await rootStaking.stakerStakesListValues(user1.address)).should.deep.eq([
        2, 3,
      ]);

      (await rootStaking.stakerDlpStakeAmount(user1.address, 1)).should.eq(
        stakeAmount1 + stakeAmount2,
      );
      (await rootStaking.stakerTotalStakeAmount(user1.address)).should.eq(
        stakeAmount1 + stakeAmount2,
      );

      const dlp1Info = await rootCore.dlps(1);
      dlp1Info.stakeAmount.should.eq(
        dlpEligibilityThreshold + stakeAmount1 + stakeAmount2,
      );

      (await rootStaking.stakerDlpsListValues(user1)).should.deep.eq([1]);
      (await rootStaking.stakerDlpsListCount(user1)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(user1, 0)).should.deep.eq(1);

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance -
          stakeAmount1 -
          stakeAmount2 -
          receipt1.fee -
          receipt2.fee,
      );
      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        dlpEligibilityThreshold + stakeAmount1 + stakeAmount2,
      );
    });

    it("should createStake multiple times, multiple dlps", async function () {
      const blockNumber = await getCurrentBlockNumber();

      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);
      await rootCore
        .connect(dlp2Owner)
        .registerDlp(dlpInfo[2], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(2, true);

      const stakeAmount1 = parseEther(10);
      const stakeAmount2 = parseEther(15);
      const stakeAmount3 = parseEther(20);

      const user1InitialBalance = await ethers.provider.getBalance(user1);

      const tx1 = await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount1 });
      const receipt1 = await getReceipt(tx1);

      await tx1.should
        .emit(rootStaking, "StakeCreated")
        .withArgs(3, user1, 1, stakeAmount1);

      const tx2 = await rootStaking
        .connect(user1)
        .createStake(2, { value: stakeAmount2 });
      const receipt2 = await getReceipt(tx2);

      await tx2.should
        .emit(rootStaking, "StakeCreated")
        .withArgs(4, user1, 2, stakeAmount2);

      const tx3 = await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount3 });
      const receipt3 = await getReceipt(tx3);

      await tx3.should
        .emit(rootStaking, "StakeCreated")
        .withArgs(5, user1, 1, stakeAmount3);

      const stake1 = await rootStaking.stakes(1);
      stake1.id.should.eq(1);
      stake1.stakerAddress.should.eq(dlp1Owner.address);
      stake1.dlpId.should.eq(1);
      stake1.amount.should.eq(dlpEligibilityThreshold);
      stake1.startBlock.should.eq(blockNumber + 1);
      stake1.endBlock.should.eq(0);
      stake1.withdrawn.should.eq(false);
      stake1.lastClaimedEpochId.should.eq(0);

      (await rootStaking.stakerDlpsListCount(dlp1Owner.address)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(dlp1Owner.address, 0)).should.eq(1);
      (
        await rootStaking.stakerDlpsListValues(dlp1Owner.address)
      ).should.deep.eq([1]);

      (await rootStaking.stakerStakesListCount(dlp1Owner.address)).should.eq(1);
      (await rootStaking.stakerStakesListAt(dlp1Owner.address, 0)).should.eq(1);
      (
        await rootStaking.stakerStakesListValues(dlp1Owner.address)
      ).should.deep.eq([1]);

      (await rootStaking.stakerDlpStakeAmount(dlp1Owner.address, 1)).should.eq(
        dlpEligibilityThreshold,
      );
      (await rootStaking.stakerTotalStakeAmount(dlp1Owner.address)).should.eq(
        dlpEligibilityThreshold,
      );

      const stake2 = await rootStaking.stakes(2);
      stake2.id.should.eq(2);
      stake2.stakerAddress.should.eq(dlp2Owner.address);
      stake2.dlpId.should.eq(2);
      stake2.amount.should.eq(dlpEligibilityThreshold);
      stake2.startBlock.should.eq(blockNumber + 3);
      stake2.endBlock.should.eq(0);
      stake2.withdrawn.should.eq(false);
      stake2.lastClaimedEpochId.should.eq(0);

      (await rootStaking.stakerDlpsListCount(dlp2Owner.address)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(dlp2Owner.address, 0)).should.eq(2);
      (
        await rootStaking.stakerDlpsListValues(dlp2Owner.address)
      ).should.deep.eq([2]);

      (await rootStaking.stakerStakesListCount(dlp2Owner.address)).should.eq(1);
      (await rootStaking.stakerStakesListAt(dlp2Owner.address, 0)).should.eq(2);
      (
        await rootStaking.stakerStakesListValues(dlp2Owner.address)
      ).should.deep.eq([2]);

      (await rootStaking.stakerDlpStakeAmount(dlp2Owner.address, 2)).should.eq(
        dlpEligibilityThreshold,
      );
      (await rootStaking.stakerTotalStakeAmount(dlp2Owner.address)).should.eq(
        dlpEligibilityThreshold,
      );

      const stakes3 = await rootStaking.stakes(3);
      stakes3.id.should.eq(3);
      stakes3.stakerAddress.should.eq(user1.address);
      stakes3.dlpId.should.eq(1);
      stakes3.amount.should.eq(stakeAmount1);
      stakes3.startBlock.should.eq(blockNumber + 5);
      stakes3.endBlock.should.eq(0);
      stakes3.withdrawn.should.eq(false);
      stakes3.lastClaimedEpochId.should.eq(0);

      const stakes4 = await rootStaking.stakes(4);
      stakes4.id.should.eq(4);
      stakes4.stakerAddress.should.eq(user1.address);
      stakes4.dlpId.should.eq(2);
      stakes4.amount.should.eq(stakeAmount2);
      stakes4.startBlock.should.eq(blockNumber + 6);
      stakes4.endBlock.should.eq(0);
      stakes4.withdrawn.should.eq(false);
      stakes4.lastClaimedEpochId.should.eq(0);

      const stakes5 = await rootStaking.stakes(5);
      stakes5.id.should.eq(5);
      stakes5.stakerAddress.should.eq(user1.address);
      stakes5.dlpId.should.eq(1);
      stakes5.amount.should.eq(stakeAmount3);
      stakes5.startBlock.should.eq(blockNumber + 7);
      stakes5.endBlock.should.eq(0);
      stakes5.withdrawn.should.eq(false);
      stakes5.lastClaimedEpochId.should.eq(0);

      (await rootStaking.stakerDlpsListCount(user1.address)).should.eq(2);
      (await rootStaking.stakerDlpsListAt(user1.address, 0)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(user1.address, 1)).should.eq(2);
      (await rootStaking.stakerDlpsListValues(user1.address)).should.deep.eq([
        1, 2,
      ]);

      (await rootStaking.stakerStakesListCount(user1.address)).should.eq(3);
      (await rootStaking.stakerStakesListAt(user1.address, 0)).should.eq(3);
      (await rootStaking.stakerStakesListAt(user1.address, 1)).should.eq(4);
      (await rootStaking.stakerStakesListAt(user1.address, 2)).should.eq(5);
      (await rootStaking.stakerStakesListValues(user1.address)).should.deep.eq([
        3, 4, 5,
      ]);

      (await rootStaking.stakerDlpStakeAmount(user1.address, 1)).should.eq(
        stakeAmount1 + stakeAmount3,
      );
      (await rootStaking.stakerDlpStakeAmount(user1.address, 2)).should.eq(
        stakeAmount2,
      );
      (await rootStaking.stakerTotalStakeAmount(user1.address)).should.eq(
        stakeAmount1 + stakeAmount2 + stakeAmount3,
      );

      const dlp1Info = await rootCore.dlps(1);
      dlp1Info.stakeAmount.should.eq(
        dlpEligibilityThreshold + stakeAmount1 + stakeAmount3,
      );

      const dlp2Info = await rootCore.dlps(2);
      dlp2Info.stakeAmount.should.eq(dlpEligibilityThreshold + stakeAmount2);

      (await rootStaking.stakerDlpsListValues(user1)).should.deep.eq([1, 2]);
      (await rootStaking.stakerDlpsListCount(user1)).should.eq(2);
      (await rootStaking.stakerDlpsListAt(user1, 0)).should.deep.eq(1);
      (await rootStaking.stakerDlpsListAt(user1, 1)).should.deep.eq(2);

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance -
          stakeAmount1 -
          stakeAmount2 -
          stakeAmount3 -
          receipt1.fee -
          receipt2.fee -
          receipt3.fee,
      );
      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        2n * dlpEligibilityThreshold +
          stakeAmount1 +
          stakeAmount2 +
          stakeAmount3,
      );
    });

    it("should createStake and set lastClaimedIndexEpochId after many epochs", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(5);

      await saveDefaultEpochPerformanceRatings(1);
      await saveDefaultEpochPerformanceRatings(2);
      await saveDefaultEpochPerformanceRatings(3);
      await saveDefaultEpochPerformanceRatings(4);

      await rootCore
        .connect(dlp2Owner)
        .registerDlp(dlpInfo[2], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(2, true);

      const stakeAmount1 = parseEther(10);
      const stakeAmount2 = parseEther(15);

      await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount1 })
        .should.emit(rootStaking, "StakeCreated")
        .withArgs(3, user1, 1, stakeAmount1);

      await rootStaking
        .connect(user1)
        .createStake(2, { value: stakeAmount2 })
        .should.emit(rootStaking, "StakeCreated")
        .withArgs(4, user1, 2, stakeAmount2);

      // (await rootCore.dlps(1)).epochIds.should.deep.eq([1n, 2n, 3n, 4n]);
      // (await rootCore.dlps(2)).epochIds.should.deep.eq([]);

      const stake1 = await rootStaking.stakes(1);
      stake1.id.should.eq(1);
      stake1.stakerAddress.should.eq(dlp1Owner.address);
      stake1.dlpId.should.eq(1);
      stake1.amount.should.eq(dlpEligibilityThreshold);
      stake1.lastClaimedEpochId.should.eq(0);

      const stake2 = await rootStaking.stakes(2);
      stake2.id.should.eq(2);
      stake2.stakerAddress.should.eq(dlp2Owner.address);
      stake2.dlpId.should.eq(2);
      stake2.amount.should.eq(dlpEligibilityThreshold);
      stake2.lastClaimedEpochId.should.eq(4);

      const stakes3 = await rootStaking.stakes(3);
      stakes3.id.should.eq(3);
      stakes3.stakerAddress.should.eq(user1.address);
      stakes3.dlpId.should.eq(1);
      stakes3.amount.should.eq(stakeAmount1);
      stakes3.lastClaimedEpochId.should.eq(4);

      const stakes4 = await rootStaking.stakes(4);
      stakes4.id.should.eq(4);
      stakes4.stakerAddress.should.eq(user1.address);
      stakes4.dlpId.should.eq(2);
      stakes4.amount.should.eq(stakeAmount2);
      stakes4.lastClaimedEpochId.should.eq(4);

      const dlp1Info = await rootCore.dlps(1);
      dlp1Info.stakeAmount.should.eq(dlpEligibilityThreshold + stakeAmount1);

      const dlp2Info = await rootCore.dlps(2);
      dlp2Info.stakeAmount.should.eq(dlpEligibilityThreshold + stakeAmount2);

      (await rootStaking.stakerDlpsListValues(user1)).should.deep.eq([1, 2]);
      (await rootStaking.stakerDlpsListCount(user1)).should.eq(2);
      (await rootStaking.stakerDlpsListAt(user1, 0)).should.deep.eq(1);
      (await rootStaking.stakerDlpsListAt(user1, 1)).should.deep.eq(2);
    });

    it("should createStake when dlp is not verified", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: minDlpRegistrationStake });

      await rootStaking
        .connect(user1)
        .createStake(1, { value: parseEther(10) });

      const stake2 = await rootStaking.stakes(2);
      stake2.id.should.eq(2);
      stake2.stakerAddress.should.eq(user1.address);
      stake2.dlpId.should.eq(1);
      stake2.amount.should.eq(parseEther(10));
    });

    it("should createStake and not update status if dlp is not verified", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: minDlpRegistrationStake });

      await rootStaking
        .connect(user1)
        .createStake(1, { value: dlpEligibilityThreshold });

      const stake2 = await rootStaking.stakes(2);
      stake2.id.should.eq(2);
      stake2.stakerAddress.should.eq(user1.address);
      stake2.dlpId.should.eq(1);
      stake2.amount.should.eq(dlpEligibilityThreshold);

      const dlp1Before = await rootCore.dlps(1);
      dlp1Before.isVerified.should.eq(false);
      dlp1Before.status.should.eq(DlpStatus.Registered);
      (await rootCore.eligibleDlpsListValues()).should.deep.eq([]);

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      const dlp1After = await rootCore.dlps(1);
      dlp1After.isVerified.should.eq(true);
      dlp1After.status.should.eq(DlpStatus.Eligible);
      (await rootCore.eligibleDlpsListValues()).should.deep.eq([1n]);
    });

    it("should createStake and update status if dlp is verified", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: minDlpRegistrationStake });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await rootStaking
        .connect(user1)
        .createStake(1, { value: dlpEligibilityThreshold });

      const stake2 = await rootStaking.stakes(2);
      stake2.id.should.eq(2);
      stake2.stakerAddress.should.eq(user1.address);
      stake2.dlpId.should.eq(1);
      stake2.amount.should.eq(dlpEligibilityThreshold);

      const dlp1After = await rootCore.dlps(1);
      dlp1After.isVerified.should.eq(true);
      dlp1After.status.should.eq(DlpStatus.Eligible);
      (await rootCore.eligibleDlpsListValues()).should.deep.eq([1n]);
    });

    it("should createStake and update epochDlpStakeAdjustment after epoch 3", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });
      const stake1Adjustment = parseEther(0); //before epoch 3

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(3);
      await rootStaking
        .connect(user1)
        .createStake(1, { value: parseEther(300) });
      const stake2Adjustment = parseEther(0); //beginning of epoch 3, it will have a 1x multiplier at the end of epoch 3
      (await rootMetrics.epochDlps(3, 1)).stakeAmountAdjustment.should.eq(
        stake1Adjustment + stake2Adjustment,
      );

      await advanceBlockNTimes(daySize - 1);
      await rootStaking
        .connect(user1)
        .createStake(1, { value: parseEther(300) });
      const stake3Adjustment =
        parseEther(300) - calculateStakeScoreByDay(parseEther(300), 19);
      (await rootMetrics.epochDlps(3, 1)).stakeAmountAdjustment.should.eq(
        stake1Adjustment + stake2Adjustment + stake3Adjustment,
      );

      await advanceBlockNTimes(18 * daySize - 1);
      await rootStaking
        .connect(user1)
        .createStake(1, { value: parseEther(400) });
      const stake4Adjustment =
        parseEther(400) - calculateStakeScoreByDay(parseEther(400), 1);
      (await rootMetrics.epochDlps(3, 1)).stakeAmountAdjustment.should.eq(
        stake1Adjustment +
          stake2Adjustment +
          stake3Adjustment +
          stake4Adjustment,
      );

      await advanceBlockNTimes(daySize - 1);
      await rootStaking
        .connect(user1)
        .createStake(1, { value: parseEther(500) });
      const stake5Adjustment =
        parseEther(500) - calculateStakeScoreByDay(parseEther(500), 0);
      (await rootMetrics.epochDlps(3, 1)).stakeAmountAdjustment.should.eq(
        stake1Adjustment +
          stake2Adjustment +
          stake3Adjustment +
          stake4Adjustment +
          stake5Adjustment,
      );
    });
  });

  describe("Close stake", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should closeStake and emit event", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      const stakeAmount = parseEther(10);
      const currentBlockNumber = await getCurrentBlockNumber();

      const user1InitialBalance = await ethers.provider.getBalance(user1);

      (await rootCore.dlps(1)).stakeAmount.should.eq(dlpEligibilityThreshold);

      const tx1 = await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount });
      const receipt1 = await getReceipt(tx1);

      const tx2 = await rootStaking.connect(user1).closeStakes([2]);
      const receipt2 = await getReceipt(tx2);

      await tx2.should.emit(rootStaking, "StakeClosed").withArgs(2);

      const stake2 = await rootStaking.stakes(2);
      stake2.id.should.eq(2);
      stake2.stakerAddress.should.eq(user1);
      stake2.dlpId.should.eq(1);
      stake2.amount.should.eq(stakeAmount);
      stake2.startBlock.should.eq(currentBlockNumber + 1);
      stake2.endBlock.should.eq(currentBlockNumber + 2);
      stake2.withdrawn.should.eq(false);
      stake2.lastClaimedEpochId.should.eq(0);

      (await rootStaking.stakerDlpsListCount(user1.address)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(user1.address, 0)).should.eq(1);
      (await rootStaking.stakerDlpsListValues(user1.address)).should.deep.eq([
        1,
      ]);

      (await rootStaking.stakerStakesListCount(user1.address)).should.eq(1);
      (await rootStaking.stakerStakesListAt(user1.address, 0)).should.eq(2);
      (await rootStaking.stakerStakesListValues(user1.address)).should.deep.eq([
        2,
      ]);

      (await rootStaking.stakerDlpStakeAmount(user1.address, 1)).should.eq(0);
      (await rootStaking.stakerTotalStakeAmount(user1.address)).should.eq(0);

      (await rootCore.dlps(1)).stakeAmount.should.eq(dlpEligibilityThreshold);

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance - stakeAmount - receipt1.fee - receipt2.fee,
      );
      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        dlpEligibilityThreshold + stakeAmount,
      );
    });

    it("should closeStake multiple stakes in one call", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      const stakeAmount1 = parseEther(10);
      const stakeAmount2 = parseEther(15);

      const currentBlockNumber = await getCurrentBlockNumber();

      const user1InitialBalance = await ethers.provider.getBalance(user1);

      const tx1 = await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount1 });
      const receipt1 = await getReceipt(tx1);

      const tx2 = await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount2 });
      const receipt2 = await getReceipt(tx2);

      (await rootCore.dlps(1)).stakeAmount.should.eq(
        dlpEligibilityThreshold + stakeAmount1 + stakeAmount2,
      );

      const tx3 = await rootStaking.connect(user1).closeStakes([2, 3]);
      const receipt3 = await getReceipt(tx3);

      await tx3.should
        .emit(rootStaking, "StakeClosed")
        .withArgs(2)
        .and.emit(rootStaking, "StakeClosed")
        .withArgs(3);

      const stake2 = await rootStaking.stakes(2);
      stake2.id.should.eq(2);
      stake2.stakerAddress.should.eq(user1);
      stake2.dlpId.should.eq(1);
      stake2.amount.should.eq(stakeAmount1);
      stake2.startBlock.should.eq(currentBlockNumber + 1);
      stake2.endBlock.should.eq(currentBlockNumber + 3);
      stake2.withdrawn.should.eq(false);
      stake2.lastClaimedEpochId.should.eq(0);

      const stake3 = await rootStaking.stakes(3);
      stake3.id.should.eq(3);
      stake3.stakerAddress.should.eq(user1);
      stake3.dlpId.should.eq(1);
      stake3.amount.should.eq(stakeAmount2);
      stake3.startBlock.should.eq(currentBlockNumber + 2);
      stake3.endBlock.should.eq(currentBlockNumber + 3);
      stake3.withdrawn.should.eq(false);
      stake3.lastClaimedEpochId.should.eq(0);

      (await rootStaking.stakerDlpsListCount(user1.address)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(user1.address, 0)).should.eq(1);
      (await rootStaking.stakerDlpsListValues(user1.address)).should.deep.eq([
        1,
      ]);

      (await rootStaking.stakerStakesListCount(user1.address)).should.eq(2);
      (await rootStaking.stakerStakesListAt(user1.address, 0)).should.eq(2);
      (await rootStaking.stakerStakesListAt(user1.address, 1)).should.eq(3);
      (await rootStaking.stakerStakesListValues(user1.address)).should.deep.eq([
        2, 3,
      ]);

      (await rootStaking.stakerDlpStakeAmount(user1.address, 1)).should.eq(0);
      (await rootStaking.stakerTotalStakeAmount(user1.address)).should.eq(0);

      (await rootCore.dlps(1)).stakeAmount.should.eq(dlpEligibilityThreshold);

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance -
          stakeAmount1 -
          stakeAmount2 -
          receipt1.fee -
          receipt2.fee -
          receipt3.fee,
      );

      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        dlpEligibilityThreshold + stakeAmount1 + stakeAmount2,
      );
    });

    it("should closeStake multiple stakes", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      const stakeAmount1 = parseEther(10);
      const stakeAmount2 = parseEther(15);

      const currentBlockNumber = await getCurrentBlockNumber();

      const user1InitialBalance = await ethers.provider.getBalance(user1);

      const tx1 = await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount1 });
      const receipt1 = await getReceipt(tx1);

      const tx2 = await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount2 });
      const receipt2 = await getReceipt(tx2);

      (await rootCore.dlps(1)).stakeAmount.should.eq(
        dlpEligibilityThreshold + stakeAmount1 + stakeAmount2,
      );

      const tx3 = await rootStaking.connect(user1).closeStakes([3]);
      const receipt3 = await getReceipt(tx3);

      await tx3.should.emit(rootStaking, "StakeClosed").withArgs(3);

      const stake2 = await rootStaking.stakes(2);
      stake2.id.should.eq(2);
      stake2.stakerAddress.should.eq(user1);
      stake2.dlpId.should.eq(1);
      stake2.amount.should.eq(stakeAmount1);
      stake2.startBlock.should.eq(currentBlockNumber + 1);
      stake2.endBlock.should.eq(0);
      stake2.withdrawn.should.eq(false);
      stake2.lastClaimedEpochId.should.eq(0);

      const stake3 = await rootStaking.stakes(3);
      stake3.id.should.eq(3);
      stake3.stakerAddress.should.eq(user1);
      stake3.dlpId.should.eq(1);
      stake3.amount.should.eq(stakeAmount2);
      stake3.startBlock.should.eq(currentBlockNumber + 2);
      stake3.endBlock.should.eq(currentBlockNumber + 3);
      stake3.withdrawn.should.eq(false);
      stake3.lastClaimedEpochId.should.eq(0);

      (await rootStaking.stakerDlpsListCount(user1.address)).should.eq(1);
      (await rootStaking.stakerDlpsListAt(user1.address, 0)).should.eq(1);
      (await rootStaking.stakerDlpsListValues(user1.address)).should.deep.eq([
        1,
      ]);

      (await rootStaking.stakerStakesListCount(user1.address)).should.eq(2);
      (await rootStaking.stakerStakesListAt(user1.address, 0)).should.eq(2);
      (await rootStaking.stakerStakesListAt(user1.address, 1)).should.eq(3);
      (await rootStaking.stakerStakesListValues(user1.address)).should.deep.eq([
        2, 3,
      ]);

      (await rootStaking.stakerDlpStakeAmount(user1.address, 1)).should.eq(
        stakeAmount1,
      );
      (await rootStaking.stakerTotalStakeAmount(user1.address)).should.eq(
        stakeAmount1,
      );

      (await rootCore.dlps(1)).stakeAmount.should.eq(
        dlpEligibilityThreshold + stakeAmount1,
      );

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance -
          stakeAmount1 -
          stakeAmount2 -
          receipt1.fee -
          receipt2.fee -
          receipt3.fee,
      );

      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        dlpEligibilityThreshold + stakeAmount1 + stakeAmount2,
      );
    });

    it("should create missing epochs when closeStake", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      const stakeAmount = parseEther(10);

      await rootStaking.connect(user1).createStake(1, { value: stakeAmount });

      await advanceToEpochN(5);

      await rootStaking
        .connect(user1)
        .closeStakes([2])
        .should.emit(rootStaking, "StakeClosed")
        .withArgs(2)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(1, startBlock, startBlock + epochSize - 1, epochRewardAmount)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(
          2,
          startBlock + epochSize,
          startBlock + 2 * epochSize - 1,
          epochRewardAmount,
        )
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(
          3,
          startBlock + 2 * epochSize,
          startBlock + 3 * epochSize - 1,
          epochRewardAmount,
        )
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(
          4,
          startBlock + 3 * epochSize,
          startBlock + 4 * epochSize - 1,
          epochRewardAmount,
        )
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(
          5,
          startBlock + 4 * epochSize,
          startBlock + 5 * epochSize - 1,
          epochRewardAmount,
        );

      (await rootEpoch.epochsCount()).should.eq(5);
    });

    it("should reject closeStake when not stake owner", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      const stakeAmount = parseEther(10);

      await rootStaking.connect(user1).createStake(1, { value: stakeAmount });

      await rootStaking
        .connect(user2)
        .closeStakes([2])
        .should.be.rejectedWith("NotStakeOwner()");
    });

    it("should reject closeStake when already closed", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      const stakeAmount = parseEther(10);

      await rootStaking.connect(user1).createStake(1, { value: stakeAmount });

      await rootStaking.connect(user1).closeStakes([2]);
      await rootStaking
        .connect(user1)
        .closeStakes([2])
        .should.be.rejectedWith("AlreadyClosed()");
    });

    it("should reject closeStake when invalid stake", async function () {
      await rootStaking
        .connect(user1)
        .closeStakes([2])
        .should.be.rejectedWith("NotStakeOwner()");
    });

    it("should closeStake and update dlp status (eligible -> subEligible)", async function () {
      const currentBlockNumber = await getCurrentBlockNumber();

      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: minDlpRegistrationStake });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await rootStaking
        .connect(user1)
        .createStake(1, { value: dlpEligibilityThreshold - 1n });

      let dlp1Info = await rootCore.dlps(1);
      dlp1Info.status.should.eq(DlpStatus.Eligible);
      dlp1Info.stakeAmount.should.eq(
        minDlpRegistrationStake + dlpEligibilityThreshold - 1n,
      );

      await rootStaking.connect(dlp1Owner).closeStakes([1]);

      const stake1 = await rootStaking.stakes(1);
      stake1.id.should.eq(1);
      stake1.stakerAddress.should.eq(dlp1Owner);
      stake1.dlpId.should.eq(1);
      stake1.amount.should.eq(minDlpRegistrationStake);
      stake1.startBlock.should.eq(currentBlockNumber + 1);
      stake1.endBlock.should.eq(currentBlockNumber + 4);
      stake1.withdrawn.should.eq(false);
      stake1.lastClaimedEpochId.should.eq(0);

      dlp1Info = await rootCore.dlps(1);
      dlp1Info.status.should.eq(DlpStatus.SubEligible);
      dlp1Info.stakeAmount.should.eq(dlpEligibilityThreshold - 1n);

      (await rootCore.eligibleDlpsListValues()).should.deep.eq([1n]);
    });

    it("should closeStake and update dlp status (eligible -> registered)", async function () {
      const currentBlockNumber = await getCurrentBlockNumber();

      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await rootStaking
        .connect(user1)
        .createStake(1, { value: minDlpRegistrationStake - 1n });

      let dlp1Info = await rootCore.dlps(1);
      dlp1Info.status.should.eq(DlpStatus.Eligible);
      dlp1Info.stakeAmount.should.eq(
        dlpEligibilityThreshold + minDlpRegistrationStake - 1n,
      );

      await rootStaking.connect(dlp1Owner).closeStakes([1]);

      const stake1 = await rootStaking.stakes(1);
      stake1.id.should.eq(1);
      stake1.stakerAddress.should.eq(dlp1Owner);
      stake1.dlpId.should.eq(1);
      stake1.amount.should.eq(dlpEligibilityThreshold);
      stake1.startBlock.should.eq(currentBlockNumber + 1);
      stake1.endBlock.should.eq(currentBlockNumber + 4);
      stake1.withdrawn.should.eq(false);
      stake1.lastClaimedEpochId.should.eq(0);

      dlp1Info = await rootCore.dlps(1);
      dlp1Info.status.should.eq(DlpStatus.Registered);
      dlp1Info.stakeAmount.should.eq(minDlpRegistrationStake - 1n);

      (await rootCore.eligibleDlpsListValues()).should.deep.eq([]);
    });

    it("should closeStake and update dlp status (subEligible -> registered)", async function () {
      const currentBlockNumber = await getCurrentBlockNumber();

      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: minDlpRegistrationStake });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await rootStaking
        .connect(user1)
        .createStake(1, { value: dlpEligibilityThreshold - 1n });

      let dlp1Info = await rootCore.dlps(1);
      dlp1Info.status.should.eq(DlpStatus.Eligible);
      dlp1Info.stakeAmount.should.eq(
        minDlpRegistrationStake + dlpEligibilityThreshold - 1n,
      );

      (await rootCore.eligibleDlpsListValues()).should.deep.eq([1n]);

      await rootStaking.connect(dlp1Owner).closeStakes([1]);

      const stake1 = await rootStaking.stakes(1);
      stake1.id.should.eq(1);
      stake1.stakerAddress.should.eq(dlp1Owner);
      stake1.dlpId.should.eq(1);
      stake1.amount.should.eq(minDlpRegistrationStake);
      stake1.startBlock.should.eq(currentBlockNumber + 1);
      stake1.endBlock.should.eq(currentBlockNumber + 4);
      stake1.withdrawn.should.eq(false);
      stake1.lastClaimedEpochId.should.eq(0);

      dlp1Info = await rootCore.dlps(1);
      dlp1Info.status.should.eq(DlpStatus.SubEligible);
      dlp1Info.stakeAmount.should.eq(dlpEligibilityThreshold - 1n);

      (await rootCore.eligibleDlpsListValues()).should.deep.eq([1n]);

      await rootStaking.connect(user1).closeStakes([2]);

      const stake2 = await rootStaking.stakes(2);
      stake2.id.should.eq(2);
      stake2.stakerAddress.should.eq(user1);
      stake2.dlpId.should.eq(1);
      stake2.amount.should.eq(dlpEligibilityThreshold - 1n);
      stake2.startBlock.should.eq(currentBlockNumber + 3);
      stake2.endBlock.should.eq(currentBlockNumber + 5);
      stake2.withdrawn.should.eq(false);
      stake2.lastClaimedEpochId.should.eq(0);

      dlp1Info = await rootCore.dlps(1);
      dlp1Info.status.should.eq(DlpStatus.Registered);
      dlp1Info.stakeAmount.should.eq(0);

      (await rootCore.eligibleDlpsListValues()).should.deep.eq([]);
    });

    it("should closeStake and keep dlp status (eligible)", async function () {
      await rootCore.connect(dlp1Owner).registerDlp(dlpInfo[1], {
        value: dlpEligibilityThreshold,
      });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      const currentBlockNumber = await getCurrentBlockNumber();

      await rootStaking.connect(user1).createStake(1, { value: parseEther(1) });

      let dlp1Info = await rootCore.dlps(1);
      dlp1Info.status.should.eq(DlpStatus.Eligible);
      dlp1Info.stakeAmount.should.eq(dlpEligibilityThreshold + parseEther(1));

      await rootStaking.connect(user1).closeStakes([2]);

      const stake2 = await rootStaking.stakes(2);
      stake2.id.should.eq(2);
      stake2.stakerAddress.should.eq(user1);
      stake2.dlpId.should.eq(1);
      stake2.amount.should.eq(parseEther(1));
      stake2.startBlock.should.eq(currentBlockNumber + 1);
      stake2.endBlock.should.eq(currentBlockNumber + 2);
      stake2.withdrawn.should.eq(false);
      stake2.lastClaimedEpochId.should.eq(0);

      dlp1Info = await rootCore.dlps(1);
      dlp1Info.status.should.eq(DlpStatus.Eligible);
      dlp1Info.stakeAmount.should.eq(dlpEligibilityThreshold);

      (await rootCore.eligibleDlpsListValues()).should.deep.eq([1n]);
    });

    it("should closeStake and keep dlp status (subEligible)", async function () {
      await rootCore.connect(dlp1Owner).registerDlp(dlpInfo[1], {
        value: dlpEligibilityThreshold - parseEther(1) - parseEther(2),
      });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      const currentBlockNumber = await getCurrentBlockNumber();

      await rootStaking.connect(user1).createStake(1, { value: parseEther(1) });

      await rootStaking.connect(user2).createStake(1, { value: parseEther(2) });

      let dlp1Info = await rootCore.dlps(1);
      dlp1Info.status.should.eq(DlpStatus.Eligible);
      dlp1Info.stakeAmount.should.eq(dlpEligibilityThreshold);

      await rootStaking.connect(user1).closeStakes([2]);

      const stake2 = await rootStaking.stakes(2);
      stake2.id.should.eq(2);
      stake2.stakerAddress.should.eq(user1);
      stake2.dlpId.should.eq(1);
      stake2.amount.should.eq(parseEther(1));
      stake2.startBlock.should.eq(currentBlockNumber + 1);
      stake2.endBlock.should.eq(currentBlockNumber + 3);
      stake2.withdrawn.should.eq(false);
      stake2.lastClaimedEpochId.should.eq(0);

      dlp1Info = await rootCore.dlps(1);
      dlp1Info.status.should.eq(DlpStatus.SubEligible);
      dlp1Info.stakeAmount.should.eq(dlpEligibilityThreshold - parseEther(1));

      (await rootCore.eligibleDlpsListValues()).should.deep.eq([1n]);

      await rootStaking.connect(user2).closeStakes([3]);

      const stake3 = await rootStaking.stakes(3);
      stake3.id.should.eq(3);
      stake3.stakerAddress.should.eq(user2);
      stake3.dlpId.should.eq(1);
      stake3.amount.should.eq(parseEther(2));
      stake3.startBlock.should.eq(currentBlockNumber + 2);
      stake3.endBlock.should.eq(currentBlockNumber + 4);
      stake3.withdrawn.should.eq(false);
      stake3.lastClaimedEpochId.should.eq(0);

      dlp1Info = await rootCore.dlps(1);
      dlp1Info.status.should.eq(DlpStatus.SubEligible);
      dlp1Info.stakeAmount.should.eq(
        dlpEligibilityThreshold - parseEther(1) - parseEther(2),
      );

      (await rootCore.eligibleDlpsListValues()).should.deep.eq([1n]);
    });
  });

  describe("Withdraw stake", () => {
    beforeEach(async () => {
      await deploy();

      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);
    });

    it("should withdrawStake after delay period", async function () {
      const stakeAmount = parseEther(10);
      const user1InitialBalance = await ethers.provider.getBalance(user1);

      const blockNumber = await getCurrentBlockNumber();
      const tx1 = await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount });
      const receipt1 = await getReceipt(tx1);
      const tx2 = await rootStaking.connect(user1).closeStakes([2]);
      const receipt2 = await getReceipt(tx2);

      await advanceBlockNTimes(stakeWithdrawalDelay);

      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        dlpEligibilityThreshold + stakeAmount,
      );

      const tx3 = await rootStaking.connect(user1).withdrawStakes([2]);
      const receipt3 = await getReceipt(tx3);

      await tx3.should.emit(rootStaking, "StakeWithdrawn").withArgs(2);

      const stake = await rootStaking.stakes(2);
      stake.startBlock.should.eq(blockNumber + 1);
      stake.endBlock.should.eq(blockNumber + 2);
      stake.withdrawn.should.eq(true);

      const dlp1Info = await rootCore.dlps(1);
      dlp1Info.stakeAmount.should.eq(dlpEligibilityThreshold);

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance - receipt1.fee - receipt2.fee - receipt3.fee,
      );

      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        dlpEligibilityThreshold,
      );
    });

    it("should withdraw multiple stakes in one call", async function () {
      const stakeAmount1 = parseEther(10);
      const stakeAmount2 = parseEther(15);
      const user1InitialBalance = await ethers.provider.getBalance(user1);

      const tx1 = await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount1 });
      const receipt1 = await getReceipt(tx1);
      const tx2 = await rootStaking
        .connect(user1)
        .createStake(1, { value: stakeAmount2 });
      const receipt2 = await getReceipt(tx2);

      const tx3 = await rootStaking.connect(user1).closeStakes([2, 3]);
      const receipt3 = await getReceipt(tx3);

      await advanceBlockNTimes(stakeWithdrawalDelay);

      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        dlpEligibilityThreshold + stakeAmount1 + stakeAmount2,
      );

      const tx4 = await rootStaking.connect(user1).withdrawStakes([2, 3]);
      const receipt4 = await getReceipt(tx4);

      await tx4.should
        .emit(rootStaking, "StakeWithdrawn")
        .withArgs(2)
        .and.emit(rootStaking, "StakeWithdrawn")
        .withArgs(3);

      const stake2 = await rootStaking.stakes(2);
      stake2.withdrawn.should.eq(true);

      const stake3 = await rootStaking.stakes(3);
      stake3.withdrawn.should.eq(true);

      const dlp1Info = await rootCore.dlps(1);
      dlp1Info.stakeAmount.should.eq(dlpEligibilityThreshold);

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance -
          receipt1.fee -
          receipt2.fee -
          receipt3.fee -
          receipt4.fee,
      );
      (await ethers.provider.getBalance(stakesTreasury)).should.eq(
        dlpEligibilityThreshold,
      );
    });

    it("should create missing epochs when withdrawStake", async function () {
      const stakeAmount = parseEther(10);
      await rootStaking.connect(user1).createStake(1, { value: stakeAmount });
      await rootStaking.connect(user1).closeStakes([2]);

      await advanceToEpochN(5);
      (await rootEpoch.epochsCount()).should.eq(0);

      await advanceBlockNTimes(stakeWithdrawalDelay);

      const tx = await rootStaking.connect(user1).withdrawStakes([2]);

      const epoch1 = await rootEpoch.epochs(1);
      const epoch2 = await rootEpoch.epochs(2);
      const epoch3 = await rootEpoch.epochs(3);
      const epoch4 = await rootEpoch.epochs(4);
      const epoch5 = await rootEpoch.epochs(5);

      await tx.should
        .emit(rootStaking, "StakeWithdrawn")
        .withArgs(2)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(1, epoch1.startBlock, epoch1.endBlock, epoch1.rewardAmount)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(2, epoch2.startBlock, epoch2.endBlock, epoch2.rewardAmount)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(3, epoch3.startBlock, epoch3.endBlock, epoch3.rewardAmount)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(4, epoch4.startBlock, epoch4.endBlock, epoch4.rewardAmount)
        .and.emit(rootEpoch, "EpochCreated")
        .withArgs(5, epoch5.startBlock, epoch5.endBlock, epoch5.rewardAmount);

      (await rootEpoch.epochsCount()).should.eq(5);
    });

    it("should reject withdrawStake when not stake owner", async function () {
      const stakeAmount = parseEther(10);
      await rootStaking.connect(user1).createStake(1, { value: stakeAmount });
      await rootStaking.connect(user1).closeStakes([2]);

      await advanceBlockNTimes(stakeWithdrawalDelay);

      await rootStaking
        .connect(user2)
        .withdrawStakes([2])
        .should.be.rejectedWith("NotStakeOwner()");
    });

    it("should reject withdrawStake when already withdrawn", async function () {
      const stakeAmount = parseEther(10);
      await rootStaking.connect(user1).createStake(1, { value: stakeAmount });
      await rootStaking.connect(user1).closeStakes([2]);

      await advanceBlockNTimes(stakeWithdrawalDelay);

      await rootStaking.connect(user1).withdrawStakes([2]);
      await rootStaking
        .connect(user1)
        .withdrawStakes([2])
        .should.be.rejectedWith("StakeAlreadyWithdrawn()");
    });

    it("should reject withdrawStake when not closed", async function () {
      const stakeAmount = parseEther(10);
      await rootStaking.connect(user1).createStake(1, { value: stakeAmount });

      await advanceBlockNTimes(stakeWithdrawalDelay);

      await rootStaking
        .connect(user1)
        .withdrawStakes([2])
        .should.be.rejectedWith("StakeNotClosed()");
    });

    it("should reject withdrawStake when withdrawal delay not passed", async function () {
      const stakeAmount = parseEther(10);
      await rootStaking.connect(user1).createStake(1, { value: stakeAmount });
      await rootStaking.connect(user1).closeStakes([2]);

      await advanceBlockNTimes(stakeWithdrawalDelay - 5);

      await rootStaking
        .connect(user1)
        .withdrawStakes([2])
        .should.be.rejectedWith("StakeWithdrawalTooEarly()");
    });

    it("should withdraw stake after delay update", async function () {
      const stakeAmount = parseEther(10);
      await rootStaking.connect(user1).createStake(1, { value: stakeAmount });
      await rootStaking.connect(user1).closeStakes([2]);

      const newDelay = stakeWithdrawalDelay + 50;
      await rootStaking
        .connect(maintainer)
        .updateStakeWithdrawalDelay(newDelay);

      await advanceBlockNTimes(stakeWithdrawalDelay);

      await rootStaking
        .connect(user1)
        .withdrawStakes([2])
        .should.be.rejectedWith("StakeWithdrawalTooEarly()");

      await advanceBlockNTimes(50);

      const tx = await rootStaking.connect(user1).withdrawStakes([2]);
      await tx.should.emit(rootStaking, "StakeWithdrawn").withArgs(2);
    });
  });

  describe("TopDlps", () => {
    const minDlpRegistrationStake = 100;

    beforeEach(async () => {
      await deploy();

      await rootStaking
        .connect(owner)
        .updateMinStakeAmount(minDlpRegistrationStake);
      await rootCore
        .connect(owner)
        .updateMinDlpRegistrationStake(minDlpRegistrationStake);
      await rootCore
        .connect(owner)
        .updateDlpEligibilityThresholds(
          minDlpRegistrationStake,
          minDlpRegistrationStake,
        );
    });

    const topDlpTests = [
      { dlpsCount: 0, epochDlpsLimit: 16 },
      { dlpsCount: 1, epochDlpsLimit: 1 },
      { dlpsCount: 2, epochDlpsLimit: 2 },
      { dlpsCount: 3, epochDlpsLimit: 3 },
      { dlpsCount: 16, epochDlpsLimit: 16 },
      { dlpsCount: 32, epochDlpsLimit: 32 },
      { dlpsCount: 2, epochDlpsLimit: 1 },
      { dlpsCount: 3, epochDlpsLimit: 1 },
      { dlpsCount: 16, epochDlpsLimit: 1 },
      { dlpsCount: 32, epochDlpsLimit: 1 },
      { dlpsCount: 1, epochDlpsLimit: 16 },
      { dlpsCount: 2, epochDlpsLimit: 16 },
      { dlpsCount: 3, epochDlpsLimit: 16 },
      { dlpsCount: 16, epochDlpsLimit: 16 },
      { dlpsCount: 30, epochDlpsLimit: 16 },
      { dlpsCount: 40, epochDlpsLimit: 16 },
      { dlpsCount: 50, epochDlpsLimit: 16 },
      { dlpsCount: 60, epochDlpsLimit: 16 },
      { dlpsCount: 100, epochDlpsLimit: 16 },
      { dlpsCount: 200, epochDlpsLimit: 16 },
      // { dlpsCount: 300, epochDlpsLimit: 16 },
      // { dlpsCount: 500, epochDlpsLimit: 16 },
      // { dlpsCount: 500, epochDlpsLimit: 32 },
    ];

    topDlpTests.forEach((test) => {
      it(`should set topDlps when creating new epoch (dlpsCount = ${test.dlpsCount},  epochDlpsLimit = ${test.epochDlpsLimit})`, async () => {
        await rootEpoch.connect(owner).updateEpochSize(2000);
        await advanceToEpochN(1);

        await rootEpoch.connect(owner).createEpochs();

        const dlpStakes = generateStakes(test.dlpsCount, 1000n, 5000n);

        await registerNDlps(dlpStakes);
        await rootEpoch
          .connect(owner)
          .updateEpochDlpsLimit(test.epochDlpsLimit);

        const topKDlpIdsExpected = getTopKStakes(
          dlpStakes,
          test.epochDlpsLimit,
        );

        (await rootMetrics.topDlpIds(test.epochDlpsLimit)).should.deep.eq(
          topKDlpIdsExpected,
        );

        await advanceBlockNTimes(2 * 2000); //epoch3
        await rootEpoch.connect(owner).createEpochs();
        await saveDefaultEpochPerformanceRatings(2);

        const epoch = await rootEpoch.epochs(2);
        epoch.dlpIds.should.deep.eq(topKDlpIdsExpected);

        topKDlpIdsExpected.forEach(async (dlpId) => {
          (await rootEpoch.epochDlps(2, dlpId)).stakeAmount.should.eq(
            dlpStakes[dlpId - 1],
          );
        });
      });
    });

    it(`should set topDlps when creating new epoch after dlpOwner staking`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(2);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(1);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);
      (await rootEpoch.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await rootStaking.connect(dlp1Owner).createStake(1, { value: 350n });

      await advanceToEpochN(3);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(2);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 1, 4]);
      (await rootEpoch.epochs(2)).dlpIds.should.deep.eq([5, 1, 4]);

      (await rootEpoch.epochDlps(2, 1)).stakeAmount.should.eq(450n);
      (await rootEpoch.epochDlps(2, 1)).isTopDlp.should.eq(true);

      (await rootEpoch.epochDlps(2, 2)).stakeAmount.should.eq(200);
      (await rootEpoch.epochDlps(2, 2)).isTopDlp.should.eq(false);

      (await rootEpoch.epochDlps(2, 3)).stakeAmount.should.eq(300);
      (await rootEpoch.epochDlps(2, 3)).isTopDlp.should.eq(false);

      (await rootEpoch.epochDlps(2, 4)).stakeAmount.should.eq(400);
      (await rootEpoch.epochDlps(2, 4)).isTopDlp.should.eq(true);

      (await rootEpoch.epochDlps(2, 5)).stakeAmount.should.eq(500);
      (await rootEpoch.epochDlps(2, 5)).isTopDlp.should.eq(true);
    });

    it(`should set topDlps when creating new epoch after user staking`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(2);
      await rootEpoch.connect(owner).createEpochs();

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);

      await saveDefaultEpochPerformanceRatings(1);
      (await rootEpoch.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await rootStaking.connect(user1).createStake(1, { value: 350n });

      await advanceToEpochN(3);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(2);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 1, 4]);
      (await rootEpoch.epochs(2)).dlpIds.should.deep.eq([5, 1, 4]);

      (await rootEpoch.epochDlps(2, 1)).stakeAmount.should.eq(450n);
      (await rootEpoch.epochDlps(2, 1)).isTopDlp.should.eq(true);

      (await rootEpoch.epochDlps(2, 2)).stakeAmount.should.eq(200);
      (await rootEpoch.epochDlps(2, 2)).isTopDlp.should.eq(false);

      (await rootEpoch.epochDlps(2, 3)).stakeAmount.should.eq(300);
      (await rootEpoch.epochDlps(2, 3)).isTopDlp.should.eq(false);

      (await rootEpoch.epochDlps(2, 4)).stakeAmount.should.eq(400);
      (await rootEpoch.epochDlps(2, 4)).isTopDlp.should.eq(true);

      (await rootEpoch.epochDlps(2, 5)).stakeAmount.should.eq(500);
      (await rootEpoch.epochDlps(2, 5)).isTopDlp.should.eq(true);
    });

    it(`should set topDlps when creating new epoch after unstaking`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(2);
      await rootEpoch.connect(owner).createEpochs();

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);

      await saveDefaultEpochPerformanceRatings(1);
      (await rootEpoch.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await rootStaking.connect(dlp1Owner).closeStakes([4]);

      await advanceToEpochN(4);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(3);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 3, 2]);
      (await rootEpoch.epochs(3)).dlpIds.should.deep.eq([5, 3, 2]);

      (await rootEpoch.epochDlps(3, 1)).stakeAmount.should.eq(100);
      (await rootEpoch.epochDlps(3, 1)).isTopDlp.should.eq(false);

      (await rootEpoch.epochDlps(3, 2)).stakeAmount.should.eq(200);
      (await rootEpoch.epochDlps(3, 2)).isTopDlp.should.eq(true);

      (await rootEpoch.epochDlps(3, 3)).stakeAmount.should.eq(300);
      (await rootEpoch.epochDlps(3, 3)).isTopDlp.should.eq(true);

      (await rootEpoch.epochDlps(3, 4)).stakeAmount.should.eq(0);
      (await rootEpoch.epochDlps(3, 4)).isTopDlp.should.eq(false);

      (await rootEpoch.epochDlps(3, 5)).stakeAmount.should.eq(500);
      (await rootEpoch.epochDlps(3, 5)).isTopDlp.should.eq(true);
    });

    it(`should set topDlps when creating new epoch after unstaking #2`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(2);
      await rootEpoch.connect(owner).createEpochs();

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);

      await saveDefaultEpochPerformanceRatings(1);
      (await rootEpoch.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await rootStaking.connect(dlp1Owner).closeStakes([2]);
      await rootStaking.connect(dlp1Owner).closeStakes([3]);
      await rootStaking.connect(dlp1Owner).closeStakes([4]);

      await advanceToEpochN(4);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(3);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 1]);
      (await rootEpoch.epochs(3)).dlpIds.should.deep.eq([5, 1]);

      (await rootEpoch.epochDlps(3, 1)).stakeAmount.should.eq(100);
      (await rootEpoch.epochDlps(3, 1)).isTopDlp.should.eq(true);

      (await rootEpoch.epochDlps(3, 2)).stakeAmount.should.eq(0);
      (await rootEpoch.epochDlps(3, 2)).isTopDlp.should.eq(false);

      (await rootEpoch.epochDlps(3, 3)).stakeAmount.should.eq(0);
      (await rootEpoch.epochDlps(3, 3)).isTopDlp.should.eq(false);

      (await rootEpoch.epochDlps(3, 4)).stakeAmount.should.eq(0);
      (await rootEpoch.epochDlps(3, 4)).isTopDlp.should.eq(false);

      (await rootEpoch.epochDlps(3, 5)).stakeAmount.should.eq(500);
      (await rootEpoch.epochDlps(3, 5)).isTopDlp.should.eq(true);
    });

    it(`should set topDlps when creating new epoch after registering new DLPs`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(2);
      await rootEpoch.connect(owner).createEpochs();

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);

      await saveDefaultEpochPerformanceRatings(1);
      (await rootEpoch.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await registerNDlps([100n, 600n]);

      await advanceToEpochN(6);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(5);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([7, 5, 4]);
      (await rootEpoch.epochs(5)).dlpIds.should.deep.eq([7, 5, 4]);
    });

    it(`should set topDlps when creating new epoch after a DLP deregisters`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(2);
      await rootEpoch.connect(owner).createEpochs();

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);

      await saveDefaultEpochPerformanceRatings(1);
      (await rootEpoch.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await rootCore.connect(dlp1Owner).deregisterDlp(4);

      await advanceToEpochN(3);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(2);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 3, 2]);
      (await rootEpoch.epochs(2)).dlpIds.should.deep.eq([5, 3, 2]);
    });

    it(`should set topDlps when creating new epoch after updating the maximum number of DLPs #updateEpochDlpsLimit`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(2);
      await rootEpoch.connect(owner).createEpochs();

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);

      await saveDefaultEpochPerformanceRatings(1);
      (await rootEpoch.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await rootEpoch.connect(owner).updateEpochDlpsLimit(2);

      await advanceToEpochN(3);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(2);

      (await rootMetrics.topDlpIds(2)).should.deep.eq([5, 4]);
      (await rootEpoch.epochs(2)).dlpIds.should.deep.eq([5, 4]);

      await rootEpoch.connect(owner).updateEpochDlpsLimit(4);

      await advanceToEpochN(4);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(3);

      (await rootMetrics.topDlpIds(4)).should.deep.eq([5, 4, 3, 2]);
      (await rootEpoch.epochs(3)).dlpIds.should.deep.eq([5, 4, 3, 2]);
    });

    it(`should set topDlps when creating new epoch #staking, unstaking, registration, deregistration, updateEpochDlpsLimit`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(2);
      await rootEpoch.connect(owner).createEpochs();

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);

      await saveDefaultEpochPerformanceRatings(1);
      (await rootEpoch.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await rootStaking.connect(dlp1Owner).createStake(1, { value: 350n });

      await advanceToEpochN(3);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(2);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 1, 4]);
      (await rootEpoch.epochs(2)).dlpIds.should.deep.eq([5, 1, 4]);

      await rootCore.connect(dlp1Owner).deregisterDlp(5);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([1, 4, 3]);

      await advanceToEpochN(4);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(3);

      (await rootMetrics.topDlpIds(epochDlpsLimit)).should.deep.eq([1, 4, 3]);
      (await rootEpoch.epochs(3)).dlpIds.should.deep.eq([1, 4, 3]);

      await rootEpoch.connect(owner).updateEpochDlpsLimit(2);

      await advanceToEpochN(5);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(4);

      (await rootMetrics.topDlpIds(2)).should.deep.eq([1, 4]);
      (await rootEpoch.epochs(4)).dlpIds.should.deep.eq([1, 4]);

      await registerNDlps([100n, 600n]);

      await advanceToEpochN(6);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(5);

      (await rootMetrics.topDlpIds(2)).should.deep.eq([7, 1]);
      (await rootEpoch.epochs(5)).dlpIds.should.deep.eq([7, 1]);

      await rootEpoch.connect(owner).updateEpochDlpsLimit(4);

      await advanceToEpochN(7);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(6);

      (await rootMetrics.topDlpIds(4)).should.deep.eq([7, 1, 4, 3]);
      (await rootEpoch.epochs(6)).dlpIds.should.deep.eq([7, 1, 4, 3]);

      await rootStaking.connect(dlp1Owner).closeStakes([1]);

      await advanceToEpochN(8);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(7);

      (await rootMetrics.topDlpIds(4)).should.deep.eq([7, 4, 1, 3]);
      (await rootEpoch.epochs(7)).dlpIds.should.deep.eq([7, 4, 1, 3]);
    });
  });

  describe("Save epoch DLPs total stakes score", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should saveEpochDlpsTotalStakesScore and emit event", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();
      await advanceToEpochN(2);

      const stakeScores = [
        {
          epochId: 1,
          dlpId: 1,
          totalStakesScore: parseEther(100),
        },
      ];

      const tx = await rootEpoch
        .connect(manager)
        .saveEpochDlpsTotalStakesScore(stakeScores);

      await tx.should
        .emit(rootEpoch, "EpochDlpScoreSaved")
        .withArgs(1, 1, parseEther(100));

      const dlp1Epoch1 = await rootEpoch.epochDlps(1, 1);
      dlp1Epoch1.totalStakesScore.should.eq(parseEther(100));
    });

    it("should reject saveEpochDlpsTotalStakesScore when non-manager", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();

      const stakeScores = [
        {
          epochId: 1,
          dlpId: 1,
          totalStakesScore: parseEther(100),
        },
      ];

      await rootEpoch
        .connect(user1)
        .saveEpochDlpsTotalStakesScore(stakeScores)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MANAGER_ROLE}")`,
        );
    });

    it("should reject saveEpochDlpsTotalStakesScore for unregistered dlpId", async function () {
      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();
      await advanceToEpochN(2);

      const stakeScores = [
        {
          epochId: 1,
          dlpId: 999,
          totalStakesScore: parseEther(100),
        },
      ];

      await rootEpoch
        .connect(manager)
        .saveEpochDlpsTotalStakesScore(stakeScores)
        .should.be.rejectedWith("InvalidDlpId()");
    });

    it("should reject saveEpochDlpsTotalStakesScore for future epochs", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();

      const stakeScores = [
        {
          epochId: 2,
          dlpId: 1,
          totalStakesScore: parseEther(100),
        },
      ];

      await rootEpoch
        .connect(manager)
        .saveEpochDlpsTotalStakesScore(stakeScores)
        .should.be.rejectedWith("EpochNotEnded()");
    });

    it("should reject saveEpochDlpsTotalStakesScore when score already exists", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();
      await advanceToEpochN(2);

      // First save
      await rootEpoch.connect(manager).saveEpochDlpsTotalStakesScore([
        {
          epochId: 1,
          dlpId: 1,
          totalStakesScore: parseEther(100),
        },
      ]);

      // Second save attempt
      await rootEpoch
        .connect(manager)
        .saveEpochDlpsTotalStakesScore([
          {
            epochId: 1,
            dlpId: 1,
            totalStakesScore: parseEther(200),
          },
        ])
        .should.be.rejectedWith("EpochDlpScoreAlreadySaved()");

      // Verify original score remains
      const dlp1Epoch1 = await rootEpoch.epochDlps(1, 1);
      dlp1Epoch1.totalStakesScore.should.eq(parseEther(100));
    });

    it("should saveEpochDlpsTotalStakesScore for multiple valid scores", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await rootCore
        .connect(dlp2Owner)
        .registerDlp(dlpInfo[2], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(2);
      await rootEpoch.connect(owner).createEpochs();
      await advanceToEpochN(3);

      const stakeScores = [
        {
          epochId: 1,
          dlpId: 1,
          totalStakesScore: parseEther(100),
        },
        {
          epochId: 1,
          dlpId: 2,
          totalStakesScore: parseEther(200),
        },
        {
          epochId: 2,
          dlpId: 1,
          totalStakesScore: parseEther(300),
        },
      ];

      const tx = await rootEpoch
        .connect(manager)
        .saveEpochDlpsTotalStakesScore(stakeScores);

      await tx.should
        .emit(rootEpoch, "EpochDlpScoreSaved")
        .withArgs(1, 1, parseEther(100))
        .and.emit(rootEpoch, "EpochDlpScoreSaved")
        .withArgs(1, 2, parseEther(200))
        .and.emit(rootEpoch, "EpochDlpScoreSaved")
        .withArgs(2, 1, parseEther(300));

      const dlp1Epoch1 = await rootEpoch.epochDlps(1, 1);
      dlp1Epoch1.totalStakesScore.should.eq(parseEther(100));

      const dlp2Epoch1 = await rootEpoch.epochDlps(1, 2);
      dlp2Epoch1.totalStakesScore.should.eq(parseEther(200));

      const dlp1Epoch2 = await rootEpoch.epochDlps(2, 1);
      dlp1Epoch2.totalStakesScore.should.eq(parseEther(300));
    });

    it("should reject saveEpochDlpsTotalStakesScore when any score in batch is invalid", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();
      await advanceToEpochN(2);

      const stakeScores = [
        {
          epochId: 1,
          dlpId: 1,
          totalStakesScore: parseEther(100),
        },
        {
          epochId: 1,
          dlpId: 999,
          totalStakesScore: parseEther(200),
        },
      ];

      await rootEpoch
        .connect(manager)
        .saveEpochDlpsTotalStakesScore(stakeScores)
        .should.be.rejectedWith("InvalidDlpId()");

      const dlp1Epoch1 = await rootEpoch.epochDlps(1, 1);
      dlp1Epoch1.totalStakesScore.should.eq(0);
    });

    it("should saveEpochDlpsTotalStakesScore for deregistered DLPs past epochs", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();
      await rootCore.connect(dlp1Owner).deregisterDlp(1);
      await advanceToEpochN(2);

      const stakeScores = [
        {
          epochId: 1,
          dlpId: 1,
          totalStakesScore: parseEther(100),
        },
      ];

      const tx = await rootEpoch
        .connect(manager)
        .saveEpochDlpsTotalStakesScore(stakeScores);

      await tx.should
        .emit(rootEpoch, "EpochDlpScoreSaved")
        .withArgs(1, 1, parseEther(100));

      const dlp1Epoch1 = await rootEpoch.epochDlps(1, 1);
      dlp1Epoch1.totalStakesScore.should.eq(parseEther(100));
    });

    it("should overrideEpochDlpsTotalStakesScore for new score and emit event", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();
      await advanceToEpochN(2);

      const stakeScore = {
        epochId: 1,
        dlpId: 1,
        totalStakesScore: parseEther(100),
      };

      const tx = await rootEpoch
        .connect(maintainer)
        .overrideEpochDlpsTotalStakesScore(stakeScore);

      await tx.should
        .emit(rootEpoch, "EpochDlpScoreSaved")
        .withArgs(1, 1, parseEther(100));

      const dlp1Epoch1 = await rootEpoch.epochDlps(1, 1);
      dlp1Epoch1.totalStakesScore.should.eq(parseEther(100));
    });

    it("should reject overrideEpochDlpsTotalStakesScore when called by non-maintainer", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();

      const stakeScore = {
        epochId: 1,
        dlpId: 1,
        totalStakesScore: parseEther(100),
      };

      await rootEpoch
        .connect(user1)
        .overrideEpochDlpsTotalStakesScore(stakeScore)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
        );
    });

    it("should reject overrideEpochDlpsTotalStakesScore for unregistered DLP ID", async function () {
      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();
      await advanceToEpochN(2);

      const stakeScore = {
        epochId: 1,
        dlpId: 999,
        totalStakesScore: parseEther(100),
      };

      await rootEpoch
        .connect(maintainer)
        .overrideEpochDlpsTotalStakesScore(stakeScore)
        .should.be.rejectedWith("InvalidDlpId()");
    });

    it("should reject overrideEpochDlpsTotalStakesScore for future epochs", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();

      const stakeScore = {
        epochId: 2,
        dlpId: 1,
        totalStakesScore: parseEther(100),
      };

      await rootEpoch
        .connect(maintainer)
        .overrideEpochDlpsTotalStakesScore(stakeScore)
        .should.be.rejectedWith("EpochNotEnded()");
    });

    it("should overrideEpochDlpsTotalStakesScore for existing score and emit event", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();
      await advanceToEpochN(2);

      // First save
      await rootEpoch.connect(manager).saveEpochDlpsTotalStakesScore([
        {
          epochId: 1,
          dlpId: 1,
          totalStakesScore: parseEther(100),
        },
      ]);

      // Override existing score
      const tx = await rootEpoch
        .connect(maintainer)
        .overrideEpochDlpsTotalStakesScore({
          epochId: 1,
          dlpId: 1,
          totalStakesScore: parseEther(200),
        });

      await tx.should
        .emit(rootEpoch, "EpochDlpScoreSaved")
        .withArgs(1, 1, parseEther(200));

      const dlp1Epoch1 = await rootEpoch.epochDlps(1, 1);
      dlp1Epoch1.totalStakesScore.should.eq(parseEther(200));
    });

    it("should overrideEpochDlpsTotalStakesScore with same value and emit event", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();
      await advanceToEpochN(2);

      // First save
      await rootEpoch.connect(manager).saveEpochDlpsTotalStakesScore([
        {
          epochId: 1,
          dlpId: 1,
          totalStakesScore: parseEther(100),
        },
      ]);

      // Override with same value
      const tx = await rootEpoch
        .connect(maintainer)
        .overrideEpochDlpsTotalStakesScore({
          epochId: 1,
          dlpId: 1,
          totalStakesScore: parseEther(100),
        });

      await tx.should
        .emit(rootEpoch, "EpochDlpScoreSaved")
        .withArgs(1, 1, parseEther(100));

      const dlp1Epoch1 = await rootEpoch.epochDlps(1, 1);
      dlp1Epoch1.totalStakesScore.should.eq(parseEther(100));
    });

    it("should overrideEpochDlpsTotalStakesScore for zero value and emit event", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();
      await advanceToEpochN(2);

      // First save non-zero value
      await rootEpoch.connect(manager).saveEpochDlpsTotalStakesScore([
        {
          epochId: 1,
          dlpId: 1,
          totalStakesScore: parseEther(100),
        },
      ]);

      // Override with zero
      const tx = await rootEpoch
        .connect(maintainer)
        .overrideEpochDlpsTotalStakesScore({
          epochId: 1,
          dlpId: 1,
          totalStakesScore: 0,
        });

      await tx.should.emit(rootEpoch, "EpochDlpScoreSaved").withArgs(1, 1, 0);

      const dlp1Epoch1 = await rootEpoch.epochDlps(1, 1);
      dlp1Epoch1.totalStakesScore.should.eq(0);
    });

    it("should overrideEpochDlpsTotalStakesScore for deregistered DLPs past epochs", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();
      await rootCore.connect(dlp1Owner).deregisterDlp(1);
      await advanceToEpochN(2);

      const stakeScore = {
        epochId: 1,
        dlpId: 1,
        totalStakesScore: parseEther(100),
      };

      const tx = await rootEpoch
        .connect(maintainer)
        .overrideEpochDlpsTotalStakesScore(stakeScore);

      await tx.should
        .emit(rootEpoch, "EpochDlpScoreSaved")
        .withArgs(1, 1, parseEther(100));

      const dlp1Epoch1 = await rootEpoch.epochDlps(1, 1);
      dlp1Epoch1.totalStakesScore.should.eq(parseEther(100));
    });
  });

  describe("Calculate stake score", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should calculateStakeScore return correct values for 0-86 days", async function () {
      const stakeAmount = parseEther(100);
      const startBlock = 1000;

      for (let day = 0; day <= 86; day++) {
        const endBlock = startBlock + day * daySize;
        const actualScore = await rootStaking.calculateStakeScore(
          stakeAmount,
          startBlock,
          endBlock,
        );
        const expectedScore = (stakeAmount * getMultiplier(day)) / 10000n;

        actualScore.should.eq(expectedScore, `Score mismatch for day ${day}`);

        expectedScore.should.eq(
          calculateStakeScore(stakeAmount, startBlock, endBlock),
          `Score mismatch for day ${day}`,
        );
      }
    });

    it("should calculateStakeScore same block", async function () {
      const stakeAmount = parseEther(100);
      const currentBlock = await getCurrentBlockNumber();

      const score = await rootStaking.calculateStakeScore(
        stakeAmount,
        currentBlock,
        currentBlock,
      );

      // Same block means 0 days
      score.should.eq(calculateStakeScoreByDay(stakeAmount, 0));
    });

    it("should calculateStakeScore for less than one day", async function () {
      const stakeAmount = parseEther(100);
      const startBlock = 1000;
      const endBlock = startBlock + daySize - 1;

      const score = await rootStaking.calculateStakeScore(
        stakeAmount,
        startBlock,
        endBlock,
      );

      score.should.eq((stakeAmount * 476n) / 10000n);
      score.should.eq(calculateStakeScoreByDay(stakeAmount, 0));
    });

    it("should calculateStakeScore for exactly one day", async function () {
      const stakeAmount = parseEther(100);
      const startBlock = 1000;
      const endBlock = startBlock + daySize;

      const score = await rootStaking.calculateStakeScore(
        stakeAmount,
        startBlock,
        endBlock,
      );

      score.should.eq(calculateStakeScoreByDay(stakeAmount, 1));
      score.should.eq((stakeAmount * 952n) / 10000n);

      score.should.eq(calculateStakeScore(stakeAmount, startBlock, endBlock));
    });

    it("should calculateStakeScore for one week", async function () {
      const stakeAmount = parseEther(100);
      const startBlock = 1000;
      const endBlock = startBlock + daySize * 7;

      const score = await rootStaking.calculateStakeScore(
        stakeAmount,
        startBlock,
        endBlock,
      );

      score.should.eq((stakeAmount * 3809n) / 10000n);

      score.should.eq(calculateStakeScore(stakeAmount, startBlock, endBlock));
      score.should.eq(calculateStakeScoreByDay(stakeAmount, 7));
    });

    it("should calculateStakeScore for 20 days", async function () {
      const stakeAmount = parseEther(100);
      const startBlock = 1000;
      const endBlock = startBlock + daySize * 20;

      const score = await rootStaking.calculateStakeScore(
        stakeAmount,
        startBlock,
        endBlock,
      );

      score.should.eq(stakeAmount);

      score.should.eq(calculateStakeScore(stakeAmount, startBlock, endBlock));
      score.should.eq(calculateStakeScoreByDay(stakeAmount, 20));
    });

    it("should calculateStakeScore for maximum multiplier", async function () {
      const stakeAmount = parseEther(100);
      const startBlock = 1000;
      const endBlock = startBlock + daySize * 84; // Above maximum days

      const score = await rootStaking.calculateStakeScore(
        stakeAmount,
        startBlock,
        endBlock,
      );

      // More than 63 days should use maximum multiplier = 300
      score.should.eq((stakeAmount * 30000n) / 10000n);

      score.should.eq(calculateStakeScore(stakeAmount, startBlock, endBlock));
    });

    it("should calculateStakeScore with fractional days", async function () {
      const stakeAmount = parseEther(100);
      const startBlock = 1000;
      const endBlock = startBlock + daySize + daySize / 2; // 1.5 days

      const score = await rootStaking.calculateStakeScore(
        stakeAmount,
        startBlock,
        endBlock,
      );

      score.should.eq((stakeAmount * 952n) / 10000n);

      score.should.eq(calculateStakeScore(stakeAmount, startBlock, endBlock));
    });

    it("should calculateStakeScore with zero stake amount", async function () {
      const startBlock = 1000;
      const endBlock = startBlock + daySize * 10;

      const score = await rootStaking.calculateStakeScore(
        0,
        startBlock,
        endBlock,
      );

      // Zero amount should give zero score regardless of time
      score.should.eq(0);
    });

    it("should calculateStakeScore with small stake amounts", async function () {
      const stakeAmount = parseEther("0.0001");
      const startBlock = 1000;
      const endBlock = startBlock + daySize * 50; // 50 days

      const score = await rootStaking.calculateStakeScore(
        stakeAmount,
        startBlock,
        endBlock,
      );

      // 30 days staked should use multiplier = 204n
      score.should.eq((stakeAmount * 204n) / 100n);

      score.should.eq(calculateStakeScore(stakeAmount, startBlock, endBlock));
    });

    it("should calculateStakeScore with large stake amounts", async function () {
      const stakeAmount = parseEther("1000000"); // 1 million
      const startBlock = 1000;
      const endBlock = startBlock + daySize * 50; // 50 days

      const score = await rootStaking.calculateStakeScore(
        stakeAmount,
        startBlock,
        endBlock,
      );

      // 30 days staked should use multiplier = 204n
      score.should.eq((stakeAmount * 204n) / 100n);
    });
  });

  describe("Claim stakes reward - rewardClaimDelay = 0", () => {
    const initialRewardsTreasuryBalance = parseEther(100);
    const epochSizeInDays = epochSize / daySize;

    beforeEach(async () => {
      await deploy();

      await rootStaking.connect(owner).updateRewardClaimDelay(0);
      await rootStaking;
      // .connect(owner)
      // .updateMinDlpStakersPercentage(minDlpStakersPercentage);

      await owner.sendTransaction({
        to: rewardsTreasury,
        value: initialRewardsTreasuryBalance,
      });
    });

    it("should claimStakesReward", async function () {
      await advanceToEpochN(1);
      const stakerPercentage = parseEther(60);
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(
          { ...dlpInfo[1], stakersPercentage: stakerPercentage },
          { value: dlpEligibilityThreshold },
        );

      await rootCore.connect(maintainer).updateDlpVerification(1, true);
      // Create stake
      const stakeAmount = dlpEligibilityThreshold * 2n;
      await rootStaking.connect(user1).createStake(1, { value: stakeAmount });

      // Advance to include stake in epoch rewards
      await advanceToEpochN(3);
      await rootEpoch.connect(owner).createEpochs();

      await saveDefaultEpochPerformanceRatings(1);

      (await rootEpoch.epochs(1)).dlpIds.should.deep.eq([1]);

      const stake1 = await rootStaking.stakes(1);
      const stake2 = await rootStaking.stakes(2);

      const epoch1 = await rootEpoch.epochs(1);
      await rootEpoch.connect(manager).saveEpochDlpsTotalStakesScore([
        {
          epochId: 1,
          dlpId: 1,
          totalStakesScore:
            calculateStakeScore(
              dlpEligibilityThreshold,
              stake1.startBlock,
              epoch1.endBlock,
              true,
            ) + //first stake from the dlp owner
            calculateStakeScore(
              stakeAmount,
              stake2.startBlock,
              epoch1.endBlock,
              true,
            ),
        },
      ]);

      const userBalanceBefore = await ethers.provider.getBalance(user1);

      const dlp1Epoch1Reward = epochRewardAmount;
      const dlp1Epoch1StakersReward =
        (dlp1Epoch1Reward * stakerPercentage) / parseEther(100);
      const stake2ExpectedClaimableAmount = (dlp1Epoch1StakersReward * 2n) / 3n;

      const stake2ClaimableAmount =
        await rootStaking.calculateStakeClaimableAmount.staticCall(2);

      (await rootEpoch.epochDlps(1, 1)).ownerRewardAmount.should.eq(
        dlp1Epoch1Reward - dlp1Epoch1StakersReward,
      );
      (await rootEpoch.epochDlps(1, 1)).stakersRewardAmount.should.eq(
        dlp1Epoch1StakersReward,
      );
      (await rootEpoch.epochDlps(1, 1)).stakeAmount.should.eq(
        3n * dlpEligibilityThreshold,
      );

      stake2ClaimableAmount.should.eq(stake2ExpectedClaimableAmount);
      stake2ClaimableAmount.should.eq(parseEther(0.8));

      const tx = await rootStaking.connect(user1).claimStakesReward([2]);
      const receipt = await getReceipt(tx);

      // Verify stake was claimed
      const stake = await rootStaking.stakes(2);
      stake.lastClaimedEpochId.should.eq(1);

      // User should receive reward minus gas
      (await ethers.provider.getBalance(user1)).should.eq(
        userBalanceBefore + stake2ExpectedClaimableAmount - receipt.fee,
      );
    });

    it("should reject claimStakesReward when paused", async function () {
      await rootCore
        .connect(dlp1Owner)
        .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });

      await rootCore.connect(maintainer).updateDlpVerification(1, true);

      await rootStaking
        .connect(user1)
        .createStake(1, { value: parseEther(100) });

      await advanceToEpochN(1);
      await rootEpoch.connect(owner).createEpochs();
      await advanceBlockNTimes(rewardClaimDelay);

      await rootStaking.connect(maintainer).pause();

      await rootStaking
        .connect(user1)
        .claimStakesReward([2])
        .should.be.rejectedWith("EnforcedPause()");
    });
  });

  describe("DLPRootMetrics", () => {
    beforeEach(async () => {
      await deploy();
    });

    describe("Setup", () => {
      it("should have correct params after deploy", async function () {
        (await rootMetrics.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(true);
        (await rootMetrics.hasRole(MAINTAINER_ROLE, owner)).should.eq(true);
        (await rootMetrics.hasRole(MANAGER_ROLE, owner)).should.eq(true);
        (await rootMetrics.hasRole(MAINTAINER_ROLE, maintainer)).should.eq(
          true,
        );
        (await rootMetrics.hasRole(MANAGER_ROLE, manager)).should.eq(true);
        (await rootMetrics.version()).should.eq(1);
        (await rootMetrics.dlpRoot()).should.eq(rootStaking);
        (await rootMetrics.ratingPercentages(RatingType.Stake)).should.eq(
          stakeRatingPercentage,
        );
        (await rootMetrics.ratingPercentages(RatingType.Performance)).should.eq(
          performanceRatingPercentage,
        );
      });

      it("should change admin", async function () {
        await rootMetrics
          .connect(owner)
          .grantRole(MAINTAINER_ROLE, user1.address).should.not.be.rejected;

        await rootMetrics
          .connect(owner)
          .grantRole(DEFAULT_ADMIN_ROLE, user1.address).should.be.fulfilled;

        await rootMetrics
          .connect(user1)
          .revokeRole(DEFAULT_ADMIN_ROLE, owner.address);

        await rootMetrics
          .connect(owner)
          .grantRole(DEFAULT_ADMIN_ROLE, user2.address)
          .should.rejectedWith(
            `AccessControlUnauthorizedAccount("${owner.address}", "${DEFAULT_ADMIN_ROLE}`,
          );

        await rootMetrics
          .connect(user1)
          .grantRole(DEFAULT_ADMIN_ROLE, user2.address).should.be.fulfilled;
      });

      it("should updateDlpRoot when maintainer", async function () {
        await rootMetrics.connect(maintainer).updateDlpRoot(user1);

        (await rootMetrics.dlpRoot()).should.eq(user1);
      });

      it("should reject updateDlpRoot when non-maintainer", async function () {
        await rootMetrics
          .connect(manager)
          .updateDlpRoot(user1)
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${manager.address}", "${MAINTAINER_ROLE}")`,
          );

        (await rootMetrics.dlpRoot()).should.eq(rootStaking);
      });

      it("Should upgradeTo when owner", async function () {
        await upgrades.upgradeProxy(
          rootMetrics,
          await ethers.getContractFactory(
            "DLPRootMetricsImplementationV2Mock",
            owner,
          ),
        );

        const newRoot = await ethers.getContractAt(
          "DLPRootMetricsImplementationV2Mock",
          rootMetrics,
        );
        (await newRoot.version()).should.eq(2);

        (await newRoot.test()).should.eq("test");
      });

      it("Should upgradeTo when owner and emit event", async function () {
        const newRootImplementation = await ethers.deployContract(
          "DLPRootMetricsImplementationV2Mock",
        );

        await rootMetrics
          .connect(owner)
          .upgradeToAndCall(newRootImplementation, "0x")
          .should.emit(rootMetrics, "Upgraded")
          .withArgs(newRootImplementation);

        const newRoot = await ethers.getContractAt(
          "DLPRootMetricsImplementationV2Mock",
          rootMetrics,
        );

        (await newRoot.version()).should.eq(2);

        (await newRoot.test()).should.eq("test");
      });

      it("Should reject upgradeTo when storage layout is incompatible", async function () {
        await upgrades
          .upgradeProxy(
            rootMetrics,
            await ethers.getContractFactory(
              "DLPRootMetricsImplementationV3Mock",
              owner,
            ),
          )
          .should.be.rejectedWith("New storage layout is incompatible");
      });

      it("Should reject upgradeTo when non owner", async function () {
        const newRootImplementation = await ethers.deployContract(
          "DLPRootMetricsImplementationV2Mock",
        );

        await rootMetrics
          .connect(user1)
          .upgradeToAndCall(newRootImplementation, "0x")
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
          );
      });
    });

    describe("SaveEpochPerformanceRatings ", () => {
      it("should saveEpochPerformanceRatings", async function () {
        await register5Dlps();

        await advanceToEpochN(1);
        await rootEpoch.connect(owner).createEpochs();

        await rootMetrics
          .connect(manager)
          .saveEpochPerformanceRatings(1, [
            {
              dlpId: 1n,
              performanceRating: parseEther(100),
            },
            {
              dlpId: 2n,
              performanceRating: parseEther(200),
            },
            {
              dlpId: 3n,
              performanceRating: parseEther(300),
            },
            {
              dlpId: 4n,
              performanceRating: parseEther(400),
            },
            {
              dlpId: 5n,
              performanceRating: parseEther(500),
            },
          ])
          .should.emit(rootMetrics, "EpochPerformanceRatingsSaved")
          .withArgs(1, parseEther(1500), false)
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 1, parseEther(100))
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 2, parseEther(200))
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 3, parseEther(300))
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 4, parseEther(400))
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 5, parseEther(500));

        const epoch = await rootMetrics.epochs(1);
        epoch.totalPerformanceRating.should.eq(parseEther(1500));

        const epoch1Dlp1 = await rootMetrics.epochDlps(1, 1);
        epoch1Dlp1.performanceRating.should.eq(parseEther(100));

        const epoch1Dlp2 = await rootMetrics.epochDlps(1, 2);
        epoch1Dlp2.performanceRating.should.eq(parseEther(200));

        const epoch1Dlp3 = await rootMetrics.epochDlps(1, 3);
        epoch1Dlp3.performanceRating.should.eq(parseEther(300));

        const epoch1Dlp4 = await rootMetrics.epochDlps(1, 4);
        epoch1Dlp4.performanceRating.should.eq(parseEther(400));

        const epoch1Dlp5 = await rootMetrics.epochDlps(1, 5);
        epoch1Dlp5.performanceRating.should.eq(parseEther(500));
      });

      xit("should saveEpochPerformanceRatings after epoch.endBlock", async function () {
        await rootEpoch.connect(owner).updateEpochDlpsLimit(3);
        await rootCore
          .connect(owner)
          .updateDlpStakersPercentages(parseEther(40), parseEther(80));

        const dlp1StakersPercentage = parseEther(40);
        const dlp2StakersPercentage = parseEther(60);
        const dlp3StakersPercentage = parseEther(50);
        const dlp4StakersPercentage = parseEther(50);
        const dlp5StakersPercentage = parseEther(70);

        await registerNDlpsExtended(
          [
            parseEther(100),
            parseEther(200),
            parseEther(300),
            parseEther(400),
            parseEther(500),
          ],
          [
            dlp1StakersPercentage,
            dlp2StakersPercentage,
            dlp3StakersPercentage,
            dlp4StakersPercentage,
            dlp5StakersPercentage,
          ],
        );

        await advanceToEpochN(2);
        await rootEpoch.connect(owner).createEpochs();

        const tx = await rootMetrics
          .connect(manager)
          .saveEpochPerformanceRatings(1, [
            {
              dlpId: 1n,
              performanceRating: parseEther(0.7),
            },
            {
              dlpId: 2n,
              performanceRating: parseEther(0.2),
            },
            {
              dlpId: 3n,
              performanceRating: parseEther(0.05),
            },
            {
              dlpId: 4n,
              performanceRating: parseEther(0),
            },
            {
              dlpId: 5n,
              performanceRating: parseEther(0.05),
            },
          ]);

        tx.should
          .emit(rootMetrics, "EpochPerformanceRatingsSaved")
          .withArgs(1, parseEther(1), false)
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 1, parseEther(0.7))
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 2, parseEther(0.2))
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 3, parseEther(0.05))
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 4, parseEther(0.0))
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 5, parseEther(0.05));

        await rootMetrics.connect(manager).finalizeEpoch(1);

        const epoch = await rootMetrics.epochs(1);
        epoch.totalPerformanceRating.should.eq(
          parseEther(0.7 + 0.2 + 0.05 + 0.05),
        );

        const epoch1Dlp1 = await rootMetrics.epochDlps(1, 1);
        epoch1Dlp1.performanceRating.should.eq(parseEther(0.7));

        const epoch1Dlp2 = await rootMetrics.epochDlps(1, 2);
        epoch1Dlp2.performanceRating.should.eq(parseEther(0.2));

        const epoch1Dlp3 = await rootMetrics.epochDlps(1, 3);
        epoch1Dlp3.performanceRating.should.eq(parseEther(0.05));

        const epoch1Dlp4 = await rootMetrics.epochDlps(1, 4);
        epoch1Dlp4.performanceRating.should.eq(parseEther(0));

        const epoch1Dlp5 = await rootMetrics.epochDlps(1, 5);
        epoch1Dlp5.performanceRating.should.eq(parseEther(0.05));

        const top5Dlps = await rootMetrics.topDlpsCustomized(
          1,
          5,
          [1, 2, 3, 4, 5],
          [],
        );
        const top3Dlps = await rootMetrics.topDlpsCustomized(
          1,
          3,
          [1, 2, 3, 4, 5],
          [],
        );

        top3Dlps.should.deep.eq(top5Dlps.slice(0, 3));

        const totalStakeAmount = parseEther(100 + 200 + 300 + 400 + 500);
        const totalPerformanceRating = parseEther(0.7 + 0.2 + 0.05 + 0.05);

        top5Dlps[0].dlpId.should.eq(5);
        top5Dlps[0].rating.should.closeTo(
          ((stakeRatingPercentage * parseEther(500)) / totalStakeAmount +
            (performanceRatingPercentage * parseEther(0.05)) /
              totalPerformanceRating) /
            100n,
          10,
        );

        top5Dlps[1].dlpId.should.eq(4);
        top5Dlps[1].rating.should.closeTo(
          ((stakeRatingPercentage * parseEther(400)) / totalStakeAmount +
            (performanceRatingPercentage * parseEther(0)) /
              totalPerformanceRating) /
            100n,
          10,
        );

        top5Dlps[2].dlpId.should.eq(1);
        top5Dlps[2].rating.should.closeTo(
          ((stakeRatingPercentage * parseEther(100)) / totalStakeAmount +
            (performanceRatingPercentage * parseEther(0.7)) /
              totalPerformanceRating) /
            100n,
          10,
        );

        top5Dlps[3].dlpId.should.eq(3);
        top5Dlps[3].rating.should.closeTo(
          ((stakeRatingPercentage * parseEther(300)) / totalStakeAmount +
            (performanceRatingPercentage * parseEther(0.05)) /
              totalPerformanceRating) /
            100n,
          10,
        );

        top5Dlps[4].dlpId.should.eq(2);
        top5Dlps[4].rating.should.closeTo(
          ((stakeRatingPercentage * parseEther(200)) / totalStakeAmount +
            (performanceRatingPercentage * parseEther(0.2)) /
              totalPerformanceRating) /
            100n,
          10,
        );

        const top3DlpsTotalRating = top3Dlps.reduce(
          (acc, dlp) => acc + dlp.rating,
          0n,
        );

        const rootDlp1Epoch1 = await rootEpoch.epochDlps(1, 1);
        const rootDlp2Epoch1 = await rootEpoch.epochDlps(1, 2);
        const rootDlp3Epoch1 = await rootEpoch.epochDlps(1, 3);
        const rootDlp4Epoch1 = await rootEpoch.epochDlps(1, 4);
        const rootDlp5Epoch1 = await rootEpoch.epochDlps(1, 5);

        rootDlp1Epoch1.stakersRewardAmount.should.closeTo(
          (top5Dlps[2].rating * epochRewardAmount * dlp1StakersPercentage) /
            top3DlpsTotalRating /
            parseEther(100),
          10,
        );
        rootDlp2Epoch1.stakersRewardAmount.should.eq(0n);
        rootDlp3Epoch1.stakersRewardAmount.should.eq(0n);
        rootDlp4Epoch1.stakersRewardAmount.should.closeTo(
          (top5Dlps[1].rating * epochRewardAmount * dlp4StakersPercentage) /
            top3DlpsTotalRating /
            parseEther(100),
          10,
        );
        rootDlp5Epoch1.stakersRewardAmount.should.closeTo(
          (top5Dlps[0].rating * epochRewardAmount * dlp5StakersPercentage) /
            top3DlpsTotalRating /
            parseEther(100),
          10,
        );

        const totalStakersRewardAmount =
          rootDlp1Epoch1.stakersRewardAmount +
          rootDlp4Epoch1.stakersRewardAmount +
          rootDlp5Epoch1.stakersRewardAmount;

        const totalDlpCreatorsRewardAmount =
          epochRewardAmount - totalStakersRewardAmount;

        rootDlp1Epoch1.ownerRewardAmount.should.closeTo(
          (top5Dlps[2].rating *
            epochRewardAmount *
            (parseEther(100) - dlp1StakersPercentage)) /
            top3DlpsTotalRating /
            parseEther(100),
          10,
        );
        rootDlp2Epoch1.ownerRewardAmount.should.eq(0n);
        rootDlp3Epoch1.ownerRewardAmount.should.eq(0n);
        rootDlp4Epoch1.ownerRewardAmount.should.closeTo(
          (top5Dlps[1].rating *
            epochRewardAmount *
            (parseEther(100) - dlp4StakersPercentage)) /
            top3DlpsTotalRating /
            parseEther(100),
          10,
        );
        rootDlp5Epoch1.ownerRewardAmount.should.closeTo(
          (top5Dlps[0].rating *
            epochRewardAmount *
            (parseEther(100) - dlp5StakersPercentage)) /
            top3DlpsTotalRating /
            parseEther(100),
          10,
        );

        (
          rootDlp1Epoch1.ownerRewardAmount +
          rootDlp1Epoch1.stakersRewardAmount +
          rootDlp4Epoch1.ownerRewardAmount +
          rootDlp4Epoch1.stakersRewardAmount +
          rootDlp5Epoch1.ownerRewardAmount +
          rootDlp5Epoch1.stakersRewardAmount
        ).should.closeTo(epochRewardAmount, 10);
      });

      it("should saveEpochPerformanceRatings after epoch.endBlock, 100 dlps", async function () {
        await rootEpoch.connect(owner).updateEpochDlpsLimit(16);
        await rootCore
          .connect(owner)
          .updateDlpEligibilityThresholds(parseEther(1), parseEther(1));

        await registerNDlps(generateStakes(200, parseEther(1), parseEther(2)));

        await advanceToEpochN(3);
        await rootEpoch.connect(owner).createEpochs();

        await saveDefaultEpochPerformanceRatings(1);
      });

      function sqrt(value: bigint): bigint {
        if (value < 0n) {
          throw new Error("Square root of negative numbers is not supported");
        }
        if (value < 2n) {
          return value;
        }

        let left = 0n;
        let right = value;
        let result = 0n;

        while (left <= right) {
          const mid = left + (right - left) / 2n;
          const square = mid * mid;

          if (square === value) {
            return mid;
          }

          if (square < value) {
            left = mid + 1n;
            result = mid; // Track the last valid answer
          } else {
            right = mid - 1n;
          }
        }

        return result;
      }

      xit("should saveEpochPerformanceRatings for 500 dlps", async function () {
        const numberOfDlps = 500;
        const stakes = generateStakes(
          numberOfDlps,
          parseEther(1),
          parseEther(2),
        );

        await registerNDlps(stakes);

        const epochPerformanceRatings: DlpPerformanceRating[] = [];

        for (let i = 1; i <= numberOfDlps; i++) {
          epochPerformanceRatings.push({
            dlpId: BigInt(i),
            performanceRating: parseEther(i),
          });
        }

        const tx = await rootMetrics
          .connect(manager)
          .saveEpochPerformanceRatings(1, epochPerformanceRatings);
        const receipt = await getReceipt(tx);

        const dlpEpochPerformanceRatingSavedLogs = receipt.logs
          .map((log) => {
            try {
              return rootMetrics.interface.parseLog(log);
            } catch (e) {
              // If the log doesn't match the contract ABI, ignore it
              return null;
            }
          })
          .filter(
            (parsedLog) =>
              parsedLog && parsedLog.name === "DlpEpochPerformanceRatingSaved",
          );

        dlpEpochPerformanceRatingSavedLogs.length.should.eq(numberOfDlps);

        receipt.should
          .emit(rootMetrics, "EpochPerformanceRatingsSaved")
          .withArgs(1, parseEther((1 + 500) * 250), false)
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 1, parseEther(1))
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 2, parseEther(2))
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 100, parseEther(100))
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 250, parseEther(250))
          .and.emit(rootMetrics, "DlpEpochPerformanceRatingSaved")
          .withArgs(1, 500, parseEther(500));

        const epoch = await rootMetrics.epochs(1);
        epoch.totalPerformanceRating.should.eq(parseEther((1 + 500) * 250));

        const epoch1Dlp1 = await rootMetrics.epochDlps(1, 1);
        epoch1Dlp1.performanceRating.should.eq(parseEther(1));

        const epoch1Dlp2 = await rootMetrics.epochDlps(1, 2);
        epoch1Dlp2.performanceRating.should.eq(parseEther(2));

        const epoch1Dlp100 = await rootMetrics.epochDlps(1, 100);
        epoch1Dlp100.performanceRating.should.eq(parseEther(100));

        const epoch1Dlp250 = await rootMetrics.epochDlps(1, 250);
        epoch1Dlp250.performanceRating.should.eq(parseEther(250));

        const epoch1Dlp500 = await rootMetrics.epochDlps(1, 500);
        epoch1Dlp500.performanceRating.should.eq(parseEther(500));
      });

      it("should reject saveEpochPerformanceRatings when non-manager", async function () {
        await register5Dlps();

        await advanceToEpochN(1);
        await rootEpoch.connect(owner).createEpochs();

        await rootMetrics
          .connect(user1)
          .saveEpochPerformanceRatings(1, [
            {
              dlpId: 1n,
              performanceRating: parseEther(100),
            },
            {
              dlpId: 2n,
              performanceRating: parseEther(200),
            },
            {
              dlpId: 3n,
              performanceRating: parseEther(300),
            },
            {
              dlpId: 4n,
              performanceRating: parseEther(400),
            },
            {
              dlpId: 5n,
              performanceRating: parseEther(500),
            },
          ])
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${user1.address}", "${MANAGER_ROLE}")`,
          );
      });
    });
  });

  describe("DLPRootRewardsTreasury", () => {
    beforeEach(async () => {
      await deploy();
    });

    describe("Setup", () => {
      it("should have correct params after deploy", async function () {
        (await rewardsTreasury.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(
          true,
        );
        (
          await rewardsTreasury.hasRole(DEFAULT_ADMIN_ROLE, rootStaking)
        ).should.eq(true);
        (await rewardsTreasury.version()).should.eq(1);
        (await rewardsTreasury.dlpRoot()).should.eq(rootStaking);
      });

      it("should change admin", async function () {
        await rewardsTreasury
          .connect(owner)
          .grantRole(MAINTAINER_ROLE, user1.address).should.not.be.rejected;

        await rewardsTreasury
          .connect(owner)
          .grantRole(DEFAULT_ADMIN_ROLE, user1.address).should.be.fulfilled;

        await rewardsTreasury
          .connect(user1)
          .revokeRole(DEFAULT_ADMIN_ROLE, owner.address);

        await rewardsTreasury
          .connect(owner)
          .grantRole(DEFAULT_ADMIN_ROLE, user2.address)
          .should.rejectedWith(
            `AccessControlUnauthorizedAccount("${owner.address}", "${DEFAULT_ADMIN_ROLE}`,
          );

        await rewardsTreasury
          .connect(user1)
          .grantRole(DEFAULT_ADMIN_ROLE, user2.address).should.be.fulfilled;
      });

      it("should updateDlpRoot when maintainer", async function () {
        await rewardsTreasury.connect(owner).updateDlpRoot(user1);

        (await rewardsTreasury.dlpRoot()).should.eq(user1);
      });

      it("should reject updateDlpRoot when non-maintainer", async function () {
        await rewardsTreasury
          .connect(manager)
          .updateDlpRoot(user1)
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${manager.address}", "${DEFAULT_ADMIN_ROLE}")`,
          );

        (await rewardsTreasury.dlpRoot()).should.eq(rootStaking);
      });

      it("Should upgradeTo when owner", async function () {
        await upgrades.upgradeProxy(
          rewardsTreasury,
          await ethers.getContractFactory(
            "DLPRootTreasuryImplementationV2Mock",
            owner,
          ),
        );

        const newRoot = await ethers.getContractAt(
          "DLPRootTreasuryImplementationV2Mock",
          rewardsTreasury,
        );
        (await newRoot.version()).should.eq(2);

        (await newRoot.test()).should.eq("test");
      });

      it("Should upgradeTo when owner and emit event", async function () {
        const newRootImplementation = await ethers.deployContract(
          "DLPRootTreasuryImplementationV2Mock",
        );

        await rewardsTreasury
          .connect(owner)
          .upgradeToAndCall(newRootImplementation, "0x")
          .should.emit(rewardsTreasury, "Upgraded")
          .withArgs(newRootImplementation);

        const newRoot = await ethers.getContractAt(
          "DLPRootTreasuryImplementationV2Mock",
          rewardsTreasury,
        );

        (await newRoot.version()).should.eq(2);

        (await newRoot.test()).should.eq("test");
      });

      it("Should reject upgradeTo when storage layout is incompatible", async function () {
        await upgrades
          .upgradeProxy(
            rewardsTreasury,
            await ethers.getContractFactory(
              "DLPRootTreasuryImplementationV3Mock",
              owner,
            ),
          )
          .should.be.rejectedWith("New storage layout is incompatible");
      });

      it("Should reject upgradeTo when non owner", async function () {
        const newRootImplementation = await ethers.deployContract(
          "DLPRootTreasuryImplementationV2Mock",
        );

        await rewardsTreasury
          .connect(user1)
          .upgradeToAndCall(newRootImplementation, "0x")
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
          );
      });
    });

    describe("Receive ", () => {
      it("should receive", async function () {
        await owner.sendTransaction({
          to: rewardsTreasury,
          value: parseEther(1),
        });

        (await ethers.provider.getBalance(rewardsTreasury)).should.eq(
          parseEther(1),
        );
      });
    });

    describe("Transfer Vana ", () => {
      it("should transferVana when owner", async function () {
        await owner.sendTransaction({
          to: rewardsTreasury,
          value: parseEther(1),
        });

        (await ethers.provider.getBalance(rewardsTreasury)).should.eq(
          parseEther(1),
        );

        const user1InitialBalance = await ethers.provider.getBalance(user1);
        await rewardsTreasury
          .connect(owner)
          .transferVana(user1, parseEther(0.4));

        (await ethers.provider.getBalance(rewardsTreasury)).should.eq(
          parseEther(0.6),
        );

        (await ethers.provider.getBalance(user1)).should.eq(
          user1InitialBalance + parseEther(0.4),
        );
      });

      it("should not transferVana when non-owner", async function () {
        await rewardsTreasury
          .connect(manager)
          .transferVana(user1, parseEther(0.4))
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${manager.address}", "${DEFAULT_ADMIN_ROLE}")`,
          );
        await rewardsTreasury
          .connect(maintainer)
          .transferVana(user1, parseEther(0.4))
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${maintainer.address}", "${DEFAULT_ADMIN_ROLE}")`,
          );
        await rewardsTreasury
          .connect(user1)
          .transferVana(user1, parseEther(0.4))
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
          );
      });
    });
  });

  describe("DLPRootStakesTreasury", () => {
    beforeEach(async () => {
      await deploy();
    });

    describe("Setup", () => {
      it("should have correct params after deploy", async function () {
        (await stakesTreasury.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(
          true,
        );
        (
          await stakesTreasury.hasRole(DEFAULT_ADMIN_ROLE, rootStaking)
        ).should.eq(true);
        (await stakesTreasury.version()).should.eq(1);
        (await stakesTreasury.dlpRoot()).should.eq(rootStaking);
      });

      it("should change admin", async function () {
        await stakesTreasury
          .connect(owner)
          .grantRole(MAINTAINER_ROLE, user1.address).should.not.be.rejected;

        await stakesTreasury
          .connect(owner)
          .grantRole(DEFAULT_ADMIN_ROLE, user1.address).should.be.fulfilled;

        await stakesTreasury
          .connect(user1)
          .revokeRole(DEFAULT_ADMIN_ROLE, owner.address);

        await stakesTreasury
          .connect(owner)
          .grantRole(DEFAULT_ADMIN_ROLE, user2.address)
          .should.rejectedWith(
            `AccessControlUnauthorizedAccount("${owner.address}", "${DEFAULT_ADMIN_ROLE}`,
          );

        await stakesTreasury
          .connect(user1)
          .grantRole(DEFAULT_ADMIN_ROLE, user2.address).should.be.fulfilled;
      });

      it("should updateDlpRoot when maintainer", async function () {
        await stakesTreasury.connect(owner).updateDlpRoot(user1);

        (await stakesTreasury.dlpRoot()).should.eq(user1);
      });

      it("should reject updateDlpRoot when non-maintainer", async function () {
        await stakesTreasury
          .connect(manager)
          .updateDlpRoot(user1)
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${manager.address}", "${DEFAULT_ADMIN_ROLE}")`,
          );

        (await stakesTreasury.dlpRoot()).should.eq(rootStaking);
      });

      it("Should upgradeTo when owner", async function () {
        await upgrades.upgradeProxy(
          stakesTreasury,
          await ethers.getContractFactory(
            "DLPRootTreasuryImplementationV2Mock",
            owner,
          ),
        );

        const newRoot = await ethers.getContractAt(
          "DLPRootTreasuryImplementationV2Mock",
          stakesTreasury,
        );
        (await newRoot.version()).should.eq(2);

        (await newRoot.test()).should.eq("test");
      });

      it("Should upgradeTo when owner and emit event", async function () {
        const newRootImplementation = await ethers.deployContract(
          "DLPRootTreasuryImplementationV2Mock",
        );

        await stakesTreasury
          .connect(owner)
          .upgradeToAndCall(newRootImplementation, "0x")
          .should.emit(stakesTreasury, "Upgraded")
          .withArgs(newRootImplementation);

        const newRoot = await ethers.getContractAt(
          "DLPRootTreasuryImplementationV2Mock",
          stakesTreasury,
        );

        (await newRoot.version()).should.eq(2);

        (await newRoot.test()).should.eq("test");
      });

      it("Should reject upgradeTo when storage layout is incompatible", async function () {
        await upgrades
          .upgradeProxy(
            stakesTreasury,
            await ethers.getContractFactory(
              "DLPRootTreasuryImplementationV3Mock",
              owner,
            ),
          )
          .should.be.rejectedWith("New storage layout is incompatible");
      });

      it("Should reject upgradeTo when non owner", async function () {
        const newRootImplementation = await ethers.deployContract(
          "DLPRootTreasuryImplementationV2Mock",
        );

        await stakesTreasury
          .connect(user1)
          .upgradeToAndCall(newRootImplementation, "0x")
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
          );
      });
    });

    describe("Receive ", () => {
      it("should receive", async function () {
        await owner.sendTransaction({
          to: stakesTreasury,
          value: parseEther(1),
        });

        (await ethers.provider.getBalance(stakesTreasury)).should.eq(
          parseEther(1),
        );
      });
    });

    describe("Transfer Vana ", () => {
      it("should transferVana when owner", async function () {
        await owner.sendTransaction({
          to: stakesTreasury,
          value: parseEther(1),
        });

        (await ethers.provider.getBalance(stakesTreasury)).should.eq(
          parseEther(1),
        );

        const user1InitialBalance = await ethers.provider.getBalance(user1);
        await stakesTreasury
          .connect(owner)
          .transferVana(user1, parseEther(0.4));

        (await ethers.provider.getBalance(stakesTreasury)).should.eq(
          parseEther(0.6),
        );

        (await ethers.provider.getBalance(user1)).should.eq(
          user1InitialBalance + parseEther(0.4),
        );
      });

      it("should not transferVana when non-owner", async function () {
        await stakesTreasury
          .connect(manager)
          .transferVana(user1, parseEther(0.4))
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${manager.address}", "${DEFAULT_ADMIN_ROLE}")`,
          );
        await stakesTreasury
          .connect(maintainer)
          .transferVana(user1, parseEther(0.4))
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${maintainer.address}", "${DEFAULT_ADMIN_ROLE}")`,
          );
        await stakesTreasury
          .connect(user1)
          .transferVana(user1, parseEther(0.4))
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
          );
      });
    });
  });
});
