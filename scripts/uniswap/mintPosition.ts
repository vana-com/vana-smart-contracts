import { ethers } from "hardhat";
import { parseEther } from "ethers";

import { TickMath, nearestUsableTick, maxLiquidityForAmounts } from '@uniswap/v3-sdk';
import { FeeAmount, TICK_SPACINGS } from "@uniswap/v3-sdk";

import INonfungiblePositionManager from '@uniswap/v3-periphery/artifacts/contracts/interfaces/INonfungiblePositionManager.sol/INonfungiblePositionManager.json';
import IUniswapV3Factory from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json';
import IUniswapV3Pool from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';
import IWVANA from '@uniswap/v3-periphery/artifacts/contracts/interfaces/external/IWETH9.sol/IWETH9.json';
import ERC20 from '@openzeppelin/contracts/build/contracts/ERC20.json';

import { SwapHelperImplementation, DLPRegistryImplementation } from "../../typechain-types";

import { sendTransaction } from '../utils/sendTransaction';

import * as dotenv from "dotenv";
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const MINTABLE_ERC20_ABI = [
    ...ERC20.abi,
    "function mint(address to, uint256 amount) external",
];

async function main() {
    try {
        const signer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, ethers.provider);
        console.log("ℹ️ Signer address:", signer.address);

        const positionManager = new ethers.Contract(
            process.env.UNISWAP_POSITION_MANAGER_ADDRESS!,
            INonfungiblePositionManager.abi,
            signer,
        );

        const WVANA = new ethers.Contract(
            await positionManager.WETH9(),
            IWVANA.abi,
            signer,
        );
        console.log("ℹ️ Wrapped VANA address:", WVANA.target);

        const dlpTokenAddress = process.env.DLP_TOKEN_ADDRESS!;
        console.log("ℹ️ DLP token address:", dlpTokenAddress);

        const dlpToken = new ethers.Contract(
            dlpTokenAddress,
            MINTABLE_ERC20_ABI,
            signer,
        );
        console.log("ℹ️ DLP token symbol:", await dlpToken.symbol());

        const factory = await ethers.getContractAt(
            IUniswapV3Factory.abi,
            process.env.UNISWAP_FACTORY_ADDRESS!,
        );

        const zeroForOne = (WVANA.target as string).toLowerCase() < (dlpToken.target as string).toLowerCase();

        const token0 = zeroForOne ? WVANA.target : dlpToken.target;
        const token1 = zeroForOne ? dlpToken.target : WVANA.target;

        console.log("ℹ️ token0:", token0);
        console.log("ℹ️ token1:", token1);

        // Create the pool if it doesn't exist
        // let tx = await positionManager.createAndInitializePoolIfNecessary(
        //     token0,
        //     token1,
        //     FeeAmount.MEDIUM,
        //     TickMath.getSqrtRatioAtTick(0).toString(), // price = 1
        //     { value: 0 },
        // );
        // console.log("Creating pool if necessary...");
        // await sendTransaction(
        //     positionManager,
        //     "createAndInitializePoolIfNecessary",
        //     [
        //         token0,
        //         token1,
        //         FeeAmount.MEDIUM,
        //         TickMath.getSqrtRatioAtTick(0).toString(), // price = 1
        //     ],
        //     signer,
        // );
        // console.log("Pool created or already exists.");

        const poolAddress = await factory.getPool(
            token0,
            token1,
            FeeAmount.MEDIUM,
        );

        console.log("ℹ️ Pool Address:", poolAddress);

        const pool = await ethers.getContractAt(
            IUniswapV3Pool.abi,
            poolAddress,
        );

        const slot0 = await pool.slot0();
        const sqrtPriceX96 = slot0.sqrtPriceX96;

        console.log("ℹ️ slot0:", slot0);

        const VANA_AMOUNT = parseEther("1");

        const swapHelper: SwapHelperImplementation = await ethers.getContractAt(
            "SwapHelperImplementation",
            process.env.SWAP_HELPER_ADDRESS!,
        );

        const dlpRegistry: DLPRegistryImplementation = await ethers.getContractAt(
            "DLPRegistryImplementation",
            process.env.DLP_REGISTRY_ADDRESS!,
        );
        console.log("ℹ️ DLP Registry Address:", dlpRegistry.target);

        console.log("⏳ Swap for DLP token...");
        const quote = await swapHelper.quoteExactInputSingle.staticCall({
            tokenIn: WVANA.target,
            tokenOut: dlpToken.target,
            fee: FeeAmount.MEDIUM,
            amountIn: 2n * VANA_AMOUNT,
        });
        console.log("ℹ️ Quote:", ethers.formatEther(quote));

        await swapHelper.connect(signer).exactInputSingle({
            tokenIn: ethers.ZeroAddress,
            tokenOut: dlpToken.target,
            fee: FeeAmount.MEDIUM,
            recipient: signer.address,
            amountIn: 2n * VANA_AMOUNT,
            amountOutMinimum: 1n,
        }, { value: 2n * VANA_AMOUNT });
        console.log("✅ Swap completed.");

        const dlpTokenAmount = zeroForOne
            ? VANA_AMOUNT * sqrtPriceX96 * sqrtPriceX96 / (2n ** 192n)
            : VANA_AMOUNT * (2n ** 192n) / sqrtPriceX96 / sqrtPriceX96;

        console.log("ℹ️ Desired DLP Token Amount (in ethers):", ethers.formatEther(dlpTokenAmount));

        const token0Amount = zeroForOne ? VANA_AMOUNT : dlpTokenAmount;
        const token1Amount = zeroForOne ? dlpTokenAmount : VANA_AMOUNT;

        const tickLower = nearestUsableTick(TickMath.MIN_TICK, TICK_SPACINGS[FeeAmount.MEDIUM]);
        const tickUpper = nearestUsableTick(TickMath.MAX_TICK, TICK_SPACINGS[FeeAmount.MEDIUM]);

        console.log("⏳ Minting WVANA...");
        await sendTransaction(WVANA, "deposit", [], signer, VANA_AMOUNT);

        console.log("⏳ Approving WVANA...");
        await sendTransaction(WVANA, "approve", [positionManager.target, VANA_AMOUNT], signer);

        console.log("⏳ Approving DLP token...");
        await sendTransaction(dlpToken, "approve", [positionManager.target, dlpTokenAmount], signer);

        // tx = await positionManager
        //     .mint({
        //         token0: token0,
        //         token1: token1,
        //         fee: FeeAmount.MEDIUM,
        //         tickLower: tickLower,
        //         tickUpper: tickUpper,
        //         amount0Desired: token0Amount,
        //         amount1Desired: token1Amount,
        //         amount0Min: 0,
        //         amount1Min: 0,
        //         recipient: signer.address,
        //         deadline: Math.floor(Date.now() / 1000) + 60 * 10,
        //     });
        console.log("⏳ Minting position...");
        const txReceipt = await sendTransaction(
            positionManager,
            "mint",
            [
                {
                    token0: token0,
                    token1: token1,
                    fee: FeeAmount.MEDIUM,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    amount0Desired: token0Amount,
                    amount1Desired: token1Amount,
                    amount0Min: 0,
                    amount1Min: 0,
                    recipient: process.env.POSITION_RECIPIENT_ADDRESS || signer.address,
                    deadline: Math.floor(Date.now() / 1000) + 60 * 10,
                },
            ],
            signer,
        );

        // Parse IncreaseLiquidity event from receipt
        const iface = new ethers.Interface(INonfungiblePositionManager.abi);
        const increaseLiquidityEvents = txReceipt.logs
            .map(log => {
                try {
                    return iface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .filter(event => event && event.name === "IncreaseLiquidity");

        if (increaseLiquidityEvents.length > 0) {
            const event = increaseLiquidityEvents[0]!;
            const tokenId = event.args.tokenId;
            console.log("✅ IncreaseLiquidity event:", event.args);
            console.log("ℹ️ Minted tokenId:", tokenId.toString());
            
            const dlpId = process.env.DLP_ID!;
            console.log("ℹ️ DLP ID:", dlpId);

            await dlpRegistry.connect(signer).updateDlpTokenAndVerification(
                dlpId,
                dlpTokenAddress,
                tokenId,
                true, // isVerified
            );
            console.log("✅ DLP token and verification updated in registry.");
        } else {
            console.log("No IncreaseLiquidity event found.");
        }

    } catch (error) {
        console.error("Error in main function:", error);
        return;
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

// npx hardhat run --network vana scripts/mintPosition.ts