import { ethers, upgrades } from "hardhat";
import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getReceipt, parseEther } from "../utils/helpers";
import { IVeVANAVault, VeVANA, VeVANAVaultImplementation } from "../typechain-types";
import { dlp } from "../typechain-types/contracts";

chai.use(chaiAsPromised);
should();

describe("veVANA", function () {
    let veVANA: VeVANA;
    let owner: HardhatEthersSigner;
    let staker: HardhatEthersSigner;

    beforeEach(async function () {
        [owner, staker] = await ethers.getSigners();

        const veVANAFactory = await ethers.getContractFactory("VeVANA");
        veVANA = await veVANAFactory.deploy(owner.address);
    });

    describe("Deployment", function () {
        it("should have the correct name and symbol", async function () {
            (await veVANA.name()).should.equal("Vote-Escrowed VANA");
            (await veVANA.symbol()).should.equal("veVANA");
        });

        it("should have the correct decimals", async function () {
            (await veVANA.decimals()).should.equal(18);
        });

        it("should have the correct total supply", async function () {
            (await veVANA.totalSupply()).should.equal(0);
        });

        it("should have the correct owner", async function () {
            (await veVANA.owner()).should.equal(owner.address);
        });
    });

    describe("Deposit", function () {
        it("should allow depositing", async function () {
            const balanceBefore = await ethers.provider.getBalance(owner);
            const depositAmount = parseEther(100);
            const tx = await veVANA.connect(owner).depositVANA({ value: depositAmount });
            const receipt = await getReceipt(tx);
            (await veVANA.balanceOf(owner)).should.equal(depositAmount);
            (await veVANA.totalSupply()).should.equal(depositAmount);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount);
            (await ethers.provider.getBalance(owner)).should.equal(balanceBefore - depositAmount - receipt.fee);
        });

        it("should emit a Deposited event on deposit", async function () {
            const depositAmount = parseEther(100);
            await (veVANA.connect(owner).depositVANA({ value: depositAmount }))
                .should.emit(veVANA, "Deposited")
                .withArgs(owner.address, depositAmount);
        });

        it("should reject if the deposit amount is 0", async function () {
            await (veVANA.connect(owner).depositVANA({ value: 0 }))
                .should.be.revertedWithCustomError(veVANA, "DepositAmountMustBeGreaterThanZero");
        });

        it("should reject if the caller is not the owner", async function () {
            const depositAmount = parseEther(100);
            (staker.address).should.not.equal(owner.address);
            await (veVANA.connect(staker).depositVANA({ value: depositAmount }))
                .should.be.revertedWithCustomError(veVANA, "OwnableUnauthorizedAccount");
        });
    });

    describe("Withdraw", function () {
        it("should allow withdrawing", async function () {
            const depositAmount = parseEther(100);
            await veVANA.connect(owner).depositVANA({ value: depositAmount });
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount);

            const balanceBefore = await ethers.provider.getBalance(owner);
            const withdrawAmount = parseEther(25);
            const remainingAmount = depositAmount - withdrawAmount;
            let tx = await veVANA.connect(owner).withdrawVANA(withdrawAmount);
            let receipt = await getReceipt(tx);
            let txFee = receipt.fee;
            (await veVANA.balanceOf(owner)).should.equal(remainingAmount);
            (await ethers.provider.getBalance(owner)).should.eq(balanceBefore + withdrawAmount - txFee);
            (await ethers.provider.getBalance(veVANA)).should.equal(remainingAmount);

            tx = await veVANA.connect(owner).withdrawVANA(remainingAmount);
            receipt = await getReceipt(tx);
            txFee += receipt.fee;
            (await veVANA.balanceOf(owner)).should.equal(0);
            (await ethers.provider.getBalance(owner)).should.eq(balanceBefore + depositAmount - txFee);
            (await ethers.provider.getBalance(veVANA)).should.equal(0);
        });

        it("should emit a Withdrawn event on withdraw", async function () {
            const depositAmount = parseEther(100);
            await veVANA.connect(owner).depositVANA({ value: depositAmount });
            const withdrawAmount = parseEther(25);
            await (veVANA.connect(owner).withdrawVANA(withdrawAmount))
                .should.emit(veVANA, "Withdrawn")
                .withArgs(owner.address, withdrawAmount);
        });

        it("should reject if the withdraw amount is 0", async function () {
            await (veVANA.connect(owner).withdrawVANA(0))
                .should.be.rejectedWith("WithdrawAmountMustBeGreaterThanZero");
        });

        it("should reject if the withdrawn amount exceeds the balance", async function () {
            const depositAmount = parseEther(100);
            await veVANA.connect(owner).depositVANA({ value: depositAmount });
            const withdrawAmount = depositAmount + 1n;
            await (veVANA.connect(owner).withdrawVANA(withdrawAmount))
                .should.be.rejectedWith(`ERC20InsufficientBalance("${owner.address}", ${depositAmount}, ${withdrawAmount})`);
        });

        it("should reject if the caller is not the owner", async function () {
            (staker.address).should.not.equal(owner.address);
            await (veVANA.connect(staker).withdrawVANA(parseEther(100)))
                .should.be.rejectedWith("OwnableUnauthorizedAccount");
        });
    });

    describe("Ownership", function () {
        it("should allow transferring ownership", async function () {
            (await veVANA.owner()).should.equal(owner.address);
            await veVANA.connect(owner).transferOwnership(staker.address);
            (await veVANA.owner()).should.equal(staker.address);
        });

        it("should emit an OwnershipTransferred event on ownership transfer", async function () {
            await (veVANA.connect(owner).transferOwnership(staker.address))
                .should.emit(veVANA, "OwnershipTransferred")
                .withArgs(owner.address, staker.address);
        });

        it("should reject if the caller is not the owner", async function () {
            (staker.address).should.not.equal(owner.address);
            await (veVANA.connect(staker).transferOwnership(owner.address))
                .should.be.rejectedWith("OwnableUnauthorizedAccount");
        });

        it("should allow renouncing ownership", async function () {
            const {
                constants,
            } = require('@openzeppelin/test-helpers');

            (await veVANA.owner()).should.equal(owner.address);
            await veVANA.connect(owner).renounceOwnership();
            (await veVANA.owner()).should.equal(constants.ZERO_ADDRESS);
        });

        it("should allow anyone to deposit and withdraw after ownership is renounced", async function () {
            const {
                constants,
            } = require('@openzeppelin/test-helpers');

            await veVANA.connect(owner).renounceOwnership();
            (await veVANA.owner()).should.equal(constants.ZERO_ADDRESS);

            const depositAmount = parseEther(100);
            await veVANA.connect(staker).depositVANA({ value: depositAmount });
            (await veVANA.balanceOf(staker)).should.equal(depositAmount);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount);

            await veVANA.connect(staker).withdrawVANA(depositAmount);
            (await veVANA.balanceOf(staker)).should.equal(0);
            (await ethers.provider.getBalance(veVANA)).should.equal(0);
        });
    });

    describe("Governance", function () {
        it("should provide the correct voting power to veVANA holders", async function () {
            const depositAmount = parseEther(100);
            await veVANA.connect(owner).depositVANA({ value: depositAmount });
            (await veVANA.balanceOf(owner)).should.equal(depositAmount);

            (await veVANA.getVotes(owner.address)).should.equal(depositAmount);

            const depositAmount2 = parseEther(200);
            await veVANA.connect(owner).depositVANA({ value: depositAmount2 });
            (await veVANA.balanceOf(owner)).should.equal(depositAmount + depositAmount2);
            (await veVANA.getVotes(owner.address)).should.equal(depositAmount + depositAmount2);

            const withdrawAmount = parseEther(50);
            await veVANA.connect(owner).withdrawVANA(withdrawAmount);
            (await veVANA.balanceOf(owner)).should.equal(depositAmount + depositAmount2 - withdrawAmount);
            (await veVANA.getVotes(owner.address)).should.equal(depositAmount + depositAmount2 - withdrawAmount);

            const withdrawAmount2 = parseEther(250);
            await veVANA.connect(owner).withdrawVANA(withdrawAmount2);
            (await veVANA.balanceOf(owner)).should.equal(0);
            (await veVANA.getVotes(owner.address)).should.equal(0);
        });
    });
});

