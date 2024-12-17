import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Wallet } from "ethers";
import { parseEther } from "../../utils/helpers";

export type ProofData = {
  score: bigint;
  dlpId: number;
  metadata: string;
  proofUrl: string;
  instruction: string;
};

export type Proof = {
  signature: string;
  data: ProofData;
};

const proof0: Proof = {
  signature:
    "0x00000000000bdcaa8fe6748edfcb04d5ab59a75123fc06f10f1f82dcc50bd8365677d868ef40572529760d0f093c73d781053d9a6a597e0c169e58b2685f74161c",
  data: {
    score: parseEther(0),
    dlpId: 0,
    metadata: "",
    proofUrl: "",
    instruction: "",
  },
};

const proof1: Proof = {
  signature:
    "0x5347f83fe352b10144e7c6eaca13e682be88e6d72da3c2c12996e5bbdda1122e756d727d97a32279d4cdd236c05ce040440cdd9304ca3bd3941d212354d8a4e41c",
  data: {
    score: parseEther(0.1),
    dlpId: 1,
    metadata: "metadata1",
    proofUrl:
      "https://ipfs.io/ipfs/bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7ll1",
    instruction:
      "https://ipfs.io/ipfs/qf34f34q4fq3fgdsgjgbdugsgwegqlgqhfejrfqjfwjfeql3u4iq4u47ll1",
  },
};

const proof2: Proof = {
  signature:
    "0x1f7c76080bebdcaa8fe6748edfcb04d5ab59a75123fc06f10f1f82dcc50bd8365677d868ef40572529760d0f093c73d781053d9a6a597e0c169e58b2685f74161c",
  data: {
    score: parseEther(0.3),
    dlpId: 2,
    metadata: "metadata2",
    proofUrl:
      "https://ipfs.io/ipfs/bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7ll2",
    instruction:
      "https://ipfs.io/ipfs/qf34f34q4fq3fgdsgjgbdugsgwegqlgqhfejrfqjfwjfeql3u4iq4u47ll2",
  },
};

const proof3: Proof = {
  signature:
    "0x3453567892f7ccaa8fe6748edfcb04d5ab59a75123fc06f10f1f82dcc50bd8365677d868ef40572529760d0f093c73d781053d9a6a597e0c169e58b2685f74161c",
  data: {
    score: parseEther(0.5),
    dlpId: 3,
    metadata: "metadata3",
    proofUrl:
      "https://ipfs.io/ipfs/bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7ll3",
    instruction:
      "https://ipfs.io/ipfs/qf34f34q4fq3fgdsgjgbdugsgwegqlgqhfejrfqjfwjfeql3u4iq4u47ll3",
  },
};

const proof4: Proof = {
  signature:
    "0x4453567892f7ccaa8fe6748edfcb04d5ab59a75123fc06f10f1f82dcc50bd8365677d868ef40572529760d0f093c73d781053d9a6a597e0c169e58b2685f74161c",
  data: {
    score: parseEther(0.7),
    dlpId: 4,
    metadata: "metadata4",
    proofUrl:
      "https://ipfs.io/ipfs/bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7ll4",
    instruction:
      "https://ipfs.io/ipfs/qf34f34q4fq3fgdsgjgbdugsgwegqlgqhfejrfqjfwjfeql3u4iq4u47ll4",
  },
};

const proof5: Proof = {
  signature:
    "0x5453567892f7ccaa8fe6748edfcb04d5ab59a75123fc06f10f1f82dcc50bd8365677d868ef40572529760d0f093c73d781053d9a6a597e0c169e58b2685f74161c",
  data: {
    score: parseEther(0.9),
    dlpId: 5,
    metadata: "metadata5",
    proofUrl:
      "https://ipfs.io/ipfs/bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7ll5",
    instruction:
      "https://ipfs.io/ipfs/qf34f34q4fq3fgdsgjgbdugsgwegqlgqhfejrfqjfwjfeql3u4iq4u47ll5",
  },
};

export const proofs: Proof[] = [proof0, proof1, proof2, proof3, proof4, proof5];

export async function signProof(
  signer: HardhatEthersSigner | Wallet,
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
