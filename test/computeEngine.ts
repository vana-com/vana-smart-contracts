import chai, { should, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, upgrades } from "hardhat";
import {
    QueryEngineImplementation,
    ComputeEngineImplementation,
    DataAccessTreasuryImplementation,
    DataAccessTreasuryProxyFactory,
    DataRefinerRegistryImplementation,
    ComputeInstructionRegistryImplementation,
    ComputeEngineTeePoolImplementation,
    ComputeEngineTeePoolFactoryImplementation,
    ComputeEngineTeePoolProxyFactory,
    DLPRootCoreMock,
    ERC20Mock,
    ComputeEngineMaliciousContract,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getReceipt, parseEther } from "../utils/helpers";
import { Addressable, keccak256 } from "ethers";
import { teePool } from "../typechain-types/contracts";
import { parse } from "path";

chai.use(chaiAsPromised);
should();

const getErrorSelector = (errorSignature: string) => {
    const errorSignatureHash = keccak256(ethers.toUtf8Bytes(errorSignature));
    return errorSignatureHash.slice(0, 10);
}

const getErrorSelectorWithArgs = (errorSignature: string, ...args: any[]) => {
    const errorSignatureHash = keccak256(ethers.toUtf8Bytes(errorSignature));
    const types = errorSignature
        .slice(errorSignature.indexOf('(') + 1, errorSignature.indexOf(')'))
        .split(',')
        .map(type => type.trim());
    const argsHash = ethers.AbiCoder.defaultAbiCoder().encode(types, args);
    return errorSignatureHash.slice(0, 10) + argsHash.slice(2);
};