describe("veVANAVault", function () {
    let owner: HardhatEthersSigner;
    let user: HardhatEthersSigner;
    let user1: HardhatEthersSigner;

    let vault: VeVANAVaultImplementation;
    let veVANA: VeVANA;

    const deploy = async () => {
        [owner, user, user1] = await ethers.getSigners();

        const vaultDeploy = await upgrades.deployProxy(
            await ethers.getContractFactory("VeVANAVaultImplementation"),
            [owner.address],
            {
                kind: "uups",
            },
        );

        // Cast the proxy to the implementation interface
        vault = await ethers.getContractAt(
            "VeVANAVaultImplementation",
            vaultDeploy.target,
        );

        const veVANAFactory = await ethers.getContractFactory("VeVANA");
        veVANA = await veVANAFactory.deploy(vault);

        await vault.connect(owner).updateToken(veVANA);
    };

    describe("Setup", function () {
        beforeEach(async function () {
            await deploy();
        });

        it("should have correct params after deploy", async function () {
            (await vault.hasRole(await vault.DEFAULT_ADMIN_ROLE(), owner.address)).should.be.true;
            (await vault.version()).should.equal(1);
            (await vault.token()).should.equal(veVANA);
        });

        it("should be the owner of veVANA", async function () {
            (await veVANA.owner()).should.equal(vault);
        });
    });

    describe("Permissions", function () {
        beforeEach(async function () {
            await deploy();
        });

        it("should allow the admin to update the token", async function () {
            const newVeVANA = await ethers.getContractFactory("VeVANA").then((factory) => factory.deploy(vault));
            await vault.connect(owner).updateToken(newVeVANA)
                .should.emit(vault, "TokenUpdated")
                .withArgs(newVeVANA);
            (await vault.token()).should.equal(newVeVANA);
        });

        it("should allow the admin to pause and unpause", async function () {
            await vault.connect(owner).pause()
                .should.emit(vault, "Paused")
                .withArgs(owner.address);
            (await vault.paused()).should.be.true;

            await vault.connect(owner).unpause()
                .should.emit(vault, "Unpaused")
                .withArgs(owner.address);
            (await vault.paused()).should.be.false;
        });

        it("should allow the admin to upgrade the implementation", async function () {
            const newVaultImpl = await ethers.getContractFactory("VeVANAVaultImplementation").then((factory) => factory.deploy());
            await vault.connect(owner).upgradeToAndCall(newVaultImpl, "0x")
                .should.emit(vault, "Upgraded")
                .withArgs(newVaultImpl);
        });

        it("should allow the admin to renounce the token ownership", async function () {
            const {
                constants,
            } = require('@openzeppelin/test-helpers');
            await vault.connect(owner).renounceTokenOwnership()
                .should.emit(vault, "TokenOwnershipRenounced");
            (await veVANA.owner()).should.equal(constants.ZERO_ADDRESS);
        });

        it("should reject if a non-admin tries to do the admin tasks", async function () {
            const newVeVANA = await ethers.getContractFactory("VeVANA").then((factory) => factory.deploy(vault));
            await vault.connect(user).updateToken(newVeVANA)
                .should.be.rejectedWith("AccessControlUnauthorizedAccount");

            await vault.connect(user).pause()
                .should.be.rejectedWith("AccessControlUnauthorizedAccount");

            await vault.connect(user).unpause()
                .should.be.rejectedWith("AccessControlUnauthorizedAccount");

            await vault.connect(user).renounceTokenOwnership()
                .should.be.rejectedWith("AccessControlUnauthorizedAccount");

            const {
                constants,
            } = require('@openzeppelin/test-helpers');
            await vault.connect(user).upgradeToAndCall(constants.ZERO_ADDRESS, "0x")
                .should.be.rejectedWith("AccessControlUnauthorizedAccount");
        });
    });

    describe("Deposit", function () {
        beforeEach(async function () {
            await deploy();
        });

        it("should allow depositing via the vault", async function () {
            (await veVANA.balanceOf(user)).should.equal(0);
            (await ethers.provider.getBalance(veVANA)).should.equal(0);
            const depositAmount = parseEther(100);
            await vault.connect(user).depositVANA({ value: depositAmount })
                .should.emit(vault, "Deposited").withArgs(user.address, depositAmount);
            (await veVANA.balanceOf(user)).should.equal(depositAmount);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount);
            // vault should not hold any VANA
            (await ethers.provider.getBalance(vault)).should.equal(0);
        });

        it("should reject if the deposit amount is 0", async function () {
            await (vault.connect(user).depositVANA({ value: 0 }))
                .should.be.rejectedWith("DepositAmountMustBeGreaterThanZero");
        });

        it("should reject direct deposits to veVANA", async function () {
            const depositAmount = parseEther(100);
            await (veVANA.connect(owner).depositVANA({ value: depositAmount }))
                .should.be.rejectedWith("OwnableUnauthorizedAccount");
            await (veVANA.connect(user).depositVANA({ value: depositAmount }))
                .should.be.rejectedWith("OwnableUnauthorizedAccount");
        });

        it("should allow direct deposits to veVANA after renouncing token ownership", async function () {
            const {
                constants,
            } = require('@openzeppelin/test-helpers');
            await vault.connect(owner).renounceTokenOwnership();
            (await veVANA.owner()).should.equal(constants.ZERO_ADDRESS);

            const depositAmount = parseEther(100);
            await veVANA.connect(user).depositVANA({ value: depositAmount });
            (await veVANA.balanceOf(user)).should.equal(depositAmount);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount);
        });
    });

    describe("Withdraw", function () {
        beforeEach(async function () {
            await deploy();
        });

        it("should allow withdrawing via the vault", async function () {
            const depositAmount = parseEther(100);
            await vault.connect(user).depositVANA({ value: depositAmount });
            (await veVANA.balanceOf(user)).should.equal(depositAmount);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount);

            const balanceBefore = await ethers.provider.getBalance(user);
            const withdrawAmount = parseEther(25);
            let tx = await veVANA.connect(user).approve(vault, withdrawAmount);
            let receipt = await getReceipt(tx);
            let txFee = receipt.fee;
            tx = await vault.connect(user).withdrawVANA(withdrawAmount);
            receipt = await getReceipt(tx);
            txFee += receipt.fee;
            tx.should.emit(vault, "Withdrawn").withArgs(user.address, withdrawAmount);
            (await veVANA.balanceOf(user)).should.equal(depositAmount - withdrawAmount);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount - withdrawAmount);
            (await ethers.provider.getBalance(user)).should.be.eq(balanceBefore + withdrawAmount - txFee);
            (await ethers.provider.getBalance(vault)).should.equal(0);
        });

        it("should reject if the withdraw amount is 0", async function () {
            await (vault.connect(user).withdrawVANA(0))
                .should.be.rejectedWith("WithdrawAmountMustBeGreaterThanZero");
        });

        it("should reject if the caller has not approved the vault to spend the withdraw amount", async function () {
            const depositAmount = parseEther(100);
            await vault.connect(user).depositVANA({ value: depositAmount });
            const withdrawAmount = parseEther(25);
            await (vault.connect(user).withdrawVANA(withdrawAmount))
                .should.be.rejectedWith("ERC20InsufficientAllowance");
        });

        it("should reject if the withdrawn amount exceeds the balance", async function () {
            const depositAmount = parseEther(100);
            await vault.connect(user).depositVANA({ value: depositAmount });
            const withdrawAmount = depositAmount + 1n;
            await veVANA.connect(user).approve(vault, withdrawAmount);
            await (vault.connect(user).withdrawVANA(withdrawAmount))
                .should.be.rejectedWith(`ERC20InsufficientBalance("${user.address}", ${depositAmount}, ${withdrawAmount})`);
        });

        it("should reject direct withdrawals from veVANA", async function () {
            const depositAmount = parseEther(100);
            await vault.connect(owner).depositVANA({ value: depositAmount });
            await (veVANA.connect(owner).withdrawVANA(depositAmount))
                .should.be.rejectedWith("OwnableUnauthorizedAccount");
        });

        it("should allow direct withdrawals from veVANA after renouncing token ownership", async function () {
            const {
                constants,
            } = require('@openzeppelin/test-helpers');

            const depositAmount = parseEther(100);
            await vault.connect(user).depositVANA({ value: depositAmount });
            (await veVANA.balanceOf(user)).should.equal(depositAmount);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount);

            await vault.connect(owner).renounceTokenOwnership();
            (await veVANA.owner()).should.equal(constants.ZERO_ADDRESS);

            const balanceBefore = await ethers.provider.getBalance(user);
            const withdrawAmount = parseEther(25);
            // The user now can withdraw directly from veVANA
            const tx = await veVANA.connect(user).withdrawVANA(withdrawAmount);
            const receipt = await getReceipt(tx);
            const txFee = receipt.fee;
            tx.should.emit(veVANA, "Withdrawn").withArgs(user.address, withdrawAmount);
            (await veVANA.balanceOf(user)).should.equal(depositAmount - withdrawAmount);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount - withdrawAmount);
            (await ethers.provider.getBalance(user)).should.be.eq(balanceBefore + withdrawAmount - txFee);
        });
    });

    describe("Governance", function () {
        beforeEach(async function () {
            await deploy();
        });

        it("should provide the correct voting power to veVANA holders", async function () {
            let [dlp1, dlp2] = await ethers.getSigners();
            const depositAmount = parseEther(100);
            (await veVANA.connect(user).delegate(user.address));
            await vault.connect(user).depositVANA({ value: depositAmount });
            (await veVANA.balanceOf(user)).should.equal(depositAmount);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount);
            (await veVANA.delegates(user)).should.equal(user.address);
            (await veVANA.getVotes(user)).should.equal(depositAmount);
            (await veVANA.getVotes(vault)).should.equal(0);

            const depositAmount1 = parseEther(200);
            (await veVANA.connect(user1).delegate(user1.address));
            await vault.connect(user1).depositVANA({ value: depositAmount1 });
            (await veVANA.balanceOf(user1)).should.equal(depositAmount1);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount + depositAmount1);
            (await veVANA.delegates(user1)).should.equal(user1.address);
            (await veVANA.getVotes(user1)).should.equal(depositAmount1);
            (await veVANA.getVotes(user)).should.equal(depositAmount);
            (await veVANA.getVotes(vault)).should.equal(0);

            const withdrawAmount = parseEther(50);
            await veVANA.connect(user).approve(vault, withdrawAmount);
            await vault.connect(user).withdrawVANA(withdrawAmount);
            (await veVANA.balanceOf(user)).should.equal(depositAmount - withdrawAmount);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount + depositAmount1 - withdrawAmount);
            (await veVANA.getVotes(user)).should.equal(depositAmount - withdrawAmount);
            (await veVANA.getVotes(user1)).should.equal(depositAmount1);
            (await veVANA.getVotes(vault)).should.equal(0);

            const withdrawAmount1 = parseEther(150);
            await veVANA.connect(user1).approve(vault, withdrawAmount1);
            await vault.connect(user1).withdrawVANA(withdrawAmount1);
            (await veVANA.balanceOf(user1)).should.equal(depositAmount1 - withdrawAmount1);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount + depositAmount1 - withdrawAmount - withdrawAmount1);
            (await veVANA.getVotes(user)).should.equal(depositAmount - withdrawAmount);
            (await veVANA.getVotes(user1)).should.equal(depositAmount1 - withdrawAmount1);
            (await veVANA.getVotes(vault)).should.equal(0);

            const depositAmount2 = parseEther(250);
            await vault.connect(user1).depositVANA({ value: depositAmount2 });
            (await veVANA.balanceOf(user1)).should.equal(depositAmount1 - withdrawAmount1 + depositAmount2);
            (await ethers.provider.getBalance(veVANA)).should.equal(depositAmount + depositAmount1 + depositAmount2 - withdrawAmount - withdrawAmount1);
            (await veVANA.delegates(user1)).should.equal(user1.address);
            (await veVANA.getVotes(user1)).should.equal(depositAmount1 - withdrawAmount1 + depositAmount2);
            (await veVANA.getVotes(user)).should.equal(depositAmount - withdrawAmount);
            (await veVANA.getVotes(vault)).should.equal(0);

            let userVotes = depositAmount - withdrawAmount;
            let user1Votes = depositAmount1 - withdrawAmount1 + depositAmount2;
            (await veVANA.getVotes(user)).should.equal(userVotes);
            (await veVANA.connect(user).delegate(dlp1.address));
            (await veVANA.getVotes(dlp1.address)).should.equal(userVotes);
            (await veVANA.getVotes(user)).should.equal(0);

            (await veVANA.getVotes(user1)).should.equal(user1Votes);
            (await veVANA.connect(user1).delegate(dlp2.address));
            (await veVANA.getVotes(dlp2.address)).should.equal(user1Votes);
            (await veVANA.getVotes(user1)).should.equal(0);

            (await veVANA.connect(user).delegate(dlp2.address));
            (await veVANA.getVotes(dlp1.address)).should.equal(0);
            (await veVANA.getVotes(dlp2.address)).should.equal(userVotes + user1Votes);

            (await veVANA.connect(user1).delegate(user1));
            (await veVANA.getVotes(dlp1.address)).should.equal(0);
            (await veVANA.getVotes(dlp2.address)).should.equal(userVotes);

            const {
                constants,
            } = require('@openzeppelin/test-helpers');
            (await veVANA.connect(user).delegate(constants.ZERO_ADDRESS));
            (await veVANA.getVotes(dlp1.address)).should.equal(0);
            (await veVANA.getVotes(dlp2.address)).should.equal(0);

            (await veVANA.connect(user).delegate(dlp1.address));
            (await veVANA.getVotes(dlp1.address)).should.equal(userVotes);
            (await veVANA.getVotes(dlp2.address)).should.equal(0);
        });
    });
});