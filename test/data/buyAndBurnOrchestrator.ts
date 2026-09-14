import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades, network } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther, toHex } from "../../utils/helpers";
import {
  BuyAndBurnSwapImplementation,
  BuyAndBurnOrchestratorImplementation,
} from "../../typechain-types";

import INonfungiblePositionManager from "@uniswap/v3-periphery/artifacts/contracts/interfaces/INonfungiblePositionManager.sol/INonfungiblePositionManager.json";
import IUniswapV3Pool from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";

chai.use(chaiAsPromised);
should();

enum FeeAmount {
  LOW = 500,
  MEDIUM = 3000,
  HIGH = 10000,
}

describe("BuyAndBurnOrchestrator", function () {
  const VANA = ethers.ZeroAddress;
  const BURN_ADDRESS = ethers.ZeroAddress;

  // Test parameters
  const PROTOCOL_SHARE = parseEther(0.2); // 20%
  const COMPUTE_STAKING_SHARE = parseEther(0.05); // 5% of protocol share
  const EPOCH_DURATION = 86400; // 1 day
  const SINGLE_BATCH_IMPACT_THRESHOLD = parseEther(0.02); // 2%
  const PER_SWAP_SLIPPAGE_CAP = parseEther(0.005); // 0.5%

  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let protocolTreasury: HardhatEthersSigner;
  let dlp1: HardhatEthersSigner;
  let dlp2: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  let orchestrator: BuyAndBurnOrchestratorImplementation;
  let buyAndBurnSwap: BuyAndBurnSwapImplementation;
  let dataAccessTreasury: any;
  let dlpToken: any;
  let positionManager: any;
  let lpTokenId: bigint;

  let routerAddress: string;
  let quoterV2Address: string;
  let positionManagerAddress: string;
  let WVANAAddress: string;
  let dlpTokenAddress: string;

  const deploy = async () => {
    [deployer, owner, maintainer, protocolTreasury, dlp1, dlp2, user1, user2] =
      await ethers.getSigners();

    console.log("Running test in a mainnet fork");
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.VANA_RPC_URL || "",
            blockNumber: 2_500_000,
          },
        },
      ],
    });

    // Mainnet addresses
    routerAddress = "0xeb40cbe65764202E28BcdB1e318adFdF8b2f2A3b";
    quoterV2Address = "0x1b13728ea3C90863990aC0e05987CfeC1888908c";
    positionManagerAddress = "0x45a2992e1bFdCF9b9AcE0a84A238f2E56F481816";
    WVANAAddress = "0x00EDdD9621Fb08436d0331c149D1690909a5906d";
    dlpTokenAddress = "0xf1815bd50389c46847f0bda824ec8da914045d14"; // USDC

    positionManager = await ethers.getContractAt(
      INonfungiblePositionManager.abi,
      positionManagerAddress
    );

    // Get existing DLP token (USDC) from fork
    dlpToken = await ethers.getContractAt(ERC20.abi, dlpTokenAddress);

    // Deploy mock DataAccessTreasury
    const DataAccessTreasuryMockFactory = await ethers.getContractFactory(
      "DataAccessTreasuryMock"
    );
    dataAccessTreasury = await DataAccessTreasuryMockFactory.deploy();

    // Deploy SwapHelper
    const swapHelper = await upgrades.deployProxy(
      await ethers.getContractFactory("SwapHelperImplementation"),
      [deployer.address, routerAddress, quoterV2Address],
      {
        kind: "uups",
      }
    );

    // Deploy BuyAndBurnSwap
    const buyAndBurnSwapDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("BuyAndBurnSwapImplementation"),
      [deployer.address, await swapHelper.getAddress(), positionManagerAddress],
      {
        kind: "uups",
      }
    );

    buyAndBurnSwap = await ethers.getContractAt(
      "BuyAndBurnSwapImplementation",
      await buyAndBurnSwapDeploy.getAddress()
    );

    // Deploy BuyAndBurnOrchestrator
    const orchestratorDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("BuyAndBurnOrchestratorImplementation"),
      [
        await dataAccessTreasury.getAddress(),
        await buyAndBurnSwap.getAddress(),
        protocolTreasury.address,
        PROTOCOL_SHARE,
        COMPUTE_STAKING_SHARE,
        EPOCH_DURATION,
      ],
      {
        kind: "uups",
      }
    );

    orchestrator = await ethers.getContractAt(
      "BuyAndBurnOrchestratorImplementation",
      await orchestratorDeploy.getAddress()
    );

    // Grant roles - deployer has DEFAULT_ADMIN_ROLE by default
    const DEFAULT_ADMIN_ROLE = await orchestrator.DEFAULT_ADMIN_ROLE();
    const MAINTAINER_ROLE = await orchestrator.MAINTAINER_ROLE();

    // Grant admin role to owner so tests can use owner for admin operations
    await orchestrator.connect(deployer).grantRole(DEFAULT_ADMIN_ROLE, owner.address);

    // Grant maintainer role to maintainer
    await orchestrator.connect(deployer).grantRole(MAINTAINER_ROLE, maintainer.address);

    // Grant maintainer role to owner as well (for tests that use owner)
    await orchestrator.connect(deployer).grantRole(MAINTAINER_ROLE, owner.address);

    // Give owner enough balance
    await network.provider.send("hardhat_setBalance", [
      owner.address,
      toHex(parseEther(10000)),
    ]);
  };

  const createAndApproveLP = async () => {
    // Create a new LP position for testing
    await network.provider.send("hardhat_setBalance", [
      owner.address,
      toHex(parseEther(20000)),
    ]);

    // Use the whale address provided by user
    const usdcWhale = "0x5Fca78d5456FeCbF0d15f00C9a6F45A67328D03c";

    // Fund the whale with ETH
    await network.provider.send("hardhat_setBalance", [
      usdcWhale,
      toHex(parseEther(100)),
    ]);

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [usdcWhale],
    });

    const whaleSigner = await ethers.getSigner(usdcWhale);

    // Check whale's actual USDC balance
    const whaleBalance = await dlpToken.balanceOf(usdcWhale);
    console.log("Whale USDC balance:", ethers.formatUnits(whaleBalance, 6));

    // Transfer USDC tokens to owner for LP creation (USDC has 6 decimals)
    const transferAmount = BigInt(100 * 10 ** 6); // 100 USDC - small amount

    if (whaleBalance < transferAmount) {
      throw new Error(`Whale has insufficient USDC: ${ethers.formatUnits(whaleBalance, 6)}`);
    }

    await dlpToken.connect(whaleSigner).transfer(owner.address, transferAmount);

    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [usdcWhale],
    });

    // Approve tokens for position manager
    await dlpToken.connect(owner).approve(positionManagerAddress, transferAmount);

    // Get the pool to determine current tick
    const poolAddress = "0x850e454DDebf9f61Ef5A86A032c857e0e47C4fA9";
    const pool = await ethers.getContractAt(
      IUniswapV3Pool.abi,
      poolAddress
    );

    // Get current pool state
    const slot0 = await pool.slot0();
    const currentTick = slot0.tick;

    // Use a safer, narrower tick range around current tick
    const tickSpacing = 60; // For 0.3% fee tier
    const tickLower = Number(currentTick) - (tickSpacing * 100); // 100 ticks below
    const tickUpper = Number(currentTick) + (tickSpacing * 100); // 100 ticks above

    // Round to valid tick spacing
    const roundedTickLower = Math.floor(Number(tickLower) / tickSpacing) * tickSpacing;
    const roundedTickUpper = Math.ceil(Number(tickUpper) / tickSpacing) * tickSpacing;

    // Determine token order
    const token0 = WVANAAddress < dlpTokenAddress ? WVANAAddress : dlpTokenAddress;
    const token1 = WVANAAddress < dlpTokenAddress ? dlpTokenAddress : WVANAAddress;

    // Create LP position with conservative amounts
    const vanaAmount = parseEther(1); // 1 VANA
    const usdcAmount = transferAmount; // 100 USDC

    const mintParams = {
      token0: token0,
      token1: token1,
      fee: FeeAmount.MEDIUM,
      tickLower: roundedTickLower,
      tickUpper: roundedTickUpper,
      amount0Desired: WVANAAddress < dlpTokenAddress ? vanaAmount : usdcAmount,
      amount1Desired: WVANAAddress < dlpTokenAddress ? usdcAmount : vanaAmount,
      amount0Min: 0,
      amount1Min: 0,
      recipient: owner.address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };

    console.log("Minting LP with params:", {
      tickLower: roundedTickLower,
      tickUpper: roundedTickUpper,
      currentTick: Number(currentTick),
      amount0: ethers.formatUnits(mintParams.amount0Desired, WVANAAddress < dlpTokenAddress ? 18 : 6),
      amount1: ethers.formatUnits(mintParams.amount1Desired, WVANAAddress < dlpTokenAddress ? 6 : 18),
    });

    const tx = await positionManager.connect(owner).mint(mintParams, {
      value: vanaAmount,
    });
    const receipt = await tx.wait();

    // Extract LP token ID from event (look for IncreaseLiquidity event)
    const iface = new ethers.Interface(INonfungiblePositionManager.abi);

    for (const log of receipt!.logs) {
      try {
        const parsed = iface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed && parsed.name === "IncreaseLiquidity") {
          lpTokenId = BigInt(parsed.args.tokenId);
          break;
        }
      } catch (e) {
        // Not the event we're looking for, continue
        continue;
      }
    }

    if (!lpTokenId) {
      throw new Error("Failed to extract LP token ID from mint transaction");
    }

    console.log("LP Token ID created:", lpTokenId);

    // Approve BuyAndBurnSwap to manage our LP position
    await positionManager
      .connect(owner)
      .approve(await buyAndBurnSwap.getAddress(), lpTokenId);
  };

  describe("Deployment", function () {
    let snapshotId: any;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should deploy with correct initial parameters", async () => {
      (await orchestrator.dataAccessTreasury()).should.equal(
        await dataAccessTreasury.getAddress()
      );
      (await orchestrator.buyAndBurnSwap()).should.equal(
        await buyAndBurnSwap.getAddress()
      );
      (await orchestrator.protocolTreasury()).should.equal(
        protocolTreasury.address
      );
      (await orchestrator.protocolSharePercentage()).should.equal(PROTOCOL_SHARE);
      (await orchestrator.computeStakingPercentage()).should.equal(
        COMPUTE_STAKING_SHARE
      );
      (await orchestrator.epochDuration()).should.equal(EPOCH_DURATION);
      (await orchestrator.singleBatchImpactThreshold()).should.equal(
        SINGLE_BATCH_IMPACT_THRESHOLD
      );
      (await orchestrator.perSwapSlippageCap()).should.equal(PER_SWAP_SLIPPAGE_CAP);
    });

    it("should whitelist VANA by default", async () => {
      (await orchestrator.whitelistedTokens(VANA)).should.be.true;
    });

    it("should grant admin role to deployer and owner", async () => {
      const DEFAULT_ADMIN_ROLE = await orchestrator.DEFAULT_ADMIN_ROLE();
      (await orchestrator.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)).should.be.true;
      (await orchestrator.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).should.be.true;
    });

    it("should set last epoch timestamp to deployment time", async () => {
      const lastEpoch = await orchestrator.lastEpochTimestamp();
      const currentBlock = await ethers.provider.getBlock("latest");

      const diff = lastEpoch > BigInt(currentBlock!.timestamp)
        ? lastEpoch - BigInt(currentBlock!.timestamp)
        : BigInt(currentBlock!.timestamp) - lastEpoch;

      diff.should.be.lte(10n);
    });
  });

  describe("Access Control", function () {
    let snapshotId: any;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should allow admin to whitelist tokens", async () => {
      await orchestrator
        .connect(owner)
        .setTokenWhitelist(dlpTokenAddress, true);

      (await orchestrator.whitelistedTokens(dlpTokenAddress)).should
        .be.true;
    });

    it("should not allow non-admin to whitelist tokens", async () => {
      await orchestrator
        .connect(user1)
        .setTokenWhitelist(dlpTokenAddress, true)
        .should.be.rejectedWith("AccessControlUnauthorizedAccount");
    });

    it("should allow maintainer to execute buy and burn", async () => {
      // Fund treasury
      await owner.sendTransaction({
        to: await dataAccessTreasury.getAddress(),
        value: parseEther(100),
      });

      await orchestrator
        .connect(maintainer)
        .executeBuyAndBurn(VANA, parseEther(10), []).should.not.be.rejected;
    });

    it("should not allow non-maintainer to execute buy and burn", async () => {
      await orchestrator
        .connect(user1)
        .executeBuyAndBurn(VANA, parseEther(10), [])
        .should.be.rejectedWith("AccessControlUnauthorizedAccount");
    });

    it("should allow admin to grant maintainer role", async () => {
      const MAINTAINER_ROLE = await orchestrator.MAINTAINER_ROLE();
      await orchestrator.connect(owner).grantRole(MAINTAINER_ROLE, user1.address);

      (await orchestrator.hasRole(MAINTAINER_ROLE, user1.address)).should.be.true;
    });
  });

  describe("Protocol Share Processing", function () {
    let snapshotId: any;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should split VANA protocol share correctly", async () => {
      const amount = parseEther(100);

      // Fund treasury
      await owner.sendTransaction({
        to: await dataAccessTreasury.getAddress(),
        value: amount,
      });

      const treasuryBalanceBefore = await ethers.provider.getBalance(
        protocolTreasury.address
      );
      const burnBalanceBefore = await ethers.provider.getBalance(BURN_ADDRESS);

      // Execute with no DLP configs (all protocol share)
      await orchestrator.connect(maintainer).executeBuyAndBurn(VANA, amount, []);

      const treasuryBalanceAfter = await ethers.provider.getBalance(
        protocolTreasury.address
      );
      const burnBalanceAfter = await ethers.provider.getBalance(BURN_ADDRESS);

      // Protocol gets 20% of 100 = 20 VANA
      // Of that 20: 5% to treasury = 1 VANA, 95% burned = 19 VANA
      const expectedProtocolShare = (amount * 20n) / 100n;
      const expectedTreasuryAmount = (expectedProtocolShare * 5n) / 100n;
      const expectedBurnAmount = expectedProtocolShare - expectedTreasuryAmount;

      (treasuryBalanceAfter - treasuryBalanceBefore).should.equal(
        expectedTreasuryAmount
      );
      (burnBalanceAfter - burnBalanceBefore).should.equal(expectedBurnAmount);
    });

    it("should handle zero protocol share correctly", async () => {
      // Set protocol share to 0%
      await orchestrator
        .connect(owner)
        .updateParameters(
          0,
          COMPUTE_STAKING_SHARE,
          SINGLE_BATCH_IMPACT_THRESHOLD,
          PER_SWAP_SLIPPAGE_CAP
        );

      const amount = parseEther(100);
      await owner.sendTransaction({
        to: await dataAccessTreasury.getAddress(),
        value: amount,
      });

      const treasuryBalanceBefore = await ethers.provider.getBalance(
        protocolTreasury.address
      );

      await orchestrator.connect(maintainer).executeBuyAndBurn(VANA, amount, []);

      const treasuryBalanceAfter = await ethers.provider.getBalance(
        protocolTreasury.address
      );

      // No change to treasury
      treasuryBalanceAfter.should.equal(treasuryBalanceBefore);
    });
  });

  describe("DLP Share Processing", function () {
    let snapshotId: any;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();
      await createAndApproveLP();
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should send VANA to DLP without token", async () => {
      const amount = parseEther(100);
      const dlpShare = (amount * 80n) / 100n; // 80% goes to DLPs

      // Fund treasury
      await owner.sendTransaction({
        to: await dataAccessTreasury.getAddress(),
        value: amount,
      });

      const dlp1BalanceBefore = await ethers.provider.getBalance(dlp1.address);

      // DLP config without token (dlpToken = address(0))
      const dlpConfigs = [
        {
          dlpAddress: dlp1.address,
          dlpToken: VANA,
          shareAmount: dlpShare,
          lpTokenId: 0,
          poolFee: 0,
        },
      ];

      await orchestrator
        .connect(maintainer)
        .executeBuyAndBurn(VANA, amount, dlpConfigs);

      const dlp1BalanceAfter = await ethers.provider.getBalance(dlp1.address);

      // DLP should receive their share of VANA
      (dlp1BalanceAfter - dlp1BalanceBefore).should.equal(dlpShare);
    });

    it("should swap VANA to DLPT and burn for DLP with token", async () => {
      const amount = parseEther(100);
      const dlpShare = (amount * 80n) / 100n;

      // Fund treasury
      await owner.sendTransaction({
        to: await dataAccessTreasury.getAddress(),
        value: amount,
      });

      // Get LP position liquidity before
      const positionBefore = await positionManager.positions(lpTokenId);
      const liquidityBefore = positionBefore.liquidity;

      // DLP config with token
      const dlpConfigs = [
        {
          dlpAddress: dlpTokenAddress,
          dlpToken: dlpTokenAddress,
          shareAmount: dlpShare,
          lpTokenId: lpTokenId,
          poolFee: FeeAmount.MEDIUM,
        },
      ];

      await orchestrator
        .connect(maintainer)
        .executeBuyAndBurn(VANA, amount, dlpConfigs);

      // Check that liquidity increased
      const positionAfter = await positionManager.positions(lpTokenId);
      const liquidityAfter = positionAfter.liquidity;

      // Liquidity should have increased
      liquidityAfter.should.be.gt(liquidityBefore);
    });

    it("should handle multiple DLPs with mixed configurations", async () => {
      const amount = parseEther(100);
      const dlpTotalShare = (amount * 80n) / 100n;
      const dlp1Share = dlpTotalShare / 2n;
      const dlp2Share = dlpTotalShare - dlp1Share;

      // Fund treasury
      await owner.sendTransaction({
        to: await dataAccessTreasury.getAddress(),
        value: amount,
      });

      const dlp1BalanceBefore = await ethers.provider.getBalance(dlp1.address);

      // Get LP position liquidity before
      const positionBefore = await positionManager.positions(lpTokenId);
      const liquidityBefore = positionBefore.liquidity;

      const dlpConfigs = [
        {
          dlpAddress: dlp1.address,
          dlpToken: VANA, // No token
          shareAmount: dlp1Share,
          lpTokenId: 0,
          poolFee: 0,
        },
        {
          dlpAddress: dlpTokenAddress,
          dlpToken: dlpTokenAddress, // Has token
          shareAmount: dlp2Share,
          lpTokenId: lpTokenId,
          poolFee: FeeAmount.MEDIUM,
        },
      ];

      await orchestrator
        .connect(maintainer)
        .executeBuyAndBurn(VANA, amount, dlpConfigs);

      const dlp1BalanceAfter = await ethers.provider.getBalance(dlp1.address);

      // Check that liquidity increased
      const positionAfter = await positionManager.positions(lpTokenId);
      const liquidityAfter = positionAfter.liquidity;

      // DLP1 received VANA
      (dlp1BalanceAfter - dlp1BalanceBefore).should.equal(dlp1Share);

      // DLP2's LP position increased
      liquidityAfter.should.be.gt(liquidityBefore);
    });

    it("should skip DLPs with zero share amount", async () => {
      const amount = parseEther(100);

      await owner.sendTransaction({
        to: await dataAccessTreasury.getAddress(),
        value: amount,
      });

      const dlp1BalanceBefore = await ethers.provider.getBalance(dlp1.address);

      const dlpConfigs = [
        {
          dlpAddress: dlp1.address,
          dlpToken: VANA,
          shareAmount: 0, // Zero share
          lpTokenId: 0,
          poolFee: 0,
        },
      ];

      await orchestrator
        .connect(maintainer)
        .executeBuyAndBurn(VANA, amount, dlpConfigs);

      const dlp1BalanceAfter = await ethers.provider.getBalance(dlp1.address);

      // No change
      dlp1BalanceAfter.should.equal(dlp1BalanceBefore);
    });
  });

  describe("Complete Integration Flow", function () {
    let snapshotId: any;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();
      await createAndApproveLP();
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should handle complete flow: VANA → Protocol + Multiple DLPs", async () => {
      const totalAmount = parseEther(1000);

      // Fund treasury
      await owner.sendTransaction({
        to: await dataAccessTreasury.getAddress(),
        value: totalAmount,
      });

      const protocolShare = (totalAmount * 20n) / 100n;
      const dlpTotalShare = totalAmount - protocolShare;
      const dlp1Share = (dlpTotalShare * 30n) / 100n;
      const dlp2Share = dlpTotalShare - dlp1Share;

      const treasuryBefore = await ethers.provider.getBalance(
        protocolTreasury.address
      );
      const dlp1Before = await ethers.provider.getBalance(dlp1.address);
      const burnVanaBefore = await ethers.provider.getBalance(BURN_ADDRESS);

      const dlpConfigs = [
        {
          dlpAddress: dlp1.address,
          dlpToken: VANA,
          shareAmount: dlp1Share,
          lpTokenId: 0,
          poolFee: 0,
        },
        {
          dlpAddress: dlpTokenAddress,
          dlpToken: dlpTokenAddress,
          shareAmount: dlp2Share,
          lpTokenId: lpTokenId,
          poolFee: FeeAmount.MEDIUM,
        },
      ];

      await orchestrator
        .connect(maintainer)
        .executeBuyAndBurn(VANA, totalAmount, dlpConfigs);

      const treasuryAfter = await ethers.provider.getBalance(
        protocolTreasury.address
      );
      const dlp1After = await ethers.provider.getBalance(dlp1.address);
      const burnVanaAfter = await ethers.provider.getBalance(BURN_ADDRESS);

      console.log("\n=== Complete Integration Test Results ===");
      console.log("Total amount:", ethers.formatEther(totalAmount), "VANA");
      console.log(
        "Protocol treasury received:",
        ethers.formatEther(treasuryAfter - treasuryBefore),
        "VANA"
      );
      console.log(
        "DLP1 (no token) received:",
        ethers.formatEther(dlp1After - dlp1Before),
        "VANA"
      );
      console.log(
        "VANA burned:",
        ethers.formatEther(burnVanaAfter - burnVanaBefore),
        "VANA"
      );

      // Verify protocol treasury received funds
      treasuryAfter.should.be.gt(treasuryBefore);

      // Verify DLP1 received exact VANA share
      (dlp1After - dlp1Before).should.equal(dlp1Share);

      // Verify VANA was burned (from protocol share)
      burnVanaAfter.should.be.gt(burnVanaBefore);

      // Verify LP liquidity increased (from DLP2 share)
      const positionAfter = await positionManager.positions(lpTokenId);
      positionAfter.liquidity.should.be.gt(0n);
    });
  });

  describe("Epoch Management", function () {
    let snapshotId: any;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should not allow epoch advance before duration", async () => {
      await orchestrator
        .connect(maintainer)
        .advanceEpoch()
        .should.be.rejectedWith("BuyAndBurnOrchestrator__EpochNotReady");
    });

    it("should allow epoch advance after duration", async () => {
      // Fast forward 1 day
      await network.provider.send("evm_increaseTime", [EPOCH_DURATION]);
      await network.provider.send("evm_mine");

      const lastEpochBefore = await orchestrator.lastEpochTimestamp();

      await orchestrator.connect(maintainer).advanceEpoch().should.not.be.rejected;

      const lastEpochAfter = await orchestrator.lastEpochTimestamp();

      lastEpochAfter.should.be.gt(lastEpochBefore);
    });

    it("should update lastEpochTimestamp correctly", async () => {
      await network.provider.send("evm_increaseTime", [EPOCH_DURATION]);
      await network.provider.send("evm_mine");

      await orchestrator.connect(maintainer).advanceEpoch();

      const lastEpoch = await orchestrator.lastEpochTimestamp();
      const currentBlock = await ethers.provider.getBlock("latest");

      const diff = lastEpoch > BigInt(currentBlock!.timestamp)
        ? lastEpoch - BigInt(currentBlock!.timestamp)
        : BigInt(currentBlock!.timestamp) - lastEpoch;

      diff.should.be.lte(10n);
    });
  });

  describe("Parameter Updates", function () {
    let snapshotId: any;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should allow admin to update parameters", async () => {
      const newProtocolShare = parseEther(0.25);
      const newComputeStaking = parseEther(0.1);
      const newImpactThreshold = parseEther(0.03);
      const newSlippageCap = parseEther(0.01);

      await orchestrator
        .connect(owner)
        .updateParameters(
          newProtocolShare,
          newComputeStaking,
          newImpactThreshold,
          newSlippageCap
        ).should.not.be.rejected;

      (await orchestrator.protocolSharePercentage()).should.equal(
        newProtocolShare
      );
      (await orchestrator.computeStakingPercentage()).should.equal(
        newComputeStaking
      );
      (await orchestrator.singleBatchImpactThreshold()).should.equal(
        newImpactThreshold
      );
      (await orchestrator.perSwapSlippageCap()).should.equal(newSlippageCap);
    });

    it("should reject invalid protocol share percentage", async () => {
      const invalidShare = parseEther(1.1); // 110%

      await orchestrator
        .connect(owner)
        .updateParameters(
          invalidShare,
          COMPUTE_STAKING_SHARE,
          SINGLE_BATCH_IMPACT_THRESHOLD,
          PER_SWAP_SLIPPAGE_CAP
        )
        .should.be.rejectedWith("BuyAndBurnOrchestrator__InvalidPercentage");
    });

    it("should reject invalid compute staking percentage", async () => {
      const invalidShare = parseEther(1.5); // 150%

      await orchestrator
        .connect(owner)
        .updateParameters(
          PROTOCOL_SHARE,
          invalidShare,
          SINGLE_BATCH_IMPACT_THRESHOLD,
          PER_SWAP_SLIPPAGE_CAP
        )
        .should.be.rejectedWith("BuyAndBurnOrchestrator__InvalidPercentage");
    });

    it("should allow admin to update protocol treasury", async () => {
      await orchestrator.connect(owner).setProtocolTreasury(user1.address);

      (await orchestrator.protocolTreasury()).should.equal(user1.address);
    });

    it("should reject zero address for protocol treasury", async () => {
      await orchestrator
        .connect(owner)
        .setProtocolTreasury(ethers.ZeroAddress)
        .should.be.rejectedWith("BuyAndBurnOrchestrator__InvalidAddress");
    });

    it("should not allow non-admin to update parameters", async () => {
      await orchestrator
        .connect(user1)
        .updateParameters(
          PROTOCOL_SHARE,
          COMPUTE_STAKING_SHARE,
          SINGLE_BATCH_IMPACT_THRESHOLD,
          PER_SWAP_SLIPPAGE_CAP
        )
        .should.be.rejectedWith("AccessControlUnauthorizedAccount");
    });
  });

  describe("Pausability", function () {
    let snapshotId: any;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should allow admin to pause", async () => {
      await orchestrator.connect(owner).pause();

      (await orchestrator.paused()).should.be.true;
    });

    it("should not allow execution when paused", async () => {
      await orchestrator.connect(owner).pause();

      await owner.sendTransaction({
        to: await dataAccessTreasury.getAddress(),
        value: parseEther(100),
      });

      await orchestrator
        .connect(maintainer)
        .executeBuyAndBurn(VANA, parseEther(10), [])
        .should.be.rejectedWith("EnforcedPause");
    });

    it("should allow admin to unpause", async () => {
      await orchestrator.connect(owner).pause();
      await orchestrator.connect(owner).unpause();

      (await orchestrator.paused()).should.be.false;
    });

    it("should allow execution after unpause", async () => {
      await orchestrator.connect(owner).pause();
      await orchestrator.connect(owner).unpause();

      await owner.sendTransaction({
        to: await dataAccessTreasury.getAddress(),
        value: parseEther(100),
      });

      await orchestrator
        .connect(maintainer)
        .executeBuyAndBurn(VANA, parseEther(10), []).should.not.be.rejected;
    });

    it("should not allow non-admin to pause", async () => {
      await orchestrator
        .connect(user1)
        .pause()
        .should.be.rejectedWith("AccessControlUnauthorizedAccount");
    });
  });

  describe("Input Validation", function () {
    let snapshotId: any;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();
      await createAndApproveLP();
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should reject non-whitelisted tokens", async () => {
      await orchestrator
        .connect(maintainer)
        .executeBuyAndBurn(dlpTokenAddress, parseEther(10), [])
        .should.be.rejectedWith("BuyAndBurnOrchestrator__TokenNotWhitelisted");
    });

    it("should reject zero amount", async () => {
      await orchestrator
        .connect(maintainer)
        .executeBuyAndBurn(VANA, 0, [])
        .should.be.rejectedWith("BuyAndBurnOrchestrator__InvalidAmount");
    });
  });

  describe("Edge Cases", function () {
    let snapshotId: any;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should handle empty DLP configs array", async () => {
      const amount = parseEther(100);

      await owner.sendTransaction({
        to: await dataAccessTreasury.getAddress(),
        value: amount,
      });

      // Empty DLP configs - all goes to protocol
      await orchestrator
        .connect(maintainer)
        .executeBuyAndBurn(VANA, amount, []).should.not.be.rejected;
    });

    it("should handle very small amounts", async () => {
      const amount = parseEther(0.001);

      await owner.sendTransaction({
        to: await dataAccessTreasury.getAddress(),
        value: amount,
      });

      await orchestrator
        .connect(maintainer)
        .executeBuyAndBurn(VANA, amount, []).should.not.be.rejected;
    });

    it("should handle 100% protocol share", async () => {
      await orchestrator
        .connect(owner)
        .updateParameters(
          parseEther(1),
          COMPUTE_STAKING_SHARE,
          SINGLE_BATCH_IMPACT_THRESHOLD,
          PER_SWAP_SLIPPAGE_CAP
        );

      const amount = parseEther(100);

      await owner.sendTransaction({
        to: await dataAccessTreasury.getAddress(),
        value: amount,
      });

      await orchestrator
        .connect(maintainer)
        .executeBuyAndBurn(VANA, amount, []).should.not.be.rejected;
    });

    it("should handle 0% protocol share", async () => {
      await orchestrator
        .connect(owner)
        .updateParameters(
          0,
          COMPUTE_STAKING_SHARE,
          SINGLE_BATCH_IMPACT_THRESHOLD,
          PER_SWAP_SLIPPAGE_CAP
        );

      const amount = parseEther(100);

      await owner.sendTransaction({
        to: await dataAccessTreasury.getAddress(),
        value: amount,
      });

      const dlpConfigs = [
        {
          dlpAddress: dlp1.address,
          dlpToken: VANA,
          shareAmount: amount,
          lpTokenId: 0,
          poolFee: 0,
        },
      ];

      await orchestrator
        .connect(maintainer)
        .executeBuyAndBurn(VANA, amount, dlpConfigs).should.not.be.rejected;
    });
  });
});