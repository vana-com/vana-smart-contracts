import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, network, upgrades } from "hardhat";
import { BaseWallet, Wallet } from "ethers";
import { DLPRootImplementation } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  advanceBlockNTimes,
  advanceToBlockN,
  getCurrentBlockNumber,
} from "../utils/timeAndBlockManipulation";
import { getReceipt, parseEther } from "../utils/helpers";
import { randomInt } from "node:crypto";

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

  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
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

  const epochDlpsLimit = 3;
  const eligibleDlpsLimit = 500;
  let epochSize = 210;
  let daySize = 10;
  const minStakeAmount = parseEther(1);
  const minDlpStakersPercentage = parseEther(50);
  const minDlpRegistrationStake = parseEther(1);
  const dlpEligibilityThreshold = parseEther(100);
  const dlpSubEligibilityThreshold = parseEther(50);
  const stakeWithdrawalDelay = 70;
  const rewardClaimDelay = 100;
  let startBlock: number;
  let epochRewardAmount = parseEther(2);

  const rootInitialBalance = parseEther(0);

  const OWNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OWNER_ROLE"));
  const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
  const MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MANAGER_ROLE"));

  const deploy = async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });

    [
      deployer,
      owner,
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

    startBlock = (await getCurrentBlockNumber()) + 200;

    const dlpRootDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DLPRootImplementation"),
      [
        {
          ownerAddress: owner.address,
          eligibleDlpsLimit: eligibleDlpsLimit,
          epochDlpsLimit: epochDlpsLimit,
          minStakeAmount: minStakeAmount,
          minDlpStakersPercentage: minDlpStakersPercentage,
          minDlpRegistrationStake: minDlpRegistrationStake,
          dlpEligibilityThreshold: dlpEligibilityThreshold,
          dlpSubEligibilityThreshold: dlpSubEligibilityThreshold,
          stakeWithdrawalDelay: stakeWithdrawalDelay,
          rewardClaimDelay: rewardClaimDelay,
          startBlock: startBlock,
          epochSize: epochSize,
          daySize: daySize,
          epochRewardAmount: epochRewardAmount,
        },
      ],
      {
        kind: "uups",
      },
    );

    root = await ethers.getContractAt(
      "DLPRootImplementation",
      dlpRootDeploy.target,
    );
  };

  async function advanceToEpochN(epochNumber: number) {
    const epochNStartBlock = startBlock + (epochNumber - 1) * epochSize;

    await advanceToBlockN(epochNStartBlock);
  }

  async function register5Dlps() {
    await root.connect(dlp1Owner).registerDlp(
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
    await root.connect(dlp2Owner).registerDlp(
      {
        dlpAddress: dlp2,
        ownerAddress: dlp2Owner,
        treasuryAddress: dlp2Treasury,
        stakersPercentage: minDlpStakersPercentage,
        name: "dlp2Name",
        iconUrl: "dlp2IconUrl",
        website: "dlp2Website",
        metadata: "dlp2Metadata",
      },
      { value: dlpEligibilityThreshold },
    );

    await root.connect(dlp3Owner).registerDlp(
      {
        dlpAddress: dlp3,
        ownerAddress: dlp3Owner,
        treasuryAddress: dlp3Treasury,
        stakersPercentage: minDlpStakersPercentage,
        name: "dlp3Name",
        iconUrl: "dlp3IconUrl",
        website: "dlp3Website",
        metadata: "dlp3Metadata",
      },
      { value: dlpEligibilityThreshold },
    );

    await root.connect(dlp4Owner).registerDlp(
      {
        dlpAddress: dlp4,
        ownerAddress: dlp4Owner,
        treasuryAddress: dlp4Treasury,
        stakersPercentage: minDlpStakersPercentage,
        name: "dlp4Name",
        iconUrl: "dlp4IconUrl",
        website: "dlp4Website",
        metadata: "dlp4Metadata",
      },
      { value: dlpEligibilityThreshold },
    );

    await root.connect(dlp5Owner).registerDlp(
      {
        dlpAddress: dlp5,
        ownerAddress: dlp5Owner,
        treasuryAddress: dlp5Treasury,
        stakersPercentage: minDlpStakersPercentage,
        name: "dlp5Name",
        iconUrl: "dlp5IconUrl",
        website: "dlp5Website",
        metadata: "dlp5Metadata",
      },
      { value: dlpEligibilityThreshold },
    );
  }

  async function registerNDlps(stakes: bigint[]) {
    for (let i = 0; i < stakes.length; i++) {
      await root.connect(dlp1Owner).registerDlp(
        {
          dlpAddress: Wallet.createRandom(),
          ownerAddress: dlp1Owner,
          treasuryAddress: Wallet.createRandom(),
          stakersPercentage: minDlpStakersPercentage,
          name: "dlpName",
          iconUrl: "dlpIconUrl",
          website: "dlpWebsite",
          metadata: "dlpMetadata",
        },
        { value: dlpEligibilityThreshold },
      );
    }
  }

  async function register1Dlp() {
    await root.connect(dlp1Owner).registerDlp(
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
  }

  function randomBigint(min: bigint, max: bigint): bigint {
    return (
      min + BigInt(Math.floor(Math.random() * Number(max - min + BigInt(1))))
    );
  }

  function generateStakes(length: number, min: bigint, max: bigint): bigint[] {
    return Array.from({ length }, () => randomBigint(min, max));
  }
  //
  // const generateStakes = (length: number, min: bigint, max: bigint) =>
  // Array.from({ length }, () => BigInt(Math.random()) * (max - min) + min);

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

  function calculateStakeScore(
    stake: bigint,
    startBlock: number,
    endBlock: number,
  ): bigint {
    const stakeMultiplier: bigint[] = [
      100n,
      102n,
      105n,
      107n,
      110n,
      112n,
      114n,
      117n,
      119n,
      121n,
      124n,
      126n,
      129n,
      131n,
      133n,
      136n,
      138n,
      140n,
      143n,
      145n,
      148n,
      150n,
      156n,
      162n,
      168n,
      174n,
      180n,
      186n,
      192n,
      198n,
      204n,
      210n,
      215n,
      221n,
      227n,
      233n,
      239n,
      245n,
      251n,
      257n,
      263n,
      269n,
      275n,
      276n,
      277n,
      279n,
      280n,
      281n,
      282n,
      283n,
      285n,
      286n,
      287n,
      288n,
      289n,
      290n,
      292n,
      293n,
      294n,
      295n,
      296n,
      298n,
      299n,
      300n,
    ];

    const days = Math.floor((endBlock - startBlock) / daySize);
    return days < stakeMultiplier.length
      ? (stake * stakeMultiplier[days]) / 100n
      : (stake * stakeMultiplier[stakeMultiplier.length - 1]) / 100n;
  }

  describe("Setup", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should have correct params after deploy", async function () {
      (await root.hasRole(OWNER_ROLE, owner)).should.eq(true);
      (await root.eligibleDlpsLimit()).should.eq(eligibleDlpsLimit);
      (await root.epochDlpsLimit()).should.eq(epochDlpsLimit);
      (await root.minDlpRegistrationStake()).should.eq(minDlpRegistrationStake);
      (await root.dlpEligibilityThreshold()).should.eq(dlpEligibilityThreshold);
      (await root.dlpSubEligibilityThreshold()).should.eq(
        dlpSubEligibilityThreshold,
      );
      (await root.epochSize()).should.eq(epochSize);
      (await root.epochRewardAmount()).should.eq(epochRewardAmount);
      (await root.paused()).should.eq(false);
      (await root.version()).should.eq(1);

      (await root.epochsCount()).should.eq(0);

      const epoch = await root.epochs(0);
      epoch.startBlock.should.eq(await getCurrentBlockNumber());
      epoch.endBlock.should.eq(startBlock - 1);
      epoch.dlpIds.should.deep.eq([]);
    });

    it("should pause when owner", async function () {
      await root
        .connect(owner)
        .pause()
        .should.emit(root, "Paused")
        .withArgs(owner.address);
      (await root.paused()).should.be.equal(true);
    });

    it("should reject pause when non-owner", async function () {
      await root
        .connect(dlp1Owner)
        .pause()
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${dlp1Owner.address}", "${OWNER_ROLE}")`,
        );
      (await root.paused()).should.be.equal(false);
    });

    it("should unpause when owner", async function () {
      await root.connect(owner).pause();
      await root
        .connect(owner)
        .unpause()
        .should.emit(root, "Unpaused")
        .withArgs(owner.address);
      (await root.paused()).should.be.equal(false);
    });

    it("should reject unpause when non-owner", async function () {
      await root.connect(owner).pause();
      await root
        .connect(dlp1Owner)
        .unpause()
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${dlp1Owner.address}", "${OWNER_ROLE}")`,
        );
      (await root.paused()).should.be.equal(true);
    });

    it("should updateEligibleDlpsLimit when owner", async function () {
      await root
        .connect(owner)
        .updateEligibleDlpsLimit(123)
        .should.emit(root, "EligibleDlpsLimitUpdated")
        .withArgs(123);

      (await root.eligibleDlpsLimit()).should.eq(123);
    });

    it("should reject updateEligibleDlpsLimit when non-owner", async function () {
      await root
        .connect(dlp1Owner)
        .updateEligibleDlpsLimit(123)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${dlp1Owner.address}", "${OWNER_ROLE}")`,
        );

      (await root.eligibleDlpsLimit()).should.eq(eligibleDlpsLimit);
    });

    it("should updateEpochDlpsLimit when owner", async function () {
      await root
        .connect(owner)
        .updateEpochDlpsLimit(123)
        .should.emit(root, "EpochDlpsLimitUpdated")
        .withArgs(123);

      (await root.epochDlpsLimit()).should.eq(123);
    });

    it("should reject updateEpochDlpsLimit when non-owner", async function () {
      await root
        .connect(dlp1Owner)
        .updateEpochDlpsLimit(123)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${dlp1Owner.address}", "${OWNER_ROLE}")`,
        );

      (await root.epochDlpsLimit()).should.eq(epochDlpsLimit);
    });

    it("should updateEpochSize when owner", async function () {
      await root
        .connect(owner)
        .updateEpochSize(123)
        .should.emit(root, "EpochSizeUpdated")
        .withArgs(123);

      (await root.epochSize()).should.eq(123);
    });

    it("should reject updateEpochSize when non-owner", async function () {
      await root
        .connect(dlp1Owner)
        .updateEpochSize(123)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${dlp1Owner.address}", "${OWNER_ROLE}")`,
        );

      (await root.epochSize()).should.eq(epochSize);
    });

    it("should updateEpochRewardAmount when owner", async function () {
      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      (await root.epochs(1)).reward.should.eq(epochRewardAmount);

      await root
        .connect(owner)
        .updateEpochRewardAmount(123)
        .should.emit(root, "EpochRewardAmountUpdated")
        .withArgs(123);

      (await root.epochRewardAmount()).should.eq(123);

      (await root.epochs(1)).reward.should.eq(epochRewardAmount);
    });

    it("should reject updateEpochSize when non-owner", async function () {
      await root
        .connect(dlp1Owner)
        .updateEpochRewardAmount(123)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${dlp1Owner.address}", "${OWNER_ROLE}")`,
        );

      (await root.epochRewardAmount()).should.eq(epochRewardAmount);
    });

    it("should updateMinStakeAmount when owner", async function () {
      await root
        .connect(owner)
        .updateMinStakeAmount(minStakeAmount + 1n)
        .should.emit(root, "MinStakeAmountUpdated")
        .withArgs(minStakeAmount + 1n);

      (await root.minStakeAmount()).should.eq(minStakeAmount + 1n);
    });

    it("should reject updateMinStakeAmount when non-owner", async function () {
      await root
        .connect(dlp1Owner)
        .updateMinStakeAmount(minStakeAmount + 1n)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${dlp1Owner.address}", "${OWNER_ROLE}")`,
        );

      (await root.minStakeAmount()).should.eq(minStakeAmount);
    });

    it("should updateMinDlpStakersPercentage when owner", async function () {
      await root
        .connect(owner)
        .updateMinDlpStakersPercentage(parseEther(51))
        .should.emit(root, "MinDlpStakersPercentageUpdated")
        .withArgs(parseEther(51));

      (await root.minDlpStakersPercentage()).should.eq(parseEther(51));
    });

    it("should reject updateMinDlpStakersPercentage when non-owner", async function () {
      await root
        .connect(dlp1Owner)
        .updateMinDlpStakersPercentage(parseEther(0.2))
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${dlp1Owner.address}", "${OWNER_ROLE}")`,
        );

      (await root.minDlpStakersPercentage()).should.eq(minDlpStakersPercentage);
    });

    it("should updateMinDlpRegistrationStake when owner", async function () {
      await root
        .connect(owner)
        .updateMinDlpRegistrationStake(parseEther(0.2))
        .should.emit(root, "MinDlpRegistrationStakeUpdated")
        .withArgs(parseEther(0.2));

      (await root.minDlpRegistrationStake()).should.eq(parseEther(0.2));
    });

    it("should reject updateMinDlpRegistrationStake when non-owner", async function () {
      await root
        .connect(dlp1Owner)
        .updateMinDlpRegistrationStake(parseEther(0.2))
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${dlp1Owner.address}", "${OWNER_ROLE}")`,
        );

      (await root.minDlpRegistrationStake()).should.eq(minDlpRegistrationStake);
    });

    it("should updateDlpEligibilityThreshold when owner", async function () {
      await root
        .connect(owner)
        .updateDlpEligibilityThreshold(parseEther(101))
        .should.emit(root, "DlpEligibilityThresholdUpdated")
        .withArgs(parseEther(101));

      (await root.dlpEligibilityThreshold()).should.eq(parseEther(101));
    });

    it("should reject updateDlpEligibilityThreshold when non-owner", async function () {
      await root
        .connect(dlp1Owner)
        .updateDlpEligibilityThreshold(parseEther(101))
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${dlp1Owner.address}", "${OWNER_ROLE}")`,
        );

      (await root.dlpEligibilityThreshold()).should.eq(dlpEligibilityThreshold);
    });

    it("should updateDlpSubEligibilityThreshold when owner", async function () {
      await root
        .connect(owner)
        .updateDlpSubEligibilityThreshold(parseEther(51))
        .should.emit(root, "DlpSubEligibilityThresholdUpdated")
        .withArgs(parseEther(51));

      (await root.dlpSubEligibilityThreshold()).should.eq(parseEther(51));
    });

    it("should reject updateDlpSubEligibilityThreshold when non-owner", async function () {
      await root
        .connect(dlp1Owner)
        .updateDlpSubEligibilityThreshold(parseEther(51))
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${dlp1Owner.address}", "${OWNER_ROLE}")`,
        );

      (await root.dlpSubEligibilityThreshold()).should.eq(
        dlpSubEligibilityThreshold,
      );
    });

    it("should updateStakeWithdrawalDelay when owner", async function () {
      await root
        .connect(owner)
        .updateStakeWithdrawalDelay(stakeWithdrawalDelay + 1)
        .should.emit(root, "StakeWithdrawalDelayUpdated")
        .withArgs(stakeWithdrawalDelay + 1);

      (await root.stakeWithdrawalDelay()).should.eq(stakeWithdrawalDelay + 1);
    });

    it("should reject updateStakeWithdrawalDelay when non-owner", async function () {
      await root
        .connect(dlp1Owner)
        .updateStakeWithdrawalDelay(stakeWithdrawalDelay + 1)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${dlp1Owner.address}", "${OWNER_ROLE}")`,
        );

      (await root.stakeWithdrawalDelay()).should.eq(stakeWithdrawalDelay);
    });

    it("should upgradeTo when owner", async function () {
      await upgrades.upgradeProxy(
        root,
        await ethers.getContractFactory("DLPRootImplementationV2Mock", owner),
      );

      const newRoot = await ethers.getContractAt(
        "DLPRootImplementationV2Mock",
        root,
      );
      (await newRoot.epochDlpsLimit()).should.eq(epochDlpsLimit);
      (await newRoot.minDlpRegistrationStake()).should.eq(
        minDlpRegistrationStake,
      );
      (await newRoot.epochSize()).should.eq(epochSize);
      (await newRoot.epochRewardAmount()).should.eq(epochRewardAmount);
      (await newRoot.paused()).should.eq(false);
      (await newRoot.version()).should.eq(2);

      (await newRoot.epochsCount()).should.eq(0);

      (await newRoot.test()).should.eq("test");
    });

    it("should upgradeTo when owner and emit event", async function () {
      const newRootImplementation = await ethers.deployContract(
        "DLPRootImplementationV2Mock",
      );

      await root
        .connect(owner)
        .upgradeToAndCall(newRootImplementation, "0x")
        .should.emit(root, "Upgraded")
        .withArgs(newRootImplementation);

      const newRoot = await ethers.getContractAt(
        "DLPRootImplementationV2Mock",
        root,
      );

      (await newRoot.epochDlpsLimit()).should.eq(epochDlpsLimit);
      (await newRoot.minDlpRegistrationStake()).should.eq(
        minDlpRegistrationStake,
      );
      (await newRoot.epochSize()).should.eq(epochSize);
      (await newRoot.epochRewardAmount()).should.eq(epochRewardAmount);
      (await newRoot.paused()).should.eq(false);
      (await newRoot.version()).should.eq(2);

      (await newRoot.epochsCount()).should.eq(0);

      (await newRoot.test()).should.eq("test");
    });

    it("should reject upgradeTo when storage layout is incompatible", async function () {
      await upgrades
        .upgradeProxy(
          root,
          await ethers.getContractFactory("DLPRootImplementationV3Mock", owner),
        )
        .should.be.rejectedWith("New storage layout is incompatible");
    });

    it("should reject upgradeTo when non owner", async function () {
      const newRootImplementation = await ethers.deployContract(
        "DLPRootImplementationV2Mock",
      );

      await root
        .connect(user1)
        .upgradeToAndCall(newRootImplementation, "0x")
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${OWNER_ROLE}")`,
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
      const tx = await root.connect(user1).registerDlp(
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
        .emit(root, "DlpRegistered")
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
        .emit(root, "StakeCreated")
        .withArgs(1, dlp1Owner, 1, registrationAmount);

      (await root.dlpsCount()).should.eq(1);

      const dlp1Info = await root.dlps(1);

      dlp1Info.id.should.eq(1);
      dlp1Info.dlpAddress.should.eq(dlp1);
      dlp1Info.ownerAddress.should.eq(dlp1Owner.address);
      dlp1Info.treasuryAddress.should.eq(dlp1Treasury);
      dlp1Info.stakersPercentage.should.eq(stakerPercentage);
      dlp1Info.stakersPercentageEpoch.should.eq(0);
      dlp1Info.name.should.eq("dlp1Name");
      dlp1Info.iconUrl.should.eq("dlp1IconUrl");
      dlp1Info.website.should.eq("dlp1Website");
      dlp1Info.metadata.should.eq("dlp1Metadata");

      dlp1Info.stakeAmount.should.eq(registrationAmount);
      dlp1Info.status.should.eq(DlpStatus.Registered);
      dlp1Info.registrationBlockNumber.should.eq(blockNumber + 1);

      (await root.dlpsByAddress(dlp1)).should.deep.eq(dlp1Info);

      (await ethers.provider.getBalance(user1)).should.eq(
        dlp1OwnerInitialBalance - registrationAmount - receipt.fee,
      );
      (await ethers.provider.getBalance(root)).should.eq(registrationAmount);
    });

    it("should registerDlp when stake = dlpEligibilityThreshold", async function () {
      const dlp1OwnerInitialBalance =
        await ethers.provider.getBalance(dlp1Owner);

      const registrationAmount = dlpEligibilityThreshold;
      const stakerPercentage = minDlpStakersPercentage;

      const blockNumber = await getCurrentBlockNumber();
      const tx = await root.connect(user1).registerDlp(
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
        .emit(root, "DlpRegistered")
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
        .emit(root, "StakeCreated")
        .withArgs(1, dlp1Owner, 1, registrationAmount)
        .emit(root, "DlpBecameEligible")
        .withArgs(1);

      (await root.dlpsCount()).should.eq(1);

      const dlp1Info = await root.dlps(1);

      dlp1Info.id.should.eq(1);
      dlp1Info.dlpAddress.should.eq(dlp1);
      dlp1Info.ownerAddress.should.eq(dlp1Owner.address);
      dlp1Info.treasuryAddress.should.eq(dlp1Treasury);
      dlp1Info.stakersPercentage.should.eq(stakerPercentage);
      dlp1Info.stakersPercentageEpoch.should.eq(0);
      dlp1Info.name.should.eq("dlp1Name");
      dlp1Info.iconUrl.should.eq("dlp1IconUrl");
      dlp1Info.website.should.eq("dlp1Website");
      dlp1Info.metadata.should.eq("dlp1Metadata");

      dlp1Info.stakeAmount.should.eq(registrationAmount);
      dlp1Info.status.should.eq(DlpStatus.Eligible);
      dlp1Info.registrationBlockNumber.should.eq(blockNumber + 1);

      (await root.dlpsByAddress(dlp1)).should.deep.eq(dlp1Info);

      (await root.eligibleDlpsListCount()).should.eq(1);
      (await root.eligibleDlpsListAt(0)).should.eq(1);
      (await root.eligibleDlpsListValues()).should.deep.eq([1n]);

      (await ethers.provider.getBalance(user1)).should.eq(
        dlp1OwnerInitialBalance - registrationAmount - receipt.fee,
      );
      (await ethers.provider.getBalance(root)).should.eq(registrationAmount);
    });

    it("should registerDlp after epoch1.startBlock", async function () {
      await advanceToEpochN(1);

      const dlp1OwnerInitialBalance =
        await ethers.provider.getBalance(dlp1Owner);

      const registrationAmount = dlpEligibilityThreshold;
      const stakerPercentage = minDlpStakersPercentage;

      const blockNumber = await getCurrentBlockNumber();
      const tx = await root.connect(user1).registerDlp(
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
        .emit(root, "DlpRegistered")
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
        .emit(root, "StakeCreated")
        .withArgs(1, dlp1Owner, 1, registrationAmount)
        .emit(root, "DlpBecameEligible")
        .withArgs(1);

      (await root.dlpsCount()).should.eq(1);

      const dlp1Info = await root.dlps(1);

      dlp1Info.id.should.eq(1);
      dlp1Info.dlpAddress.should.eq(dlp1);
      dlp1Info.ownerAddress.should.eq(dlp1Owner.address);
      dlp1Info.treasuryAddress.should.eq(dlp1Treasury);
      dlp1Info.stakersPercentage.should.eq(stakerPercentage);
      dlp1Info.stakersPercentageEpoch.should.eq(0);
      dlp1Info.name.should.eq("dlp1Name");
      dlp1Info.iconUrl.should.eq("dlp1IconUrl");
      dlp1Info.website.should.eq("dlp1Website");
      dlp1Info.metadata.should.eq("dlp1Metadata");

      dlp1Info.stakeAmount.should.eq(registrationAmount);
      dlp1Info.status.should.eq(DlpStatus.Eligible);
      dlp1Info.registrationBlockNumber.should.eq(blockNumber + 1);

      (await root.dlpsByAddress(dlp1)).should.deep.eq(dlp1Info);

      (await root.eligibleDlpsListCount()).should.eq(1);
      (await root.eligibleDlpsListAt(0)).should.eq(1);
      (await root.eligibleDlpsListValues()).should.deep.eq([1n]);

      (await ethers.provider.getBalance(user1)).should.eq(
        dlp1OwnerInitialBalance - registrationAmount - receipt.fee,
      );
      (await ethers.provider.getBalance(root)).should.eq(registrationAmount);
    });

    it("should registerDlp and add stake", async function () {
      const dlp1OwnerInitialBalance =
        await ethers.provider.getBalance(dlp1Owner);

      const registrationAmount = minDlpRegistrationStake;
      const stakerPercentage = minDlpStakersPercentage;

      const blockNumber = await getCurrentBlockNumber();
      const tx = await root.connect(user1).registerDlp(
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
        .emit(root, "DlpRegistered")
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
        .emit(root, "StakeCreated")
        .withArgs(1, dlp1Owner, 1, registrationAmount);

      (await root.dlpsCount()).should.eq(1);

      const dlp1Info = await root.dlps(1);

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

      (await root.dlpsByAddress(dlp1)).should.deep.eq(dlp1Info);

      (await ethers.provider.getBalance(user1)).should.eq(
        dlp1OwnerInitialBalance - registrationAmount - receipt.fee,
      );
      (await ethers.provider.getBalance(root)).should.eq(registrationAmount);

      const stake = await root.stakes(1);
      stake.id.should.eq(1);
      stake.stakerAddress.should.eq(dlp1Owner.address);
      stake.dlpId.should.eq(1);
      stake.amount.should.eq(registrationAmount);
      stake.startBlock.should.eq(blockNumber + 1);
      stake.endBlock.should.eq(0);
      stake.withdrawn.should.eq(false);
      stake.lastClaimedEpochId.should.eq(0);
    });

    it("should reject registerDlp when paused", async function () {
      await root.connect(owner).pause();
      await root
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
      await root
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
      await root
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
      await root
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
      await root.connect(user1).registerDlp(
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
      await root
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
      await root.connect(user1).registerDlp(
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
      await root.connect(dlp1Owner).deregisterDlp(1);
      await root
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

    it("should deregisterDlp when dlp owner", async function () {
      const dlp1OwnerInitialBalance =
        await ethers.provider.getBalance(dlp1Owner);
      const tx1 = await root.connect(dlp1Owner).registerDlp(
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

      const tx2 = await root.connect(dlp1Owner).deregisterDlp(1);
      const receipt2 = await getReceipt(tx2);

      await tx2.should.emit(root, "DlpDeregistered").withArgs(1);

      (await root.eligibleDlpsListCount()).should.eq(0);
      (await root.eligibleDlpsListValues()).should.deep.eq([]);

      (await root.dlpsCount()).should.eq(1);
      const dlp1Info = await root.dlps(1);

      (await root.dlpsByAddress(dlp1)).should.deep.eq(dlp1Info);

      (await ethers.provider.getBalance(dlp1Owner)).should.eq(
        dlp1OwnerInitialBalance -
          minDlpRegistrationStake -
          receipt1.fee -
          receipt2.fee,
      );
      (await ethers.provider.getBalance(root)).should.eq(
        minDlpRegistrationStake,
      );
    });

    it("should reject deregisterDlp when non dlp owner", async function () {
      await root.connect(dlp1Owner).registerDlp(
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

      await root
        .connect(owner)
        .deregisterDlp(1)
        .should.be.rejectedWith("NotDlpOwner()");

      await root
        .connect(user1)
        .deregisterDlp(1)
        .should.be.rejectedWith("NotDlpOwner()");
    });

    it("should reject deregisterDlp when deregistered", async function () {
      await root.connect(dlp1Owner).registerDlp(
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

      await root.connect(dlp1Owner).deregisterDlp(1);

      await root
        .connect(dlp1Owner)
        .deregisterDlp(1)
        .should.be.rejectedWith(`InvalidDlpStatus()`);
    });

    it("should updateDlp when dlp owner", async function () {
      const blockNumber = await getCurrentBlockNumber();
      await root.connect(dlp1Owner).registerDlp(
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

      await root
        .connect(dlp1Owner)
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
        .should.emit(root, "DlpUpdated")
        .withArgs(
          1,
          dlp2,
          dlp2Owner,
          dlp2Treasury,
          minDlpStakersPercentage + 1n,
          "dlp1Name2",
          "dlp1IconUrl2",
          "dlp1Website2",
          "dlp1Metadata2",
        );
      (await root.dlpsCount()).should.eq(1);

      const dlp1Info = await root.dlps(1);

      dlp1Info.id.should.eq(1);
      dlp1Info.dlpAddress.should.eq(dlp1);
      dlp1Info.ownerAddress.should.eq(dlp2Owner.address);
      dlp1Info.treasuryAddress.should.eq(dlp2Treasury);
      dlp1Info.stakersPercentage.should.eq(minDlpStakersPercentage + 1n);
      dlp1Info.stakersPercentageEpoch.should.eq(0);
      dlp1Info.name.should.eq("dlp1Name2");
      dlp1Info.iconUrl.should.eq("dlp1IconUrl2");
      dlp1Info.website.should.eq("dlp1Website2");
      dlp1Info.metadata.should.eq("dlp1Metadata2");

      dlp1Info.stakeAmount.should.eq(dlpEligibilityThreshold);
      dlp1Info.status.should.eq(DlpStatus.Eligible);
      dlp1Info.registrationBlockNumber.should.eq(blockNumber + 1);

      (await root.dlpsByAddress(dlp1)).should.deep.eq(dlp1Info);

      (await root.eligibleDlpsListCount()).should.eq(1);
      (await root.eligibleDlpsListAt(0)).should.eq(1);
      (await root.eligibleDlpsListValues()).should.deep.eq([1n]);
    });

    it("should updateDlp stakerPercentage in the next epoch", async function () {
      await root.connect(dlp1Owner).registerDlp(
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

      await root.connect(dlp1Owner).updateDlp(1, {
        dlpAddress: dlp2,
        ownerAddress: dlp2Owner,
        treasuryAddress: dlp2Treasury,
        stakersPercentage: minDlpStakersPercentage + 1n,
        name: "dlp1Name2",
        iconUrl: "dlp1IconUrl2",
        website: "dlp1Website2",
        metadata: "dlp1Metadata2",
      });
      (await root.dlpsCount()).should.eq(1);

      const dlp1Info1 = await root.dlps(1);
      dlp1Info1.stakersPercentage.should.eq(minDlpStakersPercentage + 1n);
      dlp1Info1.stakersPercentageEpoch.should.eq(0);

      await advanceToEpochN(1);
      await root.createEpochs();

      const dlp1Info2 = await root.dlps(1);
      dlp1Info2.stakersPercentage.should.eq(minDlpStakersPercentage + 1n);
      dlp1Info2.stakersPercentageEpoch.should.eq(minDlpStakersPercentage + 1n);

      await root.connect(dlp2Owner).updateDlp(1, {
        dlpAddress: dlp2,
        ownerAddress: dlp2Owner,
        treasuryAddress: dlp2Treasury,
        stakersPercentage: minDlpStakersPercentage + 2n,
        name: "dlp1Name2",
        iconUrl: "dlp1IconUrl2",
        website: "dlp1Website2",
        metadata: "dlp1Metadata2",
      });

      const dlp1Info3 = await root.dlps(1);
      dlp1Info3.stakersPercentage.should.eq(minDlpStakersPercentage + 2n);
      dlp1Info3.stakersPercentageEpoch.should.eq(minDlpStakersPercentage + 1n);

      await advanceToEpochN(2);
      await root.createEpochs();

      const dlp1Info4 = await root.dlps(1);
      dlp1Info4.stakersPercentage.should.eq(minDlpStakersPercentage + 2n);
      dlp1Info4.stakersPercentageEpoch.should.eq(minDlpStakersPercentage + 2n);
    });

    it("should reject updateDlp when non dlp owner", async function () {
      const blockNumber = await getCurrentBlockNumber();
      await root.connect(dlp1Owner).registerDlp(
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

      await root
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
      await root.connect(dlp1Owner).registerDlp(
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

      await root
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

      await root
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
  });

  describe("Epochs", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should createEpochs after the end of the previous one", async function () {
      await advanceToEpochN(1);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(1);
      await advanceToEpochN(2);

      const epoch1 = await root.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.reward.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      let epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(0);
      epoch2.endBlock.should.eq(0);
      epoch2.reward.should.eq(0);
      epoch2.dlpIds.should.deep.eq([]);

      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(2);

      (await root.epochsCount()).should.eq(2);

      epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.reward.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([]);
    });

    it("should createEpochs after updating rewardAmount", async function () {
      await advanceToEpochN(1);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(1);

      await root.connect(owner).updateEpochRewardAmount(epochRewardAmount * 2n);
      await advanceToEpochN(2);

      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(2);

      (await root.epochsCount()).should.eq(2);

      const epoch1 = await root.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.reward.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      const epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.reward.should.eq(epochRewardAmount * 2n);
      epoch2.dlpIds.should.deep.eq([]);
    });

    it("should createEpochs after updating epochSize", async function () {
      await advanceToEpochN(1);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(1);

      await root.connect(owner).updateEpochSize(epochSize * 3);
      await advanceToEpochN(2);

      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(2);

      (await root.epochsCount()).should.eq(2);

      const epoch1 = await root.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.reward.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      const epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 4 * epochSize - 1);
      epoch2.reward.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([]);
    });

    it("should createEpochs after long time", async function () {
      (await root.epochsCount()).should.eq(0);

      await advanceToEpochN(4);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(1)
        .and.emit(root, "EpochCreated")
        .withArgs(2)
        .and.emit(root, "EpochCreated")
        .withArgs(3)
        .and.emit(root, "EpochCreated")
        .withArgs(4);

      (await root.epochsCount()).should.eq(4);

      const epoch1 = await root.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.reward.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      const epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.reward.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([]);

      const epoch3 = await root.epochs(3);
      epoch3.startBlock.should.eq(startBlock + 2 * epochSize);
      epoch3.endBlock.should.eq(startBlock + 3 * epochSize - 1);
      epoch3.reward.should.eq(epochRewardAmount);
      epoch3.dlpIds.should.deep.eq([]);
    });

    it("should createEpochsUntilBlockNumber after long time", async function () {
      (await root.epochsCount()).should.eq(0);

      await advanceToEpochN(4);
      await root
        .connect(owner)
        .createEpochsUntilBlockNumber(await getCurrentBlockNumber())
        .should.emit(root, "EpochCreated")
        .withArgs(1)
        .and.emit(root, "EpochCreated")
        .withArgs(2)
        .and.emit(root, "EpochCreated")
        .withArgs(3)
        .and.emit(root, "EpochCreated")
        .withArgs(4);

      (await root.epochsCount()).should.eq(4);

      const epoch1 = await root.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.reward.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      const epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.reward.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([]);

      const epoch3 = await root.epochs(3);
      epoch3.startBlock.should.eq(startBlock + 2 * epochSize);
      epoch3.endBlock.should.eq(startBlock + 3 * epochSize - 1);
      epoch3.reward.should.eq(epochRewardAmount);
      epoch3.dlpIds.should.deep.eq([]);
    });

    it("should createEpochsUntilBlockNumber with limit", async function () {
      (await root.epochsCount()).should.eq(0);

      await advanceToEpochN(4);
      await root
        .connect(owner)
        .createEpochsUntilBlockNumber(startBlock + epochSize)
        .should.emit(root, "EpochCreated")
        .withArgs(1)
        .and.emit(root, "EpochCreated")
        .withArgs(2);

      (await root.epochsCount()).should.eq(2);

      const epoch1 = await root.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.reward.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);
    });

    it("should createEpochsUntilBlockNumber just until current block number", async function () {
      (await root.epochsCount()).should.eq(0);

      await advanceToEpochN(4);
      await root
        .connect(owner)
        .createEpochsUntilBlockNumber(
          (await getCurrentBlockNumber()) + epochSize * 100,
        )
        .should.emit(root, "EpochCreated")
        .withArgs(1)
        .and.emit(root, "EpochCreated")
        .withArgs(2)
        .and.emit(root, "EpochCreated")
        .withArgs(3)
        .and.emit(root, "EpochCreated")
        .withArgs(4);

      (await root.epochsCount()).should.eq(4);
    });

    it("should create epochs with no active dlps", async function () {
      await advanceToEpochN(3);
      await root.connect(owner).createEpochs();

      for (let i = 1; i <= 2; i++) {
        (await root.epochs(i)).dlpIds.should.deep.eq([]);
      }
    });

    it("should createEpochs with one registered dlp #1", async function () {
      await advanceToEpochN(1);

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([]);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(1);

      await register1Dlp();

      await advanceToEpochN(2);

      const epoch1 = await root.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.reward.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      let epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(0);
      epoch2.endBlock.should.eq(0);
      epoch2.reward.should.eq(0);
      epoch2.dlpIds.should.deep.eq([]);

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([1n]);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(2);

      (await root.epochsCount()).should.eq(2);

      epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.reward.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([1]);

      const dlp1Epoch2 = await root.dlpEpochs(1, 2);
      dlp1Epoch2.stakeAmount.should.eq(parseEther(100));
      dlp1Epoch2.isTopDlp.should.eq(true);
      dlp1Epoch2.rewardAmount.should.eq(0);
      dlp1Epoch2.stakersPercentage.should.eq(0);
    });

    it("should createEpochs with one registered dlp #2", async function () {
      await advanceToEpochN(1);

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([]);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(1);

      await root
        .connect(dlp1Owner)
        .registerDlp(dlp1, dlp1Owner, parseEther(25), {
          value: parseEther(200),
        });
      await advanceToEpochN(2);

      const epoch1 = await root.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.reward.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      let epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(0);
      epoch2.endBlock.should.eq(0);
      epoch2.reward.should.eq(0);
      epoch2.dlpIds.should.deep.eq([]);

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([1n]);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(2);

      (await root.epochsCount()).should.eq(2);

      epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.reward.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([1]);

      const dlp1Epoch2 = await root.dlpEpochs(1, 2);
      dlp1Epoch2.stakeAmount.should.eq(parseEther(200));
      dlp1Epoch2.isTopDlp.should.eq(true);
      dlp1Epoch2.rewardAmount.should.eq(0);
      dlp1Epoch2.stakersPercentage.should.eq(parseEther(25));
    });

    it("should createEpochs after dlpStakersPercentage changes", async function () {
      await advanceToEpochN(1);

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([]);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(1);

      await root
        .connect(dlp1Owner)
        .registerDlp(dlp1, dlp1Owner, parseEther(25), {
          value: parseEther(200),
        });
      await advanceToEpochN(2);

      const epoch1 = await root.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.reward.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      let epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(0);
      epoch2.endBlock.should.eq(0);
      epoch2.reward.should.eq(0);
      epoch2.dlpIds.should.deep.eq([]);

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([1n]);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(2);

      (await root.epochsCount()).should.eq(2);

      epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.reward.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([1]);

      const dlp1Epoch2 = await root.dlpEpochs(1, 2);
      dlp1Epoch2.stakeAmount.should.eq(parseEther(200));
      dlp1Epoch2.isTopDlp.should.eq(true);
      dlp1Epoch2.rewardAmount.should.eq(0);
      dlp1Epoch2.stakersPercentage.should.eq(parseEther(25));

      await root
        .connect(dlp1Owner)
        .updateDlpStakersPercentage(1, parseEther(50));

      await advanceToEpochN(3);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(3);

      const dlp1Epoch3 = await root.dlpEpochs(1, 3);
      dlp1Epoch2.stakeAmount.should.eq(parseEther(200));
      dlp1Epoch2.isTopDlp.should.eq(true);
      dlp1Epoch2.rewardAmount.should.eq(0);
      dlp1Epoch3.stakersPercentage.should.eq(parseEther(50));
    });

    it("should createEpochs with multiple registered dlps #1", async function () {
      await advanceToEpochN(1);

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([]);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(1);

      await registerNDlps([
        parseEther(101),
        parseEther(102),
        parseEther(103),
        parseEther(104),
        parseEther(105),
      ]);

      await advanceToEpochN(2);

      const epoch1 = await root.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.reward.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      let epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(0);
      epoch2.endBlock.should.eq(0);
      epoch2.reward.should.eq(0);
      epoch2.dlpIds.should.deep.eq([]);

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([5n, 4n, 3n]);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(2);

      (await root.epochsCount()).should.eq(2);

      epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.reward.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([5n, 4n, 3n]);
    });

    it("should createEpochs with multiple registered dlps #2", async function () {
      await advanceToEpochN(1);

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([]);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(1);

      await registerNDlps([
        parseEther(101),
        parseEther(106),
        parseEther(103),
        parseEther(103),
        parseEther(103),
      ]);

      await advanceToEpochN(2);

      const epoch1 = await root.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.reward.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      let epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(0);
      epoch2.endBlock.should.eq(0);
      epoch2.reward.should.eq(0);
      epoch2.dlpIds.should.deep.eq([]);

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([2n, 3n, 4n]);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(2);

      (await root.epochsCount()).should.eq(2);

      epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.reward.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([2n, 3n, 4n]);
    });

    it("should createEpochs with multiple registered dlps #3", async function () {
      await advanceToEpochN(1);
      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([]);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(1);

      await registerNDlps([
        parseEther(101),
        parseEther(102),
        parseEther(102),
        parseEther(101),
        parseEther(101),
      ]);

      await advanceToEpochN(2);

      const epoch1 = await root.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.reward.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      let epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(0);
      epoch2.endBlock.should.eq(0);
      epoch2.reward.should.eq(0);
      epoch2.dlpIds.should.deep.eq([]);

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([2n, 3n, 1n]);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(2);

      (await root.epochsCount()).should.eq(2);

      epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.reward.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq([2n, 3n, 1n]);
    });

    it("should createEpochs when 100 dlps and 16  epochDlpsLimit", async function () {
      await root.connect(owner).updateEpochDlpsLimit(16);
      await root.connect(owner).updateMinDlpRegistrationStake(1);
      const stakes = generateStakes(100, parseEther(1), parseEther(2));
      const topStakes = getTopKStakes(stakes, 16);
      await registerNDlps(stakes);

      await advanceToEpochN(5);

      (await root.topDlpIds(16)).should.deep.eq(topStakes);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(1)
        .and.emit(root, "EpochCreated")
        .withArgs(2)
        .and.emit(root, "EpochCreated")
        .withArgs(3)
        .and.emit(root, "EpochCreated")
        .withArgs(4)
        .and.emit(root, "EpochCreated")
        .withArgs(5);

      (await root.epochsCount()).should.eq(5);

      (await root.epochs(1)).dlpIds.should.deep.eq(topStakes);
      (await root.epochs(2)).dlpIds.should.deep.eq(topStakes);
      (await root.epochs(3)).dlpIds.should.deep.eq(topStakes);
      (await root.epochs(4)).dlpIds.should.deep.eq(topStakes);
      (await root.epochs(5)).dlpIds.should.deep.eq(topStakes);
    });

    xit("should createEpochs when 1000 dlps and 32  epochDlpsLimit", async function () {
      await root.connect(owner).updateEpochSize(2000);
      await advanceToEpochN(1);
      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(1);

      epochSize = 2000;

      await root.connect(owner).updateEpochDlpsLimit(32);
      await root.connect(owner).updateMinDlpRegistrationStake(1);
      const stakes = generateStakes(1000, parseEther(1), parseEther(2));
      const topStakes = getTopKStakes(stakes, 32);
      await registerNDlps(stakes);

      await advanceToEpochN(2);

      (await root.topDlpIds(32)).should.deep.eq(topStakes);

      await root
        .connect(owner)
        .createEpochs()
        .should.emit(root, "EpochCreated")
        .withArgs(2);

      (await root.epochsCount()).should.eq(2);

      const epoch1 = await root.epochs(1);
      epoch1.startBlock.should.eq(startBlock);
      epoch1.endBlock.should.eq(startBlock + epochSize - 1);
      epoch1.reward.should.eq(epochRewardAmount);
      epoch1.dlpIds.should.deep.eq([]);

      const epoch2 = await root.epochs(2);
      epoch2.startBlock.should.eq(startBlock + epochSize);
      epoch2.endBlock.should.eq(startBlock + 2 * epochSize - 1);
      epoch2.reward.should.eq(epochRewardAmount);
      epoch2.dlpIds.should.deep.eq(topStakes);
    });
  });

  describe("Staking", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should createStake and emit event", async function () {
      await register1Dlp();

      const stakeAmount = parseEther(10);

      const user1InitialBalance = await ethers.provider.getBalance(user1);

      const blockNumber = await getCurrentBlockNumber();
      const tx = await root
        .connect(user1)
        .createStake(1, { value: stakeAmount });
      const receipt = await getReceipt(tx);

      await tx.should
        .emit(root, "StakeCreated")
        .withArgs(2, user1, 1, stakeAmount);

      const stake = await root.stakes(1);
      stake.id.should.eq(1);
      stake.stakerAddress.should.eq(dlp1Owner.address);
      stake.dlpId.should.eq(1);
      stake.amount.should.eq(dlpEligibilityThreshold);
      stake.startBlock.should.eq(blockNumber);
      stake.endBlock.should.eq(0);
      stake.withdrawn.should.eq(false);
      stake.lastClaimedEpochId.should.eq(0);

      const dlp1Info = await root.dlps(1);

      dlp1Info.stakeAmount.should.eq(dlpEligibilityThreshold + stakeAmount);
      dlp1Info.status.should.eq(DlpStatus.Eligible);

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance - stakeAmount - receipt.fee,
      );
      (await ethers.provider.getBalance(root)).should.eq(
        dlpEligibilityThreshold + stakeAmount,
      );
    });

    it("should createStake and set lastClaimedIndexEpochId after many epochs", async function () {});

    it(`should reject createStake when dlp doesn't exist`, async function () {
      await root
        .connect(user1)
        .createStake(1, { value: parseEther(10) })
        .should.be.rejectedWith("InvalidDlpStatus()");
    });

    it(`should reject createStake when dlp is deregistered`, async function () {
      await register1Dlp();

      await root.connect(dlp1Owner).deregisterDlp(1);

      await root
        .connect(user1)
        .createStake(1, { value: parseEther(10) })
        .should.be.rejectedWith("InvalidDlpStatus()");
    });

    it("should createStake multiple times, one dlp, one epoch", async function () {});

    it("should createStake multiple times, one dlp, multiple epochs", async function () {});

    it("should createStake multiple users, multiple dlps, one epoch", async function () {});

    it("should createStake multiple users, multiple dlps, multiple epochs", async function () {});
  });

  describe("Unstaking", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should unstake and emit event", async function () {
      await register1Dlp();

      const user1InitialBalance = await ethers.provider.getBalance(user1);

      const tx1 = await root
        .connect(user1)
        .createStake(1, { value: parseEther(10) });
      const receipt1 = await getReceipt(tx1);

      await advanceToEpochN(1);
      await advanceBlockNTimes(epochSize / 2);
      await root.createEpochs();

      (await root.unstakebleAmount(user1, 1)).should.eq(parseEther(10));

      const tx2 = await root.connect(user1).unstake(1, parseEther(4));
      const receipt2 = await getReceipt(tx2);

      await tx2.should.emit(root, "Unstaked").withArgs(user1, 1, parseEther(4));

      (await root.unstakebleAmount(user1, 1)).should.eq(parseEther(6));

      await advanceToEpochN(2);
      await root.createEpochs();

      const dlp1Info = await root.dlps(1);
      dlp1Info.stakeAmount.should.eq(parseEther(106));

      const dlp1Epoch0 = await root.dlpEpochs(1, 0);
      dlp1Epoch0.stakeAmount.should.eq(parseEther(0));

      const dlp1Epoch1 = await root.dlpEpochs(1, 1);
      dlp1Epoch1.stakeAmount.should.eq(parseEther(110));

      const dlp1Epoch2 = await root.dlpEpochs(1, 2);
      dlp1Epoch2.stakeAmount.should.eq(parseEther(106));

      (await root.createStakerDlpsListCount(user1)).should.eq(1);
      const staker1Dlp1 = await root.createStakerDlps(user1, 1);
      staker1Dlp1.dlpId.should.eq(1);
      staker1Dlp1.stakeAmount.should.eq(parseEther(6));
      staker1Dlp1.lastClaimedEpochId.should.eq(0);

      (await root.createStakerDlpsList(user1)).should.deep.eq([staker1Dlp1]);

      const staker1Dlp1Epoch0 = await root.createStakerDlpEpochs(user1, 1, 0);
      staker1Dlp1Epoch0.dlpId.should.eq(1);
      staker1Dlp1Epoch0.epochId.should.eq(0);
      staker1Dlp1Epoch0.stakeAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch0.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch0.claimAmount.should.eq(parseEther(0));

      const staker1Dlp1Epoch1 = await root.createStakerDlpEpochs(user1, 1, 1);
      staker1Dlp1Epoch1.dlpId.should.eq(1);
      staker1Dlp1Epoch1.epochId.should.eq(1);
      staker1Dlp1Epoch1.stakeAmount.should.eq(parseEther(10));
      staker1Dlp1Epoch1.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch1.claimAmount.should.eq(parseEther(0));

      const staker1Dlp1Epoch2 = await root.createStakerDlpEpochs(user1, 1, 2);
      staker1Dlp1Epoch2.dlpId.should.eq(1);
      staker1Dlp1Epoch2.epochId.should.eq(2);
      staker1Dlp1Epoch2.stakeAmount.should.eq(parseEther(6));
      staker1Dlp1Epoch2.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch2.claimAmount.should.eq(parseEther(0));

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance - parseEther(6) - receipt1.fee - receipt2.fee,
      );
      (await ethers.provider.getBalance(root)).should.eq(parseEther(106));
    });

    it("should unstake multiple times", async function () {
      await register1Dlp();

      const user1InitialBalance = await ethers.provider.getBalance(user1);

      const tx1 = await root
        .connect(user1)
        .createStake(1, { value: parseEther(10) });
      const receipt1 = await getReceipt(tx1);

      await advanceToEpochN(1);
      await advanceBlockNTimes(epochSize / 2);
      await root.createEpochs();

      (await root.unstakebleAmount(user1, 1)).should.eq(parseEther(10));

      const tx2 = await root.connect(user1).unstake(1, parseEther(1));
      const receipt2 = await getReceipt(tx2);

      await tx2.should.emit(root, "Unstaked").withArgs(user1, 1, parseEther(1));

      (await root.unstakebleAmount(user1, 1)).should.eq(parseEther(9));

      const tx3 = await root.connect(user1).unstake(1, parseEther(3));
      const receipt3 = await getReceipt(tx3);

      await tx3.should.emit(root, "Unstaked").withArgs(user1, 1, parseEther(3));

      (await root.unstakebleAmount(user1, 1)).should.eq(parseEther(6));

      await advanceToEpochN(2);
      await root.createEpochs();

      const dlp1Info = await root.dlps(1);
      dlp1Info.stakeAmount.should.eq(parseEther(106));

      const dlp1Epoch0 = await root.dlpEpochs(1, 0);
      dlp1Epoch0.stakeAmount.should.eq(parseEther(0));

      const dlp1Epoch1 = await root.dlpEpochs(1, 1);
      dlp1Epoch1.stakeAmount.should.eq(parseEther(110));

      const dlp1Epoch2 = await root.dlpEpochs(1, 2);
      dlp1Epoch2.stakeAmount.should.eq(parseEther(106));

      (await root.createStakerDlpsListCount(user1)).should.eq(1);
      const staker1Dlp1 = await root.createStakerDlps(user1, 1);
      staker1Dlp1.dlpId.should.eq(1);
      staker1Dlp1.stakeAmount.should.eq(parseEther(6));
      staker1Dlp1.lastClaimedEpochId.should.eq(0);

      (await root.createStakerDlpsList(user1)).should.deep.eq([staker1Dlp1]);

      const staker1Dlp1Epoch0 = await root.createStakerDlpEpochs(user1, 1, 0);
      staker1Dlp1Epoch0.dlpId.should.eq(1);
      staker1Dlp1Epoch0.epochId.should.eq(0);
      staker1Dlp1Epoch0.stakeAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch0.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch0.claimAmount.should.eq(parseEther(0));

      const staker1Dlp1Epoch1 = await root.createStakerDlpEpochs(user1, 1, 1);
      staker1Dlp1Epoch1.dlpId.should.eq(1);
      staker1Dlp1Epoch1.epochId.should.eq(1);
      staker1Dlp1Epoch1.stakeAmount.should.eq(parseEther(10));
      staker1Dlp1Epoch1.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch1.claimAmount.should.eq(parseEther(0));

      const staker1Dlp1Epoch2 = await root.createStakerDlpEpochs(user1, 1, 2);
      staker1Dlp1Epoch2.dlpId.should.eq(1);
      staker1Dlp1Epoch2.epochId.should.eq(2);
      staker1Dlp1Epoch2.stakeAmount.should.eq(parseEther(6));
      staker1Dlp1Epoch2.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch2.claimAmount.should.eq(parseEther(0));

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance -
          parseEther(6) -
          receipt1.fee -
          receipt2.fee -
          receipt3.fee,
      );
      (await ethers.provider.getBalance(root)).should.eq(parseEther(106));
    });

    it("should unstake all amount", async function () {
      await register1Dlp();

      const user1InitialBalance = await ethers.provider.getBalance(user1);

      const tx1 = await root
        .connect(user1)
        .createStake(1, { value: parseEther(10) });
      const receipt1 = await getReceipt(tx1);

      await advanceToEpochN(1);
      await advanceBlockNTimes(epochSize / 2);
      await root.createEpochs();

      (await root.unstakebleAmount(user1, 1)).should.eq(parseEther(10));

      const tx2 = await root.connect(user1).unstake(1, parseEther(10));
      const receipt2 = await getReceipt(tx2);

      await tx2.should
        .emit(root, "Unstaked")
        .withArgs(user1, 1, parseEther(10));

      (await root.unstakebleAmount(user1, 1)).should.eq(parseEther(0));

      await advanceToEpochN(2);
      await root.createEpochs();

      const dlp1Info = await root.dlps(1);
      dlp1Info.stakeAmount.should.eq(parseEther(100));

      const dlp1Epoch0 = await root.dlpEpochs(1, 0);
      dlp1Epoch0.stakeAmount.should.eq(parseEther(0));

      const dlp1Epoch1 = await root.dlpEpochs(1, 1);
      dlp1Epoch1.stakeAmount.should.eq(parseEther(110));

      const dlp1Epoch2 = await root.dlpEpochs(1, 2);
      dlp1Epoch2.stakeAmount.should.eq(parseEther(100));

      (await root.createStakerDlpsListCount(user1)).should.eq(1);
      const staker1Dlp1 = await root.createStakerDlps(user1, 1);
      staker1Dlp1.dlpId.should.eq(1);
      staker1Dlp1.stakeAmount.should.eq(parseEther(0));
      staker1Dlp1.lastClaimedEpochId.should.eq(0);

      (await root.createStakerDlpsList(user1)).should.deep.eq([staker1Dlp1]);

      const staker1Dlp1Epoch0 = await root.createStakerDlpEpochs(user1, 1, 0);
      staker1Dlp1Epoch0.dlpId.should.eq(1);
      staker1Dlp1Epoch0.epochId.should.eq(0);
      staker1Dlp1Epoch0.stakeAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch0.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch0.claimAmount.should.eq(parseEther(0));

      const staker1Dlp1Epoch1 = await root.createStakerDlpEpochs(user1, 1, 1);
      staker1Dlp1Epoch1.dlpId.should.eq(1);
      staker1Dlp1Epoch1.epochId.should.eq(1);
      staker1Dlp1Epoch1.stakeAmount.should.eq(parseEther(10));
      staker1Dlp1Epoch1.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch1.claimAmount.should.eq(parseEther(0));

      const staker1Dlp1Epoch2 = await root.createStakerDlpEpochs(user1, 1, 2);
      staker1Dlp1Epoch2.dlpId.should.eq(1);
      staker1Dlp1Epoch2.epochId.should.eq(2);
      staker1Dlp1Epoch2.stakeAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch2.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch2.claimAmount.should.eq(parseEther(0));

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance - receipt1.fee - receipt2.fee,
      );
      (await ethers.provider.getBalance(root)).should.eq(parseEther(100));
    });

    it("should reject unstake more than staked amount", async function () {
      await register1Dlp();

      await root.connect(user1).createStake(1, { value: parseEther(10) });

      await advanceToEpochN(1);
      await advanceBlockNTimes(epochSize / 2);
      await root.createEpochs();

      (await root.unstakebleAmount(user1, 1)).should.eq(parseEther(10));

      await root
        .connect(user1)
        .unstake(1, parseEther(11))
        .should.be.rejectedWith("InvalidUnstakeAmount()");
    });

    it("should reject unstake too early #1", async function () {
      await register1Dlp();

      await root.connect(user1).createStake(1, { value: parseEther(10) });

      await advanceBlockNTimes(epochSize / 2);

      (await root.unstakebleAmount(user1, 1)).should.eq(parseEther(0));

      await root
        .connect(user1)
        .unstake(1, parseEther(5))
        .should.be.rejectedWith("InvalidUnstakeAmount()");
    });

    it("should reject unstake too early #2", async function () {
      await register1Dlp();

      await advanceToEpochN(2);
      await root.createEpochs();

      await advanceBlockNTimes(epochSize / 2);

      await root.connect(user1).createStake(1, { value: parseEther(10) });

      await advanceToEpochN(3);
      await root.createEpochs();

      (await root.unstakebleAmount(user1, 1)).should.eq(parseEther(0));

      await root
        .connect(user1)
        .unstake(1, parseEther(5))
        .should.be.rejectedWith("InvalidUnstakeAmount()");
    });

    it("should unstake when dlpOwner", async function () {
      await register1Dlp();

      const dlp1Owner1InitialBalance =
        await ethers.provider.getBalance(dlp1Owner);

      const tx1 = await root
        .connect(dlp1Owner)
        .createStake(1, { value: parseEther(10) });
      const receipt1 = await getReceipt(tx1);

      await advanceToEpochN(1);
      await advanceBlockNTimes(epochSize / 2);
      await root.createEpochs();

      (await root.unstakebleAmount(dlp1Owner, 1)).should.eq(parseEther(60));

      const tx2 = await root.connect(dlp1Owner).unstake(1, parseEther(4));
      const receipt2 = await getReceipt(tx2);

      await tx2.should
        .emit(root, "Unstaked")
        .withArgs(dlp1Owner, 1, parseEther(4));

      (await root.unstakebleAmount(dlp1Owner, 1)).should.eq(parseEther(56));

      await advanceToEpochN(2);
      await root.createEpochs();

      const dlp1Info = await root.dlps(1);
      dlp1Info.stakeAmount.should.eq(parseEther(106));

      const dlp1Epoch0 = await root.dlpEpochs(1, 0);
      dlp1Epoch0.stakeAmount.should.eq(parseEther(0));

      const dlp1Epoch1 = await root.dlpEpochs(1, 1);
      dlp1Epoch1.stakeAmount.should.eq(parseEther(110));

      const dlp1Epoch2 = await root.dlpEpochs(1, 2);
      dlp1Epoch2.stakeAmount.should.eq(parseEther(106));

      (await root.createStakerDlpsListCount(dlp1Owner)).should.eq(1);
      const staker1Dlp1 = await root.createStakerDlps(dlp1Owner, 1);
      staker1Dlp1.dlpId.should.eq(1);
      staker1Dlp1.stakeAmount.should.eq(parseEther(106));
      staker1Dlp1.lastClaimedEpochId.should.eq(0);

      (await root.createStakerDlpsList(dlp1Owner)).should.deep.eq([
        staker1Dlp1,
      ]);

      const staker1Dlp1Epoch0 = await root.createStakerDlpEpochs(
        dlp1Owner,
        1,
        0,
      );
      staker1Dlp1Epoch0.dlpId.should.eq(1);
      staker1Dlp1Epoch0.epochId.should.eq(0);
      staker1Dlp1Epoch0.stakeAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch0.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch0.claimAmount.should.eq(parseEther(0));

      const staker1Dlp1Epoch1 = await root.createStakerDlpEpochs(
        dlp1Owner,
        1,
        1,
      );
      staker1Dlp1Epoch1.dlpId.should.eq(1);
      staker1Dlp1Epoch1.epochId.should.eq(1);
      staker1Dlp1Epoch1.stakeAmount.should.eq(parseEther(110));
      staker1Dlp1Epoch1.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch1.claimAmount.should.eq(parseEther(0));

      const staker1Dlp1Epoch2 = await root.createStakerDlpEpochs(
        dlp1Owner,
        1,
        2,
      );
      staker1Dlp1Epoch2.dlpId.should.eq(1);
      staker1Dlp1Epoch2.epochId.should.eq(2);
      staker1Dlp1Epoch2.stakeAmount.should.eq(parseEther(106));
      staker1Dlp1Epoch2.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch2.claimAmount.should.eq(parseEther(0));

      (await ethers.provider.getBalance(dlp1Owner)).should.eq(
        dlp1Owner1InitialBalance - parseEther(6) - receipt1.fee - receipt2.fee,
      );
      (await ethers.provider.getBalance(root)).should.eq(parseEther(106));
    });

    it("should unstake when dlpOwner when dlp was created with a bigger stake", async function () {
      await register1Dlp();

      const dlp1Owner1InitialBalance =
        await ethers.provider.getBalance(dlp1Owner);

      await advanceToEpochN(1);
      await advanceBlockNTimes(epochSize / 2);
      await root.createEpochs();

      (await root.unstakebleAmount(dlp1Owner, 1)).should.eq(parseEther(50));

      const tx2 = await root.connect(dlp1Owner).unstake(1, parseEther(20));
      const receipt2 = await getReceipt(tx2);

      (await root.unstakebleAmount(dlp1Owner, 1)).should.eq(parseEther(30));

      await tx2.should
        .emit(root, "Unstaked")
        .withArgs(dlp1Owner, 1, parseEther(20));

      await advanceToEpochN(2);
      await root.createEpochs();

      const dlp1Info = await root.dlps(1);
      dlp1Info.stakeAmount.should.eq(parseEther(80));

      const dlp1Epoch0 = await root.dlpEpochs(1, 0);
      dlp1Epoch0.stakeAmount.should.eq(parseEther(0));

      const dlp1Epoch1 = await root.dlpEpochs(1, 1);
      dlp1Epoch1.stakeAmount.should.eq(parseEther(100));

      const dlp1Epoch2 = await root.dlpEpochs(1, 2);
      dlp1Epoch2.stakeAmount.should.eq(parseEther(80));

      (await root.createStakerDlpsListCount(dlp1Owner)).should.eq(1);
      const staker1Dlp1 = await root.createStakerDlps(dlp1Owner, 1);
      staker1Dlp1.dlpId.should.eq(1);
      staker1Dlp1.stakeAmount.should.eq(parseEther(80));
      staker1Dlp1.lastClaimedEpochId.should.eq(0);

      (await root.createStakerDlpsList(dlp1Owner)).should.deep.eq([
        staker1Dlp1,
      ]);

      const staker1Dlp1Epoch0 = await root.createStakerDlpEpochs(
        dlp1Owner,
        1,
        0,
      );
      staker1Dlp1Epoch0.dlpId.should.eq(1);
      staker1Dlp1Epoch0.epochId.should.eq(0);
      staker1Dlp1Epoch0.stakeAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch0.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch0.claimAmount.should.eq(parseEther(0));

      const staker1Dlp1Epoch1 = await root.createStakerDlpEpochs(
        dlp1Owner,
        1,
        1,
      );
      staker1Dlp1Epoch1.dlpId.should.eq(1);
      staker1Dlp1Epoch1.epochId.should.eq(1);
      staker1Dlp1Epoch1.stakeAmount.should.eq(parseEther(100));
      staker1Dlp1Epoch1.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch1.claimAmount.should.eq(parseEther(0));

      const staker1Dlp1Epoch2 = await root.createStakerDlpEpochs(
        dlp1Owner,
        1,
        2,
      );
      staker1Dlp1Epoch2.dlpId.should.eq(1);
      staker1Dlp1Epoch2.epochId.should.eq(2);
      staker1Dlp1Epoch2.stakeAmount.should.eq(parseEther(80));
      staker1Dlp1Epoch2.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch2.claimAmount.should.eq(parseEther(0));

      (await ethers.provider.getBalance(dlp1Owner)).should.eq(
        dlp1Owner1InitialBalance + parseEther(20) - receipt2.fee,
      );
      (await ethers.provider.getBalance(root)).should.eq(parseEther(80));
    });

    it("should reject unstake more than dlp minStake when dlpOwner", async function () {
      await register1Dlp();

      await advanceToEpochN(1);
      await root.createEpochs();

      (await root.unstakebleAmount(dlp1Owner, 1)).should.eq(
        parseEther(100) - minDlpRegistrationStake,
      );

      (await root.unstakebleAmount(dlp1Owner, 1)).should.eq(parseEther(50));

      await root.connect(dlp1Owner).unstake(1, parseEther(50)).should.be
        .fulfilled;

      (await root.unstakebleAmount(user1, 1)).should.eq(0);

      (await root.dlps(1)).stakeAmount.should.eq(minDlpRegistrationStake);

      await root
        .connect(dlp1Owner)
        .unstake(1, parseEther(0.0001))
        .should.be.rejectedWith("InvalidUnstakeAmount()");

      await advanceBlockNTimes(epochSize / 2);
    });

    it("should unstake an old stake", async function () {
      await register1Dlp();

      const user1InitialBalance = await ethers.provider.getBalance(user1);

      const tx1 = await root
        .connect(user1)
        .createStake(1, { value: parseEther(10) });
      const receipt1 = await getReceipt(tx1);

      await advanceToEpochN(1);
      await advanceBlockNTimes(epochSize / 2);
      await root.createEpochs();

      const tx2 = await root
        .connect(user1)
        .createStake(1, { value: parseEther(5) });
      const receipt2 = await getReceipt(tx2);

      (await root.unstakebleAmount(user1, 1)).should.eq(parseEther(10));

      const tx3 = await root.connect(user1).unstake(1, parseEther(10));
      const receipt3 = await getReceipt(tx3);

      await tx3.should
        .emit(root, "Unstaked")
        .withArgs(user1, 1, parseEther(10));

      (await root.unstakebleAmount(user1, 1)).should.eq(parseEther(0));

      await advanceToEpochN(2);
      await root.createEpochs();

      const dlp1Info = await root.dlps(1);
      dlp1Info.stakeAmount.should.eq(parseEther(105));

      const dlp1Epoch0 = await root.dlpEpochs(1, 0);
      dlp1Epoch0.stakeAmount.should.eq(parseEther(0));

      const dlp1Epoch1 = await root.dlpEpochs(1, 1);
      dlp1Epoch1.stakeAmount.should.eq(parseEther(110));

      const dlp1Epoch2 = await root.dlpEpochs(1, 2);
      dlp1Epoch2.stakeAmount.should.eq(parseEther(105));

      (await root.createStakerDlpsListCount(user1)).should.eq(1);
      const staker1Dlp1 = await root.createStakerDlps(user1, 1);
      staker1Dlp1.dlpId.should.eq(1);
      staker1Dlp1.stakeAmount.should.eq(parseEther(5));
      staker1Dlp1.lastClaimedEpochId.should.eq(0);

      (await root.createStakerDlpsList(user1)).should.deep.eq([staker1Dlp1]);

      const staker1Dlp1Epoch0 = await root.createStakerDlpEpochs(user1, 1, 0);
      staker1Dlp1Epoch0.dlpId.should.eq(1);
      staker1Dlp1Epoch0.epochId.should.eq(0);
      staker1Dlp1Epoch0.stakeAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch0.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch0.claimAmount.should.eq(parseEther(0));

      const staker1Dlp1Epoch1 = await root.createStakerDlpEpochs(user1, 1, 1);
      staker1Dlp1Epoch1.dlpId.should.eq(1);
      staker1Dlp1Epoch1.epochId.should.eq(1);
      staker1Dlp1Epoch1.stakeAmount.should.eq(parseEther(10));
      staker1Dlp1Epoch1.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch1.claimAmount.should.eq(parseEther(0));

      const staker1Dlp1Epoch2 = await root.createStakerDlpEpochs(user1, 1, 2);
      staker1Dlp1Epoch2.dlpId.should.eq(1);
      staker1Dlp1Epoch2.epochId.should.eq(2);
      staker1Dlp1Epoch2.stakeAmount.should.eq(parseEther(5));
      staker1Dlp1Epoch2.rewardAmount.should.eq(parseEther(0));
      staker1Dlp1Epoch2.claimAmount.should.eq(parseEther(0));

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance -
          parseEther(5) -
          receipt1.fee -
          receipt2.fee -
          receipt3.fee,
      );
      (await ethers.provider.getBalance(root)).should.eq(parseEther(105));
    });
  });

  describe("TopDlps", () => {
    const minStakeAmount = 100;

    beforeEach(async () => {
      await deploy();

      await root.connect(owner).updateMinDlpRegistrationStake(minStakeAmount);
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
      { dlpsCount: 300, epochDlpsLimit: 16 },
      { dlpsCount: 1000, epochDlpsLimit: 16 },
      { dlpsCount: 1000, epochDlpsLimit: 32 },
    ];

    topDlpTests.forEach((test) => {
      it(`should set topDlps when creating new epoch (dlpsCount = ${test.dlpsCount},  epochDlpsLimit = ${test.epochDlpsLimit})`, async () => {
        await root.connect(owner).updateEpochSize(2000);
        await advanceToEpochN(1);

        await root.connect(owner).createEpochs();

        const dlpStakes = generateStakes(test.dlpsCount, 1000n, 5000n);

        await registerNDlps(dlpStakes);
        await root.connect(owner).updateEpochDlpsLimit(test.epochDlpsLimit);

        const topKDlpIdsExpected = getTopKStakes(
          dlpStakes,
          test.epochDlpsLimit,
        );

        (await root.topDlpIds(test.epochDlpsLimit)).should.deep.eq(
          topKDlpIdsExpected,
        );

        await advanceBlockNTimes(2000); //epoch2
        await root.connect(owner).createEpochs();

        const epoch = await root.epochs(2);
        epoch.dlpIds.should.deep.eq(topKDlpIdsExpected);

        topKDlpIdsExpected.forEach(async (dlpId) => {
          (await root.dlpEpochs(dlpId, 2)).stakeAmount.should.eq(
            dlpStakes[dlpId - 1],
          );
        });
      });
    });

    it(`should set topDlps when creating new epoch after dlpOwner staking`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);
      (await root.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await root.connect(dlp1Owner).createStake(1, { value: 350n });

      await advanceToEpochN(2);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 1, 4]);
      (await root.epochs(2)).dlpIds.should.deep.eq([5, 1, 4]);

      (await root.dlpEpochs(1, 2)).stakeAmount.should.eq(450n);
      (await root.dlpEpochs(1, 2)).isTopDlp.should.eq(true);

      (await root.dlpEpochs(2, 2)).stakeAmount.should.eq(200);
      (await root.dlpEpochs(2, 2)).isTopDlp.should.eq(false);

      (await root.dlpEpochs(3, 2)).stakeAmount.should.eq(300);
      (await root.dlpEpochs(3, 2)).isTopDlp.should.eq(false);

      (await root.dlpEpochs(4, 2)).stakeAmount.should.eq(400);
      (await root.dlpEpochs(4, 2)).isTopDlp.should.eq(true);

      (await root.dlpEpochs(5, 2)).stakeAmount.should.eq(500);
      (await root.dlpEpochs(5, 2)).isTopDlp.should.eq(true);
    });

    it(`should set topDlps when creating new epoch after user staking`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);
      (await root.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await root.connect(user1).createStake(1, { value: 350n });

      await advanceToEpochN(2);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 1, 4]);
      (await root.epochs(2)).dlpIds.should.deep.eq([5, 1, 4]);

      (await root.dlpEpochs(1, 2)).stakeAmount.should.eq(450n);
      (await root.dlpEpochs(1, 2)).isTopDlp.should.eq(true);

      (await root.dlpEpochs(2, 2)).stakeAmount.should.eq(200);
      (await root.dlpEpochs(2, 2)).isTopDlp.should.eq(false);

      (await root.dlpEpochs(3, 2)).stakeAmount.should.eq(300);
      (await root.dlpEpochs(3, 2)).isTopDlp.should.eq(false);

      (await root.dlpEpochs(4, 2)).stakeAmount.should.eq(400);
      (await root.dlpEpochs(4, 2)).isTopDlp.should.eq(true);

      (await root.dlpEpochs(5, 2)).stakeAmount.should.eq(500);
      (await root.dlpEpochs(5, 2)).isTopDlp.should.eq(true);
    });

    it(`should set topDlps when creating new epoch after unstaking`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);
      (await root.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await root.connect(dlp1Owner).unstake(4, 200n);

      await advanceToEpochN(3);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 3, 2]);
      (await root.epochs(3)).dlpIds.should.deep.eq([5, 3, 2]);

      (await root.dlpEpochs(1, 3)).stakeAmount.should.eq(100);
      (await root.dlpEpochs(1, 3)).isTopDlp.should.eq(false);

      (await root.dlpEpochs(2, 3)).stakeAmount.should.eq(200);
      (await root.dlpEpochs(2, 3)).isTopDlp.should.eq(true);

      (await root.dlpEpochs(3, 3)).stakeAmount.should.eq(300);
      (await root.dlpEpochs(3, 3)).isTopDlp.should.eq(true);

      (await root.dlpEpochs(4, 3)).stakeAmount.should.eq(200);
      (await root.dlpEpochs(4, 3)).isTopDlp.should.eq(false);

      (await root.dlpEpochs(5, 3)).stakeAmount.should.eq(500);
      (await root.dlpEpochs(5, 3)).isTopDlp.should.eq(true);
    });

    it(`should set topDlps when creating new epoch after registering new DLPs`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);
      (await root.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await registerNDlps([100n, parseEther(600)]);

      await advanceToEpochN(5);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([7, 5, 4]);
      (await root.epochs(5)).dlpIds.should.deep.eq([7, 5, 4]);
    });

    it(`should set topDlps when creating new epoch after deregistering a DLP`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);
      (await root.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await root.connect(dlp1Owner).deregisterDlp(4);

      await advanceToEpochN(2);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 3, 2]);
      (await root.epochs(2)).dlpIds.should.deep.eq([5, 3, 2]);
    });

    it(`should set topDlps when creating new epoch after updating the maximum number of DLPs #updateEpochDlpsLimit`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);
      (await root.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await root.connect(owner).updateEpochDlpsLimit(2);

      await advanceToEpochN(2);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(2)).should.deep.eq([5, 4]);
      (await root.epochs(2)).dlpIds.should.deep.eq([5, 4]);

      await root.connect(owner).updateEpochDlpsLimit(4);

      await advanceToEpochN(3);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(4)).should.deep.eq([5, 4, 3, 2]);
      (await root.epochs(3)).dlpIds.should.deep.eq([5, 4, 3, 2]);
    });

    it(`should set topDlps when creating new epoch #staking, unstaking, registration, deregistration, updateEpochDlpsLimit`, async () => {
      await registerNDlps([100n, 200n, 300n, 400n, 500n]);

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 4, 3]);
      (await root.epochs(1)).dlpIds.should.deep.eq([5, 4, 3]);

      await root.connect(dlp1Owner).createStake(1, { value: 350n });

      await advanceToEpochN(2);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([5, 1, 4]);
      (await root.epochs(2)).dlpIds.should.deep.eq([5, 1, 4]);

      await root.connect(dlp1Owner).deregisterDlp(5);

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([1, 4, 3]);

      await advanceToEpochN(3);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(epochDlpsLimit)).should.deep.eq([1, 4, 3]);
      (await root.epochs(3)).dlpIds.should.deep.eq([1, 4, 3]);

      await root.connect(owner).updateEpochDlpsLimit(2);

      await advanceToEpochN(4);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(2)).should.deep.eq([1, 4]);
      (await root.epochs(4)).dlpIds.should.deep.eq([1, 4]);

      await registerNDlps([100n, 600n]);

      await advanceToEpochN(5);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(2)).should.deep.eq([7, 1]);
      (await root.epochs(5)).dlpIds.should.deep.eq([7, 1]);

      await root.connect(owner).updateEpochDlpsLimit(4);

      await advanceToEpochN(6);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(4)).should.deep.eq([7, 1, 4, 3]);
      (await root.epochs(6)).dlpIds.should.deep.eq([7, 1, 4, 3]);

      await root.connect(dlp1Owner).unstake(1, 300n);

      await advanceToEpochN(7);
      await root.connect(owner).createEpochs();

      (await root.topDlpIds(4)).should.deep.eq([7, 4, 3, 2]);
      (await root.epochs(7)).dlpIds.should.deep.eq([7, 4, 3, 2]);
    });
  });

  describe("ClaimReward", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should _calculateStakeScore", async function () {
      (await root._calculateStakeScore(parseEther(30), 7, 7)).should.eq(
        parseEther(30),
      );

      (
        await root._calculateStakeScore(parseEther(30), 7, 7 + daySize * 5)
      ).should.eq(parseEther(30 * 1.12));

      (
        await root._calculateStakeScore(parseEther(30), 7, 7 + daySize * 63)
      ).should.eq(parseEther(30 * 3));

      (
        await root._calculateStakeScore(parseEther(30), 7, 7 + daySize * 100)
      ).should.eq(parseEther(30 * 3));

      for (let i = 0; i < 100; i++) {
        let amount = randomBigint(parseEther(0.1), parseEther(1000000));
        let startBlock = randomInt(1, 100000000);
        let endBlock = startBlock + i * daySize;

        (
          await root._calculateStakeScore(amount, startBlock, endBlock)
        ).should.eq(calculateStakeScore(amount, startBlock, endBlock));

        amount = randomBigint(parseEther(0.1), parseEther(1000000));
        startBlock = randomInt(1, 100000000);
        endBlock = startBlock + i * daySize + 1;
        (
          await root._calculateStakeScore(amount, startBlock, endBlock)
        ).should.eq(calculateStakeScore(amount, startBlock, endBlock));

        amount = randomBigint(parseEther(0.1), parseEther(1000000));
        startBlock = randomInt(1, 100000000);
        endBlock = startBlock + (i + 1) * daySize - 1;
        (
          await root._calculateStakeScore(amount, startBlock, endBlock)
        ).should.eq(calculateStakeScore(amount, startBlock, endBlock));
      }

      (await root._calculateStakeScore(parseEther(1), 10, 10)).should.eq(
        parseEther(1),
      );
      (
        await root._calculateStakeScore(parseEther(1), 7, 7 + daySize - 1)
      ).should.eq(parseEther(1));
      (
        await root._calculateStakeScore(parseEther(1), 7, 7 + daySize)
      ).should.eq(parseEther(1.02));
    });

    it("should claimReward when only dlpOwners has staked, stakersPercentages = 100%", async function () {
      await root
        .connect(dlp1Owner)
        .registerDlp(dlp1, dlp1Owner, parseEther(100), {
          value: parseEther(100),
        });
      await root
        .connect(dlp2Owner)
        .registerDlp(dlp2, dlp2Owner, parseEther(100), {
          value: parseEther(100),
        });
      await root
        .connect(dlp3Owner)
        .registerDlp(dlp3, dlp3Owner, parseEther(100), {
          value: parseEther(100),
        });

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      await advanceToEpochN(2);
      await root.connect(owner).createEpochs();

      const dlp1Epoch1Reward = (epochRewardAmount * 20n) / 100n;
      const dlp2Epoch1Reward = (epochRewardAmount * 30n) / 100n;
      const dlp3Epoch1Reward = (epochRewardAmount * 50n) / 100n;

      const dlp1OwnerDlp1Epoch1Reward = dlp1Epoch1Reward;
      const dlp2OwnerDlp2Epoch1Reward = dlp2Epoch1Reward;
      const dlp3OwnerDlp3Epoch1Reward = dlp3Epoch1Reward;

      (await root.createStakerDlps(dlp1Owner, 1)).lastClaimedEpochId.should.eq(
        0,
      );
      (await root.createStakerDlps(dlp2Owner, 2)).lastClaimedEpochId.should.eq(
        0,
      );
      (await root.createStakerDlps(dlp3Owner, 3)).lastClaimedEpochId.should.eq(
        0,
      );

      (await root.dlpEpochs(1, 1)).rewardAmount.should.eq(dlp1Epoch1Reward);
      (await root.dlpEpochs(2, 1)).rewardAmount.should.eq(dlp2Epoch1Reward);
      (await root.dlpEpochs(3, 1)).rewardAmount.should.eq(dlp3Epoch1Reward);

      (await root.claimableAmount(dlp1Owner, 1)).should.eq(
        dlp1OwnerDlp1Epoch1Reward,
      );
      (await root.claimableAmount(dlp2Owner, 2)).should.eq(
        dlp2OwnerDlp2Epoch1Reward,
      );
      (await root.claimableAmount(dlp3Owner, 3)).should.eq(
        dlp3OwnerDlp3Epoch1Reward,
      );

      const dlp1OwnerBalanceBefore =
        await ethers.provider.getBalance(dlp1Owner);
      const dlp2OwnerBalanceBefore =
        await ethers.provider.getBalance(dlp2Owner);
      const dlp3OwnerBalanceBefore =
        await ethers.provider.getBalance(dlp3Owner);

      const tx1 = await root.connect(dlp1Owner).claimReward(1);
      await tx1.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp1Owner, 1, 1, dlp1OwnerDlp1Epoch1Reward);
      const tx2 = await root.connect(dlp2Owner).claimReward(2);
      await tx2.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp2Owner, 2, 1, dlp2OwnerDlp2Epoch1Reward);
      const tx3 = await root.connect(dlp3Owner).claimReward(3);
      await tx3.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp3Owner, 3, 1, dlp3OwnerDlp3Epoch1Reward);

      (await root.createStakerDlpEpochs(dlp1Owner, 1, 1)).claimAmount.should.eq(
        dlp1OwnerDlp1Epoch1Reward,
      );
      (await root.createStakerDlpEpochs(dlp2Owner, 2, 1)).claimAmount.should.eq(
        dlp2OwnerDlp2Epoch1Reward,
      );
      (await root.createStakerDlpEpochs(dlp3Owner, 3, 1)).claimAmount.should.eq(
        dlp3OwnerDlp3Epoch1Reward,
      );

      (await root.createStakerDlps(dlp1Owner, 1)).lastClaimedEpochId.should.eq(
        1,
      );
      (await root.createStakerDlps(dlp2Owner, 2)).lastClaimedEpochId.should.eq(
        1,
      );
      (await root.createStakerDlps(dlp3Owner, 3)).lastClaimedEpochId.should.eq(
        1,
      );

      (await root.claimableAmount(dlp1Owner, 1)).should.eq(0);
      (await root.claimableAmount(dlp2Owner, 2)).should.eq(0);
      (await root.claimableAmount(dlp3Owner, 3)).should.eq(0);

      (await ethers.provider.getBalance(dlp1Owner)).should.eq(
        dlp1OwnerBalanceBefore +
          dlp1OwnerDlp1Epoch1Reward -
          (await getReceipt(tx1)).fee,
      );

      (await ethers.provider.getBalance(dlp2Owner)).should.eq(
        dlp2OwnerBalanceBefore +
          dlp2OwnerDlp2Epoch1Reward -
          (await getReceipt(tx2)).fee,
      );

      (await ethers.provider.getBalance(dlp3Owner)).should.eq(
        dlp3OwnerBalanceBefore +
          dlp3OwnerDlp3Epoch1Reward -
          (await getReceipt(tx3)).fee,
      );
    });

    it("should claimReward when only dlpOwners has staked, stakersPercentages != 100%", async function () {
      await root
        .connect(dlp1Owner)
        .registerDlp(dlp1, dlp1Owner, parseEther(25), {
          value: parseEther(100),
        });
      await root
        .connect(dlp2Owner)
        .registerDlp(dlp2, dlp2Owner, parseEther(50), {
          value: parseEther(100),
        });
      await root
        .connect(dlp3Owner)
        .registerDlp(dlp3, dlp3Owner, parseEther(80), {
          value: parseEther(100),
        });

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      await advanceToEpochN(2);
      await root.connect(owner).createEpochs();

      const dlp1Epoch1Reward = (epochRewardAmount * 20n) / 100n;
      const dlp2Epoch1Reward = (epochRewardAmount * 30n) / 100n;
      const dlp3Epoch1Reward = (epochRewardAmount * 50n) / 100n;

      const dlp1OwnerDlp1Epoch1Reward = (dlp1Epoch1Reward * 25n) / 100n;
      const dlp2OwnerDlp2Epoch1Reward = (dlp2Epoch1Reward * 50n) / 100n;
      const dlp3OwnerDlp3Epoch1Reward = (dlp3Epoch1Reward * 80n) / 100n;

      (await root.createStakerDlps(dlp1Owner, 1)).lastClaimedEpochId.should.eq(
        0,
      );
      (await root.createStakerDlps(dlp2Owner, 2)).lastClaimedEpochId.should.eq(
        0,
      );
      (await root.createStakerDlps(dlp3Owner, 3)).lastClaimedEpochId.should.eq(
        0,
      );

      (await root.dlpEpochs(1, 1)).rewardAmount.should.eq(dlp1Epoch1Reward);
      (await root.dlpEpochs(2, 1)).rewardAmount.should.eq(dlp2Epoch1Reward);
      (await root.dlpEpochs(3, 1)).rewardAmount.should.eq(dlp3Epoch1Reward);

      (await root.claimableAmount(dlp1Owner, 1)).should.eq(
        dlp1OwnerDlp1Epoch1Reward,
      );
      (await root.claimableAmount(dlp2Owner, 2)).should.eq(
        dlp2OwnerDlp2Epoch1Reward,
      );
      (await root.claimableAmount(dlp3Owner, 3)).should.eq(
        dlp3OwnerDlp3Epoch1Reward,
      );

      const dlp1OwnerBalanceBefore =
        await ethers.provider.getBalance(dlp1Owner);
      const dlp2OwnerBalanceBefore =
        await ethers.provider.getBalance(dlp2Owner);
      const dlp3OwnerBalanceBefore =
        await ethers.provider.getBalance(dlp3Owner);

      const tx1 = await root.connect(dlp1Owner).claimReward(1);
      await tx1.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp1Owner, 1, 1, dlp1OwnerDlp1Epoch1Reward);
      const tx2 = await root.connect(dlp2Owner).claimReward(2);
      await tx2.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp2Owner, 2, 1, dlp2OwnerDlp2Epoch1Reward);
      const tx3 = await root.connect(dlp3Owner).claimReward(3);
      await tx3.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp3Owner, 3, 1, dlp3OwnerDlp3Epoch1Reward);

      (await root.createStakerDlpEpochs(dlp1Owner, 1, 1)).claimAmount.should.eq(
        dlp1OwnerDlp1Epoch1Reward,
      );
      (await root.createStakerDlpEpochs(dlp2Owner, 2, 1)).claimAmount.should.eq(
        dlp2OwnerDlp2Epoch1Reward,
      );
      (await root.createStakerDlpEpochs(dlp3Owner, 3, 1)).claimAmount.should.eq(
        dlp3OwnerDlp3Epoch1Reward,
      );

      (await root.createStakerDlps(dlp1Owner, 1)).lastClaimedEpochId.should.eq(
        1,
      );
      (await root.createStakerDlps(dlp2Owner, 2)).lastClaimedEpochId.should.eq(
        1,
      );
      (await root.createStakerDlps(dlp3Owner, 3)).lastClaimedEpochId.should.eq(
        1,
      );

      (await root.claimableAmount(dlp1Owner, 1)).should.eq(0);
      (await root.claimableAmount(dlp2Owner, 2)).should.eq(0);
      (await root.claimableAmount(dlp3Owner, 3)).should.eq(0);

      (await ethers.provider.getBalance(dlp1Owner)).should.eq(
        dlp1OwnerBalanceBefore +
          dlp1OwnerDlp1Epoch1Reward -
          (await getReceipt(tx1)).fee,
      );

      (await ethers.provider.getBalance(dlp2Owner)).should.eq(
        dlp2OwnerBalanceBefore +
          dlp2OwnerDlp2Epoch1Reward -
          (await getReceipt(tx2)).fee,
      );

      (await ethers.provider.getBalance(dlp3Owner)).should.eq(
        dlp3OwnerBalanceBefore +
          dlp3OwnerDlp3Epoch1Reward -
          (await getReceipt(tx3)).fee,
      );
    });

    it("should claimReward #1", async function () {
      await root
        .connect(dlp1Owner)
        .registerDlp(dlp1, dlp1Owner, parseEther(25), {
          value: parseEther(100),
        });
      await root
        .connect(dlp2Owner)
        .registerDlp(dlp2, dlp2Owner, parseEther(50), {
          value: parseEther(100),
        });
      await root
        .connect(dlp3Owner)
        .registerDlp(dlp3, dlp3Owner, parseEther(80), {
          value: parseEther(100),
        });

      await root.connect(user1).createStake(1, { value: parseEther(75) });

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      await advanceToEpochN(2);
      await root.connect(owner).createEpochs();

      const dlp1Epoch1Reward = (epochRewardAmount * 20n) / 100n;
      const dlp2Epoch1Reward = (epochRewardAmount * 30n) / 100n;
      const dlp3Epoch1Reward = (epochRewardAmount * 50n) / 100n;

      const dlp1Epoch1StakersReward = (dlp1Epoch1Reward * 25n) / 100n;
      const dlp2Epoch1StakersReward = (dlp2Epoch1Reward * 50n) / 100n;
      const dlp3Epoch1StakersReward = (dlp3Epoch1Reward * 80n) / 100n;

      (await root.createStakerDlps(dlp1Owner, 1)).lastClaimedEpochId.should.eq(
        0,
      );
      (await root.createStakerDlps(dlp2Owner, 2)).lastClaimedEpochId.should.eq(
        0,
      );
      (await root.createStakerDlps(dlp3Owner, 3)).lastClaimedEpochId.should.eq(
        0,
      );
      (await root.createStakerDlps(user1, 1)).lastClaimedEpochId.should.eq(0);

      (await root.dlpEpochs(1, 1)).rewardAmount.should.eq(dlp1Epoch1Reward);
      (await root.dlpEpochs(2, 1)).rewardAmount.should.eq(dlp2Epoch1Reward);
      (await root.dlpEpochs(3, 1)).rewardAmount.should.eq(dlp3Epoch1Reward);

      (await root.claimableAmount(dlp1Owner, 1)).should.eq(
        (dlp1Epoch1StakersReward * 100n) / 175n,
      );
      (await root.claimableAmount(user1, 1)).should.eq(
        (dlp1Epoch1StakersReward * 75n) / 175n,
      );
      (await root.claimableAmount(dlp2Owner, 2)).should.eq(
        dlp2Epoch1StakersReward,
      );
      (await root.claimableAmount(dlp3Owner, 3)).should.eq(
        dlp3Epoch1StakersReward,
      );

      const dlp1OwnerBalanceBefore =
        await ethers.provider.getBalance(dlp1Owner);
      const dlp2OwnerBalanceBefore =
        await ethers.provider.getBalance(dlp2Owner);
      const dlp3OwnerBalanceBefore =
        await ethers.provider.getBalance(dlp3Owner);
      const user1BalanceBefore = await ethers.provider.getBalance(user1);

      const tx1 = await root.connect(dlp1Owner).claimReward(1);
      await tx1.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp1Owner, 1, 1, (dlp1Epoch1StakersReward * 100n) / 175n);
      const tx2 = await root.connect(dlp2Owner).claimReward(2);
      await tx2.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp2Owner, 2, 1, dlp2Epoch1StakersReward);
      const tx3 = await root.connect(dlp3Owner).claimReward(3);
      await tx3.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp3Owner, 3, 1, dlp3Epoch1StakersReward);

      const tx4 = await root.connect(user1).claimReward(1);
      await tx4.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(user1, 1, 1, (dlp1Epoch1StakersReward * 75n) / 175n);

      (await root.createStakerDlpEpochs(dlp1Owner, 1, 1)).claimAmount.should.eq(
        (dlp1Epoch1StakersReward * 100n) / 175n,
      );
      (await root.createStakerDlpEpochs(dlp2Owner, 2, 1)).claimAmount.should.eq(
        dlp2Epoch1StakersReward,
      );
      (await root.createStakerDlpEpochs(dlp3Owner, 3, 1)).claimAmount.should.eq(
        dlp3Epoch1StakersReward,
      );

      (await root.createStakerDlpEpochs(user1, 1, 1)).claimAmount.should.eq(
        (dlp1Epoch1StakersReward * 75n) / 175n,
      );

      (await root.createStakerDlps(dlp1Owner, 1)).lastClaimedEpochId.should.eq(
        1,
      );
      (await root.createStakerDlps(dlp2Owner, 2)).lastClaimedEpochId.should.eq(
        1,
      );
      (await root.createStakerDlps(dlp3Owner, 3)).lastClaimedEpochId.should.eq(
        1,
      );
      (await root.createStakerDlps(user1, 1)).lastClaimedEpochId.should.eq(1);

      (await root.claimableAmount(dlp1Owner, 1)).should.eq(0);
      (await root.claimableAmount(dlp2Owner, 2)).should.eq(0);
      (await root.claimableAmount(dlp3Owner, 3)).should.eq(0);
      (await root.claimableAmount(user1, 1)).should.eq(0);

      (await ethers.provider.getBalance(dlp1Owner)).should.eq(
        dlp1OwnerBalanceBefore +
          (dlp1Epoch1StakersReward * 100n) / 175n -
          (await getReceipt(tx1)).fee,
      );

      (await ethers.provider.getBalance(dlp2Owner)).should.eq(
        dlp2OwnerBalanceBefore +
          dlp2Epoch1StakersReward -
          (await getReceipt(tx2)).fee,
      );

      (await ethers.provider.getBalance(dlp3Owner)).should.eq(
        dlp3OwnerBalanceBefore +
          dlp3Epoch1StakersReward -
          (await getReceipt(tx3)).fee,
      );

      (await ethers.provider.getBalance(user1)).should.eq(
        user1BalanceBefore +
          (dlp1Epoch1StakersReward * 75n) / 175n -
          (await getReceipt(tx4)).fee,
      );
    });

    it("should reject claimReward when already claimed", async function () {
      await root
        .connect(dlp1Owner)
        .registerDlp(dlp1, dlp1Owner, parseEther(25), {
          value: parseEther(100),
        });
      await root
        .connect(dlp2Owner)
        .registerDlp(dlp2, dlp2Owner, parseEther(50), {
          value: parseEther(100),
        });
      await root
        .connect(dlp3Owner)
        .registerDlp(dlp3, dlp3Owner, parseEther(80), {
          value: parseEther(100),
        });

      await root.connect(user1).createStake(1, { value: parseEther(75) });

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      await advanceToEpochN(2);
      await root.connect(owner).createEpochs();

      await root.connect(dlp2Owner).claimReward(2);
      await root.connect(dlp3Owner).claimReward(3);
      await root.connect(dlp1Owner).claimReward(1);
      await root.connect(user1).claimReward(1);

      (await root.createStakerDlps(dlp1Owner, 1)).lastClaimedEpochId.should.eq(
        1,
      );
      (await root.createStakerDlps(dlp2Owner, 2)).lastClaimedEpochId.should.eq(
        1,
      );
      (await root.createStakerDlps(dlp3Owner, 3)).lastClaimedEpochId.should.eq(
        1,
      );
      (await root.createStakerDlps(user1, 1)).lastClaimedEpochId.should.eq(1);

      (await root.claimableAmount(dlp1Owner, 1)).should.eq(0);
      (await root.claimableAmount(dlp2Owner, 2)).should.eq(0);
      (await root.claimableAmount(dlp3Owner, 3)).should.eq(0);
      (await root.claimableAmount(user1, 1)).should.eq(0);

      await root
        .connect(dlp2Owner)
        .claimReward(2)
        .should.be.rejectedWith("NothingToClaim()");
      await root
        .connect(dlp3Owner)
        .claimReward(3)
        .should.be.rejectedWith("NothingToClaim()");
      await root
        .connect(dlp1Owner)
        .claimReward(1)
        .should.be.rejectedWith("NothingToClaim()");
      await root
        .connect(user1)
        .claimReward(1)
        .should.be.rejectedWith("NothingToClaim()");
    });

    it("should reject claimReward when stakersReward = 0", async function () {
      await root
        .connect(dlp1Owner)
        .registerDlp(dlp1, dlp1Owner, parseEther(0), {
          value: parseEther(100),
        });
      await root
        .connect(dlp2Owner)
        .registerDlp(dlp2, dlp2Owner, parseEther(50), {
          value: parseEther(100),
        });
      await root
        .connect(dlp3Owner)
        .registerDlp(dlp3, dlp3Owner, parseEther(80), {
          value: parseEther(100),
        });

      await root.connect(user1).createStake(1, { value: parseEther(75) });

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      await advanceToEpochN(2);
      await root.connect(owner).createEpochs();

      await root
        .connect(dlp1Owner)
        .claimReward(1)
        .should.be.rejectedWith("NothingToClaim()");
      await root.connect(dlp2Owner).claimReward(2);
      await root.connect(dlp3Owner).claimReward(3);
      await root
        .connect(user1)
        .claimReward(1)
        .should.be.rejectedWith("NothingToClaim()");

      (await root.createStakerDlps(dlp1Owner, 1)).lastClaimedEpochId.should.eq(
        0,
      );
      (await root.createStakerDlps(dlp2Owner, 2)).lastClaimedEpochId.should.eq(
        1,
      );
      (await root.createStakerDlps(dlp3Owner, 3)).lastClaimedEpochId.should.eq(
        1,
      );
      (await root.createStakerDlps(user1, 1)).lastClaimedEpochId.should.eq(0);
    });

    it("should reject claimReward when dlp not in epoch", async function () {
      await root
        .connect(dlp1Owner)
        .registerDlp(dlp1, dlp1Owner, parseEther(50), {
          value: parseEther(100),
        });
      await root
        .connect(dlp2Owner)
        .registerDlp(dlp2, dlp2Owner, parseEther(50), {
          value: parseEther(200),
        });
      await root
        .connect(dlp3Owner)
        .registerDlp(dlp3, dlp3Owner, parseEther(80), {
          value: parseEther(200),
        });
      await root
        .connect(dlp4Owner)
        .registerDlp(dlp4, dlp4Owner, parseEther(80), {
          value: parseEther(200),
        });

      await root.connect(user1).createStake(1, { value: parseEther(75) });

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      await advanceToEpochN(2);
      await root.connect(owner).createEpochs();

      await root
        .connect(user1)
        .claimReward(1)
        .should.be.rejectedWith("NothingToClaim()");
      await root
        .connect(dlp1Owner)
        .claimReward(1)
        .should.be.rejectedWith("NothingToClaim()");
    });

    it("should reject claimReward when no staking", async function () {
      await root
        .connect(dlp1Owner)
        .registerDlp(dlp1, dlp1Owner, parseEther(25), {
          value: parseEther(100),
        });
      await root
        .connect(dlp2Owner)
        .registerDlp(dlp2, dlp2Owner, parseEther(50), {
          value: parseEther(100),
        });
      await root
        .connect(dlp3Owner)
        .registerDlp(dlp3, dlp3Owner, parseEther(80), {
          value: parseEther(100),
        });

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      await advanceToEpochN(2);
      await root.connect(owner).createEpochs();

      await root.connect(dlp1Owner).claimReward(1);
      await root.connect(dlp2Owner).claimReward(2);
      await root.connect(dlp3Owner).claimReward(3);
      await root
        .connect(user1)
        .claimReward(1)
        .should.be.rejectedWith("NothingToClaim()");
    });

    it("should claimReward #master test", async function () {
      await root
        .connect(dlp1Owner)
        .registerDlp(dlp1, dlp1Owner, parseEther(25), {
          value: parseEther(100),
        });
      await root
        .connect(dlp2Owner)
        .registerDlp(dlp2, dlp2Owner, parseEther(50), {
          value: parseEther(100),
        });
      await root
        .connect(dlp3Owner)
        .registerDlp(dlp3, dlp3Owner, parseEther(80), {
          value: parseEther(100),
        });
      await root
        .connect(dlp4Owner)
        .registerDlp(dlp4, dlp4Owner, parseEther(10), {
          value: parseEther(100),
        });

      await advanceToEpochN(1);
      await root.connect(owner).createEpochs();

      await root.connect(user1).createStake(1, { value: parseEther(50) });

      await advanceToEpochN(2);
      await root.connect(owner).createEpochs();

      await root.connect(user2).createStake(2, { value: parseEther(350) });
      await root.connect(user3).createStake(3, { value: parseEther(250) });
      await root.connect(user4).createStake(4, { value: parseEther(150) });

      (await root.epochs(1)).dlpIds.should.deep.eq([1, 2, 3]);

      const dlp1Epoch1Reward = (epochRewardAmount * 20n) / 100n;
      const dlp2Epoch1Reward = (epochRewardAmount * 30n) / 100n;
      const dlp3Epoch1Reward = (epochRewardAmount * 50n) / 100n;
      const dlp4Epoch1Reward = (epochRewardAmount * 0n) / 100n;

      (await root.dlpEpochs(1, 1)).rewardAmount.should.eq(dlp1Epoch1Reward);
      (await root.dlpEpochs(2, 1)).rewardAmount.should.eq(dlp2Epoch1Reward);
      (await root.dlpEpochs(3, 1)).rewardAmount.should.eq(dlp3Epoch1Reward);
      (await root.dlpEpochs(4, 1)).rewardAmount.should.eq(dlp4Epoch1Reward);

      const dlp1Epoch1StakersReward = (dlp1Epoch1Reward * 25n) / 100n;
      const dlp2Epoch1StakersReward = (dlp2Epoch1Reward * 50n) / 100n;
      const dlp3Epoch1StakersReward = (dlp3Epoch1Reward * 80n) / 100n;

      const dlp1OwnerDlp1Epoch1Reward = dlp1Epoch1StakersReward;
      const dlp2OwnerDlp2Epoch1Reward = dlp2Epoch1StakersReward;
      const dlp3OwnerDlp3Epoch1Reward = dlp3Epoch1StakersReward;
      const dlp4OwnerDlp4Epoch1Reward = 0n;

      (await root.claimableAmount(dlp1Owner, 1)).should.eq(
        dlp1OwnerDlp1Epoch1Reward,
      );
      (await root.claimableAmount(dlp2Owner, 2)).should.eq(
        dlp2OwnerDlp2Epoch1Reward,
      );
      (await root.claimableAmount(dlp3Owner, 3)).should.eq(
        dlp3OwnerDlp3Epoch1Reward,
      );
      (await root.claimableAmount(dlp4Owner, 4)).should.eq(
        dlp4OwnerDlp4Epoch1Reward,
      );

      await advanceToEpochN(3);
      await root.connect(owner).createEpochs();

      await root.connect(user2).createStake(1, { value: parseEther(450) });

      await root
        .connect(dlp1Owner)
        .updateDlpStakersPercentage(1, parseEther(70));

      (await root.epochs(2)).dlpIds.should.deep.eq([1, 2, 3]);

      const dlp1Epoch2Reward = (epochRewardAmount * 30n) / 100n;
      const dlp2Epoch2Reward = (epochRewardAmount * 30n) / 100n;
      const dlp3Epoch2Reward = (epochRewardAmount * 40n) / 100n;
      const dlp4Epoch2Reward = 0;

      (await root.dlpEpochs(1, 2)).rewardAmount.should.eq(dlp1Epoch2Reward);
      (await root.dlpEpochs(2, 2)).rewardAmount.should.eq(dlp2Epoch2Reward);
      (await root.dlpEpochs(3, 2)).rewardAmount.should.eq(dlp3Epoch2Reward);
      (await root.dlpEpochs(4, 2)).rewardAmount.should.eq(dlp4Epoch2Reward);

      const dlp1Epoch2StakersReward = (dlp1Epoch2Reward * 25n) / 100n;
      const dlp2Epoch2StakersReward = (dlp2Epoch2Reward * 50n) / 100n;
      const dlp3Epoch2StakersReward = (dlp3Epoch2Reward * 80n) / 100n;

      const dlp1OwnerDlp1Epoch2Reward =
        (dlp1Epoch2StakersReward * 100n) / (100n + 50n);
      const dlp2OwnerDlp2Epoch2Reward = dlp2Epoch2StakersReward;
      const dlp3OwnerDlp3Epoch2Reward = dlp3Epoch2StakersReward;
      const dlp4OwnerDlp4Epoch2Reward = 0n;
      const user1Dlp1Epoch2Reward =
        (dlp1Epoch2StakersReward * 50n) / (100n + 50n);
      const user2Dlp2Epoch2Reward = 0n;
      const user3Dlp3Epoch2Reward = 0n;
      const user4Dlp4Epoch2Reward = 0n;

      (await root.claimableAmount(dlp1Owner, 1)).should.eq(
        dlp1OwnerDlp1Epoch1Reward + dlp1OwnerDlp1Epoch2Reward,
      );
      (await root.claimableAmount(dlp2Owner, 2)).should.eq(
        dlp2OwnerDlp2Epoch1Reward + dlp2OwnerDlp2Epoch2Reward,
      );
      (await root.claimableAmount(dlp3Owner, 3)).should.eq(
        dlp3OwnerDlp3Epoch1Reward + dlp3OwnerDlp3Epoch2Reward,
      );
      (await root.claimableAmount(dlp4Owner, 4)).should.eq(
        dlp4OwnerDlp4Epoch1Reward + dlp4OwnerDlp4Epoch2Reward,
      );
      (await root.claimableAmount(user1, 1)).should.eq(user1Dlp1Epoch2Reward);
      (await root.claimableAmount(user2, 2)).should.eq(user2Dlp2Epoch2Reward);
      (await root.claimableAmount(user3, 3)).should.eq(user3Dlp3Epoch2Reward);
      (await root.claimableAmount(user4, 4)).should.eq(user4Dlp4Epoch2Reward);

      await advanceToEpochN(5);
      await root.connect(owner).createEpochs();

      (await root.epochs(3)).dlpIds.should.deep.eq([2, 3, 4]);
      const dlp1Epoch3Reward = (epochRewardAmount * 0n) / 100n;
      const dlp2Epoch3Reward = (epochRewardAmount * 80n) / 100n;
      const dlp3Epoch3Reward = (epochRewardAmount * 10n) / 100n;
      const dlp4Epoch3Reward = (epochRewardAmount * 10n) / 100n;

      (await root.dlpEpochs(1, 3)).rewardAmount.should.eq(dlp1Epoch3Reward);
      (await root.dlpEpochs(2, 3)).rewardAmount.should.eq(dlp2Epoch3Reward);
      (await root.dlpEpochs(3, 3)).rewardAmount.should.eq(dlp3Epoch3Reward);
      (await root.dlpEpochs(4, 3)).rewardAmount.should.eq(dlp4Epoch3Reward);

      const dlp2Epoch3StakersReward = (dlp2Epoch3Reward * 50n) / 100n;
      const dlp3Epoch3StakersReward = (dlp3Epoch3Reward * 80n) / 100n;
      const dlp4Epoch3StakersReward = (dlp4Epoch3Reward * 10n) / 100n;

      const dlp1OwnerDlp1Epoch3Reward = 0n;
      const dlp2OwnerDlp2Epoch3Reward =
        (dlp2Epoch3StakersReward * 100n) / (100n + 350n);
      const dlp3OwnerDlp3Epoch3Reward =
        (dlp3Epoch3StakersReward * 100n) / (100n + 250n);
      const dlp4OwnerDlp4Epoch3Reward =
        (dlp4Epoch3StakersReward * 100n) / (100n + 150n);
      const user1Dlp1Epoch3Reward = 0n;
      const user2Dlp2Epoch3Reward =
        (dlp2Epoch3StakersReward * 350n) / (100n + 350n);
      const user3Dlp3Epoch3Reward =
        (dlp3Epoch3StakersReward * 250n) / (100n + 250n);
      const user4Dlp4Epoch3Reward =
        (dlp4Epoch3StakersReward * 150n) / (100n + 150n);

      (await root.claimableAmount(dlp1Owner, 1)).should.eq(
        dlp1OwnerDlp1Epoch1Reward +
          dlp1OwnerDlp1Epoch2Reward +
          dlp1OwnerDlp1Epoch3Reward,
      );
      (await root.claimableAmount(dlp2Owner, 2)).should.eq(
        dlp2OwnerDlp2Epoch1Reward +
          dlp2OwnerDlp2Epoch2Reward +
          dlp2OwnerDlp2Epoch3Reward,
      );
      // @ts-ignore
      (await root.claimableAmount(dlp3Owner, 3)).should.to.be.almostEq(
        dlp3OwnerDlp3Epoch1Reward +
          dlp3OwnerDlp3Epoch2Reward +
          dlp3OwnerDlp3Epoch3Reward,
        1000n,
      );
      (await root.claimableAmount(dlp4Owner, 4)).should.eq(
        dlp4OwnerDlp4Epoch1Reward +
          dlp4OwnerDlp4Epoch2Reward +
          dlp4OwnerDlp4Epoch3Reward,
      );
      (await root.claimableAmount(user1, 1)).should.eq(
        user1Dlp1Epoch2Reward + user1Dlp1Epoch3Reward,
      );
      (await root.claimableAmount(user2, 2)).should.eq(
        user2Dlp2Epoch2Reward + user2Dlp2Epoch3Reward,
      );
      (await root.claimableAmount(user3, 3)).should.eq(
        user3Dlp3Epoch2Reward + user3Dlp3Epoch3Reward,
      );
      (await root.claimableAmount(user4, 4)).should.eq(
        user4Dlp4Epoch2Reward + user4Dlp4Epoch3Reward,
      );

      (await root.epochs(4)).dlpIds.should.deep.eq([1, 2, 3]);

      const dlp1Epoch4Reward = (epochRewardAmount * 20n) / 100n;
      const dlp2Epoch4Reward = (epochRewardAmount * 20n) / 100n;
      const dlp3Epoch4Reward = (epochRewardAmount * 60n) / 100n;
      const dlp4Epoch4Reward = 0n;

      (await root.dlpEpochs(1, 4)).rewardAmount.should.eq(dlp1Epoch4Reward);
      (await root.dlpEpochs(2, 4)).rewardAmount.should.eq(dlp2Epoch4Reward);
      (await root.dlpEpochs(3, 4)).rewardAmount.should.eq(dlp3Epoch4Reward);
      (await root.dlpEpochs(4, 4)).rewardAmount.should.eq(dlp4Epoch4Reward);

      const dlp1Epoch4StakersReward = (dlp1Epoch4Reward * 70n) / 100n;
      const dlp2Epoch4StakersReward = (dlp2Epoch4Reward * 50n) / 100n;
      const dlp3Epoch4StakersReward = (dlp3Epoch4Reward * 80n) / 100n;

      const dlp1OwnerDlp1Epoch4Reward =
        (dlp1Epoch4StakersReward * 100n) / (100n + 50n + 450n);
      const dlp2OwnerDlp2Epoch4Reward =
        (dlp2Epoch4StakersReward * 100n) / (100n + 350n);
      const dlp3OwnerDlp3Epoch4Reward =
        (dlp3Epoch4StakersReward * 100n) / (100n + 250n);
      const dlp4OwnerDlp4Epoch4Reward = 0n;
      const user1Dlp1Epoch4Reward =
        (dlp1Epoch4StakersReward * 50n) / (100n + 50n + 450n);
      const user2Dlp1Epoch4Reward =
        (dlp1Epoch4StakersReward * 450n) / (100n + 50n + 450n);
      const user2Dlp2Epoch4Reward =
        (dlp2Epoch4StakersReward * 350n) / (100n + 350n);
      const user3Dlp3Epoch4Reward =
        (dlp3Epoch4StakersReward * 250n) / (100n + 250n);
      const user4Dlp4Epoch4Reward = 0n;

      (await root.claimableAmount(dlp1Owner, 1)).should.eq(
        dlp1OwnerDlp1Epoch1Reward +
          dlp1OwnerDlp1Epoch2Reward +
          dlp1OwnerDlp1Epoch3Reward +
          dlp1OwnerDlp1Epoch4Reward,
      );
      (await root.claimableAmount(dlp2Owner, 2)).should.eq(
        dlp2OwnerDlp2Epoch1Reward +
          dlp2OwnerDlp2Epoch2Reward +
          dlp2OwnerDlp2Epoch3Reward +
          dlp2OwnerDlp2Epoch4Reward,
      );

      // @ts-ignore
      (await root.claimableAmount(dlp3Owner, 3)).should.almostEq(
        dlp3OwnerDlp3Epoch1Reward +
          dlp3OwnerDlp3Epoch2Reward +
          dlp3OwnerDlp3Epoch3Reward +
          dlp3OwnerDlp3Epoch4Reward,
      );
      (await root.claimableAmount(dlp4Owner, 4)).should.eq(
        dlp4OwnerDlp4Epoch1Reward +
          dlp4OwnerDlp4Epoch2Reward +
          dlp4OwnerDlp4Epoch3Reward +
          dlp4OwnerDlp4Epoch4Reward,
      );
      (await root.claimableAmount(user1, 1)).should.eq(
        user1Dlp1Epoch2Reward + user1Dlp1Epoch3Reward + user1Dlp1Epoch4Reward,
      );
      (await root.claimableAmount(user2, 1)).should.eq(user2Dlp1Epoch4Reward);
      (await root.claimableAmount(user2, 2)).should.eq(
        user2Dlp2Epoch2Reward + user2Dlp2Epoch3Reward + user2Dlp2Epoch4Reward,
      );
      // @ts-ignore
      (await root.claimableAmount(user3, 3)).should.almostEq(
        user3Dlp3Epoch2Reward + user3Dlp3Epoch3Reward + user3Dlp3Epoch4Reward,
      );
      (await root.claimableAmount(user4, 4)).should.eq(
        user4Dlp4Epoch2Reward + user4Dlp4Epoch3Reward + user4Dlp4Epoch4Reward,
      );

      // *****************************

      (await root.createStakerDlps(dlp1Owner, 1)).lastClaimedEpochId.should.eq(
        0,
      );
      (await root.createStakerDlps(dlp2Owner, 2)).lastClaimedEpochId.should.eq(
        0,
      );
      (await root.createStakerDlps(dlp3Owner, 3)).lastClaimedEpochId.should.eq(
        0,
      );
      (await root.createStakerDlps(user1, 1)).lastClaimedEpochId.should.eq(1);
      (await root.createStakerDlps(user2, 1)).lastClaimedEpochId.should.eq(3);
      (await root.createStakerDlps(user2, 2)).lastClaimedEpochId.should.eq(2);
      (await root.createStakerDlps(user3, 3)).lastClaimedEpochId.should.eq(2);
      (await root.createStakerDlps(user4, 4)).lastClaimedEpochId.should.eq(2);

      const dlp1OwnerBalanceBefore =
        await ethers.provider.getBalance(dlp1Owner);
      const dlp2OwnerBalanceBefore =
        await ethers.provider.getBalance(dlp2Owner);
      const dlp3OwnerBalanceBefore =
        await ethers.provider.getBalance(dlp3Owner);
      const dlp4OwnerBalanceBefore =
        await ethers.provider.getBalance(dlp4Owner);
      const user1BalanceBefore = await ethers.provider.getBalance(user1);
      const user2BalanceBefore = await ethers.provider.getBalance(user2);
      const user3BalanceBefore = await ethers.provider.getBalance(user3);
      const user4BalanceBefore = await ethers.provider.getBalance(user4);

      const tx1 = await root.connect(dlp1Owner).claimReward(1);
      await tx1.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp1Owner, 1, 1, dlp1OwnerDlp1Epoch1Reward)
        .and.emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp1Owner, 1, 2, dlp1OwnerDlp1Epoch2Reward)
        .and.emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp1Owner, 1, 4, dlp1OwnerDlp1Epoch4Reward);

      const tx2 = await root.connect(dlp2Owner).claimReward(2);
      await tx2.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp2Owner, 2, 1, dlp2OwnerDlp2Epoch1Reward)
        .and.emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp2Owner, 2, 2, dlp2OwnerDlp2Epoch2Reward)
        .and.emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp2Owner, 2, 3, dlp2OwnerDlp2Epoch3Reward)
        .and.emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp2Owner, 2, 4, dlp2OwnerDlp2Epoch4Reward);

      const tx3 = await root.connect(dlp3Owner).claimReward(3);
      await tx3.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp3Owner, 3, 1, dlp3OwnerDlp3Epoch1Reward)
        .and.emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp3Owner, 3, 2, dlp3OwnerDlp3Epoch2Reward)
        // .and.emit(root, "StakerDlpEpochRewardClaimed")
        // .withArgs(dlp3Owner, 3, 3, dlp3OwnerDlp3Epoch3Reward)
        .and.emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp3Owner, 3, 4, dlp3OwnerDlp3Epoch4Reward);

      const tx4 = await root.connect(dlp4Owner).claimReward(4);
      await tx4.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(dlp4Owner, 4, 3, dlp4OwnerDlp4Epoch3Reward);

      const tx5 = await root.connect(user1).claimReward(1);
      await tx5.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .and.emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(user1, 1, 2, user1Dlp1Epoch2Reward)
        .and.emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(user1, 1, 4, user1Dlp1Epoch4Reward);

      const tx6 = await root.connect(user2).claimReward(1);
      await tx6.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(user2, 1, 4, user2Dlp1Epoch4Reward);

      const tx7 = await root.connect(user2).claimReward(2);
      await tx7.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .and.emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(user2, 2, 3, user2Dlp2Epoch3Reward)
        .and.emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(user2, 2, 4, user2Dlp2Epoch4Reward);

      const tx8 = await root.connect(user3).claimReward(3);
      await tx8.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .and.emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(user3, 3, 3, user3Dlp3Epoch3Reward);
      // .and.emit(root, "StakerDlpEpochRewardClaimed")
      // .withArgs(user3, 3, 4, user3Dlp3Epoch4Reward);

      const tx9 = await root.connect(user4).claimReward(4);
      await tx9.should
        .emit(root, "StakerDlpEpochRewardClaimed")
        .and.emit(root, "StakerDlpEpochRewardClaimed")
        .withArgs(user4, 4, 3, user4Dlp4Epoch3Reward);

      (await root.createStakerDlpEpochs(dlp1Owner, 1, 1)).claimAmount.should.eq(
        dlp1OwnerDlp1Epoch1Reward,
      );
      (await root.createStakerDlpEpochs(dlp1Owner, 1, 2)).claimAmount.should.eq(
        dlp1OwnerDlp1Epoch2Reward,
      );
      (await root.createStakerDlpEpochs(dlp1Owner, 1, 3)).claimAmount.should.eq(
        dlp1OwnerDlp1Epoch3Reward,
      );
      (await root.createStakerDlpEpochs(dlp1Owner, 1, 4)).claimAmount.should.eq(
        dlp1OwnerDlp1Epoch4Reward,
      );
      (await root.createStakerDlpEpochs(dlp2Owner, 2, 1)).claimAmount.should.eq(
        dlp2OwnerDlp2Epoch1Reward,
      );
      (await root.createStakerDlpEpochs(dlp2Owner, 2, 2)).claimAmount.should.eq(
        dlp2OwnerDlp2Epoch2Reward,
      );
      (await root.createStakerDlpEpochs(dlp2Owner, 2, 3)).claimAmount.should.eq(
        dlp2OwnerDlp2Epoch3Reward,
      );
      (await root.createStakerDlpEpochs(dlp2Owner, 2, 4)).claimAmount.should.eq(
        dlp2OwnerDlp2Epoch4Reward,
      );
      (await root.createStakerDlpEpochs(dlp3Owner, 3, 1)).claimAmount.should.eq(
        dlp3OwnerDlp3Epoch1Reward,
      );
      (await root.createStakerDlpEpochs(dlp3Owner, 3, 2)).claimAmount.should.eq(
        dlp3OwnerDlp3Epoch2Reward,
      );
      // @ts-ignore
      (
        await root.createStakerDlpEpochs(dlp3Owner, 3, 3)
      ).claimAmount.should.almostEq(dlp3OwnerDlp3Epoch3Reward);
      (await root.createStakerDlpEpochs(dlp3Owner, 3, 4)).claimAmount.should.eq(
        dlp3OwnerDlp3Epoch4Reward,
      );
      (await root.createStakerDlpEpochs(dlp4Owner, 4, 3)).claimAmount.should.eq(
        dlp4OwnerDlp4Epoch3Reward,
      );
      (await root.createStakerDlpEpochs(user1, 1, 2)).claimAmount.should.eq(
        user1Dlp1Epoch2Reward,
      );
      (await root.createStakerDlpEpochs(user1, 1, 3)).claimAmount.should.eq(
        user1Dlp1Epoch3Reward,
      );
      (await root.createStakerDlpEpochs(user1, 1, 4)).claimAmount.should.eq(
        user1Dlp1Epoch4Reward,
      );
      (await root.createStakerDlpEpochs(user2, 1, 4)).claimAmount.should.eq(
        user2Dlp1Epoch4Reward,
      );
      (await root.createStakerDlpEpochs(user2, 2, 2)).claimAmount.should.eq(
        user2Dlp2Epoch2Reward,
      );
      (await root.createStakerDlpEpochs(user2, 2, 3)).claimAmount.should.eq(
        user2Dlp2Epoch3Reward,
      );
      (await root.createStakerDlpEpochs(user2, 2, 4)).claimAmount.should.eq(
        user2Dlp2Epoch4Reward,
      );
      (await root.createStakerDlpEpochs(user3, 3, 2)).claimAmount.should.eq(
        user3Dlp3Epoch2Reward,
      );
      (await root.createStakerDlpEpochs(user3, 3, 3)).claimAmount.should.eq(
        user3Dlp3Epoch3Reward,
      );
      // @ts-ignore
      (
        await root.createStakerDlpEpochs(user3, 3, 4)
      ).claimAmount.should.almostEq(user3Dlp3Epoch4Reward);
      (await root.createStakerDlpEpochs(user4, 4, 2)).claimAmount.should.eq(
        user4Dlp4Epoch2Reward,
      );
      (await root.createStakerDlpEpochs(user4, 4, 3)).claimAmount.should.eq(
        user4Dlp4Epoch3Reward,
      );
      (await root.createStakerDlpEpochs(user4, 4, 4)).claimAmount.should.eq(
        user4Dlp4Epoch4Reward,
      );

      (await root.createStakerDlps(dlp1Owner, 1)).lastClaimedEpochId.should.eq(
        4,
      );
      (await root.createStakerDlps(dlp2Owner, 2)).lastClaimedEpochId.should.eq(
        4,
      );
      (await root.createStakerDlps(dlp3Owner, 3)).lastClaimedEpochId.should.eq(
        4,
      );
      (await root.createStakerDlps(dlp4Owner, 4)).lastClaimedEpochId.should.eq(
        4,
      );
      (await root.createStakerDlps(user1, 1)).lastClaimedEpochId.should.eq(4);
      (await root.createStakerDlps(user2, 1)).lastClaimedEpochId.should.eq(4);
      (await root.createStakerDlps(user2, 2)).lastClaimedEpochId.should.eq(4);
      (await root.createStakerDlps(user3, 3)).lastClaimedEpochId.should.eq(4);
      (await root.createStakerDlps(user4, 4)).lastClaimedEpochId.should.eq(4);

      (await root.claimableAmount(dlp1Owner, 1)).should.eq(0);
      (await root.claimableAmount(dlp2Owner, 2)).should.eq(0);
      (await root.claimableAmount(dlp3Owner, 3)).should.eq(0);
      (await root.claimableAmount(dlp4Owner, 4)).should.eq(0);
      (await root.claimableAmount(user1, 1)).should.eq(0);
      (await root.claimableAmount(user2, 1)).should.eq(0);
      (await root.claimableAmount(user2, 2)).should.eq(0);
      (await root.claimableAmount(user3, 3)).should.eq(0);
      (await root.claimableAmount(user4, 4)).should.eq(0);

      (await ethers.provider.getBalance(dlp1Owner)).should.eq(
        dlp1OwnerBalanceBefore +
          dlp1OwnerDlp1Epoch1Reward +
          dlp1OwnerDlp1Epoch2Reward +
          dlp1OwnerDlp1Epoch3Reward +
          dlp1OwnerDlp1Epoch4Reward -
          (await getReceipt(tx1)).fee,
      );

      (await ethers.provider.getBalance(dlp2Owner)).should.eq(
        dlp2OwnerBalanceBefore +
          dlp2OwnerDlp2Epoch1Reward +
          dlp2OwnerDlp2Epoch2Reward +
          dlp2OwnerDlp2Epoch3Reward +
          dlp2OwnerDlp2Epoch4Reward -
          (await getReceipt(tx2)).fee,
      );

      // @ts-ignore
      (await ethers.provider.getBalance(dlp3Owner)).should.almostEq(
        dlp3OwnerBalanceBefore +
          dlp3OwnerDlp3Epoch1Reward +
          dlp3OwnerDlp3Epoch2Reward +
          dlp3OwnerDlp3Epoch3Reward +
          dlp3OwnerDlp3Epoch4Reward -
          (await getReceipt(tx3)).fee,
      );

      (await ethers.provider.getBalance(dlp4Owner)).should.eq(
        dlp4OwnerBalanceBefore +
          dlp4OwnerDlp4Epoch1Reward +
          dlp4OwnerDlp4Epoch2Reward +
          dlp4OwnerDlp4Epoch3Reward +
          dlp4OwnerDlp4Epoch4Reward -
          (await getReceipt(tx4)).fee,
      );

      (await ethers.provider.getBalance(user1)).should.eq(
        user1BalanceBefore +
          user1Dlp1Epoch2Reward +
          user1Dlp1Epoch3Reward +
          user1Dlp1Epoch4Reward -
          (await getReceipt(tx5)).fee,
      );

      (await ethers.provider.getBalance(user2)).should.eq(
        user2BalanceBefore +
          user2Dlp1Epoch4Reward +
          user2Dlp2Epoch2Reward +
          user2Dlp2Epoch3Reward +
          user2Dlp2Epoch4Reward -
          (await getReceipt(tx6)).fee -
          (await getReceipt(tx7)).fee,
      );

      // @ts-ignore
      (await ethers.provider.getBalance(user3)).should.almostEq(
        user3BalanceBefore +
          user3Dlp3Epoch2Reward +
          user3Dlp3Epoch3Reward +
          user3Dlp3Epoch4Reward -
          (await getReceipt(tx8)).fee,
      );

      (await ethers.provider.getBalance(user4)).should.eq(
        user4BalanceBefore +
          user4Dlp4Epoch2Reward +
          user4Dlp4Epoch3Reward +
          user4Dlp4Epoch4Reward -
          (await getReceipt(tx9)).fee,
      );
    });
  });
});
