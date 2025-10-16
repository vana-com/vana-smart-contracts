// test/data/buyAndBurn/swapAndAddLiquidityLib.ts

import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther } from "../../../utils/helpers";

describe("SwapAndAddLiquidityLib", function () {
  let owner: SignerWithAddress;
  let libTest: any;
  let usdcToken: any;
  let vanaToken: any;

  beforeEach(async function () {
    [owner] = await ethers.getSigners();

    // Deploy test harness contract first
    const LibTestFactory = await ethers.getContractFactory(
      "SwapAndAddLiquidityLibTest"
    );
    libTest = await LibTestFactory.deploy();
    await libTest.waitForDeployment();

    // Deploy mock tokens - they mint to deployer (libTest contract address won't work)
    // So we deploy with owner and transfer
    const ERC20MockFactory = await ethers.getContractFactory(
      "contracts/data/mocks/computeEngine/ERC20Mock.sol:ERC20Mock"
    );
    usdcToken = await ERC20MockFactory.connect(owner).deploy("USD Coin", "USDC");
    await usdcToken.waitForDeployment();

    vanaToken = await ERC20MockFactory.connect(owner).deploy("VANA Token", "VANA");
    await vanaToken.waitForDeployment();

    // Transfer tokens to test contract
    await usdcToken.connect(owner).transfer(await libTest.getAddress(), parseEther("500000"));
    await vanaToken.connect(owner).transfer(await libTest.getAddress(), parseEther("500000"));
  });

  describe("Initialization", function () {
    it("should deploy correctly", async function () {
      expect(await libTest.getAddress()).to.be.properAddress;
    });
  });

  describe("Basic validation", function () {
    it("should have tokens transferred", async function () {
      const balance = await usdcToken.balanceOf(await libTest.getAddress());
      expect(balance).to.be.gt(0);
    });
  });
});