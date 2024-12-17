import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import {
  DAT,
  DataLiquidityPoolImplementation,
  DataRegistryImplementation,
  TeePoolImplementation,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Proof, proofs, signProof } from "./helpers/dataRegistryHelpers";
import { parseEther } from "../utils/helpers";

chai.use(chaiAsPromised);
should();

describe("DataLiquidityPool", () => {
  let trustedForwarder: HardhatEthersSigner;
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;
  let user4: HardhatEthersSigner;
  let user5: HardhatEthersSigner;
  let tee0: HardhatEthersSigner;
  let sponsor: HardhatEthersSigner;

  let dlp: DataLiquidityPoolImplementation;
  let dat: DAT;
  let dataRegistry: DataRegistryImplementation;
  let teePool: TeePoolImplementation;

  const dlpName = "Test DLP";
  const dlpTokenName = "Test Data Autonomy Token";
  const dlpTokenSymbol = "TDAT";
  let fileRewardFactor = parseEther("3");
  let teePoolCancelDelay = 100;

  const dlpInitialBalance = parseEther("1000000");
  const user1InitialBalance = parseEther("1000000");
  const ownerInitialBalance = parseEther("10000000");

  const proofInstruction =
    "https://ipfs.io/ipfs/qf34f34q4fq3fgdsgjgbdugsgwegqlgqhfejrfqjfwjfeql3u4iq4u47ll1";

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );

  const deploy = async () => {
    [
      trustedForwarder,
      deployer,
      owner,
      user1,
      user2,
      user3,
      user4,
      user5,
      tee0,
      sponsor,
    ] = await ethers.getSigners();

    const datDeploy = await ethers.deployContract("DAT", [
      dlpTokenName,
      dlpTokenSymbol,
      owner,
    ]);
    dat = await ethers.getContractAt("DAT", datDeploy.target);

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

    const teePoolDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("TeePoolImplementation"),
      [
        trustedForwarder.address,
        owner.address,
        dataRegistry.target,
        teePoolCancelDelay,
      ],
      {
        kind: "uups",
      },
    );

    teePool = await ethers.getContractAt(
      "TeePoolImplementation",
      teePoolDeploy.target,
    );

    await teePool
      .connect(owner)
      .addTee(tee0.address, "tee0Url", "tee0PublicKey");

    const dlpDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DataLiquidityPoolImplementation"),
      [
        {
          trustedForwarder: trustedForwarder.address,
          ownerAddress: owner.address,
          tokenAddress: dat.target,
          dataRegistryAddress: dataRegistry.target,
          teePoolAddress: teePool.target,
          name: dlpName,
          publicKey: "publicKey",
          proofInstruction: proofInstruction,
          fileRewardFactor: fileRewardFactor,
        },
      ],
      {
        kind: "uups",
      },
    );

    dlp = await ethers.getContractAt(
      "DataLiquidityPoolImplementation",
      dlpDeploy.target,
    );

    await dat.connect(owner).mint(user1, user1InitialBalance);
    await dat.connect(owner).mint(owner, ownerInitialBalance);
  };

  describe("Setup", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should have correct params after deploy", async function () {
      (await dlp.name()).should.eq(dlpName);
      (await dataRegistry.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(true);
      (await dataRegistry.hasRole(MAINTAINER_ROLE, owner)).should.eq(true);
      (await dlp.token()).should.eq(dat);
      (await dlp.teePool()).should.eq(teePool);
      (await dlp.dataRegistry()).should.eq(dataRegistry);
      (await dlp.publicKey()).should.eq("publicKey");
      (await dlp.paused()).should.eq(false);
      (await dlp.fileRewardFactor()).should.eq(fileRewardFactor);
      (await dlp.version()).should.eq(1);
    });

    it("Should pause when owner", async function () {
      await dlp
        .connect(owner)
        .pause()
        .should.emit(dlp, "Paused")
        .withArgs(owner.address);
      (await dlp.paused()).should.be.equal(true);
    });

    it("Should reject pause when non-owner", async function () {
      await dlp
        .connect(user1)
        .pause()
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
        );
      (await dlp.paused()).should.be.equal(false);
    });

    it("Should unpause when owner", async function () {
      await dlp.connect(owner).pause();
      await dlp
        .connect(owner)
        .unpause()
        .should.emit(dlp, "Unpaused")
        .withArgs(owner.address);
      (await dlp.paused()).should.be.equal(false);
    });

    it("Should reject unpause when non-owner", async function () {
      await dlp.connect(owner).pause();
      await dlp
        .connect(user1)
        .unpause()
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
        );
      (await dlp.paused()).should.be.equal(true);
    });

    it("Should updateFileRewardFactor when owner", async function () {
      await dlp
        .connect(owner)
        .updateFileRewardFactor(fileRewardFactor + 1n)
        .should.emit(dlp, "FileRewardFactorUpdated")
        .withArgs(fileRewardFactor + 1n);

      (await dlp.fileRewardFactor()).should.eq(fileRewardFactor + 1n);
    });

    it("Should reject updateFileRewardFactor when non-owner", async function () {
      await dlp
        .connect(user1)
        .updateFileRewardFactor(fileRewardFactor + 1n)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
        );

      (await dlp.fileRewardFactor()).should.eq(fileRewardFactor);
    });

    it("Should updateTeePool when owner", async function () {
      await dlp.connect(owner).updateTeePool(user1).should.be.fulfilled;

      (await dlp.teePool()).should.eq(user1);
    });

    it("Should reject updateFileRewardFactor when non-owner", async function () {
      await dlp
        .connect(user1)
        .updateTeePool(user1)
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
        );

      (await dlp.fileRewardFactor()).should.eq(fileRewardFactor);
    });

    it("Should updatePublicKey when owner", async function () {
      await dlp
        .connect(owner)
        .updatePublicKey("newPublicKey")
        .should.emit(dlp, "PublicKeyUpdated")
        .withArgs("newPublicKey");

      (await dlp.publicKey()).should.eq("newPublicKey");
    });

    it("Should reject updatePublicKey when non-owner", async function () {
      await dlp
        .connect(user1)
        .updatePublicKey("newPublicKey")
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
        );
    });

    it("Should updateProofInstruction when owner", async function () {
      await dlp
        .connect(owner)
        .updateProofInstruction("newProofInstruction")
        .should.emit(dlp, "ProofInstructionUpdated")
        .withArgs("newProofInstruction");

      (await dlp.proofInstruction()).should.eq("newProofInstruction");
    });

    it("Should reject updateProofInstruction when non-owner", async function () {
      await dlp
        .connect(user1)
        .updateProofInstruction("newProofInstruction")
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
        );
    });

    it("should change admin", async function () {
      await dlp.connect(owner).grantRole(MAINTAINER_ROLE, user1.address).should
        .not.be.rejected;

      await dlp.connect(owner).grantRole(DEFAULT_ADMIN_ROLE, user1.address)
        .should.be.fulfilled;

      await dlp.connect(user1).revokeRole(DEFAULT_ADMIN_ROLE, owner.address);

      await dlp
        .connect(owner)
        .updateFileRewardFactor(fileRewardFactor + 1n)
        .should.rejectedWith(
          `AccessControlUnauthorizedAccount("${owner.address}", "${DEFAULT_ADMIN_ROLE}`,
        );

      await dlp.connect(user1).updateFileRewardFactor(fileRewardFactor + 1n)
        .should.be.fulfilled;
    });

    it("Should upgradeTo when owner", async function () {
      await upgrades.upgradeProxy(
        dlp,
        await ethers.getContractFactory(
          "DataLiquidityPoolImplementationV2Mock",
          owner,
        ),
      );

      const newDlp = await ethers.getContractAt(
        "DataLiquidityPoolImplementationV2Mock",
        dlp,
      );

      (await newDlp.name()).should.eq(dlpName);
      (await newDlp.paused()).should.eq(false);
      (await newDlp.fileRewardFactor()).should.eq(fileRewardFactor);
      (await newDlp.version()).should.eq(2);

      (await newDlp.test()).should.eq("test");
    });

    it("Should upgradeTo when owner and emit event", async function () {
      const newDlpImplementation = await ethers.deployContract(
        "DataLiquidityPoolImplementationV2Mock",
      );

      await dlp
        .connect(owner)
        .upgradeToAndCall(newDlpImplementation, "0x")
        .should.emit(dlp, "Upgraded")
        .withArgs(newDlpImplementation);

      const newDlp = await ethers.getContractAt(
        "DataLiquidityPoolImplementationV2Mock",
        dlp,
      );

      (await newDlp.name()).should.eq(dlpName);
      (await newDlp.paused()).should.eq(false);
      (await newDlp.fileRewardFactor()).should.eq(fileRewardFactor);
      (await newDlp.version()).should.eq(2);

      (await newDlp.test()).should.eq("test");
    });

    it("Should reject upgradeTo when storage layout is incompatible", async function () {
      await upgrades
        .upgradeProxy(
          dlp,
          await ethers.getContractFactory(
            "DataLiquidityPoolImplementationV3Mock",
            owner,
          ),
        )
        .should.be.rejectedWith("New storage layout is incompatible");
    });

    it("Should reject upgradeTo when non owner", async function () {
      const newDlpImplementation = await ethers.deployContract(
        "DataLiquidityPoolImplementationV2Mock",
      );

      await dlp
        .connect(user1)
        .upgradeToAndCall(newDlpImplementation, "0x")
        .should.be.rejectedWith(
          `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
        );
    });
  });

  describe("RequestProof", () => {
    beforeEach(async () => {
      await deploy();

      await dat.connect(owner).approve(dlp.target, dlpInitialBalance);
      await dlp.connect(owner).addRewardsForContributors(dlpInitialBalance);
    });

    it("should requestReward #1", async function () {
      await dataRegistry
        .connect(sponsor)
        .addFileWithPermissions("file1Url", user1, []);

      await teePool.connect(sponsor).submitJob(1, { value: parseEther(0.01) });

      const proof1: Proof = {
        signature: await signProof(tee0, "file1Url", proofs[1].data),
        data: proofs[1].data,
      };

      await dataRegistry.connect(tee0).addProof(1, proof1);

      await dlp
        .connect(sponsor)
        .requestReward(1, 1)
        .should.emit(dlp, "RewardRequested")
        .withArgs(
          user1,
          1,
          1,
          (proofs[1].data.score * fileRewardFactor) / parseEther("1"),
        );

      (await dlp.filesListCount()).should.eq(1);

      const file1 = await dlp.files(1);
      file1.proofIndex.should.eq(1);
      file1.rewardAmount.should.eq(
        (proofs[1].data.score * fileRewardFactor) / parseEther("1"),
      );

      (await dlp.contributorFiles(user1, 0)).should.deep.eq(file1);

      (await dlp.contributorsCount()).should.eq(1);
      const contributor1 = await dlp.contributors(1);
      contributor1.contributorAddress.should.eq(user1);
      contributor1.filesListCount.should.eq(1);

      (await dlp.contributorInfo(user1)).should.deep.eq(contributor1);
    });

    it("should requestReward #2", async function () {
      await dataRegistry
        .connect(sponsor)
        .addFileWithPermissions("file2Url", user2, []);

      await dataRegistry
        .connect(sponsor)
        .addFileWithPermissions("file3Url", user2, []);

      await dataRegistry
        .connect(sponsor)
        .addFileWithPermissions("file1Url", user1, []);

      await teePool.connect(sponsor).submitJob(3, { value: parseEther(0.01) });

      const proof1: Proof = {
        signature: await signProof(tee0, "file1Url", proofs[2].data),
        data: proofs[2].data,
      };

      const proof2: Proof = {
        signature: await signProof(tee0, "file1Url", proofs[1].data),
        data: proofs[1].data,
      };

      await dataRegistry.connect(tee0).addProof(3, proof1);
      await dataRegistry.connect(tee0).addProof(3, proof2);

      await dlp
        .connect(sponsor)
        .requestReward(3, 2)
        .should.emit(dlp, "RewardRequested")
        .withArgs(
          user1,
          3,
          2,
          (proofs[1].data.score * fileRewardFactor) / parseEther("1"),
        );

      (await dlp.filesListCount()).should.eq(1);

      const file1 = await dlp.files(3);
      file1.fileId.should.eq(3);
      file1.proofIndex.should.eq(2);
      file1.rewardAmount.should.eq(
        (proofs[1].data.score * fileRewardFactor) / parseEther("1"),
      );

      (await dlp.contributorFiles(user1, 0)).should.deep.eq(file1);

      (await dlp.contributorsCount()).should.eq(1);
      const contributor1 = await dlp.contributors(1);
      contributor1.contributorAddress.should.eq(user1);
      contributor1.filesListCount.should.eq(1);

      (await dlp.contributorInfo(user1)).should.deep.eq(contributor1);

      (await dat.balanceOf(dlp)).should.eq(
        dlpInitialBalance - file1.rewardAmount,
      );
      (await dat.balanceOf(user1)).should.eq(
        user1InitialBalance + file1.rewardAmount,
      );
    });
  });
});