describe("ComputeEngine", () => {
    const dlpPaymentPercentage = parseEther(80);
    const ephemeralTimeout = 5 * 60; // 5 minutes
    const persistentTimeout = 2 * 60 * 60; // 2 hours
    const maxUint80 = (1n << 80n) - 1n;

    const VanaToken = ethers.ZeroAddress;

    const TeePoolType = {
        None: 0,
        Ephemeral: 1,
        Persistent: 2,
        Dedicated: 3,
    };

    const HardwareType = {
        None: 0,
        Standard: 1, // CPU only
        GPU: 2,
    };

    const TeeStatus = {
        None: 0,
        Active: 1,
        Removed: 2,
    };

    const JobStatus = {
        None: 0,
        Registered: 1,
        Submitted: 2,
        Running: 3,
        Completed: 4,
        Failed: 5,
        Canceled: 6,
    };

    let owner: HardhatEthersSigner;
    let maintainer: HardhatEthersSigner;
    let queryEngineTEE: HardhatEthersSigner;
    let computeEngineTEE: HardhatEthersSigner;
    let vanaTreasury: HardhatEthersSigner;
    let dlp1Owner: HardhatEthersSigner;
    let dlp2Owner: HardhatEthersSigner;
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;

    let queryEngine: QueryEngineImplementation;
    let computeEngine: ComputeEngineImplementation;
    let dataAccessTreasuryImpl: DataAccessTreasuryImplementation;
    let dataAccessTreasuryProxyFactory: DataAccessTreasuryProxyFactory;
    let queryEngineTreasury: DataAccessTreasuryImplementation;
    let computeEngineTreasury: DataAccessTreasuryImplementation;
    let teePoolFactory: ComputeEngineTeePoolFactoryImplementation;
    let teePoolProxyFactory: ComputeEngineTeePoolProxyFactory;
    let dataRefinerRegistry: DataRefinerRegistryImplementation;
    let computeInstructionRegistry: ComputeInstructionRegistryImplementation;
    let dlpRootCoreMock: DLPRootCoreMock;
    let teePoolFactoryAddress: string;

    const DEFAULT_ADMIN_ROLE =
        "0x0000000000000000000000000000000000000000000000000000000000000000";
    const MAINTAINER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("MAINTAINER_ROLE"),
    );
    const QUERY_ENGINE_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("QUERY_ENGINE_ROLE"),
    );

    const TeeAssignmentFailedSelector = ethers.id("TeeAssignmentFailed(uint256,bytes)");
    const TeeAssignmentSucceededSelector = ethers.id("TeeAssignmentSucceeded(uint256,address,address)");

    const getTeePoolAddress = async function (teePoolType: number, hardwareType: number, maxTimeout: number | bigint, deployer: string) {
        const salt = ethers.keccak256(ethers.solidityPacked(["address"], [deployer]));

        const abi = [
            "function initialize(address ownerAddress, address computeEngineAddress, address teePoolFactoryAddress, uint8 teePoolType, uint8 hardwareType, uint80 maxTimeout)",
        ];
        const iface = new ethers.Interface(abi);
        const beaconProxyFactory = await ethers.getContractFactory("BeaconProxy");
        const initializeData = iface.encodeFunctionData("initialize", [
            maintainer.address,
            computeEngine.target,
            teePoolFactory.target,
            teePoolType,
            hardwareType,
            maxTimeout,
        ]);
        const proxyArgs = ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [teePoolProxyFactory.target, initializeData]);
        const proxyInitCode = ethers.solidityPacked(["bytes", "bytes"], [beaconProxyFactory.bytecode, proxyArgs]);
        const proxyAddress = ethers.getCreate2Address(
            teePoolProxyFactory.target.toString(), // beaconProxy's deployer
            salt,
            ethers.keccak256(proxyInitCode),
        );
        return proxyAddress;
    };

    const deploy = async () => {
        [
            owner,
            maintainer,
            queryEngineTEE,
            computeEngineTEE,
            vanaTreasury,
            dlp1Owner,
            dlp2Owner,
            user1,
            user2,
        ] = await ethers.getSigners();

        dlpRootCoreMock = await ethers.deployContract(
            "DLPRootCoreMock",
        );

        await dlpRootCoreMock.connect(dlp1Owner).registerDlp();

        await dlpRootCoreMock.connect(dlp2Owner).registerDlp();

        // Deploy DataRefinerRegistry
        const dataRefinerRegistryDeploy = await upgrades.deployProxy(
            await ethers.getContractFactory("DataRefinerRegistryImplementation"),
            [owner.address, dlpRootCoreMock.target],
            {
                kind: "uups",
            },
        );

        dataRefinerRegistry = await ethers.getContractAt(
            "DataRefinerRegistryImplementation",
            dataRefinerRegistryDeploy.target,
        );

        // Deploy ComputeInstructionRegistry
        const computeInstructionRegistryDeploy = await upgrades.deployProxy(
            await ethers.getContractFactory("ComputeInstructionRegistryImplementation"),
            [owner.address, dlpRootCoreMock.target],
            {
                kind: "uups",
            },
        );

        computeInstructionRegistry = await ethers.getContractAt(
            "ComputeInstructionRegistryImplementation",
            computeInstructionRegistryDeploy.target,
        );

        // Deploy DataAccessTreasuryProxyFactory
        dataAccessTreasuryImpl = await ethers.deployContract(
            "DataAccessTreasuryImplementation",
        );

        dataAccessTreasuryProxyFactory = await ethers.deployContract(
            "DataAccessTreasuryProxyFactory",
            [dataAccessTreasuryImpl.target, owner.address],
        );

        // Deploy QueryEngine
        const queryEngineDeploy = await upgrades.deployProxy(
            await ethers.getContractFactory("QueryEngineImplementation"),
            [owner.address, dataRefinerRegistry.target, dataAccessTreasuryProxyFactory.target],
            {
                kind: "uups",
            },
        );

        queryEngine = await ethers.getContractAt(
            "QueryEngineImplementation",
            queryEngineDeploy.target,
        );

        queryEngineTreasury = await ethers.getContractAt(
            "DataAccessTreasuryImplementation",
            await queryEngine.queryEngineTreasury(),
        );

        // Deploy ComputeEngineTeePoolProxyFactory
        const teePoolImpl = await ethers.deployContract(
            "ComputeEngineTeePoolImplementation",
        );

        teePoolProxyFactory = await ethers.deployContract(
            "ComputeEngineTeePoolProxyFactory",
            [teePoolImpl.target, owner.address],
        );

        // Deploy ComputeEngineTeePoolFactory
        const teePoolFactoryDeploy = await upgrades.deployProxy(
            await ethers.getContractFactory("ComputeEngineTeePoolFactoryImplementation"),
            [owner.address, teePoolProxyFactory.target, ephemeralTimeout, persistentTimeout],
            {
                kind: "uups",
            },
        );

        teePoolFactory = await ethers.getContractAt(
            "ComputeEngineTeePoolFactoryImplementation",
            teePoolFactoryDeploy.target,
        );

        teePoolFactoryAddress = await teePoolFactory.getAddress();

        await teePoolFactory
            .connect(owner)
            .grantRole(MAINTAINER_ROLE, maintainer.address);

        // Deploy ComputeEngine
        const computeEngineDeploy = await upgrades.deployProxy(
            await ethers.getContractFactory("ComputeEngineImplementation"),
            [owner.address, queryEngine.target, teePoolFactory.target, dataAccessTreasuryProxyFactory.target],
            {
                kind: "uups",
            },
        );

        computeEngine = await ethers.getContractAt(
            "ComputeEngineImplementation",
            computeEngineDeploy.target,
        );

        await teePoolFactory
            .connect(maintainer)
            .updateComputeEngine(computeEngine.target);

        await computeEngine
            .connect(owner)
            .grantRole(MAINTAINER_ROLE, maintainer.address);

        computeEngineTreasury = await ethers.getContractAt(
            "DataAccessTreasuryImplementation",
            await computeEngine.computeEngineTreasury(),
        );

        await computeEngine
            .connect(maintainer)
            .updateInstructionRegistry(computeInstructionRegistry.target);

        // Set up QueryEngine
        await queryEngine.connect(owner).updateComputeEngine(computeEngine.target);
    };

    describe("Setup", () => {
        beforeEach(async () => {
            await deploy();
        });

        it("should have correct params after deploy", async function () {
            (await computeEngine.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(true);
            (await computeEngine.hasRole(MAINTAINER_ROLE, owner)).should.eq(true);
            (await computeEngine.hasRole(MAINTAINER_ROLE, maintainer)).should.eq(true);
            (await computeEngine.version()).should.eq(1);
            (await computeEngine.instructionRegistry()).should.eq(computeInstructionRegistry);
            (await computeEngine.queryEngine()).should.eq(queryEngine);
            (await computeEngine.computeEngineTreasury()).should.eq(computeEngineTreasury);
            (await computeEngineTreasury.custodian()).should.eq(computeEngine);
        });

        it("should have correct treasury address after deploy", async function () {
            // initialize function of DataAccessTreasuryImplementation
            const dataAccessTreasuryAbi = [
                "function initialize(address ownerAddress, address custodian)",
            ];
            const dataAccessTreasuryIface = new ethers.Interface(dataAccessTreasuryAbi);
            const beaconProxyFactory = await ethers.getContractFactory("BeaconProxy");

            const computeEngineTreasuryInitializeData = dataAccessTreasuryIface.encodeFunctionData("initialize", [
                owner.address,
                computeEngine.target,
            ]);
            const computeEngineTreasuryProxyArgs = ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [dataAccessTreasuryProxyFactory.target, computeEngineTreasuryInitializeData]);
            const computeEngineTreasuryProxyInitCode = ethers.solidityPacked(["bytes", "bytes"], [beaconProxyFactory.bytecode, computeEngineTreasuryProxyArgs]);
            const computeEngineTreasuryProxyAddress = ethers.getCreate2Address(
                dataAccessTreasuryProxyFactory.target.toString(), // beaconProxy's deployer
                ethers.keccak256(ethers.solidityPacked(["address"], [computeEngine.target])),
                ethers.keccak256(computeEngineTreasuryProxyInitCode),
            );
            computeEngineTreasury.should.eq(computeEngineTreasuryProxyAddress);
            computeEngineTreasuryProxyAddress.should.eq(await dataAccessTreasuryProxyFactory.getProxyAddress(computeEngineTreasuryInitializeData, computeEngine.target));
        });

        it("should grant or revoke roles when admin", async function () {
            await computeEngine
                .connect(owner)
                .grantRole(MAINTAINER_ROLE, user1.address).should.not.be.rejected;
            (await computeEngine.hasRole(MAINTAINER_ROLE, user1)).should.eq(true);
            (await computeEngine.hasRole(DEFAULT_ADMIN_ROLE, user1)).should.eq(false);
            (await computeEngine.hasRole(MAINTAINER_ROLE, user2)).should.eq(false);

            await computeEngine
                .connect(user1)
                .grantRole(DEFAULT_ADMIN_ROLE, user1.address)
                .should.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}`,
                );

            await computeEngine
                .connect(owner)
                .grantRole(DEFAULT_ADMIN_ROLE, user1.address).should.be.fulfilled;
            (await computeEngine.hasRole(DEFAULT_ADMIN_ROLE, user1)).should.eq(true);

            await computeEngine
                .connect(user1)
                .revokeRole(DEFAULT_ADMIN_ROLE, owner.address);
            (await computeEngine.hasRole(DEFAULT_ADMIN_ROLE, owner)).should.eq(false);

            await computeEngine
                .connect(owner)
                .grantRole(DEFAULT_ADMIN_ROLE, user2.address)
                .should.rejectedWith(
                    `AccessControlUnauthorizedAccount("${owner.address}", "${DEFAULT_ADMIN_ROLE}`,
                );

            await computeEngine
                .connect(user1)
                .grantRole(DEFAULT_ADMIN_ROLE, user2.address).should.be.fulfilled;
            (await computeEngine.hasRole(DEFAULT_ADMIN_ROLE, user2)).should.eq(true);
        });

        it("should upgradeTo when owner", async function () {
            await upgrades.upgradeProxy(
                computeEngine,
                await ethers.getContractFactory(
                    "ComputeEngineImplementationV0Mock",
                    owner,
                ),
            );

            const newImpl = await ethers.getContractAt(
                "ComputeEngineImplementationV0Mock",
                computeEngine,
            );
            (await newImpl.version()).should.eq(0);

            (await newImpl.test()).should.eq("test");
        });

        it("should not upgradeTo when non-owner", async function () {
            const newImpl = await ethers.deployContract(
                "ComputeEngineImplementationV0Mock",
            );

            await computeEngine
                .connect(user1)
                .upgradeToAndCall(newImpl, "0x")
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${DEFAULT_ADMIN_ROLE}")`,
                );
        });

        it("should upgradeTo when owner and emit event", async function () {
            const newImpl = await ethers.deployContract(
                "ComputeEngineImplementationV0Mock",
            );

            await computeEngine
                .connect(owner)
                .upgradeToAndCall(newImpl, "0x")
                .should.emit(computeEngine, "Upgraded")
                .withArgs(newImpl);

            const newRoot = await ethers.getContractAt(
                "ComputeEngineImplementationV0Mock",
                computeEngine,
            );

            (await newRoot.version()).should.eq(0);

            (await newRoot.test()).should.eq("test");
        });

        it("should reject upgradeTo when storage layout is incompatible", async function () {
            await upgrades
                .upgradeProxy(
                    computeEngine,
                    await ethers.getContractFactory(
                        "ComputeEngineImplementationIncompatibleMock",
                        owner,
                    ),
                )
                .should.be.rejectedWith("New storage layout is incompatible");
        });

        it("should not initialize in implementation contract", async function () {
            const impl = await ethers.deployContract(
                "ComputeEngineImplementation",
            );

            await impl.initialize(owner.address, queryEngine.target, teePoolFactory.target, dataAccessTreasuryProxyFactory.target).should.be.rejectedWith(
                "InvalidInitialization()",
            );
        });

        it("should pause and unpause only when maintainer", async function () {
            await computeEngine
                .connect(maintainer)
                .pause().should.be.fulfilled;
            (await computeEngine.paused()).should.eq(true);

            await computeEngine
                .connect(maintainer)
                .unpause().should.be.fulfilled;
            (await computeEngine.paused()).should.eq(false);

            await computeEngine
                .connect(user1)
                .pause()
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );

            await computeEngine
                .connect(user1)
                .unpause()
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );
        });

        it("should updateQueryEngine only when maintainer", async function () {
            const newImpl = await ethers.deployContract(
                "QueryEngineImplementation",
            );

            await computeEngine
                .connect(maintainer)
                .updateQueryEngine(newImpl.target)
                .should.be.fulfilled;
            (await computeEngine.queryEngine()).should.eq(newImpl.target);

            const newImpl1 = await ethers.deployContract(
                "QueryEngineImplementation",
            );
            newImpl1.should.not.eq(newImpl);

            await computeEngine
                .connect(owner)
                .updateQueryEngine(newImpl1.target)
                .should.be.fulfilled;
            (await computeEngine.queryEngine()).should.eq(newImpl1.target);

            await computeEngine
                .connect(user1)
                .updateQueryEngine(newImpl.target)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );
        });

        it("should updateTeePoolFactory only when maintainer", async function () {
            const teePoolImpl = await ethers.deployContract(
                "ComputeEngineTeePoolImplementation",

            );

            const newImpl = await ethers.deployContract(
                "ComputeEngineTeePoolProxyFactory",
                [teePoolImpl, owner],
            );

            await computeEngine
                .connect(maintainer)
                .updateTeePoolFactory(newImpl.target)
                .should.be.fulfilled;
            (await computeEngine.teePoolFactory()).should.eq(newImpl.target);

            const newImpl1 = await ethers.deployContract(
                "ComputeEngineTeePoolProxyFactory",
                [teePoolImpl, owner],
            );
            newImpl1.should.not.eq(newImpl);

            await computeEngine
                .connect(owner)
                .updateTeePoolFactory(newImpl1.target)
                .should.be.fulfilled;
            (await computeEngine.teePoolFactory()).should.eq(newImpl1.target);

            await computeEngine
                .connect(user1)
                .updateTeePoolFactory(newImpl.target)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );
        });

        it("should updateInstructionRegistry only when maintainer", async function () {
            const newImpl = await ethers.deployContract(
                "ComputeInstructionRegistryImplementation",
            );

            await computeEngine
                .connect(maintainer)
                .updateInstructionRegistry(newImpl.target)
                .should.be.fulfilled;
            (await computeEngine.instructionRegistry()).should.eq(newImpl.target);

            const newImpl1 = await ethers.deployContract(
                "ComputeInstructionRegistryImplementation",
            );
            newImpl1.should.not.eq(newImpl);

            await computeEngine
                .connect(owner)
                .updateInstructionRegistry(newImpl1.target)
                .should.be.fulfilled;
            (await computeEngine.instructionRegistry()).should.eq(newImpl1.target);

            await computeEngine
                .connect(user1)
                .updateInstructionRegistry(newImpl.target)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );
        });
    });

    describe("TeePool Factory", () => {
        beforeEach(async () => {
            await deploy();
        });

        it("should createTeePool only when maintainer", async function () {
            // Ephemeral + Standard
            const ephemeralStandardAddress = await getTeePoolAddress(TeePoolType.Ephemeral, HardwareType.Standard, ephemeralTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(ephemeralStandardAddress, TeePoolType.Ephemeral, HardwareType.Standard, ephemeralTimeout);
            (await teePoolFactory.teePools(TeePoolType.Ephemeral, HardwareType.Standard)).should.eq(ephemeralStandardAddress);

            const ephemeralStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                ephemeralStandardAddress,
            );
            (await ephemeralStandardTeePool.hasRole(DEFAULT_ADMIN_ROLE, maintainer)).should.eq(true);
            (await ephemeralStandardTeePool.teePoolType()).should.eq(TeePoolType.Ephemeral);
            (await ephemeralStandardTeePool.hardwareType()).should.eq(HardwareType.Standard);
            (await ephemeralStandardTeePool.maxTimeout()).should.eq(ephemeralTimeout);
            (await ephemeralStandardTeePool.computeEngine()).should.eq(computeEngine.target);
            (await teePoolFactory.teePools(TeePoolType.Ephemeral, HardwareType.Standard)).should.eq(ephemeralStandardAddress);

            // Ephemeral + GPU
            const ephemeralGPUAddress = await getTeePoolAddress(TeePoolType.Ephemeral, HardwareType.GPU, ephemeralTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(ephemeralGPUAddress, TeePoolType.Ephemeral, HardwareType.GPU, ephemeralTimeout);
            const ephemeralGPUTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                ephemeralGPUAddress,
            );
            (await ephemeralGPUTeePool.hasRole(DEFAULT_ADMIN_ROLE, maintainer)).should.eq(true);
            (await ephemeralGPUTeePool.teePoolType()).should.eq(TeePoolType.Ephemeral);
            (await ephemeralGPUTeePool.hardwareType()).should.eq(HardwareType.GPU);
            (await ephemeralGPUTeePool.maxTimeout()).should.eq(ephemeralTimeout);
            (await ephemeralGPUTeePool.computeEngine()).should.eq(computeEngine.target);
            (await teePoolFactory.teePools(TeePoolType.Ephemeral, HardwareType.GPU)).should.eq(ephemeralGPUAddress);

            // Persistent + Standard
            const persistentStandardAddress = await getTeePoolAddress(TeePoolType.Persistent, HardwareType.Standard, persistentTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Persistent,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(persistentStandardAddress, TeePoolType.Persistent, HardwareType.Standard, persistentTimeout);
            const persistentStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                persistentStandardAddress,
            );
            (await persistentStandardTeePool.hasRole(DEFAULT_ADMIN_ROLE, maintainer)).should.eq(true);
            (await persistentStandardTeePool.teePoolType()).should.eq(TeePoolType.Persistent);
            (await persistentStandardTeePool.hardwareType()).should.eq(HardwareType.Standard);
            (await persistentStandardTeePool.maxTimeout()).should.eq(persistentTimeout);
            (await persistentStandardTeePool.computeEngine()).should.eq(computeEngine.target);
            (await teePoolFactory.teePools(TeePoolType.Persistent, HardwareType.Standard)).should.eq(persistentStandardAddress);

            // Persistent + GPU
            const persistentGPUAddress = await getTeePoolAddress(TeePoolType.Persistent, HardwareType.GPU, persistentTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Persistent,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(persistentGPUAddress, TeePoolType.Persistent, HardwareType.GPU, persistentTimeout);
            const persistentGPUTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                persistentGPUAddress,
            );
            (await persistentGPUTeePool.hasRole(DEFAULT_ADMIN_ROLE, maintainer)).should.eq(true);
            (await persistentGPUTeePool.teePoolType()).should.eq(TeePoolType.Persistent);
            (await persistentGPUTeePool.hardwareType()).should.eq(HardwareType.GPU);
            (await persistentGPUTeePool.maxTimeout()).should.eq(persistentTimeout);
            (await persistentGPUTeePool.computeEngine()).should.eq(computeEngine.target);
            (await teePoolFactory.teePools(TeePoolType.Persistent, HardwareType.GPU)).should.eq(persistentGPUAddress);

            // Dedicated + Standard
            const dedicatedStandardAddress = await getTeePoolAddress(TeePoolType.Dedicated, HardwareType.Standard, maxUint80, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Dedicated,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(dedicatedStandardAddress, TeePoolType.Dedicated, HardwareType.Standard, maxUint80);
            const dedicatedStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                dedicatedStandardAddress,
            );
            (await dedicatedStandardTeePool.hasRole(DEFAULT_ADMIN_ROLE, maintainer)).should.eq(true);
            (await dedicatedStandardTeePool.teePoolType()).should.eq(TeePoolType.Dedicated);
            (await dedicatedStandardTeePool.hardwareType()).should.eq(HardwareType.Standard);
            (await dedicatedStandardTeePool.maxTimeout()).should.eq(maxUint80);
            (await dedicatedStandardTeePool.computeEngine()).should.eq(computeEngine.target);
            (await teePoolFactory.teePools(TeePoolType.Dedicated, HardwareType.Standard)).should.eq(dedicatedStandardAddress);

            // Dedicated + GPU
            const dedicatedGPUAddress = await getTeePoolAddress(TeePoolType.Dedicated, HardwareType.GPU, maxUint80, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Dedicated,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(dedicatedGPUAddress, TeePoolType.Dedicated, HardwareType.GPU, maxUint80);
            const dedicatedGPUTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                dedicatedGPUAddress,
            );
            (await dedicatedGPUTeePool.hasRole(DEFAULT_ADMIN_ROLE, maintainer)).should.eq(true);
            (await dedicatedGPUTeePool.teePoolType()).should.eq(TeePoolType.Dedicated);
            (await dedicatedGPUTeePool.hardwareType()).should.eq(HardwareType.GPU);
            (await dedicatedGPUTeePool.maxTimeout()).should.eq(maxUint80);
            (await dedicatedGPUTeePool.computeEngine()).should.eq(computeEngine.target);
            (await teePoolFactory.teePools(TeePoolType.Dedicated, HardwareType.GPU)).should.eq(dedicatedGPUAddress);

            await teePoolFactory
                .connect(user1)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.Standard)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );
        });

        it("should not createTeePool when invalid TeePoolType", async function () {
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.None,
                    HardwareType.Standard)
                .should.be.rejectedWith("InvalidTeePoolParams()");

            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.None)
                .should.be.rejectedWith("InvalidTeePoolParams()");

            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    4,
                    HardwareType.Standard)
                .should.be.reverted;

            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    3)
                .should.be.reverted;
        });

        it("should not create duplicate TeePool", async function () {
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.Standard)
                .should.be.fulfilled;

            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.Standard)
                .should.be.rejectedWith("TeePoolAlreadyCreated()");
        });

        it("should updateEphemeralTimeout only when maintainer", async function () {
            let newEphemeralTimeout = 10 * 60; // 10 minutes

            await teePoolFactory
                .connect(maintainer)
                .updateEphemeralTimeout(newEphemeralTimeout)
                .should.be.fulfilled;
            (await teePoolFactory.ephemeralTimeout()).should.eq(newEphemeralTimeout);

            await teePoolFactory
                .connect(user1)
                .updateEphemeralTimeout(newEphemeralTimeout)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );

            const ephemeralStandardAddress = await getTeePoolAddress(TeePoolType.Ephemeral, HardwareType.Standard, newEphemeralTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(ephemeralStandardAddress, TeePoolType.Ephemeral, HardwareType.Standard, newEphemeralTimeout);
            const ephemeralStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                ephemeralStandardAddress,
            );
            await ephemeralStandardTeePool
                .connect(maintainer)
                .updateTeePoolFactory(teePoolFactory.target);
            (await ephemeralStandardTeePool.maxTimeout()).should.eq(newEphemeralTimeout);

            newEphemeralTimeout = 15 * 60; // 15 minutes
            await teePoolFactory
                .connect(maintainer)
                .updateEphemeralTimeout(newEphemeralTimeout)
                .should.be.fulfilled;
            (await teePoolFactory.ephemeralTimeout()).should.eq(newEphemeralTimeout);
            (await ephemeralStandardTeePool.maxTimeout()).should.eq(newEphemeralTimeout);

            const ephemeralGPUAddress = await getTeePoolAddress(TeePoolType.Ephemeral, HardwareType.GPU, newEphemeralTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(ephemeralGPUAddress, TeePoolType.Ephemeral, HardwareType.GPU, newEphemeralTimeout);
            const ephemeralGPUTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                ephemeralGPUAddress,
            );
            await ephemeralGPUTeePool
                .connect(maintainer)
                .updateTeePoolFactory(teePoolFactory.target);
            (await ephemeralGPUTeePool.maxTimeout()).should.eq(newEphemeralTimeout);
        });

        it("should not updateEphemeralTimeout when invalid timeout", async function () {
            await teePoolFactory
                .connect(maintainer)
                .updateEphemeralTimeout(0)
                .should.be.rejectedWith("InvalidTimeout()");

            await teePoolFactory
                .connect(maintainer)
                .updateEphemeralTimeout(persistentTimeout)
                .should.be.rejectedWith("InvalidTimeout()");
        });

        it("should updatePersistentTimeout only when maintainer", async function () {
            let newPersistentTimeout = 3 * 60 * 60; // 3 hours

            await teePoolFactory
                .connect(maintainer)
                .updatePersistentTimeout(newPersistentTimeout)
                .should.be.fulfilled;
            (await teePoolFactory.persistentTimeout()).should.eq(newPersistentTimeout);

            await teePoolFactory
                .connect(user1)
                .updatePersistentTimeout(newPersistentTimeout)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );

            const persistentStandardAddress = await getTeePoolAddress(TeePoolType.Persistent, HardwareType.Standard, newPersistentTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Persistent,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(persistentStandardAddress, TeePoolType.Persistent, HardwareType.Standard, newPersistentTimeout);
            const persistentStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                persistentStandardAddress,
            );
            await persistentStandardTeePool
                .connect(maintainer)
                .updateTeePoolFactory(teePoolFactory.target);
            (await persistentStandardTeePool.maxTimeout()).should.eq(newPersistentTimeout);

            newPersistentTimeout = 4 * 60 * 60; // 4 hours
            await teePoolFactory
                .connect(maintainer)
                .updatePersistentTimeout(newPersistentTimeout)
                .should.be.fulfilled;
            (await teePoolFactory.persistentTimeout()).should.eq(newPersistentTimeout);
            (await persistentStandardTeePool.maxTimeout()).should.eq(newPersistentTimeout);

            const persistentGPUAddress = await getTeePoolAddress(TeePoolType.Persistent, HardwareType.GPU, newPersistentTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Persistent,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(persistentGPUAddress, TeePoolType.Persistent, HardwareType.GPU, newPersistentTimeout);
            const persistentGPUTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                persistentGPUAddress,
            );
            await persistentGPUTeePool
                .connect(maintainer)
                .updateTeePoolFactory(teePoolFactory.target);
            (await persistentGPUTeePool.maxTimeout()).should.eq(newPersistentTimeout);
        });

        it("should not updatePersistentTimeout when invalid timeout", async function () {
            await teePoolFactory
                .connect(maintainer)
                .updatePersistentTimeout(0)
                .should.be.rejectedWith("InvalidTimeout()");

            await teePoolFactory
                .connect(maintainer)
                .updatePersistentTimeout(ephemeralTimeout)
                .should.be.rejectedWith("InvalidTimeout()");

            await teePoolFactory
                .connect(maintainer)
                .updatePersistentTimeout(ephemeralTimeout - 1)
                .should.be.rejectedWith("InvalidTimeout()");

            await teePoolFactory
                .connect(maintainer)
                .updatePersistentTimeout(maxUint80)
                .should.be.rejectedWith("InvalidTimeout()");
        });
    });

    describe("TeePool", () => {
        let ephemeralStandardTeePool: ComputeEngineTeePoolImplementation;
        let dedicatedStandardTeePool: ComputeEngineTeePoolImplementation;

        const instructionId1 = 1;
        const instructionId2 = 2;

        const jobId1 = 1;
        const jobId2 = 2;
        const jobId3 = 3;
        const jobId4 = 4;
        const jobId5 = 5;
        const jobId6 = 6;
        const jobId7 = 7;
        const jobId8 = 8;
        const jobId9 = 9;
        const jobId10 = 10;

        const teeES1Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["urlES1", "publicKeyES1"]);
        const teeES2Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["urlES2", "publicKeyES2"]);
        const teeES3Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["urlES3", "publicKeyES3"]);
        const teeDS1Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["urlDS1", "publicKeyDS1"]);
        const teeDS2Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["urlDS2", "publicKeyDS2"]);

        let ephemeralStandardTee1: HardhatEthersSigner;
        let ephemeralStandardTee2: HardhatEthersSigner;
        let ephemeralStandardTee3: HardhatEthersSigner;
        let dedicatedStandardTee1: HardhatEthersSigner;
        let dedicatedStandardTee2: HardhatEthersSigner;

        beforeEach(async () => {
            await deploy();

            [
                ephemeralStandardTee1,
                ephemeralStandardTee2,
                ephemeralStandardTee3,
                dedicatedStandardTee1,
                dedicatedStandardTee2,
            ] = await ethers.getSigners();

            const instructionHash1 = keccak256(ethers.toUtf8Bytes("instruction1"));
            await computeInstructionRegistry
                .connect(user1)
                .addComputeInstruction(
                    instructionHash1,
                    "instructionUrl1",
                )
                .should.emit(computeInstructionRegistry, "ComputeInstructionAdded")
                .withArgs(instructionId1, user1, "instructionUrl1", instructionHash1);

            const ephemeralStandardAddress = await getTeePoolAddress(TeePoolType.Ephemeral, HardwareType.Standard, ephemeralTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(ephemeralStandardAddress, TeePoolType.Ephemeral, HardwareType.Standard, ephemeralTimeout);
            ephemeralStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                ephemeralStandardAddress,
            );

            const dedicatedStandardAddress = await getTeePoolAddress(TeePoolType.Dedicated, HardwareType.Standard, maxUint80, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Dedicated,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(dedicatedStandardAddress, TeePoolType.Dedicated, HardwareType.Standard, maxUint80);
            dedicatedStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                dedicatedStandardAddress,
            );
        });

        it("should addTee only when maintainer", async function () {
            await ephemeralStandardTeePool
                .connect(maintainer)
                .addTee(ephemeralStandardTee1.address, teeES1Params)
                .should.emit(ephemeralStandardTeePool, "TeeAdded")
                .withArgs(ephemeralStandardTee1.address, "urlES1", "publicKeyES1");

            await ephemeralStandardTeePool
                .connect(user1)
                .addTee(ephemeralStandardTee2.address, teeES2Params)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );

            await dedicatedStandardTeePool
                .connect(maintainer)
                .addTee(dedicatedStandardTee1.address, teeDS1Params)
                .should.emit(dedicatedStandardTeePool, "TeeAdded")
                .withArgs(dedicatedStandardTee1.address, "urlDS1", "publicKeyDS1");

            await dedicatedStandardTeePool
                .connect(user1)
                .addTee(dedicatedStandardTee2.address, teeDS2Params)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );
        });

        it("should removeTee only when maintainer", async function () {
            await ephemeralStandardTeePool
                .connect(maintainer)
                .addTee(ephemeralStandardTee1.address, teeES1Params)
                .should.emit(ephemeralStandardTeePool, "TeeAdded")
                .withArgs(ephemeralStandardTee1.address, "urlES1", "publicKeyES1");

            await ephemeralStandardTeePool
                .connect(maintainer)
                .addTee(ephemeralStandardTee2.address, teeES2Params)
                .should.emit(ephemeralStandardTeePool, "TeeAdded")
                .withArgs(ephemeralStandardTee2.address, "urlES2", "publicKeyES2");

            (await ephemeralStandardTeePool.teesCount()).should.eq(2);
            (await ephemeralStandardTeePool.activeTeesCount()).should.eq(2);

            await ephemeralStandardTeePool
                .connect(maintainer)
                .removeTee(ephemeralStandardTee1.address)
                .should.emit(ephemeralStandardTeePool, "TeeRemoved")
                .withArgs(ephemeralStandardTee1.address);

            (await ephemeralStandardTeePool.teesCount()).should.eq(2);
            (await ephemeralStandardTeePool.activeTeesCount()).should.eq(1);

            await ephemeralStandardTeePool
                .connect(user1)
                .removeTee(ephemeralStandardTee2.address)
                .should.be.rejectedWith(
                    `AccessControlUnauthorizedAccount("${user1.address}", "${MAINTAINER_ROLE}")`,
                );

            (await ephemeralStandardTeePool.teesCount()).should.eq(2);
            (await ephemeralStandardTeePool.activeTeesCount()).should.eq(1);

            await ephemeralStandardTeePool
                .connect(maintainer)
                .removeTee(ephemeralStandardTee1.address)
                .should.be.rejectedWith(`TeeNotActive("${ephemeralStandardTee1.address}")`);

            (await dedicatedStandardTeePool.teesCount()).should.eq(0);
            (await dedicatedStandardTeePool.activeTeesCount()).should.eq(0);

            await dedicatedStandardTeePool
                .connect(maintainer)
                .removeTee(dedicatedStandardTee1.address)
                .should.be.rejectedWith(`TeeNotActive("${dedicatedStandardTee1.address}")`);
        });

        it("should submitJob to active Tees only", async function () {
            await ephemeralStandardTeePool
                .connect(maintainer)
                .addTee(ephemeralStandardTee1.address, teeES1Params)
                .should.emit(ephemeralStandardTeePool, "TeeAdded")
                .withArgs(ephemeralStandardTee1.address, "urlES1", "publicKeyES1");

            await ephemeralStandardTeePool
                .connect(maintainer)
                .addTee(ephemeralStandardTee2.address, teeES2Params)
                .should.emit(ephemeralStandardTeePool, "TeeAdded")
                .withArgs(ephemeralStandardTee2.address, "urlES2", "publicKeyES2");

            await ephemeralStandardTeePool
                .connect(maintainer)
                .addTee(ephemeralStandardTee3.address, teeES3Params)
                .should.emit(ephemeralStandardTeePool, "TeeAdded")
                .withArgs(ephemeralStandardTee3.address, "urlES3", "publicKeyES3");

            await dedicatedStandardTeePool
                .connect(maintainer)
                .addTee(dedicatedStandardTee1.address, teeDS1Params)
                .should.emit(dedicatedStandardTeePool, "TeeAdded")
                .withArgs(dedicatedStandardTee1.address, "urlDS1", "publicKeyDS1");

            await dedicatedStandardTeePool
                .connect(maintainer)
                .addTee(dedicatedStandardTee2.address, teeDS2Params)
                .should.emit(dedicatedStandardTeePool, "TeeAdded")
                .withArgs(dedicatedStandardTee2.address, "urlDS2", "publicKeyDS2");

            // RR: 1 % 3 = index=1 [1, 2, 3]
            await computeEngine
                .connect(user1)
                .submitJob(
                    ephemeralTimeout,
                    false,
                    instructionId1,
                    { value: parseEther(10) },
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId1, user1)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId1, ephemeralStandardTeePool.target, ephemeralStandardTee1.address)
                .and.emit(ephemeralStandardTeePool, "JobSubmitted")
                .withArgs(jobId1, ephemeralStandardTee1.address);

            // RR: 2 % 3 = index=2 [1, 2, 3]
            await computeEngine
                .connect(user1)
                .submitJob(
                    ephemeralTimeout,
                    false,
                    instructionId1,
                    { value: parseEther(10) },
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId2, user1)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId2, ephemeralStandardTeePool.target, ephemeralStandardTee2.address)
                .and.emit(ephemeralStandardTeePool, "JobSubmitted")
                .withArgs(jobId2, ephemeralStandardTee2.address);

            // RR: 3 % 3 = 0 -> index=3 [1, 2, 3]
            await computeEngine
                .connect(user1)
                .submitJob(
                    ephemeralTimeout,
                    false,
                    instructionId1,
                    { value: parseEther(10) },
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId3, user1)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId3, ephemeralStandardTeePool.target, ephemeralStandardTee3.address)
                .and.emit(ephemeralStandardTeePool, "JobSubmitted")
                .withArgs(jobId3, ephemeralStandardTee3.address);

            await ephemeralStandardTeePool
                .connect(maintainer)
                .removeTee(ephemeralStandardTee2.address)
                .should.emit(ephemeralStandardTeePool, "TeeRemoved")
                .withArgs(ephemeralStandardTee2.address);

            // RR: 4 % 2 = 0 -> index=2 [1, 3]
            await computeEngine
                .connect(user1)
                .submitJob(
                    ephemeralTimeout,
                    false,
                    instructionId1,
                    { value: parseEther(10) },
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId4, user1)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId4, ephemeralStandardTeePool.target, ephemeralStandardTee3.address)
                .and.emit(ephemeralStandardTeePool, "JobSubmitted")
                .withArgs(jobId4, ephemeralStandardTee3.address);

            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    2 * persistentTimeout,
                    false,
                    instructionId1,
                    dedicatedStandardTee2.address,
                    { value: parseEther(10) },
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId5, user1)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId5, dedicatedStandardTeePool.target, dedicatedStandardTee2.address)
                .and.emit(dedicatedStandardTeePool, "JobSubmitted")
                .withArgs(jobId5, dedicatedStandardTee2.address);

            await dedicatedStandardTeePool
                .connect(maintainer)
                .removeTee(dedicatedStandardTee2.address)
                .should.emit(dedicatedStandardTeePool, "TeeRemoved")
                .withArgs(dedicatedStandardTee2.address);

            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    2 * persistentTimeout,
                    false,
                    instructionId1,
                    dedicatedStandardTee2.address,
                    { value: parseEther(10) },
                )
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    2 * persistentTimeout,
                    false,
                    instructionId1,
                    dedicatedStandardTee1.address,
                    { value: parseEther(10) },
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId6, user1)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId6, dedicatedStandardTeePool.target, dedicatedStandardTee1.address)
                .and.emit(dedicatedStandardTeePool, "JobSubmitted")
                .withArgs(jobId6, dedicatedStandardTee1.address);
        });
    });

    describe("Job Registry", () => {
        const instructionId1 = 1;
        const instructionId2 = 2;
        const jobId1 = 1;
        const jobId2 = 2;
        const jobId3 = 3;
        const jobId4 = 4;
        const jobId5 = 5;
        const jobId6 = 6;
        const jobId7 = 7;
        const jobId8 = 8;
        const jobId9 = 9;
        const jobId10 = 10;
        const jobId11 = 11;
        const jobId12 = 12;
        const jobId13 = 13;
        const jobId14 = 14;
        const jobId15 = 15;
        const jobId16 = 16;
        const jobId17 = 17;
        const jobId18 = 18;
        const jobId19 = 19;
        const jobId20 = 20;


        const getJobsCountTee = async (teePool: ComputeEngineTeePoolImplementation, teeAddress: any) => {
            const teeInfo = await teePool.tees(teeAddress);
            return teeInfo.jobsCount;
        }

        beforeEach(async () => {
            await deploy();
            
            const instructionHash1 = keccak256(ethers.toUtf8Bytes("instruction1"));
            await computeInstructionRegistry
                .connect(user1)
                .addComputeInstruction(
                    instructionHash1,
                    "instructionUrl1",
                )
                .should.emit(computeInstructionRegistry, "ComputeInstructionAdded")
                .withArgs(instructionId1, user1, "instructionUrl1", instructionHash1);
        });

        it("should registerJob without TeePool", async function () {
            const maxTimeout = 5;
            const gpuRequired = true;

            // No TeePool
            await computeEngine
                .connect(user1)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId1, user1)
                .and.emit(computeEngine, "TeeAssignmentFailed")
                .withArgs(jobId1, getErrorSelector("TeePoolNotFound()"));

            (await computeEngine.jobsCount()).should.eq(1);
            (await computeEngine.jobs(jobId1)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Registered, // status
                ethers.ZeroAddress, // teeAddress
                instructionId1, // computeInstructionId
                await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0), // addedTimestamp
                "", // statusMessage
                ethers.ZeroAddress, // teePoolAddress
            ]);

            const depositAmount = parseEther(10);
            const user2BalanceBefore = await ethers.provider.getBalance(user2.address);

            let tx = await computeEngine
                .connect(user2)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                    { value: depositAmount },
                );

            tx.should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId2, user2)
                .and.emit(computeEngine, "TeeAssignmentFailed")
                .withArgs(jobId2, getErrorSelector("TeePoolNotFound()"))
                .and.emit(computeEngine, "Deposit")
                .withArgs(user2, VanaToken, depositAmount);

            let txReceipt = await getReceipt(tx);

            (await computeEngine.jobsCount()).should.eq(2);
            (await computeEngine.jobs(jobId2)).should.deep.eq([
                user2.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Registered, // status
                ethers.ZeroAddress, // teeAddress
                instructionId1, // computeInstructionId
                await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0), // addedTimestamp
                "", // statusMessage
                ethers.ZeroAddress, // teePoolAddress
            ]);

            (await ethers.provider.getBalance(user2)).should.eq(user2BalanceBefore - depositAmount - txReceipt.fee);
            (await computeEngine.balanceOf(user2, VanaToken)).should.eq(depositAmount);
            (await ethers.provider.getBalance(computeEngineTreasury.target)).should.eq(depositAmount);

        });

        it("should registerJob with empty TeePool", async function () {
            const maxTimeout = 5;
            const gpuRequired = true;

            // Deploy TeePool
            const ephemeralGPUAddress = await getTeePoolAddress(TeePoolType.Ephemeral, HardwareType.GPU, ephemeralTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(ephemeralGPUAddress, TeePoolType.Ephemeral, HardwareType.GPU, ephemeralTimeout);
            const ephemeralGPUTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                ephemeralGPUAddress,
            );
            (await ephemeralGPUTeePool.teesCount()).should.eq(0);

            await computeEngine
                .connect(user1)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId1, user1)
                .and.emit(computeEngine, "TeeAssignmentFailed")
                .withArgs(jobId1, getErrorSelectorWithArgs("NoActiveTee(address)", ephemeralGPUTeePool.target));

            (await computeEngine.jobsCount()).should.eq(1);
            (await computeEngine.jobs(1)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Registered, // status
                ethers.ZeroAddress, // teeAddress
                instructionId1, // computeInstructionId
                await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0), // addedTimestamp
                "", // statusMessage
                ethers.ZeroAddress, // teePoolAddress
            ]);
        });

        it("should not submitJob when invalid computeInstructionId", async function () {
            await computeEngine
                .connect(user1)
                .submitJob(
                    5, // maxTimeout = 5s
                    true, // gpuRequired = true
                    instructionId2, // computeInstructionId = 2
                )
                .should.be.rejectedWith(`InstructionNotFound(${instructionId2})`);
        });

        it("should submitJob with non-empty TeePool", async function () {
            const maxTimeout = 5;
            const gpuRequired = true;

            let ephemeralGPUTee1: HardhatEthersSigner;
            let ephemeralGPUTee2: HardhatEthersSigner;
            let ephemeralGPUTee3: HardhatEthersSigner;

            [ephemeralGPUTee1, ephemeralGPUTee2, ephemeralGPUTee3] = await ethers.getSigners();

            // Deploy TeePools
            const ephemeralStandardAddress = await getTeePoolAddress(TeePoolType.Ephemeral, HardwareType.Standard, ephemeralTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(ephemeralStandardAddress, TeePoolType.Ephemeral, HardwareType.Standard, ephemeralTimeout);
            const ephemeralStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                ephemeralStandardAddress,
            );

            const ephemeralGPUAddress = await getTeePoolAddress(TeePoolType.Ephemeral, HardwareType.GPU, ephemeralTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(ephemeralGPUAddress, TeePoolType.Ephemeral, HardwareType.GPU, ephemeralTimeout);
            const ephemeralGPUTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                ephemeralGPUAddress,
            );

            // Add Tees to ephemeralGPUTeePool
            const tee1Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["url1", "publicKey1"]);
            await ephemeralGPUTeePool
                .connect(maintainer)
                .addTee(ephemeralGPUTee1.address, tee1Params)
                .should.emit(ephemeralGPUTeePool, "TeeAdded")
                .withArgs(ephemeralGPUTee1.address, "url1", "publicKey1");

            const tee2Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["url2", "publicKey2"]);
            await ephemeralGPUTeePool
                .connect(maintainer)
                .addTee(ephemeralGPUTee2.address, tee2Params)
                .should.emit(ephemeralGPUTeePool, "TeeAdded")
                .withArgs(ephemeralGPUTee2.address, "url2", "publicKey2");
            (await ephemeralGPUTeePool.teesCount()).should.eq(2);

            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(0);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee2.address)).should.eq(0);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee3.address)).should.eq(0);

            // jobId1 -> ephemeralGPUTee1 (1 % 2 = 1)
            await computeEngine
                .connect(user1)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId1, user1)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId1, ephemeralGPUTeePool.target, ephemeralGPUTee1.address)
                .and.emit(ephemeralGPUTeePool, "JobSubmitted")
                .withArgs(jobId1, ephemeralGPUTee1);

            (await computeEngine.jobsCount()).should.eq(1);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(1);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee2.address)).should.eq(0);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee3.address)).should.eq(0);
            (await computeEngine.jobs(jobId1)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Submitted, // status
                ephemeralGPUTee1.address, // teeAddress
                instructionId1, // computeInstructionId
                await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0), // addedTimestamp
                "", // statusMessage
                ephemeralGPUTeePool.target, // teePoolAddress
            ]);

            await computeEngine
                .connect(user2)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    false,
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId2, user2)
                .and.emit(computeEngine, "TeeAssignmentFailed")
                .withArgs(jobId2, getErrorSelectorWithArgs("NoActiveTee(address)", ephemeralStandardTeePool.target));

            (await computeEngine.jobsCount()).should.eq(2);
            (await computeEngine.jobs(jobId2)).should.deep.eq([
                user2.address, // ownerAddress
                maxTimeout, // maxTimeout
                false, // gpuRequired
                JobStatus.Registered, // status
                ethers.ZeroAddress, // teeAddress
                instructionId1, // computeInstructionId
                await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0), // addedTimestamp
                "", // statusMessage
                ethers.ZeroAddress, // teePoolAddress
            ]);

            // jobId3 -> ephemeralGPUTee2 (2 % 2 = 0 -> 2 = len)
            await computeEngine
                .connect(user2)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId3, user2)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId3, ephemeralGPUTeePool.target, ephemeralGPUTee2.address)
                .and.emit(ephemeralGPUTeePool, "JobSubmitted")
                .withArgs(jobId3, ephemeralGPUTee2.address);

            (await computeEngine.jobsCount()).should.eq(3);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(1);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee2.address)).should.eq(1);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee3.address)).should.eq(0);
            (await computeEngine.jobs(jobId3)).should.deep.eq([
                user2.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Submitted, // status
                ephemeralGPUTee2.address, // teeAddress
                instructionId1, // computeInstructionId
                await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0), // addedTimestamp
                "", // statusMessage
                ephemeralGPUTeePool.target, // teePoolAddress
            ]);

            // jobId4 -> ephemeralGPUTee1 (3 % 2 = 1)
            await computeEngine
                .connect(user1)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId4, user1)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId4, ephemeralGPUTeePool.target, ephemeralGPUTee1.address)
                .and.emit(ephemeralGPUTeePool, "JobSubmitted")
                .withArgs(jobId4, ephemeralGPUTee1.address);

            (await computeEngine.jobsCount()).should.eq(4);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(2);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee2.address)).should.eq(1);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee3.address)).should.eq(0);
            (await computeEngine.jobs(jobId4)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Submitted, // status
                ephemeralGPUTee1.address, // teeAddress
                instructionId1, // computeInstructionId
                await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0), // addedTimestamp
                "", // statusMessage
                ephemeralGPUTeePool.target, // teePoolAddress
            ]);

            // Add ephemeralGPUTee3 to ephemeralGPUTeePool
            const tee3Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["url3", "publicKey3"]);
            await ephemeralGPUTeePool
                .connect(maintainer)
                .addTee(ephemeralGPUTee3.address, tee3Params)
                .should.emit(ephemeralGPUTeePool, "TeeAdded")
                .withArgs(ephemeralGPUTee3.address, "url3", "publicKey3");
            (await ephemeralGPUTeePool.teesCount()).should.eq(3);

            // jobId5 -> ephemeralGPUTee1 (4 % 3 = 1)
            await computeEngine
                .connect(user1)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId5, user1)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId5, ephemeralGPUTeePool.target, ephemeralGPUTee1.address)
                .and.emit(ephemeralGPUTeePool, "JobSubmitted")
                .withArgs(jobId5, ephemeralGPUTee1.address);

            (await computeEngine.jobsCount()).should.eq(5);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(3);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee2.address)).should.eq(1);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee3.address)).should.eq(0);
            (await computeEngine.jobs(jobId5)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Submitted, // status
                ephemeralGPUTee1.address, // teeAddress
                instructionId1, // computeInstructionId
                await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0), // addedTimestamp
                "", // statusMessage
                ephemeralGPUTeePool.target, // teePoolAddress
            ]);

            // jobId6 -> ephemeralGPUTee2 (5 % 3 = 2)
            await computeEngine
                .connect(user1)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId6, user1)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId6, ephemeralGPUTeePool.target, ephemeralGPUTee2.address)
                .and.emit(ephemeralGPUTeePool, "JobSubmitted")
                .withArgs(jobId6, ephemeralGPUTee2.address);

            (await computeEngine.jobsCount()).should.eq(6);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(3);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee2.address)).should.eq(2);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee3.address)).should.eq(0);
            (await computeEngine.jobs(jobId6)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Submitted, // status
                ephemeralGPUTee2.address, // teeAddress
                instructionId1, // computeInstructionId
                await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0), // addedTimestamp
                "", // statusMessage
                ephemeralGPUTeePool.target, // teePoolAddress
            ]);

            // jobId7 -> ephemeralGPUTee2 (6 % 3 = 0 -> 3 = len)
            await computeEngine
                .connect(user1)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId7, user1)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId7, ephemeralGPUTeePool.target, ephemeralGPUTee3.address)
                .and.emit(ephemeralGPUTeePool, "JobSubmitted")
                .withArgs(jobId7, ephemeralGPUTee3.address);

            (await computeEngine.jobsCount()).should.eq(7);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(3);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee2.address)).should.eq(2);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee3.address)).should.eq(1);
            (await computeEngine.jobs(jobId7)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Submitted, // status
                ephemeralGPUTee3.address, // teeAddress
                instructionId1, // computeInstructionId
                await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0), // addedTimestamp
                "", // statusMessage
                ephemeralGPUTeePool.target, // teePoolAddress
            ]);
        });

        it("should resubmitJob when Tee is available", async function () {
            const maxTimeout = 5;
            const gpuRequired = true;

            let ephemeralGPUTee1: HardhatEthersSigner;

            [ephemeralGPUTee1] = await ethers.getSigners();

            await computeEngine
                .connect(user1)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId1, user1)
                .and.emit(computeEngine, "TeeAssignmentFailed")
                .withArgs(jobId1, getErrorSelector("TeePoolNotFound()"));

            const addedTimestamp = await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0);
            (await computeEngine.jobsCount()).should.eq(1);
            (await computeEngine.jobs(jobId1)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Registered, // status
                ethers.ZeroAddress, // teeAddress
                instructionId1, // computeInstructionId
                addedTimestamp, // addedTimestamp
                "", // statusMessage
                ethers.ZeroAddress, // teePoolAddress
            ]);

            // No TeePool available
            await computeEngine
                .connect(user1)
                .resubmitJob(jobId1)
                .should.be.rejectedWith(`FailedToAssignTee()`);

            // Deploy TeePools
            const ephemeralGPUAddress = await getTeePoolAddress(TeePoolType.Ephemeral, HardwareType.GPU, ephemeralTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(ephemeralGPUAddress, TeePoolType.Ephemeral, HardwareType.GPU, ephemeralTimeout);
            const ephemeralGPUTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                ephemeralGPUAddress,
            );

            // No Tee available
            await computeEngine
                .connect(user1)
                .resubmitJob(jobId1)
                .should.be.rejectedWith(`FailedToAssignTee()`);

            // Add Tees to ephemeralGPUTeePool
            const tee1Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["url1", "publicKey1"]);
            await ephemeralGPUTeePool
                .connect(maintainer)
                .addTee(ephemeralGPUTee1.address, tee1Params)
                .should.emit(ephemeralGPUTeePool, "TeeAdded")
                .withArgs(ephemeralGPUTee1.address, "url1", "publicKey1");

            // Resubmit a short or medium-duration job with an assigned Tee
            // without a dedicated TeePool -> FailedToAssignTee
            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId1, ephemeralGPUTee1.address)
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await computeEngine
                .connect(user1)
                .resubmitJob(jobId1)
                .should.emit(ephemeralGPUTeePool, "JobSubmitted")
                .withArgs(jobId1, ephemeralGPUTee1)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId1, ephemeralGPUTeePool.target, ephemeralGPUTee1.address);;

            (await computeEngine.jobsCount()).should.eq(1);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(1);
            (await computeEngine.jobs(jobId1)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Submitted, // status
                ephemeralGPUTee1.address, // teeAddress
                instructionId1, // computeInstructionId
                addedTimestamp, // addedTimestamp
                "", // statusMessage
                ephemeralGPUTeePool.target, // teePoolAddress
            ]);

            // Resubmitting a job with a Tee assigned is not allowed
            await computeEngine
                .connect(user1)
                .resubmitJob(jobId1)
                .should.be.rejectedWith(`TeeAlreadyAssigned(${jobId1})`);
        });

        it("should submitJobWithTee when Tee is available", async function () {
            const maxTimeout = 2 * persistentTimeout;
            const gpuRequired = false;

            let dedicatedStandardTee1: HardhatEthersSigner;

            [dedicatedStandardTee1] = await ethers.getSigners();

            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    persistentTimeout,
                    gpuRequired,
                    instructionId1,
                    ethers.ZeroAddress,
                )
                .should.be.rejectedWith(`ZeroTeeAddress()`);

            // Submit a medium-duration job without a dedicated pool
            // -> FailedToAssignTee
            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    persistentTimeout,
                    gpuRequired,
                    instructionId1,
                    dedicatedStandardTee1.address,
                )
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    maxTimeout,
                    gpuRequired,
                    instructionId1,
                    dedicatedStandardTee1.address,
                )
                .should.be.rejectedWith(`FailedToAssignTee()`);

            // Deploy TeePools
            const dedicatedGPUAddress = await getTeePoolAddress(TeePoolType.Dedicated, HardwareType.GPU, maxUint80, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Dedicated,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(dedicatedGPUAddress, TeePoolType.Dedicated, HardwareType.GPU, maxUint80);

            // The job requires a dedicated-standard Tee
            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    maxTimeout,
                    gpuRequired,
                    instructionId1,
                    dedicatedStandardTee1.address,
                )
                .should.be.rejectedWith(`FailedToAssignTee()`);

            const dedicatedStandardAddress = await getTeePoolAddress(TeePoolType.Dedicated, HardwareType.Standard, maxUint80, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Dedicated,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(dedicatedStandardAddress, TeePoolType.Dedicated, HardwareType.Standard, maxUint80);
            const dedicatedStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                dedicatedStandardAddress,
            );

            // The dedicated Tee is not added into the TeePool
            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    maxTimeout,
                    gpuRequired,
                    instructionId1,
                    dedicatedStandardTee1.address,
                )
                .should.be.rejectedWith(`FailedToAssignTee()`);

            // Add Tees to ephemeralGPUTeePool
            const tee1Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["url1", "publicKey1"]);
            await dedicatedStandardTeePool
                .connect(maintainer)
                .addTee(dedicatedStandardTee1.address, tee1Params)
                .should.emit(dedicatedStandardTeePool, "TeeAdded")
                .withArgs(dedicatedStandardTee1.address, "url1", "publicKey1");

            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    maxTimeout,
                    gpuRequired,
                    instructionId1,
                    dedicatedStandardTee1.address,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId1, user1)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId1, dedicatedStandardTeePool.target, dedicatedStandardTee1.address)
                .and.emit(dedicatedStandardTeePool, "JobSubmitted")
                .withArgs(jobId1, dedicatedStandardTee1.address);

            (await getJobsCountTee(dedicatedStandardTeePool, dedicatedStandardTee1.address)).should.eq(1);
            (await computeEngine.jobs(jobId1)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Submitted, // status
                dedicatedStandardTee1.address, // teeAddress
                instructionId1, // computeInstructionId
                await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0), // addedTimestamp
                "", // statusMessage
                dedicatedStandardTeePool.target, // teePoolAddress
            ]);

            // Resubmitting a job with a Tee assigned is not allowed
            await computeEngine
                .connect(computeEngineTEE)
                .resubmitJob(jobId1)
                .should.be.rejectedWith(`TeeAlreadyAssigned(${jobId1})`);
        });

        it("should resubmitJobWithTee when the dedicated Tee is available", async function () {
            const maxTimeout = 2 * persistentTimeout;
            const gpuRequired = false;

            let dedicatedStandardTee1: HardhatEthersSigner;

            [dedicatedStandardTee1] = await ethers.getSigners();

            // Deploy TeePools
            const dedicatedGPUAddress = await getTeePoolAddress(TeePoolType.Dedicated, HardwareType.GPU, maxUint80, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Dedicated,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(dedicatedGPUAddress, TeePoolType.Dedicated, HardwareType.GPU, maxUint80);

            const dedicatedStandardAddress = await getTeePoolAddress(TeePoolType.Dedicated, HardwareType.Standard, maxUint80, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Dedicated,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(dedicatedStandardAddress, TeePoolType.Dedicated, HardwareType.Standard, maxUint80);
            const dedicatedStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                dedicatedStandardAddress,
            );

            const tee1Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["url1", "publicKey1"]);
            await dedicatedStandardTeePool
                .connect(maintainer)
                .addTee(dedicatedStandardTee1.address, tee1Params)
                .should.emit(dedicatedStandardTeePool, "TeeAdded")
                .withArgs(dedicatedStandardTee1.address, "url1", "publicKey1");

            // Submit a long-running job without a Tee -> Registered
            await computeEngine
                .connect(user1)
                .submitJob(
                    maxTimeout,
                    gpuRequired,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId1, user1)
                .and.emit(computeEngine, "TeeAssignmentFailed")
                .withArgs(jobId1, getErrorSelectorWithArgs("TeeNotActive(address)", ethers.ZeroAddress));

            const addedTimestamp = await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0);

            (await computeEngine.jobsCount()).should.eq(1);
            (await getJobsCountTee(dedicatedStandardTeePool, dedicatedStandardTee1.address)).should.eq(0);
            (await computeEngine.jobs(jobId1)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Registered, // status
                ethers.ZeroAddress, // teeAddress
                instructionId1, // computeInstructionId
                addedTimestamp, // addedTimestamp
                "", // statusMessage
                ethers.ZeroAddress, // teePoolAddress
            ]);

            // Resubmit the job without a Tee -> FailedToAssignTee
            await computeEngine
                .connect(user1)
                .resubmitJob(jobId1)
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId1, ethers.ZeroAddress)
                .should.be.rejectedWith(`ZeroTeeAddress()`);

            // Resubmit the job with a Tee -> Submitted
            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId1, dedicatedStandardTee1.address)
                .should.emit(dedicatedStandardTeePool, "JobSubmitted")
                .withArgs(jobId1, dedicatedStandardTee1.address)
                .and.emit(computeEngine, "TeeAssignmentSucceeded")
                .withArgs(jobId1, dedicatedStandardTeePool.target, dedicatedStandardTee1.address);

            (await computeEngine.jobsCount()).should.eq(1);
            (await getJobsCountTee(dedicatedStandardTeePool, dedicatedStandardTee1.address)).should.eq(1);
            (await computeEngine.jobs(jobId1)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Submitted, // status
                dedicatedStandardTee1.address, // teeAddress
                instructionId1, // computeInstructionId
                addedTimestamp, // addedTimestamp
                "",
                dedicatedStandardTeePool.target, // teePoolAddress
            ]);
        });

        it("should updateJobStatus only when assigned Tee", async function () {
            const maxTimeout = 5;
            const gpuRequired = true;

            let ephemeralGPUTee1: HardhatEthersSigner;
            let ephemeralGPUTee2: HardhatEthersSigner;
            let ephemeralGPUTee3: HardhatEthersSigner;

            [ephemeralGPUTee1, ephemeralGPUTee2, ephemeralGPUTee3] = await ethers.getSigners();

            await computeEngine
                .connect(user1)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId1, user1);

            (await computeEngine.jobsCount()).should.eq(1);
            (await computeEngine.jobs(jobId1)).status.should.eq(JobStatus.Registered);
            (await computeEngine.jobs(jobId1)).teeAddress.should.eq(ethers.ZeroAddress);

            // Cannot change status before assigning a Tee
            await computeEngine
                .connect(ephemeralGPUTee1)
                .updateJobStatus(jobId1, JobStatus.Running, "")
                .should.be.rejectedWith(`NotTee()`);

            // Deploy TeePools
            const ephemeralGPUAddress = await getTeePoolAddress(TeePoolType.Ephemeral, HardwareType.GPU, ephemeralTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(ephemeralGPUAddress, TeePoolType.Ephemeral, HardwareType.GPU, ephemeralTimeout);
            const ephemeralGPUTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                ephemeralGPUAddress,
            );

            // Add Tees to ephemeralGPUTeePool
            const tee1Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["url1", "publicKey1"]);
            await ephemeralGPUTeePool
                .connect(maintainer)
                .addTee(ephemeralGPUTee1.address, tee1Params)
                .should.emit(ephemeralGPUTeePool, "TeeAdded")
                .withArgs(ephemeralGPUTee1.address, "url1", "publicKey1");

            const tee2Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["url2", "publicKey2"]);
            await ephemeralGPUTeePool
                .connect(maintainer)
                .addTee(ephemeralGPUTee2.address, tee2Params)
                .should.emit(ephemeralGPUTeePool, "TeeAdded")
                .withArgs(ephemeralGPUTee2.address, "url2", "publicKey2");
            (await ephemeralGPUTeePool.teesCount()).should.eq(2);

            // jobId2 -> ephemeralGPUTee1 - internalJobsCount = 1 (1 % 2 = 1)
            await computeEngine
                .connect(user1)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId2, user1)
                .and.emit(ephemeralGPUTeePool, "JobSubmitted")
                .withArgs(jobId2, ephemeralGPUTee1.address);

            (await computeEngine.jobsCount()).should.eq(2);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(1);
            (await computeEngine.jobs(jobId2)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId2)).teeAddress.should.eq(ephemeralGPUTee1.address);
            (await computeEngine.jobs(jobId2)).teePoolAddress.should.eq(ephemeralGPUTeePool.target);

            // Cannot change from Submitted back to Registered
            await computeEngine
                .connect(ephemeralGPUTee1)
                .updateJobStatus(jobId2, JobStatus.Registered, "")
                .should.be.rejectedWith(`InvalidStatusTransition(${JobStatus.Submitted}, ${JobStatus.Registered})`);

            await computeEngine
                .connect(ephemeralGPUTee2)
                .updateJobStatus(jobId2, JobStatus.Running, "")
                .should.be.rejectedWith(`NotTee()`);

            await computeEngine
                .connect(ephemeralGPUTee1)
                .updateJobStatus(jobId2, JobStatus.Running, "")
                .should.emit(computeEngine, "JobStatusUpdated")
                .withArgs(jobId2, JobStatus.Running, "");

            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(1);
            (await computeEngine.jobs(jobId2)).status.should.eq(JobStatus.Running);

            // Cannot change from Running back to Submitted
            await computeEngine
                .connect(ephemeralGPUTee1)
                .updateJobStatus(jobId2, JobStatus.Submitted, "")
                .should.be.rejectedWith(`InvalidStatusTransition(${JobStatus.Running}, ${JobStatus.Submitted})`);

            // Tee cannot change status to canceled
            await computeEngine
                .connect(ephemeralGPUTee1)
                .updateJobStatus(jobId2, JobStatus.Canceled, "Canceld by Tee")
                .should.be.rejectedWith(`InvalidStatusTransition(${JobStatus.Running}, ${JobStatus.Canceled})`);

            await computeEngine
                .connect(ephemeralGPUTee1)
                .updateJobStatus(jobId2, JobStatus.Completed, "artifact1")
                .should.emit(computeEngine, "JobStatusUpdated")
                .withArgs(jobId2, JobStatus.Completed, "artifact1")
                .and.emit(ephemeralGPUTeePool, "JobRemoved")
                .withArgs(jobId2);

            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(0);
            (await computeEngine.jobs(jobId2)).status.should.eq(JobStatus.Completed);
            (await computeEngine.jobs(jobId2)).statusMessage.should.eq("artifact1");
            (await computeEngine.jobs(jobId2)).teeAddress.should.eq(ephemeralGPUTee1.address);

            await computeEngine
                .connect(ephemeralGPUTee1)
                .updateJobStatus(jobId2, JobStatus.Failed, "reason1")
                .should.be.rejectedWith(`JobAlreadyDone()`);

            // jobId1 -> ephemeralGPUTee2 - internalJobsCount = 2 (2 % 2 = 0 -> 2)
            await computeEngine
                .connect(computeEngineTEE)
                .resubmitJob(jobId1)
                .should.emit(ephemeralGPUTeePool, "JobSubmitted")
                .withArgs(jobId1, ephemeralGPUTee2.address);

            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee2.address)).should.eq(1);
            (await computeEngine.jobs(jobId1)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId1)).teeAddress.should.eq(ephemeralGPUTee2.address);
            (await computeEngine.jobs(jobId1)).ownerAddress.should.eq(user1.address);

            await computeEngine
                .connect(user1)
                .cancelJob(jobId1)
                .should.emit(computeEngine, "JobCanceled")
                .withArgs(jobId1)
                .and.emit(ephemeralGPUTeePool, "JobRemoved")
                .withArgs(jobId1);

            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee2.address)).should.eq(0);

            await computeEngine
                .connect(ephemeralGPUTee2)
                .updateJobStatus(jobId1, JobStatus.Failed, "reason1")
                .should.be.rejectedWith(`InvalidStatusTransition(${JobStatus.Canceled}, ${JobStatus.Failed})`);

            // A removed/non-active Tee can still update the statuses of its jobs
            await computeEngine
                .connect(user1)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId3, user1)
                .and.emit(ephemeralGPUTeePool, "JobSubmitted")
                .withArgs(jobId3, ephemeralGPUTee1.address);

            (await computeEngine.jobsCount()).should.eq(3);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(1);
            (await computeEngine.jobs(jobId3)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId3)).teeAddress.should.eq(ephemeralGPUTee1.address);

            (await ephemeralGPUTeePool.isTee(ephemeralGPUTee1.address)).should.eq(true);
            await ephemeralGPUTeePool
                .connect(maintainer)
                .removeTee(ephemeralGPUTee1.address)
                .should.emit(ephemeralGPUTeePool, "TeeRemoved")
                .withArgs(ephemeralGPUTee1.address);
            (await ephemeralGPUTeePool.isTee(ephemeralGPUTee1.address)).should.eq(false);
            (await ephemeralGPUTeePool.teesCount()).should.eq(2);
            (await ephemeralGPUTeePool.activeTeesCount()).should.eq(1);

            await computeEngine
                .connect(ephemeralGPUTee1)
                .updateJobStatus(jobId3, JobStatus.Failed, "Tee not active")
                .should.emit(computeEngine, "JobStatusUpdated")
                .withArgs(jobId3, JobStatus.Failed, "Tee not active");
        });

        it("should submitJob to correct TeePool and Tee", async function () {
            const gpuRequired = true;
            const gpuNotRequired = false;

            let ephemeralStandardTee: HardhatEthersSigner;
            let ephemeralGPUTee: HardhatEthersSigner;
            let persistentStandardTee: HardhatEthersSigner;
            let persistentGPUTee: HardhatEthersSigner;
            let dedicatedStandardTee: HardhatEthersSigner;
            let dedicatedGPUTee: HardhatEthersSigner;

            [
                ephemeralStandardTee,
                ephemeralGPUTee,
                persistentStandardTee,
                persistentGPUTee,
                dedicatedStandardTee,
                dedicatedGPUTee
            ] = await ethers.getSigners();

            const teeESParams = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["urlES", "publicKeyES"]);
            const teeEGParams = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["urlEG", "publicKeyEG"]);
            const teePSParams = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["urlPS", "publicKeyPS"]);
            const teePGParams = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["urlPG", "publicKeyPG"]);
            const teeDSParams = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["urlDS", "publicKeyDS"]);
            const teeDGParams = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["urlDG", "publicKeyDG"]);

            // Submit a job without a TeePool -> Registered
            await computeEngine
                .connect(user1)
                .submitJob(
                    ephemeralTimeout,
                    gpuNotRequired,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId1, user1);
            (await computeEngine.jobs(jobId1)).status.should.eq(JobStatus.Registered);
            (await computeEngine.jobs(jobId1)).teeAddress.should.eq(ethers.ZeroAddress);

            await computeEngine
                .connect(user1)
                .submitJob(
                    ephemeralTimeout,
                    gpuRequired,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId2, user1);
            (await computeEngine.jobs(jobId2)).status.should.eq(JobStatus.Registered);
            (await computeEngine.jobs(jobId2)).teeAddress.should.eq(ethers.ZeroAddress);

            await computeEngine
                .connect(user1)
                .submitJob(
                    persistentTimeout,
                    gpuNotRequired,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId3, user1);
            (await computeEngine.jobs(jobId3)).status.should.eq(JobStatus.Registered);
            (await computeEngine.jobs(jobId3)).teeAddress.should.eq(ethers.ZeroAddress);

            await computeEngine
                .connect(user1)
                .submitJob(
                    persistentTimeout,
                    gpuRequired,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId4, user1);
            (await computeEngine.jobs(jobId4)).status.should.eq(JobStatus.Registered);
            (await computeEngine.jobs(jobId4)).teeAddress.should.eq(ethers.ZeroAddress);

            await computeEngine
                .connect(user1)
                .submitJob(
                    2 * persistentTimeout,
                    gpuNotRequired,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId5, user1);
            (await computeEngine.jobs(jobId5)).status.should.eq(JobStatus.Registered);
            (await computeEngine.jobs(jobId5)).teeAddress.should.eq(ethers.ZeroAddress);

            await computeEngine
                .connect(user1)
                .submitJob(
                    2 * persistentTimeout,
                    gpuRequired,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId6, user1);
            (await computeEngine.jobs(jobId6)).status.should.eq(JobStatus.Registered);
            (await computeEngine.jobs(jobId6)).teeAddress.should.eq(ethers.ZeroAddress);

            // Deploy TeePools
            const ephemeralStandardAddress = await getTeePoolAddress(TeePoolType.Ephemeral, HardwareType.Standard, ephemeralTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(ephemeralStandardAddress, TeePoolType.Ephemeral, HardwareType.Standard, ephemeralTimeout);
            const ephemeralStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                ephemeralStandardAddress,
            );
            (await ephemeralStandardTeePool.teesCount()).should.eq(0);

            const ephemeralGPUAddress = await getTeePoolAddress(TeePoolType.Ephemeral, HardwareType.GPU, ephemeralTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(ephemeralGPUAddress, TeePoolType.Ephemeral, HardwareType.GPU, ephemeralTimeout);
            const ephemeralGPUTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                ephemeralGPUAddress,
            );
            (await ephemeralGPUTeePool.teesCount()).should.eq(0);

            const persistentStandardAddress = await getTeePoolAddress(TeePoolType.Persistent, HardwareType.Standard, persistentTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Persistent,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(persistentStandardAddress, TeePoolType.Persistent, HardwareType.Standard, persistentTimeout);
            const persistentStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                persistentStandardAddress,
            );
            (await persistentStandardTeePool.teesCount()).should.eq(0);

            const persistentGPUAddress = await getTeePoolAddress(TeePoolType.Persistent, HardwareType.GPU, persistentTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Persistent,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(persistentGPUAddress, TeePoolType.Persistent, HardwareType.GPU, persistentTimeout);
            const persistentGPUTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                persistentGPUAddress,
            );
            (await persistentGPUTeePool.teesCount()).should.eq(0);

            const dedicatedStandardAddress = await getTeePoolAddress(TeePoolType.Dedicated, HardwareType.Standard, maxUint80, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Dedicated,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(dedicatedStandardAddress, TeePoolType.Dedicated, HardwareType.Standard, maxUint80);
            const dedicatedStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                dedicatedStandardAddress,
            );
            (await dedicatedStandardTeePool.teesCount()).should.eq(0);

            const dedicatedGPUAddress = await getTeePoolAddress(TeePoolType.Dedicated, HardwareType.GPU, maxUint80, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Dedicated,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(dedicatedGPUAddress, TeePoolType.Dedicated, HardwareType.GPU, maxUint80);
            const dedicatedGPUTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                dedicatedGPUAddress,
            );
            (await dedicatedGPUTeePool.teesCount()).should.eq(0);

            await ephemeralStandardTeePool
                .connect(maintainer)
                .addTee(ephemeralStandardTee.address, teeESParams)
                .should.emit(ephemeralStandardTeePool, "TeeAdded")
                .withArgs(ephemeralStandardTee.address, "urlES", "publicKeyES");
            (await ephemeralStandardTeePool.teesCount()).should.eq(1);
            (await ephemeralStandardTeePool.isTee(ephemeralStandardTee.address)).should.eq(true);
            (await getJobsCountTee(ephemeralStandardTeePool, ephemeralStandardTee.address)).should.eq(0);

            await ephemeralGPUTeePool
                .connect(maintainer)
                .addTee(ephemeralGPUTee.address, teeEGParams)
                .should.emit(ephemeralGPUTeePool, "TeeAdded")
                .withArgs(ephemeralGPUTee.address, "urlEG", "publicKeyEG");
            (await ephemeralGPUTeePool.teesCount()).should.eq(1);
            (await ephemeralGPUTeePool.isTee(ephemeralGPUTee.address)).should.eq(true);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee.address)).should.eq(0);

            await persistentStandardTeePool
                .connect(maintainer)
                .addTee(persistentStandardTee.address, teePSParams)
                .should.emit(persistentStandardTeePool, "TeeAdded")
                .withArgs(persistentStandardTee.address, "urlPS", "publicKeyPS");
            (await persistentStandardTeePool.teesCount()).should.eq(1);
            (await persistentStandardTeePool.isTee(persistentStandardTee.address)).should.eq(true);
            (await getJobsCountTee(persistentStandardTeePool, persistentStandardTee.address)).should.eq(0);

            await persistentGPUTeePool
                .connect(maintainer)
                .addTee(persistentGPUTee.address, teePGParams)
                .should.emit(persistentGPUTeePool, "TeeAdded")
                .withArgs(persistentGPUTee.address, "urlPG", "publicKeyPG");
            (await persistentGPUTeePool.teesCount()).should.eq(1);
            (await persistentGPUTeePool.isTee(persistentGPUTee.address)).should.eq(true);
            (await getJobsCountTee(persistentGPUTeePool, persistentGPUTee.address)).should.eq(0);

            // Resubmit a job to a Tee -> FailedToAssignTee
            // because the job is submitted to the dedicated pool that does not have the Tee.
            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId1, dedicatedStandardTee.address)
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId1, ephemeralStandardTee.address)
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId5, dedicatedStandardTee.address)
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await dedicatedStandardTeePool
                .connect(maintainer)
                .addTee(dedicatedStandardTee.address, teeDSParams)
                .should.emit(dedicatedStandardTeePool, "TeeAdded")
                .withArgs(dedicatedStandardTee.address, "urlDS", "publicKeyDS");
            (await dedicatedStandardTeePool.teesCount()).should.eq(1);

            await dedicatedGPUTeePool
                .connect(maintainer)
                .addTee(dedicatedGPUTee.address, teeDGParams)
                .should.emit(dedicatedGPUTeePool, "TeeAdded")
                .withArgs(dedicatedGPUTee.address, "urlDG", "publicKeyDG");
            (await dedicatedGPUTeePool.teesCount()).should.eq(1);

            // Submit a short-duration job -> ephemeralStandardTee
            await computeEngine
                .connect(user1)
                .submitJob(
                    ephemeralTimeout,
                    gpuNotRequired,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId7, user1)
                .and.emit(ephemeralStandardTeePool, "JobSubmitted")
                .withArgs(jobId7, ephemeralStandardTee.address);
            (await computeEngine.jobs(jobId7)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId7)).teeAddress.should.eq(ephemeralStandardTee.address);

            // Submit a short-duration job -> ephemeralGPUTee
            await computeEngine
                .connect(user1)
                .submitJob(
                    ephemeralTimeout,
                    gpuRequired,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId8, user1)
                .and.emit(ephemeralGPUTeePool, "JobSubmitted")
                .withArgs(jobId8, ephemeralGPUTee.address);
            (await computeEngine.jobs(jobId8)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId8)).teeAddress.should.eq(ephemeralGPUTee.address);

            // Submit a long-duration job -> persistentStandardTee
            await computeEngine
                .connect(user1)
                .submitJob(
                    persistentTimeout,
                    gpuNotRequired,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId9, user1)
                .and.emit(persistentStandardTeePool, "JobSubmitted")
                .withArgs(jobId9, persistentStandardTee.address);
            (await computeEngine.jobs(jobId9)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId9)).teeAddress.should.eq(persistentStandardTee.address);

            // Submit a long-duration job -> persistentGPUTee
            await computeEngine
                .connect(user1)
                .submitJob(
                    persistentTimeout,
                    gpuRequired,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId10, user1)
                .and.emit(persistentGPUTeePool, "JobSubmitted")
                .withArgs(jobId10, persistentGPUTee.address);
            (await computeEngine.jobs(jobId10)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId10)).teeAddress.should.eq(persistentGPUTee.address);

            // Submit a long-duration job to a non-dedicated pool
            // Failed to assign a Tee due to MaxTimeoutExceeded.
            // The pool's timeout is less than the job's timeout.
            await computeEngine
                .connect(user1)
                .submitJob(
                    maxUint80,
                    gpuNotRequired,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId11, user1);
            (await computeEngine.jobs(jobId11)).status.should.eq(JobStatus.Registered);
            (await computeEngine.jobs(jobId11)).teeAddress.should.eq(ethers.ZeroAddress);

            await computeEngine
                .connect(user1)
                .submitJob(
                    maxUint80,
                    gpuRequired,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId12, user1);
            (await computeEngine.jobs(jobId12)).status.should.eq(JobStatus.Registered);
            (await computeEngine.jobs(jobId12)).teeAddress.should.eq(ethers.ZeroAddress);

            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    maxUint80,
                    gpuNotRequired,
                    instructionId1,
                    dedicatedStandardTee.address,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId13, user1)
                .and.emit(dedicatedStandardTeePool, "JobSubmitted")
                .withArgs(jobId13, dedicatedStandardTee.address);
            (await computeEngine.jobs(jobId13)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId13)).teeAddress.should.eq(dedicatedStandardTee.address);

            // dedicatedGPUTee is not in dedicatedStandardTeePool
            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    maxUint80,
                    gpuNotRequired,
                    instructionId1,
                    dedicatedGPUTee.address,
                )
                .should.be.rejectedWith(`FailedToAssignTee()`);

            // A user can submit any job to a dedicated Tee.
            // The Tee will verify the user ownership off-chain.
            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    ephemeralTimeout,
                    gpuRequired,
                    instructionId1,
                    dedicatedGPUTee.address,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId14, user1)
                .and.emit(dedicatedGPUTeePool, "JobSubmitted")
                .withArgs(jobId14, dedicatedGPUTee.address);
            (await computeEngine.jobs(jobId14)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId14)).teeAddress.should.eq(dedicatedGPUTee.address);

            // Due to gpuNotRequired, the job will be submitted to dedicatedStandardTeePool,
            // which does not have dedicatedGPUTee.
            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    persistentTimeout,
                    gpuNotRequired,
                    instructionId1,
                    dedicatedGPUTee.address,
                )
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await computeEngine
                .connect(user1)
                .resubmitJob(jobId1)
                .should.emit(ephemeralStandardTeePool, "JobSubmitted")
                .withArgs(jobId1, ephemeralStandardTee.address);
            (await computeEngine.jobs(jobId1)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId1)).teeAddress.should.eq(ephemeralStandardTee.address);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId2, ephemeralGPUTee.address)
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId2, dedicatedStandardTee.address)
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId2, dedicatedGPUTee.address)
                .should.emit(dedicatedGPUTeePool, "JobSubmitted")
                .withArgs(jobId2, dedicatedGPUTee.address);
            (await computeEngine.jobs(jobId2)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId2)).teeAddress.should.eq(dedicatedGPUTee.address);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId3, dedicatedStandardTee.address)
                .should.emit(dedicatedStandardTeePool, "JobSubmitted")
                .withArgs(jobId3, dedicatedStandardTee.address);
            (await computeEngine.jobs(jobId3)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId3)).teeAddress.should.eq(dedicatedStandardTee.address);

            await computeEngine
                .connect(user1)
                .resubmitJob(jobId4)
                .should.emit(persistentGPUTeePool, "JobSubmitted")
                .withArgs(jobId4, persistentGPUTee.address);
            (await computeEngine.jobs(jobId4)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId4)).teeAddress.should.eq(persistentGPUTee.address);

            await computeEngine
                .connect(user1)
                .resubmitJob(jobId5)
                .should.be.rejectedWith(`FailedToAssignTee()`);
            (await computeEngine.jobs(jobId5)).status.should.eq(JobStatus.Registered);
            (await computeEngine.jobs(jobId5)).teeAddress.should.eq(ethers.ZeroAddress);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId5, dedicatedGPUTee.address)
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId5, dedicatedStandardTee.address)
                .should.emit(dedicatedStandardTeePool, "JobSubmitted")
                .withArgs(jobId5, dedicatedStandardTee.address);
            (await computeEngine.jobs(jobId5)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId5)).teeAddress.should.eq(dedicatedStandardTee.address);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId6, persistentGPUTee.address)
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId6, dedicatedGPUTee.address)
                .should.emit(dedicatedGPUTeePool, "JobSubmitted")
                .withArgs(jobId6, dedicatedGPUTee.address);
            (await computeEngine.jobs(jobId6)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId6)).teeAddress.should.eq(dedicatedGPUTee.address);

            // Resubmit a long-duration job to a non-dedicated pool
            // Failed to assign a Tee due to MaxTimeoutExceeded.
            await computeEngine
                .connect(user1)
                .resubmitJob(jobId11)
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId11, persistentStandardTee.address)
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId11, dedicatedGPUTee.address)
                .should.be.rejectedWith(`FailedToAssignTee()`);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId11, dedicatedStandardTee.address)
                .should.emit(dedicatedStandardTeePool, "JobSubmitted")
                .withArgs(jobId11, dedicatedStandardTee.address);
            (await computeEngine.jobs(jobId11)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId11)).teeAddress.should.eq(dedicatedStandardTee.address);

            await computeEngine
                .connect(user1)
                .resubmitJobWithTee(jobId12, dedicatedGPUTee.address)
                .should.emit(dedicatedGPUTeePool, "JobSubmitted")
                .withArgs(jobId12, dedicatedGPUTee.address);
            (await computeEngine.jobs(jobId12)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId12)).teeAddress.should.eq(dedicatedGPUTee.address);

            (await computeEngine.jobsCount()).should.eq(14);

            // jobId7, jobId1
            (await getJobsCountTee(ephemeralStandardTeePool, ephemeralStandardTee.address)).should.eq(2);
            // jobId8
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee.address)).should.eq(1);
            // jobId9
            (await getJobsCountTee(persistentStandardTeePool, persistentStandardTee.address)).should.eq(1);
            // jobId10, jobId4
            (await getJobsCountTee(persistentGPUTeePool, persistentGPUTee.address)).should.eq(2);
            // jobId13, jobId3, jobId5, jobId11
            (await getJobsCountTee(dedicatedStandardTeePool, dedicatedStandardTee.address)).should.eq(4);
            // jobId14, jobId2, jobId6, jobId12
            (await getJobsCountTee(dedicatedGPUTeePool, dedicatedGPUTee.address)).should.eq(4);
        });

        it("should cancelJob when owner", async function () {
            const maxTimeout = 5;
            const gpuRequired = true;

            let ephemeralGPUTee1: HardhatEthersSigner;
            let dedicatedStandardTee2: HardhatEthersSigner;
            [ephemeralGPUTee1, dedicatedStandardTee2] = await ethers.getSigners();

            // No TeePool
            await computeEngine
                .connect(user1)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId1, user1);

            let addedTimestamp = await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0);

            (await computeEngine.jobsCount()).should.eq(1);
            (await computeEngine.jobs(jobId1)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Registered, // status
                ethers.ZeroAddress, // teeAddress
                instructionId1, // computeInstructionId
                addedTimestamp, // addedTimestamp
                "", // statusMessage
                ethers.ZeroAddress, // teePoolAddress
            ]);

            await computeEngine
                .connect(user2)
                .cancelJob(jobId1)
                .should.be.rejectedWith(`NotJobOwner()`);

            // Cancel a registered job
            await computeEngine
                .connect(user1)
                .cancelJob(jobId1)
                .should.emit(computeEngine, "JobCanceled")
                .withArgs(jobId1);

            (await computeEngine.jobsCount()).should.eq(1);
            (await computeEngine.jobs(jobId1)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Canceled, // status
                ethers.ZeroAddress, // teeAddress
                instructionId1, // computeInstructionId
                addedTimestamp, // addedTimestamp
                "", // statusMessage
                ethers.ZeroAddress, // teePoolAddress
            ]);

            // Resubmitting a canceled job is not allowed
            await computeEngine
                .connect(user2)
                .resubmitJob(jobId1)
                .should.be.rejectedWith(`OnlyRegisteredJobStatus()`);

            // Deploy TeePools
            const ephemeralGPUAddress = await getTeePoolAddress(TeePoolType.Ephemeral, HardwareType.GPU, ephemeralTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.GPU)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(ephemeralGPUAddress, TeePoolType.Ephemeral, HardwareType.GPU, ephemeralTimeout);
            const ephemeralGPUTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                ephemeralGPUAddress,
            );

            // Add Tees to ephemeralGPUTeePool
            const tee1Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["url1", "publicKey1"]);
            await ephemeralGPUTeePool
                .connect(maintainer)
                .addTee(ephemeralGPUTee1.address, tee1Params)
                .should.emit(ephemeralGPUTeePool, "TeeAdded")
                .withArgs(ephemeralGPUTee1.address, "url1", "publicKey1");

            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(0);

            await computeEngine
                .connect(user1)
                .submitJob(
                    maxTimeout, // maxTimeout = 5s
                    gpuRequired, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId2, user1)
                .and.emit(ephemeralGPUTeePool, "JobSubmitted")
                .withArgs(jobId2, ephemeralGPUTee1.address);

            addedTimestamp = await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0);

            (await computeEngine.jobsCount()).should.eq(2);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(1);
            (await computeEngine.jobs(jobId2)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Submitted, // status
                ephemeralGPUTee1.address, // teeAddress
                instructionId1, // computeInstructionId
                addedTimestamp, // addedTimestamp
                "", // statusMessage
                ephemeralGPUTeePool.target, // teePoolAddress
            ]);

            await computeEngine
                .connect(user1)
                .cancelJob(jobId2)
                .should.emit(computeEngine, "JobCanceled")
                .withArgs(jobId2)
                .and.emit(ephemeralGPUTeePool, "JobRemoved")
                .withArgs(jobId2);

            (await computeEngine.jobsCount()).should.eq(2);
            (await getJobsCountTee(ephemeralGPUTeePool, ephemeralGPUTee1.address)).should.eq(0);
            (await computeEngine.jobs(jobId2)).should.deep.eq([
                user1.address, // ownerAddress
                maxTimeout, // maxTimeout
                gpuRequired, // gpuRequired
                JobStatus.Canceled, // status
                ephemeralGPUTee1.address, // teeAddress
                instructionId1, // computeInstructionId
                addedTimestamp, // addedTimestamp
                "", // statusMessage
                ephemeralGPUTeePool.target, // teePoolAddress
            ]);

            const dedicatedStandardAddress = await getTeePoolAddress(TeePoolType.Dedicated, HardwareType.Standard, maxUint80, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Dedicated,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(dedicatedStandardAddress, TeePoolType.Dedicated, HardwareType.Standard, maxUint80);
            const dedicatedStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                dedicatedStandardAddress,
            );

            // Add Tees to ephemeralGPUTeePool
            const tee2Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["url2", "publicKey2"]);
            await dedicatedStandardTeePool
                .connect(maintainer)
                .addTee(dedicatedStandardTee2.address, tee2Params)
                .should.emit(dedicatedStandardTeePool, "TeeAdded")
                .withArgs(dedicatedStandardTee2.address, "url2", "publicKey2");

            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    2 * persistentTimeout, // maxTimeout
                    false, // gpuRequired
                    instructionId1, // computeInstructionId = 1
                    dedicatedStandardTee2.address,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId3, user1)
                .and.emit(dedicatedStandardTeePool, "JobSubmitted")
                .withArgs(jobId3, dedicatedStandardTee2.address);

            addedTimestamp = await ethers.provider.getBlock("latest").then((block) => block ? block.timestamp : 0);

            (await computeEngine.jobsCount()).should.eq(3);
            (await getJobsCountTee(dedicatedStandardTeePool, dedicatedStandardTee2.address)).should.eq(1);
            (await computeEngine.jobs(jobId3)).should.deep.eq([
                user1.address, // ownerAddress
                2 * persistentTimeout, // maxTimeout
                false, // gpuRequired
                JobStatus.Submitted, // status
                dedicatedStandardTee2.address, // teeAddress
                instructionId1, // computeInstructionId
                addedTimestamp, // addedTimestamp
                "", // statusMessage
                dedicatedStandardTeePool.target, // teePoolAddress
            ]);

            await computeEngine
                .connect(user1)
                .cancelJob(jobId3)
                .should.emit(computeEngine, "JobCanceled").withArgs(jobId3)
                .and.emit(dedicatedStandardTeePool, "JobRemoved").withArgs(jobId3);

            (await computeEngine.jobsCount()).should.eq(3);
            (await getJobsCountTee(dedicatedStandardTeePool, dedicatedStandardTee2.address)).should.eq(0);
            (await computeEngine.jobs(jobId3)).should.deep.eq([
                user1.address, // ownerAddress
                2 * persistentTimeout, // maxTimeout
                false, // gpuRequired
                JobStatus.Canceled, // status
                dedicatedStandardTee2.address, // teeAddress
                instructionId1, // computeInstructionId
                addedTimestamp, // addedTimestamp
                "", // statusMessage
                dedicatedStandardTeePool.target, // teePoolAddress
            ]);
        });

        it("should not submitJob/submitJobWithTee/resubmitJob/cancelJob/updateJobStatus when paused", async function () {
            let ephemeralGPUTee1: HardhatEthersSigner;
            [ephemeralGPUTee1] = await ethers.getSigners();

            await computeEngine
                .connect(maintainer)
                .pause()
                .should.be.fulfilled;
            (await computeEngine.paused()).should.eq(true);

            await computeEngine
                .connect(user1)
                .submitJob(
                    5, // maxTimeout = 5s
                    true, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                )
                .should.be.rejectedWith("EnforcedPause()");

            await computeEngine
                .connect(user1)
                .submitJobWithTee(
                    5, // maxTimeout = 5s
                    true, // gpuRequired = true
                    instructionId1, // computeInstructionId = 1
                    ephemeralGPUTee1.address,
                )
                .should.be.rejectedWith("EnforcedPause()");

            await computeEngine
                .connect(user1)
                .resubmitJob(jobId1)
                .should.be.rejectedWith("EnforcedPause()");

            await computeEngine
                .connect(user1)
                .cancelJob(jobId1)
                .should.be.rejectedWith("EnforcedPause()");

            await computeEngine
                .connect(user1)
                .updateJobStatus(jobId1, JobStatus.Registered, "")
                .should.be.rejectedWith("EnforcedPause()");
        });
    });

    describe("Payment", function () {
        let user1ERC20Balance = parseEther(1_000);
        let user2ERC20Balance = parseEther(2_000);
        let erc20Mock: ERC20Mock;

        beforeEach(async () => {
            await deploy();

            const erc20MockDeploy = await ethers.getContractFactory("ERC20Mock", {
                signer: dlp1Owner,
            });
            erc20Mock = await erc20MockDeploy.deploy("DLP1Token", "DLP1T");
            (await erc20Mock.balanceOf(dlp1Owner.address)).should.eq(parseEther(1_000_000));

            await erc20Mock
                .connect(dlp1Owner)
                .transfer(user1.address, user1ERC20Balance);
            (await erc20Mock.balanceOf(user1.address)).should.eq(user1ERC20Balance);

            await erc20Mock
                .connect(dlp1Owner)
                .transfer(user2.address, user2ERC20Balance);
            (await erc20Mock.balanceOf(user2.address)).should.eq(user2ERC20Balance);
        });

        it("should deposit and withdraw VANA", async function () {
            let user1VanaBalance = await ethers.provider.getBalance(user1.address);
            let user1DepositAmount: bigint = parseEther(100);
            let computeEngineTreasuryVanaBalance = await ethers.provider.getBalance(computeEngineTreasury.target);

            (await ethers.provider.getBalance(computeEngine.target)).should.eq(0);
            computeEngineTreasuryVanaBalance.should.eq(0);

            let tx = await computeEngine
                .connect(user1)
                .deposit(VanaToken, user1DepositAmount, { value: user1DepositAmount });
            let txReceipt = await getReceipt(tx);
            tx.should.emit(computeEngine, "Deposit")
                .withArgs(user1.address, VanaToken, user1DepositAmount);

            user1VanaBalance = user1VanaBalance - user1DepositAmount - txReceipt.fee;
            computeEngineTreasuryVanaBalance = computeEngineTreasuryVanaBalance + user1DepositAmount;

            (await ethers.provider.getBalance(user1.address)).should.eq(user1VanaBalance);
            (await ethers.provider.getBalance(computeEngine.target)).should.eq(0);
            (await ethers.provider.getBalance(computeEngineTreasury.target)).should.eq(user1DepositAmount);
            (await computeEngine.balanceOf(user1.address, VanaToken)).should.eq(user1DepositAmount);

            await computeEngine
                .connect(user1)
                .deposit(VanaToken, 0, { value: user1DepositAmount })
                .should.be.rejectedWith("InvalidAmount()");

            await computeEngine
                .connect(user1)
                .deposit(VanaToken, user1DepositAmount)
                .should.be.rejectedWith("InvalidVanaAmount()");

            await computeEngine
                .connect(user1)
                .deposit(VanaToken, user1DepositAmount, { value: user1DepositAmount - 1n })
                .should.be.rejectedWith("InvalidVanaAmount()");

            (await computeEngine.balanceOf(user1.address, VanaToken)).should.eq(user1DepositAmount);
            (await computeEngine.balanceOf(user1.address, erc20Mock.target)).should.eq(0);

            user1VanaBalance = await ethers.provider.getBalance(user1.address);
            let user1WithdrawAmount: bigint = user1DepositAmount / 2n;
            tx = await computeEngine
                .connect(user1)
                .withdraw(VanaToken, user1WithdrawAmount);
            txReceipt = await getReceipt(tx);
            tx.should.emit(computeEngine, "Withdraw")
                .withArgs(user1.address, VanaToken, user1WithdrawAmount)
                .and.emit(computeEngineTreasury, "Transfer")
                .withArgs(user1.address, VanaToken, user1WithdrawAmount);

            computeEngineTreasuryVanaBalance = computeEngineTreasuryVanaBalance - user1WithdrawAmount;

            user1VanaBalance = user1VanaBalance + user1WithdrawAmount - txReceipt.fee;
            (await ethers.provider.getBalance(user1.address)).should.eq(user1VanaBalance);
            (await ethers.provider.getBalance(computeEngine.target)).should.eq(0);
            (await ethers.provider.getBalance(computeEngineTreasury.target)).should.eq(computeEngineTreasuryVanaBalance);
            (await computeEngine.balanceOf(user1.address, VanaToken)).should.eq(user1DepositAmount - user1WithdrawAmount);

            await computeEngine
                .connect(user1)
                .withdraw(VanaToken, 0)
                .should.be.rejectedWith("InvalidAmount()");

            await computeEngine
                .connect(user1)
                .withdraw(VanaToken, user1WithdrawAmount + 1n)
                .should.be.rejectedWith("InsufficientBalance()");
        });

        it("should deposit and withdraw ERC20", async function () {
            let user1ERC20Balance = await erc20Mock.balanceOf(user1.address);
            let user1DepositAmount: bigint = parseEther(100);
            let computeEngineTreasuryERC20Balance = await erc20Mock.balanceOf(computeEngineTreasury.target);

            (await erc20Mock.balanceOf(computeEngine.target)).should.eq(0);
            computeEngineTreasuryERC20Balance.should.eq(0);

            await computeEngine
                .connect(user1)
                .deposit(erc20Mock.target, user1DepositAmount)
                .should.be.rejectedWith(`ERC20InsufficientAllowance("${computeEngine.target}", 0, ${user1DepositAmount})`);

            await erc20Mock
                .connect(user1)
                .approve(computeEngine.target, user1DepositAmount);

            await computeEngine
                .connect(user1)
                .deposit(erc20Mock.target, user1DepositAmount)
                .should.emit(computeEngine, "Deposit")
                .withArgs(user1.address, erc20Mock.target, user1DepositAmount);

            user1ERC20Balance = user1ERC20Balance - user1DepositAmount;
            computeEngineTreasuryERC20Balance = computeEngineTreasuryERC20Balance + user1DepositAmount;

            (await erc20Mock.balanceOf(user1.address)).should.eq(user1ERC20Balance);
            (await erc20Mock.balanceOf(computeEngine.target)).should.eq(0);
            (await erc20Mock.balanceOf(computeEngineTreasury.target)).should.eq(user1DepositAmount);
            (await computeEngine.balanceOf(user1.address, erc20Mock.target)).should.eq(user1DepositAmount);

            await computeEngine
                .connect(user1)
                .deposit(erc20Mock.target, 0, { value: user1DepositAmount })
                .should.be.rejectedWith("InvalidAmount()");

            (await computeEngine.balanceOf(user1.address, VanaToken)).should.eq(0);
            (await computeEngine.balanceOf(user1.address, erc20Mock.target)).should.eq(user1DepositAmount);

            let user1WithdrawAmount: bigint = user1DepositAmount / 2n;
            await computeEngine
                .connect(user1)
                .withdraw(erc20Mock.target, user1WithdrawAmount)
                .should.emit(computeEngine, "Withdraw")
                .withArgs(user1.address, erc20Mock.target, user1WithdrawAmount)
                .and.emit(computeEngineTreasury, "Transfer")
                .withArgs(user1.address, erc20Mock.target, user1WithdrawAmount);

            computeEngineTreasuryERC20Balance = computeEngineTreasuryERC20Balance - user1WithdrawAmount;

            user1ERC20Balance = user1ERC20Balance + user1WithdrawAmount;
            (await erc20Mock.balanceOf(user1.address)).should.eq(user1ERC20Balance);
            (await erc20Mock.balanceOf(computeEngine.target)).should.eq(0);
            (await erc20Mock.balanceOf(computeEngineTreasury.target)).should.eq(computeEngineTreasuryERC20Balance);
            (await computeEngine.balanceOf(user1.address, erc20Mock.target)).should.eq(user1DepositAmount - user1WithdrawAmount);

            await computeEngine
                .connect(user1)
                .withdraw(VanaToken, 0)
                .should.be.rejectedWith("InvalidAmount()");

            await computeEngine
                .connect(user1)
                .withdraw(VanaToken, user1WithdrawAmount + 1n)
                .should.be.rejectedWith("InsufficientBalance()");

        });

        it("should executePaymentRequest from queryEngine", async function () {
            const jobId1 = 1;
            const jobId2 = 2;
            const jobId3 = 3;

            const dlpId1 = 1;
            const dlpId2 = 2;

            const instructionId1 = 1;

            let mockQueryEngine: HardhatEthersSigner;
            let ephemeralStandardTee1: HardhatEthersSigner;
            let dedicatedStandardTee2: HardhatEthersSigner;

            [mockQueryEngine, ephemeralStandardTee1, dedicatedStandardTee2] = await ethers.getSigners();

            const requestedAmount = parseEther(100);
            const requestParams1 = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [jobId1, dlpId1]);
            const requestParams2 = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [jobId2, dlpId1]);
            const requestParams3 = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [jobId3, dlpId2]);

            await computeEngine
                .connect(user1)
                .executePaymentRequest(VanaToken, requestedAmount, "0x")
                .should.be.rejectedWith("UnauthorizedPaymentRequestor()");

            await computeEngine
                .connect(maintainer)
                .updateQueryEngine(mockQueryEngine.address)
                .should.be.fulfilled;
            (await computeEngine.queryEngine()).should.eq(mockQueryEngine.address);

            // Invalid jobId format
            await computeEngine
                .connect(mockQueryEngine)
                .executePaymentRequest(VanaToken, requestedAmount, "0x")
                .should.not.be.fulfilled;

            await computeEngine
                .connect(mockQueryEngine)
                .executePaymentRequest(VanaToken, requestedAmount, requestParams1)
                .should.be.rejectedWith(`JobNotFound(${jobId1})`);

            const instructionHash1 = keccak256(ethers.toUtf8Bytes("instruction1"));
            await computeInstructionRegistry
                .connect(user1)
                .addComputeInstruction(
                    instructionHash1,
                    "instructionUrl1",
                )
                .should.emit(computeInstructionRegistry, "ComputeInstructionAdded")
                .withArgs(instructionId1, user1, "instructionUrl1", instructionHash1);

            // No TeePool
            await computeEngine
                .connect(user1)
                .submitJob(
                    ephemeralTimeout,
                    false,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId1, user1);
            (await computeEngine.jobs(jobId1)).status.should.eq(JobStatus.Registered);
            (await computeEngine.jobs(jobId1)).teeAddress.should.eq(ethers.ZeroAddress);
            (await computeEngine.jobs(jobId1)).ownerAddress.should.eq(user1.address);

            await computeEngine
                .connect(mockQueryEngine)
                .executePaymentRequest(VanaToken, requestedAmount, requestParams1)
                .should.be.rejectedWith(`JobNotSubmitted(${jobId1})`);

            // Deploy TeePools
            const ephemeralStandardAddress = await getTeePoolAddress(TeePoolType.Ephemeral, HardwareType.Standard, ephemeralTimeout, teePoolFactoryAddress);
            await teePoolFactory
                .connect(maintainer)
                .createTeePool(
                    TeePoolType.Ephemeral,
                    HardwareType.Standard)
                .should.emit(teePoolFactory, "TeePoolCreated")
                .withArgs(ephemeralStandardAddress, TeePoolType.Ephemeral, HardwareType.Standard, ephemeralTimeout);
            const ephemeralStandardTeePool = await ethers.getContractAt(
                "ComputeEngineTeePoolImplementation",
                ephemeralStandardAddress,
            );

            // Add Tees to ephemeralGPUTeePool
            const tee1Params = ethers.AbiCoder.defaultAbiCoder().encode(["string", "string"], ["url1", "publicKey1"]);
            await ephemeralStandardTeePool
                .connect(maintainer)
                .addTee(ephemeralStandardTee1.address, tee1Params)
                .should.emit(ephemeralStandardTeePool, "TeeAdded")
                .withArgs(ephemeralStandardTee1.address, "url1", "publicKey1");

            await computeEngine
                .connect(user1)
                .resubmitJob(jobId1)
                .should.emit(ephemeralStandardTeePool, "JobSubmitted")
                .withArgs(jobId1, ephemeralStandardTee1.address);
            (await computeEngine.jobs(jobId1)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId1)).teeAddress.should.eq(ephemeralStandardTee1.address);

            await computeEngine
                .connect(mockQueryEngine)
                .executePaymentRequest(VanaToken, requestedAmount, requestParams1)
                .should.be.rejectedWith(`InsufficientBalance()`);

            let computeEngineTreasuryVanaBalance = 0n;

            const depositAmount = parseEther(1000);
            await computeEngine
                .connect(user1)
                .deposit(VanaToken, depositAmount, { value: depositAmount });
            computeEngineTreasuryVanaBalance += depositAmount;

            (await computeEngine.balanceOf(user1.address, VanaToken)).should.eq(depositAmount);
            (await ethers.provider.getBalance(computeEngineTreasury.target)).should.eq(computeEngineTreasuryVanaBalance);


            let mockQueryEngineBalance = await ethers.provider.getBalance(mockQueryEngine.address);
            let tx = await computeEngine
                .connect(mockQueryEngine)
                .executePaymentRequest(VanaToken, requestedAmount, requestParams1);
            tx.should.emit(computeEngine, "PaymentExecuted")
                .withArgs(jobId1, VanaToken, requestedAmount);
            let txReceipt = await getReceipt(tx);
            mockQueryEngineBalance = mockQueryEngineBalance + requestedAmount - txReceipt.fee;
            computeEngineTreasuryVanaBalance = computeEngineTreasuryVanaBalance - requestedAmount;

            (await computeEngine.balanceOf(user1.address, VanaToken)).should.eq(depositAmount - requestedAmount);
            (await ethers.provider.getBalance(mockQueryEngine.address)).should.eq(mockQueryEngineBalance);
            (await ethers.provider.getBalance(computeEngineTreasury.target)).should.eq(computeEngineTreasuryVanaBalance);

            await computeEngine
                .connect(user2)
                .submitJob(
                    ephemeralTimeout,
                    false,
                    instructionId1,
                    { value: depositAmount }
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId2, user2)
                .and.emit(ephemeralStandardTeePool, "JobSubmitted")
                .withArgs(jobId2, ephemeralStandardTee1.address);
            computeEngineTreasuryVanaBalance += depositAmount;

            (await computeEngine.jobs(jobId2)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId2)).teeAddress.should.eq(ephemeralStandardTee1.address);
            (await ethers.provider.getBalance(computeEngineTreasury.target)).should.eq(computeEngineTreasuryVanaBalance);
            (await computeEngine.balanceOf(user2.address, VanaToken)).should.eq(depositAmount);

            tx = await computeEngine
                .connect(mockQueryEngine)
                .executePaymentRequest(VanaToken, requestedAmount, requestParams2);
            tx.should.emit(computeEngine, "PaymentExecuted")
                .withArgs(jobId2, VanaToken, requestedAmount);
            txReceipt = await getReceipt(tx);
            mockQueryEngineBalance = mockQueryEngineBalance + requestedAmount - txReceipt.fee;
            computeEngineTreasuryVanaBalance = computeEngineTreasuryVanaBalance - requestedAmount;

            (await ethers.provider.getBalance(mockQueryEngine.address)).should.eq(mockQueryEngineBalance);
            (await ethers.provider.getBalance(computeEngineTreasury.target)).should.eq(computeEngineTreasuryVanaBalance);
            (await computeEngine.balanceOf(user2.address, VanaToken)).should.eq(depositAmount - requestedAmount);

            // Payment with ERC20
            await computeEngine
                .connect(user1)
                .submitJob(
                    ephemeralTimeout,
                    false,
                    instructionId1,
                )
                .should.emit(computeEngine, "JobRegistered")
                .withArgs(jobId3, user1)
                .and.emit(ephemeralStandardTeePool, "JobSubmitted")
                .withArgs(jobId3, ephemeralStandardTee1.address);
            (await computeEngine.jobs(jobId3)).status.should.eq(JobStatus.Submitted);
            (await computeEngine.jobs(jobId3)).teeAddress.should.eq(ephemeralStandardTee1.address);
            (await computeEngine.jobs(jobId3)).ownerAddress.should.eq(user1.address);

            const requestedERC20Amount = parseEther(10);
            await computeEngine
                .connect(mockQueryEngine)
                .executePaymentRequest(erc20Mock.target, requestedERC20Amount, requestParams3)
                .should.be.rejectedWith(`InsufficientBalance()`);

            await erc20Mock
                .connect(user1)
                .approve(computeEngine.target, depositAmount);

            await computeEngine
                .connect(user1)
                .deposit(erc20Mock.target, depositAmount)
                .should.emit(computeEngine, "Deposit")
                .withArgs(user1.address, erc20Mock.target, depositAmount);
            (await erc20Mock.balanceOf(user1.address)).should.eq(0);
            (await computeEngine.balanceOf(user1.address, erc20Mock.target)).should.eq(depositAmount);
            (await erc20Mock.balanceOf(computeEngineTreasury.target)).should.eq(depositAmount);

            await computeEngine
                .connect(mockQueryEngine)
                .executePaymentRequest(erc20Mock.target, requestedERC20Amount, requestParams3)
                .should.emit(computeEngine, "PaymentExecuted")
                .withArgs(jobId3, erc20Mock.target, requestedERC20Amount);
            (await erc20Mock.balanceOf(mockQueryEngine.address)).should.eq(requestedERC20Amount);
            (await erc20Mock.balanceOf(computeEngineTreasury.target)).should.eq(depositAmount - requestedERC20Amount);
            (await computeEngine.balanceOf(user1.address, erc20Mock.target)).should.eq(depositAmount - requestedERC20Amount);
        });

        it("should nonReentrant", async function () {
            const attacker = await (await ethers.getContractFactory("ComputeEngineMaliciousContract", {
                signer: user1,
            })).deploy(computeEngine.target);

            const user1DepositAmount = parseEther(100);
            await attacker
                .connect(user1)
                .deposit({ value: user1DepositAmount });
            (await computeEngine.balanceOf(attacker.target, VanaToken)).should.eq(user1DepositAmount);

            /*
                attacker.withdraw
                  computeEngine.withdraw
                    computeEngineTreasury.transfer
                        Address.sendValue
                            attacker.receive
                                computeEngine.withdraw
                                    revert ReentrancyGuardReentrantCall
                        revert FailedInnerCall  
            */
            await attacker
                .connect(user1)
                .withdraw(user1DepositAmount - 1n)
                .should.be.rejectedWith("FailedInnerCall");

            // No reentrancy
            await attacker
                .connect(user1)
                .withdraw(user1DepositAmount);
            (await computeEngine.balanceOf(attacker.target, VanaToken)).should.eq(0);
            (await ethers.provider.getBalance(attacker.target)).should.eq(user1DepositAmount);
        });

        it("should not deposit/withdraw/executePaymentRequest when paused", async function () {
            await computeEngine
                .connect(maintainer)
                .pause()
                .should.emit(computeEngine, "Paused");
            (await computeEngine.paused()).should.eq(true);

            await computeEngine
                .connect(user1)
                .deposit(VanaToken, parseEther(100), { value: parseEther(100) })
                .should.be.rejectedWith("EnforcedPause()");

            await computeEngine
                .connect(user1)
                .deposit(erc20Mock, parseEther(100), { value: parseEther(100) })
                .should.be.rejectedWith("EnforcedPause()");

            await computeEngine
                .connect(maintainer)
                .unpause()
                .should.emit(computeEngine, "Unpaused");
            (await computeEngine.paused()).should.eq(false);

            let depositAmount = parseEther(100);
            await computeEngine
                .connect(user1)
                .deposit(VanaToken, depositAmount, { value: depositAmount })
                .should.emit(computeEngine, "Deposit")
                .withArgs(user1.address, VanaToken, depositAmount);
            (await computeEngine.balanceOf(user1.address, VanaToken)).should.eq(depositAmount);

            await erc20Mock
                .connect(user1)
                .approve(computeEngine.target, depositAmount);

            await computeEngine
                .connect(user1)
                .deposit(erc20Mock, depositAmount)
                .should.emit(computeEngine, "Deposit")
                .withArgs(user1.address, erc20Mock, depositAmount);
            (await computeEngine.balanceOf(user1.address, erc20Mock)).should.eq(depositAmount);

            await computeEngine
                .connect(maintainer)
                .pause()
                .should.emit(computeEngine, "Paused");
            (await computeEngine.paused()).should.eq(true);

            await computeEngine
                .connect(user1)
                .withdraw(VanaToken, depositAmount)
                .should.be.rejectedWith("EnforcedPause()");
            (await computeEngine.balanceOf(user1.address, VanaToken)).should.eq(depositAmount);

            await computeEngine
                .connect(user1)
                .withdraw(erc20Mock, depositAmount)
                .should.be.rejectedWith("EnforcedPause()");
            (await computeEngine.balanceOf(user1.address, erc20Mock)).should.eq(depositAmount);

            await computeEngine
                .connect(maintainer)
                .executePaymentRequest(VanaToken, parseEther(100), "0x")
                .should.be.rejectedWith("EnforcedPause()");

            await computeEngine
                .connect(maintainer)
                .unpause()
                .should.emit(computeEngine, "Unpaused");
            (await computeEngine.paused()).should.eq(false);

            // Admin of the treasury contract is the owner of the computeEngine
            await computeEngineTreasury
                .connect(owner)
                .pause()
                .should.emit(computeEngineTreasury, "Paused");
            (await computeEngineTreasury.paused()).should.eq(true);

            // Cannot withdraw if the treasury is paused
            await computeEngine
                .connect(user1)
                .withdraw(VanaToken, depositAmount)
                .should.be.rejectedWith("EnforcedPause()");
            (await computeEngine.balanceOf(user1.address, VanaToken)).should.eq(depositAmount);

            await computeEngine
                .connect(user1)
                .withdraw(erc20Mock, depositAmount)
                .should.be.rejectedWith("EnforcedPause()");
            (await computeEngine.balanceOf(user1.address, erc20Mock)).should.eq(depositAmount);
        });
    });
});