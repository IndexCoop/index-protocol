import { ethers } from "hardhat";
import DeployHelper from "../utils/deploys";

// Polygon addresses
const WMATIC = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  console.log("Deploying Index Protocol to Polygon mainnet...");
  console.log("Deployer address:", deployerAddress);

  const balance = await deployer.getBalance();
  console.log("Deployer balance:", ethers.utils.formatEther(balance), "MATIC");

  const deployHelper = new DeployHelper(deployer);

  // 1. Deploy Controller
  console.log("\n1. Deploying Controller...");
  const controller = await deployHelper.core.deployController(deployerAddress);
  await controller.deployed();
  console.log("Controller deployed at:", controller.address);

  // 2. Deploy SetTokenCreator
  console.log("\n2. Deploying SetTokenCreator...");
  const setTokenCreator = await deployHelper.core.deploySetTokenCreator(controller.address);
  await setTokenCreator.deployed();
  console.log("SetTokenCreator deployed at:", setTokenCreator.address);

  // 3. Deploy IntegrationRegistry
  console.log("\n3. Deploying IntegrationRegistry...");
  const integrationRegistry = await deployHelper.core.deployIntegrationRegistry(controller.address);
  await integrationRegistry.deployed();
  console.log("IntegrationRegistry deployed at:", integrationRegistry.address);

  // 4. Deploy BasicIssuanceModule
  console.log("\n4. Deploying BasicIssuanceModule...");
  const basicIssuanceModule = await deployHelper.modules.deployBasicIssuanceModule(controller.address);
  await basicIssuanceModule.deployed();
  console.log("BasicIssuanceModule deployed at:", basicIssuanceModule.address);

  // 5. Deploy StreamingFeeModule
  console.log("\n5. Deploying StreamingFeeModule...");
  const streamingFeeModule = await deployHelper.modules.deployStreamingFeeModule(controller.address);
  await streamingFeeModule.deployed();
  console.log("StreamingFeeModule deployed at:", streamingFeeModule.address);

  // 6. Deploy TradeModule
  console.log("\n6. Deploying TradeModule...");
  const tradeModule = await deployHelper.modules.deployTradeModule(controller.address);
  await tradeModule.deployed();
  console.log("TradeModule deployed at:", tradeModule.address);

  // 7. Deploy DebtIssuanceModuleV2
  console.log("\n7. Deploying DebtIssuanceModuleV2...");
  const debtIssuanceModuleV2 = await deployHelper.modules.deployDebtIssuanceModuleV2(controller.address);
  await debtIssuanceModuleV2.deployed();
  console.log("DebtIssuanceModuleV2 deployed at:", debtIssuanceModuleV2.address);

  // 8. Deploy WrapModuleV2
  console.log("\n8. Deploying WrapModuleV2...");
  const wrapModuleV2 = await deployHelper.modules.deployWrapModuleV2(controller.address, WMATIC);
  await wrapModuleV2.deployed();
  console.log("WrapModuleV2 deployed at:", wrapModuleV2.address);

  // Initialize Controller with all factories, modules, and resources
  console.log("\n9. Initializing Controller...");
  const tx = await controller.initialize(
    [setTokenCreator.address], // factories
    [basicIssuanceModule.address, streamingFeeModule.address, tradeModule.address, debtIssuanceModuleV2.address, wrapModuleV2.address], // modules
    [integrationRegistry.address], // resources
    [0] // resource IDs (0 = IntegrationRegistry)
  );
  await tx.wait();
  console.log("Controller initialized!");

  console.log("\n========================================");
  console.log("Deployment Complete!");
  console.log("========================================");
  console.log("\nDeployed Contract Addresses:");
  console.log("Controller:", controller.address);
  console.log("SetTokenCreator:", setTokenCreator.address);
  console.log("IntegrationRegistry:", integrationRegistry.address);
  console.log("BasicIssuanceModule:", basicIssuanceModule.address);
  console.log("StreamingFeeModule:", streamingFeeModule.address);
  console.log("TradeModule:", tradeModule.address);
  console.log("DebtIssuanceModuleV2:", debtIssuanceModuleV2.address);
  console.log("WrapModuleV2:", wrapModuleV2.address);
  console.log("\nFee Recipient:", deployerAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
