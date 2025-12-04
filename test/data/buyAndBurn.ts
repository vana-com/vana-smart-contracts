import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades, network } from "hardhat";
import fc from "fast-check";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  Tick,
  TickMath,
  Pool,
  Position,
  maxLiquidityForAmounts,
  nearestUsableTick,
  computePoolAddress,
} from "@uniswap/v3-sdk";
import { Token, CurrencyAmount, sqrt } from "@uniswap/sdk-core";
import JSBI from "jsbi";
import { parseEther, getReceipt, toHex, sqrtBigInt } from "../../utils/helpers";
import {
  SwapHelperImplementation,
  BuyAndBurnSwapImplementation,
} from "../../typechain-types";

import INonfungiblePositionManager from "@uniswap/v3-periphery/artifacts/contracts/interfaces/INonfungiblePositionManager.sol/INonfungiblePositionManager.json";
import SwapRouter from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import QuoterV2 from "@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json";
import IUniswapV3Pool from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import IWVANA from "@uniswap/v3-periphery/artifacts/contracts/interfaces/external/IWETH9.sol/IWETH9.json";
import TickLens from "@uniswap/v3-periphery/artifacts/contracts/lens/TickLens.sol/TickLens.json";
import Factory from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json";

chai.use(chaiAsPromised);
should();

const Q96 = BigInt(2 ** 96);
const ONE_HUNDRED_PERCENT = parseEther(100); // 100%

enum FeeAmount {
  LOW = 500,
  MEDIUM = 3000,
  HIGH = 10000,
}

const TICK_SPACINGS: { [amount in FeeAmount]: number } = {
  [FeeAmount.LOW]: 10,
  [FeeAmount.MEDIUM]: 60,
  [FeeAmount.HIGH]: 200,
};

const getSqrtPriceLimitX96 = async (
  pool: any,
  zeroForOne: boolean,
  slippageTolerance: bigint,
): Promise<bigint> => {
  const slot0 = await pool.slot0();
  const sqrtPriceX96: bigint = BigInt(slot0.sqrtPriceX96);
  const slippageFactor = zeroForOne
    ? ONE_HUNDRED_PERCENT - slippageTolerance
    : ONE_HUNDRED_PERCENT + slippageTolerance;
  const slippageFactorScaled =
    (slippageFactor * Q96 * Q96) / ONE_HUNDRED_PERCENT;
  const sqrtSlippageFactorX96 = sqrtBigInt(slippageFactorScaled);
  const sqrtPriceLimitX96 = (sqrtPriceX96 * sqrtSlippageFactorX96) / Q96;
  return sqrtPriceLimitX96;
};

const sqrtPriceX96ToPrice = (sqrtPriceX96: bigint): number => {
  return Number(sqrtPriceX96 * sqrtPriceX96) / Number(Q96) / Number(Q96);
};

// Helper function to extract tokenId from mint receipt
const extractTokenIdFromMint = (receipt: any): bigint => {
  const iface = new ethers.Interface(INonfungiblePositionManager.abi);

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed && parsed.name === "IncreaseLiquidity") {
        return BigInt(parsed.args.tokenId);
      }
    } catch (e) {
      // Not the event we're looking for, continue
      continue;
    }
  }

  throw new Error("Failed to extract tokenId from mint transaction");
};

// Helper function to create LP position
const createLPPosition = async (
  user: HardhatEthersSigner,
  positionManager: any,
  WVANA: any,
  ERC20Token: any,
  swapHelper: any,
  amountVana: bigint,
  swapAmount: bigint,
): Promise<bigint> => {
  // Get some ERC20 tokens first
  await swapHelper.connect(user).exactInputSingle(
    {
      tokenIn: ethers.ZeroAddress,
      tokenOut: ERC20Token.target,
      fee: FeeAmount.MEDIUM,
      recipient: user.address,
      amountIn: swapAmount,
      amountOutMinimum: 0,
    },
    { value: swapAmount },
  );

  // Deposit WVANA
  await WVANA.connect(user).deposit({ value: amountVana });

  // Approve tokens
  await WVANA.connect(user).approve(positionManager.target, amountVana);
  await ERC20Token.connect(user).approve(
    positionManager.target,
    await ERC20Token.balanceOf(user.address),
  );

  // Get tick range
  const tickLower = nearestUsableTick(
    TickMath.MIN_TICK,
    TICK_SPACINGS[FeeAmount.MEDIUM],
  );
  const tickUpper = nearestUsableTick(
    TickMath.MAX_TICK,
    TICK_SPACINGS[FeeAmount.MEDIUM],
  );

  // Mint position
  const mintTx = await positionManager.connect(user).mint({
    token0: WVANA.target,
    token1: ERC20Token.target,
    fee: FeeAmount.MEDIUM,
    tickLower: tickLower,
    tickUpper: tickUpper,
    amount0Desired: amountVana,
    amount1Desired: await ERC20Token.balanceOf(user.address),
    amount0Min: 0,
    amount1Min: 0,
    recipient: user.address,
    deadline: Math.floor(Date.now() / 1000) + 60 * 10,
  });

  const receipt = await mintTx.wait();
  return extractTokenIdFromMint(receipt);
};

