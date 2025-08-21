import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, network, upgrades } from "hardhat";
import { DataRegistryImplementation } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getReceipt, parseEther } from "../../utils/helpers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";

chai.use(chaiAsPromised);
should();

describe("DLP fork tests", () => {
  const dataRegistryAddress = "0x8C8788f98385F6ba1adD4234e551ABba0f82Cb7C";
  const adminAddress = "";
  const pgeAddress = "0xF06Aa6B440cA537b9Df74Dd14Dac67366983F0b9";

  let admin: HardhatEthersSigner;
  let pge: HardhatEthersSigner;

  let dataRegistry: DataRegistryImplementation;

  const deploy = async () => {
    await helpers.mine();
    // await network.provider.request({
    //   method: "hardhat_impersonateAccount",
    //   params: [adminAddress],
    // });
    // admin = await ethers.provider.getSigner(adminAddress);

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [pgeAddress],
    });
    pge = await ethers.provider.getSigner(pgeAddress);

    dataRegistry = await ethers.getContractAt(
      "DataRegistryImplementation",
      dataRegistryAddress,
    );

    // await setBalance(adminAddress, parseEther(100));
    await setBalance(pgeAddress, parseEther(100));
  };

  async function advanceToEpochN(epochNumber: number) {}

  describe("Tests", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should savePerformance", async function () {
      await dataRegistry
        .connect(pge)
        .addFilePermission(
          1655315,
          "0x221a9A6da8845b1BfE3bF926A37D11f3f833c369",
          "0x2104a024fc4c3bf96b9eda64c7b0a1df0402f7c23f46713cdd635493d1019f096a3688f6e3ff2e2471a4605531f5f0546300091bdfb297e36450c33a0dcfd9ce6847d049135a3c4749cd465c4b31cbd292764bbb1d1c571103f407abc3abee54c6de957721a5b221f002ef22d379c66e7bc359399ecbae7a273fa01dc5367df34ab4313f72bfaa730e335a84ac56194c9e30fd1ab19ccc009ba4d0ced88c69d2e2",
        );
    });
  });
});
