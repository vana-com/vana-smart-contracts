import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import { DAT, MultisendImplementation } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getReceipt, parseEther } from "../utils/helpers";
import { Wallet } from "ethers";

chai.use(chaiAsPromised);
should();

describe("Multisend", () => {
  // Test accounts
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

    // Test initialization parameters
    it("should have correct params after deploy", async function () {
      (await multisend.owner()).should.eq(owner);
    });

    // Test two-step ownership transfer process
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

    // Test ownership transfer restrictions
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

    // Test contract upgrade functionality
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

    // Test upgrade restrictions
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

    beforeEach(async () => {
      await deploy();

      dat = await ethers.deployContract("DAT", [
        "Test Data Autonomy Token",
        "TDAT",
        owner.address,
      ]);

      await dat.connect(owner).mint(user1, user1InitialDatBalance);
    });

    // Test basic token multisend functionality
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

    // Test token multisend scalability
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

    // Test token multisend error cases
    it("should reject multisendToken when not enough allowance", async function () {
      const amount = parseEther(7);
      const numberOfRecipients = 2n;

      const recipients = Array.from(
        { length: Number(numberOfRecipients) },
        () => Wallet.createRandom().address,
      );

      // Approve less than required amount
      await dat.connect(user1).approve(multisend, amount);

      await multisend
        .connect(user1)
        .multisendToken(dat, amount, recipients)
        .should.be.rejectedWith("InvalidAllowance");
    });

    it("should reject multisendToken when not enough balance", async function () {
      const amount = parseEther(1000000001); // More than initial balance
      const numberOfRecipients = 2n;

      const recipients = Array.from(
        { length: Number(numberOfRecipients) },
        () => Wallet.createRandom().address,
      );

      await dat.connect(user1).approve(multisend, amount * numberOfRecipients);

      await multisend
        .connect(user1)
        .multisendToken(dat, amount, recipients)
        .should.be.rejectedWith("InvalidAmount");
    });
  });

  describe("MultisendVana", () => {
    beforeEach(async () => {
      await deploy();
    });

    // Test basic native token multisend
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

    // Test native token multisend scalability
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

    // Test native token multisend error cases
    it("should reject multisendVana when invalid amount", async function () {
      const amount = parseEther(0.5);
      const numberOfRecipients = 2n;

      const recipients = Array.from(
        { length: Number(numberOfRecipients) },
        () => Wallet.createRandom().address,
      );

      await multisend
        .connect(user1)
        .multisendVana(amount, recipients, {
          value: amount, // Sending less than required
        })
        .should.be.rejectedWith("InvalidAmount");
    });
  });

  describe("MultisendVanaWithDifferentAmounts", () => {
    beforeEach(async () => {
      await deploy();
    });

    // Test sending same amounts (equivalent to regular multisend)
    it("should multisendVanaWithDifferentAmounts to 2 users, same amount", async function () {
      const amounts = [parseEther(0.5), parseEther(0.5)];
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
        .multisendVanaWithDifferentAmounts(amounts, recipients, {
          value: amounts[0] + amounts[1],
        });

      (await ethers.provider.getBalance(recipients[0])).should.eq(amounts[0]);
      (await ethers.provider.getBalance(recipients[1])).should.eq(amounts[1]);

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance -
          amounts[0] -
          amounts[1] -
          (await getReceipt(tx)).fee,
      );
    });

    // Test sending different amounts
    it("should multisendVanaWithDifferentAmounts to 2 users, different amount", async function () {
      const amounts = [parseEther(0.5), parseEther(0.7)];
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
        .multisendVanaWithDifferentAmounts(amounts, recipients, {
          value: amounts[0] + amounts[1],
        });

      (await ethers.provider.getBalance(recipients[0])).should.eq(amounts[0]);
      (await ethers.provider.getBalance(recipients[1])).should.eq(amounts[1]);

      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance -
          amounts[0] -
          amounts[1] -
          (await getReceipt(tx)).fee,
      );
    });

    // Test error handling
    it("should reject multisendVanaWithDifferentAmounts when not enough funds", async function () {
      const amounts = [parseEther(0.5), parseEther(0.7)];
      const numberOfRecipients = 2n;

      const recipients = Array.from(
        { length: Number(numberOfRecipients) },
        () => Wallet.createRandom().address,
      );

      await multisend
        .connect(user1)
        .multisendVanaWithDifferentAmounts(amounts, recipients, {
          value: amounts[0] + amounts[1] - 1n,
        })
        .should.be.rejectedWith();
    });

    // Test scalability with random amounts
    it("should multisendVanaWithDifferentAmounts to 500 users", async function () {
      const numberOfRecipients = 400n;

      const user1InitialBalance = await ethers.provider.getBalance(
        user1.address,
      );

      const recipients = Array.from(
        { length: Number(numberOfRecipients) },
        () => Wallet.createRandom().address,
      );

      // Generate random amounts between 0.001 and 0.1 ETH
      const amounts = Array.from({ length: Number(numberOfRecipients) }, () => {
        const randomAmount = Math.random() * 0.099 + 0.001; // Random between 0.001 and 0.1
        return parseEther(randomAmount.toFixed(18)); // Use 18 decimals for precision
      });

      // Calculate total amount needed
      const totalAmount = amounts.reduce((a, b) => a + b, 0n);

      const tx = await multisend
        .connect(user1)
        .multisendVanaWithDifferentAmounts(amounts, recipients, {
          value: totalAmount,
        });

      // Verify each recipient got their specific amount
      for (let i = 0; i < recipients.length; i++) {
        (await ethers.provider.getBalance(recipients[i])).should.eq(amounts[i]);
      }

      // Verify user1's final balance
      (await ethers.provider.getBalance(user1)).should.eq(
        user1InitialBalance - totalAmount - (await getReceipt(tx)).fee,
      );
    });

    it("should reject when amounts and recipients arrays have different lengths", async function () {
      const amounts = [parseEther(0.5), parseEther(0.7)];
      const recipients = [Wallet.createRandom().address]; // Only one recipient

      await multisend
        .connect(user1)
        .multisendVanaWithDifferentAmounts(amounts, recipients, {
          value: amounts[0] + amounts[1],
        })
        .should.be.rejectedWith("LengthMismatch");
    });
  });

  describe("MultisendTokenWithDifferentAmounts", () => {
    let user1InitialDatBalance = parseEther(1000000000);

    beforeEach(async () => {
      await deploy();

      dat = await ethers.deployContract("DAT", [
        "Test Data Autonomy Token",
        "TDAT",
        owner.address,
      ]);

      await dat.connect(owner).mint(user1, user1InitialDatBalance);
    });

    // Test basic functionality with different amounts
    it("should multisendTokenWithDifferentAmounts to 2 users with different amounts", async function () {
      const amounts = [parseEther(100), parseEther(200)];
      const numberOfRecipients = 2n;

      const recipients = Array.from(
        { length: Number(numberOfRecipients) },
        () => Wallet.createRandom().address,
      );

      const totalAmount = amounts.reduce((a, b) => a + b, 0n);
      await dat.connect(user1).approve(multisend, totalAmount);

      await multisend
        .connect(user1)
        .multisendTokenWithDifferentAmounts(dat, amounts, recipients);

      // Verify each recipient's balance
      (await dat.balanceOf(recipients[0])).should.eq(amounts[0]);
      (await dat.balanceOf(recipients[1])).should.eq(amounts[1]);

      // Verify sender's remaining balance
      (await dat.balanceOf(user1)).should.eq(
        user1InitialDatBalance - totalAmount,
      );
    });

    // Test scalability with random amounts
    it("should multisendTokenWithDifferentAmounts to 500 users with random amounts", async function () {
      const numberOfRecipients = 500n;

      const recipients = Array.from(
        { length: Number(numberOfRecipients) },
        () => Wallet.createRandom().address,
      );

      // Generate random amounts between 1 and 1000 tokens
      const amounts = Array.from({ length: Number(numberOfRecipients) }, () => {
        const randomAmount = Math.random() * 999 + 1;
        return parseEther(randomAmount.toFixed(18));
      });

      const totalAmount = amounts.reduce((a, b) => a + b, 0n);
      await dat.connect(user1).approve(multisend, totalAmount);

      await multisend
        .connect(user1)
        .multisendTokenWithDifferentAmounts(dat, amounts, recipients);

      // Verify all balances
      for (let i = 0; i < recipients.length; i++) {
        (await dat.balanceOf(recipients[i])).should.eq(amounts[i]);
      }

      (await dat.balanceOf(user1)).should.eq(
        user1InitialDatBalance - totalAmount,
      );
    });

    // Test error handling
    it("should reject when amounts and recipients arrays have different lengths", async function () {
      const amounts = [parseEther(100), parseEther(200)];
      const recipients = [Wallet.createRandom().address];

      await dat.connect(user1).approve(multisend, parseEther(300));

      await multisend
        .connect(user1)
        .multisendTokenWithDifferentAmounts(dat, amounts, recipients)
        .should.be.rejectedWith("LengthMismatch");
    });

    it("should reject when not enough allowance", async function () {
      const amounts = [parseEther(100), parseEther(200)];
      const recipients = [
        Wallet.createRandom().address,
        Wallet.createRandom().address,
      ];

      // Approve less than needed
      await dat.connect(user1).approve(multisend, parseEther(200));

      await multisend
        .connect(user1)
        .multisendTokenWithDifferentAmounts(dat, amounts, recipients)
        .should.be.rejectedWith();
    });

    it("should reject when not enough balance", async function () {
      const amounts = [parseEther(500000000), parseEther(600000000)]; // More than initial balance
      const recipients = [
        Wallet.createRandom().address,
        Wallet.createRandom().address,
      ];

      const totalAmount = amounts.reduce((a, b) => a + b, 0n);
      await dat.connect(user1).approve(multisend, totalAmount);

      await multisend
        .connect(user1)
        .multisendTokenWithDifferentAmounts(dat, amounts, recipients)
        .should.be.rejectedWith();
    });
  });
});
