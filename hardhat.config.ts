import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-deploy";
import * as dotenv from "dotenv";

dotenv.config();

const FIRST_COMPILER_SETTINGS = {
  version: "0.8.24",
  settings: {
    viaIR: true,
    optimizer: {
      enabled: true,
      runs: 1,
    },
    metadata: {
      useLiteralContent: true, // embed full source instead of path
      bytecodeHash: "none",
    },
  },
};

const DEFAULT_COMPILER_SETTINGS = {
  version: "0.8.28",
  settings: {
    viaIR: true,
    optimizer: {
      enabled: true,
      runs: 1,
    },
  },
};

const UNISWAP_INTEGRATION_COMPILER_SETTINGS = {
  version: "0.8.26",
  settings: {
    viaIR: true,
    optimizer: {
      enabled: true,
      runs: 1,
    },
  },
};

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      FIRST_COMPILER_SETTINGS,
      DEFAULT_COMPILER_SETTINGS,
      UNISWAP_INTEGRATION_COMPILER_SETTINGS,
    ],
    overrides: {
      "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol": {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
          metadata: {
            useLiteralContent: true, // embed full source instead of path
            bytecodeHash: "none",
          },
        },
      },
    },
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      chainId: 1480,
      // forking: {
      //   url: process.env.VANA_RPC_URL || "",
      //   blockNumber: 1283121,
      //   // url: process.env.MOKSHA_RPC_URL || "",
      //   // blockNumber: 2_569_780,
      // },
      chains: {
        1480: {
          hardforkHistory: {
            london: 0,
          },
        },
        14800: {
          hardforkHistory: {
            london: 0,
          },
        },
      },
    },
    vana: {
      url: process.env.VANA_RPC_URL || "",
      chainId: 1480,
      accounts:
        process.env.DEPLOYER_PRIVATE_KEY !== undefined
          ? [process.env.DEPLOYER_PRIVATE_KEY]
          : [],
      allowUnlimitedContractSize: true,
    },
    moksha: {
      allowUnlimitedContractSize: true,
      url: process.env.MOKSHA_RPC_URL || "",
      chainId: 14800,
      accounts:
        process.env.DEPLOYER_PRIVATE_KEY !== undefined
          ? [process.env.DEPLOYER_PRIVATE_KEY]
          : [],
    },
    satori: {
      allowUnlimitedContractSize: true,
      gasPrice: 1000000000, // Adjust the gas price (in wei)
      gas: 5000000, // Optionally adjust the gas limit
      url: process.env.SATORI_RPC_URL || "",
      accounts:
        process.env.DEPLOYER_PRIVATE_KEY !== undefined
          ? [process.env.DEPLOYER_PRIVATE_KEY]
          : [],
    },
  },
  etherscan: {
    apiKey: {
      // Is not required by blockscout. Can be any non-empty string
      vana: "abc",
      satori: "abc",
      moksha: "abc",
    },
    customChains: [
      {
        network: "vana",
        chainId: 1480,
        urls: {
          apiURL: process.env.VANA_API_URL || "",
          browserURL: process.env.VANA_BROWSER_URL || "",
        },
      },
      {
        network: "moksha",
        chainId: 14800,
        urls: {
          apiURL: process.env.MOKSHA_API_URL || "",
          browserURL: process.env.MOKSHA_BROWSER_URL || "",
        },
      },
      {
        network: "satori",
        chainId: 14801,
        urls: {
          apiURL: process.env.SATORI_API_URL || "",
          browserURL: process.env.SATORI_BROWSER_URL || "",
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 1800000,
  },
  gasReporter: {
    enabled: true,
    excludeContracts: ["mocks", "tests"],
  },
};
export default config;
