// test/DAT.behaviour.ts
import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers } from "hardhat";
import { parseEther } from "ethers";
import { DAT } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

chai.use(chaiAsPromised);
should();

describe("DAT token (AccessControl version)", () => {
  /* signers */
  let deployer: HardhatEthersSigner;
  let owner:    HardhatEthersSigner; // DEFAULT_ADMIN_ROLE, initial admin()
  let admin:    HardhatEthersSigner; // will receive ADMIN_ROLE
  let user1:    HardhatEthersSigner;
  let user2:    HardhatEthersSigner;
  let user3:    HardhatEthersSigner;

  /* contracts */
  let dat: DAT;

  /* helpers */
  const deploy = async () => {
    [deployer, owner, admin, user1, user2, user3] = await ethers.getSigners();

    dat = await ethers.deployContract("DAT", [
      "Test Data Autonomy Token",
      "TDAT",
      owner.address,   // constructor owner → DEFAULT_ADMIN_ROLE & admin()
      0                // no cap for tests
    ]);

    // grant additional roles used in tests
    await dat.connect(owner).grantRole(await dat.ADMIN_ROLE(), admin.address);
    await dat.connect(owner).grantRole(await dat.MINTER_ROLE(), owner.address);
  };

  /* ────────────────────────────────────────────────────────── */

  describe("Basic params & roles", () => {
    beforeEach(deploy);

    it("constructor parameters & roles are correct", async () => {
      (await dat.name()).should.eq("Test Data Autonomy Token");
      (await dat.symbol()).should.eq("TDAT");
      (await dat.mintBlocked()).should.eq(false);

      // constructor makes `owner` both DEFAULT_ADMIN_ROLE and `admin()`
      (await dat.hasRole(await dat.DEFAULT_ADMIN_ROLE(), owner.address)).should.eq(true);
      (await dat.admin()).should.eq(owner.address);         // ← fixed
      // additional ADMIN_ROLE we granted
      (await dat.hasRole(await dat.ADMIN_ROLE(), admin.address)).should.eq(true);
    });
  });

  /* ────────────────────────────────────────────────────────── */

  describe("Role management (grant / revoke)", () => {
    beforeEach(deploy);

    it("owner (DEFAULT_ADMIN_ROLE) can add and remove ADMIN_ROLE", async () => {
      const ADMIN_ROLE = await dat.ADMIN_ROLE();

      // owner adds user2 as admin
      await dat.connect(owner).grantRole(ADMIN_ROLE, user2.address)
           .should.emit(dat, "RoleGranted")
           .withArgs(ADMIN_ROLE, user2.address, owner.address);

      (await dat.hasRole(ADMIN_ROLE, user2.address)).should.eq(true);

      // owner revokes admin role again
      await dat.connect(owner).revokeRole(ADMIN_ROLE, user2.address)
           .should.emit(dat, "RoleRevoked")
           .withArgs(ADMIN_ROLE, user2.address, owner.address);

      (await dat.hasRole(ADMIN_ROLE, user2.address)).should.eq(false);
    });

    it("non-admin cannot grant roles", async () => {
      const ADMIN_ROLE = await dat.ADMIN_ROLE();
      await dat.connect(user1)
               .grantRole(ADMIN_ROLE, user2.address)
               .should.be.rejectedWith("AccessControl");
    });
  });

  /* ────────────────────────────────────────────────────────── */

  describe("Mint-blocker & Minting", () => {
    beforeEach(deploy);

    it("allows minting by MINTER_ROLE", async () => {
      const amount = parseEther("100");
      await dat.connect(owner).mint(user1.address, amount).should.fulfilled;
      (await dat.balanceOf(user1.address)).should.eq(amount);
    });

    it("rejects minting by non-minter", async () => {
      await dat.connect(admin)
               .mint(user1.address, parseEther("10"))
               .should.be.rejectedWith("AccessControl");
    });

    it("irreversibly blocks minting", async () => {
      await dat.connect(owner).blockMint()
               .should.emit(dat, "MintBlocked");

      await dat.connect(owner)
               .mint(user1.address, parseEther("1"))
               .should.be.rejectedWith("EnforceMintBlocked()");
    });
  });

  /* ────────────────────────────────────────────────────────── */

  describe("Block-list transfer restrictions", () => {
    beforeEach(deploy);

    it("blocks and unblocks an address", async () => {
      const amount = parseEther("100");
      const transfer = parseEther("20");

      await dat.connect(owner).mint(user1.address, amount);

      await dat.connect(admin).blockAddress(user1.address)
           .should.emit(dat, "AddressBlocked").withArgs(user1.address);

      await dat.connect(user1)
               .transfer(user2.address, transfer)
               .should.be.rejectedWith("AccountBlocked()");

      await dat.connect(admin).unblockAddress(user1.address)
           .should.emit(dat, "AddressUnblocked").withArgs(user1.address);

      await dat.connect(user1)
               .transfer(user2.address, transfer)
               .should.emit(dat, "Transfer").withArgs(user1.address, user2.address, transfer);
    });
  });

  /* ────────────────────────────────────────────────────────── */

  /* ────────────────────────────────────────────────────────── */

  describe("Voting behaviour", () => {
    beforeEach(deploy);

    it("preserves existing votes on block, but forbids new delegation", async () => {
      const amt = parseEther("50");
      await dat.connect(owner).mint(user1.address, amt);

      // initial self-delegation → votes = amt
      await dat.connect(user1).delegate(user1.address);
      (await dat.getVotes(user1.address)).should.eq(amt);

      // block user1 → getVotes() still returns the old checkpoint
      await dat.connect(admin).blockAddress(user1.address);
      (await dat.getVotes(user1.address)).should.eq(amt);

      // but trying to delegate again now reverts
      await dat.connect(user1)
               .delegate(user1.address)
               .should.be.rejectedWith("AccountBlocked()");
    });

    it("allows re-delegation (and restores votes) after unblock", async () => {
      const amt = parseEther("50");
      await dat.connect(owner).mint(user1.address, amt);
      await dat.connect(user1).delegate(user1.address);

      // block & unblock
      await dat.connect(admin).blockAddress(user1.address);
      await dat.connect(admin).unblockAddress(user1.address);

      // now delegate again → fresh checkpoint at amt
      await dat.connect(user1).delegate(user1.address);
      (await dat.getVotes(user1.address)).should.eq(amt);
    });
  });

  
});
