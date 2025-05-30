import { deployments, ethers } from "hardhat";

async function main() {
  const proxyAddress = (await deployments.get("DLPRootMetricsProxy")).address;

  const implementationSlot =
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const storageValue = await ethers.provider.getStorage(
    proxyAddress,
    implementationSlot,
  );
  const implementationAddress = ethers.getAddress(
    "0x" + storageValue.slice(26),
  );

  console.log(`Proxy address: ${proxyAddress}`);
  console.log(`Implementation address: ${implementationAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
