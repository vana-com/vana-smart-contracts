## Testing on Mainnet Fork

The BuyAndBurn tests run on a **mainnet fork** to interact with real Uniswap V3 contracts and liquidity pools. 
This gives us confidence that the contracts will work correctly in production.

### Setup

Make sure you have the `VANA_RPC_URL` environment variable set in your `.env`:
```bash
VANA_RPC_URL=https://rpc.vana.org
```

### Running Tests
```bash
# Run all BuyAndBurn tests
npx hardhat test test/data/buyAndBurn.ts

# Run Orchestrator tests
npx hardhat test test/data/buyAndBurnOrchestrator.ts

# Run specific test
npx hardhat test test/data/buyAndBurnOrchestrator.ts --grep "should split VANA protocol share correctly"
```

### How It Works

Each test:
1. **Forks mainnet** at a specific block (2,500,000) to get a consistent state
2. **Uses real contracts**: Uniswap V3 Router, Position Manager, etc.
3. **Creates snapshots** before each test and reverts after, so tests don't interfere with each other
4. **Deploys mocks** only for our internal contracts (DataAccessTreasury)

This approach lets us test against real pool liquidity and actual swap behavior without deploying to testnet every time.

### Pro Tips

- Tests can be slow (~30s each) because we're forking mainnet
- If tests hang, check your RPC URL is accessible
- Block number is hardcoded in tests - update it if you need newer state
- Use `--grep` to run specific tests during development