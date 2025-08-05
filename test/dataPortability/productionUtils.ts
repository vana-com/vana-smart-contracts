import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers } from "hardhat";
import { Wallet } from "ethers";
import { createPermissionSignature, PermissionData } from "./signatureUtils";

chai.use(chaiAsPromised);

describe("Data Portability Production Utils", () => {
  let deployerWallet: Wallet;

  before(async () => {
    // Get deployer wallet from environment
    const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!deployerPrivateKey) {
      throw new Error("DEPLOYER_PRIVATE_KEY not set in environment");
    }

    deployerWallet = new ethers.Wallet(deployerPrivateKey, ethers.provider);
  });

  it("should create signature for dataPermission using deployer wallet", async function () {
    // Mock permission data structure
    const permission: PermissionData = {
      nonce: 0n,
      granteeId: 1n,
      grant: "grantUrl",
      fileIds: [1654309n],
    };

    // Mock contract address - replace with actual deployed contract address
    const contractAddress = "0x0d15681C472082e33Aac426C588d9d0C2264014c";

    // Create signature using shared utility
    const signature = await createPermissionSignature(
      permission,
      contractAddress,
      deployerWallet,
    );

    // Verify signature was created
    expect(signature).to.be.a("string");
    expect(signature).to.have.length(132); // 0x + 130 hex chars for 65 bytes
    expect(signature).to.match(/^0x[0-9a-fA-F]{130}$/);

    console.log("Generated signature:", signature);
    console.log("Deployer address:", deployerWallet.address);
    console.log("Permission data:", permission);
    console.log("Contract address:", contractAddress);
    console.log(
      "Chain ID:",
      await ethers.provider.getNetwork().then((n) => n.chainId),
    );
  });

  it.only("should create signature for addAndTrustServer using deployer wallet", async function () {
    // Mock permission data structure
    const permission: PermissionData = {
      nonce: 0n,
      granteeId: 1n,
      grant: "grantUrl",
      fileIds: [1654309n],
    };

    // Mock contract address - replace with actual deployed contract address
    const contractAddress = "0x1483B1F634DBA75AeaE60da7f01A679aabd5ee2c";

    // Create signature using shared utility
    const signature = await createPermissionSignature(
      permission,
      contractAddress,
      deployerWallet,
    );

    // Verify signature was created
    expect(signature).to.be.a("string");
    expect(signature).to.have.length(132); // 0x + 130 hex chars for 65 bytes
    expect(signature).to.match(/^0x[0-9a-fA-F]{130}$/);

    console.log("Generated signature:", signature);
    console.log("Deployer address:", deployerWallet.address);
    console.log("Permission data:", permission);
    console.log("Contract address:", contractAddress);
    console.log(
      "Chain ID:",
      await ethers.provider.getNetwork().then((n) => n.chainId),
    );
  });
});
