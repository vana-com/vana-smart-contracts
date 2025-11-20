import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

chai.use(chaiAsPromised);
should();

describe("Run on-chain", () => {
  let deployer: HardhatEthersSigner;

  beforeEach(async () => {
    [deployer] = await ethers.getSigners();
  });

  it("should call method", async function () {
    console.log(deployer.address);
    const dlpRegistry = await ethers.getContractAt(
      "DLPRegistryImplementation",
      "0x4d59880a924526d1dd33260552ff4328b1e18a43",
    );

    console.log(await dlpRegistry.dlpRegistrationDepositAmount());
    // await dlpRegistry.connect(deployer).updateDlpRegistrationDepositAmount(0);
    console.log(await dlpRegistry.dlpRegistrationDepositAmount());

    return;
  });
});
