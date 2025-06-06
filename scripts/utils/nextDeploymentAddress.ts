import { ethers } from "ethers";

function getNextDeploymentAddress(walletAddress: string, nonce: number) {
  try {
    if (!ethers.isAddress(walletAddress)) {
      throw new Error("Invalid wallet address");
    }

    // Convert nonce to hex string for RLP encoding
    const nonceHex = ethers.toBeHex(nonce);

    const rlpEncoded = ethers.encodeRlp([walletAddress, nonceHex]);

    const hash = ethers.keccak256(rlpEncoded);
    const futureAddress = `0x${hash.slice(26)}`;

    console.log(ethers.getAddress(futureAddress));
  } catch (error) {
    throw {
      code: "ADDRESS_CALCULATION_ERROR",
      reason: (error as Error).message,
      ...(error as Error),
    };
  }
}

getNextDeploymentAddress("0x277372579A9C8da6185C49ED50d9A8cdb21FB4cC", 12);
