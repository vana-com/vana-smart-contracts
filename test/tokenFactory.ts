import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers } from "hardhat";
import { parseEther } from "ethers";
import { DATFactory, DAT } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

chai.use(chaiAsPromised);
should();

describe("DATFactory + DAT integration", () => {
  /* ───────────────────────────────── signers ─────────────────────────────── */
  let deployer:     HardhatEthersSigner;
  let owner:        HardhatEthersSigner;
  let beneficiary1: HardhatEthersSigner;
  let beneficiary2: HardhatEthersSigner;
  let pauser:       HardhatEthersSigner;

  /* ───────────────────────────────── contracts ───────────────────────────── */
  let factory: DATFactory;

  const deployFactory = async () => {
    [deployer, owner, beneficiary1, beneficiary2, pauser] = await ethers.getSigners();
    factory = await ethers.deployContract("DATFactory");
    await factory.waitForDeployment();
  };

  /* ───────────────────────────── helper utils ────────────────────────────── */
  const latestTimestamp = async (): Promise<number> => {
    const block = await ethers.provider.getBlock("latest");
    return block!.timestamp;
  };

  const increaseTime = async (seconds: number): Promise<void> => {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []); // mine a new block so time change takes effect
  };
  
  // Aliases for latestTimestamp and increaseTime for edge case tests
  const latestTs = latestTimestamp;
  const timeTravel = increaseTime;

  /* ───────────────────────────── main behaviour ───────────────────────────── */

  describe("createToken() basic flow", () => {
    beforeEach(deployFactory);

    it("deploys an upgradeable DAT clone, mints to vesting wallets, and sets roles", async () => {
      /* ───── parameters ───── */
      const name   = "Clone Data Token";
      const symbol = "CDAT";
      const cap    = parseEther("1000000");

      /* vesting schedule: two beneficiaries */
      const now    = await latestTimestamp();

      const start       = now + 100;                  // token generation event in 100 s
      const cliff       = 60 * 60 * 24 * 30;          // 30 days (in seconds)
      const durationSec = 60 * 60 * 24 * 365;         // 1 year
      const end         = start + cliff + durationSec; // final unlock

      const amount1 = parseEther("100000");
      const amount2 = parseEther("200000");

      const schedules = [
        {
          beneficiary: beneficiary1.address,
          start,
          end,
          cliff,
          amount: amount1,
        },
        {
          beneficiary: beneficiary2.address,
          start,
          end,
          cliff,
          amount: amount2,
        },
      ];

      /* ───── call createToken() ───── */
      const tx = await factory
        .connect(deployer)
        .createToken(name, symbol, owner.address, cap, schedules, ethers.ZeroHash);

      const receipt = await tx.wait() as any;

      /* ───── extract clone address from the DATCreated event ───── */
      const datCreatedEvent = receipt.logs.find(
        (l: any) =>
          l.fragment?.name === "DATCreated" &&
          String(l.address).toLowerCase() === String(factory.target).toLowerCase()
      );

      if (!datCreatedEvent) throw new Error("DATCreated event not found");

      const tokenAddr = datCreatedEvent.args.token as string;

      /* ───── attach to clone and basic assertions ───── */
      const clone = (await ethers.getContractAt("DAT", tokenAddr)) as DAT;

      await clone.waitForDeployment();

      (await clone.name()).should.eq(name);
      (await clone.symbol()).should.eq(symbol);
      (await clone.cap()).should.eq(cap);
      (await clone.totalSupply()).should.eq(amount1 + amount2);

      /* clone roles: owner should own every role */
      (await clone.hasRole(await clone.DEFAULT_ADMIN_ROLE(), owner.address)).should.eq(true);
      (await clone.hasRole(await clone.ADMIN_ROLE(), owner.address)).should.eq(true);
      (await clone.hasRole(await clone.MINTER_ROLE(), owner.address)).should.eq(true);

      /* ───── gather vesting wallet addresses from Transfer events ───── */
      const transfers = (await clone.queryFilter(clone.filters.Transfer(undefined, undefined), receipt.blockNumber, receipt.blockNumber)).filter((ev) => ev.args.from === ethers.ZeroAddress);

      transfers.length.should.eq(2, "exactly two mint transfers expected");

      const wallet1Addr = transfers[0].args.to;
      const wallet2Addr = transfers[1].args.to;

      /* minted balances */
      (await clone.balanceOf(wallet1Addr)).should.eq(amount1);
      (await clone.balanceOf(wallet2Addr)).should.eq(amount2);

      /* verify VestingWallet parameters for wallet1 */
      const wallet1 = await ethers.getContractAt("VestingWallet", wallet1Addr) as any;
      (await wallet1.owner()).should.eq(beneficiary1.address);
      (await wallet1.start()).should.eq(start + cliff); // the factory adds the cliff to start

      const expectedDuration = end <= start + cliff ? 1 : end - (start + cliff);
      (await wallet1.duration()).should.eq(expectedDuration);

      /* ───── simulate full vesting & release ───── */
      await increaseTime(expectedDuration + cliff + 200); // jump past full vesting period

      // before release: beneficiary has no tokens
      (await clone.balanceOf(beneficiary1.address)).should.eq(0n);

      // release complete amount
      await wallet1.connect(beneficiary1)["release(address)"](tokenAddr);

      (await clone.balanceOf(beneficiary1.address)).should.eq(amount1);
      (await clone.balanceOf(wallet1Addr)).should.eq(0n);
    });
  });

  /* ───────────────────────── deterministic deployment ─────────────────────── */
  describe("createToken() with deterministic salt", () => {
    beforeEach(deployFactory);

    it("predicts deterministic clone address correctly", async () => {
      const salt = ethers.id("DATA_TOKEN_SALT"); // bytes32 salt

      const predicted = await factory.predictAddress(salt);

      /* minimal schedule (no vesting wallets) */
      const tx = await factory
        .connect(deployer)
        .createToken("Deterministic", "DDAT", owner.address, 0, [], salt);

      const receipt = await tx.wait() as any;
      const evt     = receipt.logs.find((l: any) => l.fragment?.name === "DATCreated")!;
      const actual  = evt.args.token as string;

      actual.toLowerCase().should.eq(predicted.toLowerCase());
    });
  });

  /* ─────────────────────── initializer protection ─────────────────────────── */
  describe("clone initialise() cannot be called twice", () => {
    beforeEach(deployFactory);

    it("reverts on second initialise() call", async () => {
      const tx = await factory
        .connect(deployer)
        .createToken("OneShot", "SHOT", owner.address, 0, [], ethers.ZeroHash);
      const receipt = await tx.wait() as any;
      const cloneAddr = receipt.logs.find((l: any) => l.fragment?.name === "DATCreated")!.args.token as string;

      const clone = (await ethers.getContractAt("DAT", cloneAddr)) as DAT;

      /* second call should revert with Initializable guard */
      await clone
        .initialize("Again", "AGAIN", owner.address, 0, [], [])
        .should.be.rejectedWith("InvalidInitialization()");
    });
  });

  /* ───────────────────────────── Cap validation ──────────────────────────── */
  describe("Cap validation", () => {
    beforeEach(deployFactory);

    it("reverts when cap == 1 (CapTooLow)", async () => {
      const schedules: DATFactory.VestingParamsStruct[] = [];
      await factory
        .createToken("Fail", "FAIL", owner.address, 1, schedules, ethers.ZeroHash)
        .should.be.rejectedWith("CapTooLow()");
    });

    it("reverts when total mint exceeds cap", async () => {
      const amount = parseEther("100");
      const cap    = parseEther("50"); // lower than amount

      const now  = await latestTs();
      const start = now + 10;
      const cliff = 0;
      const end   = start + 1000;

      const schedules: DATFactory.VestingParamsStruct[] = [
        { beneficiary: beneficiary1.address, start, end, cliff, amount },
      ];

      await factory
        .createToken("Over", "OVR", owner.address, cap, schedules, ethers.ZeroHash)
        .should.be.rejectedWith("ERC20ExceededCap");
    });
  });

  /* ─────────────────────── Vesting schedule edge‑cases ────────────────────── */
  describe("Vesting schedule edge‑cases", () => {
    beforeEach(deployFactory);

    it("pure‑cliff schedule unlocks entire amount immediately after cliff", async () => {
      const now     = await latestTs();
      const start   = now + 30; // 30s ahead
      const cliff   = 60;       // 1 min
      const end     = start + cliff; // == start + cliff ⇒ duration = 1 per factory logic
      const amount  = parseEther("1000");

      const schedules: DATFactory.VestingParamsStruct[] = [
        { beneficiary: beneficiary1.address, start, end, cliff, amount },
      ];

      const tx = await factory.createToken("Cliff", "CLF", owner.address, 0, schedules, ethers.ZeroHash);
      const receipt: any = await tx.wait();
      const cloneAddr = receipt.logs.find((l: any) => l.fragment?.name === "DATCreated")!.args.token;
      const clone = (await ethers.getContractAt("DAT", cloneAddr)) as DAT;

      // get vesting wallet address from first mint Transfer event
      const ev = (await clone.queryFilter(clone.filters.Transfer(undefined, undefined), receipt.blockNumber, receipt.blockNumber))[0];
      const walletAddr = ev.args.to;
      const wallet = await ethers.getContractAt("VestingWallet", walletAddr) as any;

      (await wallet.duration()).should.eq(1n);

      // fast‑forward beyond cliff
      await timeTravel(end + 5);

      await wallet.connect(beneficiary1)["release(address)"](cloneAddr);
      (await clone.balanceOf(beneficiary1.address)).should.eq(amount);
    });

    it("zero‑cliff schedule works (start == wallet.start)", async () => {
      const now    = await latestTs();
      const start  = now + 10;
      const cliff  = 0;
      const end    = start + 300; // 5 min vesting
      const amount = parseEther("200");

      const schedules: DATFactory.VestingParamsStruct[] = [
        { beneficiary: beneficiary1.address, start, end, cliff, amount },
      ];

      const tx = await factory.createToken("ZeroCliff", "ZCF", owner.address, 0, schedules, ethers.ZeroHash);
      const receipt: any = await tx.wait();
      const cloneAddr = receipt.logs.find((l: any) => l.fragment?.name === "DATCreated")!.args.token;
      const clone     = (await ethers.getContractAt("DAT", cloneAddr)) as DAT;
      const ev        = (await clone.queryFilter(clone.filters.Transfer(undefined, undefined), receipt.blockNumber, receipt.blockNumber))[0];
      const wallet    = await ethers.getContractAt("VestingWallet", ev.args.to) as any;

      (await wallet.start()).should.eq(start);
      (await wallet.duration()).should.eq(end - start);
    });
  });

  /* ────────────────────────────── Pause / unpause ───────────────────────────── */
  describe("Pause / unpause", () => {
    let token: DAT;

    beforeEach(async function() {
      await deployFactory();
      // simple token (no vesting) for transfer tests
      const tx = await factory.createToken("PauseToken", "PST", owner.address, 0, [], ethers.ZeroHash);
      const receipt: any = await tx.wait();
      const cloneAddr = receipt.logs.find((l: any) => l.fragment?.name === "DATCreated")!.args.token;
      token = (await ethers.getContractAt("DAT", cloneAddr)) as DAT;
    });

    it("pauser role can pause and unpause transfers", async function() {
      // grant PAUSER_ROLE to pauser
      await token.connect(owner).grantRole(await token.PAUSER_ROLE(), pauser.address);

      // mint some supply to owner for transfer tests
      await token.connect(owner).mint(owner.address, parseEther("10"));

      // pause
      await token.connect(pauser).pause();

      await token
        .connect(owner)
        .transfer(beneficiary1.address, parseEther("1"))
        .should.be.rejectedWith("EnforcedPause");

      // unpause and transfer succeeds
      await token.connect(pauser).unpause();
      await token
        .connect(owner)
        .transfer(beneficiary1.address, parseEther("1"))
        .should.emit(token, "Transfer").withArgs(owner.address, beneficiary1.address, parseEther("1"));
    });

    it("non‑pauser cannot pause", async function() {
      await token.connect(beneficiary1).pause().should.be.rejectedWith("AccessControl");
    });
  });

  /* ────────────────────────── Role revocation effect ───────────────────────── */
  describe("Role revocation effect", () => {
    let token: DAT;

    beforeEach(async function() {
      await deployFactory();
      const tx = await factory.createToken("Roles", "ROL", owner.address, 0, [], ethers.ZeroHash);
      const rc: any = await tx.wait();
      const cloneAddr = rc.logs.find((l: any) => l.fragment?.name === "DATCreated")!.args.token;
      token = (await ethers.getContractAt("DAT", cloneAddr)) as DAT;
    });

    it("MINTER_ROLE revoked ⇒ cannot mint", async function() {
      const MINTER = await token.MINTER_ROLE();
      await token.connect(owner).grantRole(MINTER, pauser.address); // give pauser minter
      await token.connect(owner).revokeRole(MINTER, pauser.address);

      await token.connect(pauser).mint(beneficiary1.address, parseEther("1"))
           .should.be.rejectedWith("AccessControl");
    });
  });
});
