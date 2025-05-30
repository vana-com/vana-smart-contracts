# Calculate Epoch Scorings

A TypeScript script for calculating DLP epoch scorings using multicall functionality. This script processes stake data in parallel and saves the results both to CSV files and optionally to the blockchain.

## Installation

1. Clone and install dependencies:
```bash
git clone <repository-url>
cd calculateEpochScorings
yarn install
```

2. Configure environment:
```bash
cp .env.example .env
```

Configure in `.env`:
```
JSON_RPC_URL=<your-rpc-url>
DLP_ROOT_ADDRESS=<dlp-root-contract-address>
MULTICALL3_ADDRESS=<multicall3-contract-address>
DEPLOYER_PRIVATE_KEY=<your-private-key>  # Only if saving scores on contract
```

## Usage

Run with default parameters:
```bash
yarn start
```

Run with custom parameters:
```bash
yarn start --stakeStartId=1 --stakeEndId=lastId --fileSize=10000 --multicallChunkSize=1000 --freshRun=true --saveScoringsOnContract=false --epochId=4
```

### Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| epochId | Epoch ID to process | 1 |
| stakeStartId | Starting stake ID | 1 |
| stakeEndId | Ending stake ID or "lastId" | "lastId" |
| fileSize | Number of stakes per file | 10000 |
| multicallChunkSize | Number of stakes per multicall | 1000 |
| freshRun | Delete previous results | true |
| saveScoringsOnContract | Save scores to blockchain | false |

## Output Files

The script generates:

1. `stakes_data.csv`: Detailed stake information
2. `dlp_scores.csv`: Aggregated DLP scores

Files are saved in `scoringResults/epoch{N}/`