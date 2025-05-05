// scripts/check-vesting-balance.ts

import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const {
  MOKSHA_RPC_URL,
  BENEFICIARY_PRIVATE_KEY,
  DAT_ADDRESS,
  OWNER_ADDRESS,
} = process.env;

if (!MOKSHA_RPC_URL || !BENEFICIARY_PRIVATE_KEY || !DAT_ADDRESS || !OWNER_ADDRESS) {
  throw new Error("Missing env vars: MOKSHA_RPC_URL, BENEFICIARY_PRIVATE_KEY, DAT_ADDRESS, WALLET_ADDRESS, OWNER_ADDRESS");
}

const VESTING_WALLET_ABI = [
  "function releasable(address token) view returns (uint256)",
  "function released(address token) view returns (uint256)",
  "function release(address token)",
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
];

async function main() {
  const WALLET_ADDRESS = "0xe4E5BD91bc68D8EBcF6b74F2d5FC32A2fbe5AC19";  
  const provider = new ethers.JsonRpcProvider(MOKSHA_RPC_URL);
  const signer = new ethers.Wallet(BENEFICIARY_PRIVATE_KEY as string, provider);

  const token = new ethers.Contract(DAT_ADDRESS as string, ERC20_ABI, provider);
  const vestingWallet = new ethers.Contract(WALLET_ADDRESS as string, VESTING_WALLET_ABI, signer);

  const symbol = await token.symbol();
  const tokenDecimals = 18;

  const balanceBefore = await token.balanceOf(signer.address);
  const releasable = await vestingWallet["releasable"](DAT_ADDRESS);
  const releasedBefore = await vestingWallet["released"](DAT_ADDRESS);

  console.log(`\n⏳ Vesting Check for ${symbol}`);
  console.log(`Beneficiary: ${signer.address}`);
  console.log(`Wallet:      ${WALLET_ADDRESS}`);
  console.log(`Token:       ${DAT_ADDRESS}\n`);

  console.log(`Before Release:`);
  console.log(`- Token balance: ${ethers.formatUnits(balanceBefore, tokenDecimals)} ${symbol}`);
  console.log(`- Releasable:    ${ethers.formatUnits(releasable, tokenDecimals)} ${symbol}`);
  console.log(`- Released:      ${ethers.formatUnits(releasedBefore, tokenDecimals)} ${symbol}`);

  if (releasable > 0n) {
    console.log(`\n🚀 Releasing tokens...`);
    const tx = await vestingWallet["release"](DAT_ADDRESS);
    await tx.wait();
  } else {
    console.log(`\n⚠️  Nothing releasable at this moment.`);
    return;
  }

  const balanceAfter = await token.balanceOf(signer.address);
  const releasedAfter = await vestingWallet["released"](DAT_ADDRESS);

  const received = balanceAfter - balanceBefore;

  console.log(`\n✅ Post-Release:`);
  console.log(`- Token balance: ${ethers.formatUnits(balanceAfter, tokenDecimals)} ${symbol}`);
  console.log(`- Released:      ${ethers.formatUnits(releasedAfter, tokenDecimals)} ${symbol}`);
  console.log(`- Amount received: ${ethers.formatUnits(received, tokenDecimals)} ${symbol}`);

  const actualReleased = releasedAfter - releasedBefore;


  if (received === actualReleased) {
    console.log("\n🎉 Release success: tokens received match released amount.");
  } else {
    console.warn(`\n❌ Mismatch:
    - VestingWallet released: ${ethers.formatUnits(actualReleased, tokenDecimals)} 
    - Beneficiary received:   ${ethers.formatUnits(received, tokenDecimals)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
