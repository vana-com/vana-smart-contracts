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

  let root: DLPRootImplementation;
  let metrics: DLPRootMetricsImplementation;
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
      [owner.address, daySize],
      {
        kind: "uups",
      },
    );

    root = await ethers.getContractAt(
      "DLPRootImplementation",
      dlpRootDeploy.target,
    );

    await root.connect(owner).grantRole(MAINTAINER_ROLE, owner);
    await root.connect(owner).grantRole(MANAGER_ROLE, owner);

    await root.connect(owner).updateTrustedForwarder(trustedForwarder);
    await root.connect(owner).updateEpochDlpsLimit(epochDlpsLimit);
    await root
      .connect(owner)
      .updateDlpStakersPercentages(
        minDlpStakersPercentage,
        maxDlpStakersPercentage,
      );
    await root
      .connect(owner)
      .updateDlpEligibilityThresholds(
        dlpSubEligibilityThreshold,
        dlpEligibilityThreshold,
      );
    await root
      .connect(owner)
      .updateMinDlpRegistrationStake(minDlpRegistrationStake);
    await root.connect(owner).updateMinStakeAmount(minStakeAmount);
    await root.connect(owner).updateStakeWithdrawalDelay(stakeWithdrawalDelay);
    await root.connect(owner).updateRewardClaimDelay(rewardClaimDelay);
    await root.connect(owner).updateEpochSize(epochSize);
    await root.connect(owner).updateEpochRewardAmount(epochRewardAmount);

    await root.connect(owner).overrideEpoch(0, 0, startBlock - 1, 0);

    const dlpRootMetricsDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DLPRootMetricsImplementation"),
      [
        trustedForwarder.address,
        owner.address,
        root.target,
        stakeRatingPercentage,
        performanceRatingPercentage,
      ],
      {
        kind: "uups",
      },
    );

    metrics = await ethers.getContractAt(
      "DLPRootMetricsImplementation",
      dlpRootMetricsDeploy.target,
    );

    const dlpRootRewardsTreasuryDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DLPRootTreasuryImplementation"),
      [owner.address, root.target],
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
      [owner.address, root.target],
      {
        kind: "uups",
      },
    );

    stakesTreasury = await ethers.getContractAt(
      "DLPRootTreasuryImplementation",
      dlpRootStakesTreasuryDeploy.target,
    );

    await root.connect(owner).grantRole(MAINTAINER_ROLE, maintainer);
    await root.connect(owner).grantRole(MANAGER_ROLE, manager);

    //after deploy

    await root.connect(owner).updateDlpRootMetrics(metrics);
    await root.connect(owner).updateDlpRootRewardsTreasury(rewardsTreasury);
    await root.connect(owner).updateDlpRootStakesTreasury(stakesTreasury);
    await metrics.connect(owner).grantRole(MAINTAINER_ROLE, maintainer);
    await metrics.connect(owner).grantRole(MANAGER_ROLE, manager);

    await root.connect(owner).grantRole(DLP_ROOT_METRICS_ROLE, metrics);

    await metrics.connect(owner).grantRole(DLP_ROOT_ROLE, root); /////////
    await metrics.connect(maintainer).updateFoundationWalletAddress(foundation); /////////
  };

  async function advanceToEpochN(epochNumber: number) {
    const epochNStartBlock = startBlock + (epochNumber - 1) * epochSize;

    await advanceToBlockN(epochNStartBlock);
  }

  async function register5Dlps() {
    await root
      .connect(dlp1Owner)
      .registerDlp(dlpInfo[1], { value: dlpEligibilityThreshold });
    await root
      .connect(dlp2Owner)
      .registerDlp(dlpInfo[2], { value: dlpEligibilityThreshold });

    await root
      .connect(dlp3Owner)
      .registerDlp(dlpInfo[3], { value: dlpEligibilityThreshold });

    await root
      .connect(dlp4Owner)
      .registerDlp(dlpInfo[4], { value: dlpEligibilityThreshold });

    await root
      .connect(dlp5Owner)
      .registerDlp(dlpInfo[5], { value: dlpEligibilityThreshold });

    await root.connect(maintainer).updateDlpVerificationBlock(1, true);
    await root.connect(maintainer).updateDlpVerificationBlock(2, true);
    await root.connect(maintainer).updateDlpVerificationBlock(3, true);
    await root.connect(maintainer).updateDlpVerificationBlock(4, true);
    await root.connect(maintainer).updateDlpVerificationBlock(5, true);
  }

  async function registerNDlps(stakes: bigint[], verify: boolean = true) {
    const lastDlpId = Number(await root.dlpsCount());
    for (let i = 1; i <= stakes.length; i++) {
      await root.connect(dlp1Owner).registerDlp(
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
        await root
          .connect(maintainer)
          .updateDlpVerificationBlock(lastDlpId + i, true);
    }
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

  describe("Developer tests", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should estimatedDlpRewardPercentages when admin", async function () {
      await registerNDlps([
        parseEther(50),
        parseEther(100),
        parseEther(100),
        parseEther(200),
        parseEther(200),
      ]);
      await advanceToEpochN(1);
      console.log(
        await metrics.estimatedDlpRewardPercentages(
          [1, 2, 3, 4, 5],
          [parseEther(80), parseEther(20)],
        ),
      );
    });
  });

  describe("Developer tests prod", () => {
    const multisigAddress = "0xfd3E61C018Ea22Cea7CB15f35cc968F39dC2c3F4";
    const adminAddress = "0x5ECA5208F29e32879a711467916965B2D753bAf4";
    const developerAddress = "0xe6A285b08E2745Ec75ED70e4fE41e61b390bbB86";
    const rootAddress = "0xff14346dF2B8Fd0c95BF34f1c92e49417b508AD5";
    const metricsAddress = "0xbb532917B6407c060Afd9Cb7d53527eCb91d6662";
    const coreAddress = "0x0aBa5e28228c323A67712101d61a54d4ff5720FD";
    const epochAddress = "0xc3d176cF6BccFCB9225b53B87a95147218e1537F";
    const rewardTreasuryAddress = "0xDBFb6B8b9E2eCAEbdE64d665cD553dB81e524479";
    const stakeTreasuryAddress = "0x52c3260ED5C235fcA43524CF508e29c897318775";
    const foundationAddress = "0xB76D909d8BE3B0E2F137e99530A00c95725e2655";

    let root: DLPRootImplementation;
    let metrics: DLPRootMetricsImplementation;
    let core: DLPRootCoreImplementation;
    let epoch: DLPRootEpochImplementation;

    let adminWallet: HardhatEthersSigner;
    let multisigWallet: HardhatEthersSigner;
    let developerWallet: HardhatEthersSigner;

    beforeEach(async () => {
      await helpers.mine();
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [adminAddress],
      });
      adminWallet = await ethers.provider.getSigner(adminAddress);
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [developerAddress],
      });
      developerWallet = await ethers.provider.getSigner(developerAddress);
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [multisigAddress],
      });
      multisigWallet = await ethers.provider.getSigner(multisigAddress);

      root = await ethers.getContractAt("DLPRootImplementation", rootAddress);
      metrics = await ethers.getContractAt(
        "DLPRootMetricsImplementation",
        metricsAddress,
      );
      core = await ethers.getContractAt(
        "DLPRootCoreImplementation",
        coreAddress,
      );
      epoch = await ethers.getContractAt(
        "DLPRootEpochImplementation",
        epochAddress,
      );
      rewardsTreasury = await ethers.getContractAt(
        "DLPRootTreasuryImplementation",
        rewardTreasuryAddress,
      );
      stakesTreasury = await ethers.getContractAt(
        "DLPRootTreasuryImplementation",
        stakeTreasuryAddress,
      );

      // await multisigWallet.sendTransaction({
      //   to: adminAddress,
      //   value: parseEther(1),
      // });
    });

    it("should debugProduction when admin", async function () {
      console.log(await metrics.ratingPercentages(0));
      console.log(await metrics.ratingPercentages(1));

      await metrics
        .connect(adminWallet)
        .updateRatingPercentages(parseEther(80), parseEther(20));

      console.log(await metrics.ratingPercentages(0));
      console.log(await metrics.ratingPercentages(1));

      const populatedTx =
        await metrics.updateRatingPercentages.populateTransaction(
          ethers.parseEther("100"),
          ethers.parseEther("0"),
        );

      console.log("Bytecode:", populatedTx.data);

      await metrics
        .connect(adminWallet)
        .upgradeToAndCall(
          await ethers.deployContract("DLPRootMetricsImplementation"),
          "0xe4e3cbd50000000000000000000000000000000000000000000000056bc75e2d631000000000000000000000000000000000000000000000000000000000000000000000",
        );

      console.log(await metrics.ratingPercentages(0));
      console.log(await metrics.ratingPercentages(1));

      return;

      const estimatedAPY1 = await root.estimatedDlpRewardPercentages([1, 2, 3]);
      // 83072903752156544050
      // 4779536928206266918

      console.log(estimatedAPY1);
      //log each estimated apy in for
      return;

      const eligibleDlps = await root.eligibleDlpsListValues();
      console.log("eligibleDlps: ", eligibleDlps);

      return;

      const topDlps = await metrics.topDlps(
        1,
        16,
        [1n, 6n, 7n, 8n, 11n, 2n, 9n, 4n, 5n, 10n, 12n, 14n, 15n, 13n, 16n],
        [parseEther(80), parseEther(20)],
      );

      console.log("topDlps: ", topDlps);

      console.log(
        "sum of topDlps rating: ",
        formatEther(topDlps.reduce((acc, dlp) => acc + dlp.rating, 0n)),
      );

      let totalStakedAmount = 0n;
      for (let i = 0; i < topDlps.length; i++) {
        totalStakedAmount += (await root.dlps(topDlps[i].dlpId)).stakeAmount;
      }

      console.log("totalStakedAmount: ", formatEther(totalStakedAmount));

      const estimatedAPY = await root.estimatedDlpRewardPercentages([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      ]);

      console.log(estimatedAPY);
      //log each estimated apy in for loop
      for (let i = 0; i < estimatedAPY.length; i++) {
        console.log(`DLP ${i + 1}: ${formatEther(estimatedAPY[i].APY)}`);
      }
    });

    it("should saveEpochPerformances ", async function () {
      // await metrics
      //   .connect(adminWallet)
      //   .upgradeToAndCall("0x51D975DCB52CC1f8F4d3566C3d2a34180537914B", "0x");

      console.log(
        await metrics.topDlps(
          1,
          16,
          [1n, 6n, 7n, 8n, 11n, 2n, 9n, 4n, 5n, 10n, 12n, 14n, 15n, 13n, 16n],
          [parseEther(80), parseEther(20)],
        ),
      );

      await setBalance(adminAddress, parseEther(100));

      console.log(
        "admin balance",
        formatEther(await ethers.provider.getBalance(adminAddress)),
      );

      // Get root treasury balance before
      const rootTreasuryBefore = await ethers.provider.getBalance(
        await root.dlpRootRewardsTreasury(),
      );
      console.log("Root Treasury Before:", formatEther(rootTreasuryBefore));

      // Get all DLP treasury balances before
      const treasuryBalancesBefore: {
        [key: number]: { address: string; balance: bigint };
      } = {};

      for (let dlpId = 1; dlpId <= 20; dlpId++) {
        const treasuryAddress = (await root.dlps(dlpId)).treasuryAddress;
        const balance = await ethers.provider.getBalance(treasuryAddress);
        treasuryBalancesBefore[dlpId] = {
          address: treasuryAddress,
          balance: balance,
        };
      }

      // Mine blocks
      for (let i = 0; i < 1000; i++) {
        await network.provider.send("evm_mine");
      }
      console.log("after mint");

      // Perform saveEpochPerformanceRatings

      // "1",
      //   "6",
      //   "7",
      //   "8",
      //   "11",
      //   "2",
      //   "9",
      //   "4",
      //   "5",
      //   "10",
      //   "12",
      //   "14",
      //   "15",
      //   "13",
      //   "16";
      await metrics
        .connect(adminWallet)
        .saveEpochPerformanceRatings(1, false, [
          dlpPerformanceRating(1, 0n),
          dlpPerformanceRating(6, 0n),
          dlpPerformanceRating(7, 0n),
          dlpPerformanceRating(8, 0n),
          dlpPerformanceRating(11, 0n),
          dlpPerformanceRating(2, 0n),
          dlpPerformanceRating(9, 0n),
          dlpPerformanceRating(4, 0n),
          dlpPerformanceRating(5, 0n),
          dlpPerformanceRating(10, 0n),
          dlpPerformanceRating(12, 0n),
          dlpPerformanceRating(14, 0n),
          dlpPerformanceRating(15, 0n),
          dlpPerformanceRating(13, 0n),
          dlpPerformanceRating(16, 0n),
        ]);

      console.log("\nafter saveEpochPerformanceRatings");

      // Get root treasury balance after
      const rootTreasuryAfter = await ethers.provider.getBalance(
        await root.dlpRootRewardsTreasury(),
      );
      console.log("Root Treasury After:", formatEther(rootTreasuryAfter));
      console.log(
        "Root Treasury Change:",
        formatEther(rootTreasuryAfter - rootTreasuryBefore),
      );

      // Get and log all DLP treasury balances after
      console.log("\nDLP Treasury Balance Changes:");

      for (let dlpId = 1; dlpId <= 20; dlpId++) {
        const treasuryAddress = (await root.dlps(dlpId)).treasuryAddress;
        const balanceAfter = await ethers.provider.getBalance(treasuryAddress);
        const balanceBefore = treasuryBalancesBefore[dlpId].balance;
        const difference = balanceAfter - balanceBefore;

        console.log(`\nDLP ${dlpId}:`);
        console.log(`  Treasury: ${treasuryAddress}`);
        console.log(`  Before:  ${formatEther(balanceBefore)} ETH`);
        console.log(`  After:   ${formatEther(balanceAfter)} ETH`);
        console.log(`  Change:  ${formatEther(difference)} ETH`);
      }

      for (let dlpId = 1; dlpId <= 20; dlpId++) {
        const dlpEpoch = await root.dlpEpochs(dlpId, 1);
        const dlp = await root.dlps(dlpId);

        console.log(
          "***********************************************************************",
        );
        console.log(`DLP ${dlpId}:  ${dlp.name}`);
        console.log("stakeAmount: ", formatEther(dlpEpoch.stakeAmount));
        console.log("rewardAmount: ", formatEther(dlpEpoch.rewardAmount));
        console.log(
          "stakersRewardAmount: ",
          formatEther(dlpEpoch.stakersRewardAmount),
        );
        console.log("rewardClaimed: ", dlpEpoch.rewardClaimed);
      }

      console.log("\nMetrics contract paused:", await metrics.paused());
    });

    it("should get implementation address", async function () {
      const implementationSlot =
        "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
      const storageValue = await ethers.provider.getStorage(
        metrics,
        implementationSlot,
      );
      const implementationAddress = ethers.getAddress(
        "0x" + storageValue.slice(26),
      );

      console.log("implementationAddress: ", implementationAddress);
    });

    it("should finalizeEpoch", async function () {
      console.log("blockNumber: ", await getCurrentBlockNumber());

      // const epochNumber = await epoch.epochsCount();
      const epochNumber = 5;
      const currentEpoch = await epoch.epochs(epochNumber);

      // await advanceToBlockN(Number(currentEpoch.endBlock) + 1);

      // await metrics.connect(developerWallet).finalizeEpoch(epochNumber);

      let totalRewardAmount = 0n;
      let totalStakersRewardAmount = 0n;
      const dlpsCount = await core.dlpsCount();
      for (let dlpId = 1; dlpId <= dlpsCount; dlpId++) {
        const epochDlp = await epoch.epochDlps(epochNumber, dlpId);
        const dlp = await core.dlps(dlpId);

        const metricEpochDlp = await metrics.epochDlps(epochNumber, dlpId);

        console.log(
          "***********************************************************************",
        );
        console.log(`DLP ${dlpId}:  ${dlp.name}`);
        console.log("status: ", DlpStatus[Number(dlp.status)]);
        console.log("isVerified: ", dlp.isVerified);
        console.log("stakeAmount: ", formatEther(epochDlp.stakeAmount));
        console.log(
          "stakeAmountAdjusted: ",
          formatEther(
            epochDlp.stakeAmount - metricEpochDlp.stakeAmountAdjustment,
          ),
        );

        // console.log(
        //   "performanceRating: ",
        //   formatEther(metricEpochDlp.performanceRating),
        // );

        console.log(
          "stakersPercentage: ",
          formatEther(dlp.stakersPercentageEpoch),
        );
        // console.log(
        //   "totalStakesScore: ",
        //   formatEther(rootDlpEpoch.totalStakesScore),
        // );
        console.log("rewardAmount: ", formatEther(epochDlp.ownerRewardAmount));
        console.log(
          "stakersRewardAmount: ",
          formatEther(epochDlp.stakersRewardAmount),
        );

        totalRewardAmount += epochDlp.ownerRewardAmount;
        totalStakersRewardAmount += epochDlp.stakersRewardAmount;
      }

      console.log("totalRewardAmount: ", formatEther(totalRewardAmount));
      console.log(
        "totalStakersRewardAmount: ",
        formatEther(totalStakersRewardAmount),
      );
      console.log(
        "totalRewardAmounts: ",
        formatEther(totalRewardAmount + totalStakersRewardAmount),
      );

      console.log(
        "foundation wallet balance: ",
        formatEther(await ethers.provider.getBalance(foundationAddress)),
      );
      console.log(
        "rewards treasury balance: ",
        formatEther(
          await ethers.provider.getBalance(await root.dlpRootRewardsTreasury()),
        ),
      );

      return;
    });

    it("should get last epoch results", async function () {
      console.log("blockNumber: ", await getCurrentBlockNumber());

      const lastEpochNumber = (await epoch.epochsCount()) - 1n;

      console.log("lastEpochNumber: ", lastEpochNumber);

      let totalRewardAmount = 0n;
      let totalStakersRewardAmount = 0n;
      const dlpsCount = await core.dlpsCount();
      for (let dlpId = 1; dlpId <= dlpsCount; dlpId++) {
        const epochDlp = await epoch.epochDlps(lastEpochNumber, dlpId);
        const dlp = await core.dlps(dlpId);

        const metricEpochDlp = await metrics.epochDlps(lastEpochNumber, dlpId);

        console.log(
          "***********************************************************************",
        );
        console.log(`DLP ${dlpId}:  ${dlp.name}`);
        console.log("status: ", DlpStatus[Number(dlp.status)]);
        console.log("isVerified: ", dlp.isVerified);
        console.log("stakeAmount: ", formatEther(epochDlp.stakeAmount));
        console.log(
          "stakeAmountAdjusted: ",
          formatEther(
            epochDlp.stakeAmount - metricEpochDlp.stakeAmountAdjustment,
          ),
        );

        // console.log(
        //   "performanceRating: ",
        //   formatEther(metricEpochDlp.performanceRating),
        // );

        console.log(
          "stakersPercentage: ",
          formatEther(dlp.stakersPercentageEpoch),
        );
        // console.log(
        //   "totalStakesScore: ",
        //   formatEther(rootDlpEpoch.totalStakesScore),
        // );
        console.log("rewardAmount: ", formatEther(epochDlp.ownerRewardAmount));
        console.log(
          "stakersRewardAmount: ",
          formatEther(epochDlp.stakersRewardAmount),
        );

        totalRewardAmount += epochDlp.ownerRewardAmount;
        totalStakersRewardAmount += epochDlp.stakersRewardAmount;
      }

      console.log("totalRewardAmount: ", formatEther(totalRewardAmount));
      console.log(
        "totalStakersRewardAmount: ",
        formatEther(totalStakersRewardAmount),
      );
      console.log(
        "totalRewardAmounts: ",
        formatEther(totalRewardAmount + totalStakersRewardAmount),
      );

      console.log(
        "foundation wallet balance: ",
        formatEther(await ethers.provider.getBalance(foundationAddress)),
      );
      console.log(
        "rewards treasury balance: ",
        formatEther(
          await ethers.provider.getBalance(await root.dlpRootRewardsTreasury()),
        ),
      );

      return;
    });

    it("should update root and metrics and callMethod", async function () {
      await root
        .connect(adminWallet)
        .upgradeToAndCall(
          await ethers.deployContract("DLPRootImplementation"),
          "0x",
        );

      const dlpsCount = await root.dlpsCount();
      console.log((await root.epochs(3)).startBlock);
      for (let dlpId = 1; dlpId <= dlpsCount; dlpId++) {
        console.log(
          dlpId,
          ": ",
          await root.dlpStakerPercentageCheckpoints(dlpId),
        );
      }

      await root
        .connect(adminWallet)
        .overrideDlpsStakersPercentages(
          [
            1, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22,
            24, 25,
          ],
          (await root.epochs(3)).startBlock - 100n,
        );

      console.log(" ");
      console.log(" ");
      console.log(" ");
      console.log(" ");
      console.log(" ");
      console.log(" ");

      for (let dlpId = 1; dlpId <= dlpsCount; dlpId++) {
        console.log(
          dlpId,
          ": ",
          await root.dlpStakerPercentageCheckpoints(dlpId),
        );
      }
    });

    it("should impersonate and call method", async function () {
      const caller = await ethers.provider.getSigner(
        "0x7568624847cb263ce58f1641d22625be652f4cf2",
      );
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [caller.address],
      });

      //log balance of treasury
      console.log(
        formatEther(await ethers.provider.getBalance(rewardTreasuryAddress)),
      );

      // console.log(await getCurrentBlockNumber());
      //
      // await root.connect(caller).claimStakeRewardUntilEpoch(22, 60);
      //
      // console.log(
      //   formatEther(await ethers.provider.getBalance(rewardTreasuryAddress)),
      // );
      //
      // await root.connect(caller).claimStakeRewardUntilEpoch(22, 80);
      //
      // console.log(
      //   formatEther(await ethers.provider.getBalance(rewardTreasuryAddress)),
      // );
      //
      // await root.connect(caller).claimStakeRewardUntilEpoch(22, 100);
      //
      // console.log(
      //   formatEther(await ethers.provider.getBalance(rewardTreasuryAddress)),
      // );

      await root.connect(caller).migrateStakeAndRewardToVanaPool(22, 1);

      // console.log(
      //   formatEther(await ethers.provider.getBalance(rewardTreasuryAddress)),
      // );
    });

    it("should update root and metrics and call", async function () {
      await multisigWallet.sendTransaction({
        to: adminAddress,
        value: parseEther(1),
      });

      await root
        .connect(adminWallet)
        .upgradeToAndCall("0xA06E7e83CB8D0B76B6d39A3d3358E1F05D4C606d", "0x");

      // await metrics
      //   .connect(adminWallet)
      //   .upgradeToAndCall("0xb06FE5d21d9178775eBf410854Ff3fDD6E494AeE", "0x");

      await root
        .connect(adminWallet)
        .updateVanaPoolStaking("0x641C18E2F286c86f96CE95C8ec1EB9fC0415Ca0e");

      await root.connect(adminWallet).updateStakeLastBlockNumber(2498239);

      await root
        .connect(adminWallet)
        .createStake(1, { value: parseEther(0.01) });
    });

    it("should update root and metrics and call", async function () {
      const balanceBefore = await ethers.provider.getBalance(
        "0x29Afed5d7E33c5D550128327c8E91E26C7Cd4f6A",
      );
      await root.connect(adminWallet).claimStakesReward([10]);
      const balanceAfter = await ethers.provider.getBalance(
        "0x29Afed5d7E33c5D550128327c8E91E26C7Cd4f6A",
      );

      console.log("balanceBefore: ", formatEther(balanceAfter - balanceBefore));

      console.log(await root.stakes(10));
      return;
    });
  });
});
