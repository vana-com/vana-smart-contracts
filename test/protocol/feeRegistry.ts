import chai, { expect, should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import { FeeRegistryImplementation } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

chai.use(chaiAsPromised);
should();

describe("FeeRegistry", () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let payee: HardhatEthersSigner;
  let asset: HardhatEthersSigner; // any address works as an asset placeholder

  let feeRegistry: FeeRegistryImplementation;

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000";

  const OP_NAME = "GRANT_REGISTRATION";
  const OP_KEY = ethers.keccak256(ethers.toUtf8Bytes(OP_NAME));
  const OTHER_OP_KEY = ethers.keccak256(
    ethers.toUtf8Bytes("DATA_ACCESS_RECORD"),
  );

  const deploy = async () => {
    [deployer, owner, user1, user2, payee, asset] = await ethers.getSigners();

    const feeRegistryDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("FeeRegistryImplementation"),
      [owner.address],
      {
        kind: "uups",
      },
    );

    feeRegistry = await ethers.getContractAt(
      "FeeRegistryImplementation",
      feeRegistryDeploy.target,
    );
  };

  describe("Setup", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should have correct params after deploy", async function () {
      (await feeRegistry.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(true);
      (await feeRegistry.version()).should.eq(1);
      (await feeRegistry.paused()).should.eq(false);
    });

    it("should not grant any role to the deployer", async function () {
      (await feeRegistry.hasRole(DEFAULT_ADMIN_ROLE, deployer)).should.eq(
        false,
      );
    });

    it("should reject re-initialization of the proxy", async function () {
      await expect(
        feeRegistry.connect(owner).initialize(user1.address),
      ).to.be.revertedWithCustomError(feeRegistry, "InvalidInitialization");
    });

    it("should reject initialization of the bare implementation", async function () {
      const implementation = await (
        await ethers.getContractFactory("FeeRegistryImplementation")
      ).deploy();
      await implementation.waitForDeployment();

      await expect(
        implementation.connect(owner).initialize(owner.address),
      ).to.be.revertedWithCustomError(implementation, "InvalidInitialization");
    });

    it("should reject deployment with zero owner address", async function () {
      const factory = await ethers.getContractFactory(
        "FeeRegistryImplementation",
      );
      await expect(
        upgrades.deployProxy(factory, [ethers.ZeroAddress], { kind: "uups" }),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("should allow admin to grant and revoke roles", async function () {
      await feeRegistry
        .connect(owner)
        .grantRole(DEFAULT_ADMIN_ROLE, user1.address).should.be.fulfilled;
      (await feeRegistry.hasRole(DEFAULT_ADMIN_ROLE, user1)).should.eq(true);

      await feeRegistry
        .connect(user1)
        .revokeRole(DEFAULT_ADMIN_ROLE, owner.address).should.be.fulfilled;
      (await feeRegistry.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(false);

      await expect(
        feeRegistry
          .connect(owner)
          .grantRole(DEFAULT_ADMIN_ROLE, user2.address),
      )
        .to.be.revertedWithCustomError(
          feeRegistry,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(owner.address, DEFAULT_ADMIN_ROLE);
    });
  });

  describe("setFee", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should reject setFee from non-admin", async function () {
      await expect(
        feeRegistry
          .connect(user1)
          .setFee(OP_KEY, 100n, ethers.ZeroAddress, payee.address, true),
      )
        .to.be.revertedWithCustomError(
          feeRegistry,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(user1.address, DEFAULT_ADMIN_ROLE);
    });

    it("should set a fee, emit FeeSet and register the operation", async function () {
      const amount = ethers.parseEther("1");

      await expect(
        feeRegistry
          .connect(owner)
          .setFee(OP_KEY, amount, asset.address, payee.address, true),
      )
        .to.emit(feeRegistry, "FeeSet")
        .withArgs(OP_KEY, amount, asset.address, payee.address, true);

      const fee = await feeRegistry.fees(OP_KEY);
      fee.amount.should.eq(amount);
      fee.asset.should.eq(asset.address);
      fee.payee.should.eq(payee.address);
      fee.enabled.should.eq(true);

      (await feeRegistry.isFeeRegistered(OP_KEY)).should.eq(true);
    });

    it("should overwrite an existing fee", async function () {
      await feeRegistry
        .connect(owner)
        .setFee(OP_KEY, 100n, asset.address, payee.address, true);

      await expect(
        feeRegistry
          .connect(owner)
          .setFee(OP_KEY, 250n, ethers.ZeroAddress, user2.address, false),
      )
        .to.emit(feeRegistry, "FeeSet")
        .withArgs(OP_KEY, 250n, ethers.ZeroAddress, user2.address, false);

      const fee = await feeRegistry.fees(OP_KEY);
      fee.amount.should.eq(250n);
      fee.asset.should.eq(ethers.ZeroAddress);
      fee.payee.should.eq(user2.address);
      fee.enabled.should.eq(false);

      (await feeRegistry.isFeeRegistered(OP_KEY)).should.eq(true);
    });

    it("should reject an enabled fee with a zero payee", async function () {
      await expect(
        feeRegistry
          .connect(owner)
          .setFee(OP_KEY, 100n, asset.address, ethers.ZeroAddress, true),
      ).to.be.revertedWithCustomError(feeRegistry, "InvalidPayee");
    });

    it("should allow a disabled fee with a zero payee", async function () {
      await feeRegistry
        .connect(owner)
        .setFee(OP_KEY, 100n, asset.address, ethers.ZeroAddress, false).should
        .be.fulfilled;

      const fee = await feeRegistry.fees(OP_KEY);
      fee.amount.should.eq(100n);
      fee.payee.should.eq(ethers.ZeroAddress);
      fee.enabled.should.eq(false);

      (await feeRegistry.isFeeRegistered(OP_KEY)).should.eq(true);
    });

    it("should allow an enabled fee with amount 0 (free but configured)", async function () {
      await feeRegistry
        .connect(owner)
        .setFee(OP_KEY, 0n, asset.address, payee.address, true).should.be
        .fulfilled;

      const fee = await feeRegistry.fees(OP_KEY);
      fee.amount.should.eq(0n);
      fee.enabled.should.eq(true);

      (await feeRegistry.isFeeRegistered(OP_KEY)).should.eq(true);
      (await feeRegistry.feeAmount(OP_KEY)).should.eq(0n);
    });

    it("should accept address(0) as the asset (native VANA convention)", async function () {
      await feeRegistry
        .connect(owner)
        .setFee(OP_KEY, 5n, ethers.ZeroAddress, payee.address, true);

      const fee = await feeRegistry.fees(OP_KEY);
      fee.asset.should.eq(ethers.ZeroAddress);
      fee.enabled.should.eq(true);
    });
  });

  describe("setFeeByName", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should return keccak256(bytes(name)) as the operation key", async function () {
      const returnedKey = await feeRegistry
        .connect(owner)
        .setFeeByName.staticCall(
          OP_NAME,
          100n,
          asset.address,
          payee.address,
          true,
        );

      returnedKey.should.eq(OP_KEY);
      returnedKey.should.eq(await feeRegistry.operationKey(OP_NAME));
      returnedKey.should.eq(ethers.keccak256(ethers.toUtf8Bytes(OP_NAME)));
    });

    it("should store the fee under the derived key and emit FeeSet", async function () {
      await expect(
        feeRegistry
          .connect(owner)
          .setFeeByName(OP_NAME, 100n, asset.address, payee.address, true),
      )
        .to.emit(feeRegistry, "FeeSet")
        .withArgs(OP_KEY, 100n, asset.address, payee.address, true);

      const fee = await feeRegistry.fees(OP_KEY);
      fee.amount.should.eq(100n);
      fee.asset.should.eq(asset.address);
      fee.payee.should.eq(payee.address);
      fee.enabled.should.eq(true);

      (await feeRegistry.isFeeRegistered(OP_KEY)).should.eq(true);
    });

    it("should reject setFeeByName from non-admin", async function () {
      await expect(
        feeRegistry
          .connect(user1)
          .setFeeByName(OP_NAME, 100n, asset.address, payee.address, true),
      )
        .to.be.revertedWithCustomError(
          feeRegistry,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(user1.address, DEFAULT_ADMIN_ROLE);
    });

    it("should reject an enabled fee with a zero payee via setFeeByName", async function () {
      await expect(
        feeRegistry
          .connect(owner)
          .setFeeByName(OP_NAME, 100n, asset.address, ethers.ZeroAddress, true),
      ).to.be.revertedWithCustomError(feeRegistry, "InvalidPayee");
    });
  });

  describe("operationKey", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should match keccak256 of the utf8 name", async function () {
      (await feeRegistry.operationKey(OP_NAME)).should.eq(OP_KEY);
      (await feeRegistry.operationKey("DATA_ACCESS_RECORD")).should.eq(
        OTHER_OP_KEY,
      );
      (await feeRegistry.operationKey("")).should.eq(
        ethers.keccak256(ethers.toUtf8Bytes("")),
      );
    });
  });

  describe("Views", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("fees() should return the zero struct for unregistered operations", async function () {
      const fee = await feeRegistry.fees(OP_KEY);
      fee.amount.should.eq(0n);
      fee.asset.should.eq(ethers.ZeroAddress);
      fee.payee.should.eq(ethers.ZeroAddress);
      fee.enabled.should.eq(false);

      (await feeRegistry.isFeeRegistered(OP_KEY)).should.eq(false);
    });

    it("feeAmount() should return the amount when enabled", async function () {
      await feeRegistry
        .connect(owner)
        .setFee(OP_KEY, 123n, asset.address, payee.address, true);

      (await feeRegistry.feeAmount(OP_KEY)).should.eq(123n);
    });

    it("feeAmount() should return 0 when the fee is disabled", async function () {
      await feeRegistry
        .connect(owner)
        .setFee(OP_KEY, 123n, asset.address, payee.address, false);

      (await feeRegistry.feeAmount(OP_KEY)).should.eq(0n);
      // still registered, just disabled
      (await feeRegistry.isFeeRegistered(OP_KEY)).should.eq(true);
    });

    it("feeAmount() should return 0 for unregistered operations", async function () {
      (await feeRegistry.feeAmount(OP_KEY)).should.eq(0n);
    });
  });

  describe("clearFee", () => {
    beforeEach(async () => {
      await deploy();
      await feeRegistry
        .connect(owner)
        .setFee(OP_KEY, 100n, asset.address, payee.address, true);
    });

    it("should clear a fee and emit FeeCleared", async function () {
      await expect(feeRegistry.connect(owner).clearFee(OP_KEY))
        .to.emit(feeRegistry, "FeeCleared")
        .withArgs(OP_KEY);

      const fee = await feeRegistry.fees(OP_KEY);
      fee.amount.should.eq(0n);
      fee.asset.should.eq(ethers.ZeroAddress);
      fee.payee.should.eq(ethers.ZeroAddress);
      fee.enabled.should.eq(false);

      (await feeRegistry.isFeeRegistered(OP_KEY)).should.eq(false);
      (await feeRegistry.feeAmount(OP_KEY)).should.eq(0n);
    });

    it("should reject clearFee from non-admin", async function () {
      await expect(feeRegistry.connect(user1).clearFee(OP_KEY))
        .to.be.revertedWithCustomError(
          feeRegistry,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(user1.address, DEFAULT_ADMIN_ROLE);
    });

    it("should reject clearing an unregistered operation", async function () {
      await expect(feeRegistry.connect(owner).clearFee(OTHER_OP_KEY))
        .to.be.revertedWithCustomError(feeRegistry, "FeeNotSet")
        .withArgs(OTHER_OP_KEY);
    });

    it("should reject clearing the same fee twice", async function () {
      await feeRegistry.connect(owner).clearFee(OP_KEY);

      await expect(feeRegistry.connect(owner).clearFee(OP_KEY))
        .to.be.revertedWithCustomError(feeRegistry, "FeeNotSet")
        .withArgs(OP_KEY);
    });

    it("should allow re-setting a fee after clearing it", async function () {
      await feeRegistry.connect(owner).clearFee(OP_KEY);

      await feeRegistry
        .connect(owner)
        .setFee(OP_KEY, 999n, ethers.ZeroAddress, user2.address, true).should
        .be.fulfilled;

      const fee = await feeRegistry.fees(OP_KEY);
      fee.amount.should.eq(999n);
      fee.asset.should.eq(ethers.ZeroAddress);
      fee.payee.should.eq(user2.address);
      fee.enabled.should.eq(true);

      (await feeRegistry.isFeeRegistered(OP_KEY)).should.eq(true);
      (await feeRegistry.feeAmount(OP_KEY)).should.eq(999n);
    });
  });

  describe("Pause", () => {
    beforeEach(async () => {
      await deploy();
      await feeRegistry
        .connect(owner)
        .setFee(OP_KEY, 100n, asset.address, payee.address, true);
    });

    it("should allow admin to pause and unpause", async function () {
      await feeRegistry.connect(owner).pause().should.be.fulfilled;
      (await feeRegistry.paused()).should.eq(true);

      await feeRegistry.connect(owner).unpause().should.be.fulfilled;
      (await feeRegistry.paused()).should.eq(false);
    });

    it("should reject pause and unpause from non-admin", async function () {
      await expect(feeRegistry.connect(user1).pause())
        .to.be.revertedWithCustomError(
          feeRegistry,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(user1.address, DEFAULT_ADMIN_ROLE);

      await feeRegistry.connect(owner).pause();

      await expect(feeRegistry.connect(user1).unpause())
        .to.be.revertedWithCustomError(
          feeRegistry,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(user1.address, DEFAULT_ADMIN_ROLE);
    });

    it("should block setFee, setFeeByName and clearFee when paused", async function () {
      await feeRegistry.connect(owner).pause();

      await expect(
        feeRegistry
          .connect(owner)
          .setFee(OTHER_OP_KEY, 100n, asset.address, payee.address, true),
      ).to.be.revertedWithCustomError(feeRegistry, "EnforcedPause");

      await expect(
        feeRegistry
          .connect(owner)
          .setFeeByName(OP_NAME, 100n, asset.address, payee.address, true),
      ).to.be.revertedWithCustomError(feeRegistry, "EnforcedPause");

      await expect(
        feeRegistry.connect(owner).clearFee(OP_KEY),
      ).to.be.revertedWithCustomError(feeRegistry, "EnforcedPause");
    });

    it("should keep views working while paused", async function () {
      await feeRegistry.connect(owner).pause();

      const fee = await feeRegistry.fees(OP_KEY);
      fee.amount.should.eq(100n);
      fee.enabled.should.eq(true);

      (await feeRegistry.isFeeRegistered(OP_KEY)).should.eq(true);
      (await feeRegistry.feeAmount(OP_KEY)).should.eq(100n);
      (await feeRegistry.operationKey(OP_NAME)).should.eq(OP_KEY);
      (await feeRegistry.version()).should.eq(1);
    });

    it("should restore write operations after unpause", async function () {
      await feeRegistry.connect(owner).pause();
      await feeRegistry.connect(owner).unpause();

      await feeRegistry
        .connect(owner)
        .setFee(OTHER_OP_KEY, 7n, asset.address, payee.address, true);
      const fee = await feeRegistry.fees(OTHER_OP_KEY);
      fee.amount.should.eq(7n);
      fee.enabled.should.eq(true);

      await feeRegistry.connect(owner).clearFee(OTHER_OP_KEY);
      (await feeRegistry.isFeeRegistered(OTHER_OP_KEY)).should.eq(false);
    });
  });

  describe("Upgrade", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should reject upgradeToAndCall from non-admin", async function () {
      const newImplementation = await (
        await ethers.getContractFactory("FeeRegistryImplementation")
      ).deploy();
      await newImplementation.waitForDeployment();

      await expect(
        feeRegistry
          .connect(user1)
          .upgradeToAndCall(await newImplementation.getAddress(), "0x"),
      )
        .to.be.revertedWithCustomError(
          feeRegistry,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(user1.address, DEFAULT_ADMIN_ROLE);
    });

    it("should allow admin to upgrade and preserve state", async function () {
      await feeRegistry
        .connect(owner)
        .setFee(OP_KEY, 100n, asset.address, payee.address, true);

      const implBefore = await upgrades.erc1967.getImplementationAddress(
        await feeRegistry.getAddress(),
      );
      const upgraded = await upgrades.upgradeProxy(
        await feeRegistry.getAddress(),
        (await ethers.getContractFactory("FeeRegistryImplementation")).connect(
          owner,
        ),
        { redeployImplementation: "always" },
      );
      const implAfter = await upgrades.erc1967.getImplementationAddress(
        await feeRegistry.getAddress(),
      );
      implAfter.should.not.eq(implBefore); // an upgrade actually happened

      (await upgraded.version()).should.eq(1);

      const fee = await feeRegistry.fees(OP_KEY);
      fee.amount.should.eq(100n);
      fee.asset.should.eq(asset.address);
      fee.payee.should.eq(payee.address);
      fee.enabled.should.eq(true);
      (await feeRegistry.isFeeRegistered(OP_KEY)).should.eq(true);
      (await feeRegistry.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(true);
    });
  });
});
