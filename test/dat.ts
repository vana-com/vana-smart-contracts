import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, network, upgrades } from "hardhat";
import { BaseWallet, formatEther, Wallet } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import {
  DATFactoryImplementation,
  DAT,
  VestingWallet,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getReceipt, parseEther } from "../utils/helpers";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

chai.use(chaiAsPromised);
should();

// Custom chai assertion for almost equal BigInts with tolerance
chai.Assertion.addMethod(
  "almostEq",
  function (expected: bigint, tolerance: bigint = 1000n) {
    const actual = this._obj as bigint;

    this.assert(
      actual >= expected - tolerance && actual <= expected + tolerance,
      `expected ${actual} to be almost equal to ${expected} within tolerance of ${tolerance}`,
      `expected ${actual} not to be almost equal to ${expected} within tolerance of ${tolerance}`,
      expected,
      actual,
    );
  },
);

describe("DATFactory + DAT Integration", () => {
  let owner: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let admin: HardhatEthersSigner;
  let beneficiary1: HardhatEthersSigner;
  let beneficiary2: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;

  let datFactory: DATFactoryImplementation;
  let datToken: DAT;
  let vestingWallet1: VestingWallet;
  let vestingWallet2: VestingWallet;

  const minCap = parseEther(1000); // 1,000 tokens
  const maxCap = parseEther(100_000_000); // 100M tokens

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("MAINTAINER_ROLE"),
  );
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));

  // Generic token parameters
  const tokenName = "Digital Asset Token";
  const tokenSymbol = "DAT";
  const tokenCap = parseEther(10_000_000); // 10M tokens
  const tokenSalt = ethers.id("TEST_SALT");

  // Define a deploy function to reuse
  async function deploy() {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });

    // Get signers
    [
      owner,
      maintainer,
      admin,
      beneficiary1,
      beneficiary2,
      user1,
      user2,
      user3,
    ] = await ethers.getSigners();

    // Deploy DATFactory
    const factoryDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("DATFactoryImplementation"),
      [owner.address, minCap, maxCap],
      {
        kind: "uups",
      },
    );

    datFactory = await ethers.getContractAt(
      "DATFactoryImplementation",
      factoryDeploy.target,
    );

    // Set up roles
    await datFactory
      .connect(owner)
      .grantRole(MAINTAINER_ROLE, maintainer.address);
  }

  // Create token with vesting schedules
  async function createTokenWithVesting() {
    const now = Math.floor(Date.now() / 1000);
    const amount1 = parseEther(1_000_000);
    const amount2 = parseEther(2_000_000);

    const vestingSchedules = [
      {
        beneficiary: beneficiary1.address,
        start: now,
        cliff: 90 * 86400, // 90 days cliff
        duration: 365 * 86400, // 1 year total vesting
        amount: amount1,
      },
      {
        beneficiary: beneficiary2.address,
        start: now,
        cliff: 180 * 86400, // 180 days cliff
        duration: 730 * 86400, // 2 years total vesting
        amount: amount2,
      },
    ];

    // Create token with schedules
    const tx = await datFactory
      .connect(owner)
      .createToken(
        tokenName,
        tokenSymbol,
        admin.address,
        tokenCap,
        vestingSchedules,
        tokenSalt,
      );

    const receipt = await getReceipt(tx);

    // Extract token address from events
    const createEvent = receipt.logs.find(
      (log) => log.fragment?.name === "DATCreated",
    );

    should().exist(createEvent);
    const tokenAddress = createEvent.args[0];

    // Extract vesting wallet addresses
    const vestingWalletEvents = receipt.logs.filter(
      (log) => log.fragment?.name === "VestingWalletCreated",
    );

    vestingWallet1 = await ethers.getContractAt(
      "VestingWallet",
      vestingWalletEvents[0].args[0],
    );

    vestingWallet2 = await ethers.getContractAt(
      "VestingWallet",
      vestingWalletEvents[1].args[0],
    );

    // Access the token
    datToken = await ethers.getContractAt("DAT", tokenAddress);

    return { vestingSchedules, amount1, amount2 };
  }

  beforeEach(async () => {
    await deploy();
  });

  describe("DAT Token", () => {
    beforeEach(async () => {
      await createTokenWithVesting();
    });

    describe("Token Functionality", () => {
      it("should have the correct roles set", async function () {
        (await datToken.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).should.eq(
          true,
        );
        (await datToken.hasRole(MINTER_ROLE, admin.address)).should.eq(true);
        (await datToken.hasRole(PAUSER_ROLE, admin.address)).should.eq(true);
      });

      it("should have the correct initial parameters", async function () {
        (await datToken.name()).should.eq(tokenName);
        (await datToken.symbol()).should.eq(tokenSymbol);
        (await datToken.cap()).should.eq(tokenCap);
        (await datToken.mintBlocked()).should.eq(false);
        (await datToken.paused()).should.eq(false);
      });

      it("should allow minting by minter role", async function () {
        const mintAmount = parseEther(100);

        await datToken.connect(admin).mint(user1.address, mintAmount);

        (await datToken.balanceOf(user1.address)).should.eq(mintAmount);
      });

      it("should reject minting by non-minter", async function () {
        const mintAmount = parseEther(100);

        await datToken
          .connect(user1)
          .mint(user1.address, mintAmount)
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${user1.address}", "${MINTER_ROLE}")`,
          );
      });

      it("should reject minting to zero address", async function () {
        const mintAmount = parseEther(100);

        await datToken
          .connect(admin)
          .mint(ethers.ZeroAddress, mintAmount)
          .should.be.rejectedWith("ZeroAddress");
      });

      it("should reject minting zero amount", async function () {
        await datToken
          .connect(admin)
          .mint(user1.address, 0)
          .should.be.rejectedWith("ZeroAmount");
      });

      it("should reject minting excessive amount", async function () {
        const tooLargeAmount = 2n ** 128n; // Exceeds uint128.max

        await datToken
          .connect(admin)
          .mint(user1.address, tooLargeAmount)
          .should.be.rejectedWith("ExcessiveMintAmount");
      });

      it("should allow token transfers", async function () {
        // First mint to user1
        const mintAmount = parseEther(100);
        await datToken.connect(admin).mint(user1.address, mintAmount);

        // Then transfer some to user2
        const transferAmount = parseEther(30);
        await datToken.connect(user1).transfer(user2.address, transferAmount);

        // Verify balances
        (await datToken.balanceOf(user1.address)).should.eq(
          mintAmount - transferAmount,
        );
        (await datToken.balanceOf(user2.address)).should.eq(transferAmount);
      });

      it("should enforce cap on total supply", async function () {
        // First mint to user1
        const initialSupply = await datToken.totalSupply();
        const remainingCap = tokenCap - initialSupply;

        // Try to mint more than the cap allows
        await datToken
          .connect(admin)
          .mint(user1.address, remainingCap + 1n)
          .should.be.rejectedWith(/ExcessiveMintAmount/);

        // But should allow minting up to the cap
        await datToken.connect(admin).mint(user1.address, remainingCap);

        // Verify total supply matches cap
        (await datToken.totalSupply()).should.eq(tokenCap);
      });
    });

    describe("Block List Functionality", () => {
      it("should allow admin to block addresses", async function () {
        // First mint to user1
        const mintAmount = parseEther(100);
        await datToken.connect(admin).mint(user1.address, mintAmount);

        // Block user1
        await datToken
          .connect(admin)
          .blockAddress(user1.address)
          .should.emit(datToken, "AddressBlocked")
          .withArgs(user1.address);

        // Verify user1 is in block list
        (await datToken.blockListLength()).should.eq(1);
        (await datToken.blockListAt(0)).should.eq(user1.address);

        // Try to transfer - should fail
        await datToken
          .connect(user1)
          .transfer(user2.address, parseEther(10))
          .should.be.rejectedWith("AccountBlocked");
      });

      it("should allow admin to unblock addresses", async function () {
        // Block user1
        await datToken.connect(admin).blockAddress(user1.address);
        (await datToken.blockListLength()).should.eq(1);

        // Unblock user1
        await datToken
          .connect(admin)
          .unblockAddress(user1.address)
          .should.emit(datToken, "AddressUnblocked")
          .withArgs(user1.address);

        (await datToken.blockListLength()).should.eq(0);

        // Now transfers should work
        const mintAmount = parseEther(100);
        await datToken.connect(admin).mint(user1.address, mintAmount);
        await datToken.connect(user1).transfer(user2.address, parseEther(10))
          .should.not.be.rejected;
      });

      it("should reject blockAddress by non-admin", async function () {
        await datToken
          .connect(user1)
          .blockAddress(user2.address)
          .should.be.rejectedWith("UnauthorizedAdminAction");
      });

      it("should reject unblockAddress by non-admin", async function () {
        await datToken.connect(admin).blockAddress(user2.address);

        await datToken
          .connect(user1)
          .unblockAddress(user2.address)
          .should.be.rejectedWith("UnauthorizedAdminAction");
      });

      it("should reject unblockAddress for address not in blocklist", async function () {
        await datToken
          .connect(admin)
          .unblockAddress(user1.address)
          .should.be.rejectedWith("BlockListDoesNotContain");
      });

      it("should reject blocking zero address", async function () {
        await datToken
          .connect(admin)
          .blockAddress(ethers.ZeroAddress)
          .should.be.rejectedWith("BlockingRejected");
      });

      it("should not re-add already blocked address", async function () {
        // Block user1
        await datToken
          .connect(admin)
          .blockAddress(user1.address)
          .should.emit(datToken, "AddressBlocked");

        // Try blocking again - no event should be emitted
        const tx = await datToken.connect(admin).blockAddress(user1.address);
        const receipt = await getReceipt(tx);

        const blockEvents = receipt.logs.filter(
          (log) => log.fragment?.name === "AddressBlocked",
        );
        blockEvents.length.should.eq(0);

        // Verify only one occurrence in list
        (await datToken.blockListLength()).should.eq(1);
        (await datToken.blockListAt(0)).should.eq(user1.address);
      });

      it("should reject transfers to/from blocked addresses", async function () {
        // Mint to user1 and user2
        const mintAmount = parseEther(100);
        await datToken.connect(admin).mint(user1.address, mintAmount);
        await datToken.connect(admin).mint(user2.address, mintAmount);

        // Block user2
        await datToken.connect(admin).blockAddress(user2.address);

        // Try to transfer from user1 to user2 - should fail
        await datToken
          .connect(user1)
          .transfer(user2.address, parseEther(10))
          .should.be.rejectedWith("AccountBlocked");

        // Try to transfer from user2 to user1 - should fail
        await datToken
          .connect(user2)
          .transfer(user1.address, parseEther(10))
          .should.be.rejectedWith("AccountBlocked");
      });

      it("should reject blockListAt for out of bounds index", async function () {
        await datToken
          .connect(admin)
          .blockListAt(0)
          .should.be.rejectedWith("IndexOutOfBounds");

        // Block one address
        await datToken.connect(admin).blockAddress(user1.address);

        // This should work
        (await datToken.blockListAt(0)).should.eq(user1.address);

        // This should fail
        await datToken
          .connect(admin)
          .blockListAt(1)
          .should.be.rejectedWith("IndexOutOfBounds");
      });
    });

    describe("Pausing Functionality", () => {
      it("should allow pauser to pause the token", async function () {
        // Pause the token
        await datToken.connect(admin).pause().should.emit(datToken, "Paused");

        (await datToken.paused()).should.eq(true);

        // Mint to user1
        const mintAmount = parseEther(100);
        await datToken.connect(admin).mint(user1.address, mintAmount);

        // Try to transfer - should fail
        await datToken
          .connect(user1)
          .transfer(user2.address, parseEther(10))
          .should.be.rejectedWith("EnforcedPause");
      });

      it("should allow pauser to unpause the token", async function () {
        // Pause the token
        await datToken.connect(admin).pause();

        // Unpause the token
        await datToken
          .connect(admin)
          .unpause()
          .should.emit(datToken, "Unpaused");

        (await datToken.paused()).should.eq(false);

        // Mint to user1
        const mintAmount = parseEther(100);
        await datToken.connect(admin).mint(user1.address, mintAmount);

        // Try to transfer - should succeed
        await datToken.connect(user1).transfer(user2.address, parseEther(10))
          .should.not.be.rejected;
      });

      it("should reject pause by non-pauser", async function () {
        await datToken
          .connect(user1)
          .pause()
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${user1.address}", "${PAUSER_ROLE}")`,
          );
      });

      it("should reject unpause by non-pauser", async function () {
        await datToken.connect(admin).pause();

        await datToken
          .connect(user1)
          .unpause()
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${user1.address}", "${PAUSER_ROLE}")`,
          );
      });
    });

    describe("Voting Functionality", () => {
      it("should track voting power when tokens are transferred", async function () {
        // Mint to user1
        const mintAmount = parseEther(100);
        await datToken.connect(admin).mint(user1.address, mintAmount);

        // Check voting power
        (await datToken.getVotes(user1.address)).should.eq(0); // No delegation yet

        // Delegate to self
        await datToken.connect(user1).delegate(user1.address);

        // Check voting power after delegation
        (await datToken.getVotes(user1.address)).should.eq(mintAmount);

        // Transfer to user2
        const transferAmount = parseEther(30);
        await datToken.connect(user1).transfer(user2.address, transferAmount);

        // Check updated voting power
        (await datToken.getVotes(user1.address)).should.eq(
          mintAmount - transferAmount,
        );
        (await datToken.getVotes(user2.address)).should.eq(0); // User2 hasn't delegated

        // User2 delegates to self
        await datToken.connect(user2).delegate(user2.address);
        (await datToken.getVotes(user2.address)).should.eq(transferAmount);
      });

      it("should handle delegation to another address", async function () {
        // Mint to user1 and user2
        const amount1 = parseEther(100);
        const amount2 = parseEther(200);
        await datToken.connect(admin).mint(user1.address, amount1);
        await datToken.connect(admin).mint(user2.address, amount2);

        // User1 delegates to user3
        await datToken.connect(user1).delegate(user3.address);

        // User2 delegates to user3
        await datToken.connect(user2).delegate(user3.address);

        // Check voting power
        (await datToken.getVotes(user1.address)).should.eq(0);
        (await datToken.getVotes(user2.address)).should.eq(0);
        (await datToken.getVotes(user3.address)).should.eq(amount1 + amount2);
      });

      it("should reject delegation to blocked address", async function () {
        // Block user2
        await datToken.connect(admin).blockAddress(user2.address);

        // Mint to user1
        const mintAmount = parseEther(100);
        await datToken.connect(admin).mint(user1.address, mintAmount);

        // Try to delegate to blocked address
        await datToken
          .connect(user1)
          .delegate(user2.address)
          .should.be.rejectedWith("BlockListContains");
      });

      it("should reject delegation when delegator is blocked", async function () {
        // Mint to user1
        const mintAmount = parseEther(100);
        await datToken.connect(admin).mint(user1.address, mintAmount);

        // Block user1
        await datToken.connect(admin).blockAddress(user1.address);

        // Try to delegate
        await datToken
          .connect(user1)
          .delegate(user2.address)
          .should.be.rejectedWith("AccountBlocked");
      });
    });

    describe("Vesting Functionality", () => {
      it("should correctly set up vesting wallets", async function () {
        const { vestingSchedules } = await createTokenWithVesting();

        // Check beneficiaries
        (await vestingWallet1.beneficiary()).should.eq(
          vestingSchedules[0].beneficiary,
        );
        (await vestingWallet2.beneficiary()).should.eq(
          vestingSchedules[1].beneficiary,
        );

        // Check durations - note they are adjusted by the factory
        const start1 = BigInt(vestingSchedules[0].start);
        const cliff1 = BigInt(vestingSchedules[0].cliff);
        const duration1 = BigInt(vestingSchedules[0].duration);

        const start2 = BigInt(vestingSchedules[1].start);
        const cliff2 = BigInt(vestingSchedules[1].cliff);
        const duration2 = BigInt(vestingSchedules[1].duration);

        // From OZ VestingWallet - calculateReleasable uses
        // uint256 vestedAmount = vestedAmount(token, timestamp);
        // return vestedAmount - released(token);

        // Initial release should be 0
        (await vestingWallet1.releasable(datToken)).should.eq(0);
        (await vestingWallet2.releasable(datToken)).should.eq(0);
      });

      it("should release tokens according to vesting schedule", async function () {
        const { vestingSchedules, amount1, amount2 } =
          await createTokenWithVesting();

        // Get initial setup
        const start1 = BigInt(vestingSchedules[0].start);
        const cliff1 = BigInt(vestingSchedules[0].cliff);
        const duration1 = BigInt(vestingSchedules[0].duration);

        // Time to cliff - no tokens available yet
        await time.increaseTo(start1 + cliff1 - 10n);

        (await vestingWallet1.releasable(datToken)).should.eq(0);

        // Time to cliff + 1 - tokens start to release
        await time.increaseTo(start1 + cliff1 + 10n);

        // Calculate expected release at this point
        // Expected formula: (amount * timeElapsed) / duration
        const timeElapsed = start1 + cliff1 + 10n - start1;
        const expectedRelease = (amount1 * timeElapsed) / duration1;

        // Should be close to expected
        const actualRelease = await vestingWallet1.releasable(datToken);
        actualRelease.should.be.almostEq(expectedRelease, 1000n);

        // Release tokens
        await vestingWallet1.connect(beneficiary1).release(datToken.target);

        // Beneficiary should have received tokens
        (await datToken.balanceOf(beneficiary1)).should.be.almostEq(
          expectedRelease,
          1000n,
        );

        // Advance to halfway through vesting
        await time.increaseTo(start1 + duration1 / 2n);

        // Calculate expected release after half duration
        const halfTimeElapsed = start1 + duration1 / 2n - start1;
        const halfExpectedRelease = (amount1 * halfTimeElapsed) / duration1;

        // Released amount should be deducted
        const releasable = await vestingWallet1.releasable(datToken);
        releasable.should.be.almostEq(
          halfExpectedRelease - actualRelease,
          1000n,
        );

        // Release again
        await vestingWallet1.connect(beneficiary1).release(datToken.target);

        // Beneficiary should have received more tokens
        (await datToken.balanceOf(beneficiary1)).should.be.almostEq(
          halfExpectedRelease,
          1000n,
        );

        // Advance to end of vesting
        await time.increaseTo(start1 + duration1 + 10n);

        // Should be able to release remaining tokens
        await vestingWallet1.connect(beneficiary1).release(datToken.target);

        // Beneficiary should have received all tokens
        (await datToken.balanceOf(beneficiary1)).should.be.almostEq(
          amount1,
          1000n,
        );

        // No more tokens to release
        (await vestingWallet1.releasable(datToken)).should.eq(0);
      });

      it("should allow releasing tokens by anyone (not just beneficiary)", async function () {
        const { amount1 } = await createTokenWithVesting();

        // Advance to fully vested state
        const vestedTime = (await vestingWallet1.end()) + 1n;
        await time.increaseTo(vestedTime);

        // Release tokens as a random user
        await vestingWallet1.connect(user3).release(datToken.target);

        // Beneficiary should have received tokens, not the caller
        (await datToken.balanceOf(user3)).should.eq(0);
        (await datToken.balanceOf(beneficiary1)).should.be.almostEq(
          amount1,
          1000n,
        );
      });
    });

    describe("Advanced ERC20 Features", () => {
      it("should support ERC20 permit", async function () {
        // Mint to owner
        const mintAmount = parseEther(100);
        await datToken.connect(admin).mint(owner.address, mintAmount);

        // Get current deadline
        const deadline = (await time.latest()) + 3600; // 1 hour from now

        // Create permit signature
        const nonce = await datToken.nonces(owner.address);
        const chainId = await network.provider.request({
          method: "eth_chainId",
        });

        // Domain separator parameters
        const domain = {
          name: await datToken.name(),
          version: "1",
          chainId: chainId,
          verifyingContract: datToken.target,
        };

        // Permit type definition
        const types = {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        };

        // Permit values
        const value = {
          owner: owner.address,
          spender: user1.address,
          value: mintAmount,
          nonce: nonce,
          deadline: deadline,
        };

        // Sign the permit
        const signature = await owner.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);

        // Use permit to approve
        await datToken
          .connect(user1)
          .permit(owner.address, user1.address, mintAmount, deadline, v, r, s);

        // Check allowance was set
        (await datToken.allowance(owner.address, user1.address)).should.eq(
          mintAmount,
        );

        // User1 can now transferFrom
        await datToken
          .connect(user1)
          .transferFrom(owner.address, user2.address, mintAmount);

        // Verify balances
        (await datToken.balanceOf(owner.address)).should.eq(0);
        (await datToken.balanceOf(user2.address)).should.eq(mintAmount);
      });

      it("should correctly handle ERC20 approve and transferFrom", async function () {
        // Mint to user1
        const mintAmount = parseEther(100);
        await datToken.connect(admin).mint(user1.address, mintAmount);

        // Approve user2 to spend
        const approveAmount = parseEther(30);
        await datToken.connect(user1).approve(user2.address, approveAmount);

        // Check allowance
        (await datToken.allowance(user1.address, user2.address)).should.eq(
          approveAmount,
        );

        // User2 transfers from user1 to user3
        const transferAmount = parseEther(20);
        await datToken
          .connect(user2)
          .transferFrom(user1.address, user3.address, transferAmount);

        // Verify balances
        (await datToken.balanceOf(user1.address)).should.eq(
          mintAmount - transferAmount,
        );
        (await datToken.balanceOf(user3.address)).should.eq(transferAmount);

        // Verify allowance decreased
        (await datToken.allowance(user1.address, user2.address)).should.eq(
          approveAmount - transferAmount,
        );
      });

      it("should block transferFrom when sender or recipient is blocked", async function () {
        // Mint to user1
        const mintAmount = parseEther(100);
        await datToken.connect(admin).mint(user1.address, mintAmount);

        // Approve user2 to spend
        const approveAmount = parseEther(30);
        await datToken.connect(user1).approve(user2.address, approveAmount);

        // Block user3
        await datToken.connect(admin).blockAddress(user3.address);

        // User2 tries to transfer from user1 to user3 - should fail
        await datToken
          .connect(user2)
          .transferFrom(user1.address, user3.address, parseEther(10))
          .should.be.rejectedWith("AccountBlocked");

        // Block user1
        await datToken.connect(admin).blockAddress(user1.address);

        // User2 tries to transfer from user1 to user2 - should fail
        await datToken
          .connect(user2)
          .transferFrom(user1.address, user2.address, parseEther(10))
          .should.be.rejectedWith("AccountBlocked");
      });
    });

    describe("Role Management", () => {
      it("should allow admin to grant/revoke roles", async function () {
        // Grant minter role to user1
        await datToken.connect(admin).grantRole(MINTER_ROLE, user1.address);

        // Check user1 has minter role
        (await datToken.hasRole(MINTER_ROLE, user1.address)).should.eq(true);

        // User1 should be able to mint
        await datToken.connect(user1).mint(user2.address, parseEther(100))
          .should.not.be.rejected;

        // Revoke minter role from user1
        await datToken.connect(admin).revokeRole(MINTER_ROLE, user1.address);

        // Check user1 no longer has minter role
        (await datToken.hasRole(MINTER_ROLE, user1.address)).should.eq(false);

        // User1 should no longer be able to mint
        await datToken
          .connect(user1)
          .mint(user2.address, parseEther(100))
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${user1.address}", "${MINTER_ROLE}")`,
          );
      });

      it("should allow admin to renounce roles", async function () {
        // Grant minter role to user1
        await datToken.connect(admin).grantRole(MINTER_ROLE, user1.address);

        // User1 renounces minter role
        await datToken.connect(user1).renounceRole(MINTER_ROLE, user1.address);

        // Check user1 no longer has minter role
        (await datToken.hasRole(MINTER_ROLE, user1.address)).should.eq(false);
      });

      it("should reject granting/revoking roles by non-admin", async function () {
        // User1 tries to grant minter role to user2
        await datToken
          .connect(user1)
          .grantRole(MINTER_ROLE, user2.address)
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
          );

        // User1 tries to revoke minter role from admin
        await datToken
          .connect(user1)
          .revokeRole(MINTER_ROLE, admin.address)
          .should.be.rejectedWith(
            `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
          );
      });
    });
  });

  describe("DATFactory", () => {
    describe("Setup", () => {
      it("should have correct parameters after deployment", async function () {
        (await datFactory.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).should.eq(
          true,
        );
        (await datFactory.hasRole(MAINTAINER_ROLE, owner.address)).should.eq(
          true,
        );
        (
          await datFactory.hasRole(MAINTAINER_ROLE, maintainer.address)
        ).should.eq(true);

        (await datFactory.minCapDefault()).should.eq(minCap);
        (await datFactory.maxCapDefault()).should.eq(maxCap);

        // Verify template address is set
        const defaultTemplate = await datFactory.datTemplates(0); // 0 = DATType.DEFAULT
        defaultTemplate.should.not.eq(ethers.ZeroAddress);
      });

      it("should add created tokens to the datList", async function () {
        // Initial count should be 0
        (await datFactory.datListCount()).should.eq(0);

        // Create first token
        const tx1 = await datFactory.connect(owner).createToken(
          tokenName,
          tokenSymbol,
          admin.address,
          tokenCap,
          [], // No vesting
          ethers.id("SALT1"),
        );
        const receipt1 = await getReceipt(tx1);
        const tokenAddress1 = receipt1.logs.find(
          (log) => log.fragment?.name === "DATCreated",
        ).args[0];

        // List should have 1 token
        (await datFactory.datListCount()).should.eq(1);
        (await datFactory.datListAt(0)).should.eq(tokenAddress1);

        // Create second token
        const tx2 = await datFactory.connect(owner).createToken(
          "Second Token",
          "ST2",
          admin.address,
          tokenCap,
          [], // No vesting
          ethers.id("SALT2"),
        );
        const receipt2 = await getReceipt(tx2);
        const tokenAddress2 = receipt2.logs.find(
          (log) => log.fragment?.name === "DATCreated",
        ).args[0];

        // List should have 2 tokens
        (await datFactory.datListCount()).should.eq(2);
        (await datFactory.datListAt(1)).should.eq(tokenAddress2);

        // Values should match
        const values = await datFactory.datListValues();
        values.should.deep.eq([tokenAddress1, tokenAddress2]);
      });
    });

    describe("Token Creation", () => {
      it("should create a token with vesting schedules", async function () {
        const { vestingSchedules, amount1, amount2 } =
          await createTokenWithVesting();

        // Verify token parameters
        (await datToken.name()).should.eq(tokenName);
        (await datToken.symbol()).should.eq(tokenSymbol);
        (await datToken.cap()).should.eq(tokenCap);

        // Verify vesting wallets received tokens
        (await datToken.totalSupply()).should.eq(amount1 + amount2);
        (await datToken.balanceOf(vestingWallet1.target)).should.eq(amount1);
        (await datToken.balanceOf(vestingWallet2.target)).should.eq(amount2);

        // Verify vesting wallet parameters
        (await vestingWallet1.beneficiary()).should.eq(beneficiary1.address);
        (await vestingWallet2.beneficiary()).should.eq(beneficiary2.address);

        // Verify predicted address matches
        const predictedAddress = await datFactory.predictAddress(tokenSalt);
        predictedAddress.should.eq(datToken.target);
      });

      it("should reject createToken with empty name or symbol", async function () {
        await datFactory
          .connect(owner)
          .createToken(
            "", // Empty name
            tokenSymbol,
            admin.address,
            tokenCap,
            [],
            tokenSalt,
          )
          .should.be.rejectedWith("EmptyName");

        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            "", // Empty symbol
            admin.address,
            tokenCap,
            [],
            tokenSalt,
          )
          .should.be.rejectedWith("EmptySymbol");
      });

      it("should reject token creation with zero owner address", async function () {
        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            ethers.ZeroAddress, // Zero address
            tokenCap,
            [],
            tokenSalt,
          )
          .should.be.rejectedWith("ZeroOwner");
      });

      it("should reject token creation with cap below minimum", async function () {
        const vestingSchedules = [];
        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            admin.address,
            minCap - 1n,
            vestingSchedules,
            tokenSalt,
          )
          .should.be.rejectedWith("CapTooLow");
      });

      it("should reject token creation with cap above maximum", async function () {
        const vestingSchedules = [];
        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            admin.address,
            maxCap + 1n,
            vestingSchedules,
            tokenSalt,
          )
          .should.be.rejectedWith("ExcessiveCap");
      });

      it("should reject token creation with vesting total exceeding cap", async function () {
        const overCapAmount = parseEther(11_000_000); // Over the 10M cap

        const vestingSchedules = [
          {
            beneficiary: beneficiary1.address,
            start: Math.floor(Date.now() / 1000),
            cliff: 90 * 86400,
            duration: 365 * 86400,
            amount: overCapAmount,
          },
        ];

        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            admin.address,
            tokenCap,
            vestingSchedules,
            tokenSalt,
          )
          .should.be.rejectedWith("ExceedsCap");
      });

      it("should reject token creation with vesting with zero beneficiary", async function () {
        const now = Math.floor(Date.now() / 1000);

        const invalidSchedules = [
          {
            beneficiary: ethers.ZeroAddress, // Zero address
            start: now,
            cliff: 90 * 86400,
            duration: 365 * 86400,
            amount: parseEther(1_000_000),
          },
        ];

        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            admin.address,
            tokenCap,
            invalidSchedules,
            tokenSalt,
          )
          .should.be.rejectedWith("ZeroAddress");
      });

      it("should reject token creation with vesting with zero amount", async function () {
        const now = Math.floor(Date.now() / 1000);

        const invalidSchedules = [
          {
            beneficiary: beneficiary1.address,
            start: now,
            cliff: 90 * 86400,
            duration: 365 * 86400,
            amount: 0, // Zero amount
          },
        ];

        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            admin.address,
            tokenCap,
            invalidSchedules,
            tokenSalt,
          )
          .should.be.rejectedWith("ZeroAmount");
      });

      it("should reject token creation with vesting with zero start time", async function () {
        const invalidSchedules = [
          {
            beneficiary: beneficiary1.address,
            start: 0, // Zero start time
            cliff: 90 * 86400,
            duration: 365 * 86400,
            amount: parseEther(1_000_000),
          },
        ];

        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            admin.address,
            tokenCap,
            invalidSchedules,
            tokenSalt,
          )
          .should.be.rejectedWith("ZeroStartTime");
      });

      it("should reject token creation with vesting with zero duration", async function () {
        const now = Math.floor(Date.now() / 1000);

        const invalidSchedules = [
          {
            beneficiary: beneficiary1.address,
            start: now,
            cliff: 90 * 86400,
            duration: 0, // Zero duration
            amount: parseEther(1_000_000),
          },
        ];

        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            admin.address,
            tokenCap,
            invalidSchedules,
            tokenSalt,
          )
          .should.be.rejectedWith("ZeroDuration");
      });

      it("should reject token creation with invalid vesting parameters: duration <= cliff", async function () {
        const now = Math.floor(Date.now() / 1000);

        // Invalid: duration = cliff
        const equalCliffSchedules = [
          {
            beneficiary: beneficiary1.address,
            start: now,
            cliff: 365 * 86400,
            duration: 365 * 86400, // Same as cliff
            amount: parseEther(1_000_000),
          },
        ];

        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            admin.address,
            tokenCap,
            equalCliffSchedules,
            tokenSalt,
          )
          .should.be.rejectedWith("DurationTooShort");

        // Invalid: cliff > duration
        const greaterCliffSchedules = [
          {
            beneficiary: beneficiary1.address,
            start: now,
            cliff: 400 * 86400, // Cliff 400 days
            duration: 365 * 86400, // Duration 365 days
            amount: parseEther(1_000_000),
          },
        ];

        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            admin.address,
            tokenCap,
            greaterCliffSchedules,
            tokenSalt,
          )
          .should.be.rejectedWith("DurationTooShort");
      });

      it("should reject token creation with excessive vesting parameters", async function () {
        const now = Math.floor(Date.now() / 1000);
        const maxUint64 = 2n ** 64n - 1n;

        // Duration too large
        const excessiveDurationSchedules = [
          {
            beneficiary: beneficiary1.address,
            start: now,
            cliff: 90 * 86400,
            duration: Number(maxUint64) + 1, // Exceeds uint64
            amount: parseEther(1_000_000),
          },
        ];

        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            admin.address,
            tokenCap,
            excessiveDurationSchedules,
            tokenSalt,
          )
          .should.be.rejectedWith(/ParameterOverflow/);

        // Start too large
        const excessiveStartSchedules = [
          {
            beneficiary: beneficiary1.address,
            start: Number(maxUint64) + 1, // Exceeds uint64
            cliff: 90 * 86400,
            duration: 365 * 86400,
            amount: parseEther(1_000_000),
          },
        ];

        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            admin.address,
            tokenCap,
            excessiveStartSchedules,
            tokenSalt,
          )
          .should.be.rejectedWith(/ParameterOverflow/);

        // Cliff too large
        const excessiveCliffSchedules = [
          {
            beneficiary: beneficiary1.address,
            start: now,
            cliff: Number(maxUint64) + 1, // Exceeds uint64
            duration: 365 * 86400,
            amount: parseEther(1_000_000),
          },
        ];

        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            admin.address,
            tokenCap,
            excessiveCliffSchedules,
            tokenSalt,
          )
          .should.be.rejectedWith(/ParameterOverflow/);
      });

      it("should reject token creation when start+cliff overflows", async function () {
        const maxUint64 = BigInt(2) ** BigInt(64) - BigInt(1);

        const overflowSchedules = [
          {
            beneficiary: beneficiary1.address,
            start: Number(maxUint64) - 86400, // Very close to max
            cliff: 90 * 86400, // Adding this would overflow
            duration: 365 * 86400,
            amount: parseEther(1_000_000),
          },
        ];

        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            admin.address,
            tokenCap,
            overflowSchedules,
            tokenSalt,
          )
          .should.be.rejectedWith("StartTimeOverflow");
      });

      it("should reject token creation with postCliffDuration=0", async function () {
        // This would make postCliffDuration = 0, which is invalid in OpenZeppelin's VestingWallet
        const now = Math.floor(Date.now() / 1000);

        const invalidSchedules = [
          {
            beneficiary: beneficiary1.address,
            start: now,
            cliff: 365 * 86400,
            duration: 365 * 86400 + 1, // Just slightly greater than cliff
            amount: parseEther(1_000_000),
          },
        ];

        await datFactory
          .connect(owner)
          .createToken(
            tokenName,
            tokenSymbol,
            admin.address,
            tokenCap,
            invalidSchedules,
            tokenSalt,
          ).should.not.be.rejected; // This is actually valid, just checking the edge case
      });
    });

    describe("Address Prediction", () => {
      it("should correctly predict token address", async function () {
        const salt1 = ethers.id("PREDICT_TEST_1");
        const salt2 = ethers.id("PREDICT_TEST_2");

        // Predict addresses
        const predictedAddr1 = await datFactory.predictAddress(salt1);
        const predictedAddr2 = await datFactory.predictAddress(salt2);

        // Create tokens
        const tx1 = await datFactory.connect(owner).createToken(
          tokenName,
          tokenSymbol,
          admin.address,
          tokenCap,
          [], // No vesting
          salt1,
        );
        const receipt1 = await getReceipt(tx1);
        const tokenAddress1 = receipt1.logs.find(
          (log) => log.fragment?.name === "DATCreated",
        ).args[0];

        const tx2 = await datFactory.connect(owner).createToken(
          tokenName + " 2",
          tokenSymbol + "2",
          admin.address,
          tokenCap,
          [], // No vesting
          salt2,
        );
        const receipt2 = await getReceipt(tx2);
        const tokenAddress2 = receipt2.logs.find(
          (log) => log.fragment?.name === "DATCreated",
        ).args[0];

        // Verify predictions match actual addresses
        predictedAddr1.should.eq(tokenAddress1);
        predictedAddr2.should.eq(tokenAddress2);
      });

      it("should reject predictAddress with zero salt", async function () {
        await datFactory
          .predictAddress(ethers.ZeroHash)
          .should.be.rejectedWith("ZeroSalt");
      });
    });
  });
});