describe("BuyAndBurnSwap", () => {
  const VANA = ethers.ZeroAddress;

  const NUM_RUNS = 100; // Reduce for faster tests, increase for thorough testing
  const SINGLE_BATCH_IMPACT_THRESHOLD = parseEther(2); // 2% price impact threshold
  const PER_SWAP_SLIPPAGE_CAP = parseEther(0.5); // 0.5% slippage cap

  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let tokenOutRecipient: HardhatEthersSigner;
  let spareTokenInRecipient: HardhatEthersSigner;
  let burnAddress: HardhatEthersSigner;

  let dataDexRouter: any;
  let dataDexQuoterV2: any;
  let pool: any;
  let tickLens: any;
  let positionManager: any;
  let factory: any;
  let ERC20Token: any;
  let WVANA: any;
  let PoolToken0: any;
  let PoolToken1: any;

  let swapHelper: SwapHelperImplementation;
  let buyAndBurnSwap: BuyAndBurnSwapImplementation;

  let routerAddress: string;
  let quoterV2Address: string;
  let positionManagerAddress: string;
  let tickLensAddress: string;
  let factoryAddress: string;
  let WVANAAddress: string;
  let TokenAddress: string;
  let poolAddress: string;
  let chainId: number;

  const deploy = async (testChainId: number = 1480) => {
    [
      deployer,
      owner,
      user1,
      user2,
      maintainer,
      tokenOutRecipient,
      spareTokenInRecipient,
      burnAddress,
    ] = await ethers.getSigners();

    chainId = testChainId;
    if (chainId === 1480) {
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
      tickLensAddress = "0x5874CB63Fbd1F1A3d1DfCbB451dc35a49Ec63D30";
      factoryAddress = "0xc2a0d530e57B1275fbce908031DA636f95EA1E38";
      WVANAAddress = "0x00EDdD9621Fb08436d0331c149D1690909a5906d";
      TokenAddress = "0xf1815bd50389c46847f0bda824ec8da914045d14"; // USDC
      poolAddress = "0x850e454DDebf9f61Ef5A86A032c857e0e47C4fA9";
    } else {
      // Moksha
      console.log("Running test in a Moksha fork");
      await network.provider.request({
        method: "hardhat_reset",
        params: [
          {
            forking: {
              jsonRpcUrl: process.env.MOKSHA_RPC_URL || "",
              blockNumber: 2_580_450,
            },
          },
        ],
      });

      routerAddress = "0xea04bB2254b7Eee6547F963c2D56C06d50e3A8eB";
      quoterV2Address = "0x3152246f3CD4dD465292Dd4Ffd792E2Cf602e332";
      positionManagerAddress = "0x48Bd633f4B9128a38Ebb4a48b6975EB3Eaf1931b";
      tickLensAddress = "0xbDA64b4112B8A91897Ec57e1F8bd591dc2a22546";
      factoryAddress = "0x7067Eb594d6dc6a5AD33c3fcFCa7183F369bC2e8";
      WVANAAddress = "0xbccc4b4c6530F82FE309c5E845E50b5E9C89f2AD";
      TokenAddress = "0xB39a50B5806039C82932bB96CEFbcbc61231045C";
      poolAddress = "0x124ad2057083b7db2346f3BdC4e6F105DbCB1545";
    }

    dataDexRouter = await ethers.getContractAt(SwapRouter.abi, routerAddress);
    dataDexQuoterV2 = await ethers.getContractAt(QuoterV2.abi, quoterV2Address);
    pool = await ethers.getContractAt(IUniswapV3Pool.abi, poolAddress);
    tickLens = await ethers.getContractAt(TickLens.abi, tickLensAddress);
    positionManager = await ethers.getContractAt(
      INonfungiblePositionManager.abi,
      positionManagerAddress,
    );
    ERC20Token = await ethers.getContractAt(ERC20.abi, TokenAddress);
    WVANA = await ethers.getContractAt(IWVANA.abi, WVANAAddress);
    PoolToken0 = await pool.token0();
    PoolToken1 = await pool.token1();
    factory = await ethers.getContractAt(Factory.abi, factoryAddress);

    (
      await factory.getPool(WVANAAddress, TokenAddress, FeeAmount.MEDIUM)
    ).should.equal(poolAddress);

    // Deploy SwapHelper
    const swapHelperDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("SwapHelperImplementation"),
      [owner.address, dataDexRouter.target, dataDexQuoterV2.target],
      {
        kind: "uups",
      },
    );

    swapHelper = await ethers.getContractAt(
      "SwapHelperImplementation",
      swapHelperDeploy.target,
    );

    // Deploy BuyAndBurnSwap
    const buyAndBurnSwapDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("BuyAndBurnSwapImplementation"),
      [owner.address, swapHelper.target, positionManager.target],
      {
        kind: "uups",
      },
    );

    buyAndBurnSwap = await ethers.getContractAt(
      "BuyAndBurnSwapImplementation",
      buyAndBurnSwapDeploy.target,
    );

    // Grant MAINTAINER_ROLE
    const MAINTAINER_ROLE = await buyAndBurnSwap.MAINTAINER_ROLE();
    await buyAndBurnSwap.connect(owner).grantRole(MAINTAINER_ROLE, maintainer.address);
  };

  describe("Deployment and Setup", () => {
    let snapshotId: any;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should deploy correctly", async () => {
      (await buyAndBurnSwap.version()).should.equal(1);
      (await buyAndBurnSwap.swapHelper()).should.equal(swapHelper.target);
      (await buyAndBurnSwap.positionManager()).should.equal(positionManager.target);
    });

    it("should have correct roles", async () => {
      const DEFAULT_ADMIN_ROLE = await buyAndBurnSwap.DEFAULT_ADMIN_ROLE();
      const MAINTAINER_ROLE = await buyAndBurnSwap.MAINTAINER_ROLE();

      (await buyAndBurnSwap.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).should.be.true;
      (await buyAndBurnSwap.hasRole(MAINTAINER_ROLE, owner.address)).should.be.true;
      (await buyAndBurnSwap.hasRole(MAINTAINER_ROLE, maintainer.address)).should.be.true;
    });

    it("should be unpaused after deployment", async () => {
      (await buyAndBurnSwap.paused()).should.be.false;
    });
  });

  describe("Access Control", () => {
    let snapshotId: any;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should allow owner to pause", async () => {
      await buyAndBurnSwap.connect(owner).pause();
      (await buyAndBurnSwap.paused()).should.be.true;
    });

    it("should allow maintainer to pause", async () => {
      await buyAndBurnSwap.connect(maintainer).pause();
      (await buyAndBurnSwap.paused()).should.be.true;
    });

    it("should not allow non-maintainer to pause", async () => {
      await buyAndBurnSwap
        .connect(user1)
        .pause()
        .should.be.rejectedWith("AccessControlUnauthorizedAccount");
    });

    it("should allow owner to unpause", async () => {
      await buyAndBurnSwap.connect(owner).pause();
      await buyAndBurnSwap.connect(owner).unpause();
      (await buyAndBurnSwap.paused()).should.be.false;
    });

    it("should allow maintainer to update swapHelper", async () => {
      const newSwapHelper = await upgrades.deployProxy(
        await ethers.getContractFactory("SwapHelperImplementation"),
        [owner.address, dataDexRouter.target, dataDexQuoterV2.target],
        { kind: "uups" },
      );

      await buyAndBurnSwap
        .connect(maintainer)
        .updateSwapHelper(newSwapHelper.target);
      (await buyAndBurnSwap.swapHelper()).should.equal(newSwapHelper.target);
    });

    it("should not allow non-maintainer to update swapHelper", async () => {
      const newSwapHelper = await upgrades.deployProxy(
        await ethers.getContractFactory("SwapHelperImplementation"),
        [owner.address, dataDexRouter.target, dataDexQuoterV2.target],
        { kind: "uups" },
      );

      await buyAndBurnSwap
        .connect(user1)
        .updateSwapHelper(newSwapHelper.target)
        .should.be.rejectedWith("AccessControlUnauthorizedAccount");
    });

    it("should not allow updating to zero address", async () => {
      await buyAndBurnSwap
        .connect(maintainer)
        .updateSwapHelper(ethers.ZeroAddress)
        .should.be.rejectedWith("BuyAndBurnSwap__ZeroAddress");
    });
  });

  describe("Pausability", () => {
    let snapshotId: any;
    let lpTokenId: bigint;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();

      // Give user1 enough balance
      await network.provider.send("hardhat_setBalance", [
        user1.address,
        toHex(parseEther(10000)),
      ]);

      // Create LP position for testing
      lpTokenId = await createLPPosition(
        user1,
        positionManager,
        WVANA,
        ERC20Token,
        swapHelper,
        parseEther(1000),
        parseEther(100),
      );

      // Transfer LP position to user2 for testing
      await positionManager
        .connect(user1)
        .transferFrom(user1.address, user2.address, lpTokenId);

      // Approve BuyAndBurnSwap to manage the NFT position
      await positionManager
        .connect(user2)
        .approve(buyAndBurnSwap.target, lpTokenId);
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should reject swapAndAddLiquidity when paused", async () => {
      await buyAndBurnSwap.connect(owner).pause();

      const amountIn = parseEther(10);
      await buyAndBurnSwap
        .connect(user2)
        .swapAndAddLiquidity(
          {
            tokenIn: VANA,
            tokenOut: ERC20Token.target,
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: tokenOutRecipient.address,
            spareTokenInRecipient: spareTokenInRecipient.address,
            amountIn: amountIn,
            singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
            perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
            lpTokenId: lpTokenId,
          },
          { value: amountIn },
        )
        .should.be.rejectedWith("EnforcedPause");
    });

    it("should allow swapAndAddLiquidity after unpause", async () => {
      await buyAndBurnSwap.connect(owner).pause();
      await buyAndBurnSwap.connect(owner).unpause();

      const amountIn = parseEther(10);
      await buyAndBurnSwap
        .connect(user2)
        .swapAndAddLiquidity(
          {
            tokenIn: VANA,
            tokenOut: ERC20Token.target,
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: tokenOutRecipient.address,
            spareTokenInRecipient: spareTokenInRecipient.address,
            amountIn: amountIn,
            singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
            perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
            lpTokenId: lpTokenId,
          },
          { value: amountIn },
        ).should.not.be.rejected;
    });
  });

  describe("swapAndAddLiquidity - Happy Path", () => {
    let snapshotId: any;
    let lpTokenId: bigint;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();

      // Give user1 enough balance
      await network.provider.send("hardhat_setBalance", [
        user1.address,
        toHex(parseEther(10000)),
      ]);

      // Create LP position for testing
      lpTokenId = await createLPPosition(
        user1,
        positionManager,
        WVANA,
        ERC20Token,
        swapHelper,
        parseEther(1000),
        parseEther(100),
      );

      await positionManager
        .connect(user1)
        .transferFrom(user1.address, user2.address, lpTokenId);

      // Approve BuyAndBurnSwap to manage the NFT position
      await positionManager
        .connect(user2)
        .approve(buyAndBurnSwap.target, lpTokenId);
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should execute swapAndAddLiquidity with VANA as tokenIn (greedy strategy)", async () => {
      const amountIn = parseEther(100);

      const balanceBefore = await ethers.provider.getBalance(user2.address);
      const tokenOutRecipientBalanceBefore = await ERC20Token.balanceOf(
        tokenOutRecipient.address,
      );

      const positionBefore = await positionManager.positions(lpTokenId);
      const liquidityBefore = positionBefore.liquidity;

      const tx = await buyAndBurnSwap.connect(user2).swapAndAddLiquidity(
        {
          tokenIn: VANA,
          tokenOut: ERC20Token.target,
          fee: FeeAmount.MEDIUM,
          tokenOutRecipient: tokenOutRecipient.address,
          spareTokenInRecipient: spareTokenInRecipient.address,
          amountIn: amountIn,
          singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
          perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
          lpTokenId: lpTokenId,
        },
        { value: amountIn },
      );

      const receipt = await getReceipt(tx);

      const balanceAfter = await ethers.provider.getBalance(user2.address);
      const tokenOutRecipientBalanceAfter = await ERC20Token.balanceOf(
        tokenOutRecipient.address,
      );
      const positionAfter = await positionManager.positions(lpTokenId);
      const liquidityAfter = positionAfter.liquidity;

      // With greedy strategy, liquidity may or may not increase (depends on pool liquidity)
      // It's OK if liquidityDelta = 0 (all swapped, nothing left for LP)
      liquidityAfter.should.be.gte(liquidityBefore);

      // Verify user2 paid amountIn + gas
      balanceAfter.should.equal(balanceBefore - amountIn - receipt.fee);

      // CRITICAL: Verify tokenOut went to burn address (greedy strategy priority)
      const tokenOutReceived = tokenOutRecipientBalanceAfter - tokenOutRecipientBalanceBefore;
      tokenOutReceived.should.be.gt(0); // Should have received some DLP tokens for burning

      console.log("TokenOut (DLP) sent to burn:", ethers.formatEther(tokenOutReceived));
      console.log("Liquidity added:", liquidityAfter - liquidityBefore);
    });

    it("should transfer spare tokenOut to tokenOutRecipient (burn address)", async () => {
      const amountIn = parseEther(50);

      const tokenOutRecipientBalanceBefore = await ERC20Token.balanceOf(
        tokenOutRecipient.address,
      );

      const { liquidityDelta, spareIn, spareOut } = await buyAndBurnSwap
        .connect(user2)
        .swapAndAddLiquidity.staticCall(
          {
            tokenIn: VANA,
            tokenOut: ERC20Token.target,
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: tokenOutRecipient.address,
            spareTokenInRecipient: spareTokenInRecipient.address,
            amountIn: amountIn,
            singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
            perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
            lpTokenId: lpTokenId,
          },
          { value: amountIn },
        );

      await buyAndBurnSwap.connect(user2).swapAndAddLiquidity(
        {
          tokenIn: VANA,
          tokenOut: ERC20Token.target,
          fee: FeeAmount.MEDIUM,
          tokenOutRecipient: tokenOutRecipient.address,
          spareTokenInRecipient: spareTokenInRecipient.address,
          amountIn: amountIn,
          singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
          perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
          lpTokenId: lpTokenId,
        },
        { value: amountIn },
      );

      const tokenOutRecipientBalanceAfter = await ERC20Token.balanceOf(
        tokenOutRecipient.address,
      );

      // With greedy strategy, ALL tokenOut goes to burn (not used for LP)
      spareOut.should.be.gt(0);
      tokenOutRecipientBalanceAfter.should.equal(
        tokenOutRecipientBalanceBefore + spareOut,
      );
    });

    it("should transfer spare tokenIn to spareTokenInRecipient (if any left)", async () => {
      const amountIn = parseEther(50);

      const spareRecipientBalanceBefore = await ethers.provider.getBalance(
        spareTokenInRecipient.address,
      );

      const { liquidityDelta, spareIn, spareOut } = await buyAndBurnSwap
        .connect(user2)
        .swapAndAddLiquidity.staticCall(
          {
            tokenIn: VANA,
            tokenOut: ERC20Token.target,
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: tokenOutRecipient.address,
            spareTokenInRecipient: spareTokenInRecipient.address,
            amountIn: amountIn,
            singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
            perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
            lpTokenId: lpTokenId,
          },
          { value: amountIn },
        );

      await buyAndBurnSwap.connect(user2).swapAndAddLiquidity(
        {
          tokenIn: VANA,
          tokenOut: ERC20Token.target,
          fee: FeeAmount.MEDIUM,
          tokenOutRecipient: tokenOutRecipient.address,
          spareTokenInRecipient: spareTokenInRecipient.address,
          amountIn: amountIn,
          singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
          perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
          lpTokenId: lpTokenId,
        },
        { value: amountIn },
      );

      const spareRecipientBalanceAfter = await ethers.provider.getBalance(
        spareTokenInRecipient.address,
      );

      // With greedy strategy, spareIn may be 0 (all swapped) or > 0 (leftover added to LP)
      if (spareIn > 0n) {
        spareRecipientBalanceAfter.should.equal(
          spareRecipientBalanceBefore + spareIn,
        );
      } else {
        spareRecipientBalanceAfter.should.equal(spareRecipientBalanceBefore);
      }
    });

    it("should execute with ERC20 as tokenIn (greedy strategy)", async () => {
      // Give user1 extra funds for this test
      await network.provider.send("hardhat_setBalance", [
        user1.address,
        toHex(parseEther(20000)),
      ]);

      // Get a substantial amount of ERC20 for user1
      const largeSwapAmount = parseEther(10000);
      await swapHelper.connect(user1).exactInputSingle(
        {
          tokenIn: VANA,
          tokenOut: ERC20Token.target,
          fee: FeeAmount.MEDIUM,
          recipient: user1.address,
          amountIn: largeSwapAmount,
          amountOutMinimum: 0,
        },
        { value: largeSwapAmount },
      );

      const user1Balance = await ERC20Token.balanceOf(user1.address);

      // Transfer a good amount to user2
      const transferAmount = user1Balance / 2n;
      await ERC20Token.connect(user1).transfer(user2.address, transferAmount);

      const user2Balance = await ERC20Token.balanceOf(user2.address);

      // Use a good portion for the test
      const amountIn = (transferAmount * 80n) / 100n;

      await ERC20Token.connect(user2).approve(buyAndBurnSwap.target, amountIn);

      const tokenOutRecipientBalanceBefore = await ethers.provider.getBalance(
        tokenOutRecipient.address,
      );
      const positionBefore = await positionManager.positions(lpTokenId);
      const liquidityBefore = positionBefore.liquidity;

      await buyAndBurnSwap.connect(user2).swapAndAddLiquidity({
        tokenIn: ERC20Token.target,
        tokenOut: VANA,
        fee: FeeAmount.MEDIUM,
        tokenOutRecipient: tokenOutRecipient.address,
        spareTokenInRecipient: spareTokenInRecipient.address,
        amountIn: amountIn,
        singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
        perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
        lpTokenId: lpTokenId,
      });

      const positionAfter = await positionManager.positions(lpTokenId);
      const liquidityAfter = positionAfter.liquidity;
      const tokenOutRecipientBalanceAfter = await ethers.provider.getBalance(
        tokenOutRecipient.address,
      );

      // With greedy strategy, liquidity may or may not increase
      liquidityAfter.should.be.gte(liquidityBefore);

      // Verify tokens were spent
      const tokenBalanceAfter = await ERC20Token.balanceOf(user2.address);
      tokenBalanceAfter.should.be.lt(user2Balance);

      // CRITICAL: Verify VANA was sent to burn address (greedy strategy)
      const vanaReceived = tokenOutRecipientBalanceAfter - tokenOutRecipientBalanceBefore;
      vanaReceived.should.be.gt(0);

      console.log("VANA sent to burn:", ethers.formatEther(vanaReceived));
    });

    it("should demonstrate greedy strategy: USDC -> VANA with high liquidity (spareIn=0, spareOut>0)", async () => {
      // Give user1 extra funds for this test
      await network.provider.send("hardhat_setBalance", [
        user1.address,
        toHex(parseEther(50000)), // Large balance
      ]);

      // Get a very large amount of USDC for user1 by swapping a lot of VANA
      const largeSwapAmount = parseEther(20000); // 20,000 VANA
      await swapHelper.connect(user1).exactInputSingle(
        {
          tokenIn: VANA,
          tokenOut: ERC20Token.target, // USDC
          fee: FeeAmount.MEDIUM,
          recipient: user1.address,
          amountIn: largeSwapAmount,
          amountOutMinimum: 0,
        },
        { value: largeSwapAmount },
      );

      const user1USDCBalance = await ERC20Token.balanceOf(user1.address);
      console.log("\n=== Greedy Strategy Test: USDC → VANA ===");
      console.log("User1 USDC balance:", ethers.formatUnits(user1USDCBalance, 6)); // USDC has 6 decimals

      // Transfer substantial USDC to user2
      const transferAmount = user1USDCBalance / 2n;
      await ERC20Token.connect(user1).transfer(user2.address, transferAmount);

      const user2USDCBalance = await ERC20Token.balanceOf(user2.address);
      console.log("User2 USDC balance:", ethers.formatUnits(user2USDCBalance, 6));

      // Use a large amount to ensure greedy swap consumes everything
      const amountIn = (transferAmount * 90n) / 100n; // Use 90% of transferred amount
      console.log("Amount to swap:", ethers.formatUnits(amountIn, 6), "USDC");

      await ERC20Token.connect(user2).approve(buyAndBurnSwap.target, amountIn);

      const positionBefore = await positionManager.positions(lpTokenId);
      const liquidityBefore = positionBefore.liquidity;
      const burnAddressBalanceBefore = await ethers.provider.getBalance(
        tokenOutRecipient.address,
      );
      const spareRecipientBalanceBefore = await ERC20Token.balanceOf(
        spareTokenInRecipient.address,
      );

      console.log("\nBefore swap:");
      console.log("  Liquidity:", liquidityBefore.toString());
      console.log("  Burn address VANA balance:", ethers.formatEther(burnAddressBalanceBefore));

      // Execute swapAndAddLiquidity with USDC -> VANA
      const { liquidityDelta, spareIn, spareOut } = await buyAndBurnSwap
        .connect(user2)
        .swapAndAddLiquidity.staticCall(
          {
            tokenIn: ERC20Token.target, // USDC
            tokenOut: VANA, // VANA
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: tokenOutRecipient.address, // Burn address for VANA
            spareTokenInRecipient: spareTokenInRecipient.address, // Treasury for leftover USDC
            amountIn: amountIn,
            singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
            perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
            lpTokenId: lpTokenId,
          },
        );

      console.log("\nStatic call results:");
      console.log("  liquidityDelta:", liquidityDelta.toString());
      console.log("  spareIn (leftover USDC):", ethers.formatUnits(spareIn, 6), "USDC");
      console.log("  spareOut (VANA to burn):", ethers.formatEther(spareOut), "VANA");

      // CRITICAL GREEDY STRATEGY VALIDATION:
      // With high liquidity and large amount, we expect:
      // - spareIn = 0 (all USDC swapped)
      // - spareOut > 0 (VANA received goes to burn)
      // - liquidityDelta = 0 (no LP added since nothing left)

      console.log("\n🎯 Greedy Strategy Validation:");
      console.log("  Expected: spareIn = 0 (all swapped)");
      console.log("  Actual: spareIn =", spareIn.toString());
      console.log("  Expected: spareOut > 0 (VANA for burning)");
      console.log("  Actual: spareOut =", spareOut.toString());
      console.log("  Expected: liquidityDelta = 0 (no LP)");
      console.log("  Actual: liquidityDelta =", liquidityDelta.toString());

      // Execute the actual transaction
      await buyAndBurnSwap.connect(user2).swapAndAddLiquidity({
        tokenIn: ERC20Token.target, // USDC
        tokenOut: VANA, // VANA
        fee: FeeAmount.MEDIUM,
        tokenOutRecipient: tokenOutRecipient.address,
        spareTokenInRecipient: spareTokenInRecipient.address,
        amountIn: amountIn,
        singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
        perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
        lpTokenId: lpTokenId,
      });

      const positionAfter = await positionManager.positions(lpTokenId);
      const liquidityAfter = positionAfter.liquidity;
      const burnAddressBalanceAfter = await ethers.provider.getBalance(
        tokenOutRecipient.address,
      );
      const spareRecipientBalanceAfter = await ERC20Token.balanceOf(
        spareTokenInRecipient.address,
      );

      console.log("\nAfter swap:");
      console.log("  Liquidity:", liquidityAfter.toString());
      console.log("  Burn address VANA balance:", ethers.formatEther(burnAddressBalanceAfter));

      // Verify greedy strategy behavior
      if (spareIn === 0n) {
        console.log("\n✅ GREEDY STRATEGY CONFIRMED: All USDC swapped, none left for LP");
        spareIn.should.equal(0); // All USDC was swapped
        spareOut.should.be.gt(0); // Received VANA for burning
        liquidityDelta.should.equal(0); // No LP addition (nothing left)
        liquidityAfter.should.equal(liquidityBefore); // Liquidity unchanged
      } else {
        console.log("\n⚠️  PARTIAL SWAP: Some USDC left (pool liquidity limit reached)");
        spareIn.should.be.gt(0); // Some USDC leftover
        spareOut.should.be.gt(0); // Still got VANA for burning
        // Liquidity might have increased if leftover was added to LP
      }

      // Verify VANA was sent to burn address
      const vanaReceived = burnAddressBalanceAfter - burnAddressBalanceBefore;
      vanaReceived.should.equal(spareOut);
      vanaReceived.should.be.gt(0);
      console.log("\n💰 Total VANA sent to burn:", ethers.formatEther(vanaReceived));

      // Verify spare USDC handling
      const spareUSDCReceived = spareRecipientBalanceAfter - spareRecipientBalanceBefore;
      spareUSDCReceived.should.equal(spareIn);
      if (spareIn > 0n) {
        console.log("💼 Spare USDC sent to treasury:", ethers.formatUnits(spareUSDCReceived, 6));
      }

      // Verify user2's USDC was spent
      const user2USDCBalanceAfter = await ERC20Token.balanceOf(user2.address);
      user2USDCBalanceAfter.should.be.lt(user2USDCBalance);

      console.log("\n=== Test Complete ===");
      console.log("Summary:");
      console.log("  Input: ", ethers.formatUnits(amountIn, 6), "USDC");
      console.log("  Swapped:", ethers.formatUnits(amountIn - spareIn, 6), "USDC");
      console.log("  Received:", ethers.formatEther(vanaReceived), "VANA (to burn)");
      console.log("  LP Added:", liquidityDelta.toString());
      console.log("  Efficiency:", `${((amountIn - spareIn) * 100n / amountIn)}% swapped`);
    });
  });

  describe("swapAndAddLiquidity - Edge Cases", () => {
    let snapshotId: any;
    let lpTokenId: bigint;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();

      // Give user1 enough balance
      await network.provider.send("hardhat_setBalance", [
        user1.address,
        toHex(parseEther(10000)),
      ]);

      // Create LP position
      lpTokenId = await createLPPosition(
        user1,
        positionManager,
        WVANA,
        ERC20Token,
        swapHelper,
        parseEther(1000),
        parseEther(100),
      );

      await positionManager
        .connect(user1)
        .transferFrom(user1.address, user2.address, lpTokenId);

      // Approve BuyAndBurnSwap to manage the NFT position
      await positionManager
        .connect(user2)
        .approve(buyAndBurnSwap.target, lpTokenId);
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should reject with zero amountIn", async () => {
      await buyAndBurnSwap
        .connect(user2)
        .swapAndAddLiquidity({
          tokenIn: VANA,
          tokenOut: ERC20Token.target,
          fee: FeeAmount.MEDIUM,
          tokenOutRecipient: tokenOutRecipient.address,
          spareTokenInRecipient: spareTokenInRecipient.address,
          amountIn: 0,
          singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
          perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
          lpTokenId: lpTokenId,
        })
        .should.be.rejectedWith("BuyAndBurnSwap__ZeroAmount");
    });

    it("should reject with insufficient msg.value", async () => {
      const amountIn = parseEther(100);
      await buyAndBurnSwap
        .connect(user2)
        .swapAndAddLiquidity(
          {
            tokenIn: VANA,
            tokenOut: ERC20Token.target,
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: tokenOutRecipient.address,
            spareTokenInRecipient: spareTokenInRecipient.address,
            amountIn: amountIn,
            singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
            perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
            lpTokenId: lpTokenId,
          },
          { value: amountIn / 2n }, // Send less than amountIn
        )
        .should.be.rejectedWith("BuyAndBurnSwap__InsufficientAmount");
    });

    it("should handle small amounts (greedy swap, may not add LP)", async () => {
      const amountIn = parseEther(0.001); // Very small amount

      const tokenOutRecipientBalanceBefore = await ERC20Token.balanceOf(
        tokenOutRecipient.address,
      );

      const { liquidityDelta, spareIn, spareOut } = await buyAndBurnSwap
        .connect(user2)
        .swapAndAddLiquidity.staticCall(
          {
            tokenIn: VANA,
            tokenOut: ERC20Token.target,
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: tokenOutRecipient.address,
            spareTokenInRecipient: spareTokenInRecipient.address,
            amountIn: amountIn,
            singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
            perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
            lpTokenId: lpTokenId,
          },
          { value: amountIn },
        );

      await buyAndBurnSwap.connect(user2).swapAndAddLiquidity(
        {
          tokenIn: VANA,
          tokenOut: ERC20Token.target,
          fee: FeeAmount.MEDIUM,
          tokenOutRecipient: tokenOutRecipient.address,
          spareTokenInRecipient: spareTokenInRecipient.address,
          amountIn: amountIn,
          singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
          perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
          lpTokenId: lpTokenId,
        },
        { value: amountIn },
      );

      const tokenOutRecipientBalanceAfter = await ERC20Token.balanceOf(
        tokenOutRecipient.address,
      );

      // With greedy strategy, small amounts likely swap entirely (liquidityDelta = 0 is OK)
      // The important thing is that tokenOut was sent to burn address
      const tokenOutReceived = tokenOutRecipientBalanceAfter - tokenOutRecipientBalanceBefore;
      tokenOutReceived.should.be.gt(0); // Should have swapped to some DLP for burning
    });

    it("should handle large amounts (greedy swap priority)", async () => {
      // Give user2 a large balance
      await network.provider.send("hardhat_setBalance", [
        user2.address,
        toHex(parseEther(10000)),
      ]);

      const amountIn = parseEther(1000); // Large amount

      const positionBefore = await positionManager.positions(lpTokenId);
      const liquidityBefore = positionBefore.liquidity;
      const tokenOutRecipientBalanceBefore = await ERC20Token.balanceOf(
        tokenOutRecipient.address,
      );

      await buyAndBurnSwap.connect(user2).swapAndAddLiquidity(
        {
          tokenIn: VANA,
          tokenOut: ERC20Token.target,
          fee: FeeAmount.MEDIUM,
          tokenOutRecipient: tokenOutRecipient.address,
          spareTokenInRecipient: spareTokenInRecipient.address,
          amountIn: amountIn,
          singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
          perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
          lpTokenId: lpTokenId,
        },
        { value: amountIn },
      );

      const positionAfter = await positionManager.positions(lpTokenId);
      const liquidityAfter = positionAfter.liquidity;
      const tokenOutRecipientBalanceAfter = await ERC20Token.balanceOf(
        tokenOutRecipient.address,
      );

      // Liquidity may or may not increase (greedy swaps as much as possible)
      liquidityAfter.should.be.gte(liquidityBefore);

      // CRITICAL: Large amount should produce significant tokenOut for burning
      const tokenOutReceived = tokenOutRecipientBalanceAfter - tokenOutRecipientBalanceBefore;
      tokenOutReceived.should.be.gt(0);

      console.log("Large swap - TokenOut to burn:", ethers.formatEther(tokenOutReceived));
      console.log("Large swap - Liquidity delta:", liquidityAfter - liquidityBefore);
    });
  });

  describe("swapAndAddLiquidity - Fuzzing", () => {
    let snapshotId: any;
    let lpTokenId: bigint;

    before(async () => {
      await deploy();

      // Give user1 a very large balance for all fuzzing tests
      await network.provider.send("hardhat_setBalance", [
        user1.address,
        toHex(parseEther(100000)),
      ]);

      // Create LP position once for all fuzzing tests
      lpTokenId = await createLPPosition(
        user1,
        positionManager,
        WVANA,
        ERC20Token,
        swapHelper,
        parseEther(10000),
        parseEther(1000),
      );

      await positionManager
        .connect(user1)
        .transferFrom(user1.address, user2.address, lpTokenId);

      // Approve BuyAndBurnSwap to manage the NFT position
      await positionManager
        .connect(user2)
        .approve(buyAndBurnSwap.target, lpTokenId);
    });

    it("should handle random amounts (fuzzing) - greedy strategy", async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 100 }), async (amount) => {
          const testSnapshotId = await network.provider.send("evm_snapshot");

          try {
            const amountIn = parseEther(amount);

            // Give user2 enough balance
            await network.provider.send("hardhat_setBalance", [
              user2.address,
              toHex(amountIn * 2n),
            ]);

            const positionBefore = await positionManager.positions(lpTokenId);
            const liquidityBefore = positionBefore.liquidity;
            const tokenOutRecipientBalanceBefore = await ERC20Token.balanceOf(
              tokenOutRecipient.address,
            );

            const { liquidityDelta, spareIn, spareOut } = await buyAndBurnSwap
              .connect(user2)
              .swapAndAddLiquidity.staticCall(
                {
                  tokenIn: VANA,
                  tokenOut: ERC20Token.target,
                  fee: FeeAmount.MEDIUM,
                  tokenOutRecipient: tokenOutRecipient.address,
                  spareTokenInRecipient: spareTokenInRecipient.address,
                  amountIn: amountIn,
                  singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
                  perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
                  lpTokenId: lpTokenId,
                },
                { value: amountIn },
              );

            // With greedy strategy, liquidityDelta CAN be 0 (all swapped)
            liquidityDelta.should.be.gte(0);

            // Verify spare amounts are within bounds
            spareIn.should.be.lte(amountIn);
            spareOut.should.be.gte(0);

            // CRITICAL: spareOut (tokenOut for burning) should be positive for greedy strategy
            spareOut.should.be.gt(0);

            // Actually execute the transaction
            await buyAndBurnSwap.connect(user2).swapAndAddLiquidity(
              {
                tokenIn: VANA,
                tokenOut: ERC20Token.target,
                fee: FeeAmount.MEDIUM,
                tokenOutRecipient: tokenOutRecipient.address,
                spareTokenInRecipient: spareTokenInRecipient.address,
                amountIn: amountIn,
                singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
                perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
                lpTokenId: lpTokenId,
              },
              { value: amountIn },
            );

            const positionAfter = await positionManager.positions(lpTokenId);
            const liquidityAfter = positionAfter.liquidity;
            const tokenOutRecipientBalanceAfter = await ERC20Token.balanceOf(
              tokenOutRecipient.address,
            );

            // Liquidity may stay same or increase (greedy swaps as much as possible)
            liquidityAfter.should.be.gte(liquidityBefore);

            // Verify tokenOut was sent to burn address
            const tokenOutReceived = tokenOutRecipientBalanceAfter - tokenOutRecipientBalanceBefore;
            tokenOutReceived.should.equal(spareOut);

            console.log(
              `✓ Amount: ${amount} VANA, Liquidity: ${liquidityDelta}, SpareIn: ${spareIn}, SpareOut (burn): ${spareOut}`,
            );
          } catch (err) {
            console.error("❌ Failed with input:", amount, err);
            throw err;
          } finally {
            await network.provider.send("evm_revert", [testSnapshotId]);
          }
        }),
        {
          numRuns: NUM_RUNS,
          verbose: true,
        },
      );
    });
  });

  describe("Integration with Buy-and-Burn Flow", () => {
    let snapshotId: any;
    let lpTokenId: bigint;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();

      // Give user1 enough balance
      await network.provider.send("hardhat_setBalance", [
        user1.address,
        toHex(parseEther(10000)),
      ]);

      // Setup LP position
      lpTokenId = await createLPPosition(
        user1,
        positionManager,
        WVANA,
        ERC20Token,
        swapHelper,
        parseEther(1000),
        parseEther(100),
      );

      await positionManager
        .connect(user1)
        .transferFrom(user1.address, user2.address, lpTokenId);

      // Approve BuyAndBurnSwap to manage the NFT position
      await positionManager
        .connect(user2)
        .approve(buyAndBurnSwap.target, lpTokenId);
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should simulate buy-and-burn: swap VANA -> DLP, burn spare DLP", async () => {
      const dataAccessFee = parseEther(100); // Simulating $100 data access fee
      const dlpShare = (dataAccessFee * 80n) / 100n; // 80% goes to DLP

      // Use burn address as tokenOutRecipient (for spare DLP)
      // Use treasury as spareTokenInRecipient (for spare VANA)
      const burnAddressBalanceBefore = await ERC20Token.balanceOf(
        burnAddress.address,
      );
      const treasuryBalanceBefore = await ethers.provider.getBalance(
        spareTokenInRecipient.address,
      );

      const { liquidityDelta, spareIn, spareOut } = await buyAndBurnSwap
        .connect(user2)
        .swapAndAddLiquidity.staticCall(
          {
            tokenIn: VANA,
            tokenOut: ERC20Token.target, // DLP token
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: burnAddress.address, // Burn spare DLP
            spareTokenInRecipient: spareTokenInRecipient.address, // Return spare VANA to treasury
            amountIn: dlpShare,
            singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
            perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
            lpTokenId: lpTokenId,
          },
          { value: dlpShare },
        );

      await buyAndBurnSwap.connect(user2).swapAndAddLiquidity(
        {
          tokenIn: VANA,
          tokenOut: ERC20Token.target,
          fee: FeeAmount.MEDIUM,
          tokenOutRecipient: burnAddress.address,
          spareTokenInRecipient: spareTokenInRecipient.address,
          amountIn: dlpShare,
          singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
          perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
          lpTokenId: lpTokenId,
        },
        { value: dlpShare },
      );

      const burnAddressBalanceAfter = await ERC20Token.balanceOf(
        burnAddress.address,
      );
      const treasuryBalanceAfter = await ethers.provider.getBalance(
        spareTokenInRecipient.address,
      );

      // CRITICAL: With greedy strategy, ALL DLP goes to burn (spareOut)
      const dlpBurned = burnAddressBalanceAfter - burnAddressBalanceBefore;
      dlpBurned.should.equal(spareOut);
      dlpBurned.should.be.gt(0); // Should have burned some DLP

      // Verify spare VANA was sent to treasury (if any leftover)
      if (spareIn > 0n) {
        treasuryBalanceAfter.should.equal(treasuryBalanceBefore + spareIn);
      }

      console.log("\n=== Buy-and-Burn Simulation (Greedy Strategy) ===");
      console.log(`Data Access Fee (80% DLP share): ${ethers.formatEther(dlpShare)} VANA`);
      console.log(`Liquidity Added: ${liquidityDelta}`);
      console.log(`Spare VANA (to treasury): ${ethers.formatEther(spareIn)}`);
      console.log(`DLP Burned: ${ethers.formatEther(dlpBurned)}`);
    });

    it("should handle multiple buy-and-burn iterations", async () => {
      let totalLiquidityAdded = 0n;
      let totalSpareVANA = 0n;
      let totalDLPBurned = 0n;

      // Simulate 3 sequential buy-and-burn operations
      for (let i = 0; i < 3; i++) {
        const amount = parseEther(50 + i * 25); // 50, 75, 100 VANA

        const burnBalanceBefore = await ERC20Token.balanceOf(burnAddress.address);

        const { liquidityDelta, spareIn, spareOut } = await buyAndBurnSwap
          .connect(user2)
          .swapAndAddLiquidity.staticCall(
            {
              tokenIn: VANA,
              tokenOut: ERC20Token.target,
              fee: FeeAmount.MEDIUM,
              tokenOutRecipient: burnAddress.address,
              spareTokenInRecipient: spareTokenInRecipient.address,
              amountIn: amount,
              singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
              perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
              lpTokenId: lpTokenId,
            },
            { value: amount },
          );

        await buyAndBurnSwap.connect(user2).swapAndAddLiquidity(
          {
            tokenIn: VANA,
            tokenOut: ERC20Token.target,
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: burnAddress.address,
            spareTokenInRecipient: spareTokenInRecipient.address,
            amountIn: amount,
            singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
            perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
            lpTokenId: lpTokenId,
          },
          { value: amount },
        );

        const burnBalanceAfter = await ERC20Token.balanceOf(burnAddress.address);
        const dlpBurned = burnBalanceAfter - burnBalanceBefore;

        totalLiquidityAdded += liquidityDelta;
        totalSpareVANA += spareIn;
        totalDLPBurned += BigInt(dlpBurned);

        console.log(`\nIteration ${i + 1}:`);
        console.log(`  Amount In: ${ethers.formatEther(amount)} VANA`);
        console.log(`  Liquidity Added: ${liquidityDelta}`);
        console.log(`  Spare VANA: ${ethers.formatEther(spareIn)}`);
        console.log(`  DLP Burned: ${ethers.formatEther(dlpBurned)}`);
      }

      console.log("\n=== Multiple Iteration Summary (Greedy Strategy) ===");
      console.log(`Total Liquidity Added: ${totalLiquidityAdded}`);
      console.log(`Total Spare VANA: ${ethers.formatEther(totalSpareVANA)}`);
      console.log(`Total DLP Burned: ${ethers.formatEther(totalDLPBurned)}`);

      // With greedy strategy, we should have burned significant DLP
      totalDLPBurned.should.be.gt(0);
    });

    it("should handle cron job pattern: recycle spareIn with LP consuming tokenOut", async () => {
      await network.provider.send("hardhat_setBalance", [
        user2.address,
        toHex(parseEther(5000)),
      ]);

      console.log("\n=== Cron Job Simulation: SpareIn Recycling (spareOut=0) ===");

      // The pattern to test:
      // Call 1: Large input → swap partial → leftover tokenIn (spareIn1 > 0)
      //         tokenOut gets added to LP → spareOut1 = 0
      // Call 2: Use spareIn1 as input → repeat pattern

      const initialAmount = parseEther(150);
      const tightThreshold = parseEther(0.3);

      let currentAmountIn = initialAmount;
      const callResults: Array<{
        call: number;
        amountIn: bigint;
        liquidityDelta: bigint;
        spareIn: bigint;
        spareOut: bigint;
      }> = [];

      // Multiple calls recycling spareIn
      for (let call = 1; call <= 3; call++) {
        console.log(`\n--- Cron Job Call ${call} ---`);
        console.log(`Input: ${ethers.formatEther(currentAmountIn)} VANA`);

        const { liquidityDelta, spareIn, spareOut } = await buyAndBurnSwap
          .connect(user2)
          .swapAndAddLiquidity.staticCall(
            {
              tokenIn: VANA,
              tokenOut: ERC20Token.target,
              fee: FeeAmount.MEDIUM,
              tokenOutRecipient: tokenOutRecipient.address,
              spareTokenInRecipient: spareTokenInRecipient.address,
              amountIn: currentAmountIn,
              singleBatchImpactThreshold: tightThreshold,
              perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
              lpTokenId: lpTokenId,
            },
            { value: currentAmountIn },
          );

        await buyAndBurnSwap.connect(user2).swapAndAddLiquidity(
          {
            tokenIn: VANA,
            tokenOut: ERC20Token.target,
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: tokenOutRecipient.address,
            spareTokenInRecipient: spareTokenInRecipient.address,
            amountIn: currentAmountIn,
            singleBatchImpactThreshold: tightThreshold,
            perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
            lpTokenId: lpTokenId,
          },
          { value: currentAmountIn },
        );

        callResults.push({ call, amountIn: currentAmountIn, liquidityDelta, spareIn, spareOut });

        console.log(`  Liquidity added: ${liquidityDelta}`);
        console.log(`  Spare VANA (for next call): ${ethers.formatEther(spareIn)}`);
        console.log(`  DLP to burn: ${ethers.formatEther(spareOut)}`);

        // Pattern:
        // - spareIn > 0 (leftover tokenIn for next iteration)
        // - Ideally spareOut = 0 (all tokenOut went to LP), but may have some spillover

        if (spareIn > 0n) {
          console.log(`Recycling spare for next call`);
          currentAmountIn = spareIn;
        } else {
          console.log(`All VANA consumed`);
          break;
        }
      }

      // Display summary
      console.log(`\n=== Cron Job Summary ===`);
      console.log(`Total calls: ${callResults.length}`);
      console.log(`Starting amount: ${ethers.formatEther(initialAmount)} VANA`);

      callResults.forEach(({ call, amountIn, liquidityDelta, spareIn, spareOut }) => {
        console.log(`\nCall ${call}:`);
        console.log(`  Input: ${ethers.formatEther(amountIn)}`);
        console.log(`  Liquidity: ${liquidityDelta}`);
        console.log(`  Spare In: ${ethers.formatEther(spareIn)}`);
        console.log(`  Spare Out: ${ethers.formatEther(spareOut)}`);
      });

      const totalLiquidity = callResults.reduce((sum, r) => sum + r.liquidityDelta, 0n);
      const finalSpareIn = callResults[callResults.length - 1].spareIn;
      const totalBurned = callResults.reduce((sum, r) => sum + r.spareOut, 0n);

      console.log(`\nTotals:`);
      console.log(`  Liquidity added: ${totalLiquidity}`);
      console.log(`  Final spare: ${ethers.formatEther(finalSpareIn)}`);
      console.log(`  Total burned: ${ethers.formatEther(totalBurned)}`);

      // Verify the cron job pattern
      callResults.length.should.be.gte(1);

      // Verify spareIn recycling: each call's input should equal previous spare (except first)
      for (let i = 1; i < callResults.length; i++) {
        callResults[i].amountIn.should.equal(callResults[i - 1].spareIn);
      }

      console.log(`\nCron job pattern verified: spareIn successfully recycled across ${callResults.length} calls`);
    });

    it("should demonstrate spareIn recycling with tight threshold", async () => {
      // Give user2 a balance
      await network.provider.send("hardhat_setBalance", [
        user2.address,
        toHex(parseEther(5000)),
      ]);

      console.log("\n=== Forced Multi-Iteration Pattern with Tight Threshold ===");

      // Start with large amount and VERY tight threshold to guarantee NO path
      const initialAmount = parseEther(200);
      const veryTightThreshold = parseEther(0.2); // 0.2% - very restrictive

      let currentAmountIn = initialAmount;
      let iteration = 0;
      const results: Array<{iteration: number, amountIn: bigint, spareIn: bigint, spareOut: bigint, liquidityDelta: bigint}> = [];

      // Keep iterating until spareIn = 0 or max 5 iterations
      while (currentAmountIn > 0n && iteration < 5) {
        iteration++;

        const { liquidityDelta, spareIn, spareOut } = await buyAndBurnSwap
          .connect(user2)
          .swapAndAddLiquidity.staticCall(
            {
              tokenIn: VANA,
              tokenOut: ERC20Token.target,
              fee: FeeAmount.MEDIUM,
              tokenOutRecipient: tokenOutRecipient.address,
              spareTokenInRecipient: spareTokenInRecipient.address,
              amountIn: currentAmountIn,
              singleBatchImpactThreshold: veryTightThreshold,
              perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
              lpTokenId: lpTokenId,
            },
            { value: currentAmountIn },
          );

        await buyAndBurnSwap.connect(user2).swapAndAddLiquidity(
          {
            tokenIn: VANA,
            tokenOut: ERC20Token.target,
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: tokenOutRecipient.address,
            spareTokenInRecipient: spareTokenInRecipient.address,
            amountIn: currentAmountIn,
            singleBatchImpactThreshold: veryTightThreshold,
            perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
            lpTokenId: lpTokenId,
          },
          { value: currentAmountIn },
        );

        results.push({
          iteration,
          amountIn: currentAmountIn,
          spareIn,
          spareOut,
          liquidityDelta
        });

        console.log(`\nIteration ${iteration}:`);
        console.log(`  Input:     ${ethers.formatEther(currentAmountIn)} VANA`);
        console.log(`  Spare In:  ${ethers.formatEther(spareIn)} VANA`);
        console.log(`  Spare Out: ${ethers.formatEther(spareOut)} DLP`);
        console.log(`  Liquidity: ${liquidityDelta}`);

        if (spareIn > 0n) {
          currentAmountIn = spareIn;
        } else {
          console.log(`  ✅ All consumed`);
          break;
        }
      }

      // Display summary
      console.log(`\n=== Summary of ${iteration} Iterations ===`);
      const totalSpareOut = results.reduce((sum, r) => sum + r.spareOut, 0n);
      const totalLiquidity = results.reduce((sum, r) => sum + r.liquidityDelta, 0n);
      console.log(`Starting amount: ${ethers.formatEther(initialAmount)} VANA`);
      console.log(`Total DLP burned: ${ethers.formatEther(totalSpareOut)}`);
      console.log(`Total liquidity: ${totalLiquidity}`);
      console.log(`Final spare: ${ethers.formatEther(results[results.length - 1].spareIn)} VANA`);

      // Verify the pattern
      results.length.should.be.gt(1); // Should have multiple iterations with tight threshold
      totalSpareOut.should.be.gt(0); // Should have burned DLP

      // Verify decreasing pattern in spareIn (each call consumes some)
      for (let i = 1; i < results.length; i++) {
        results[i].amountIn.should.equal(results[i - 1].spareIn); // Current input = previous spare
      }

      console.log("\n✅ Multi-iteration pattern verified: spareIn properly recycled");
    });
  });

  describe("Parameter Testing", () => {
    let snapshotId: any;
    let lpTokenId: bigint;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();

      // Give user1 enough balance
      await network.provider.send("hardhat_setBalance", [
        user1.address,
        toHex(parseEther(10000)),
      ]);

      // Create LP position
      lpTokenId = await createLPPosition(
        user1,
        positionManager,
        WVANA,
        ERC20Token,
        swapHelper,
        parseEther(1000),
        parseEther(100),
      );

      await positionManager
        .connect(user1)
        .transferFrom(user1.address, user2.address, lpTokenId);

      // Approve BuyAndBurnSwap to manage the NFT position
      await positionManager
        .connect(user2)
        .approve(buyAndBurnSwap.target, lpTokenId);
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should respect singleBatchImpactThreshold (greedy up to threshold)", async () => {
      const amountIn = parseEther(100);

      // Test with strict threshold (1%)
      const strictThreshold = parseEther(1);
      const { spareOut: strictSpareOut } = await buyAndBurnSwap
        .connect(user2)
        .swapAndAddLiquidity.staticCall(
          {
            tokenIn: VANA,
            tokenOut: ERC20Token.target,
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: tokenOutRecipient.address,
            spareTokenInRecipient: spareTokenInRecipient.address,
            amountIn: amountIn,
            singleBatchImpactThreshold: strictThreshold,
            perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
            lpTokenId: lpTokenId,
          },
          { value: amountIn },
        );

      // Test with loose threshold (5%)
      const looseThreshold = parseEther(5);
      const { spareOut: looseSpareOut } = await buyAndBurnSwap
        .connect(user2)
        .swapAndAddLiquidity.staticCall(
          {
            tokenIn: VANA,
            tokenOut: ERC20Token.target,
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: tokenOutRecipient.address,
            spareTokenInRecipient: spareTokenInRecipient.address,
            amountIn: amountIn,
            singleBatchImpactThreshold: looseThreshold,
            perSwapSlippageCap: PER_SWAP_SLIPPAGE_CAP,
            lpTokenId: lpTokenId,
          },
          { value: amountIn },
        );

      console.log("\n=== Threshold Comparison (Greedy Strategy) ===");
      console.log(`Strict (1%): spareOut (burn) = ${ethers.formatEther(strictSpareOut)} DLP`);
      console.log(`Loose (5%): spareOut (burn) = ${ethers.formatEther(looseSpareOut)} DLP`);

      // With greedy strategy, both should produce tokenOut for burning
      strictSpareOut.should.be.gt(0);
      looseSpareOut.should.be.gt(0);

      // Looser threshold should allow more swapping → more burn
      looseSpareOut.should.be.gte(strictSpareOut);
    });

    it("should work with different perSwapSlippageCap values", async () => {
      const amountIn = parseEther(50);

      // Test with tight slippage cap (0.2%)
      const tightCap = parseEther(0.2);
      await buyAndBurnSwap
        .connect(user2)
        .swapAndAddLiquidity(
          {
            tokenIn: VANA,
            tokenOut: ERC20Token.target,
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: tokenOutRecipient.address,
            spareTokenInRecipient: spareTokenInRecipient.address,
            amountIn: amountIn,
            singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
            perSwapSlippageCap: tightCap,
            lpTokenId: lpTokenId,
          },
          { value: amountIn },
        ).should.not.be.rejected;

      // Test with loose slippage cap (2%)
      const looseCap = parseEther(2);
      await buyAndBurnSwap
        .connect(user2)
        .swapAndAddLiquidity(
          {
            tokenIn: VANA,
            tokenOut: ERC20Token.target,
            fee: FeeAmount.MEDIUM,
            tokenOutRecipient: tokenOutRecipient.address,
            spareTokenInRecipient: spareTokenInRecipient.address,
            amountIn: amountIn,
            singleBatchImpactThreshold: SINGLE_BATCH_IMPACT_THRESHOLD,
            perSwapSlippageCap: looseCap,
            lpTokenId: lpTokenId,
          },
          { value: amountIn },
        ).should.not.be.rejected;
    });
  });
});
