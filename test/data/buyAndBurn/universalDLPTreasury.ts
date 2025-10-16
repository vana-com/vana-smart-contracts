// test/data/buyAndBurn/universalDLPTreasury.ts

import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther } from "../../../utils/helpers";

describe("UniversalDLPTreasury", function () {
  let owner: SignerWithAddress;
  let orchestrator: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  let treasury: any;
  let usdcToken: any;
  let vanaToken: any;

  const ORCHESTRATOR_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("ORCHESTRATOR_ROLE")
  );

  beforeEach(async function () {
    [owner, orchestrator, user1, user2] = await ethers.getSigners();

    // Deploy mock tokens - they mint 1M tokens to deployer automatically
    const ERC20MockFactory = await ethers.getContractFactory(
      "contracts/data/mocks/computeEngine/ERC20Mock.sol:ERC20Mock"
    );
    usdcToken = await ERC20MockFactory.connect(orchestrator).deploy("USD Coin", "USDC");
    await usdcToken.waitForDeployment();

    vanaToken = await ERC20MockFactory.connect(orchestrator).deploy("VANA Token", "VANA");
    await vanaToken.waitForDeployment();

    // Deploy UniversalDLPTreasury
    const TreasuryFactory = await ethers.getContractFactory(
      "UniversalDLPTreasury"
    );
    const treasuryProxy = await upgrades.deployProxy(
      TreasuryFactory,
      [
        await usdcToken.getAddress(),
        await vanaToken.getAddress(),
        orchestrator.address,
        owner.address,
      ],
      { kind: "uups" }
    );

    await treasuryProxy.waitForDeployment();
    treasury = treasuryProxy;

    // Tokens are already minted to orchestrator (1M each) via constructor
  });

  describe("Initialization", function () {
    it("should initialize correctly", async function () {
      expect(await treasury.usdcToken()).to.equal(await usdcToken.getAddress());
      expect(await treasury.vanaToken()).to.equal(await vanaToken.getAddress());
      expect(await treasury.hasRole(ORCHESTRATOR_ROLE, orchestrator.address)).to
        .be.true;
    });

    it("should not allow reinitialization", async function () {
      await expect(
        treasury.initialize(
          await usdcToken.getAddress(),
          await vanaToken.getAddress(),
          orchestrator.address,
          owner.address
        )
      ).to.be.revertedWithCustomError(treasury, "InvalidInitialization");
    });
  });

  describe("Deposit for DLP", function () {
    const dlpId = 1;
    const depositAmount = parseEther("1000");

    beforeEach(async function () {
      // Approve treasury
      await usdcToken
        .connect(orchestrator)
        .approve(await treasury.getAddress(), depositAmount);
    });

    it("should allow orchestrator to deposit USDC", async function () {
      await expect(
        treasury
          .connect(orchestrator)
          .depositForDLP(dlpId, await usdcToken.getAddress(), depositAmount)
      )
        .to.emit(treasury, "DLPDeposit")
        .withArgs(dlpId, await usdcToken.getAddress(), depositAmount);

      const account = await treasury.getDLPAccount(dlpId);
      expect(account.usdcBalance).to.equal(depositAmount);
      expect(await treasury.totalUSDC()).to.equal(depositAmount);
    });

    it("should allow orchestrator to deposit VANA", async function () {
      await vanaToken
        .connect(orchestrator)
        .approve(await treasury.getAddress(), depositAmount);

      await expect(
        treasury
          .connect(orchestrator)
          .depositForDLP(dlpId, await vanaToken.getAddress(), depositAmount)
      )
        .to.emit(treasury, "DLPDeposit")
        .withArgs(dlpId, await vanaToken.getAddress(), depositAmount);

      const account = await treasury.getDLPAccount(dlpId);
      expect(account.vanaBalance).to.equal(depositAmount);
      expect(await treasury.totalVANA()).to.equal(depositAmount);
    });

    it("should reject deposit from non-orchestrator", async function () {
      // Transfer tokens to user1
      await usdcToken.connect(orchestrator).transfer(user1.address, depositAmount);
      await usdcToken.connect(user1).approve(await treasury.getAddress(), depositAmount);

      await expect(
        treasury
          .connect(user1)
          .depositForDLP(dlpId, await usdcToken.getAddress(), depositAmount)
      ).to.be.reverted;
    });

    it("should reject invalid token", async function () {
      await expect(
        treasury
          .connect(orchestrator)
          .depositForDLP(dlpId, user1.address, depositAmount)
      ).to.be.revertedWithCustomError(treasury, "InvalidToken");
    });

    it("should reject zero amount", async function () {
      await expect(
        treasury.connect(orchestrator).depositForDLP(dlpId, await usdcToken.getAddress(), 0)
      ).to.be.revertedWithCustomError(treasury, "InvalidAmount");
    });
  });

  describe("Withdraw for DLP", function () {
    const dlpId = 1;
    const depositAmount = parseEther("1000");
    const withdrawAmount = parseEther("500");

    beforeEach(async function () {
      // Setup initial deposit
      await usdcToken
        .connect(orchestrator)
        .approve(await treasury.getAddress(), depositAmount);
      await treasury
        .connect(orchestrator)
        .depositForDLP(dlpId, await usdcToken.getAddress(), depositAmount);
    });

    it("should allow orchestrator to withdraw", async function () {
      await expect(
        treasury
          .connect(orchestrator)
          .withdrawForDLP(dlpId, await usdcToken.getAddress(), withdrawAmount, user1.address)
      )
        .to.emit(treasury, "DLPWithdraw")
        .withArgs(dlpId, await usdcToken.getAddress(), withdrawAmount, user1.address);

      const account = await treasury.getDLPAccount(dlpId);
      expect(account.usdcBalance).to.equal(depositAmount - withdrawAmount);
      expect(await treasury.totalUSDC()).to.equal(depositAmount - withdrawAmount);
      expect(await usdcToken.balanceOf(user1.address)).to.equal(withdrawAmount);
    });

    it("should reject withdrawal exceeding balance", async function () {
      const tooMuch = depositAmount + parseEther("1");

      await expect(
        treasury
          .connect(orchestrator)
          .withdrawForDLP(dlpId, await usdcToken.getAddress(), tooMuch, user1.address)
      ).to.be.revertedWithCustomError(treasury, "InsufficientBalance");
    });
  });

  describe("Track Liquidity Contribution", function () {
    const dlpId = 1;
    const liquidityAmount = parseEther("500");

    it("should track liquidity contribution", async function () {
      await expect(
        treasury
          .connect(orchestrator)
          .trackLiquidityContribution(dlpId, liquidityAmount)
      )
        .to.emit(treasury, "LiquidityContributionTracked")
        .withArgs(dlpId, liquidityAmount);

      const account = await treasury.getDLPAccount(dlpId);
      expect(account.liquidityContribution).to.equal(liquidityAmount);
      expect(await treasury.totalLiquidityContribution()).to.equal(
        liquidityAmount
      );
    });

    it("should reject zero amount", async function () {
      await expect(
        treasury.connect(orchestrator).trackLiquidityContribution(dlpId, 0)
      ).to.be.revertedWithCustomError(treasury, "InvalidAmount");
    });
  });

  describe("Distribute VANA", function () {
    const dlpId1 = 1;
    const dlpId2 = 2;

    // Simpler values that definitely work
    const liquidityContrib1 = parseEther("1000");
    const liquidityContrib2 = parseEther("2000");

    const totalLiquidity = liquidityContrib1 + liquidityContrib2; // 3000

    // Deposits should be MORE than liquidity contributions
    const usdcDeposit1 = parseEther("5000");
    const usdcDeposit2 = parseEther("10000");

    const totalVanaSwapped = parseEther("1000");
    // Total USDC used should be LESS than or equal to total liquidity
    const totalUsdcUsed = parseEther("3000"); // Exactly equal to total liquidity

    beforeEach(async function () {
      // Setup deposits
      await usdcToken
        .connect(orchestrator)
        .approve(await treasury.getAddress(), usdcDeposit1 + usdcDeposit2);

      await treasury
        .connect(orchestrator)
        .depositForDLP(dlpId1, await usdcToken.getAddress(), usdcDeposit1);
      await treasury
        .connect(orchestrator)
        .depositForDLP(dlpId2, await usdcToken.getAddress(), usdcDeposit2);

      // Track liquidity contributions
      await treasury
        .connect(orchestrator)
        .trackLiquidityContribution(dlpId1, liquidityContrib1);
      await treasury
        .connect(orchestrator)
        .trackLiquidityContribution(dlpId2, liquidityContrib2);

      // Transfer VANA to treasury for distribution
      await vanaToken.connect(orchestrator).transfer(await treasury.getAddress(), totalVanaSwapped);
    });

    it("should distribute VANA proportionally", async function () {
      const dlpIds = [dlpId1, dlpId2];

      await treasury
        .connect(orchestrator)
        .distributeVANA(dlpIds, totalVanaSwapped, totalUsdcUsed);

      // Check proportional distribution
      const account1 = await treasury.getDLPAccount(dlpId1);
      const account2 = await treasury.getDLPAccount(dlpId2);

      // DLP1 gets 1/3 of VANA (1000/3000)
      const expectedVana1 = (totalVanaSwapped * liquidityContrib1) / totalLiquidity;
      // DLP2 gets 2/3 of VANA (2000/3000)
      const expectedVana2 = (totalVanaSwapped * liquidityContrib2) / totalLiquidity;

      expect(account1.vanaBalance).to.equal(expectedVana1);
      expect(account2.vanaBalance).to.equal(expectedVana2);

      // Check that USDC was deducted proportionally
      const expectedUsdcDeducted1 = (totalUsdcUsed * liquidityContrib1) / totalLiquidity; // 1000
      const expectedUsdcDeducted2 = (totalUsdcUsed * liquidityContrib2) / totalLiquidity; // 2000

      expect(account1.usdcBalance).to.equal(usdcDeposit1 - expectedUsdcDeducted1);
      expect(account2.usdcBalance).to.equal(usdcDeposit2 - expectedUsdcDeducted2);

      // Check that liquidity contribution was reduced by the amount used
      expect(account1.liquidityContribution).to.equal(0n); // 1000 - 1000 = 0
      expect(account2.liquidityContribution).to.equal(0n); // 2000 - 2000 = 0
    });
  });
});