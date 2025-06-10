# DLP Templates Contracts

This folder contains the essential smart contract templates that DataDAO creators must deploy to launch their own Data Liquidity Pools (DLPs) within the Vana ecosystem. These templates provide the foundational implementations for creating DataDAOs - collectively governed datasets that aggregate, verify, and monetize individual user data while maintaining user ownership and control through cryptographic mechanisms.

For a full tutorial about how to create a DataDAO visit: https://docs.vana.org/docs/quick-start-create-a-datadao

### 1. Deploy Smart Contracts

Set up and deploy your DataDAO's smart contracts on the Moksha Testnet. For the complete deployment guide, see [Deploy Smart Contracts](https://docs.vana.org/docs/2-register-datadao).

**Clone and Install:**
```bash
git clone https://github.com/vana-com/vana-smart-contracts.git
cd vana-smart-contracts
npm install
cp .env.example .env
```

**Configure `.env`:**

Edit `.env` with these **required** fields:

```bash
DEPLOYER_PRIVATE_KEY=...           # Your private_key from the previous step, 62-64 letters  
OWNER_ADDRESS=0x...                # Your wallet address from the previous step, 40-42 letters
DLP_NAME=QuickstartDAO             # Name of your DataDAO
DLP_PUBLIC_KEY=045...              # Your wallet public_key from the previous step, 128-132 letters 
DLP_TOKEN_NAME=QuickToken          # Token name
DLP_TOKEN_SYMBOL=QTKN              # Token symbol 
```

🚧 **Security Note:** `.env` files contain sensitive keys. Do **not** commit this file to Git or share it — anyone with access to your `DEPLOYER_PRIVATE_KEY` can take control of your contracts.

**These examples are for format reference only — do not use them in production:**
```bash
DEPLOYER_PRIVATE_KEY=48fe86dc5053bf2c6004a24c0965bd2142fe921a074ffe93b440f0ada662d16d
OWNER_ADDRESS=0x18781A2B6B843E0BBe4F491B28139abb6942d785
DLP_PUBLIC_KEY=04920ff366433d60fcebfa9d072d860e6fd7a482e4c055621ef986025076c9fb6418c15712a22bff61a3add75b645345c7c338f19a8ab0d1a3ac6be1be331eac45
```

You can leave other fields (e.g., `DLP_PROOF_INSTRUCTION`, `DLP_FILE_REWARD_FACTOR`) as defaults for testing.

**Deploy to Moksha Testnet:**

The repository contains many smart contracts used across the Vana ecosystem. The `DLPDeploy` tag deploys only the contracts required to launch your DataDAO:

```bash
npx hardhat deploy --network moksha --tags DLPDeploy
```

After deployment, **save these critical addresses** from the output logs:
- `Token Address` - Your VRC-20 token contract
- `DataLiquidityPoolProxy` - Your main DLP contract
- `Vesting Wallet Address` - Team token vesting contract

You may see error logs related to contract verification. **You can safely ignore those messages** - all contracts will be verified onchain.

**View Your Contracts on Vanascan:**

Visit [moksha.vanascan.io](https://moksha.vanascan.io) and search for each contract address:
- Your **token contract** shows metadata, total supply, and recent token transfers
- Your **DataLiquidityPoolProxy** contract has methods viewable in the **Contract** tab
- Your **VestingWallet** contains the vesting schedule and logic for team token allocation

### 2. Register DataDAO

Now that you've deployed your smart contracts, register your DataDAO onchain in the global DLP registry. For the complete registration guide, see [Register DataDAO](https://docs.vana.org/docs/2-register-datadao).

**Register via DLPRegistryProxy:**

1. Navigate to the [registerDlp](https://moksha.vanascan.io/address/0x4D59880a924526d1dD33260552Ff4328b1E18a43?tab=read_write_proxy&source_address=0x752301d732e3Ef8fbFCAa700e25C3Fa1a6D1629e#0x9d4def70) method in DLPRegistryProxy on Vanascan
2. Fill in the `registrationInfo` fields:
    - `dlpAddress`: The `DataLiquidityPoolProxy` address you saved from deployment
    - `ownerAddress`: Your wallet address
    - `treasuryAddress`: A separate wallet for DLP treasury (can be same as `ownerAddress` for testing)
    - `name`: The `DLP_NAME` you chose (e.g., "QuickstartDAO") - **must be unique**
    - `iconUrl`: Optional logo URL (e.g., `https://example.com/icon.png`)
    - `website`: Optional project link (e.g., `https://example.com`)
    - `metadata`: Optional JSON (e.g., `{"description": "Test DLP"}`)

3. Fill in `Send native VANA (uint256)`:
    - Click the `×10^18` button to set 1 VANA (in wei) - **required deposit**

4. Connect your wallet (`OWNER_ADDRESS`) to Vanascan and submit the transaction

5. Retrieve your `dlpId`:
    - Go to the [dlpIds](https://moksha.vanascan.io/address/0x4D59880a924526d1dD33260552Ff4328b1E18a43?tab=read_write_proxy&source_address=0x752301d732e3Ef8fbFCAa700e25C3Fa1a6D1629e#0xc06020b0) method in the DLPRegistryProxy contract
    - Use your `dlpAddress` to query your dlpId from the blockchain

🚧 **Tip:** You can update your registration info later using the `updateDlp` function. All metadata is editable.
