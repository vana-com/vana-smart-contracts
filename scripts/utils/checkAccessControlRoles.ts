import { ethers } from "hardhat";

async function main() {
  // Define contracts that extend AccessControl
  const contractAddresses: Record<string, string> = {
    // DLPRewards contracts
    VanaEpoch: "0x2063cFF0609D59bCCc196E20Eb58A8696a6b15A0",
    DLPRegistry: "0x4D59880a924526d1dD33260552Ff4328b1E18a43",
    DLPRegistryTreasury: "0xb12ce1d27bEeFe39b6F0110b1AB77C21Aa0c9F9a",
    DLPPerformance: "0x847715C7DB37cF286611182Be0bD333cbfa29cc1",
    DLPRewardDeployer: "0xEFD0F9Ba9De70586b7c4189971cF754adC923B04",
    DLPRewardDeployerTreasury: "0xb547ca8Fe4990fe330FeAeb1C2EBb42F925Af5b8",
    DLPRewardSwap: "0x7c6862C46830F0fc3bF3FF509EA1bD0EE7267fB0",
    SwapHelper: "0x55D5e6F73326315bF2e091e97F04f0770e5C54e2",

    // DataAccess contracts
    DataRegistry: "0x8C8788f98385F6ba1adD4234e551ABba0f82Cb7C",
    TeePoolDeprecated: "0x3c92fD91639b41f13338CE62f19131e7d19eaa0D",
    TeePoolPhala: "0xE8EC6BD73b23Ad40E6B9a6f4bD343FAc411bD99A",
    DataRefinerRegistry: "0x93c3EF89369fDcf08Be159D9DeF0F18AB6Be008c",
    QueryEngine: "0xd25Eb66EA2452cf3238A2eC6C1FD1B7F5B320490",
    VanaTreasury: "0x94a1E56e555ac48d092f490fB10CDFaB434915eD",
    ComputeInstructionRegistry: "0x5786B12b4c6Ba2bFAF0e77Ed30Bf6d32805563A5",
    ComputeEngine: "0xb2BFe33FA420c45F1Cf1287542ad81ae935447bd",
    TeePoolEphemeralStandard: "0xe124bae846D5ec157f75Bd9e68ca87C4d2AB835A",
    TeePoolPersistentStandard: "0xe8bB8d0629651Cf33e0845d743976Dc1f0971d76",
    TeePoolPersistentGpu: "0x1c346Cd74f8551f8fa13f3F4b6b8dAE22338E6a9",
    TeePoolDedicatedStandard: "0xf024b7ac5E8417416f53B41ecfa58C8e9396687d",
    TeePoolDedicatedGpu: "0xB1686FA9620bBf851714d1cB47b8a4Bf4664644E",

    // DataPortability contracts
    DataPortabilityPermissions: "0xD54523048AdD05b4d734aFaE7C68324Ebb7373eF",
    DataPortabilityServers: "0x1483B1F634DBA75AeaE60da7f01A679aabd5ee2c",
    DataPortabilityGrantees: "0x8325C0A0948483EdA023A1A2Fd895e62C5131234",

    // VanaStaking contracts
    VanaPoolStaking: "0x641C18E2F286c86f96CE95C8ec1EB9fC0415Ca0e",
    VanaPoolEntity: "0x44f20490A82e1f1F1cC25Dd3BA8647034eDdce30",
    VanaPoolTreasury: "0x143BE72CF2541604A7691933CAccd6D9cC17c003",

    // DLP deployment contracts
    DAT: "0xA706b93ccED89f13340673889e29F0a5cd84212d",
    DATFactory: "0x40f8bccF35a75ecef63BC3B1B3E06ffEB9220644",
    DATPausable: "0xe69FE86f0B95cC2f8416Fe22815c85DC8887e76e",
    DATVotes: "0xaE04c8A77E9B27869eb563720524A9aE0baf1831",

    // Chain contracts
    Multicall3: "0xD8d2dFca27E8797fd779F8547166A2d3B29d360E",
    Multisend: "0x8807e8BCDFbaA8c2761760f3FBA37F6f7F2C5b2d",

    // DLPRoot contracts (deprecated)
    DLPRoot: "0xff14346dF2B8Fd0c95BF34f1c92e49417b508AD5",
    DLPRootCore: "0x0aBa5e28228c323A67712101d61a54d4ff5720FD",
    DLPRootEpoch: "0xc3d176cF6BccFCB9225b53B87a95147218e1537F",
    DLPRootMetrics: "0xbb532917B6407c060Afd9Cb7d53527eCb91d6662",
    DLPRootRewardsTreasury: "0xDBFb6B8b9E2eCAEbdE64d665cD553dB81e524479",
    DLPRootStakesTreasury: "0x52c3260ED5C235fcA43524CF508e29c897318775",
  };

  // Define wallets to check
  const walletAddresses: Record<string, string> = {
    developer1: "0x34529235dAF0B317D30F8e3120Ef04Dff59aB411",
    developer2: "0x2AC93684679a5bdA03C6160def908CdB8D46792f",
    multisigAdmin: "0x5ECA5208F29e32879a711467916965B2D753bAf4",
    multisigDeveloper: "0xe6A285b08E2745Ec75ED70e4fE41e61b390bbB86",
  };

  // Define roles to check
  const ROLES = {
    DEFAULT_ADMIN_ROLE:
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    MAINTAINER_ROLE: ethers.id("MAINTAINER_ROLE"),
    MANAGER_ROLE: ethers.id("MANAGER_ROLE"),
  };

  // AccessControl ABI (minimal interface)
  const accessControlABI = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
  ];

  console.log("=".repeat(80));
  console.log("ACCESS CONTROL ROLE CHECK REPORT");
  console.log("=".repeat(80));
  console.log();

  const results: any[] = [];

  // Check each contract
  for (const [contractName, contractAddress] of Object.entries(
    contractAddresses,
  )) {
    try {
      const contract = new ethers.Contract(
        contractAddress,
        accessControlABI,
        ethers.provider,
      );

      console.log(`\n${contractName} (${contractAddress})`);
      console.log("-".repeat(70));

      const contractResults: any = {
        contractName,
        contractAddress,
        wallets: {},
      };

      // Check each wallet
      for (const [walletName, walletAddress] of Object.entries(
        walletAddresses,
      )) {
        const walletRoles: string[] = [];

        // Check each role
        for (const [roleName, roleHash] of Object.entries(ROLES)) {
          try {
            const hasRole = await contract.hasRole(roleHash, walletAddress);
            if (hasRole) {
              walletRoles.push(roleName);
            }
          } catch (error) {
            // Role might not exist in this contract
          }
        }

        if (walletRoles.length > 0) {
          contractResults.wallets[walletName] = {
            address: walletAddress,
            roles: walletRoles,
          };
          console.log(`  ${walletName} (${walletAddress}):`);
          walletRoles.forEach((role) => {
            console.log(`    ✓ ${role}`);
          });
        }
      }

      if (Object.keys(contractResults.wallets).length === 0) {
        console.log("  No matching wallets with specified roles");
      }

      results.push(contractResults);
    } catch (error) {
      console.log(`\n${contractName} (${contractAddress})`);
      console.log(
        `  Error: Unable to query contract (may not implement AccessControl)`,
      );
    }
  }

  // Summary report
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));

  // Count wallets with roles across all contracts
  const walletRoleSummary: {
    [walletName: string]: {
      address: string;
      roles: { [role: string]: string[] };
    };
  } = {};

  for (const result of results) {
    for (const [walletName, walletData] of Object.entries(result.wallets)) {
      const { address, roles } = walletData as {
        address: string;
        roles: string[];
      };
      if (!walletRoleSummary[walletName]) {
        walletRoleSummary[walletName] = {
          address,
          roles: {},
        };
      }
      for (const role of roles) {
        if (!walletRoleSummary[walletName].roles[role]) {
          walletRoleSummary[walletName].roles[role] = [];
        }
        walletRoleSummary[walletName].roles[role].push(result.contractName);
      }
    }
  }

  if (Object.keys(walletRoleSummary).length === 0) {
    console.log("\nNo wallets found with any of the specified roles");
  } else {
    console.log("\nWallets with roles across contracts:");
    for (const [walletName, walletData] of Object.entries(walletRoleSummary)) {
      console.log(`\n${walletName} (${walletData.address}):`);
      for (const [role, contractsList] of Object.entries(walletData.roles)) {
        console.log(`  ${role} on ${contractsList.length} contract(s):`);
        contractsList.forEach((contractName) => {
          console.log(`    - ${contractName}`);
        });
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
