# Vana Data Portability Scripts

This package provides utilities for creating and verifying EIP-712 signatures for Vana's Data Portability system. It includes tools for signing server files and permissions data structures used in the Vana ecosystem.

## Overview

The Data Portability system in Vana allows users to manage permissions for accessing their data through trusted servers. This package implements the cryptographic signing and verification logic required for secure data portability operations.

## Features

- **EIP-712 Signature Creation**: Generate cryptographically secure signatures for data portability permissions
- **Signature Verification**: Verify and recover signer addresses from signatures
- **TypeScript Support**: Full type definitions for all data structures and functions
- **Testing Utilities**: Built-in tools for testing signature validity

## Installation

```bash
yarn install
```

## Usage

### Command Line Scripts

#### Sign Server Files and Permissions

Create a signature for server files and permissions data:

```bash
yarn sign <PRIVATE_KEY>
```

Example:
```bash
yarn sign 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
```

#### Test Signature Verification

Verify a pre-existing signature:

```bash
yarn test
```

### Programmatic Usage

#### Import Common Functions

```typescript
import {
  createServerFilesAndPermissionSignature,
  recoverServerFilesAndPermissionSigner,
  ServerFilesAndPermissionData,
  CONFIG
} from './src/common';
```

#### Create a Signature

```typescript
import { ethers } from 'ethers';

const params: ServerFilesAndPermissionData = {
  nonce: 1n,
  granteeId: 1n,
  grant: "https://example.com/grant",
  fileUrls: ["https://example.com/file1"],
  serverAddress: "0x...",
  serverUrl: "https://api.example.com",
  serverPublicKey: "0x...",
  filePermissions: [[{
    account: "0x...",
    key: "0x..."
  }]]
};

const wallet = new ethers.Wallet(privateKey);
const signature = await createServerFilesAndPermissionSignature(
  params,
  wallet,
  CONFIG.contractAddress,
  14800 // Chain ID (14800 for Moksha testnet, 1480 for mainnet)
);
```

#### Verify a Signature

```typescript
const recoveredSigner = await recoverServerFilesAndPermissionSigner(
  params,
  signature,
  CONFIG.contractAddress,
  14800
);

console.log('Signer address:', recoveredSigner);
```

## Data Structures

### ServerFilesAndPermissionData

```typescript
interface ServerFilesAndPermissionData {
  nonce: bigint;           // Unique nonce for replay protection
  granteeId: bigint;       // ID of the grantee
  grant: string;           // Grant URL or identifier
  fileUrls: string[];      // Array of file URLs
  serverAddress: string;   // Ethereum address of the server
  serverUrl: string;       // Server API endpoint URL
  serverPublicKey: string; // Server's public key
  filePermissions: Array<Array<{
    account: string;       // Account address
    key: string;          // Permission key
  }>>;
}
```

## Configuration

The package includes default configuration for the Vana Data Portability system:

```typescript
export const CONFIG = {
  contractAddress: "0xD54523048AdD05b4d734aFaE7C68324Ebb7373eF",
  domainName: "VanaDataPortabilityPermissions",
  domainVersion: "1"
};
```

## Network Support

- **Moksha Testnet**: Chain ID 14800
- **Vana Mainnet**: Chain ID 1480

## Scripts

- `yarn build` - Compile TypeScript to JavaScript
- `yarn sign <PRIVATE_KEY>` - Create signature for server files and permissions
- `yarn test` - Run signature verification test
- `yarn clean` - Clean build artifacts and node_modules

## Security Notes

- Private keys should be handled securely and never committed to version control
- All signatures use EIP-712 standard for structured data signing
- The package includes validation for private key format and signature verification

## Project Structure

```
├── src/
│   ├── common.ts                           # Core utilities and types
│   ├── signAddServerFilesAndPermissions.ts # Signature creation script
│   └── testAddServerFilesAndPermissions.ts # Signature verification test
├── dist/                                   # Compiled JavaScript output
├── package.json                            # Package configuration
├── tsconfig.json                           # TypeScript configuration
└── README.md                               # Project documentation
```

## Requirements

- Node.js >= 18.0.0
- Yarn >= 1.22.0

## Dependencies

- **ethers**: Ethereum library for wallet operations and cryptographic functions
- **typescript**: TypeScript compiler and runtime support
- **ts-node**: TypeScript execution environment for Node.js

## License

MIT