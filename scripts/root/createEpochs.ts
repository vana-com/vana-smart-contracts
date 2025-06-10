import { ethers } from "hardhat";

const rootAddress = "0xff14346dF2B8Fd0c95BF34f1c92e49417b508AD5";

async function main() {
  const provider = ethers.provider;

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as string;

  // Wallet setup
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(
    `Using wallet: ${wallet.address} with balance: ${await provider.getBalance(wallet.address)}`,
  );

  const root = await ethers.getContractAt(
    "DLPRootImplementation",
    rootAddress,
    wallet,
  );

  console.log(
    await root.estimatedDlpRewardPercentages([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25, 26,
    ]),
  );
  return;

  const tx = await root.createEpochs();

  console.log(`Transaction hash: ${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
