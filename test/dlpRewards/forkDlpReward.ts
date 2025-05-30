import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, network, upgrades } from "hardhat";
import {
  DLPRegistryImplementation,
  VanaEpochImplementation,
  TreasuryImplementation,
  DLPPerformanceImplementation,
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
  const vanaEpochAddress = "0xe924Bd6170192a97ca37C91069A7f43C55ebe7df";
  const treasuryAddress = "0x05aa58a6B51446A27a02aA5725c602AEc0E4500d";
  const dlpRegistryAddress = "0xA6dFc0ef21D91F166Ca51c731D1a115a5b715a3F";
  const dlpPerformanceAddress = "0x4FEa7823D2E727F6D1F83422A7FD619070B06832";
  const adminAddress = "0x2AC93684679a5bdA03C6160def908CdB8D46792f";

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
