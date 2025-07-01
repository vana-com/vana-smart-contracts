import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, network, upgrades } from "hardhat";
import {
  DLPRegistryImplementation,
  VanaEpochImplementation,
  TreasuryImplementation,
  DLPPerformanceImplementation,
  DLPRewardDeployerImplementation,
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  advanceBlockNTimes,
  advanceToBlockN,
  getCurrentBlockNumber,
} from "../../utils/timeAndBlockManipulation";
import { getReceipt, parseEther } from "../../utils/helpers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

chai.use(chaiAsPromised);
should();

describe("DLP fork tests", () => {
  const vanaEpochAddress = "0x2063cFF0609D59bCCc196E20Eb58A8696a6b15A0";
  const treasuryAddress = "0xb12ce1d27bEeFe39b6F0110b1AB77C21Aa0c9F9a";
  const dlpRegistryAddress = "0x4D59880a924526d1dD33260552Ff4328b1E18a43";
  const dlpPerformanceAddress = "0x847715C7DB37cF286611182Be0bD333cbfa29cc1";
  const dlpRewardDeployerAddress = "0xEFD0F9Ba9De70586b7c4189971cF754adC923B04";
  const adminAddress = "0x2AC93684679a5bdA03C6160def908CdB8D46792f";
  const wvanaAddress = "0x00eddd9621fb08436d0331c149d1690909a5906d";

  enum DlpStatus {
    None,
    Registered,
    Eligible,
    Deregistered,
  }

  let admin: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let manager: HardhatEthersSigner;

  let dlpRegistry: DLPRegistryImplementation;
  let vanaEpoch: VanaEpochImplementation;
  let treasury: TreasuryImplementation;
  let dlpPerformance: DLPPerformanceImplementation;
  let dlpRewardDeployer: DLPRewardDeployerImplementation;

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );
  const MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MANAGER_ROLE"));
  const CUSTODIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CUSTODIAN_ROLE"));

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
    await helpers.mine();
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [adminAddress],
    });
    admin = await ethers.provider.getSigner(adminAddress);

    dlpRegistry = await ethers.getContractAt(
      "DLPRegistryImplementation",
      dlpRegistryAddress,
    );
    vanaEpoch = await ethers.getContractAt(
      "VanaEpochImplementation",
      vanaEpochAddress,
    );
    treasury = await ethers.getContractAt(
      "TreasuryImplementation",
      treasuryAddress,
    );
    dlpPerformance = await ethers.getContractAt(
      "DLPPerformanceImplementation",
      dlpPerformanceAddress,
    );

    dlpRewardDeployer = await ethers.getContractAt(
      "DLPRewardDeployerImplementation",
      dlpRewardDeployerAddress,
    );

    await setBalance(adminAddress, parseEther(100));
  };

  async function advanceToEpochN(epochNumber: number) {}

  describe("Tests", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should savePerformance", async function () {
      const epoch1Performances = [
        {
          dlpId: 1,
          totalScore: parseEther(0.6),
          tradingVolume: parseEther(1000),
          uniqueContributors: 50n,
          dataAccessFees: parseEther(5),
        },
      ];

      await vanaEpoch
        .connect(admin)
        .grantRole(
          "0x0e4b5abdbacc88ea82f7039d0cc2b0185da78d8fe1d85531edfebd57d65707d5",
          dlpPerformance,
        );

      await dlpPerformance
        .connect(admin)
        .saveEpochPerformances(1, epoch1Performances, false);
    });
  });
});
