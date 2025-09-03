import { ethers } from "ethers";

/**
 * Interface for ServerFilesAndPermission data structure
 */
export interface ServerFilesAndPermissionData {
  nonce: bigint;
  granteeId: bigint;
  grant: string;
  fileUrls: string[];
  serverAddress: string;
  serverUrl: string;
  serverPublicKey: string;
  filePermissions: Array<Array<{ account: string; key: string }>>;
}

/**
 * Default configuration
 */
export const CONFIG = {
  contractAddress: "0xD54523048AdD05b4d734aFaE7C68324Ebb7373eF",
  domainName: "VanaDataPortabilityPermissions",
  domainVersion: "1",
};

/**
 * EIP-712 type definitions
 */
export const EIP712_TYPES = {
  ServerFilesAndPermission: [
    { name: "nonce", type: "uint256" },
    { name: "granteeId", type: "uint256" },
    { name: "grant", type: "string" },
    { name: "fileUrls", type: "string[]" },
    { name: "serverAddress", type: "address" },
    { name: "serverUrl", type: "string" },
    { name: "serverPublicKey", type: "string" },
    { name: "filePermissions", type: "Permission[][]" },
  ],
  Permission: [
    { name: "account", type: "address" },
    { name: "key", type: "string" },
  ],
};

/**
 * Get EIP-712 domain
 */
export function getEIP712Domain(
  contractAddress: string = CONFIG.contractAddress,
  chainId: number,
) {
  return {
    name: CONFIG.domainName,
    version: CONFIG.domainVersion,
    chainId: chainId,
    verifyingContract: contractAddress,
  };
}

/**
 * Convert ServerFilesAndPermissionData to EIP-712 value format
 */
export function toEIP712Value(params: ServerFilesAndPermissionData) {
  return {
    nonce: params.nonce,
    granteeId: params.granteeId,
    grant: params.grant,
    fileUrls: params.fileUrls,
    serverAddress: params.serverAddress,
    serverUrl: params.serverUrl,
    serverPublicKey: params.serverPublicKey,
    filePermissions: params.filePermissions,
  };
}

/**
 * Recovers the signer address from a ServerFilesAndPermission signature
 */
export async function recoverServerFilesAndPermissionSigner(
  params: ServerFilesAndPermissionData,
  signature: string,
  contractAddress: string = CONFIG.contractAddress,
  chainId: number,
): Promise<string> {
  const domain = getEIP712Domain(contractAddress, chainId);
  const value = toEIP712Value(params);

  return ethers.verifyTypedData(domain, EIP712_TYPES, value, signature);
}

/**
 * Creates EIP-712 signature for ServerFilesAndPermission
 */
export async function createServerFilesAndPermissionSignature(
  params: ServerFilesAndPermissionData,
  signer: ethers.Wallet,
  contractAddress: string = CONFIG.contractAddress,
  chainId: number,
): Promise<string> {
  const domain = getEIP712Domain(contractAddress, chainId);
  const value = toEIP712Value(params);

  return await signer.signTypedData(domain, EIP712_TYPES, value);
}

/**
 * Validate private key format
 */
export function validatePrivateKey(privateKey: string): void {
  if (!privateKey.startsWith("0x")) {
    throw new Error("Private key must start with '0x'");
  }

  if (privateKey.length !== 66) {
    throw new Error(
      "Invalid private key length. Expected 66 characters (including '0x' prefix)",
    );
  }
}

/**
 * Format parameters for JSON output
 */
export function formatParamsForJSON(params: ServerFilesAndPermissionData) {
  return {
    nonce: params.nonce.toString(),
    granteeId: params.granteeId.toString(),
    grant: params.grant,
    fileUrls: params.fileUrls,
    serverAddress: params.serverAddress,
    serverUrl: params.serverUrl,
    serverPublicKey: params.serverPublicKey,
    filePermissions: params.filePermissions,
  };
}
