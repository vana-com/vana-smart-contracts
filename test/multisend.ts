import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import { DAT, MultisendImplementation } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getReceipt, parseEther } from "../utils/helpers";
import { Wallet } from "ethers";
import { address } from "hardhat/internal/core/config/config-validation";

chai.use(chaiAsPromised);
should();

describe("Multisend", () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;

  let multisend: MultisendImplementation;
  let dat: DAT;

  const deploy = async () => {
    [deployer, owner, user1, user2, user3] = await ethers.getSigners();

    const multisendDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("MultisendImplementation"),
      [owner.address],
      {
        kind: "uups",
      },
    );

    multisend = await ethers.getContractAt(
      "MultisendImplementation",
      multisendDeploy.target,
    );
  };

  describe("Setup", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should have correct params after deploy", async function () {
      (await multisend.owner()).should.eq(owner);
    });

    it("Should transferOwnership in 2 steps", async function () {
      await multisend
        .connect(owner)
        .transferOwnership(user2.address)
        .should.emit(multisend, "OwnershipTransferStarted")
        .withArgs(owner, user2);
      (await multisend.owner()).should.eq(owner);

      await multisend
        .connect(owner)
        .transferOwnership(user3.address)
        .should.emit(multisend, "OwnershipTransferStarted")
        .withArgs(owner, user3);
      (await multisend.owner()).should.eq(owner);

      await multisend
        .connect(user3)
        .acceptOwnership()
        .should.emit(multisend, "OwnershipTransferred");

      (await multisend.owner()).should.eq(user3);
    });

    it("Should reject transferOwnership when non-owner", async function () {
      await multisend
        .connect(user1)
        .transferOwnership(user2)
        .should.be.rejectedWith(
          `OwnableUnauthorizedAccount("${user1.address}")`,
        );
    });

    it("Should reject acceptOwnership when non-newOwner", async function () {
      await multisend
        .connect(owner)
        .transferOwnership(user2.address)
        .should.emit(multisend, "OwnershipTransferStarted")
        .withArgs(owner, user2);
      (await multisend.owner()).should.eq(owner);

      await multisend
        .connect(user3)
        .acceptOwnership()
        .should.be.rejectedWith(
          `OwnableUnauthorizedAccount("${user3.address}")`,
        );
    });

    it("Should upgradeTo when owner", async function () {
      await upgrades.upgradeProxy(
        multisend,
        await ethers.getContractFactory("MultisendImplementationV2Mock", owner),
      );

      const newRoot = await ethers.getContractAt(
        "MultisendImplementationV2Mock",
        multisend,
      );
      (await newRoot.owner()).should.eq(owner);

      (await newRoot.test()).should.eq("test");
    });

    it("Should upgradeTo when owner and emit event", async function () {
      const newRootImplementation = await ethers.deployContract(
        "MultisendImplementationV2Mock",
      );

      await multisend
        .connect(owner)
        .upgradeToAndCall(newRootImplementation, "0x")
        .should.emit(multisend, "Upgraded")
        .withArgs(newRootImplementation);

      const newRoot = await ethers.getContractAt(
        "MultisendImplementationV2Mock",
        multisend,
      );

      (await newRoot.owner()).should.eq(owner);

      (await newRoot.test()).should.eq("test");
    });

    it("Should reject upgradeTo when storage layout is incompatible", async function () {
      await upgrades
        .upgradeProxy(
          multisend,
          await ethers.getContractFactory(
            "MultisendImplementationV3Mock",
            owner,
          ),
        )
        .should.be.rejectedWith("New storage layout is incompatible");
    });

    it("Should reject upgradeTo when non owner", async function () {
      const newRootImplementation = await ethers.deployContract(
        "MultisendImplementationV2Mock",
      );

      await multisend
        .connect(user1)
        .upgradeToAndCall(newRootImplementation, "0x")
        .should.be.rejectedWith(
          `OwnableUnauthorizedAccount("${user1.address}")`,
        );
    });
  });

  describe("MultisendToken", () => {
    let user1InitialDatBalance = parseEther(1000000000);

    before(async function () {});

    beforeEach(async () => {
      await deploy();

      dat = await ethers.deployContract("DAT", [
        "Test Data Autonomy Token",
        "TDAT",
        owner.address,
      ]);

      await dat.connect(owner).mint(user1, user1InitialDatBalance);
    });

    it("should multisendToken to 2 users", async function () {
      const amount = parseEther(7);
      const numberOfRecipients = 2n;

      const recipients = Array.from(
        { length: Number(numberOfRecipients) },
        () => Wallet.createRandom().address,
      );

      await dat.connect(user1).approve(multisend, amount * numberOfRecipients);
      await multisend.connect(user1).multisendToken(dat, amount, recipients);

      for (const recipient of recipients) {
        (await dat.balanceOf(recipient)).should.eq(amount);
      }

      (await dat.balanceOf(user1)).should.eq(
        user1InitialDatBalance - amount * numberOfRecipients,
      );
    });

    it("should multisendToken to 500 users", async function () {
      const amount = parseEther(7);
      const numberOfRecipients = 500n;

      const recipients = Array.from(
        { length: Number(numberOfRecipients) },
        () => Wallet.createRandom().address,
      );

      await dat.connect(user1).approve(multisend, amount * numberOfRecipients);
      await multisend.connect(user1).multisendToken(dat, amount, recipients);

      for (const recipient of recipients) {
        (await dat.balanceOf(recipient)).should.eq(amount);
      }

      (await dat.balanceOf(user1)).should.eq(
        user1InitialDatBalance - amount * numberOfRecipients,
      );
    });
  });

  describe("MultisendVana", () => {
    before(async function () {});

    beforeEach(async () => {
      await deploy();
    });

    it("should multisendVana to 2 users", async function () {
      const amount = parseEther(0.5);
      const numberOfRecipients = 2n;

      const user1InitialBalance = await ethers.provider.getBalance(
        user1.address,
      );
      const recipients = Array.from(
        { length: Number(numberOfRecipients) },
        () => Wallet.createRandom().address,
      );

      const tx = await multisend
        .connect(user1)
        .multisendVana(amount, recipients, {
          value: amount * numberOfRecipients,
        });

      for (const recipient of recipients) {
        (await ethers.provider.getBalance(recipient)).should.eq(amount);
      }

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance -
          amount * numberOfRecipients -
          (await getReceipt(tx)).fee,
      );
    });

    it("should multisendVana to 500 users", async function () {
      const amount = parseEther(0.1);
      const numberOfRecipients = 500n;

      const user1InitialBalance = await ethers.provider.getBalance(
        user1.address,
      );
      const recipients = Array.from(
        { length: Number(numberOfRecipients) },
        () => Wallet.createRandom().address,
      );

      const tx = await multisend
        .connect(user1)
        .multisendVana(amount, recipients, {
          value: amount * numberOfRecipients,
        });

      for (const recipient of recipients) {
        (await ethers.provider.getBalance(recipient)).should.eq(amount);
      }

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance -
          amount * numberOfRecipients -
          (await getReceipt(tx)).fee,
      );
    });
  });
});
