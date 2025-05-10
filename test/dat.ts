import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, network } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getReceipt, parseEther } from "../utils/helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import {
    DAT, DATPausable, DATVotes, CloneHelper,
} from "../typechain-types";
import { Contract, EventLog } from "ethers";
import { get } from "http";
import { dat } from "../typechain-types/contracts";

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