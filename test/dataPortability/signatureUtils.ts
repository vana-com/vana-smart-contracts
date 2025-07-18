import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Wallet } from "ethers";

/**
 * Interface for permission data structure
 */
export interface PermissionData {
  nonce: bigint;
  granteeId: bigint;
  grant: string;
  fileIds: bigint[];
}

/**
 * Interface for revoke permission data structure
 */
export interface RevokePermissionData {
  nonce: bigint;
  permissionId: bigint;
}

/**
 * Interface for trust server data structure
 */
export interface TrustServerData {
  nonce: bigint;
  serverId: bigint;
}

/**
 * Interface for untrust server data structure
 */
export interface UntrustServerData {
  nonce: bigint;
  serverId: bigint;
}

/**
 * Creates EIP-712 signature for data permission
 * @param permission - Permission data to sign
 * @param contractAddress - Address of the DataPortabilityPermissions contract
 * @param signer - Wallet or signer to create signature with
 * @returns Promise<string> - The signature
 */
export async function createPermissionSignature(
  permission: PermissionData,
  contractAddress: string,
  signer: HardhatEthersSigner | Wallet,
): Promise<string> {
  const domain = {
    name: "VanaDataPortabilityPermissions",
    version: "1",
    chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
    verifyingContract: contractAddress,
  };

  const types = {
    Permission: [
      { name: "nonce", type: "uint256" },
      { name: "granteeId", type: "uint256" },
      { name: "grant", type: "string" },
      { name: "fileIds", type: "uint256[]" },
    ],
  };

  const value = {
    nonce: permission.nonce,
    granteeId: permission.granteeId,
    grant: permission.grant,
    fileIds: permission.fileIds,
  };

  return await signer.signTypedData(domain, types, value);
}

/**
 * Creates EIP-712 signature for revoking data permission
 * @param revokePermissionInput - Revoke permission data to sign
 * @param contractAddress - Address of the DataPortabilityPermissions contract
 * @param signer - Wallet or signer to create signature with
 * @returns Promise<string> - The signature
 */
export async function createRevokePermissionSignature(
  revokePermissionInput: RevokePermissionData,
  contractAddress: string,
  signer: HardhatEthersSigner,
): Promise<string> {
  const domain = {
    name: "VanaDataPortabilityPermissions",
    version: "1",
    chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
    verifyingContract: contractAddress,
  };

  const types = {
    RevokePermission: [
      { name: "nonce", type: "uint256" },
      { name: "permissionId", type: "uint256" },
    ],
  };

  const value = {
    nonce: revokePermissionInput.nonce,
    permissionId: revokePermissionInput.permissionId,
  };

  return await signer.signTypedData(domain, types, value);
}

/**
 * Creates EIP-712 signature for trusting a server
 * @param trustServerInput - Trust server data to sign
 * @param contractAddress - Address of the DataPortabilityPermissions contract
 * @param signer - Wallet or signer to create signature with
 * @returns Promise<string> - The signature
 */
export async function createTrustServerSignature(
  trustServerInput: TrustServerData,
  contractAddress: string,
  signer: HardhatEthersSigner,
): Promise<string> {
  const domain = {
    name: "VanaDataPortabilityPermissions",
    version: "1",
    chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
    verifyingContract: contractAddress,
  };

  const types = {
    TrustServer: [
      { name: "nonce", type: "uint256" },
      { name: "serverId", type: "uint256" },
    ],
  };

  const value = {
    nonce: trustServerInput.nonce,
    serverId: trustServerInput.serverId,
  };

  return await signer.signTypedData(domain, types, value);
}

/**
 * Creates EIP-712 signature for untrusting a server
 * @param untrustServerInput - Untrust server data to sign
 * @param contractAddress - Address of the DataPortabilityPermissions contract
 * @param signer - Wallet or signer to create signature with
 * @returns Promise<string> - The signature
 */
export async function createUntrustServerSignature(
  untrustServerInput: UntrustServerData,
  contractAddress: string,
  signer: HardhatEthersSigner,
): Promise<string> {
  const domain = {
    name: "VanaDataPortabilityPermissions",
    version: "1",
    chainId: await ethers.provider.getNetwork().then((n) => n.chainId),
    verifyingContract: contractAddress,
  };

  const types = {
    UntrustServer: [
      { name: "nonce", type: "uint256" },
      { name: "serverId", type: "uint256" },
    ],
  };

  const value = {
    nonce: untrustServerInput.nonce,
    serverId: untrustServerInput.serverId,
  };

  return await signer.signTypedData(domain, types, value);
}
