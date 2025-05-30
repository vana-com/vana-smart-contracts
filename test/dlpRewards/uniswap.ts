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
  DLPRewardSwapTestHelper,
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

describe("UniswapV3", () => {
  const VANA = ethers.ZeroAddress;

  const NUM_RUNS = 500;
  const RUN_FACTOR = 50;

  const SLIPPAGE_TOLERANCE = parseEther(2); // 2%

  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;
  let foundation: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let dlp: HardhatEthersSigner;

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
  let dlpRewardSwap: DLPRewardSwapTestHelper;

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
    [deployer, owner, user1, user2, user3, foundation, treasury, dlp] =
      await ethers.getSigners();

    // chainId = parseInt(await ethers.provider.send("eth_chainId", []), 16);
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

      // Mainnet
      routerAddress = "0xeb40cbe65764202E28BcdB1e318adFdF8b2f2A3b";
      quoterV2Address = "0x1b13728ea3C90863990aC0e05987CfeC1888908c";
      positionManagerAddress = "0x45a2992e1bFdCF9b9AcE0a84A238f2E56F481816";
      tickLensAddress = "0x5874CB63Fbd1F1A3d1DfCbB451dc35a49Ec63D30";
      factoryAddress = "0xc2a0d530e57B1275fbce908031DA636f95EA1E38";
      WVANAAddress = "0x00EDdD9621Fb08436d0331c149D1690909a5906d";
      // TokenAddress = "0x2f6f07cdcf3588944bf4c42ac74ff24bf56e7590"; // WETH
      // poolAddress = "0xe21b165bCD93251B71Db4a55e4e8f234B3391d74";
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

    // console.log("poolAddress:", pool.target);
    PoolToken0 = await pool.token0();
    PoolToken1 = await pool.token1();

    factory = await ethers.getContractAt(Factory.abi, factoryAddress);
    (
      await factory.getPool(WVANAAddress, TokenAddress, FeeAmount.MEDIUM)
    ).should.equal(poolAddress);

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

    const dlpRewardSwapDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DLPRewardSwapTestHelper"),
      [owner.address, swapHelper.target, positionManager.target],
      {
        kind: "uups",
      },
    );

    dlpRewardSwap = await ethers.getContractAt(
      "DLPRewardSwapTestHelper",
      dlpRewardSwapDeploy.target,
    );
  };

  describe("SwapHelper", () => {
    let snapshotId: any;

    beforeEach(async () => {
      snapshotId = await network.provider.send("evm_snapshot");
      await deploy();
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should be set up correctly", async () => {
      (await dataDexRouter.WETH9()).should.equal(WVANAAddress);
      (await swapHelper.uniswapV3Router()).should.equal(dataDexRouter.target);
    });

    it("should quoteExactInputSingle", async () => {
      const amountIn = parseEther("100");

      (
        await swapHelper.getPool(WVANAAddress, ERC20Token, FeeAmount.MEDIUM)
      ).should.equal(poolAddress);

      const liquidity = await pool.liquidity();
      const sqrtPriceX96 = await pool
        .slot0()
        .then((slot: any) => slot.sqrtPriceX96);

      // Pool: https://info.datadex.com/#/vana/pools/0xe21b165bcd93251b71db4a55e4e8f234b3391d74
      const {
        amountOut: quote1,
        sqrtPriceX96After,
        initializedTicksCrossed,
        gasEstimate,
      } = await dataDexQuoterV2.quoteExactInputSingle.staticCall({
        tokenIn: WVANAAddress,
        tokenOut: ERC20Token,
        fee: FeeAmount.MEDIUM,
        amountIn: amountIn,
        sqrtPriceLimitX96: 0,
      });

      const quote2 = await swapHelper.quoteExactInputSingle.staticCall({
        tokenIn: VANA,
        tokenOut: ERC20Token,
        fee: FeeAmount.MEDIUM,
        amountIn: amountIn,
      });
      quote2.should.equal(quote1);
    });

    it("should exactInputSingle without initializedTicksCrossed", async () => {
      const amountIn = parseEther("1");

      const {
        amountOut: quote,
        sqrtPriceX96After: quoteSqrtPriceX96After,
        initializedTicksCrossed,
        gasEstimate,
      } = await dataDexQuoterV2.quoteExactInputSingle.staticCall({
        tokenIn: WVANAAddress,
        tokenOut: ERC20Token,
        fee: FeeAmount.MEDIUM,
        amountIn: amountIn,
        sqrtPriceLimitX96: 0,
      });

      const slot0: SwapHelperImplementation.Slot0Struct = {
        sqrtPriceX96: 0,
        tick: 0,
        liquidity: 0,
      };

      const zeroForOne =
        WVANAAddress.toLowerCase() < ERC20Token.target.toLowerCase();
      const simulateResult = await swapHelper.simulateSwap.staticCall(
        poolAddress,
        zeroForOne,
        amountIn,
        0, // no limit
        slot0, // get slot0 from pool
      );
      simulateResult.amountToPay.should.equal(amountIn);
      simulateResult.amountReceived.should.equal(quote);
      simulateResult.sqrtPriceX96After.should.be.eq(quoteSqrtPriceX96After);

      const balanceBefore = await ethers.provider.getBalance(user1.address);
      const wethBalanceBefore = await ERC20Token.balanceOf(user1.address);

      const slot0Before = await pool.slot0();
      const sqrtPriceX96Before = slot0Before.sqrtPriceX96;
      const tickBefore = slot0Before.tick;

      tickBefore.should.be.eq(
        TickMath.getTickAtSqrtRatio(JSBI.BigInt(sqrtPriceX96Before.toString())),
      );

      const tx = await swapHelper.connect(user1).exactInputSingle(
        {
          tokenIn: VANA,
          tokenOut: ERC20Token.target,
          fee: FeeAmount.MEDIUM,
          recipient: user1.address,
          amountIn: amountIn,
          amountOutMinimum: 0,
        },
        { value: amountIn },
      );

      const slot0After = await pool.slot0();
      const tickAfter = slot0After.tick;
      const sqrtPriceX96After = slot0After.sqrtPriceX96;
      sqrtPriceX96After.should.be.eq(quoteSqrtPriceX96After);

      tickAfter.should.be.eq(
        TickMath.getTickAtSqrtRatio(JSBI.BigInt(sqrtPriceX96After.toString())),
      );

      const receipt = await getReceipt(tx);
      const balanceAfter = await ethers.provider.getBalance(user1.address);
      const wethBalanceAfter = await ERC20Token.balanceOf(user1.address);

      balanceAfter.should.be.eq(balanceBefore - amountIn - receipt.fee);
      wethBalanceAfter.should.be.eq(wethBalanceBefore + quote);

      initializedTicksCrossed.should.be.eq(0);
    });

    it("should exactInputSingle with initializedTicksCrossed", async () => {
      const amountIn = parseEther(1_000);

      let quote = await dataDexQuoterV2.quoteExactInputSingle.staticCall({
        tokenIn: WVANAAddress,
        tokenOut: ERC20Token,
        fee: FeeAmount.MEDIUM,
        amountIn: amountIn,
        sqrtPriceLimitX96: 0,
      });
      // quote.initializedTicksCrossed.should.be.eq(1);

      const slot0: SwapHelperImplementation.Slot0Struct = {
        sqrtPriceX96: 0,
        tick: 0,
        liquidity: 0,
      };

      const zeroForOne =
        WVANAAddress.toLowerCase() < ERC20Token.target.toLowerCase();
      let simulateResult = await swapHelper.simulateSwap.staticCall(
        poolAddress,
        zeroForOne,
        amountIn,
        0,
        slot0,
      );
      simulateResult.amountToPay.should.equal(amountIn);
      simulateResult.amountReceived.should.equal(quote.amountOut);
      simulateResult.sqrtPriceX96After.should.be.eq(quote.sqrtPriceX96After);

      const balanceBefore = await ethers.provider.getBalance(user1.address);
      const wethBalanceBefore = await ERC20Token.balanceOf(user1.address);

      const slot0Before = await pool.slot0();
      const sqrtPriceX96Before = slot0Before.sqrtPriceX96;
      const tickBefore = slot0Before.tick;

      tickBefore.should.be.eq(
        TickMath.getTickAtSqrtRatio(JSBI.BigInt(sqrtPriceX96Before.toString())),
      );

      const tx = await swapHelper.connect(user1).exactInputSingle(
        {
          tokenIn: VANA,
          tokenOut: ERC20Token,
          fee: FeeAmount.MEDIUM,
          recipient: user1.address,
          amountIn: amountIn,
          amountOutMinimum: 0,
        },
        { value: amountIn },
      );

      const slot0After = await pool.slot0();
      const tickAfter = slot0After.tick;
      const sqrtPriceX96After = slot0After.sqrtPriceX96;
      sqrtPriceX96After.should.be.eq(quote.sqrtPriceX96After);

      tickAfter.should.be.eq(
        TickMath.getTickAtSqrtRatio(JSBI.BigInt(sqrtPriceX96After.toString())),
      );

      const receipt = await getReceipt(tx);
      const balanceAfter = await ethers.provider.getBalance(user1.address);
      const wethBalanceAfter = await ERC20Token.balanceOf(user1.address);

      balanceAfter.should.be.eq(balanceBefore - amountIn - receipt.fee);
      wethBalanceAfter.should.be.eq(wethBalanceBefore + quote.amountOut);

      quote = await dataDexQuoterV2.quoteExactInputSingle.staticCall({
        tokenIn: ERC20Token,
        tokenOut: WVANAAddress,
        fee: FeeAmount.MEDIUM,
        amountIn: wethBalanceAfter,
        sqrtPriceLimitX96: 0,
      });

      simulateResult = await swapHelper.simulateSwap.staticCall(
        poolAddress,
        !zeroForOne,
        wethBalanceAfter,
        0,
        slot0,
      );

      simulateResult.amountReceived.should.equal(quote.amountOut);
      simulateResult.amountToPay.should.equal(wethBalanceAfter);
      simulateResult.sqrtPriceX96After.should.be.eq(quote.sqrtPriceX96After);
    });

    it("should simulateSwap when zeroForOne, exactIn", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10_000 }),
          async (amount) => {
            const snapshotId = await network.provider.send("evm_snapshot");

            try {
              const amountIn = parseEther(amount);

              let quote =
                await dataDexQuoterV2.quoteExactInputSingle.staticCall({
                  tokenIn: PoolToken0,
                  tokenOut: PoolToken1,
                  fee: FeeAmount.MEDIUM,
                  amountIn: amountIn,
                  sqrtPriceLimitX96: 0,
                });

              const slot0: SwapHelperImplementation.Slot0Struct = {
                sqrtPriceX96: 0,
                tick: 0,
                liquidity: 0,
              };

              const simulateResult = await swapHelper.simulateSwap.staticCall(
                poolAddress,
                true,
                amountIn,
                0,
                slot0,
              );
              simulateResult.amountToPay.should.equal(amountIn);
              simulateResult.amountReceived.should.equal(quote.amountOut);
              simulateResult.sqrtPriceX96After.should.be.eq(
                quote.sqrtPriceX96After,
              );
            } catch (err) {
              console.error("❌ Failed with input:", amount, err);
              throw err;
            } finally {
              await network.provider.send("evm_revert", [snapshotId]);
            }
          },
        ),
        {
          numRuns: NUM_RUNS,
          verbose: true,
        },
      );
    });

    it("should simulateSwap when zeroForOne, exactIn, with SLIPPAGE_TOLERANCE", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10_000 }),
          async (amount) => {
            const snapshotId = await network.provider.send("evm_snapshot");

            try {
              const amountIn = parseEther(amount);

              const sqrtPriceLimitX96 = await getSqrtPriceLimitX96(
                pool,
                true,
                SLIPPAGE_TOLERANCE,
              );

              sqrtPriceLimitX96.should.be.gt(0);

              const slot0Before = await pool.slot0();
              const sqrtPriceX96Before = slot0Before.sqrtPriceX96;

              let quote =
                await dataDexQuoterV2.quoteExactInputSingle.staticCall({
                  tokenIn: PoolToken0,
                  tokenOut: PoolToken1,
                  fee: FeeAmount.MEDIUM,
                  amountIn: amountIn,
                  sqrtPriceLimitX96: sqrtPriceLimitX96,
                });

              let quoteSlippage =
                await swapHelper.quoteSlippageExactInputSingle.staticCall({
                  tokenIn: PoolToken0,
                  tokenOut: PoolToken1,
                  fee: FeeAmount.MEDIUM,
                  amountIn: amountIn,
                  sqrtPriceX96: sqrtPriceX96Before,
                  liquidity: 0,
                  maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
                });
              quoteSlippage.amountReceived.should.equal(quote.amountOut);

              const slot0: SwapHelperImplementation.Slot0Struct = {
                sqrtPriceX96: 0,
                tick: 0,
                liquidity: 0,
              };

              let simulateResult = await swapHelper.simulateSwap.staticCall(
                poolAddress,
                true,
                amountIn,
                sqrtPriceLimitX96,
                slot0,
              );
              simulateResult.amountToPay.should.lte(amountIn);
              simulateResult.amountToPay.should.equal(
                quoteSlippage.amountToPay,
              );
              simulateResult.amountReceived.should.equal(quote.amountOut);
              simulateResult.sqrtPriceX96After.should.be.eq(
                quote.sqrtPriceX96After,
              );
              simulateResult.sqrtPriceLimitX96.should.be.eq(sqrtPriceLimitX96);
              simulateResult.sqrtPriceX96After.should.be.gte(sqrtPriceLimitX96);

              if (simulateResult.amountToPay < amountIn) {
                simulateResult.sqrtPriceX96After.should.be.eq(
                  sqrtPriceLimitX96,
                );

                const maxAmountToPay = simulateResult.amountToPay;

                quote = await dataDexQuoterV2.quoteExactInputSingle.staticCall({
                  tokenIn: PoolToken0,
                  tokenOut: PoolToken1,
                  fee: FeeAmount.MEDIUM,
                  amountIn: maxAmountToPay + 1n,
                  sqrtPriceLimitX96: sqrtPriceLimitX96,
                });

                quoteSlippage =
                  await swapHelper.quoteSlippageExactInputSingle.staticCall({
                    tokenIn: PoolToken0,
                    tokenOut: PoolToken1,
                    fee: FeeAmount.MEDIUM,
                    amountIn: maxAmountToPay + 1n,
                    sqrtPriceX96: sqrtPriceX96Before,
                    liquidity: 0,
                    maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
                  });
                quoteSlippage.amountReceived.should.equal(quote.amountOut);

                // When sqrtPriceLimitX96 is reached, the amountToPay should be equal to maxAmountToPay
                simulateResult = await swapHelper.simulateSwap.staticCall(
                  poolAddress,
                  true,
                  maxAmountToPay + 1n,
                  sqrtPriceLimitX96,
                  slot0,
                );
                simulateResult.amountToPay.should.eq(maxAmountToPay);
                simulateResult.amountToPay.should.equal(
                  quoteSlippage.amountToPay,
                );
                simulateResult.amountReceived.should.eq(quote.amountOut);
                simulateResult.sqrtPriceX96After.should.be.eq(
                  quote.sqrtPriceX96After,
                );
                simulateResult.sqrtPriceX96After.should.be.eq(
                  sqrtPriceLimitX96,
                );
              }

              const slippageTolerance =
                Number(SLIPPAGE_TOLERANCE) / Number(ONE_HUNDRED_PERCENT);
              const priceBefore = sqrtPriceX96ToPrice(sqrtPriceX96Before);
              const priceLimit = sqrtPriceX96ToPrice(sqrtPriceLimitX96);
              priceBefore.should.be.gt(0);
              priceLimit.should.be.gt(0);
              const priceLimitDiff =
                Math.abs(priceBefore - priceLimit) / priceBefore;
              // priceLimitDiff.should.be.lte(slippageTolerance);
              if (priceLimitDiff > slippageTolerance) {
                Math.abs(priceLimitDiff - slippageTolerance).should.be.lte(
                  0.05,
                );
              }
              const priceAfter = sqrtPriceX96ToPrice(
                simulateResult.sqrtPriceX96After,
              );
              const priceDiff =
                Math.abs(priceAfter - priceBefore) / priceBefore;
              // priceDiff.should.be.lte(slippageTolerance);
              if (priceDiff > slippageTolerance) {
                Math.abs(priceDiff - slippageTolerance).should.be.lte(0.05);
              }
            } catch (err) {
              console.error("❌ Failed with input:", amount, err);
              throw err;
            } finally {
              await network.provider.send("evm_revert", [snapshotId]);
            }
          },
        ),
        {
          numRuns: NUM_RUNS,
          verbose: true,
        },
      );
    });

    it("should simulateSwap when oneForZero, exactIn", async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 10000 }), async (amount) => {
          const snapshotId = await network.provider.send("evm_snapshot");

          try {
            const amountIn = parseEther(amount);

            let quote = await dataDexQuoterV2.quoteExactInputSingle.staticCall({
              tokenIn: PoolToken1,
              tokenOut: PoolToken0,
              fee: FeeAmount.MEDIUM,
              amountIn: amountIn,
              sqrtPriceLimitX96: 0,
            });

            const slot0: SwapHelperImplementation.Slot0Struct = {
              sqrtPriceX96: 0,
              tick: 0,
              liquidity: 0,
            };

            const simulateResult = await swapHelper.simulateSwap.staticCall(
              poolAddress,
              false,
              amountIn,
              0,
              slot0,
            );
            simulateResult.amountToPay.should.equal(amountIn);
            simulateResult.amountReceived.should.equal(quote.amountOut);
            simulateResult.sqrtPriceX96After.should.be.eq(
              quote.sqrtPriceX96After,
            );
          } catch (err) {
            console.error("❌ Failed with input:", amount, err);
            throw err;
          } finally {
            await network.provider.send("evm_revert", [snapshotId]);
          }
        }),
        {
          numRuns: NUM_RUNS,
          verbose: true,
        },
      );
    });

    it("should simulateSwap when oneForZero, exactIn, with SLIPPAGE_TOLERANCE", async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 10000 }), async (amount) => {
          const snapshotId = await network.provider.send("evm_snapshot");

          try {
            const amountIn = parseEther(amount);

            const sqrtPriceLimitX96 = await getSqrtPriceLimitX96(
              pool,
              false,
              SLIPPAGE_TOLERANCE,
            );

            sqrtPriceLimitX96.should.be.gt(0);

            const slot0Before = await pool.slot0();
            const sqrtPriceX96Before = slot0Before.sqrtPriceX96;

            let quote = await dataDexQuoterV2.quoteExactInputSingle.staticCall({
              tokenIn: PoolToken1,
              tokenOut: PoolToken0,
              fee: FeeAmount.MEDIUM,
              amountIn: amountIn,
              sqrtPriceLimitX96: sqrtPriceLimitX96,
            });

            let quoteSlippage =
              await swapHelper.quoteSlippageExactInputSingle.staticCall({
                tokenIn: PoolToken1,
                tokenOut: PoolToken0,
                fee: FeeAmount.MEDIUM,
                amountIn: amountIn,
                sqrtPriceX96: sqrtPriceX96Before,
                liquidity: 0,
                maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
              });
            quoteSlippage.amountReceived.should.equal(quote.amountOut);

            const slot0: SwapHelperImplementation.Slot0Struct = {
              sqrtPriceX96: 0,
              tick: 0,
              liquidity: 0,
            };

            let simulateResult = await swapHelper.simulateSwap.staticCall(
              poolAddress,
              false,
              amountIn,
              sqrtPriceLimitX96,
              slot0,
            );
            simulateResult.amountToPay.should.lte(amountIn);
            simulateResult.amountToPay.should.equal(quoteSlippage.amountToPay);
            simulateResult.amountReceived.should.eq(quote.amountOut);
            simulateResult.sqrtPriceX96After.should.be.eq(
              quote.sqrtPriceX96After,
            );
            simulateResult.sqrtPriceX96After.should.be.lte(sqrtPriceLimitX96);
            simulateResult.sqrtPriceLimitX96.should.be.eq(sqrtPriceLimitX96);

            if (simulateResult.amountToPay < amountIn) {
              simulateResult.sqrtPriceX96After.should.be.eq(sqrtPriceLimitX96);

              const maxAmountToPay = simulateResult.amountToPay;

              quote = await dataDexQuoterV2.quoteExactInputSingle.staticCall({
                tokenIn: PoolToken1,
                tokenOut: PoolToken0,
                fee: FeeAmount.MEDIUM,
                amountIn: maxAmountToPay + 1n,
                sqrtPriceLimitX96: sqrtPriceLimitX96,
              });

              quoteSlippage =
                await swapHelper.quoteSlippageExactInputSingle.staticCall({
                  tokenIn: PoolToken1,
                  tokenOut: PoolToken0,
                  fee: FeeAmount.MEDIUM,
                  amountIn: maxAmountToPay + 1n,
                  sqrtPriceX96: sqrtPriceX96Before,
                  liquidity: 0,
                  maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
                });
              quoteSlippage.amountReceived.should.equal(quote.amountOut);

              // When sqrtPriceLimitX96 is reached, the amountToPay should be equal to maxAmountToPay
              simulateResult = await swapHelper.simulateSwap.staticCall(
                poolAddress,
                false,
                maxAmountToPay + 1n,
                sqrtPriceLimitX96,
                slot0,
              );
              simulateResult.amountToPay.should.eq(maxAmountToPay);
              simulateResult.amountToPay.should.equal(
                quoteSlippage.amountToPay,
              );
              simulateResult.amountReceived.should.eq(quote.amountOut);
              simulateResult.sqrtPriceX96After.should.be.eq(
                quote.sqrtPriceX96After,
              );
              simulateResult.sqrtPriceX96After.should.be.eq(sqrtPriceLimitX96);
            }

            const slippageTolerance =
              Number(SLIPPAGE_TOLERANCE) / Number(ONE_HUNDRED_PERCENT);
            const priceBefore = sqrtPriceX96ToPrice(sqrtPriceX96Before);
            const priceLimit = sqrtPriceX96ToPrice(sqrtPriceLimitX96);
            priceBefore.should.be.gt(0);
            priceLimit.should.be.gt(0);
            const priceLimitDiff =
              Math.abs(priceBefore - priceLimit) / priceBefore;
            // priceLimitDiff.should.be.lte(slippageTolerance);
            Math.abs(priceLimitDiff - slippageTolerance).should.be.lte(0.05);
            const priceAfter = sqrtPriceX96ToPrice(
              simulateResult.sqrtPriceX96After,
            );
            const priceDiff = Math.abs(priceAfter - priceBefore) / priceBefore;
            // priceDiff.should.be.lte(slippageTolerance);
            Math.abs(priceDiff - slippageTolerance).should.be.lte(0.05);
          } catch (err) {
            console.error("❌ Failed with input:", amount, err);
            throw err;
          } finally {
            await network.provider.send("evm_revert", [snapshotId]);
          }
        }),
        {
          numRuns: NUM_RUNS,
          verbose: true,
        },
      );
    });

    it("should simulateSwap when oneForZero, exactOut", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10_000 }),
          async (amount) => {
            const snapshotId = await network.provider.send("evm_snapshot");

            try {
              const amountIn = parseEther(amount);

              let quote =
                await dataDexQuoterV2.quoteExactInputSingle.staticCall({
                  tokenIn: PoolToken1,
                  tokenOut: PoolToken0,
                  fee: FeeAmount.MEDIUM,
                  amountIn: amountIn,
                  sqrtPriceLimitX96: 0,
                });

              const amountOut = quote.amountOut;

              quote = await dataDexQuoterV2.quoteExactOutputSingle.staticCall({
                tokenIn: PoolToken1,
                tokenOut: PoolToken0,
                fee: FeeAmount.MEDIUM,
                amount: amountOut,
                sqrtPriceLimitX96: 0,
              });

              const slot0: SwapHelperImplementation.Slot0Struct = {
                sqrtPriceX96: 0,
                tick: 0,
                liquidity: 0,
              };

              let simulateResult = await swapHelper.simulateSwap.staticCall(
                poolAddress,
                false,
                -amountOut,
                0,
                slot0,
              );

              simulateResult.amountToPay.should.equal(quote.amountIn);
              simulateResult.amountReceived.should.equal(amountOut);
              simulateResult.sqrtPriceX96After.should.be.eq(
                quote.sqrtPriceX96After,
              );
            } catch (err) {
              console.error("❌ Failed with input:", amount, err);
              throw err;
            } finally {
              await network.provider.send("evm_revert", [snapshotId]);
            }
          },
        ),
        {
          numRuns: NUM_RUNS,
          verbose: true,
        },
      );
    });

    it("should simulateSwap when oneForZero, exactOut, with SLIPPAGE_TOLERANCE", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10_000 }),
          async (amount) => {
            const snapshotId = await network.provider.send("evm_snapshot");

            try {
              const amountIn = parseEther(amount);

              let quote =
                await dataDexQuoterV2.quoteExactInputSingle.staticCall({
                  tokenIn: PoolToken1,
                  tokenOut: PoolToken0,
                  fee: FeeAmount.MEDIUM,
                  amountIn: amountIn,
                  sqrtPriceLimitX96: 0,
                });

              const amountOut = quote.amountOut;

              const sqrtPriceLimitX96 = await getSqrtPriceLimitX96(
                pool,
                false,
                SLIPPAGE_TOLERANCE,
              );

              sqrtPriceLimitX96.should.be.gt(0);

              const slot0Before = await pool.slot0();
              const sqrtPriceX96Before = slot0Before.sqrtPriceX96;

              quote = await dataDexQuoterV2.quoteExactOutputSingle.staticCall({
                tokenIn: PoolToken1,
                tokenOut: PoolToken0,
                fee: FeeAmount.MEDIUM,
                amount: amountOut,
                sqrtPriceLimitX96: sqrtPriceLimitX96,
              });

              const slot0: SwapHelperImplementation.Slot0Struct = {
                sqrtPriceX96: 0,
                tick: 0,
                liquidity: 0,
              };

              let simulateResult = await swapHelper.simulateSwap.staticCall(
                poolAddress,
                false,
                -amountOut,
                sqrtPriceLimitX96,
                slot0,
              );

              simulateResult.amountToPay.should.eq(quote.amountIn);
              simulateResult.amountReceived.should.lte(amountOut);
              simulateResult.sqrtPriceX96After.should.be.eq(
                quote.sqrtPriceX96After,
              );

              simulateResult.sqrtPriceX96After.should.be.lte(sqrtPriceLimitX96);
              simulateResult.sqrtPriceLimitX96.should.be.eq(sqrtPriceLimitX96);
              if (simulateResult.amountToPay < quote.amountIn) {
                simulateResult.sqrtPriceX96After.should.be.eq(
                  sqrtPriceLimitX96,
                );
              }

              const slippageTolerance =
                Number(SLIPPAGE_TOLERANCE) / Number(ONE_HUNDRED_PERCENT);
              const priceBefore = sqrtPriceX96ToPrice(sqrtPriceX96Before);
              const priceLimit = sqrtPriceX96ToPrice(sqrtPriceLimitX96);
              priceBefore.should.be.gt(0);
              priceLimit.should.be.gt(0);
              const priceLimitDiff =
                Math.abs(priceBefore - priceLimit) / priceBefore;
              // priceLimitDiff.should.be.lte(slippageTolerance);
              Math.abs(priceLimitDiff - slippageTolerance).should.be.lte(0.05);
              const priceAfter = sqrtPriceX96ToPrice(
                simulateResult.sqrtPriceX96After,
              );
              const priceDiff =
                Math.abs(priceAfter - priceBefore) / priceBefore;
              // priceDiff.should.be.lte(slippageTolerance);
              Math.abs(priceDiff - slippageTolerance).should.be.lte(0.05);
            } catch (err) {
              console.error("❌ Failed with input:", amount, err);
              throw err;
            } finally {
              await network.provider.send("evm_revert", [snapshotId]);
            }
          },
        ),
        {
          numRuns: NUM_RUNS,
          verbose: true,
        },
      );
    });

    it("should simulateSwap when zeroForOne, exactOut", async () => {
      const poolToken1Reserve = await pool
        .token1()
        .then((token1: any) => {
          return ethers.getContractAt(ERC20.abi, token1);
        })
        .then((token1: any) => {
          return token1.balanceOf(poolAddress);
        });

      const poolLiquidity = await pool.liquidity();
      poolLiquidity.should.be.gt(0);
      poolToken1Reserve.should.be.gt(0);

      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10_000 }),
          async (amount) => {
            const snapshotId = await network.provider.send("evm_snapshot");
            try {
              const amountIn = parseEther(amount);

              let quote =
                await dataDexQuoterV2.quoteExactInputSingle.staticCall({
                  tokenIn: PoolToken0,
                  tokenOut: PoolToken1,
                  amountIn: amountIn,
                  fee: FeeAmount.MEDIUM,
                  sqrtPriceLimitX96: 0,
                });

              const amountOut = quote.amountOut;

              quote = await dataDexQuoterV2.quoteExactOutputSingle.staticCall({
                tokenIn: PoolToken0,
                tokenOut: PoolToken1,
                amount: amountOut,
                fee: FeeAmount.MEDIUM,
                sqrtPriceLimitX96: 0,
              });

              const slot0: SwapHelperImplementation.Slot0Struct = {
                sqrtPriceX96: 0,
                tick: 0,
                liquidity: 0,
              };

              const simulateResult = await swapHelper.simulateSwap.staticCall(
                poolAddress,
                true,
                -amountOut,
                0,
                slot0,
              );
              simulateResult.amountToPay.should.equal(quote.amountIn);
              simulateResult.amountReceived.should.equal(amountOut);
              simulateResult.sqrtPriceX96After.should.be.eq(
                quote.sqrtPriceX96After,
              );
            } catch (err) {
              console.error("❌ Failed with input:", amount, err);
              throw err;
            } finally {
              await network.provider.send("evm_revert", [snapshotId]);
            }
          },
        ),
        {
          numRuns: NUM_RUNS,
          verbose: true,
        },
      );
    });

    it("should simulateSwap when zeroForOne, exactOut, with SLIPPAGE_TOLERANCE", async () => {
      const poolToken1Reserve = await pool
        .token1()
        .then((token1: any) => {
          return ethers.getContractAt(ERC20.abi, token1);
        })
        .then((token1: any) => {
          return token1.balanceOf(poolAddress);
        });

      const poolLiquidity = await pool.liquidity();
      poolLiquidity.should.be.gt(0);
      poolToken1Reserve.should.be.gt(0);

      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10_000 }),
          async (amount) => {
            const snapshotId = await network.provider.send("evm_snapshot");
            try {
              const amountIn = parseEther(amount);

              let quote =
                await dataDexQuoterV2.quoteExactInputSingle.staticCall({
                  tokenIn: PoolToken0,
                  tokenOut: PoolToken1,
                  amountIn: amountIn,
                  fee: FeeAmount.MEDIUM,
                  sqrtPriceLimitX96: 0,
                });

              const amountOut = quote.amountOut;

              const sqrtPriceLimitX96 = await getSqrtPriceLimitX96(
                pool,
                true,
                SLIPPAGE_TOLERANCE,
              );

              const slot0Before = await pool.slot0();
              const sqrtPriceX96Before = slot0Before.sqrtPriceX96;

              quote = await dataDexQuoterV2.quoteExactOutputSingle.staticCall({
                tokenIn: PoolToken0,
                tokenOut: PoolToken1,
                amount: amountOut,
                fee: FeeAmount.MEDIUM,
                sqrtPriceLimitX96: sqrtPriceLimitX96,
              });

              const slot0: SwapHelperImplementation.Slot0Struct = {
                sqrtPriceX96: 0,
                tick: 0,
                liquidity: 0,
              };

              const simulateResult = await swapHelper.simulateSwap.staticCall(
                poolAddress,
                true,
                -amountOut,
                sqrtPriceLimitX96,
                slot0,
              );
              simulateResult.amountToPay.should.equal(quote.amountIn);
              simulateResult.amountReceived.should.lte(amountOut);
              simulateResult.sqrtPriceX96After.should.be.eq(
                quote.sqrtPriceX96After,
              );
              simulateResult.sqrtPriceLimitX96.should.be.eq(sqrtPriceLimitX96);
              simulateResult.sqrtPriceX96After.should.be.gte(sqrtPriceLimitX96);

              if (simulateResult.amountToPay < quote.amountIn) {
                simulateResult.sqrtPriceX96After.should.be.eq(
                  sqrtPriceLimitX96,
                );
              }

              const slippageTolerance =
                Number(SLIPPAGE_TOLERANCE) / Number(ONE_HUNDRED_PERCENT);
              const priceBefore = sqrtPriceX96ToPrice(sqrtPriceX96Before);
              const priceLimit = sqrtPriceX96ToPrice(sqrtPriceLimitX96);
              priceBefore.should.be.gt(0);
              priceLimit.should.be.gt(0);
              const priceLimitDiff =
                Math.abs(priceBefore - priceLimit) / priceBefore;
              // priceLimitDiff.should.be.lte(slippageTolerance);
              if (priceLimitDiff > slippageTolerance) {
                Math.abs(priceLimitDiff - slippageTolerance).should.be.lte(
                  0.05,
                );
              }
              const priceAfter = sqrtPriceX96ToPrice(
                simulateResult.sqrtPriceX96After,
              );
              const priceDiff =
                Math.abs(priceAfter - priceBefore) / priceBefore;
              // priceDiff.should.be.lte(slippageTolerance);
              if (priceDiff > slippageTolerance) {
                Math.abs(priceDiff - slippageTolerance).should.be.lte(0.05);
              }
            } catch (err) {
              console.error("❌ Failed with input:", amount, err);
              throw err;
            } finally {
              await network.provider.send("evm_revert", [snapshotId]);
            }
          },
        ),
        {
          numRuns: NUM_RUNS,
          verbose: true,
        },
      );
    });

    it("should slippageExactInputSingle", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10_000 }),
          async (amount) => {
            const snapshotId = await network.provider.send("evm_snapshot");

            try {
              const amountIn = parseEther(amount);

              await network.provider.send("hardhat_setBalance", [
                user1.address,
                toHex(2n * amountIn),
              ]);

              const zeroForOne =
                WVANAAddress.toLowerCase() < ERC20Token.target.toLowerCase();

              const sqrtPriceLimitX96 = await getSqrtPriceLimitX96(
                pool,
                zeroForOne,
                SLIPPAGE_TOLERANCE,
              );

              sqrtPriceLimitX96.should.be.gt(0);

              let quote =
                await dataDexQuoterV2.quoteExactInputSingle.staticCall({
                  tokenIn: WVANAAddress,
                  tokenOut: ERC20Token,
                  fee: FeeAmount.MEDIUM,
                  amountIn: amountIn,
                  sqrtPriceLimitX96: sqrtPriceLimitX96,
                });

              let quoteSlippage =
                await swapHelper.quoteSlippageExactInputSingle.staticCall({
                  tokenIn: VANA,
                  tokenOut: ERC20Token,
                  fee: FeeAmount.MEDIUM,
                  amountIn: amountIn,
                  sqrtPriceX96: 0,
                  liquidity: 0,
                  maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
                });
              quoteSlippage.amountReceived.should.equal(quote.amountOut);

              const slot0: SwapHelperImplementation.Slot0Struct = {
                sqrtPriceX96: 0,
                tick: 0,
                liquidity: 0,
              };

              const simulateResult = await swapHelper.simulateSwap.staticCall(
                poolAddress,
                zeroForOne,
                amountIn,
                sqrtPriceLimitX96,
                slot0,
              );
              simulateResult.amountToPay.should.lte(amountIn);
              simulateResult.amountToPay.should.equal(
                quoteSlippage.amountToPay,
              );
              simulateResult.amountReceived.should.eq(quote.amountOut);
              simulateResult.sqrtPriceX96After.should.be.eq(
                quote.sqrtPriceX96After,
              );
              simulateResult.sqrtPriceLimitX96.should.be.eq(sqrtPriceLimitX96);
              if (zeroForOne)
                simulateResult.sqrtPriceX96After.should.be.gte(
                  sqrtPriceLimitX96,
                );
              else
                simulateResult.sqrtPriceX96After.should.be.lte(
                  sqrtPriceLimitX96,
                );

              if (simulateResult.amountToPay < amountIn) {
                simulateResult.sqrtPriceX96After.should.be.eq(
                  sqrtPriceLimitX96,
                );
              }

              const slot0Before = await pool.slot0();
              const sqrtPriceX96Before = slot0Before.sqrtPriceX96;

              const user1BalanceBefore = await ethers.provider.getBalance(
                user1.address,
              );
              const user2WETHBalanceBefore = await ERC20Token.balanceOf(
                user2.address,
              );

              const tx = await swapHelper
                .connect(user1)
                .slippageExactInputSingle(
                  {
                    tokenIn: VANA,
                    tokenOut: ERC20Token,
                    fee: FeeAmount.MEDIUM,
                    recipient: user2.address,
                    amountIn: amountIn,
                    maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
                  },
                  { value: amountIn },
                );
              const txReceipt = await getReceipt(tx);
              const txFee = txReceipt.fee;

              const slot0After = await pool.slot0();
              slot0After.sqrtPriceX96.should.be.eq(quote.sqrtPriceX96After);

              const slippageTolerance =
                Number(SLIPPAGE_TOLERANCE) / Number(ONE_HUNDRED_PERCENT);
              const priceBefore = sqrtPriceX96ToPrice(sqrtPriceX96Before);
              priceBefore.should.be.gt(0);
              const priceAfter = sqrtPriceX96ToPrice(
                simulateResult.sqrtPriceX96After,
              );
              priceAfter.should.be.gt(0);
              const priceDiff =
                Math.abs(priceAfter - priceBefore) / priceBefore;
              if (priceDiff > slippageTolerance) {
                Math.abs(priceDiff - slippageTolerance).should.be.lte(0.05);
              }

              const user1BalanceAfter = await ethers.provider.getBalance(
                user1.address,
              );
              user1BalanceAfter.should.be.eq(
                user1BalanceBefore - simulateResult.amountToPay - txFee,
              );

              const user2WETHBalanceAfter = await ERC20Token.balanceOf(
                user2.address,
              );
              user2WETHBalanceAfter.should.be.eq(
                user2WETHBalanceBefore + simulateResult.amountReceived,
              );
            } catch (err) {
              console.error("❌ Failed with input:", amount, err);
              throw err;
            } finally {
              await network.provider.send("evm_revert", [snapshotId]);
            }
          },
        ),
        {
          numRuns: NUM_RUNS,
          verbose: true,
        },
      );
    });
  });

  describe("LpSwap", () => {
    let snapshotId: any;

    beforeEach(async function (this: Mocha.Context) {
      const testTitle = this.currentTest?.title ?? "";

      let testChainId = parseInt(
        await ethers.provider.send("eth_chainId", []),
        16,
      );

      if (testTitle.includes("moksha")) {
        testChainId = 14800;
      }

      snapshotId = await network.provider.send("evm_snapshot");
      await deploy(testChainId);
      // console.log("liquidity", (await pool.liquidity()).toString());
    });

    afterEach(async () => {
      await network.provider.send("evm_revert", [snapshotId]);
    });

    it("should quoteLpSwap", async () => {
      const maxSwapQuote =
        await swapHelper.quoteSlippageExactInputSingle.staticCall({
          tokenIn: VANA,
          tokenOut: ERC20Token,
          fee: FeeAmount.MEDIUM,
          amountIn: parseEther(10_000),
          sqrtPriceX96: 0,
          liquidity: 0,
          maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
        });

      const poolLiquidity = await pool.liquidity();

      let counter1 = 0;
      let counter2 = 0;
      const numRuns1 = NUM_RUNS;
      const numRuns2 = NUM_RUNS;

      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 1n, max: 2n * maxSwapQuote.amountToPay }),
          async (amountIn) => {
            const snapshotId = await network.provider.send("evm_snapshot");

            counter1++;

            try {
              const lpQuote = await dlpRewardSwap.callQuoteLpSwap.staticCall({
                tokenIn: VANA,
                tokenOut: ERC20Token,
                fee: FeeAmount.MEDIUM,
                amountIn: amountIn,
                maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
                sqrtRatioLowerX96: BigInt(TickMath.MIN_SQRT_RATIO.toString()),
                sqrtRatioUpperX96: BigInt(TickMath.MAX_SQRT_RATIO.toString()),
              });

              // console.log("amountIn", amountIn, Number(amountIn) / 1e18, "liquidityDelta", lpQuote.liquidityDelta.toString());

              await fc.assert(
                fc.asyncProperty(
                  fc.bigInt({ min: 1n, max: amountIn }),
                  async (amountSwap) => {
                    counter2++;
                    process.stdout.write(
                      `\rquoteLpSwap (${counter1} / ${numRuns1}) ${counter2} / ${numRuns1 * numRuns2}`,
                    );

                    try {
                      const swapQuote =
                        await swapHelper.quoteSlippageExactInputSingle.staticCall(
                          {
                            tokenIn: VANA,
                            tokenOut: ERC20Token,
                            fee: FeeAmount.MEDIUM,
                            amountIn: amountSwap,
                            sqrtPriceX96: 0,
                            liquidity: 0,
                            maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
                          },
                        );
                      const amount0 = amountIn - swapQuote.amountToPay;
                      const amount1 = swapQuote.amountReceived;
                      const liquidity = maxLiquidityForAmounts(
                        JSBI.BigInt(swapQuote.sqrtPriceX96After.toString()),
                        TickMath.MIN_SQRT_RATIO,
                        TickMath.MAX_SQRT_RATIO,
                        JSBI.BigInt(amount0.toString()),
                        JSBI.BigInt(amount1.toString()),
                        false,
                      );
                      // console.log("liquidity        ", liquidity.toString());
                      // console.log("lpQuote.liquidity", lpQuote.liquidity.toString());
                      BigInt(liquidity.toString()).should.be.lte(
                        lpQuote.liquidityDelta,
                      );
                    } catch (err) {
                      console.error("❌ Failed with input:", amountSwap, err);
                      throw err;
                    } finally {
                    }
                  },
                ),
                {
                  numRuns: numRuns2,
                  verbose: true,
                },
              );
            } catch (err) {
              console.error("❌ Failed with input:", amountIn, err);
              throw err;
            } finally {
              await network.provider.send("evm_revert", [snapshotId]);
            }
          },
        ),
        {
          numRuns: numRuns1,
          verbose: true,
        },
      );
    }).timeout(10_800_000); // 3 hours

    it("should lpSwap (fuzzing)", async () => {
      let amountIn = parseEther(1_000);

      const zeroForOne =
        WVANAAddress.toLowerCase() < ERC20Token.target.toLowerCase();

      let quote = await dataDexQuoterV2.quoteExactInputSingle.staticCall({
        tokenIn: WVANAAddress,
        tokenOut: ERC20Token,
        fee: FeeAmount.MEDIUM,
        amountIn: amountIn,
        sqrtPriceLimitX96: 0,
      });

      const balanceBefore = await ethers.provider.getBalance(user1.address);
      const wethBalanceBefore = await ERC20Token.balanceOf(user1.address);

      let tx = await swapHelper.connect(user1).exactInputSingle(
        {
          tokenIn: VANA,
          tokenOut: ERC20Token.target,
          fee: FeeAmount.MEDIUM,
          recipient: user1.address,
          amountIn: amountIn,
          amountOutMinimum: 0,
        },
        { value: amountIn },
      );
      const txReceipt = await getReceipt(tx);
      (await ERC20Token.balanceOf(user1.address)).should.be.eq(
        wethBalanceBefore + quote.amountOut,
      );
      (await ethers.provider.getBalance(user1.address)).should.be.eq(
        balanceBefore - amountIn - txReceipt.fee,
      );

      const amountMintInVANA = amountIn;
      const amountMintInToken = await ERC20Token.balanceOf(user1.address);

      await WVANA.connect(user1).deposit({ value: amountMintInVANA });
      (await WVANA.balanceOf(user1.address)).should.be.eq(amountMintInVANA);

      await WVANA.connect(user1).approve(
        positionManager.target,
        amountMintInVANA,
      );
      await ERC20Token.connect(user1).approve(
        positionManager.target,
        amountMintInToken,
      );

      const slot0 = await pool.slot0();
      const currentLiquidity = await pool.liquidity();

      const tickLower = nearestUsableTick(
        TickMath.MIN_TICK,
        TICK_SPACINGS[FeeAmount.MEDIUM],
      );
      const tickUpper = nearestUsableTick(
        TickMath.MAX_TICK,
        TICK_SPACINGS[FeeAmount.MEDIUM],
      );

      const liquidityDelta = maxLiquidityForAmounts(
        JSBI.BigInt(slot0.sqrtPriceX96.toString()),
        // TickMath.MIN_SQRT_RATIO,
        // TickMath.MAX_SQRT_RATIO,
        TickMath.getSqrtRatioAtTick(tickLower),
        TickMath.getSqrtRatioAtTick(tickUpper),
        JSBI.BigInt(amountMintInVANA.toString()),
        JSBI.BigInt(amountMintInToken.toString()),
        false,
      );
      BigInt(liquidityDelta.toString()).should.be.gt(0);

      let mintAmount0: any;
      let mintAmount1: any;
      {
        const pToken0 = new Token(chainId, WVANA.target, 18, "WVANA", "WVANA");
        const pToken1 = new Token(
          chainId,
          ERC20Token.target,
          Number(await ERC20Token.decimals()),
          await ERC20Token.symbol(),
          await ERC20Token.name(),
        );
        const pPool = new Pool(
          pToken0,
          pToken1,
          FeeAmount.MEDIUM,
          JSBI.BigInt(slot0.sqrtPriceX96.toString()),
          JSBI.BigInt(currentLiquidity.toString()),
          Number(slot0.tick),
        );

        const position = new Position({
          pool: pPool,
          tickLower: tickLower,
          tickUpper: tickUpper,
          liquidity: liquidityDelta,
        });

        mintAmount0 = position.mintAmounts.amount0;
        mintAmount1 = position.mintAmounts.amount1;
      }

      const lpTokenId = 1550;
      await positionManager
        .connect(user1)
        .mint({
          token0: WVANA,
          token1: ERC20Token,
          fee: FeeAmount.MEDIUM,
          tickLower: tickLower,
          tickUpper: tickUpper,
          amount0Desired: amountMintInVANA,
          amount1Desired: amountMintInToken,
          amount0Min: 0,
          amount1Min: 0,
          recipient: user1.address,
          deadline: Math.floor(Date.now() / 1000) + 60 * 10,
        })
        .should.emit(pool, "Mint")
        .withArgs(
          positionManager.target,
          positionManager.target,
          tickLower,
          tickUpper,
          liquidityDelta.toString(),
          mintAmount0.toString(),
          mintAmount1.toString(),
        )
        .also.emit(positionManager, "IncreaseLiquidity")
        .withArgs(
          lpTokenId,
          liquidityDelta.toString(),
          mintAmount0.toString(),
          mintAmount1.toString(),
        );

      let counter = 0;
      const numRuns = RUN_FACTOR * NUM_RUNS;

      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 1n, max: parseEther(1_000_000) }),
          async (amountIn) => {
            const snapshotId = await network.provider.send("evm_snapshot");

            counter++;
            process.stdout.write(`\rlpSwap ${counter} / ${numRuns}`);

            try {
              await network.provider.send("hardhat_setBalance", [
                user1.address,
                toHex(2n * amountIn),
              ]);

              const lpQuote = await dlpRewardSwap.callQuoteLpSwap.staticCall({
                tokenIn: VANA,
                tokenOut: ERC20Token,
                fee: FeeAmount.MEDIUM,
                amountIn: amountIn,
                maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
                // sqrtRatioLowerX96: BigInt(TickMath.getSqrtRatioAtTick(tickLower).toString()),
                // sqrtRatioUpperX96: BigInt(TickMath.getSqrtRatioAtTick(tickUpper).toString()),
                sqrtRatioLowerX96: BigInt(TickMath.MIN_SQRT_RATIO.toString()),
                sqrtRatioUpperX96: BigInt(TickMath.MAX_SQRT_RATIO.toString()),
              });

              // console.log(
              //     "amountIn", amountIn,
              //     "amountSwapIn", lpQuote.amountSwapIn,
              //     "liquidityDelta", lpQuote.liquidityDelta.toString(),
              //     "spareIn", lpQuote.spareIn.toString(),
              //     "spareOut", lpQuote.spareOut.toString());

              if (lpQuote.liquidityDelta > 0) {
                const swapQuote =
                  await swapHelper.quoteSlippageExactInputSingle.staticCall({
                    tokenIn: VANA,
                    tokenOut: ERC20Token,
                    fee: FeeAmount.MEDIUM,
                    amountIn: lpQuote.amountSwapIn,
                    sqrtPriceX96: 0,
                    liquidity: 0,
                    maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
                  });

                const amountLpIn =
                  amountIn - lpQuote.amountSwapIn - lpQuote.spareIn;
                const amountLpOut = swapQuote.amountReceived - lpQuote.spareOut;

                mintAmount0 = zeroForOne ? amountLpIn : amountLpOut;
                mintAmount1 = zeroForOne ? amountLpOut : amountLpIn;

                const liquidityDelta = maxLiquidityForAmounts(
                  JSBI.BigInt(slot0.sqrtPriceX96.toString()),
                  TickMath.getSqrtRatioAtTick(tickLower),
                  TickMath.getSqrtRatioAtTick(tickUpper),
                  JSBI.BigInt(mintAmount0.toString()),
                  JSBI.BigInt(mintAmount1.toString()),
                  false,
                );
                BigInt(liquidityDelta.toString()).should.be.lte(
                  lpQuote.liquidityDelta,
                );

                const tx = await dlpRewardSwap.connect(user1).callLpSwap(
                  {
                    amountIn: amountIn,
                    tokenIn: VANA,
                    tokenOut: ERC20Token,
                    fee: FeeAmount.MEDIUM,
                    maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
                    lpTokenId: lpTokenId,
                  },
                  { value: amountIn },
                );

                tx.should
                  .emit(positionManager, "IncreaseLiquidity")
                  .withArgs(
                    lpTokenId,
                    lpQuote.liquidityDelta.toString(),
                    mintAmount0.toString(),
                    mintAmount1.toString(),
                  );

                tx.should
                  .emit(pool, "Mint")
                  .withArgs(
                    positionManager.target,
                    positionManager.target,
                    tickLower,
                    tickUpper,
                    lpQuote.liquidityDelta.toString(),
                    mintAmount0.toString(),
                    mintAmount1.toString(),
                  );
              }
            } catch (err) {
              console.error("❌ Failed with input:", amountIn, err);
              throw err;
            } finally {
              await network.provider.send("evm_revert", [snapshotId]);
            }
          },
        ),
        {
          numRuns: numRuns,
          verbose: true,
        },
      );
    }).timeout(10_800_000); // 3 hours;

    it("should lpSwap (single input)", async () => {
      let amountIn = parseEther(1_000);

      const zeroForOne =
        WVANAAddress.toLowerCase() < ERC20Token.target.toLowerCase();

      let quote = await dataDexQuoterV2.quoteExactInputSingle.staticCall({
        tokenIn: WVANAAddress,
        tokenOut: ERC20Token,
        fee: FeeAmount.MEDIUM,
        amountIn: amountIn,
        sqrtPriceLimitX96: 0,
      });

      const balanceBefore = await ethers.provider.getBalance(user1.address);
      const tokenBalanceBefore = await ERC20Token.balanceOf(user1.address);
      const wvanaBalanceBefore = await WVANA.balanceOf(user1.address);

      // console.log("initSqrtPriceX96", (await pool.slot0()).sqrtPriceX96.toString());
      // console.log("initLiquidity", (await pool.liquidity()).toString());

      let tx = await swapHelper.connect(user1).exactInputSingle(
        {
          tokenIn: VANA,
          tokenOut: ERC20Token.target,
          fee: FeeAmount.MEDIUM,
          recipient: user1.address,
          amountIn: amountIn,
          amountOutMinimum: 0,
        },
        { value: amountIn },
      );
      const txReceipt = await getReceipt(tx);
      (await ERC20Token.balanceOf(user1.address)).should.be.eq(
        tokenBalanceBefore + quote.amountOut,
      );
      (await ethers.provider.getBalance(user1.address)).should.be.eq(
        balanceBefore - amountIn - txReceipt.fee,
      );

      const amountMintInVANA = amountIn;
      const amountMintInToken = await ERC20Token.balanceOf(user1.address);

      await WVANA.connect(user1).deposit({ value: amountMintInVANA });
      (await WVANA.balanceOf(user1.address)).should.be.eq(
        wvanaBalanceBefore + amountMintInVANA,
      );

      await WVANA.connect(user1).approve(
        positionManager.target,
        amountMintInVANA,
      );
      await ERC20Token.connect(user1).approve(
        positionManager.target,
        amountMintInToken,
      );

      const slot0 = await pool.slot0();
      const currentLiquidity = await pool.liquidity();

      const liquidity = maxLiquidityForAmounts(
        JSBI.BigInt(slot0.sqrtPriceX96.toString()),
        TickMath.MIN_SQRT_RATIO,
        TickMath.MAX_SQRT_RATIO,
        JSBI.BigInt(amountMintInVANA.toString()),
        JSBI.BigInt(amountMintInToken.toString()),
        false,
      );
      BigInt(liquidity.toString()).should.be.gt(0);

      const tickLower = nearestUsableTick(
        TickMath.MIN_TICK,
        TICK_SPACINGS[FeeAmount.MEDIUM],
      );
      const tickUpper = nearestUsableTick(
        TickMath.MAX_TICK,
        TICK_SPACINGS[FeeAmount.MEDIUM],
      );

      let mintAmount0: any;
      let mintAmount1: any;
      {
        const pToken0 = new Token(chainId, WVANA.target, 18, "WVANA", "WVANA");
        const pToken1 = new Token(
          chainId,
          ERC20Token.target,
          Number(await ERC20Token.decimals()),
          await ERC20Token.symbol(),
          await ERC20Token.name(),
        );
        const pPool = new Pool(
          pToken0,
          pToken1,
          FeeAmount.MEDIUM,
          JSBI.BigInt(slot0.sqrtPriceX96.toString()),
          JSBI.BigInt(currentLiquidity.toString()),
          Number(slot0.tick),
        );

        const position = new Position({
          pool: pPool,
          tickLower: tickLower,
          tickUpper: tickUpper,
          liquidity: liquidity,
        });

        mintAmount0 = position.mintAmounts.amount0;
        mintAmount1 = position.mintAmounts.amount1;
      }

      // console.log("tickLower", tickLower);
      // console.log("tickUpper", tickUpper);

      const lpTokenId = 1550;
      await positionManager
        .connect(user1)
        .mint({
          token0: WVANA,
          token1: ERC20Token,
          fee: FeeAmount.MEDIUM,
          tickLower: tickLower,
          tickUpper: tickUpper,
          amount0Desired: amountMintInVANA,
          amount1Desired: amountMintInToken,
          amount0Min: 0,
          amount1Min: 0,
          recipient: user1.address,
          deadline: Math.floor(Date.now() / 1000) + 60 * 10,
        })
        .should.emit(pool, "Mint")
        .withArgs(
          positionManager.target,
          positionManager.target,
          tickLower,
          tickUpper,
          liquidity.toString(),
          mintAmount0.toString(),
          mintAmount1.toString(),
        )
        .also.emit(positionManager, "IncreaseLiquidity")
        .withArgs(
          lpTokenId,
          liquidity.toString(),
          mintAmount0.toString(),
          mintAmount1.toString(),
        );

      await network.provider.send("hardhat_setBalance", [
        user1.address,
        toHex(2n * amountIn),
      ]);

      // amountIn = 1288574971238664698624n;
      // amountIn = 1270713885215485279559n;
      amountIn = 7398780076610888n;

      const lpQuote = await dlpRewardSwap.callQuoteLpSwap.staticCall({
        tokenIn: VANA,
        tokenOut: ERC20Token,
        fee: FeeAmount.MEDIUM,
        amountIn: amountIn,
        maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
        // sqrtRatioLowerX96: BigInt(TickMath.getSqrtRatioAtTick(tickLower).toString()),
        // sqrtRatioUpperX96: BigInt(TickMath.getSqrtRatioAtTick(tickUpper).toString()),
        sqrtRatioLowerX96: BigInt(TickMath.MIN_SQRT_RATIO.toString()),
        sqrtRatioUpperX96: BigInt(TickMath.MAX_SQRT_RATIO.toString()),
      });

      // console.log(
      //     "amountIn", amountIn,
      //     "amountSwapIn", lpQuote.amountSwapIn,
      //     "liquidityDelta", lpQuote.liquidityDelta.toString(),
      //     "spareIn", lpQuote.spareIn.toString(),
      //     "spareOut", lpQuote.spareOut.toString());

      if (lpQuote.liquidityDelta > 0) {
        const swapQuote =
          await swapHelper.quoteSlippageExactInputSingle.staticCall({
            tokenIn: VANA,
            tokenOut: ERC20Token,
            fee: FeeAmount.MEDIUM,
            amountIn: lpQuote.amountSwapIn,
            sqrtPriceX96: 0,
            liquidity: 0,
            maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
          });

        const amountLpIn = amountIn - lpQuote.amountSwapIn - lpQuote.spareIn;
        const amountLpOut = swapQuote.amountReceived - lpQuote.spareOut;

        mintAmount0 = zeroForOne ? amountLpIn : amountLpOut;
        mintAmount1 = zeroForOne ? amountLpOut : amountLpIn;

        const liquidityDelta = maxLiquidityForAmounts(
          JSBI.BigInt(slot0.sqrtPriceX96.toString()),
          TickMath.getSqrtRatioAtTick(tickLower),
          TickMath.getSqrtRatioAtTick(tickUpper),
          JSBI.BigInt(mintAmount0.toString()),
          JSBI.BigInt(mintAmount1.toString()),
          false,
        );
        // console.log("slot0.sqrtPriceX96", slot0.sqrtPriceX96.toString());
        // console.log("liquidity", await pool.liquidity());
        // console.log("tickLower", tickLower);
        // console.log("tickUpper", tickUpper);
        // console.log("mintAmount0", mintAmount0.toString());
        // console.log("mintAmount1", mintAmount1.toString());
        // console.log("liquidityDelta", liquidityDelta.toString());
        // console.log("lpQuote.liquidityDelta", lpQuote.liquidityDelta.toString());
        BigInt(liquidityDelta.toString()).should.be.lte(lpQuote.liquidityDelta);

        const tx = await dlpRewardSwap.connect(user1).callLpSwap(
          {
            amountIn: amountIn,
            tokenIn: VANA,
            tokenOut: ERC20Token,
            fee: FeeAmount.MEDIUM,
            maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
            lpTokenId: lpTokenId,
          },
          { value: amountIn },
        );
        tx.should
          .emit(positionManager, "IncreaseLiquidity")
          .withArgs(
            lpTokenId,
            lpQuote.liquidityDelta.toString(),
            mintAmount0.toString(),
            mintAmount1.toString(),
          );

        tx.should
          .emit(pool, "Mint")
          .withArgs(
            positionManager.target,
            positionManager.target,
            tickLower,
            tickUpper,
            lpQuote.liquidityDelta.toString(),
            mintAmount0.toString(),
            mintAmount1.toString(),
          );
      }
    });

    it("should splitRewardSwap (fuzzing)", async () => {
      let amountIn = parseEther(1_000);

      const zeroForOne =
        WVANAAddress.toLowerCase() < ERC20Token.target.toLowerCase();

      let quote = await dataDexQuoterV2.quoteExactInputSingle.staticCall({
        tokenIn: WVANAAddress,
        tokenOut: ERC20Token,
        fee: FeeAmount.MEDIUM,
        amountIn: amountIn,
        sqrtPriceLimitX96: 0,
      });

      const balanceBefore = await ethers.provider.getBalance(
        foundation.address,
      );
      const tokenBalanceBefore = await ERC20Token.balanceOf(foundation.address);

      let tx = await swapHelper.connect(foundation).exactInputSingle(
        {
          tokenIn: VANA,
          tokenOut: ERC20Token.target,
          fee: FeeAmount.MEDIUM,
          recipient: foundation.address,
          amountIn: amountIn,
          amountOutMinimum: 0,
        },
        { value: amountIn },
      );
      const txReceipt = await getReceipt(tx);
      (await ERC20Token.balanceOf(foundation.address)).should.be.eq(
        tokenBalanceBefore + quote.amountOut,
      );
      (await ethers.provider.getBalance(foundation.address)).should.be.eq(
        balanceBefore - amountIn - txReceipt.fee,
      );

      const amountMintInVANA = amountIn;
      const amountMintInToken = await ERC20Token.balanceOf(foundation.address);

      await WVANA.connect(foundation).deposit({ value: amountMintInVANA });
      (await WVANA.balanceOf(foundation.address)).should.be.eq(
        amountMintInVANA,
      );

      await WVANA.connect(foundation).approve(
        positionManager.target,
        amountMintInVANA,
      );
      await ERC20Token.connect(foundation).approve(
        positionManager.target,
        amountMintInToken,
      );

      const slot0 = await pool.slot0();
      const currentLiquidity = await pool.liquidity();

      const tickLower = nearestUsableTick(
        TickMath.MIN_TICK,
        TICK_SPACINGS[FeeAmount.MEDIUM],
      );
      const tickUpper = nearestUsableTick(
        TickMath.MAX_TICK,
        TICK_SPACINGS[FeeAmount.MEDIUM],
      );

      const liquidity = maxLiquidityForAmounts(
        JSBI.BigInt(slot0.sqrtPriceX96.toString()),
        TickMath.getSqrtRatioAtTick(tickLower),
        TickMath.getSqrtRatioAtTick(tickUpper),
        JSBI.BigInt(amountMintInVANA.toString()),
        JSBI.BigInt(amountMintInToken.toString()),
        false,
      );

      // console.log("liquidity", liquidity.toString());
      // console.log("amountMintInVANA", amountMintInVANA.toString());
      // console.log("amountMintInToken", amountMintInToken.toString());

      BigInt(liquidity.toString()).should.be.gt(0);

      let mintAmount0: any;
      let mintAmount1: any;
      {
        const pToken0 = new Token(chainId, WVANA.target, 18, "WVANA", "WVANA");
        const pToken1 = new Token(
          chainId,
          ERC20Token.target,
          Number(await ERC20Token.decimals()),
          await ERC20Token.symbol(),
          await ERC20Token.name(),
        );
        const pPool = new Pool(
          pToken0,
          pToken1,
          FeeAmount.MEDIUM,
          JSBI.BigInt(slot0.sqrtPriceX96.toString()),
          JSBI.BigInt(currentLiquidity.toString()),
          Number(slot0.tick),
        );

        const position = new Position({
          pool: pPool,
          tickLower: tickLower,
          tickUpper: tickUpper,
          liquidity: liquidity,
        });

        mintAmount0 = position.mintAmounts.amount0;
        mintAmount1 = position.mintAmounts.amount1;
      }

      const lpTokenId = 1550;
      await positionManager
        .connect(foundation)
        .mint({
          token0: WVANA,
          token1: ERC20Token,
          fee: FeeAmount.MEDIUM,
          tickLower: tickLower,
          tickUpper: tickUpper,
          amount0Desired: amountMintInVANA,
          amount1Desired: amountMintInToken,
          amount0Min: 0,
          amount1Min: 0,
          recipient: foundation.address,
          deadline: Math.floor(Date.now() / 1000) + 60 * 10,
        })
        .should.emit(pool, "Mint")
        .withArgs(
          positionManager.target,
          positionManager.target,
          tickLower,
          tickUpper,
          liquidity.toString(),
          mintAmount0.toString(),
          mintAmount1.toString(),
        )
        .also.emit(positionManager, "IncreaseLiquidity")
        .withArgs(
          lpTokenId,
          liquidity.toString(),
          mintAmount0.toString(),
          mintAmount1.toString(),
        );

      let counter = 0;
      const numRuns = RUN_FACTOR * NUM_RUNS;

      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: parseEther(1), max: parseEther(1_000_000) }),
          async (amountIn) => {
            const snapshotId = await network.provider.send("evm_snapshot");

            const rewardPercentage = parseEther(50); // 50%

            counter++;
            process.stdout.write(`\rsplitRewardSwap ${counter} / ${numRuns}`);

            try {
              await network.provider.send("hardhat_setBalance", [
                foundation.address,
                toHex(2n * amountIn),
              ]);

              const dlpTokenBalanceBefore = await ERC20Token.balanceOf(
                dlp.address,
              );

              const quote = await dlpRewardSwap.quoteSplitRewardSwap.staticCall(
                {
                  amountIn: amountIn,
                  lpTokenId: lpTokenId,
                  rewardPercentage: rewardPercentage,
                  maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
                },
              );

              // console.log(
              //     "amountIn", amountIn,
              //     "usedVanaAmount", quote.usedVanaAmount.toString(),
              //     "tokenRewardAmount", quote.tokenRewardAmount.toString(),
              //     "spareVana", quote.spareVana.toString(),
              //     "spareToken", quote.spareToken.toString());

              const rewardAmount =
                (amountIn * rewardPercentage) / parseEther(100);
              const lpAmount = amountIn - rewardAmount;
              const usedVanaForLp = lpAmount - quote.spareVana;
              const usedVanaForReward = quote.usedVanaAmount - usedVanaForLp;
              const unusedVanaForReward = rewardAmount - usedVanaForReward;
              quote.usedVanaAmount.should.be.eq(
                usedVanaForLp + usedVanaForReward,
              );
              amountIn.should.be.eq(
                quote.usedVanaAmount + quote.spareVana + unusedVanaForReward,
              );

              const foundationVanaBalanceBefore =
                await ethers.provider.getBalance(foundation.address);

              const treasuryVanaBalanceBefore =
                await ethers.provider.getBalance(treasury.address);
              const treasuryTokenBalanceBefore = await ERC20Token.balanceOf(
                treasury.address,
              );

              const poolVanaBalanceBefore = await WVANA.balanceOf(pool.target);
              const poolTokenBalanceBefore = await ERC20Token.balanceOf(
                pool.target,
              );

              tx = await dlpRewardSwap.connect(foundation).splitRewardSwap(
                {
                  lpTokenId: lpTokenId,
                  rewardPercentage: rewardPercentage,
                  maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
                  rewardRecipient: dlp.address,
                  spareRecipient: treasury.address,
                },
                { value: amountIn },
              );
              const txReceipt = await getReceipt(tx);

              const foundationVanaBalanceAfter =
                await ethers.provider.getBalance(foundation.address);
              foundationVanaBalanceAfter.should.be.eq(
                foundationVanaBalanceBefore -
                  amountIn +
                  unusedVanaForReward -
                  txReceipt.fee,
              );
              foundationVanaBalanceAfter.should.be.eq(
                foundationVanaBalanceBefore -
                  quote.usedVanaAmount -
                  quote.spareVana -
                  txReceipt.fee,
              );

              const poolVanaBalanceAfter = await WVANA.balanceOf(pool.target);
              poolVanaBalanceAfter.should.be.eq(
                poolVanaBalanceBefore +
                  amountIn -
                  unusedVanaForReward -
                  quote.spareVana,
              );

              const poolTokenBalanceAfter = await ERC20Token.balanceOf(
                pool.target,
              );
              poolTokenBalanceAfter.should.be.eq(
                poolTokenBalanceBefore -
                  quote.tokenRewardAmount -
                  quote.spareToken,
              );

              const dlpTokenBalanceAfter = await ERC20Token.balanceOf(
                dlp.address,
              );
              dlpTokenBalanceAfter.should.be.eq(
                dlpTokenBalanceBefore + quote.tokenRewardAmount,
              );

              const treasuryVanaBalanceAfter = await ethers.provider.getBalance(
                treasury.address,
              );
              treasuryVanaBalanceAfter.should.be.eq(
                treasuryVanaBalanceBefore + quote.spareVana,
              );

              const treasuryTokenBalanceAfter = await ERC20Token.balanceOf(
                treasury.address,
              );
              treasuryTokenBalanceAfter.should.be.eq(
                treasuryTokenBalanceBefore + quote.spareToken,
              );

              (await ERC20Token.balanceOf(dlpRewardSwap)).should.be.eq(0);
              (await ethers.provider.getBalance(dlpRewardSwap)).should.be.eq(0);
            } catch (err) {
              console.error("❌ Failed with input:", amountIn, err);
              throw err;
            } finally {
              await network.provider.send("evm_revert", [snapshotId]);
            }
          },
        ),
        {
          numRuns: numRuns,
          verbose: true,
        },
      );
    }).timeout(10_800_000); // 3 hours;

    it("should splitRewardSwap (single)", async () => {
      let amountIn = parseEther(1_000);

      const zeroForOne =
        WVANAAddress.toLowerCase() < ERC20Token.target.toLowerCase();

      let quote = await dataDexQuoterV2.quoteExactInputSingle.staticCall({
        tokenIn: WVANAAddress,
        tokenOut: ERC20Token,
        fee: FeeAmount.MEDIUM,
        amountIn: amountIn,
        sqrtPriceLimitX96: 0,
      });

      const balanceBefore = await ethers.provider.getBalance(
        foundation.address,
      );
      const tokenBalanceBefore = await ERC20Token.balanceOf(foundation.address);

      let tx = await swapHelper.connect(foundation).exactInputSingle(
        {
          tokenIn: VANA,
          tokenOut: ERC20Token.target,
          fee: FeeAmount.MEDIUM,
          recipient: foundation.address,
          amountIn: amountIn,
          amountOutMinimum: 0,
        },
        { value: amountIn },
      );
      let txReceipt = await getReceipt(tx);
      (await ERC20Token.balanceOf(foundation.address)).should.be.eq(
        tokenBalanceBefore + quote.amountOut,
      );
      (await ethers.provider.getBalance(foundation.address)).should.be.eq(
        balanceBefore - amountIn - txReceipt.fee,
      );

      const amountMintInVANA = amountIn;
      const amountMintInToken = await ERC20Token.balanceOf(foundation.address);

      await WVANA.connect(foundation).deposit({ value: amountMintInVANA });
      (await WVANA.balanceOf(foundation.address)).should.be.eq(
        amountMintInVANA,
      );

      await WVANA.connect(foundation).approve(
        positionManager.target,
        amountMintInVANA,
      );
      await ERC20Token.connect(foundation).approve(
        positionManager.target,
        amountMintInToken,
      );

      const slot0 = await pool.slot0();
      const currentLiquidity = await pool.liquidity();

      const tickLower = nearestUsableTick(
        TickMath.MIN_TICK,
        TICK_SPACINGS[FeeAmount.MEDIUM],
      );
      const tickUpper = nearestUsableTick(
        TickMath.MAX_TICK,
        TICK_SPACINGS[FeeAmount.MEDIUM],
      );

      const liquidity = maxLiquidityForAmounts(
        JSBI.BigInt(slot0.sqrtPriceX96.toString()),
        TickMath.getSqrtRatioAtTick(tickLower),
        TickMath.getSqrtRatioAtTick(tickUpper),
        JSBI.BigInt(amountMintInVANA.toString()),
        JSBI.BigInt(amountMintInToken.toString()),
        false,
      );

      // console.log("liquidity", liquidity.toString());
      // console.log("amountMintInVANA", amountMintInVANA.toString());
      // console.log("amountMintInToken", amountMintInToken.toString());

      BigInt(liquidity.toString()).should.be.gt(0);

      let mintAmount0: any;
      let mintAmount1: any;
      {
        const pToken0 = new Token(chainId, WVANA.target, 18, "WVANA", "WVANA");
        const pToken1 = new Token(
          chainId,
          ERC20Token.target,
          Number(await ERC20Token.decimals()),
          await ERC20Token.symbol(),
          await ERC20Token.name(),
        );
        const pPool = new Pool(
          pToken0,
          pToken1,
          FeeAmount.MEDIUM,
          JSBI.BigInt(slot0.sqrtPriceX96.toString()),
          JSBI.BigInt(currentLiquidity.toString()),
          Number(slot0.tick),
        );

        const position = new Position({
          pool: pPool,
          tickLower: tickLower,
          tickUpper: tickUpper,
          liquidity: liquidity,
        });

        mintAmount0 = position.mintAmounts.amount0;
        mintAmount1 = position.mintAmounts.amount1;
      }

      const lpTokenId = 1550;
      await positionManager
        .connect(foundation)
        .mint({
          token0: WVANA,
          token1: ERC20Token,
          fee: FeeAmount.MEDIUM,
          tickLower: tickLower,
          tickUpper: tickUpper,
          amount0Desired: amountMintInVANA,
          amount1Desired: amountMintInToken,
          amount0Min: 0,
          amount1Min: 0,
          recipient: foundation.address,
          deadline: Math.floor(Date.now() / 1000) + 60 * 10,
        })
        .should.emit(pool, "Mint")
        .withArgs(
          positionManager.target,
          positionManager.target,
          tickLower,
          tickUpper,
          liquidity.toString(),
          mintAmount0.toString(),
          mintAmount1.toString(),
        )
        .also.emit(positionManager, "IncreaseLiquidity")
        .withArgs(
          lpTokenId,
          liquidity.toString(),
          mintAmount0.toString(),
          mintAmount1.toString(),
        );

      const rewardPercentage = parseEther(50); // 50%

      amountIn = 5646607493091401645215n;

      await network.provider.send("hardhat_setBalance", [
        foundation.address,
        toHex(2n * amountIn),
      ]);

      const dlpTokenBalanceBefore = await ERC20Token.balanceOf(dlp.address);

      quote = await dlpRewardSwap.quoteSplitRewardSwap.staticCall({
        amountIn: amountIn,
        lpTokenId: lpTokenId,
        rewardPercentage: rewardPercentage,
        maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
      });

      // console.log(
      //     "amountIn", amountIn,
      //     "usedVanaAmount", quote.usedVanaAmount.toString(),
      //     "tokenRewardAmount", quote.tokenRewardAmount.toString(),
      //     "spareVana", quote.spareVana.toString(),
      //     "spareToken", quote.spareToken.toString());

      const rewardAmount = (amountIn * rewardPercentage) / parseEther(100);
      const lpAmount = amountIn - rewardAmount;
      const usedVanaForLp = lpAmount - quote.spareVana;
      const usedVanaForReward = quote.usedVanaAmount - usedVanaForLp;
      const unusedVanaForReward = rewardAmount - usedVanaForReward;
      quote.usedVanaAmount.should.be.eq(usedVanaForLp + usedVanaForReward);
      amountIn.should.be.eq(
        quote.usedVanaAmount + quote.spareVana + unusedVanaForReward,
      );

      const foundationVanaBalanceBefore = await ethers.provider.getBalance(
        foundation.address,
      );

      const treasuryVanaBalanceBefore = await ethers.provider.getBalance(
        treasury.address,
      );
      const treasuryTokenBalanceBefore = await ERC20Token.balanceOf(
        treasury.address,
      );

      const poolVanaBalanceBefore = await WVANA.balanceOf(pool.target);
      const poolTokenBalanceBefore = await ERC20Token.balanceOf(pool.target);

      tx = await dlpRewardSwap.connect(foundation).splitRewardSwap(
        {
          lpTokenId: lpTokenId,
          rewardPercentage: rewardPercentage,
          maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
          rewardRecipient: dlp.address,
          spareRecipient: treasury.address,
        },
        { value: amountIn },
      );
      txReceipt = await getReceipt(tx);

      const foundationVanaBalanceAfter = await ethers.provider.getBalance(
        foundation.address,
      );
      foundationVanaBalanceAfter.should.be.eq(
        foundationVanaBalanceBefore -
          amountIn +
          unusedVanaForReward -
          txReceipt.fee,
      );
      foundationVanaBalanceAfter.should.be.eq(
        foundationVanaBalanceBefore -
          quote.usedVanaAmount -
          quote.spareVana -
          txReceipt.fee,
      );

      const poolVanaBalanceAfter = await WVANA.balanceOf(pool.target);
      poolVanaBalanceAfter.should.be.eq(
        poolVanaBalanceBefore +
          amountIn -
          unusedVanaForReward -
          quote.spareVana,
      );

      const poolTokenBalanceAfter = await ERC20Token.balanceOf(pool.target);
      poolTokenBalanceAfter.should.be.eq(
        poolTokenBalanceBefore - quote.tokenRewardAmount - quote.spareToken,
      );

      const dlpTokenBalanceAfter = await ERC20Token.balanceOf(dlp.address);
      dlpTokenBalanceAfter.should.be.eq(
        dlpTokenBalanceBefore + quote.tokenRewardAmount,
      );

      const treasuryVanaBalanceAfter = await ethers.provider.getBalance(
        treasury.address,
      );
      treasuryVanaBalanceAfter.should.be.eq(
        treasuryVanaBalanceBefore + quote.spareVana,
      );

      const treasuryTokenBalanceAfter = await ERC20Token.balanceOf(
        treasury.address,
      );
      treasuryTokenBalanceAfter.should.be.eq(
        treasuryTokenBalanceBefore + quote.spareToken,
      );

      (await ERC20Token.balanceOf(dlpRewardSwap)).should.be.eq(0);
      (await ethers.provider.getBalance(dlpRewardSwap)).should.be.eq(0);
    });

    it("should splitRewardSwap with existing position lpTokenId (moksha)", async () => {
      const lpTokenId = 86;
      const rewardPercentage = parseEther(50); // 50%

      const dlpTokenAddress = "0xb95C6ED43B965D1050161a6A6D78170eFEf5dbF2";
      const dlpToken = await ethers.getContractAt(ERC20.abi, dlpTokenAddress);

      const poolAddress = await factory.getPool(
        WVANAAddress,
        dlpTokenAddress,
        FeeAmount.MEDIUM,
      );
      const pool = await ethers.getContractAt(IUniswapV3Pool.abi, poolAddress);

      let counter = 0;
      const numRuns = 100 * NUM_RUNS;

      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: parseEther(1), max: parseEther(50_000) }),
          async (amountIn) => {
            const snapshotId = await network.provider.send("evm_snapshot");

            counter++;
            process.stdout.write(
              `\rsplitRewardSwap (moksha) ${counter} / ${numRuns}`,
            );

            try {
              await network.provider.send("hardhat_setBalance", [
                foundation.address,
                toHex(2n * amountIn),
              ]);

              const dlpTokenBalanceBefore = await dlpToken.balanceOf(
                dlp.address,
              );

              const quote = await dlpRewardSwap.quoteSplitRewardSwap.staticCall(
                {
                  amountIn: amountIn,
                  lpTokenId: lpTokenId,
                  rewardPercentage: rewardPercentage,
                  maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
                },
              );

              // console.log(
              //     "amountIn", amountIn,
              //     "usedVanaAmount", quote.usedVanaAmount.toString(),
              //     "tokenRewardAmount", quote.tokenRewardAmount.toString(),
              //     "spareVana", quote.spareVana.toString(),
              //     "spareToken", quote.spareToken.toString());

              const rewardAmount =
                (amountIn * rewardPercentage) / parseEther(100);
              const lpAmount = amountIn - rewardAmount;
              const usedVanaForLp = lpAmount - quote.spareVana;
              const usedVanaForReward = quote.usedVanaAmount - usedVanaForLp;
              const unusedVanaForReward = rewardAmount - usedVanaForReward;
              quote.usedVanaAmount.should.be.eq(
                usedVanaForLp + usedVanaForReward,
              );
              amountIn.should.be.eq(
                quote.usedVanaAmount + quote.spareVana + unusedVanaForReward,
              );

              const foundationVanaBalanceBefore =
                await ethers.provider.getBalance(foundation.address);

              const treasuryVanaBalanceBefore =
                await ethers.provider.getBalance(treasury.address);
              const treasuryTokenBalanceBefore = await dlpToken.balanceOf(
                treasury.address,
              );

              const poolVanaBalanceBefore = await WVANA.balanceOf(pool.target);
              const poolTokenBalanceBefore = await dlpToken.balanceOf(
                pool.target,
              );

              let tx = await dlpRewardSwap.connect(foundation).splitRewardSwap(
                {
                  lpTokenId: lpTokenId,
                  rewardPercentage: rewardPercentage,
                  maximumSlippagePercentage: SLIPPAGE_TOLERANCE,
                  rewardRecipient: dlp.address,
                  spareRecipient: treasury.address,
                },
                { value: amountIn },
              );
              const txReceipt = await getReceipt(tx);

              const foundationVanaBalanceAfter =
                await ethers.provider.getBalance(foundation.address);
              foundationVanaBalanceAfter.should.be.eq(
                foundationVanaBalanceBefore -
                  amountIn +
                  unusedVanaForReward -
                  txReceipt.fee,
              );
              foundationVanaBalanceAfter.should.be.eq(
                foundationVanaBalanceBefore -
                  quote.usedVanaAmount -
                  quote.spareVana -
                  txReceipt.fee,
              );

              const poolVanaBalanceAfter = await WVANA.balanceOf(pool.target);
              poolVanaBalanceAfter.should.be.eq(
                poolVanaBalanceBefore +
                  amountIn -
                  unusedVanaForReward -
                  quote.spareVana,
              );

              const poolTokenBalanceAfter = await dlpToken.balanceOf(
                pool.target,
              );
              poolTokenBalanceAfter.should.be.eq(
                poolTokenBalanceBefore -
                  quote.tokenRewardAmount -
                  quote.spareToken,
              );

              const dlpTokenBalanceAfter = await dlpToken.balanceOf(
                dlp.address,
              );
              dlpTokenBalanceAfter.should.be.eq(
                dlpTokenBalanceBefore + quote.tokenRewardAmount,
              );

              const treasuryVanaBalanceAfter = await ethers.provider.getBalance(
                treasury.address,
              );
              treasuryVanaBalanceAfter.should.be.eq(
                treasuryVanaBalanceBefore + quote.spareVana,
              );

              const treasuryTokenBalanceAfter = await dlpToken.balanceOf(
                treasury.address,
              );
              treasuryTokenBalanceAfter.should.be.eq(
                treasuryTokenBalanceBefore + quote.spareToken,
              );

              (await dlpToken.balanceOf(dlpRewardSwap)).should.be.eq(0);
              (await ethers.provider.getBalance(dlpRewardSwap)).should.be.eq(0);
            } catch (err) {
              console.error("❌ Failed with input:", amountIn, err);
              throw err;
            } finally {
              await network.provider.send("evm_revert", [snapshotId]);
            }
          },
        ),
        {
          numRuns: numRuns,
          verbose: true,
        },
      );
    }).timeout(10_800_000); // 3 hours;

    it("should quoteExactInputSingle on moksha", async () => {
      const dlpTokenAddress = "0xb95C6ED43B965D1050161a6A6D78170eFEf5dbF2";
      const dlpToken = await ethers.getContractAt(ERC20.abi, dlpTokenAddress);

      const amountIn = parseEther(1_000_000);

      const quoteV2 = await dataDexQuoterV2.quoteExactInputSingle.staticCall({
        tokenIn: dlpTokenAddress,
        tokenOut: WVANAAddress,
        fee: FeeAmount.MEDIUM,
        amountIn: amountIn,
        sqrtPriceLimitX96: 0,
      });

      const amountOut = await swapHelper.quoteExactInputSingle.staticCall({
        tokenIn: dlpTokenAddress,
        tokenOut: WVANAAddress,
        fee: FeeAmount.MEDIUM,
        amountIn: amountIn,
      });
      amountOut.should.be.eq(quoteV2.amountOut);
    });
  });
});
