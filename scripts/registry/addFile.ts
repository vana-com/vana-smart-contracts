import { deployments, ethers } from "hardhat";
import { Wallet } from "ethers";
import { parseEther } from "../../utils/helpers";

async function main() {
  if (process.env.VANA_W3_PRIVATE_KEY === undefined) {
    throw new Error("OWNER_ADDRESS is not set");
  }

  const user = new Wallet(process.env.VANA_W3_PRIVATE_KEY, ethers.provider);

  console.log(`Using account: ${user.address}`);

  const registry = await ethers.getContractAt(
    "DataRegistryImplementation",
    (await deployments.get("DataRegistryProxy")).address,
    user,
  );

  const teePool = await ethers.getContractAt(
    "TeePoolImplementation",
    (await deployments.get("TeePoolProxy")).address,
    user,
  );

  console.log(`Connected to contract at address: ${registry.target}`);

  // const tx = await registry.addFileWithPermissions(
  //   "https://drive.google.com/uc?id=1uuyj70eHPaXjucefOk6PgfGw2XLAHvll&export=download",
  //   "0x20adD13A08BC5bcDA100D745E78A73598E3901Ed",
  //   [],
  // );

  const signature = await signProof(
    user,
    "https://drive.google.com/uc?id=1uuyj70eHPaXjucefOk6PgfGw2XLAHvll&export=download",
    {
      score: parseEther(0.8),
      dlpId: 21,
      metadata:
        "https://ipfs.vana.org/ipfs/er67JTehDhqRg54gnVrmGtSPV2GhQmRWRQ9uARpoNayrLu",
      proofUrl:
        "https://ipfs.vana.org/ipfs/QhTeg5SPV2GhRQ9uARpoemRWQhTeg5SPV2GhTeg5SPV21",
      instruction:
        "https://ipfs.vana.org/ipfs/QmRSPnVrmhDhgoNayhVWRQ9uARpGter67JTeg54rLuqR2G",
    },
  );

  console.log(`Signature: ${signature}`);

  const tx = await teePool.addProof(2138, {
    signature: signature,
    data: {
      score: parseEther(0.8),
      dlpId: 21,
      metadata:
        "https://ipfs.vana.org/ipfs/er67JTehDhqRg54gnVrmGtSPV2GhQmRWRQ9uARpoNayrLu",
      proofUrl:
        "https://ipfs.vana.org/ipfs/QhTeg5SPV2GhRQ9uARpoemRWQhTeg5SPV2GhTeg5SPV21",
      instruction:
        "https://ipfs.vana.org/ipfs/QmRSPnVrmhDhgoNayhVWRQ9uARpGter67JTeg54rLuqR2G",
    },
  });

  console.log(`Transaction hash: ${tx.hash}`);
}
export type ProofData = {
  score: bigint;
  dlpId: number;
  metadata: string;
  proofUrl: string;
  instruction: string;
};

export async function signProof(
  signer: Wallet,
  fileUrl: string,
  proofData: ProofData,
): Promise<string> {
  const hash = ethers.solidityPackedKeccak256(
    ["string", "uint256", "uint256", "string", "string", "string"],
    [
      fileUrl,
      proofData.score,
      proofData.dlpId,
      proofData.metadata,
      proofData.proofUrl,
      proofData.instruction,
    ],
  );

  return signer.signMessage(ethers.getBytes(hash));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
