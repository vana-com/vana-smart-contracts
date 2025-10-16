// test/data/buyAndBurn/buyAndBurnOrchestrator.ts

import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther } from "../../../utils/helpers";
import { advanceBlockNTimes } from "../../../utils/timeAndBlockManipulation";

describe("BuyAndBurnOrchestrator", function () {
  let owner: SignerWithAddress;
  let executor: SignerWithAddress;
  let dataAccessTreasury: SignerWithAddress;
  let computeStaking: SignerWithAddress;
  let burnAddress: SignerWithAddress;
  let user1: SignerWithAddress;

  let orchestrator: any;
  let universalDLPTreasury: any;
  let usdcToken: any;
  let vanaToken: any;
  let dlptToken: any;
  let dlpRegistry: any;

  const EXECUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EXECUTOR_ROLE"));
  const DATA_ACCESS_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("DATA_ACCESS_ROLE")
  );

  const DLP_ID = 1;
  const EPOCH_BLOCKS = 100;

  beforeEach(async function () {
    [
      owner,
      executor,
      dataAccessTreasury,
      computeStaking,
      burnAddress,
      user1,
    ] = await ethers.getSigners();

    // Deploy mock tokens - they mint to deployer automatically
    const ERC20MockFactory = await ethers.getContractFactory(
      "contracts/data/mocks/computeEngine/ERC20Mock.sol:ERC20Mock"
    );
    usdcToken = await ERC20MockFactory.connect(dataAccessTreasury).deploy("USD Coin", "USDC");
    await usdcToken.waitForDeployment();

    vanaToken = await ERC20MockFactory.connect(dataAccessTreasury).deploy("VANA Token", "VANA");
    await vanaToken.waitForDeployment();

    dlptToken = await ERC20MockFactory.connect(owner).deploy("DLP Token", "DLPT");
    await dlptToken.waitForDeployment();

    // Deploy DLP Registry Mock - use existing mock
    const DLPRegistryMockFactory = await ethers.getContractFactory(
      "contracts/data/mocks/dlpRegistry/DLPRootCoreDataAccessMock.sol:DLPRegistryMock"
    );
    dlpRegistry = await DLPRegistryMockFactory.deploy();
    await dlpRegistry.waitForDeployment();

    // Register DLP - the mock's registerDlp() creates a DLP with default values
    // We'll need to check what DLP ID it creates
    await dlpRegistry.registerDlp();

    // Get the DLP count to know what ID was created
    const dlpCount = await dlpRegistry.dlpsCount();
    const actualDlpId = dlpCount - 1n; // DLP IDs are 0-indexed in the mock

    // Get the DLP info to verify
    const dlpInfo = await dlpRegistry.dlps(actualDlpId);

    // Deploy UniversalDLPTreasury
    const TreasuryFactory = await ethers.getContractFactory(
      "UniversalDLPTreasury"
    );
    const treasuryProxy = await upgrades.deployProxy(
      TreasuryFactory,
      [
        await usdcToken.getAddress(),
        await vanaToken.getAddress(),
        owner.address,
        owner.address,
      ],
      { kind: "uups" }
    );
    await treasuryProxy.waitForDeployment();
    universalDLPTreasury = treasuryProxy;

    // Deploy BuyAndBurnOrchestrator
    const OrchestratorFactory = await ethers.getContractFactory(
      "BuyAndBurnOrchestrator"
    );
    const orchestratorProxy = await upgrades.deployProxy(
      OrchestratorFactory,
      [
        await usdcToken.getAddress(),
        await vanaToken.getAddress(),
        computeStaking.address,
        burnAddress.address,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        await universalDLPTreasury.getAddress(),
        await dlpRegistry.getAddress(),
        dataAccessTreasury.address,
        owner.address,
      ],
      { kind: "uups" }
    );
    await orchestratorProxy.waitForDeployment();
    orchestrator = orchestratorProxy;

    // Update treasury orchestrator role
    const ORCHESTRATOR_ROLE = ethers.keccak256(
      ethers.toUtf8Bytes("ORCHESTRATOR_ROLE")
    );
    await universalDLPTreasury.grantRole(ORCHESTRATOR_ROLE, await orchestrator.getAddress());

    // Grant roles
    await orchestrator.grantRole(EXECUTOR_ROLE, executor.address);
    await orchestrator.grantRole(DATA_ACCESS_ROLE, dataAccessTreasury.address);

    // Update epoch block cadence for testing
    await orchestrator.updateEpochBlockCadence(EPOCH_BLOCKS);

    // Tokens already minted to dataAccessTreasury (1M each) via constructor
  });

  describe("Initialization", function () {
    it("should initialize correctly", async function () {
      expect(await orchestrator.usdcToken()).to.equal(await usdcToken.getAddress());
      expect(await orchestrator.vanaToken()).to.equal(await vanaToken.getAddress());
      expect(await orchestrator.computeStakingAddress()).to.equal(
        computeStaking.address
      );
      expect(await orchestrator.vanaBurnAddress()).to.equal(burnAddress.address);
      expect(await orchestrator.protocolShareBps()).to.equal(2000);
      expect(await orchestrator.costSkimBps()).to.equal(500);
    });

    it("should have correct roles assigned", async function () {
      expect(await orchestrator.hasRole(EXECUTOR_ROLE, executor.address)).to.be
        .true;
      expect(
        await orchestrator.hasRole(DATA_ACCESS_ROLE, dataAccessTreasury.address)
      ).to.be.true;
    });
  });

  describe("Receive Funds", function () {
    const paymentAmount = parseEther("1000");

    it("should receive and split USDC payment", async function () {
      await usdcToken
        .connect(dataAccessTreasury)
        .approve(await orchestrator.getAddress(), paymentAmount);

      // Use DLP ID 0 since that's what the mock creates
      await expect(
        orchestrator
          .connect(dataAccessTreasury)
          .receiveFunds(await usdcToken.getAddress(), paymentAmount, 0)
      )
        .to.emit(orchestrator, "FundsReceived")
        .withArgs(
          await usdcToken.getAddress(),
          paymentAmount,
          0,
          (paymentAmount * 2000n) / 10000n,
          (paymentAmount * 8000n) / 10000n
        );

      const pendingProtocol = await orchestrator.pendingProtocolFunds();
      const pendingDLP = await orchestrator.pendingDLPFunds(0);

      expect(pendingProtocol.usdc).to.equal((paymentAmount * 2000n) / 10000n);
      expect(pendingDLP.usdc).to.equal((paymentAmount * 8000n) / 10000n);
    });

    it("should reject invalid token", async function () {
      await expect(
        orchestrator
          .connect(dataAccessTreasury)
          .receiveFunds(await dlptToken.getAddress(), paymentAmount, 0)
      ).to.be.revertedWithCustomError(orchestrator, "InvalidToken");
    });

    it("should reject zero amount", async function () {
      await expect(
        orchestrator
          .connect(dataAccessTreasury)
          .receiveFunds(await usdcToken.getAddress(), 0, 0)
      ).to.be.revertedWithCustomError(orchestrator, "InvalidAmount");
    });
  });

  describe("Execute Protocol Share", function () {
    const paymentAmount = parseEther("10000");

    beforeEach(async function () {
      await vanaToken
        .connect(dataAccessTreasury)
        .approve(await orchestrator.getAddress(), paymentAmount);
      await orchestrator
        .connect(dataAccessTreasury)
        .receiveFunds(await vanaToken.getAddress(), paymentAmount, 0);

      await advanceBlockNTimes(EPOCH_BLOCKS);
    });

    it("should execute protocol share with VANA", async function () {
      const protocolShare = (paymentAmount * 2000n) / 10000n;
      const skimAmount = (protocolShare * 500n) / 10000n;
      const burnAmount = protocolShare - skimAmount;

      await expect(orchestrator.connect(executor).executeProtocolShare())
        .to.emit(orchestrator, "ProtocolShareExecuted");

      expect(await vanaToken.balanceOf(computeStaking.address)).to.equal(
        skimAmount
      );
      expect(await vanaToken.balanceOf(burnAddress.address)).to.equal(burnAmount);
    });

    it("should reject execution before epoch passes", async function () {
      await orchestrator.connect(executor).executeProtocolShare();

      await expect(
        orchestrator.connect(executor).executeProtocolShare()
      ).to.be.revertedWithCustomError(orchestrator, "ExecutionTooSoon");
    });
  });
});