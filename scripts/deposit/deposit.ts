import { ethers } from "hardhat";

async function main() {
  if ((await ethers.provider.getBlockNumber()) == 0) {
    throw new Error("Network is not active yet");
  }

  // Get the signer (wallet) from Hardhat, connected to the specified network
  const [signer] = await ethers.getSigners();

  const depositAddress = "0x4242424242424242424242424242424242424242";

  const depositContract = await ethers.getContractAt(
    "DepositImplementation",
    depositAddress,
  );

  console.log(await depositContract.restricted());
  return;

  const mnemonic = process.env.VANA_MOKSHA_MNEMONIC;

  if (mnemonic === undefined) {
    throw new Error("OWNER_PRIVATE_KEY undefined");
  }

  const wallet = ethers.Wallet.fromPhrase(mnemonic, ethers.provider);

  const tx = await depositContract.connect(wallet).updateRestricted(true);

  console.log(`Transaction hash: ${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
