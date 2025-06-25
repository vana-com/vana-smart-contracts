# Query Engine Permissions Script

This script helps you find all permissions granted in the Query Engine contract, with the ability to filter by DLP ID.

## Prerequisites

1. Make sure the following ABIs are available:
   - `scripts/data/abi/QueryEngineAbi.json`
   - `scripts/data/abi/DataRefinerRegistryAbi.json`
2. Set the contract addresses either:
   - As environment variables:
     ```bash
     export QUERY_ENGINE_ADDRESS=0x...
     export DATA_REFINER_REGISTRY_ADDRESS=0x...
     ```
   - Or update the addresses directly in the script

## Usage

### Get all permissions in Query Engine:
```bash
npx hardhat run scripts/data/findQueryEnginePermissions.ts --network <network>
```

### Get permissions for a specific DLP:
```bash
DLP_ID=41 npx hardhat run scripts/data/findQueryEnginePermissions.ts --network <network>
```

### Get permissions for a specific grantee and refiner:
```bash
GRANTEE=0x... REFINER_ID=1 npx hardhat run scripts/data/findQueryEnginePermissions.ts --network <network>
```

### Examples:
```bash
# Get all permissions
npx hardhat run scripts/data/findQueryEnginePermissions.ts --network moksha

# Get permissions for DLP 41
DLP_ID=41 npx hardhat run scripts/data/findQueryEnginePermissions.ts --network moksha

# Get permissions for a specific grantee and refiner
GRANTEE=0x1234567890123456789012345678901234567890 REFINER_ID=1 npx hardhat run scripts/data/findQueryEnginePermissions.ts --network moksha
```

## Output

The script will:
1. Display all permissions found in the console with details:
   - Permission ID
   - Refiner ID and Name (when filtering by DLP)
   - DLP ID (when filtering by DLP)
   - Grantee (address or "Everyone" for generic permissions)
   - Table and Column names
   - Price and token address
   - Approval status

2. Generate a JSON file with all results:
   - Filename: `query_engine_permissions_<timestamp>.json` (all permissions)
   - Filename: `query_engine_permissions_dlp_<dlpId>_<timestamp>.json` (when filtering by DLP)
   - Contains all permissions data and summary statistics

## Permission Types

- **Generic Permissions**: Grantee is address(0), meaning the permission applies to everyone
- **Specific Permissions**: Grantee is a specific address
- **Approved Permissions**: Permission has been approved and is active
- **Pending Permissions**: Permission exists but hasn't been approved yet

## Example Output

```
Finding all permissions in Query Engine...
============================================================
Total permissions in Query Engine: 5
------------------------------------------------------------

Permission ID: 1
  Refiner ID: 1
  Grantee: Everyone (Generic Permission)
  Table: users
  Column: email
  Price: 0.1 ETH
  Token Address: 0x0000000000000000000000000000000000000000
  Approved: true

...

SUMMARY:
Total permissions found: 5
  - Approved permissions: 3
  - Pending permissions: 2
  - Generic permissions: 2
  - Specific permissions: 3

Permissions by Refiner ID:
  Refiner 1: 3 permissions
  Refiner 2: 2 permissions

Results exported to: ./query_engine_permissions_1234567890.json
```