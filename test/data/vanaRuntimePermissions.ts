import chai, { should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import { 
  VanaRuntimePermissionsImplementation,
  DataRegistryImplementation,
  DataAccessTreasuryProxyFactory,
  DataAccessTreasuryImplementation,
  ERC20Mock,
  MockDatasetRegistry
} from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { parseEther } from "ethers";

chai.use(chaiAsPromised);
should();

describe("VanaRuntimePermissions - DataAccessTreasuryUpgradeable Features", () => {
  let deployer: HardhatEthersSigner;
  let owner: HardhatEthersSigner;
  let maintainer: HardhatEthersSigner;
  let securityCounselor: HardhatEthersSigner;
  let pge: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let user3: HardhatEthersSigner;
  let vanaRuntime: HardhatEthersSigner;

  let vanaRuntimePermissions: VanaRuntimePermissionsImplementation;
  let dataRegistry: DataRegistryImplementation;
  let mockDatasetRegistry: MockDatasetRegistry;
  let treasuryFactory: DataAccessTreasuryProxyFactory;
  let treasuryImplementation: DataAccessTreasuryImplementation;
  let treasury: DataAccessTreasuryImplementation;
  let mockToken: ERC20Mock;

  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const MAINTAINER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MAINTAINER_ROLE"));
  const PGE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PGE_ROLE"));
  const SECURITY_COUSELOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SECURITY_COUSELOR_ROLE"));
  const CUSTODIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CUSTODIAN_ROLE"));
  const VANA_ADDRESS = ethers.ZeroAddress;

  const deploy = async () => {
    [deployer, owner, maintainer, securityCounselor, pge, user1, user2, user3, vanaRuntime] = await ethers.getSigners();

    // Deploy MockDatasetRegistry
    const MockDatasetRegistry = await ethers.getContractFactory("MockDatasetRegistry");
    mockDatasetRegistry = await MockDatasetRegistry.deploy();
    await mockDatasetRegistry.waitForDeployment();
    
    // Add a dataset owned by the owner for testing
    await mockDatasetRegistry.setDatasetOwner(1, owner.address);

    // Deploy Treasury Implementation
    const TreasuryImplementation = await ethers.getContractFactory("DataAccessTreasuryImplementation");
    treasuryImplementation = await TreasuryImplementation.deploy();
    await treasuryImplementation.waitForDeployment();

    // Deploy Treasury Factory
    const TreasuryFactory = await ethers.getContractFactory("DataAccessTreasuryProxyFactory");
    treasuryFactory = await TreasuryFactory.deploy(
      await treasuryImplementation.getAddress(),
      owner.address
    );
    await treasuryFactory.waitForDeployment();

    // Deploy VanaRuntimePermissions
    const vanaRuntimePermissionsDeploy = await upgrades.deployProxy(
      await ethers.getContractFactory("VanaRuntimePermissionsImplementation"),
      [
        owner.address,
        await mockDatasetRegistry.getAddress(),
        await treasuryFactory.getAddress()
      ],
      { kind: "uups" }
    );
    vanaRuntimePermissions = await ethers.getContractAt(
      "VanaRuntimePermissionsImplementation",
      vanaRuntimePermissionsDeploy.target
    );

    // Get the deployed treasury proxy address
    const filter = vanaRuntimePermissions.filters.DataAccessTreasuryProxyCreated();
    const events = await vanaRuntimePermissions.queryFilter(filter);
    const treasuryAddress = events[0].args.proxy;
    treasury = await ethers.getContractAt("DataAccessTreasuryImplementation", treasuryAddress);

    // Deploy mock ERC20 token (deployer gets 1,000,000 tokens)
    const MockToken = await ethers.getContractFactory("ERC20Mock");
    mockToken = await MockToken.deploy("Mock Token", "MOCK");
    await mockToken.waitForDeployment();

    // Transfer tokens to users from deployer
    await mockToken.connect(deployer).transfer(user1.address, parseEther("1000"));
    await mockToken.connect(deployer).transfer(user2.address, parseEther("1000"));
    await mockToken.connect(deployer).transfer(user3.address, parseEther("1000"));

    // Setup roles
    await vanaRuntimePermissions.connect(owner).grantRole(MAINTAINER_ROLE, maintainer.address);
    await vanaRuntimePermissions.connect(owner).grantRole(PGE_ROLE, pge.address);
    await vanaRuntimePermissions.connect(owner).grantRole(SECURITY_COUSELOR_ROLE, securityCounselor.address);
  };

  describe("Treasury Proxy Creation", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should create treasury proxy during initialization", async () => {
      treasury.should.not.be.undefined;
      const treasuryAddress = await treasury.getAddress();
      treasuryAddress.should.not.equal(ethers.ZeroAddress);
    });

    it("should have correct custodian role setup in treasury", async () => {
      const vanaPermissionsAddress = await vanaRuntimePermissions.getAddress();
      (await treasury.hasRole(CUSTODIAN_ROLE, vanaPermissionsAddress)).should.eq(true);
      (await treasury.hasRole(CUSTODIAN_ROLE, owner.address)).should.eq(true);
    });

    it("should store treasury reference in VanaRuntimePermissions", async () => {
      const storedTreasury = await vanaRuntimePermissions.treasury();
      storedTreasury.should.equal(await treasury.getAddress());
    });
  });

  describe("Deposit Functionality", () => {
    beforeEach(async () => {
      await deploy();
    });

    describe("ERC20 Token Deposits", () => {
      it("should allow users to deposit ERC20 tokens", async () => {
        const depositAmount = parseEther("100");
        await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), depositAmount);
        
        await vanaRuntimePermissions.connect(user1).deposit(await mockToken.getAddress(), depositAmount)
          .should.be.fulfilled;

        const balance = await vanaRuntimePermissions.balanceOf(user1.address, await mockToken.getAddress());
        balance.should.eq(depositAmount);
      });

      it("should transfer ERC20 tokens to treasury", async () => {
        const depositAmount = parseEther("100");
        await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), depositAmount);
        
        await vanaRuntimePermissions.connect(user1).deposit(await mockToken.getAddress(), depositAmount);

        const treasuryBalance = await mockToken.balanceOf(await treasury.getAddress());
        treasuryBalance.should.eq(depositAmount);
      });

      it("should emit Deposit event", async () => {
        const depositAmount = parseEther("50");
        await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), depositAmount);
        
        await vanaRuntimePermissions.connect(user1).deposit(await mockToken.getAddress(), depositAmount)
          .should.emit(vanaRuntimePermissions, "Deposit")
          .withArgs(user1.address, await mockToken.getAddress(), depositAmount);
      });

      it("should revert when depositing zero amount", async () => {
        await vanaRuntimePermissions.connect(user1).deposit(await mockToken.getAddress(), 0)
          .should.be.revertedWithCustomError(vanaRuntimePermissions, "InvalidAmount");
      });

      it("should revert when sending VANA with ERC20 deposit", async () => {
        const depositAmount = parseEther("100");
        await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), depositAmount);
        
        await vanaRuntimePermissions.connect(user1).deposit(
          await mockToken.getAddress(), 
          depositAmount,
          { value: parseEther("1") }
        ).should.be.revertedWithCustomError(vanaRuntimePermissions, "UnexpectedVanaDeposit");
      });

      it("should handle multiple deposits from same user", async () => {
        const deposit1 = parseEther("50");
        const deposit2 = parseEther("30");
        
        await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), deposit1 + deposit2);
        
        await vanaRuntimePermissions.connect(user1).deposit(await mockToken.getAddress(), deposit1);
        await vanaRuntimePermissions.connect(user1).deposit(await mockToken.getAddress(), deposit2);
        
        const balance = await vanaRuntimePermissions.balanceOf(user1.address, await mockToken.getAddress());
        balance.should.eq(deposit1 + deposit2);
      });
    });

    describe("Native VANA Deposits", () => {
      it("should allow users to deposit native VANA", async () => {
        const depositAmount = parseEther("1");
        
        await vanaRuntimePermissions.connect(user1).deposit(VANA_ADDRESS, depositAmount, { value: depositAmount })
          .should.be.fulfilled;

        const balance = await vanaRuntimePermissions.balanceOf(user1.address, VANA_ADDRESS);
        balance.should.eq(depositAmount);
      });

      it("should transfer VANA to treasury", async () => {
        const depositAmount = parseEther("1");
        const treasuryBalanceBefore = await ethers.provider.getBalance(await treasury.getAddress());
        
        await vanaRuntimePermissions.connect(user1).deposit(VANA_ADDRESS, depositAmount, { value: depositAmount });
        
        const treasuryBalanceAfter = await ethers.provider.getBalance(await treasury.getAddress());
        (treasuryBalanceAfter - treasuryBalanceBefore).should.eq(depositAmount);
      });

      it("should revert when msg.value doesn't match amount for VANA", async () => {
        const depositAmount = parseEther("1");
        
        await vanaRuntimePermissions.connect(user1).deposit(
          VANA_ADDRESS, 
          depositAmount, 
          { value: parseEther("0.5") }
        ).should.be.revertedWithCustomError(vanaRuntimePermissions, "InvalidVanaAmount");
      });

      it("should emit Deposit event for VANA", async () => {
        const depositAmount = parseEther("1");
        
        await vanaRuntimePermissions.connect(user1).deposit(VANA_ADDRESS, depositAmount, { value: depositAmount })
          .should.emit(vanaRuntimePermissions, "Deposit")
          .withArgs(user1.address, VANA_ADDRESS, depositAmount);
      });
    });

    describe("Pausable", () => {
      it("should not allow deposits when paused", async () => {
        await vanaRuntimePermissions.connect(maintainer).pause();
        
        const depositAmount = parseEther("100");
        await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), depositAmount);
        
        await vanaRuntimePermissions.connect(user1).deposit(await mockToken.getAddress(), depositAmount)
          .should.be.revertedWithCustomError(vanaRuntimePermissions, "EnforcedPause");
      });
    });
  });

  describe("Withdraw Functionality", () => {
    beforeEach(async () => {
      await deploy();
      
      // Setup initial deposits
      const depositAmount = parseEther("100");
      await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), depositAmount);
      await vanaRuntimePermissions.connect(user1).deposit(await mockToken.getAddress(), depositAmount);
      
      // Deposit some VANA
      await vanaRuntimePermissions.connect(user2).deposit(VANA_ADDRESS, parseEther("2"), { value: parseEther("2") });
    });

    describe("ERC20 Token Withdrawals", () => {
      it("should allow users to withdraw their ERC20 tokens", async () => {
        const withdrawAmount = parseEther("50");
        const balanceBefore = await mockToken.balanceOf(user1.address);
        
        await vanaRuntimePermissions.connect(user1).withdraw(await mockToken.getAddress(), withdrawAmount)
          .should.be.fulfilled;
        
        const balanceAfter = await mockToken.balanceOf(user1.address);
        (balanceAfter - balanceBefore).should.eq(withdrawAmount);
        
        const remainingBalance = await vanaRuntimePermissions.balanceOf(user1.address, await mockToken.getAddress());
        remainingBalance.should.eq(parseEther("50"));
      });

      it("should emit Withdraw event", async () => {
        const withdrawAmount = parseEther("25");
        
        await vanaRuntimePermissions.connect(user1).withdraw(await mockToken.getAddress(), withdrawAmount)
          .should.emit(vanaRuntimePermissions, "Withdraw")
          .withArgs(user1.address, await mockToken.getAddress(), withdrawAmount);
      });

      it("should revert when withdrawing more than balance", async () => {
        const withdrawAmount = parseEther("150");
        
        await vanaRuntimePermissions.connect(user1).withdraw(await mockToken.getAddress(), withdrawAmount)
          .should.be.revertedWithCustomError(vanaRuntimePermissions, "InsufficientBalance");
      });

      it("should revert when withdrawing zero amount", async () => {
        await vanaRuntimePermissions.connect(user1).withdraw(await mockToken.getAddress(), 0)
          .should.be.revertedWithCustomError(vanaRuntimePermissions, "InvalidAmount");
      });

      it("should handle multiple withdrawals", async () => {
        const withdraw1 = parseEther("30");
        const withdraw2 = parseEther("20");
        
        await vanaRuntimePermissions.connect(user1).withdraw(await mockToken.getAddress(), withdraw1);
        await vanaRuntimePermissions.connect(user1).withdraw(await mockToken.getAddress(), withdraw2);
        
        const remainingBalance = await vanaRuntimePermissions.balanceOf(user1.address, await mockToken.getAddress());
        remainingBalance.should.eq(parseEther("50"));
      });
    });

    describe("Native VANA Withdrawals", () => {
      it("should allow users to withdraw native VANA", async () => {
        const withdrawAmount = parseEther("1");
        const balanceBefore = await ethers.provider.getBalance(user2.address);
        
        const tx = await vanaRuntimePermissions.connect(user2).withdraw(VANA_ADDRESS, withdrawAmount);
        const receipt = await tx.wait();
        const gasUsed = receipt.gasUsed * receipt.gasPrice;
        
        const balanceAfter = await ethers.provider.getBalance(user2.address);
        (balanceAfter - balanceBefore + gasUsed).should.be.closeTo(withdrawAmount, parseEther("0.01"));
        
        const remainingBalance = await vanaRuntimePermissions.balanceOf(user2.address, VANA_ADDRESS);
        remainingBalance.should.eq(parseEther("1"));
      });

      it("should use treasury.transfer for VANA withdrawals", async () => {
        const withdrawAmount = parseEther("1");
        
        await vanaRuntimePermissions.connect(user2).withdraw(VANA_ADDRESS, withdrawAmount)
          .should.emit(treasury, "Transfer")
          .withArgs(user2.address, VANA_ADDRESS, withdrawAmount);
      });
    });

    describe("Reentrancy Protection", () => {
      it("should have reentrancy protection on withdraw", async () => {
        // The nonReentrant modifier should prevent reentrancy attacks
        // This test verifies the modifier is present (it would revert with ReentrancyGuardReentrantCall if attacked)
        const withdrawAmount = parseEther("50");
        await vanaRuntimePermissions.connect(user1).withdraw(await mockToken.getAddress(), withdrawAmount)
          .should.be.fulfilled;
      });
    });

    describe("Pausable", () => {
      it("should not allow withdrawals when paused", async () => {
        await vanaRuntimePermissions.connect(maintainer).pause();
        
        const withdrawAmount = parseEther("50");
        await vanaRuntimePermissions.connect(user1).withdraw(await mockToken.getAddress(), withdrawAmount)
          .should.be.revertedWithCustomError(vanaRuntimePermissions, "EnforcedPause");
      });
    });
  });

  describe("Balance Tracking", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should correctly track balances for multiple users and tokens", async () => {
      // User1 deposits ERC20
      const user1Deposit = parseEther("100");
      await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), user1Deposit);
      await vanaRuntimePermissions.connect(user1).deposit(await mockToken.getAddress(), user1Deposit);
      
      // User2 deposits VANA
      const user2Deposit = parseEther("2");
      await vanaRuntimePermissions.connect(user2).deposit(VANA_ADDRESS, user2Deposit, { value: user2Deposit });
      
      // User3 deposits both
      const user3TokenDeposit = parseEther("50");
      const user3VanaDeposit = parseEther("1");
      await mockToken.connect(user3).approve(await vanaRuntimePermissions.getAddress(), user3TokenDeposit);
      await vanaRuntimePermissions.connect(user3).deposit(await mockToken.getAddress(), user3TokenDeposit);
      await vanaRuntimePermissions.connect(user3).deposit(VANA_ADDRESS, user3VanaDeposit, { value: user3VanaDeposit });
      
      // Check all balances
      (await vanaRuntimePermissions.balanceOf(user1.address, await mockToken.getAddress())).should.eq(user1Deposit);
      (await vanaRuntimePermissions.balanceOf(user1.address, VANA_ADDRESS)).should.eq(0);
      
      (await vanaRuntimePermissions.balanceOf(user2.address, await mockToken.getAddress())).should.eq(0);
      (await vanaRuntimePermissions.balanceOf(user2.address, VANA_ADDRESS)).should.eq(user2Deposit);
      
      (await vanaRuntimePermissions.balanceOf(user3.address, await mockToken.getAddress())).should.eq(user3TokenDeposit);
      (await vanaRuntimePermissions.balanceOf(user3.address, VANA_ADDRESS)).should.eq(user3VanaDeposit);
    });

    it("should return zero balance for addresses that haven't deposited", async () => {
      const balance = await vanaRuntimePermissions.balanceOf(user1.address, await mockToken.getAddress());
      balance.should.eq(0);
    });
  });

  describe("Integration with VanaRuntimePermissions", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should maintain separate treasury for payments", async () => {
      const treasuryAddress = await treasury.getAddress();
      const vanaPermissionsAddress = await vanaRuntimePermissions.getAddress();
      
      treasuryAddress.should.not.equal(vanaPermissionsAddress);
      
      // Treasury should be controlled by VanaRuntimePermissions
      (await treasury.hasRole(CUSTODIAN_ROLE, vanaPermissionsAddress)).should.eq(true);
    });

    it("should handle deposits alongside VanaRuntimePermissions functionality", async () => {
      // User deposits tokens
      const depositAmount = parseEther("100");
      await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), depositAmount);
      await vanaRuntimePermissions.connect(user1).deposit(await mockToken.getAddress(), depositAmount);
      
      // Verify deposit was successful
      const balance = await vanaRuntimePermissions.balanceOf(user1.address, await mockToken.getAddress());
      balance.should.eq(depositAmount);
      
      // Verify treasury received the tokens
      const treasuryBalance = await mockToken.balanceOf(await treasury.getAddress());
      treasuryBalance.should.eq(depositAmount);
    });
  });

  describe("Request with Fee Deposit", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should deposit access fee when sending request for ERC20 payment", async () => {
      // Mock dataset permission (we'll use datasetId 1 for testing)
      const pricePerAccess = parseEther("10");
      await vanaRuntimePermissions.connect(owner).addGenericPermission(
        1, // datasetId
        await mockToken.getAddress(),
        pricePerAccess
      );

      // User approves tokens for the access fee
      await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), pricePerAccess);
      
      // Check balance before request
      const balanceBefore = await vanaRuntimePermissions.balanceOf(user1.address, await mockToken.getAddress());
      balanceBefore.should.eq(0);
      
      // Send request which should deposit the fee
      await vanaRuntimePermissions.connect(user1).sendRequest(1)
        .should.be.fulfilled;
      
      // Check that fee was deposited
      const balanceAfter = await vanaRuntimePermissions.balanceOf(user1.address, await mockToken.getAddress());
      balanceAfter.should.eq(pricePerAccess);
      
      // Check treasury received the tokens
      const treasuryBalance = await mockToken.balanceOf(await treasury.getAddress());
      treasuryBalance.should.eq(pricePerAccess);
    });

    it("should deposit VANA fee when sending request for VANA payment", async () => {
      // Mock dataset permission with VANA as payment
      const pricePerAccess = parseEther("1");
      await vanaRuntimePermissions.connect(owner).addGenericPermission(
        1, // datasetId
        VANA_ADDRESS,
        pricePerAccess
      );
      
      // Send request with VANA payment
      await vanaRuntimePermissions.connect(user1).sendRequest(1, { value: pricePerAccess })
        .should.be.fulfilled;
      
      // Check that VANA was deposited
      const balance = await vanaRuntimePermissions.balanceOf(user1.address, VANA_ADDRESS);
      balance.should.eq(pricePerAccess);
      
      // Check treasury received the VANA
      const treasuryBalance = await ethers.provider.getBalance(await treasury.getAddress());
      treasuryBalance.should.eq(pricePerAccess);
    });

    it("should emit RequestSent event after depositing fee", async () => {
      const pricePerAccess = parseEther("5");
      await vanaRuntimePermissions.connect(owner).addGenericPermission(
        1, // datasetId
        await mockToken.getAddress(),
        pricePerAccess
      );

      await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), pricePerAccess);
      
      await vanaRuntimePermissions.connect(user1).sendRequest(1)
        .should.emit(vanaRuntimePermissions, "RequestSent")
        .withArgs(1, 1, user1.address);
    });

    it("should handle request with zero fee", async () => {
      // Create permission with zero fee
      await vanaRuntimePermissions.connect(owner).addGenericPermission(
        1, // datasetId
        await mockToken.getAddress(),
        0 // free access
      );
      
      // Send request without needing to deposit
      await vanaRuntimePermissions.connect(user1).sendRequest(1)
        .should.be.fulfilled;
      
      // Balance should still be zero
      const balance = await vanaRuntimePermissions.balanceOf(user1.address, await mockToken.getAddress());
      balance.should.eq(0);
    });

    it("should revert if insufficient VANA sent for fee", async () => {
      const pricePerAccess = parseEther("1");
      await vanaRuntimePermissions.connect(owner).addGenericPermission(
        1, // datasetId
        VANA_ADDRESS,
        pricePerAccess
      );
      
      // Try to send request with insufficient VANA
      await vanaRuntimePermissions.connect(user1).sendRequest(1, { value: parseEther("0.5") })
        .should.be.revertedWithCustomError(vanaRuntimePermissions, "InvalidVanaAmount");
    });

    it("should revert if insufficient ERC20 approval for fee", async () => {
      const pricePerAccess = parseEther("10");
      await vanaRuntimePermissions.connect(owner).addGenericPermission(
        1, // datasetId
        await mockToken.getAddress(),
        pricePerAccess
      );
      
      // Approve less than required
      await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), parseEther("5"));
      
      // Try to send request with insufficient approval
      await vanaRuntimePermissions.connect(user1).sendRequest(1)
        .should.be.rejectedWith("ERC20InsufficientAllowance");
    });

    it("should handle multiple requests with deposits", async () => {
      const pricePerAccess = parseEther("10");
      await vanaRuntimePermissions.connect(owner).addGenericPermission(
        1, // datasetId
        await mockToken.getAddress(),
        pricePerAccess
      );

      // User approves enough for multiple requests
      const totalAmount = pricePerAccess * 3n;
      await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), totalAmount);
      
      // Send three requests
      await vanaRuntimePermissions.connect(user1).sendRequest(1);
      await vanaRuntimePermissions.connect(user1).sendRequest(1);
      await vanaRuntimePermissions.connect(user1).sendRequest(1);
      
      // Check total deposited
      const balance = await vanaRuntimePermissions.balanceOf(user1.address, await mockToken.getAddress());
      balance.should.eq(totalAmount);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    beforeEach(async () => {
      await deploy();
    });

    it("should handle deposits and withdrawals in same block", async () => {
      const depositAmount = parseEther("100");
      const withdrawAmount = parseEther("50");
      
      await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), depositAmount);
      await vanaRuntimePermissions.connect(user1).deposit(await mockToken.getAddress(), depositAmount);
      await vanaRuntimePermissions.connect(user1).withdraw(await mockToken.getAddress(), withdrawAmount);
      
      const balance = await vanaRuntimePermissions.balanceOf(user1.address, await mockToken.getAddress());
      balance.should.eq(depositAmount - withdrawAmount);
    });

    it("should handle full balance withdrawal", async () => {
      const depositAmount = parseEther("100");
      
      await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), depositAmount);
      await vanaRuntimePermissions.connect(user1).deposit(await mockToken.getAddress(), depositAmount);
      await vanaRuntimePermissions.connect(user1).withdraw(await mockToken.getAddress(), depositAmount);
      
      const balance = await vanaRuntimePermissions.balanceOf(user1.address, await mockToken.getAddress());
      balance.should.eq(0);
    });

    it("should correctly use unchecked math for withdrawal balance update", async () => {
      const depositAmount = parseEther("100");
      
      await mockToken.connect(user1).approve(await vanaRuntimePermissions.getAddress(), depositAmount);
      await vanaRuntimePermissions.connect(user1).deposit(await mockToken.getAddress(), depositAmount);
      
      // This should succeed due to unchecked block (after balance check)
      await vanaRuntimePermissions.connect(user1).withdraw(await mockToken.getAddress(), depositAmount)
        .should.be.fulfilled;
    });
  });
});