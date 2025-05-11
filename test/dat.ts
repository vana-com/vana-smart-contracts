import chai, { expect, should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, network, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getReceipt, parseEther } from "../utils/helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import {
    DAT, DATPausable, DATVotes, CloneHelper,
    DATFactoryImplementation, VestingWallet,
} from "../typechain-types";
import { Contract, EventLog } from "ethers";
import { get } from "http";
import { dat } from "../typechain-types/contracts";
import { token } from "../typechain-types/@openzeppelin/contracts";

chai.use(chaiAsPromised);
should();

describe("DAT", function () {
    let owner: HardhatEthersSigner;
    let maintainer: HardhatEthersSigner;
    let admin: HardhatEthersSigner;
    let beneficiary1: HardhatEthersSigner;
    let beneficiary2: HardhatEthersSigner;
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;
    let user3: HardhatEthersSigner;

    let datToken: DAT;
    let cloneHelper: CloneHelper;

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

    const amount1 = parseEther(1_000_000);
    const amount2 = parseEther(2_000_000);

    // Define a deploy function to reuse
    async function deploy(datContractName: string) {
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

        // Deploy DAT
        const datFactory = await ethers.getContractFactory(datContractName);
        const datImplementation = await datFactory.deploy()
            .then((instance) => instance.waitForDeployment()) as DAT;

        const cloneFactory = await ethers.getContractFactory("CloneHelper");
        cloneHelper = await cloneFactory.deploy()
            .then((instance) => instance.waitForDeployment());

        await cloneHelper.clone(datImplementation.target);

        const datTokenAddress = await cloneHelper.predictDeterministicAddress(datImplementation.target);

        datToken = (await ethers.getContractAt("DAT", datTokenAddress)) as DAT;

        await datToken.initialize(
            tokenName, tokenSymbol, owner.address, tokenCap,
            [beneficiary1, beneficiary2], [amount1, amount2],
        );
    }

    function testBaseDAT(datContractName: string) {
        beforeEach(async () => {
            await deploy(datContractName);
        });

        return () => {
            describe("Token Functionality", () => {
                it("should deploy correct DAT contract", async function () {
                    (await datToken.templateName()).should.eq(datContractName);
                });

                it("should have the correct initial parameters", async function () {
                    (await datToken.name()).should.eq(tokenName);
                    (await datToken.symbol()).should.eq(tokenSymbol);
                    (await datToken.cap()).should.eq(tokenCap);
                });

                it("should have the correct roles set", async function () {
                    (await datToken.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).should.eq(
                        true,
                    );
                    (await datToken.hasRole(MINTER_ROLE, owner.address)).should.eq(true);
                });

                it("should have max cap when init cap is 0", async function () {
                    const datFactory = await ethers.getContractFactory("DAT");
                    const datImplementation = await datFactory.deploy()
                        .then((instance) => instance.waitForDeployment()) as DAT;

                    await cloneHelper.clone(datImplementation.target);

                    const datTokenAddress = await cloneHelper.predictDeterministicAddress(datImplementation.target);

                    const datToken = (await ethers.getContractAt("DAT", datTokenAddress)) as DAT;

                    await datToken.initialize(
                        tokenName, tokenSymbol, owner.address, 0,
                        [beneficiary1, beneficiary2], [amount1, amount2],
                    );

                    (await datToken.cap()).should.eq(ethers.MaxUint256);
                });

                it("should mint to the correct beneficiaries", async function () {
                    const balance1 = await datToken.balanceOf(beneficiary1.address);
                    const balance2 = await datToken.balanceOf(beneficiary2.address);
                    const totalSupply = await datToken.totalSupply();
                    const expectedTotalSupply = amount1 + amount2;
                    (balance1).should.eq(amount1);
                    (balance2).should.eq(amount2);
                    (totalSupply).should.eq(expectedTotalSupply);
                    (totalSupply).should.lte(tokenCap);
                });

                it("should revert when initializing with incorrect parameters", async function () {
                    const datFactory = await ethers.getContractFactory("DAT");
                    const datImplementation = await datFactory.deploy()
                        .then((instance) => instance.waitForDeployment()) as DAT;

                    await cloneHelper.clone(datImplementation.target);

                    const datTokenAddress = await cloneHelper.predictDeterministicAddress(datImplementation.target);

                    const datToken = (await ethers.getContractAt("DAT", datTokenAddress)) as DAT;

                    await datToken
                        .initialize(
                            "", tokenSymbol, owner.address, 0,
                            [beneficiary1, beneficiary2], [amount1, amount2],
                        )
                        .should.be.rejectedWith(`EmptyString("name")`);

                    await datToken
                        .initialize(
                            tokenName, "", owner.address, 0,
                            [beneficiary1, beneficiary2], [amount1, amount2],
                        )
                        .should.be.rejectedWith(`EmptyString("symbol")`);

                    await datToken
                        .initialize(
                            tokenName, tokenSymbol, ethers.ZeroAddress, 0,
                            [beneficiary1, beneficiary2], [amount1, amount2],
                        )
                        .should.be.rejectedWith(`ZeroAddress()`);

                    await datToken
                        .initialize(
                            tokenName, tokenSymbol, owner.address, 0,
                            [beneficiary1], [amount1, amount2],
                        )
                        .should.be.rejectedWith(`ArrayLengthMismatch(1, 2)`);

                    await datToken
                        .initialize(
                            tokenName, tokenSymbol, owner.address, 0,
                            [beneficiary1, beneficiary2], [0, amount2],
                        )
                        .should.be.rejectedWith(`ZeroAmount()`);

                    await datToken
                        .initialize(
                            tokenName, tokenSymbol, owner.address, 0,
                            [beneficiary1, beneficiary2], [amount1, 0],
                        )
                        .should.be.rejectedWith(`ZeroAmount()`);

                    await datToken
                        .initialize(
                            tokenName, tokenSymbol, owner.address, 0,
                            [ethers.ZeroAddress, beneficiary2], [amount1, amount2],
                        )
                        .should.be.rejectedWith(`ERC20InvalidReceiver("${ethers.ZeroAddress}")`);

                    await datToken
                        .initialize(
                            tokenName, tokenSymbol, owner.address, 0,
                            [beneficiary1, ethers.ZeroAddress], [amount1, amount2],
                        )
                        .should.be.rejectedWith(`ERC20InvalidReceiver("${ethers.ZeroAddress}")`);
                });

                it("should mint by minter role only", async function () {
                    const mintAmount = parseEther(1_000_000);
                    const totalSupplyBefore = await datToken.totalSupply();
                    const balanceBefore = await datToken.balanceOf(user1.address);

                    await datToken.connect(owner).mint(user1.address, mintAmount);
                    (await datToken.balanceOf(user1.address)).should.eq(balanceBefore + mintAmount);
                    (await datToken.totalSupply()).should.eq(totalSupplyBefore + mintAmount);
                    (await datToken.totalSupply()).should.lte(tokenCap);

                    await datToken.connect(user1).mint(user1.address, mintAmount)
                        .should.be.rejectedWith(
                            `AccessControlUnauthorizedAccount("${user1.address}", "${MINTER_ROLE}")`,
                        );
                });

                it("should not mint with invalid parameters", async function () {
                    await datToken.connect(owner).mint(user1.address, 0)
                        .should.be.rejectedWith(`ZeroAmount()`);

                    await datToken.connect(owner).mint(ethers.ZeroAddress, 1)
                        .should.be.rejectedWith(`ERC20InvalidReceiver("${ethers.ZeroAddress}")`);
                });

                it("should not mint over cap", async function () {
                    const totalSupplyBefore = await datToken.totalSupply();
                    const balanceBefore = await datToken.balanceOf(user1.address);

                    const mintAmount = tokenCap - totalSupplyBefore + 1n;
                    await datToken.connect(owner).mint(user1.address, mintAmount)
                        .should.be.rejectedWith(`ERC20ExceededCap(${tokenCap + 1n}, ${tokenCap})`);

                    await datToken.connect(owner).mint(user1.address, tokenCap - totalSupplyBefore);
                    (await datToken.balanceOf(user1.address)).should.eq(balanceBefore + tokenCap - totalSupplyBefore);
                    (await datToken.totalSupply()).should.eq(tokenCap);
                });

                it("should transfer tokens", async function () {
                    // First mint to user1
                    const mintAmount = parseEther(100);
                    await datToken.connect(owner).mint(user1.address, mintAmount);

                    // Then transfer some to user2
                    const transferAmount = parseEther(30);
                    await datToken.connect(user1).transfer(user2.address, transferAmount);

                    // Verify balances
                    (await datToken.balanceOf(user1.address)).should.eq(
                        mintAmount - transferAmount,
                    );
                    (await datToken.balanceOf(user2.address)).should.eq(transferAmount);

                    await datToken.connect(user1).transfer(ethers.ZeroAddress, transferAmount)
                        .should.be.rejectedWith(
                            `ERC20InvalidReceiver("${ethers.ZeroAddress}")`,
                        );

                    const excessiveTransferAmount = (await datToken.balanceOf(user1.address)) + 1n;
                    await datToken.connect(user1).transfer(user2.address, excessiveTransferAmount)
                        .should.be.rejectedWith(
                            `ERC20InsufficientBalance("${user1.address}", ${await datToken.balanceOf(user1.address)}, ${excessiveTransferAmount})`,
                        );
                });

                it("should approve and transferFrom", async function () {
                    // Mint to user1
                    const mintAmount = parseEther(100);
                    await datToken.connect(owner).mint(user1.address, mintAmount);

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
            });

            describe("Block List Functionality", () => {
                it("should block addresses only when admin", async function () {
                    // First mint to user1
                    const mintAmount = parseEther(100);
                    await datToken.connect(owner).mint(user1.address, mintAmount);

                    await datToken
                        .connect(user1)
                        .transfer(user2.address, parseEther(10))
                        .should.be.fulfilled;

                    // Block user1
                    await datToken
                        .connect(owner)
                        .blockAddress(user1.address)
                        .should.emit(datToken, "AddressBlocked")
                        .withArgs(user1.address);

                    // Verify user1 is in block list
                    (await datToken.blockListLength()).should.eq(1);
                    (await datToken.blockListAt(0)).should.eq(user1.address);
                    (await datToken.isBlocked(user1.address)).should.eq(true);
                    (await datToken.isBlocked(user2.address)).should.eq(false);
                    (await datToken.isBlocked(beneficiary1.address)).should.eq(false);

                    // Try to transfer to and from - should fail
                    await datToken
                        .connect(user1)
                        .transfer(user2.address, parseEther(10))
                        .should.be.rejectedWith("AccountBlocked");

                    await datToken
                        .connect(beneficiary1)
                        .transfer(user1.address, parseEther(10))
                        .should.be.rejectedWith("AccountBlocked");
                });

                it("should unblock addresses only when admin", async function () {
                    const mintAmount = parseEther(100);
                    await datToken.connect(owner).mint(user1.address, mintAmount);

                    // Block user1
                    await datToken.connect(owner).blockAddress(user1.address);
                    (await datToken.blockListLength()).should.eq(1);
                    (await datToken.blockListAt(0)).should.eq(user1.address);
                    (await datToken.isBlocked(user1.address)).should.eq(true);
                    (await datToken.isBlocked(user2.address)).should.eq(false);
                    (await datToken.isBlocked(beneficiary1.address)).should.eq(false);

                    await datToken
                        .connect(user1)
                        .transfer(user2.address, parseEther(10))
                        .should.be.rejectedWith("AccountBlocked");

                    await datToken
                        .connect(beneficiary1)
                        .transfer(user1.address, parseEther(10))
                        .should.be.rejectedWith("AccountBlocked");

                    // Unblock user1
                    await datToken
                        .connect(owner)
                        .unblockAddress(user1.address)
                        .should.emit(datToken, "AddressUnblocked")
                        .withArgs(user1.address);

                    (await datToken.blockListLength()).should.eq(0);
                    (await datToken.isBlocked(user1.address)).should.eq(false);

                    // Now transfers should work
                    const user1BalanceBefore = await datToken.balanceOf(user1.address);
                    const user2BalanceBefore = await datToken.balanceOf(user2.address);
                    const beneficiary1BalanceBefore = await datToken.balanceOf(beneficiary1.address);

                    const transferAmount1 = parseEther(10);
                    const transferAmount2 = parseEther(20);
                    await datToken.connect(user1).transfer(user2.address, transferAmount1)
                        .should.not.be.rejected;
                    await datToken.connect(beneficiary1).transfer(user1.address, transferAmount2)
                        .should.not.be.rejected;
                    (await datToken.balanceOf(user1.address)).should.eq(
                        user1BalanceBefore - transferAmount1 + transferAmount2,
                    );
                    (await datToken.balanceOf(user2.address)).should.eq(
                        user2BalanceBefore + transferAmount1,
                    );
                    (await datToken.balanceOf(beneficiary1.address)).should.eq(
                        beneficiary1BalanceBefore - transferAmount2,
                    );
                });

                it("should reject blockAddress by non-admin", async function () {
                    await datToken
                        .connect(user1)
                        .blockAddress(user2.address)
                        .should.be.rejectedWith(`AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`);
                });

                it("should reject unblockAddress by non-admin", async function () {
                    await datToken.connect(owner).blockAddress(user2.address);

                    await datToken
                        .connect(user1)
                        .unblockAddress(user2.address)
                        .should.be.rejectedWith(`AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`);
                });

                it("should reject unblockAddress for address not in blocklist", async function () {
                    await datToken
                        .connect(owner)
                        .unblockAddress(user1.address)
                        .should.be.rejectedWith("BlockListDoesNotContain");
                });

                it("should reject blocking zero address", async function () {
                    await datToken
                        .connect(owner)
                        .blockAddress(ethers.ZeroAddress)
                        .should.be.rejectedWith("BlockingRejected");
                });

                it("should not re-add already blocked address", async function () {
                    // Block user1
                    await datToken
                        .connect(owner)
                        .blockAddress(user1.address)
                        .should.emit(datToken, "AddressBlocked");

                    // Try blocking again - no event should be emitted
                    const tx = await datToken.connect(owner).blockAddress(user1.address);
                    const receipt = await getReceipt(tx);

                    const blockEvents = receipt.logs.filter(
                        (log) => (log as EventLog).fragment?.name === "AddressBlocked",
                    );
                    blockEvents.length.should.eq(0);

                    // Verify only one occurrence in list
                    (await datToken.blockListLength()).should.eq(1);
                    (await datToken.blockListAt(0)).should.eq(user1.address);
                });

                it("should reject transfers to/from blocked addresses", async function () {
                    // Mint to user1 and user2
                    const mintAmount = parseEther(100);
                    await datToken.connect(owner).mint(user1.address, mintAmount);
                    await datToken.connect(owner).mint(user2.address, mintAmount);

                    // Block user2
                    await datToken.connect(owner).blockAddress(user2.address);

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

                it("should reject transferFrom to/from blocked addresses", async function () {
                    // Mint to user1 and user2
                    const mintAmount = parseEther(100);
                    await datToken.connect(owner).mint(user1.address, mintAmount);
                    await datToken.connect(owner).mint(user2.address, mintAmount);

                    // Block user2
                    await datToken.connect(owner).blockAddress(user2.address);

                    // Try to transfer from user1 to user2 - should fail
                    await datToken
                        .connect(user1)
                        .approve(user2.address, parseEther(10));

                    await datToken
                        .connect(user2)
                        .transferFrom(user1.address, user2.address, parseEther(10))
                        .should.be.rejectedWith("AccountBlocked");

                    await datToken
                        .connect(user2)
                        .transferFrom(user1.address, user3.address, parseEther(10))
                        .should.not.be.rejected;

                    // Try to transfer from user2 to user1 - should fail
                    await datToken
                        .connect(user2)
                        .approve(user1.address, parseEther(10));

                    await datToken
                        .connect(user1)
                        .transferFrom(user2.address, user1.address, parseEther(10))
                        .should.be.rejectedWith("AccountBlocked");
                });

                it("should block transferFrom when sender or recipient is blocked", async function () {
                    // Mint to user1
                    const mintAmount = parseEther(100);
                    await datToken.connect(owner).mint(user1.address, mintAmount);

                    // Approve user2 to spend
                    const approveAmount = parseEther(30);
                    await datToken.connect(user1).approve(user2.address, approveAmount);

                    // Block user3
                    await datToken.connect(owner).blockAddress(user3.address);

                    // User2 tries to transfer from user1 to user3 - should fail
                    await datToken
                        .connect(user2)
                        .transferFrom(user1.address, user3.address, parseEther(10))
                        .should.be.rejectedWith("AccountBlocked");

                    // Block user1
                    await datToken.connect(owner).blockAddress(user1.address);

                    // User2 tries to transfer from user1 to user2 - should fail
                    await datToken
                        .connect(user2)
                        .transferFrom(user1.address, user2.address, parseEther(10))
                        .should.be.rejectedWith("AccountBlocked");
                });

                it("should reject blockListAt for out of bounds index", async function () {
                    await datToken
                        .blockListAt(0)
                        .should.be.rejectedWith("IndexOutOfBounds");

                    // Block one address
                    await datToken.connect(owner).blockAddress(user1.address);

                    // This should work
                    (await datToken.blockListAt(0)).should.eq(user1.address);

                    // This should fail
                    await datToken
                        .blockListAt(1)
                        .should.be.rejectedWith("IndexOutOfBounds");
                });
            });

            describe("Role Management", () => {
                it("should allow admin to grant/revoke roles", async function () {
                    // Grant minter role to user1
                    await datToken.connect(owner).grantRole(MINTER_ROLE, user1.address);

                    // Check user1 has minter role
                    (await datToken.hasRole(MINTER_ROLE, user1.address)).should.eq(true);

                    // User1 should be able to mint
                    await datToken.connect(user1).mint(user2.address, parseEther(100))
                        .should.not.be.rejected;

                    // Revoke minter role from user1
                    await datToken.connect(owner).revokeRole(MINTER_ROLE, user1.address);

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
                    await datToken.connect(owner).grantRole(MINTER_ROLE, user1.address);

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
        }
    }

    function testDATVotes(datContractName: string) {
        let datVotesToken: DATVotes;

        beforeEach(async () => {
            await deploy(datContractName);
            datVotesToken = await ethers.getContractAt("DATVotes", datToken.target);
        });

        return () => {
            describe("Voting Functionality", () => {
                it("should deploy correct DAT contract", async function () {
                    (await datVotesToken.templateName()).should.eq(datContractName);
                    datVotesToken.target.should.eq(datToken.target);
                });

                it("should track voting power when tokens are transferred", async function () {
                    // Mint to user1
                    const mintAmount = parseEther(100);
                    await datVotesToken.connect(owner).mint(user1.address, mintAmount);

                    // Check voting power
                    (await datVotesToken.getVotes(user1.address)).should.eq(0); // No delegation yet

                    // Delegate to self
                    await datVotesToken.connect(user1).delegate(user1.address);

                    // Check voting power after delegation
                    (await datVotesToken.getVotes(user1.address)).should.eq(mintAmount);

                    // Transfer to user2
                    const transferAmount = parseEther(30);
                    await datVotesToken.connect(user1).transfer(user2.address, transferAmount);

                    // Check updated voting power
                    (await datVotesToken.getVotes(user1.address)).should.eq(
                        mintAmount - transferAmount,
                    );
                    (await datVotesToken.getVotes(user2.address)).should.eq(0); // User2 hasn't delegated

                    // User2 delegates to self
                    await datVotesToken.connect(user2).delegate(user2.address);
                    (await datVotesToken.getVotes(user2.address)).should.eq(transferAmount);
                });

                it("should handle delegation to another address", async function () {
                    // Mint to user1 and user2
                    const amount1 = parseEther(100);
                    const amount2 = parseEther(200);
                    await datVotesToken.connect(owner).mint(user1.address, amount1);
                    await datVotesToken.connect(owner).mint(user2.address, amount2);

                    // User1 delegates to user3
                    await datVotesToken.connect(user1).delegate(user3.address);

                    // User2 delegates to user3
                    await datVotesToken.connect(user2).delegate(user3.address);

                    // Check voting power
                    (await datVotesToken.getVotes(user1.address)).should.eq(0);
                    (await datVotesToken.getVotes(user2.address)).should.eq(0);
                    (await datVotesToken.getVotes(user3.address)).should.eq(amount1 + amount2);
                });

                it("should reject delegation to blocked address", async function () {
                    // Block user2
                    await datVotesToken.connect(owner).blockAddress(user2.address);

                    // Mint to user1
                    const mintAmount = parseEther(100);
                    await datVotesToken.connect(owner).mint(user1.address, mintAmount);

                    // Try to delegate to blocked address
                    await datVotesToken
                        .connect(user1)
                        .delegate(user2.address)
                        .should.be.rejectedWith("AccountBlocked");
                });

                it("should reject delegation when delegator is blocked", async function () {
                    // Mint to user1
                    const mintAmount = parseEther(100);
                    await datVotesToken.connect(owner).mint(user1.address, mintAmount);

                    // Block user1
                    await datVotesToken.connect(owner).blockAddress(user1.address);

                    // Try to delegate
                    await datVotesToken
                        .connect(user1)
                        .delegate(user2.address)
                        .should.be.rejectedWith("AccountBlocked");
                });
            });

            describe("ERC20Permits Functionality", () => {
                it("should support ERC20 permit", async function () {
                    // Mint to owner
                    const mintAmount = parseEther(100);
                    await datVotesToken.connect(owner).mint(owner.address, mintAmount);

                    // Get current deadline
                    const deadline = (await time.latest()) + 3600; // 1 hour from now

                    // Create permit signature
                    const nonce = await datVotesToken.nonces(owner.address);
                    const chainId = await ethers.provider.getNetwork().then(n => BigInt(n.chainId));

                    // Domain separator parameters
                    const domain = {
                        name: await datVotesToken.name(),
                        version: "1",
                        chainId: chainId,
                        verifyingContract: datVotesToken.target.toString(),
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
                    await datVotesToken
                        .connect(user1)
                        .permit(owner.address, user1.address, mintAmount, deadline, v, r, s);

                    // Check allowance was set
                    (await datVotesToken.allowance(owner.address, user1.address)).should.eq(
                        mintAmount,
                    );

                    // User1 can now transferFrom
                    await datVotesToken
                        .connect(user1)
                        .transferFrom(owner.address, user2.address, mintAmount);

                    // Verify balances
                    (await datVotesToken.balanceOf(owner.address)).should.eq(0);
                    (await datVotesToken.balanceOf(user2.address)).should.eq(mintAmount);
                });
            });
        }
    }

    function testDATPausable(datContractName: string) {
        let datPausableToken: DATPausable;

        beforeEach(async () => {
            await deploy(datContractName);
            datPausableToken = await ethers.getContractAt("DATPausable", datToken.target);
        });

        return () => {
            describe("Pausing Functionality", () => {
                it("should deploy correct DAT contract", async function () {
                    (await datPausableToken.templateName()).should.eq(datContractName);
                    datPausableToken.target.should.eq(datToken.target);
                });

                it("should allow admin to pause the token", async function () {
                    // Pause the token
                    await datPausableToken.connect(owner).pause().should.emit(datPausableToken, "Paused");

                    (await datPausableToken.paused()).should.eq(true);

                    // Mint to user1
                    const mintAmount = parseEther(100);
                    await datPausableToken.connect(owner).mint(user1.address, mintAmount)
                        .should.be.rejectedWith("EnforcedPause");

                    // Try to transfer - should fail
                    await datPausableToken
                        .connect(user1)
                        .transfer(user2.address, parseEther(10))
                        .should.be.rejectedWith("EnforcedPause");
                });

                it("should allow admin to unpause the token", async function () {
                    // Pause the token
                    await datPausableToken.connect(owner).pause();

                    // Unpause the token
                    await datPausableToken
                        .connect(owner)
                        .unpause()
                        .should.emit(datPausableToken, "Unpaused");

                    (await datPausableToken.paused()).should.eq(false);

                    // Mint to user1
                    const mintAmount = parseEther(100);
                    await datPausableToken.connect(owner).mint(user1.address, mintAmount);

                    // Try to transfer - should succeed
                    await datPausableToken.connect(user1).transfer(user2.address, parseEther(10))
                        .should.not.be.rejected;
                });

                it("should reject pause by non-admin", async function () {
                    await datPausableToken
                        .connect(user1)
                        .pause()
                        .should.be.rejectedWith(
                            `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
                        );
                });

                it("should reject unpause by non-admin", async function () {
                    await datPausableToken.connect(owner).pause();

                    await datPausableToken
                        .connect(user1)
                        .unpause()
                        .should.be.rejectedWith(
                            `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
                        );
                });
            });
        }
    }

    describe("Base DAT with cap and blocklisting", testBaseDAT("DAT"));

    const datVotesContractName = "DATVotes";
    describe(datVotesContractName, () => {
        testBaseDAT(datVotesContractName)();
        testDATVotes(datVotesContractName)();
    });

    const datPausableContractName = "DATPausable";
    describe(datPausableContractName, () => {
        testBaseDAT(datPausableContractName)();
        testDATVotes(datPausableContractName)();
        testDATPausable(datPausableContractName)();
    });
});

describe("DATFactory + VestingWallet", () => {
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

    let datImplementation: DAT;
    let datVotesImplementation: DATVotes;
    let datPausableImplementation: DATPausable;

    const minCap = parseEther(1000); // 1,000 tokens
    const maxCap = parseEther(100_000_000); // 100M tokens

    const DEFAULT_ADMIN_ROLE =
        "0x0000000000000000000000000000000000000000000000000000000000000000";
    const MAINTAINER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("MAINTAINER_ROLE"),
    );
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

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
        const datTokenFactory = await ethers.getContractFactory("DAT");
        datImplementation = await datTokenFactory.deploy()
            .then((instance) => instance.waitForDeployment()) as DAT;

        const datVotesFactory = await ethers.getContractFactory("DATVotes");
        datVotesImplementation = await datVotesFactory.deploy()
            .then((instance) => instance.waitForDeployment()) as DATVotes;

        const datPausableFactory = await ethers.getContractFactory("DATPausable");
        datPausableImplementation = await datPausableFactory.deploy()
            .then((instance) => instance.waitForDeployment()) as DATPausable;

        const factoryDeploy = await upgrades.deployProxy(
            await ethers.getContractFactory("DATFactoryImplementation"),
            [owner.address, minCap, maxCap, datImplementation.target, datVotesImplementation.target, datPausableImplementation.target],
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
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: vestingSchedules,
                salt: tokenSalt,
                owner: admin.address,
            });

        const receipt = await getReceipt(tx);

        // Extract token address from events
        const createEvent = receipt.logs.find(
            (log) => (log as EventLog).fragment?.name === "DATCreated",
        ) as EventLog;

        should().exist(createEvent);
        const tokenAddress = createEvent.args[0];

        // Extract vesting wallet addresses
        const vestingWalletEvents = receipt.logs.filter(
            (log) => (log as EventLog).fragment?.name === "VestingWalletCreated",
        ) as EventLog[];

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

    describe("Vesting Functionality", () => {
        it("should correctly set up vesting wallets", async function () {
            const { vestingSchedules, amount1, amount2 } = await createTokenWithVesting();

            // Check beneficiaries
            (await vestingWallet1.owner()).should.eq(
                vestingSchedules[0].beneficiary,
            );
            (await vestingWallet2.owner()).should.eq(
                vestingSchedules[1].beneficiary,
            );

            // Check durations - note they are adjusted by the factory
            const start1 = BigInt(vestingSchedules[0].start);
            const cliff1 = BigInt(vestingSchedules[0].cliff);
            const duration1 = BigInt(vestingSchedules[0].duration);

            const start2 = BigInt(vestingSchedules[1].start);
            const cliff2 = BigInt(vestingSchedules[1].cliff);
            const duration2 = BigInt(vestingSchedules[1].duration);

            (await vestingWallet1.start()).should.eq(start1 + cliff1);
            (await vestingWallet1.duration()).should.eq(duration1 - cliff1);
            (await vestingWallet1.end()).should.eq(start1 + duration1);
            (await vestingWallet1["vestedAmount(address,uint64)"](datToken.target, start1)).should.eq(0);
            (await vestingWallet1["vestedAmount(address,uint64)"](datToken.target, start1 + cliff1)).should.eq(0);
            (await vestingWallet1["vestedAmount(address,uint64)"](datToken.target, start1 + duration1)).should.eq(amount1);

            (await vestingWallet2.start()).should.eq(start2 + cliff2);
            (await vestingWallet2.duration()).should.eq(duration2 - cliff2);
            (await vestingWallet2.end()).should.eq(start2 + duration2);
            (await vestingWallet2["vestedAmount(address,uint64)"](datToken.target, start2)).should.eq(0);
            (await vestingWallet2["vestedAmount(address,uint64)"](datToken.target, start2 + cliff2)).should.eq(0);
            (await vestingWallet2["vestedAmount(address,uint64)"](datToken.target, start2 + duration2)).should.eq(amount2);

            // From OZ VestingWallet - calculateReleasable uses
            // uint256 vestedAmount = vestedAmount(token, timestamp);
            // return vestedAmount - released(token);

            // Initial release should be 0
            (await vestingWallet1["releasable(address)"](datToken.target)).should.eq(0);
            (await vestingWallet2["releasable(address)"](datToken.target)).should.eq(0);
        });

        it("should release tokens according to vesting schedule", async function () {
            const { vestingSchedules, amount1, amount2 } =
                await createTokenWithVesting();

            // Get initial setup
            const start1 = BigInt(vestingSchedules[0].start);
            const cliff1 = BigInt(vestingSchedules[0].cliff);
            const duration1 = BigInt(vestingSchedules[0].duration);

            // Time to cliff - no tokens available yet
            let nextTimestamp = start1 + cliff1 - 10n;
            await time.increaseTo(nextTimestamp);

            let block = await ethers.provider.getBlock("latest");
            block!.timestamp.should.eq(nextTimestamp);

            (await vestingWallet1["releasable(address)"](datToken.target)).should.eq(0);

            // Time to cliff + 1 - tokens start to release
            nextTimestamp = start1 + cliff1 + 10n;
            await time.increaseTo(nextTimestamp);

            // Calculate expected release at this point
            // Expected formula: (amount * timeElapsed) / duration
            // Note that cliff is not included in the eslapsed time,
            // that means no tokens are released during the cliff period
            const effectiveDuration1 = duration1 - cliff1;
            let timeElapsed = 10n;
            let expectedRelease = (amount1 * timeElapsed) / effectiveDuration1;

            let actualRelease = await vestingWallet1["releasable(address)"](datToken.target);
            actualRelease.should.eq(expectedRelease);

            // Release tokens
            await vestingWallet1.connect(beneficiary1)["release(address)"](datToken.target);

            block = await ethers.provider.getBlock("latest");
            expectedRelease = (amount1 * (BigInt(block!.timestamp) - start1 - cliff1)) / (duration1 - cliff1);

            // Beneficiary should have received tokens
            let releasedAmount = await vestingWallet1["released(address)"](datToken.target);
            releasedAmount.should.eq(expectedRelease);
            (await datToken.balanceOf(beneficiary1)).should.eq(expectedRelease);

            // Advance to halfway through vesting
            nextTimestamp = start1 + duration1 / 2n;
            await time.increaseTo(nextTimestamp);

            // Calculate expected release after half duration
            const halfTimeElapsed = nextTimestamp - start1 - cliff1;
            const halfExpectedRelease = (amount1 * halfTimeElapsed) / effectiveDuration1;

            // Released amount should be deducted
            actualRelease = await vestingWallet1["releasable(address)"](datToken.target);
            actualRelease.should.eq(halfExpectedRelease - releasedAmount);

            // Release again
            await vestingWallet1.connect(beneficiary1)["release(address)"](datToken.target);

            block = await ethers.provider.getBlock("latest");
            expectedRelease = (amount1 * (BigInt(block!.timestamp) - start1 - cliff1)) / effectiveDuration1;

            // Beneficiary should have received more tokens
            releasedAmount = await vestingWallet1["released(address)"](datToken.target);
            releasedAmount.should.eq(expectedRelease);
            (await datToken.balanceOf(beneficiary1)).should.eq(expectedRelease);

            // Advance to end of vesting
            await time.increaseTo(start1 + duration1 + 10n);

            // Should be able to release remaining tokens
            await vestingWallet1.connect(beneficiary1)["release(address)"](datToken.target);

            // Beneficiary should have received all tokens
            releasedAmount = await vestingWallet1["released(address)"](datToken.target);
            releasedAmount.should.eq(amount1);
            (await datToken.balanceOf(beneficiary1)).should.eq(amount1);

            // No more tokens to release
            (await vestingWallet1["releasable(address)"](datToken.target)).should.eq(0);
        });

        it("should allow releasing tokens by anyone (not just beneficiary)", async function () {
            const { amount1 } = await createTokenWithVesting();

            // Advance to fully vested state
            const vestedTime = (await vestingWallet1.end()) + 1n;
            await time.increaseTo(vestedTime);

            // Release tokens as a random user
            await vestingWallet1.connect(user3)["release(address)"](datToken.target);

            // Beneficiary should have received tokens, not the caller
            (await datToken.balanceOf(user3)).should.eq(0);
            // (await datToken.balanceOf(beneficiary1)).should.be.almostEq(
            //     amount1,
            //     1000n,
            // );
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
                defaultTemplate.should.eq(datImplementation.target);
                (await datFactory.datTemplates(1)).should.eq(datVotesImplementation.target);
                (await datFactory.datTemplates(2)).should.eq(datPausableImplementation.target);
            });

            it("should add created tokens to the datList", async function () {
                // Initial count should be 0
                (await datFactory.datListCount()).should.eq(0);

                // Create first token
                const tx1 = await datFactory.connect(owner).createToken({
                    datType: 0,
                    name: tokenName,
                    symbol: tokenSymbol,
                    cap: tokenCap,
                    schedules: [],
                    salt: ethers.id("SALT1"),
                    owner: admin.address,
                });
                const receipt1 = await getReceipt(tx1);
                const createEvent1 = receipt1.logs.find(
                    (log) => (log as EventLog).fragment?.name === "DATCreated",
                ) as EventLog;
                should().exist(createEvent1);
                const tokenAddress1 = createEvent1.args[0];
                const predictedAddress1 = await datFactory.predictAddress(
                    0,
                    ethers.id("SALT1"),
                );

                // List should have 1 token
                (await datFactory.datListCount()).should.eq(1);
                (await datFactory.datListAt(0)).should.eq(tokenAddress1);
                (await datFactory.datListAt(0)).should.eq(predictedAddress1);

                // Create second token
                const tx2 = await datFactory.connect(owner).createToken({
                    datType: 1,
                    name: "Second Token",
                    symbol: "ST2",
                    cap: tokenCap,
                    schedules: [],
                    salt: ethers.id("SALT2"),
                    owner: admin.address,
                });
                const receipt2 = await getReceipt(tx2);
                const createEvent2 = receipt2.logs.find(
                    (log) => (log as EventLog).fragment?.name === "DATCreated",
                ) as EventLog;
                should().exist(createEvent2);
                const tokenAddress2 = createEvent2.args[0];
                const predictedAddress2 = await datFactory.predictAddress(
                    1,
                    ethers.id("SALT2"),
                );

                // List should have 2 tokens
                (await datFactory.datListCount()).should.eq(2);
                (await datFactory.datListAt(1)).should.eq(tokenAddress2);
                (await datFactory.datListAt(1)).should.eq(predictedAddress2);

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
                (await vestingWallet1.owner()).should.eq(beneficiary1.address);
                (await vestingWallet2.owner()).should.eq(beneficiary2.address);

                // Verify predicted address matches
                const predictedAddress = await datFactory.predictAddress(0, tokenSalt);
                predictedAddress.should.eq(datToken.target);
            });

            it("should reject createToken with empty name or symbol", async function () {
                await datFactory
                    .connect(owner)
                    .createToken({
                        datType: 0,
                        name: "", // Empty name
                        symbol: tokenSymbol,
                        cap: tokenCap,
                        schedules: [],
                        salt: tokenSalt,
                        owner: admin.address,
                    })
                    .should.be.rejectedWith(`EmptyString("name")`);

                await datFactory
                    .connect(owner)
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: "", // Empty symbol
                        cap: tokenCap,
                        schedules: [],
                        salt: tokenSalt,
                        owner: admin.address,
                    })
                    .should.be.rejectedWith(`EmptyString("symbol")`);
            });

            it("should reject token creation with zero owner address", async function () {
                await datFactory
                    .connect(owner)
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: tokenCap,
                        schedules: [],
                        salt: tokenSalt,
                        owner: ethers.ZeroAddress, // Zero address
                    })
                    .should.be.rejectedWith("ZeroOwner");
            });

            it("should reject token creation with cap below minimum", async function () {
                await datFactory
                    .connect(owner)
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: minCap - 1n, // Below minimum
                        schedules: [],
                        salt: tokenSalt,
                        owner: admin.address,
                    })
                    .should.be.rejectedWith("CapTooLow");
            });

            it("should reject token creation with cap above maximum", async function () {
                await datFactory
                    .connect(owner)
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: maxCap + 1n, // Above maximum
                        schedules: [],
                        salt: tokenSalt,
                        owner: admin.address,
                    })
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
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: tokenCap,
                        schedules: vestingSchedules,
                        salt: tokenSalt,
                        owner: admin.address,
                    })
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
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: tokenCap,
                        schedules: invalidSchedules,
                        salt: tokenSalt,
                        owner: admin.address,
                    })
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
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: tokenCap,
                        schedules: invalidSchedules,
                        salt: tokenSalt,
                        owner: admin.address,
                    })
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
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: tokenCap,
                        schedules: invalidSchedules,
                        salt: tokenSalt,
                        owner: admin.address,
                    })
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
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: tokenCap,
                        schedules: invalidSchedules,
                        salt: tokenSalt,
                        owner: admin.address,
                    })
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
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: tokenCap,
                        schedules: equalCliffSchedules,
                        salt: tokenSalt,
                        owner: admin.address,
                    })
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
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: tokenCap,
                        schedules: greaterCliffSchedules,
                        salt: tokenSalt,
                        owner: admin.address,
                    })
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
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: tokenCap,
                        schedules: excessiveDurationSchedules,
                        salt: tokenSalt,
                        owner: admin.address,
                    })
                    .should.be.rejectedWith(/overflow/);

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
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: tokenCap,
                        schedules: excessiveStartSchedules,
                        salt: tokenSalt,
                        owner: admin.address,
                    })
                    .should.be.rejectedWith(/overflow/);

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
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: tokenCap,
                        schedules: excessiveCliffSchedules,
                        salt: tokenSalt,
                        owner: admin.address,
                    })
                    .should.be.rejectedWith(/overflow/);
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
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: tokenCap,
                        schedules: overflowSchedules,
                        salt: tokenSalt,
                        owner: admin.address,
                    })
                    .should.be.rejectedWith(/overflow/);
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
                    .createToken({
                        datType: 0,
                        name: tokenName,
                        symbol: tokenSymbol,
                        cap: tokenCap,
                        schedules: invalidSchedules,
                        salt: tokenSalt,
                        owner: admin.address,
                    }).should.not.be.rejected; // This is actually valid, just checking the edge case
            });
        });

        describe("Address Prediction", () => {
            it("should correctly predict token address", async function () {
                const salt1 = ethers.id("PREDICT_TEST_1");
                const salt2 = ethers.id("PREDICT_TEST_2");
                const salt3 = ethers.id("PREDICT_TEST_3");

                // Predict addresses
                const predictedAddr1 = await datFactory.predictAddress(0, salt1);
                const predictedAddr2 = await datFactory.predictAddress(1, salt2);
                const predictedAddr3 = await datFactory.predictAddress(2, salt3);

                // Create tokens
                const tx1 = await datFactory.connect(owner).createToken({
                    datType: 0,
                    name: tokenName + " 1",
                    symbol: tokenSymbol + "1",
                    cap: tokenCap,
                    schedules: [],
                    salt: salt1,
                    owner: admin.address,
                });
                const receipt1 = await getReceipt(tx1);
                const createEvent1 = receipt1.logs.find(
                    (log) => (log as EventLog).fragment?.name === "DATCreated",
                ) as EventLog;
                should().exist(createEvent1);
                const tokenAddress1 = createEvent1.args[0];
                tokenAddress1.should.eq(predictedAddr1);

                const tx2 = await datFactory.connect(owner).createToken({
                    datType: 1,
                    name: tokenName + " 2",
                    symbol: tokenSymbol + "2",
                    cap: tokenCap,
                    schedules: [],
                    salt: salt2,
                    owner: admin.address,
                });
                const receipt2 = await getReceipt(tx2);
                const createEvent2 = receipt2.logs.find(
                    (log) => (log as EventLog).fragment?.name === "DATCreated",
                ) as EventLog;
                should().exist(createEvent2);
                const tokenAddress2 = createEvent2.args[0];
                tokenAddress2.should.eq(predictedAddr2);

                const tx3 = await datFactory.connect(owner).createToken({
                    datType: 2,
                    name: tokenName + " 3",
                    symbol: tokenSymbol + "3",
                    cap: tokenCap,
                    schedules: [],
                    salt: salt3,
                    owner: admin.address,
                });
                const receipt3 = await getReceipt(tx3);
                const createEvent3 = receipt3.logs.find(
                    (log) => (log as EventLog).fragment?.name === "DATCreated",
                ) as EventLog;
                should().exist(createEvent3);
                const tokenAddress3 = createEvent3.args[0];
                tokenAddress3.should.eq(predictedAddr3);
            });

            it("should reject predictAddress with zero salt", async function () {
                await datFactory
                    .predictAddress(0, ethers.ZeroHash)
                    .should.be.rejectedWith("ZeroSalt");
            });
        });
    });
});