import { ethers, upgrades } from "hardhat";
import chai, { should, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getReceipt, parseEther } from "../utils/helpers";
import { VeVANAImplementation } from "../typechain-types";
import { dlp } from "../typechain-types/contracts";

chai.use(chaiAsPromised);
should();

describe("veVANA", function () {
    let owner: HardhatEthersSigner;
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;

    let veVANA: VeVANAImplementation;

    const deploy = async () => {
        [owner, user1, user2] = await ethers.getSigners();

        const veVANADeploy = await upgrades.deployProxy(
            await ethers.getContractFactory("VeVANAImplementation"),
            [owner.address],
            {
                kind: "uups",
            },
        );

        // Cast the proxy to the implementation interface
        veVANA = await ethers.getContractAt(
            "VeVANAImplementation",
            veVANADeploy.target,
        );
    };

    beforeEach(async function () {
        await deploy();
    });

    describe("Setup", function () {
        it("should have the correct params after deploy", async function () {
            (await veVANA.name()).should.equal("Vote-Escrowed VANA");
            (await veVANA.symbol()).should.equal("veVANA");
            (await veVANA.decimals()).should.equal(18);
            (await veVANA.totalSupply()).should.equal(0);
            (await veVANA.hasRole(await veVANA.DEFAULT_ADMIN_ROLE(), owner.address)).should.be.true;
            (await veVANA.version()).should.equal(1);
        });
    });

    describe("Permissions", function () {
        beforeEach(async function () {
            await deploy();
        });

        it("should allow the admin to grant and revoke roles", async function () {
            await veVANA.connect(owner).grantRole(await veVANA.DEFAULT_ADMIN_ROLE(), user1.address);
            (await veVANA.hasRole(await veVANA.DEFAULT_ADMIN_ROLE(), user1.address)).should.be.true;

            await veVANA.connect(owner).revokeRole(await veVANA.DEFAULT_ADMIN_ROLE(), user1.address);
            (await veVANA.hasRole(await veVANA.DEFAULT_ADMIN_ROLE(), user1.address)).should.be.false;
        });

        it("should allow the admin to pause and unpause", async function () {
            await veVANA.connect(owner).pause()
                .should.emit(veVANA, "Paused")
                .withArgs(owner.address);
            (await veVANA.paused()).should.be.true;

            await veVANA.connect(owner).unpause()
                .should.emit(veVANA, "Unpaused")
                .withArgs(owner.address);
            (await veVANA.paused()).should.be.false;
        });

        it("should allow the admin to upgrade the implementation", async function () {
            const newVeVANAImpl = await ethers.getContractFactory("VeVANAImplementation").then((factory) => factory.deploy());
            await veVANA.connect(owner).upgradeToAndCall(newVeVANAImpl, "0x")
                .should.emit(veVANA, "Upgraded")
                .withArgs(newVeVANAImpl);
        });

        it("should reject if a non-admin tries to do the admin tasks", async function () {
            await veVANA.connect(user1).pause()
                .should.be.rejectedWith("AccessControlUnauthorizedAccount");

            await veVANA.connect(user1).unpause()
                .should.be.rejectedWith("AccessControlUnauthorizedAccount");

            await veVANA.connect(user1).grantRole(await veVANA.DEFAULT_ADMIN_ROLE(), user2.address)
                .should.be.rejectedWith("AccessControlUnauthorizedAccount");

            const {
                constants,
            } = require('@openzeppelin/test-helpers');
            await veVANA.connect(user1).upgradeToAndCall(constants.ZERO_ADDRESS, "0x")
                .should.be.rejectedWith("AccessControlUnauthorizedAccount");
        });
    });

    describe("Deposit", function () {
        it("should allow depositing", async function () {
            const userInitBalance = await ethers.provider.getBalance(user1);
            const ownerInitBalance = await ethers.provider.getBalance(owner);

            const depositAmount = parseEther(100);

            const tx = await veVANA.connect(user1).depositVANA({ value: depositAmount });
            tx.should.emit(veVANA, "Deposited").withArgs(user1.address, depositAmount);
            (await veVANA.balanceOf(user1)).should.equal(depositAmount);
            (await veVANA.totalSupply()).should.equal(depositAmount);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount);
            (await ethers.provider.getBalance(user1)).should.equal(userInitBalance - depositAmount - (await getReceipt(tx)).fee);
        });

        it("should reject if the deposit amount is 0", async function () {
            await (veVANA.connect(user1).depositVANA({ value: 0 }))
                .should.be.revertedWithCustomError(veVANA, "DepositAmountMustBeGreaterThanZero");
        });

        it("should reject if pause", async function () {
            const depositAmount = parseEther(100);
            await veVANA.connect(owner).pause();
            await (veVANA.connect(user1).depositVANA({ value: depositAmount }))
                .should.be.rejectedWith("EnforcedPause");
        });
    });

    describe("Withdraw", function () {
        it("should allow withdrawing", async function () {
            const depositAmount = parseEther(100);
            await veVANA.connect(user1).depositVANA({ value: depositAmount });
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount);
            (await veVANA.balanceOf(user1)).should.equal(depositAmount);

            const initBalance = await ethers.provider.getBalance(user1);
            const withdrawAmount = parseEther(25);
            const remainingAmount = depositAmount - withdrawAmount;
            let tx = await veVANA.connect(user1).withdrawVANA(withdrawAmount);
            let receipt = await getReceipt(tx);
            let txFee = receipt.fee;
            tx.should.emit(veVANA, "Withdrawn").withArgs(user1.address, withdrawAmount);
            (await veVANA.balanceOf(user1)).should.equal(remainingAmount);
            (await ethers.provider.getBalance(user1)).should.eq(initBalance + withdrawAmount - txFee);
            (await ethers.provider.getBalance(veVANA)).should.equal(remainingAmount);

            tx = await veVANA.connect(user1).withdrawVANA(remainingAmount);
            receipt = await getReceipt(tx);
            txFee += receipt.fee;
            (await veVANA.balanceOf(user1)).should.equal(0);
            (await ethers.provider.getBalance(user1)).should.eq(initBalance + depositAmount - txFee);
            (await ethers.provider.getBalance(veVANA)).should.equal(0);
        });

        it("should reject if the withdraw amount is 0", async function () {
            await (veVANA.connect(user1).withdrawVANA(0))
                .should.be.rejectedWith("WithdrawAmountMustBeGreaterThanZero");
        });

        it("should reject if the withdrawn amount exceeds the balance", async function () {
            const depositAmount = parseEther(100);
            await veVANA.connect(user1).depositVANA({ value: depositAmount });
            const withdrawAmount = depositAmount + 1n;
            await (veVANA.connect(user1).withdrawVANA(withdrawAmount))
                .should.be.rejectedWith(`ERC20InsufficientBalance("${user1.address}", ${depositAmount}, ${withdrawAmount})`);
        });

        it("should reject if pause", async function () {
            const withdrawAmount = parseEther(100);
            await veVANA.connect(owner).pause();
            await (veVANA.connect(user1).withdrawVANA(withdrawAmount))
                .should.be.rejectedWith("EnforcedPause");
        });
    });

    describe("Governance", function () {
        beforeEach(async function () {
            await deploy();
        });

        it("should provide the correct voting power to veVANA holders", async function () {
            let [dlp1, dlp2] = await ethers.getSigners();
            const depositAmount1 = parseEther(100);
            (await veVANA.connect(user1).delegate(user1.address));
            await veVANA.connect(user1).depositVANA({ value: depositAmount1 });
            (await veVANA.balanceOf(user1)).should.equal(depositAmount1);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount1);
            (await veVANA.delegates(user1)).should.equal(user1.address);
            (await veVANA.getVotes(user1)).should.equal(depositAmount1);
            (await veVANA.getVotes(owner)).should.equal(0);

            const depositAmount2 = parseEther(200);
            (await veVANA.connect(user2).delegate(user2.address));
            await veVANA.connect(user2).depositVANA({ value: depositAmount2 });
            (await veVANA.balanceOf(user2)).should.equal(depositAmount2);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount1 + depositAmount2);
            (await veVANA.delegates(user2)).should.equal(user2.address);
            (await veVANA.getVotes(user1)).should.equal(depositAmount1);
            (await veVANA.getVotes(user2)).should.equal(depositAmount2);
            (await veVANA.getVotes(owner)).should.equal(0);

            const withdrawAmount1 = parseEther(50);
            await veVANA.connect(user1).withdrawVANA(withdrawAmount1);
            (await veVANA.balanceOf(user1)).should.equal(depositAmount1 - withdrawAmount1);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount1 + depositAmount2 - withdrawAmount1);
            (await veVANA.getVotes(user1)).should.equal(depositAmount1 - withdrawAmount1);
            (await veVANA.getVotes(user2)).should.equal(depositAmount2);
            (await veVANA.getVotes(owner)).should.equal(0);

            const withdrawAmount2 = parseEther(150);
            await veVANA.connect(user2).withdrawVANA(withdrawAmount2);
            (await veVANA.balanceOf(user2)).should.equal(depositAmount2 - withdrawAmount2);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount1 + depositAmount2 - withdrawAmount1 - withdrawAmount2);
            (await veVANA.getVotes(user1)).should.equal(depositAmount1 - withdrawAmount1);
            (await veVANA.getVotes(user2)).should.equal(depositAmount2 - withdrawAmount2);
            (await veVANA.getVotes(owner)).should.equal(0);

            const depositAmount3 = parseEther(250);
            await veVANA.connect(user1).depositVANA({ value: depositAmount3 });
            (await veVANA.balanceOf(user1)).should.equal(depositAmount1 - withdrawAmount1 + depositAmount3);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount1 + depositAmount2 + depositAmount3 - withdrawAmount1 - withdrawAmount2);
            (await veVANA.delegates(user1)).should.equal(user1.address);
            (await veVANA.getVotes(user1)).should.equal(depositAmount1 - withdrawAmount1 + depositAmount3);
            (await veVANA.getVotes(user2)).should.equal(depositAmount2 - withdrawAmount2);
            (await veVANA.getVotes(owner)).should.equal(0);

            let user1Votes = depositAmount1 - withdrawAmount1 + depositAmount3;
            let user2Votes = depositAmount2 - withdrawAmount2;
            (await veVANA.getVotes(user1)).should.equal(user1Votes);
            (await veVANA.connect(user1).delegate(dlp1.address));
            (await veVANA.getVotes(dlp1.address)).should.equal(user1Votes);
            (await veVANA.getVotes(user1)).should.equal(0);

            (await veVANA.getVotes(user2)).should.equal(user2Votes);
            (await veVANA.connect(user2).delegate(dlp2.address));
            (await veVANA.getVotes(dlp2.address)).should.equal(user2Votes);
            (await veVANA.getVotes(user2)).should.equal(0);

            (await veVANA.connect(user1).delegate(dlp2.address));
            (await veVANA.getVotes(dlp1.address)).should.equal(0);
            (await veVANA.getVotes(dlp2.address)).should.equal(user1Votes + user2Votes);

            (await veVANA.connect(user2).delegate(user2));
            (await veVANA.getVotes(dlp1.address)).should.equal(0);
            (await veVANA.getVotes(dlp2.address)).should.equal(user1Votes);

            const withdrawAmount3 = parseEther(10);
            await veVANA.connect(user1).withdrawVANA(withdrawAmount3);
            user1Votes -= withdrawAmount3;
            (await veVANA.balanceOf(user1)).should.equal(user1Votes);
            (await veVANA.getVotes(dlp2.address)).should.equal(user1Votes);

            const {
                constants,
            } = require('@openzeppelin/test-helpers');
            (await veVANA.connect(user1).delegate(constants.ZERO_ADDRESS));
            (await veVANA.getVotes(dlp1.address)).should.equal(0);
            (await veVANA.getVotes(dlp2.address)).should.equal(0);

            (await veVANA.connect(user1).delegate(dlp1.address));
            (await veVANA.getVotes(dlp1.address)).should.equal(user1Votes);
            (await veVANA.getVotes(dlp2.address)).should.equal(0);
        });
    });
});
