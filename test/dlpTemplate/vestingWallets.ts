import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers } from "hardhat";
import { parseEther } from "ethers";
import {
  DAT,
  VestingFactory,
  LinearVestingWallet,
  CliffVestingWallet,
  NoVestingWallet,
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

chai.use(chaiAsPromised);

describe("VestingFactory & Wallets", () => {
  /* signers */
  let deployer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let beneficiary: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  /* contracts */
  let dat: DAT;
  let factory: VestingFactory;

  /* constants */
  const NAME = "Data Autonomy Token";
  const SYMBOL = "DAT";
  const GRANT = parseEther("1000");

  beforeEach(async () => {
    [deployer, admin, beneficiary, other] = await ethers.getSigners();
    await ethers.provider.send("hardhat_reset"); // brand-new chain

    // 1. deploy DAT with admin as owner (DEFAULT_ADMIN, ADMIN, MINTER, PAUSER)
    const DATFactory = await ethers.getContractFactory("DAT");
    dat = (await DATFactory.deploy(NAME, SYMBOL, admin.address, 0)) as DAT;
    await dat.waitForDeployment();

    // 2. deploy VestingFactory pointing at DAT
    const VFFactory = await ethers.getContractFactory("VestingFactory");
    factory = (await VFFactory.deploy(dat.target)) as VestingFactory;
    await factory.waitForDeployment();

    // 3️⃣ now grant CREATOR_ROLE to your `admin` account
    const CREATOR_ROLE = await factory.CREATOR_ROLE();
    await factory
      .connect(deployer) // must be default admin
      .grantRole(CREATOR_ROLE, admin.address);

    // 3. grant the factory the minter role, revoke admin if desired
    const MINTER_ROLE = await dat.MINTER_ROLE();
    await dat.connect(admin).grantRole(MINTER_ROLE, factory.target);
    await dat.connect(admin).revokeRole(MINTER_ROLE, admin.address);
  });

  describe("Linear vesting", () => {
    it("creates a LinearVestingWallet and releases linearly", async () => {
      const start = Math.floor(Date.now() / 1000) + 5;
      const duration = 90 * 24 * 60 * 60; // 90 days

      const tx = await factory
        .connect(admin)
        .createLinearVesting(beneficiary.address, GRANT, start, duration);

      const receipt = await tx.wait();
      if (!receipt) throw new Error("Transaction receipt is null");

      // grab the factory’s ABI-interface
      const factoryInterface = factory.interface;

      // try parsing each log, ignore those that fail, then find our event
      const parsedLog = receipt.logs
        .map((log) => {
          try {
            return factoryInterface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((evt) => evt && evt.name === "VestingCreated");

      if (!parsedLog) throw new Error("VestingCreated event not found");
      const walletAddress: string = parsedLog.args.wallet;

      const vesting = (await ethers.getContractAt(
        "LinearVestingWallet",
        walletAddress,
      )) as LinearVestingWallet;
      expect(await dat.balanceOf(walletAddress)).to.equal(GRANT);

      // fast-forward half duration
      await ethers.provider.send("evm_increaseTime", [duration / 2]);
      await ethers.provider.send("evm_mine", []);

      const releasable = await vesting["releasable(address)"](dat.target);
      const halfGrant = GRANT / 2n;
      const tolerance = parseEther("0.0003"); // 0.0003 tokens
      expect(releasable >= halfGrant - tolerance).to.be.true;
      await (await vesting["release(address)"](dat.target)).wait();
      const released = await vesting["released(address)"](dat.target);
      expect(await dat.balanceOf(beneficiary.address)).to.equal(released);
    });
  });

  describe("Cliff vesting", () => {
    it("enforces a cliff in CliffVestingWallet", async () => {
      const start = Math.floor(Date.now() / 1000);
      const cliffDuration = 60 * 60 * 24 * 60; // 60 days
      const totalDuration = 60 * 60 * 24 * 180; // 180 days

      const tx = await factory
        .connect(admin)
        .createCliffVesting(
          beneficiary.address,
          GRANT,
          start,
          cliffDuration,
          totalDuration,
        );

      const receipt = await tx.wait();
      if (!receipt) throw new Error("Transaction receipt is null");

      // use the factory’s ABI to parse logs
      const factoryInterface = factory.interface;

      const parsedLog = receipt.logs
        .map((log) => {
          try {
            return factoryInterface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((evt) => evt && evt.name === "VestingCreated");

      if (!parsedLog) throw new Error("VestingCreated event not found");
      const walletAddress: string = parsedLog.args.wallet;

      const cliffWallet = (await ethers.getContractAt(
        "CliffVestingWallet",
        walletAddress,
      )) as CliffVestingWallet;

      // advance 29 days (before cliff)
      await ethers.provider.send("evm_increaseTime", [29 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);

      expect(await cliffWallet["releasable(address)"](dat.target)).to.equal(0);
      // advance past cliff (another 40 days)
      await ethers.provider.send("evm_increaseTime", [40 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine", []);

      expect(await cliffWallet["releasable(address)"](dat.target)).to.be.gt(0);
    });
  });

  describe("No-vesting grant", () => {
    it("creates a NoVestingWallet with immediate release", async () => {
      const tx = await factory
        .connect(admin)
        .createNoVesting(beneficiary.address, GRANT);

      const receipt = await tx.wait();
      if (!receipt) throw new Error("Transaction receipt is null");

      // grab the factory’s ABI
      const factoryInterface = factory.interface;

      // try parsing each log, ignore failures, find our event
      const parsedLog = receipt.logs
        .map((log) => {
          try {
            return factoryInterface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((evt) => evt && evt.name === "VestingCreated");

      if (!parsedLog) throw new Error("VestingCreated event not found");
      const walletAddress: string = parsedLog.args.wallet;

      const noVest = (await ethers.getContractAt(
        "NoVestingWallet",
        walletAddress,
      )) as NoVestingWallet;
      expect(await noVest["releasable(address)"](dat.target)).to.equal(GRANT);

      await noVest["release(address)"](dat.target);
      expect(await dat.balanceOf(beneficiary.address)).to.equal(GRANT);
    });
  });

  describe("Guard checks", () => {
    it("reverts on too-short linear duration", async () => {
      const short = 7 * 24 * 60 * 60;
      await expect(
        factory
          .connect(admin)
          .createLinearVesting(
            beneficiary.address,
            GRANT,
            Math.floor(Date.now() / 1000),
            short,
          ),
      ).to.be.revertedWithCustomError(factory, "DurationTooShort");
    });

    it("reverts when cliff ≥ total duration", async () => {
      const start = Math.floor(Date.now() / 1000);
      const cliff = 90 * 24 * 60 * 60;
      const total = 60 * 24 * 60 * 60;
      await expect(
        factory
          .connect(admin)
          .createCliffVesting(beneficiary.address, GRANT, start, cliff, total),
      ).to.be.revertedWithCustomError(factory, "CliffTooLong");
    });
  });
});
