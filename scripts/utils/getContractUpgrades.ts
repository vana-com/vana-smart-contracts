import { ethers } from "hardhat";
import hre from "hardhat";

const proxyAddress = "0x8C8788f98385F6ba1adD4234e551ABba0f82Cb7C";

async function getContractUpgrades(proxyAddress: string, networkName?: string) {
  const network = networkName || hre.network.name;
  console.log(
    `\nFetching upgrade history for proxy: ${proxyAddress} on ${network}\n`,
  );

  try {
    // Get provider
    const provider = ethers.provider;

    // Get the proxy contract
    const proxyContract = await ethers.getContractAt(
      [
        "event Upgraded(address indexed implementation)",
        "event AdminChanged(address previousAdmin, address newAdmin)",
        "function implementation() view returns (address)",
        "function admin() view returns (address)",
      ],
      proxyAddress,
    );

    // Try to get current implementation (different proxy patterns have different methods)
    let currentImplementation: string | null = null;
    try {
      // Try direct implementation() call
      currentImplementation = await proxyContract.implementation();
    } catch {
      try {
        // Try reading from EIP-1967 implementation slot
        const implSlot =
          "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
        const implData = await provider.getStorage(proxyAddress, implSlot);
        currentImplementation = ethers.getAddress("0x" + implData.slice(26));
      } catch (e) {
        console.log("Could not fetch current implementation directly");
      }
    }

    if (currentImplementation) {
      console.log(`Current Implementation: ${currentImplementation}\n`);
    }

    // Get all Upgraded events in chunks to avoid RPC limits
    const upgradeFilter = proxyContract.filters.Upgraded();
    const currentBlock = await provider.getBlockNumber();
    const chunkSize = 10000; // Stay under 10k limit
    let upgradeEvents: any[] = [];

    // Query in chunks from genesis to current block
    for (let fromBlock = 0; fromBlock <= currentBlock; fromBlock += chunkSize) {
      const toBlock = Math.min(fromBlock + chunkSize - 1, currentBlock);
      console.log(`Scanning blocks ${fromBlock} to ${toBlock}...`);

      try {
        const events = await proxyContract.queryFilter(
          upgradeFilter,
          fromBlock,
          toBlock,
        );
        upgradeEvents = upgradeEvents.concat(events);
      } catch (e) {
        console.log(
          `Warning: Failed to query blocks ${fromBlock}-${toBlock}:`,
          e,
        );
      }
    }

    if (upgradeEvents.length === 0) {
      console.log(
        "No upgrade events found. This might be a non-upgradeable contract or events might be emitted differently.",
      );

      // Try to fetch AdminChanged events as alternative
      try {
        const adminFilter = proxyContract.filters.AdminChanged();
        let adminEvents: any[] = [];

        // Query in chunks
        for (
          let fromBlock = 0;
          fromBlock <= currentBlock;
          fromBlock += chunkSize
        ) {
          const toBlock = Math.min(fromBlock + chunkSize - 1, currentBlock);
          try {
            const events = await proxyContract.queryFilter(
              adminFilter,
              fromBlock,
              toBlock,
            );
            adminEvents = adminEvents.concat(events);
          } catch {}
        }

        if (adminEvents.length > 0) {
          console.log("\nAdmin changes detected:");
          for (const event of adminEvents) {
            const block = await event.getBlock();
            console.log(
              `  Block ${event.blockNumber} (${new Date(block.timestamp * 1000).toISOString()})`,
            );
            console.log(`  Tx Hash: ${event.transactionHash}`);
            console.log(`  Previous Admin: ${event.args?.[0]}`);
            console.log(`  New Admin: ${event.args?.[1]}\n`);
          }
        }
      } catch {}

      return;
    }

    console.log(`Found ${upgradeEvents.length} upgrade(s):\n`);
    console.log("=" * 80);

    // Process each upgrade event
    for (let i = 0; i < upgradeEvents.length; i++) {
      const event = upgradeEvents[i];
      const block = await event.getBlock();
      const tx = await event.getTransaction();

      const upgradeNumber =
        i === 0 ? "Initial Implementation" : `Upgrade #${i}`;

      console.log(`\n${upgradeNumber}`);
      console.log("-" * 40);
      console.log(`Implementation: ${event.args?.[0]}`);
      console.log(`Transaction Hash: ${event.transactionHash}`);
      console.log(`Block Number: ${event.blockNumber}`);
      console.log(
        `Timestamp: ${new Date(block.timestamp * 1000).toISOString()}`,
      );
      console.log(`Deployer: ${tx.from}`);

      // Try to get contract name if verified
      try {
        const implAddress = event.args?.[0];
        if (implAddress) {
          const code = await provider.getCode(implAddress);
          if (code && code !== "0x") {
            console.log(`Contract Size: ${(code.length - 2) / 2} bytes`);
          }
        }
      } catch {}
    }

    console.log("\n" + "=" * 80);
    console.log("\nUpgrade History Summary:");
    console.log(
      `Total Upgrades: ${upgradeEvents.length - 1} (excluding initial)`,
    );

    if (upgradeEvents.length > 1) {
      const firstBlock = await upgradeEvents[0].getBlock();
      const lastBlock =
        await upgradeEvents[upgradeEvents.length - 1].getBlock();
      const timeDiff = (lastBlock.timestamp - firstBlock.timestamp) / 86400; // Convert to days
      console.log(`Time Span: ${timeDiff.toFixed(1)} days`);
    }
  } catch (error) {
    console.error("Error fetching upgrade history:", error);
    throw error;
  }
}

// Main execution
async function main() {
  // Validate address
  if (!ethers.isAddress(proxyAddress)) {
    console.error(`Invalid address: ${proxyAddress}`);
    process.exit(1);
  }

  await getContractUpgrades(proxyAddress);
}

// Execute if run directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { getContractUpgrades };
