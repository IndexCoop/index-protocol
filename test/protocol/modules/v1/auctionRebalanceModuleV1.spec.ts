import "module-alias/register";
import { BigNumber } from "ethers";

import { Address, AuctionExecutionParams, StreamingFeeState } from "@utils/types";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, MAX_UINT_256, ONE_DAY_IN_SECONDS, ONE_HOUR_IN_SECONDS, PRECISE_UNIT, ZERO, ZERO_BYTES } from "@utils/constants";
import {
  AuctionRebalanceModuleV1,
  BoundedStepwiseExponentialPriceAdapter,
  BoundedStepwiseLinearPriceAdapter,
  ConstantPriceAdapter,
  SetToken,
} from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  bitcoin,
  ether,
  preciseDiv,
  preciseMul,
  preciseMulCeil,
  usdc
} from "@utils/index";
import {
  cacheBeforeEach,
  getAccounts,
  getRandomAccount,
  getRandomAddress,
  getSystemFixture,
  getWaffleExpect,
  increaseTimeAsync,
  getTransactionTimestamp,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";
import { ContractTransaction } from "ethers";

const expect = getWaffleExpect();

describe("AuctionRebalanceModuleV1", () => {
  let owner: Account;
  let bidder: Account;
  let positionModule: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let index: SetToken;
  let indexWithWeth: SetToken;
  let auctionModule: AuctionRebalanceModuleV1;

  let boundedStepwiseLinearPriceAdapterName: string;
  let boundedStepwiseLinearPriceAdapter: BoundedStepwiseLinearPriceAdapter;

  let boundedStepwiseExponentialPriceAdapterName: string;
  let boundedStepwiseExponentialPriceAdapter: BoundedStepwiseExponentialPriceAdapter;

  let constantPriceAdapterName: string;
  let constantPriceAdapter: ConstantPriceAdapter;

  let indexComponents: Address[];
  let indexUnits: BigNumber[];
  let indexWithWethComponents: Address[];
  let indexWithWethUnits: BigNumber[];

  before(async () => {
    [
      owner,
      bidder,
      positionModule,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);

    await setup.initialize();

    auctionModule = await deployer.modules.deployAuctionRebalanceModuleV1(
      setup.controller.address,
      setup.weth.address
    );
    await setup.controller.addModule(auctionModule.address);
    await setup.controller.addModule(positionModule.address);

    constantPriceAdapterName = "CONSTANT_PRICE_ADAPTER";
    constantPriceAdapter = await deployer.adapters.deployConstantPriceAdapter();

    boundedStepwiseExponentialPriceAdapterName = "BOUNDED_STEPWISE_EXPONENTIAL_PRICE_ADAPTER";
    boundedStepwiseExponentialPriceAdapter = await deployer.adapters.deployBoundedStepwiseExponentialPriceAdapter();

    boundedStepwiseLinearPriceAdapterName = "BOUNDED_STEPWISE_LINEAR_PRICE_ADAPTER";
    boundedStepwiseLinearPriceAdapter = await deployer.adapters.deployBoundedStepwiseLinearPriceAdapter();

    await setup.integrationRegistry.batchAddIntegration(
      [auctionModule.address, auctionModule.address, auctionModule.address],
      [constantPriceAdapterName, boundedStepwiseExponentialPriceAdapterName, boundedStepwiseLinearPriceAdapterName],
      [constantPriceAdapter.address, boundedStepwiseExponentialPriceAdapter.address, boundedStepwiseLinearPriceAdapter.address]
    );
  });

  cacheBeforeEach(async () => {
    indexComponents = [setup.dai.address, setup.wbtc.address];
    indexUnits = [ether(10000), bitcoin(.5)];
    index = await setup.createSetToken(
      indexComponents,
      indexUnits,
      [setup.issuanceModule.address, setup.streamingFeeModule.address, auctionModule.address, positionModule.address],
    );

    const feeSettings = {
      feeRecipient: owner.address,
      maxStreamingFeePercentage: ether(.1),
      streamingFeePercentage: ether(.01),
      lastStreamingFeeTimestamp: ZERO,
    } as StreamingFeeState;

    await setup.streamingFeeModule.initialize(index.address, feeSettings);
    await setup.issuanceModule.initialize(index.address, ADDRESS_ZERO);
    await index.connect(positionModule.wallet).initializeModule();

    indexWithWethComponents = [setup.dai.address, setup.wbtc.address, setup.weth.address];
    indexWithWethUnits = [ether(10000), bitcoin(.5), ether(4)];
    indexWithWeth = await setup.createSetToken(
      indexWithWethComponents,
      indexWithWethUnits,
      [setup.issuanceModule.address, setup.streamingFeeModule.address, auctionModule.address],
    );

    const feeSettingsForIndexWithWeth = {
      feeRecipient: owner.address,
      maxStreamingFeePercentage: ether(.1),
      streamingFeePercentage: ether(.01),
      lastStreamingFeeTimestamp: ZERO,
    } as StreamingFeeState;

    await setup.streamingFeeModule.initialize(indexWithWeth.address, feeSettingsForIndexWithWeth);
    await setup.issuanceModule.initialize(indexWithWeth.address, ADDRESS_ZERO);
  });

  describe("#constructor", async () => {
    it("should set all the parameters correctly", async () => {
      const weth = await auctionModule.weth();
      const controller = await auctionModule.controller();

      expect(weth).to.eq(setup.weth.address);
      expect(controller).to.eq(setup.controller.address);
    });
  });

  describe("#initialize", async () => {
    let subjectSetToken: SetToken;
    let subjectCaller: Account;

    beforeEach(async () => {
      subjectSetToken = index;
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      auctionModule = auctionModule.connect(subjectCaller.wallet);
      return auctionModule.initialize(subjectSetToken.address);
    }

    it("should enable the Module on the SetToken", async () => {
      await subject();
      const isModuleEnabled = await subjectSetToken.isInitializedModule(auctionModule.address);
      expect(isModuleEnabled).to.eq(true);
    });

    it("should set the positionMultiplier on the AuctionRebalanceModuleV1", async () => {
      await subject();

      const rebalanceInfo = await auctionModule.rebalanceInfo(subjectSetToken.address);
      expect(rebalanceInfo.positionMultiplier).to.eq(ether(1));
    });

    describe("when the caller is not the SetToken manager", async () => {
      beforeEach(async () => {
        subjectCaller = await getRandomAccount();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be the SetToken manager");
      });
    });

    describe("when the module is not pending", async () => {
      beforeEach(async () => {
        await subject();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be pending initialization");
      });
    });

    describe("when the SetToken is not enabled on the controller", async () => {
      beforeEach(async () => {
        const nonEnabledSetToken = await setup.createNonControllerEnabledSetToken(
          [setup.dai.address],
          [ether(1)],
          [auctionModule.address],
          owner.address
        );

        subjectSetToken = nonEnabledSetToken;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be controller-enabled SetToken");
      });
    });

    describe("when set has weth as component", async () => {
      beforeEach(async () => {
        subjectSetToken = indexWithWeth;
      });

      it("should enable the Module on the SetToken", async () => {
        await subject();
        const isModuleEnabled = await subjectSetToken.isInitializedModule(auctionModule.address);
        expect(isModuleEnabled).to.eq(true);
      });
    });

    describe("when there are external positions for a component", async () => {
      beforeEach(async () => {
        await subjectSetToken.connect(positionModule.wallet).addExternalPositionModule(
          indexComponents[0],
          positionModule.address
        );
      });

      afterEach(async () => {
        await subjectSetToken.connect(positionModule.wallet).removeExternalPositionModule(
          indexComponents[0],
          positionModule.address
        );
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("External positions not allowed");
      });
    });
  });

  describe("when module is initalized", async () => {
    let subjectSetToken: SetToken;
    let subjectCaller: Account;

    let duration: BigNumber;
    let newComponents: Address[];
    let newComponentsAuctionParams: AuctionExecutionParams[];
    let oldComponentsAuctionParams: AuctionExecutionParams[];
    let issueAmount: BigNumber;

    async function initSetToken(
      setToken: SetToken
    ) {
      await auctionModule.initialize(setToken.address);
      await auctionModule.setBidderStatus(setToken.address, [bidder.address], [true]);
    }

    cacheBeforeEach(async () => {
      // initialize auctionModule on both SetTokens
      await initSetToken(
        index,
      );

      await initSetToken(
        indexWithWeth,
      );
    });

    describe("#startRebalance", async () => {
      let subjectNewComponents: Address[];
      let subjectNewComponentsAuctionParams: AuctionExecutionParams[];
      let subjectOldComponentsAuctionParams: AuctionExecutionParams[];
      let subjectDuration: BigNumber;

      beforeEach(async () => {
        const daiPerWeth = await constantPriceAdapter.getEncodedData(ether(0.0005));
        const indexDaiAuctionExecutionParams = {
          targetUnit: ether(8000),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: daiPerWeth
        } as AuctionExecutionParams;

        const wbtcPerWethDecimalFactor = ether(1).div(bitcoin(1));
        const wbtcPerWethPrice = ether(14.5).mul(wbtcPerWethDecimalFactor);
        const wbtcPerWethBytes = await constantPriceAdapter.getEncodedData(wbtcPerWethPrice);
        const indexWbtcAuctionExecutionParams = {
          targetUnit: bitcoin(.54),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: wbtcPerWethBytes
        } as AuctionExecutionParams;

        const usdcPerWethDecimalFactor = ether(1).div(usdc(1));
        const usdcPerWethPrice = ether(0.0005).mul(usdcPerWethDecimalFactor);
        const usdcPerWeth = await constantPriceAdapter.getEncodedData(usdcPerWethPrice);
        const indexUsdcAuctionExecutionParams = {
          targetUnit: usdc(840),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: usdcPerWeth
        } as AuctionExecutionParams;

        subjectSetToken = index;
        subjectCaller = owner;

        subjectDuration = ONE_DAY_IN_SECONDS.mul(5);

        subjectNewComponents = [setup.usdc.address];
        subjectNewComponentsAuctionParams = [indexUsdcAuctionExecutionParams];
        subjectOldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams];
      });

      async function subject(): Promise<ContractTransaction> {
        return await auctionModule.connect(subjectCaller.wallet).startRebalance(
          subjectSetToken.address,
          subjectNewComponents,
          subjectNewComponentsAuctionParams,
          subjectOldComponentsAuctionParams,
          subjectDuration,
          await subjectSetToken.positionMultiplier()
        );
      }

      it("should set the auction execution params correctly", async () => {
        await subject();

        const currentComponents = await subjectSetToken.getComponents();
        const aggregateComponents = [...currentComponents, ...subjectNewComponents];
        const aggregateAuctionParams = [...subjectOldComponentsAuctionParams, ...subjectNewComponentsAuctionParams];

        for (let i = 0; i < aggregateAuctionParams.length; i++) {
          const targetUnit = (await auctionModule.executionInfo(subjectSetToken.address, aggregateComponents[i])).targetUnit;
          const exepectedTargetUnit = aggregateAuctionParams[i].targetUnit;
          expect(targetUnit).to.be.eq(exepectedTargetUnit);

          const priceAdapterName = (await auctionModule.executionInfo(subjectSetToken.address, aggregateComponents[i])).priceAdapterName;
          const exepectedPriceAdapterName = aggregateAuctionParams[i].priceAdapterName;
          expect(priceAdapterName).to.be.eq(exepectedPriceAdapterName);

          const priceAdapterData = (await auctionModule.executionInfo(subjectSetToken.address, aggregateComponents[i])).priceAdapterData;
          const exepectedPriceAdapterData = aggregateAuctionParams[i].priceAdapterData;
          expect(priceAdapterData).to.be.eq(exepectedPriceAdapterData);
        }
      });

      it("should set the rebalance info correctly", async () => {
        const txnTimestamp = await getTransactionTimestamp(subject());

        const currentComponents = await subjectSetToken.getComponents();
        const aggregateComponents = [...currentComponents, ...subjectNewComponents];

        const rebalanceComponents = await auctionModule.getRebalanceComponents(subjectSetToken.address);
        const expectedRebalanceComponents = aggregateComponents;
        for (let i = 0; i < rebalanceComponents.length; i++) {
          expect(rebalanceComponents[i]).to.be.eq(expectedRebalanceComponents[i]);
        }

        const positionMultiplier = (await auctionModule.rebalanceInfo(subjectSetToken.address)).positionMultiplier;
        const expectedPositionMultiplier = await subjectSetToken.positionMultiplier();
        expect(positionMultiplier).to.be.eq(expectedPositionMultiplier);

        const startTime = (await auctionModule.rebalanceInfo(subjectSetToken.address)).startTime;
        expect(startTime).to.be.eq(txnTimestamp);

        const duration = (await auctionModule.rebalanceInfo(subjectSetToken.address)).duration;
        const expectedDuration = subjectDuration;
        expect(duration).to.be.eq(expectedDuration);
      });

      it("emits the correct RebalanceStarted event", async () => {
        const currentComponents = await subjectSetToken.getComponents();
        const expectedAggregateComponents = [...currentComponents, ...subjectNewComponents];
        const expectedDuration = subjectDuration;
        const expectedPositionMultiplier = await subjectSetToken.positionMultiplier();

        await expect(subject()).to.emit(auctionModule, "RebalanceStarted").withArgs(
          subjectSetToken.address,
          expectedDuration,
          expectedPositionMultiplier,
          expectedAggregateComponents
        );
      });

      describe("newComponents and newComponentsTargetUnits are not of same length", async () => {
        beforeEach(async () => {
          subjectNewComponentsAuctionParams = [];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Array length mismatch");
        });
      });

      describe("when missing Auction Execution Params for old comoponents", async () => {
        beforeEach(async () => {
          const usdcPerWeth = await constantPriceAdapter.getEncodedData(ether(0.0005));
          const indexUsdcAuctionExecutionParams = {
            targetUnit: ether(840),
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: usdcPerWeth
          } as AuctionExecutionParams;

          subjectOldComponentsAuctionParams = [indexUsdcAuctionExecutionParams];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Old Components targets missing");
        });
      });

      describe("when newComponents contains an old component", async () => {
        beforeEach(async () => {
          const daiPerWeth = await constantPriceAdapter.getEncodedData(ether(0.0005));
          const indexDaiAuctionExecutionParams = {
            targetUnit: ether(8000),
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: daiPerWeth
          } as AuctionExecutionParams;

          subjectNewComponents = [setup.dai.address];
          subjectNewComponentsAuctionParams = [indexDaiAuctionExecutionParams];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Cannot duplicate components");
        });
      });

      describe("when there are external positions for a component", async () => {
        beforeEach(async () => {
          await subjectSetToken.connect(positionModule.wallet).addExternalPositionModule(
            subjectNewComponents[0],
            positionModule.address
          );
        });

        afterEach(async () => {
          await subjectSetToken.connect(positionModule.wallet).removeExternalPositionModule(
            subjectNewComponents[0],
            positionModule.address
          );
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("External positions not allowed");
        });
      });
    });

    describe("#getRebalanceComponents", async () => {
      let subjectNewComponents: Address[];
      let subjectNewComponentsAuctionParams: AuctionExecutionParams[];
      let subjectOldComponentsAuctionParams: AuctionExecutionParams[];
      let subjectDuration: BigNumber;

      beforeEach(async () => {
        const daiPerWeth = await constantPriceAdapter.getEncodedData(ether(0.0004));
        const indexDaiAuctionExecutionParams = {
          targetUnit: ether(8000),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: daiPerWeth
        } as AuctionExecutionParams;

        const wbtcPerWeth = await constantPriceAdapter.getEncodedData(ether(0.069));
        const indexWbtcAuctionExecutionParams = {
          targetUnit: ether(.55),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: wbtcPerWeth
        } as AuctionExecutionParams;

        const usdcPerWeth = await constantPriceAdapter.getEncodedData(ether(0.0004));
        const indexUsdcAuctionExecutionParams = {
          targetUnit: ether(100),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: usdcPerWeth
        } as AuctionExecutionParams;

        subjectSetToken = index;
        subjectCaller = owner;

        subjectDuration = ONE_DAY_IN_SECONDS.mul(5);

        subjectNewComponents = [setup.usdc.address];
        subjectNewComponentsAuctionParams = [indexUsdcAuctionExecutionParams];
        subjectOldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams];
      });

      const startRebalance = async () => {
        await auctionModule.connect(subjectCaller.wallet).startRebalance(
          subjectSetToken.address,
          subjectNewComponents,
          subjectNewComponentsAuctionParams,
          subjectOldComponentsAuctionParams,
          subjectDuration,
          await subjectSetToken.positionMultiplier()
        );
      };

      const initializeSubjectVariables = () => {
        subjectSetToken = index;
      };

      beforeEach(async () => {
        initializeSubjectVariables();
        await startRebalance();
      });

      async function subject(tokenAddress: Address): Promise<any> {
        return await auctionModule.getRebalanceComponents(tokenAddress);
      }

      it("the components being rebalanced should be returned", async () => {
        const expectedComponents = [setup.dai.address, setup.wbtc.address, setup.usdc.address];

        const rebalanceComponents = await subject(subjectSetToken.address);

        expect(rebalanceComponents).to.deep.eq(expectedComponents);
      });

      describe("when set token is not valid", async () => {
        it("should revert", async () => {
          await expect(subject(ADDRESS_ZERO)).to.be.revertedWith("Must be a valid and initialized SetToken");
        });
      });
    });

    describe("#getAuctionSizeAndDirection", async () => {
      let subjectComponent: Address;

      let feePercentage: BigNumber;

      before(async () => {
        const daiPerWethPrice = ether(0.0005);
        const daiPerWethBytes = await constantPriceAdapter.getEncodedData(daiPerWethPrice);
        const indexDaiAuctionExecutionParams = {
          targetUnit: ether(8000),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: daiPerWethBytes
        } as AuctionExecutionParams;

        const wbtcPerWethDecimalFactor = ether(1).div(bitcoin(1));
        const wbtcPerWethPrice = ether(14.5).mul(wbtcPerWethDecimalFactor);
        const wbtcPerWethBytes = await constantPriceAdapter.getEncodedData(wbtcPerWethPrice);
        const indexWbtcAuctionExecutionParams = {
          targetUnit: bitcoin(.54),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: wbtcPerWethBytes
        } as AuctionExecutionParams;

        const usdcPerWethDecimalFactor = ether(1).div(usdc(1));
        const usdcPerWethPrice = ether(0.0005).mul(usdcPerWethDecimalFactor);
        const usdcPerWeth = await constantPriceAdapter.getEncodedData(usdcPerWethPrice);
        const indexUsdcAuctionExecutionParams = {
          targetUnit: usdc(840),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: usdcPerWeth
        } as AuctionExecutionParams;

        subjectSetToken = index;
        subjectCaller = owner;

        duration = ONE_DAY_IN_SECONDS.mul(5);

        newComponents = [setup.usdc.address];
        newComponentsAuctionParams = [indexUsdcAuctionExecutionParams];
        oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams];
        issueAmount = ether(1);
      });

      const startRebalance = async () => {
        await setup.approveAndIssueSetToken(subjectSetToken, issueAmount);
        await auctionModule.startRebalance(
          subjectSetToken.address,
          newComponents,
          newComponentsAuctionParams,
          oldComponentsAuctionParams,
          duration,
          await index.positionMultiplier()
        );
      };

      const initializeSubjectVariables = () => {
        subjectSetToken = index;
        subjectComponent = setup.dai.address;
      };

      beforeEach(async () => {
        initializeSubjectVariables();

        await startRebalance();

        feePercentage = ether(0.005);
        setup.controller = setup.controller.connect(owner.wallet);
        await setup.controller.addFee(
          auctionModule.address,
          ZERO, // Fee type on bid function denoted as 0
          feePercentage // Set fee to 5 bps
        );
      });

      async function subject(): Promise<any> {
        return await auctionModule.getAuctionSizeAndDirection(
          subjectSetToken.address,
          subjectComponent
        );
      }

      it("the position units should be set as expected, price using ConstantPriceAdapter", async () => {
        const totalSupply = await subjectSetToken.totalSupply();
        const expectedDaiSize = preciseMul(ether(2000), totalSupply);

        const [
          isSendTokenFixed,
          componentQuantity,
        ] = await subject();

        expect(componentQuantity).to.eq(expectedDaiSize);
        expect(isSendTokenFixed).to.be.true;
      });

      describe("when the component is being added to the Set", async () => {
        beforeEach(async () => {
          subjectComponent = setup.usdc.address;
        });

        it("the correct bid direction and size should be returned", async () => {
          const totalSupply = await subjectSetToken.totalSupply();
          const expectedUsdcSize = preciseDiv(
            preciseMulCeil(usdc(840), totalSupply),
            PRECISE_UNIT.sub(feePercentage)
          );

          const [
            isSendTokenFixed,
            componentQuantity,
          ] = await subject();

          expect(componentQuantity).to.eq(expectedUsdcSize);
          expect(isSendTokenFixed).to.be.false;
        });
      });

      describe("when the setToken is not valid", async () => {
        beforeEach(() => {
          subjectSetToken = { address: ADDRESS_ZERO } as SetToken;
        });

        it("should revert", async () => {
          expect(subject()).to.be.revertedWith("Must be a valid and initialized SetToken");
        });
      });

      describe("when the component is not part of the rebalance", async () => {
        beforeEach(() => {
          subjectComponent = setup.weth.address;
        });

        it("should revert", async () => {
          expect(subject()).to.be.revertedWith("Component not recognized");
        });
      });
    });

    describe("#getBidPreview", async () => {
      let subjectComponent: Address;
      let subjectComponentQuantity: BigNumber;
      let subjectEthQuantityLimit: BigNumber;

      let daiPerWethPrice: BigNumber;
      let wbtcPerWethPrice: BigNumber;
      let usdcPerWethPrice: BigNumber;

      before(async () => {
        daiPerWethPrice = ether(0.0005);
        const daiPerWethBytes = await constantPriceAdapter.getEncodedData(daiPerWethPrice);
        const indexDaiAuctionExecutionParams = {
          targetUnit: ether(8000),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: daiPerWethBytes
        } as AuctionExecutionParams;

        const wbtcPerWethDecimalFactor = ether(1).div(bitcoin(1));
        wbtcPerWethPrice = ether(14.5).mul(wbtcPerWethDecimalFactor);
        const wbtcPerWethBytes = await constantPriceAdapter.getEncodedData(wbtcPerWethPrice);
        const indexWbtcAuctionExecutionParams = {
          targetUnit: bitcoin(.54),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: wbtcPerWethBytes
        } as AuctionExecutionParams;

        const usdcPerWethDecimalFactor = ether(1).div(usdc(1));
        usdcPerWethPrice = ether(0.0005).mul(usdcPerWethDecimalFactor);
        const usdcPerWeth = await constantPriceAdapter.getEncodedData(usdcPerWethPrice);
        const indexUsdcAuctionExecutionParams = {
          targetUnit: usdc(840),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: usdcPerWeth
        } as AuctionExecutionParams;

        subjectSetToken = index;
        subjectCaller = owner;

        duration = ONE_DAY_IN_SECONDS.mul(5);

        newComponents = [setup.usdc.address];
        newComponentsAuctionParams = [indexUsdcAuctionExecutionParams];
        oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams];
        issueAmount = ether(1);
      });

      const startRebalance = async () => {
        await setup.approveAndIssueSetToken(subjectSetToken, issueAmount);
        await auctionModule.startRebalance(
          subjectSetToken.address,
          newComponents,
          newComponentsAuctionParams,
          oldComponentsAuctionParams,
          duration,
          await index.positionMultiplier()
        );
      };

      const initializeSubjectVariables = () => {
        subjectSetToken = index;
        subjectCaller = bidder;
        subjectComponent = setup.dai.address;
        subjectComponentQuantity = ether(2000);
        subjectEthQuantityLimit = ether(1);
      };

      beforeEach(async () => {
        initializeSubjectVariables();

        await startRebalance();
      });

      async function subject(): Promise<any> {
        return await auctionModule.getBidPreview(
          subjectSetToken.address,
          subjectComponent,
          subjectComponentQuantity,
          subjectEthQuantityLimit
        );
      }

      it("the position units should be returned as expected, price using ConstantPriceAdapter", async () => {
        const [,,,,,isSendToken,,sendToken,receiveToken,price,sendQuantity,receiveQuantity,,,] = await subject();

        expect(isSendToken).to.eq(true);
        expect(sendToken).to.eq(setup.dai.address);
        expect(receiveToken).to.eq(setup.weth.address);
        expect(price).to.eq(daiPerWethPrice);
        expect(sendQuantity).to.eq(subjectComponentQuantity);
        expect(receiveQuantity).to.eq(subjectEthQuantityLimit);
      });

      describe("when the component is being bought, price using ConstantPriceAdapter", async () => {
        beforeEach(async () => {
          await subject();  // execute bid that sells dai for weth

          subjectComponent = setup.wbtc.address;
          subjectComponentQuantity = bitcoin(0.04);
          subjectEthQuantityLimit = ether(0.58);
        });

        it("the position units should be returned as expected, price using ConstantPriceAdapter", async () => {
          const [,,,,,isSendToken,,sendToken,receiveToken,price,sendQuantity,receiveQuantity,,,] = await subject();

          expect(isSendToken).to.eq(false);
          expect(sendToken).to.eq(setup.weth.address);
          expect(receiveToken).to.eq(setup.wbtc.address);
          expect(price).to.eq(wbtcPerWethPrice);
          expect(sendQuantity).to.eq(subjectEthQuantityLimit);
          expect(receiveQuantity).to.eq(subjectComponentQuantity);
        });
      });

      describe("when there is a protcol fee charged", async () => {
        let feePercentage: BigNumber;

        beforeEach(async () => {
          feePercentage = ether(0.005);
          setup.controller = setup.controller.connect(owner.wallet);
          await setup.controller.addFee(
            auctionModule.address,
            ZERO, // Fee type on bid function denoted as 0
            feePercentage // Set fee to 5 bps
          );
        });

        it("the position units should be returned as expected, price using ConstantPriceAdapter", async () => {
          const [,,,,,isSendToken,,sendToken,receiveToken,price,sendQuantity,receiveQuantity,,,] = await subject();

          expect(isSendToken).to.eq(true);
          expect(sendToken).to.eq(setup.dai.address);
          expect(receiveToken).to.eq(setup.weth.address);
          expect(price).to.eq(daiPerWethPrice);
          expect(sendQuantity).to.eq(subjectComponentQuantity);
          expect(receiveQuantity).to.eq(subjectEthQuantityLimit);
        });

        describe("when the component is being bought, price using ConstantPriceAdapter", async () => {
          beforeEach(async () => {
            await setup.weth.connect(owner.wallet).transfer(bidder.address, ether(1));
            await setup.weth.connect(bidder.wallet).approve(auctionModule.address, ether(1));
            await auctionModule.connect(bidder.wallet).bid(
              subjectSetToken.address,
              setup.dai.address,
              ether(2000),
              ether(1)
            );  // execute bid that sells dai for weth

            subjectComponent = setup.wbtc.address;
            subjectComponentQuantity = bitcoin(0.04);
            subjectEthQuantityLimit = ether(0.58);
          });

          it("the position units should be returned as expected, price using ConstantPriceAdapter", async () => {
            const [,,,,,isSendToken,,sendToken,receiveToken,price,sendQuantity,receiveQuantity,,,] = await subject();

            expect(isSendToken).to.eq(false);
            expect(sendToken).to.eq(setup.weth.address);
            expect(receiveToken).to.eq(setup.wbtc.address);
            expect(price).to.eq(wbtcPerWethPrice);
            expect(sendQuantity).to.eq(subjectEthQuantityLimit);
            expect(receiveQuantity).to.eq(subjectComponentQuantity);
          });
        });

      });
    });

    describe("#getIsAllowedBidder", async () => {
      let subjectBidders: Address[];
      let subjectStatuses: boolean[];

      beforeEach(async () => {
        subjectCaller = owner;
        subjectSetToken = index;
        subjectBidders = [bidder.address];
        subjectStatuses = [true];

        return await auctionModule.connect(subjectCaller.wallet).setBidderStatus(
          subjectSetToken.address,
          subjectBidders,
          subjectStatuses
        );
      });

      async function subject(): Promise<Boolean> {
        return await auctionModule.connect(subjectCaller.wallet).getIsAllowedBidder(
          subjectSetToken.address,
          subjectBidders[0],
        );
      }

      it("returns bidder status", async () => {
        await subject();

        const isBidder = await subject();
        expect(isBidder).to.be.true;
      });

      describe("when the setToken is not valid", async () => {
        beforeEach(() => {
          subjectSetToken = { address: ADDRESS_ZERO } as SetToken;
        });

        it("should revert", async () => {
          expect(subject()).to.be.revertedWith("Must be a valid and initialized SetToken");
        });
      });
    });

    describe("#getAllowedBidders", async () => {
      let subjectBidders: Address[];
      let subjectStatuses: boolean[];

      beforeEach(async () => {
        subjectCaller = owner;
        subjectSetToken = index;
        subjectBidders = [bidder.address];
        subjectStatuses = [true];

        return await auctionModule.connect(subjectCaller.wallet).setBidderStatus(
          subjectSetToken.address,
          subjectBidders,
          subjectStatuses
        );
      });

      async function subject(): Promise<Address[]> {
        return await auctionModule.connect(subjectCaller.wallet).getAllowedBidders(subjectSetToken.address);
      }

      it("returns bidder status", async () => {
        await subject();

        const expectedBidders = await subject();
        expect(expectedBidders).to.deep.equal(subjectBidders);
      });

      describe("when the setToken is not valid", async () => {
        beforeEach(() => {
          subjectSetToken = { address: ADDRESS_ZERO } as SetToken;
        });

        it("should revert", async () => {
          expect(subject()).to.be.revertedWith("Must be a valid and initialized SetToken");
        });
      });
    });

    describe("#setBidderStatus", async () => {
      let subjectBidders: Address[];
      let subjectStatuses: boolean[];

      beforeEach(async () => {
        subjectCaller = owner;
        subjectSetToken = index;
        subjectBidders = [bidder.address, await getRandomAddress(), await getRandomAddress()];
        subjectStatuses = [true, true, true];
      });

      async function subject(): Promise<ContractTransaction> {
        return await auctionModule.connect(subjectCaller.wallet).setBidderStatus(
          subjectSetToken.address,
          subjectBidders,
          subjectStatuses
        );
      }

      it("the bidder status should be flipped to true", async () => {
        await subject();

        const isBidderOne = await auctionModule.getIsAllowedBidder(subjectSetToken.address, subjectBidders[0]);
        const isBidderTwo = await auctionModule.getIsAllowedBidder(subjectSetToken.address, subjectBidders[1]);
        const isBidderThree = await auctionModule.getIsAllowedBidder(subjectSetToken.address, subjectBidders[2]);

        expect(isBidderOne).to.be.true;
        expect(isBidderTwo).to.be.true;
        expect(isBidderThree).to.be.true;
      });

      it("should emit BidderStatusUpdated event", async () => {
        await expect(subject()).to.emit(auctionModule, "BidderStatusUpdated").withArgs(
          subjectSetToken.address,
          subjectBidders[0],
          true
        );
      });

      describe("when de-authorizing a bidder", async () => {
        beforeEach(async () => {
          await subject();
          subjectStatuses = [false, true, true];
        });

        it("the bidder status should be flipped to false", async () => {
          const preConditionBidder = await auctionModule.getIsAllowedBidder(subjectSetToken.address, subjectBidders[0]);
          expect(preConditionBidder).to.be.true;

          await subject();

          const postConditionBidder = await auctionModule.getIsAllowedBidder(subjectSetToken.address, subjectBidders[0]);
          expect(postConditionBidder).to.be.false;
        });

        it("the biddersHistory should be updated correctly", async () => {
          const preConditionBidders = await auctionModule.getAllowedBidders(subjectSetToken.address);
          expect(preConditionBidders).to.deep.equal(subjectBidders);

          await subject();

          const postConditionBidders = await auctionModule.getAllowedBidders(subjectSetToken.address);
          const expectedBidders = subjectBidders.slice(1);

          expect(expectedBidders[0]).to.not.equal(expectedBidders[1]);
          expect(postConditionBidders[0]).to.not.equal(postConditionBidders[1]);

          expect(postConditionBidders.includes(expectedBidders[0])).to.be.true;
          expect(postConditionBidders.includes(expectedBidders[1])).to.be.true;
        });
      });

      describe("when array lengths don't match", async () => {
        beforeEach(async () => {
          subjectBidders = [bidder.address, await getRandomAddress()];
          subjectStatuses = [false];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Array length mismatch");
        });
      });

      describe("when bidders are duplicated", async () => {
        beforeEach(async () => {
          subjectBidders = [bidder.address, bidder.address, await getRandomAddress()];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Cannot duplicate addresses");
        });
      });

      describe("when arrays are empty", async () => {
        beforeEach(async () => {
          subjectBidders = [];
          subjectStatuses = [];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Array length must be > 0");
        });
      });

      describe("when the caller is not the manager", async () => {
        beforeEach(async () => {
          subjectCaller = await getRandomAccount();
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be the SetToken manager");
        });
      });

      describe("when the SetToken has not initialized the module", async () => {
        beforeEach(async () => {
          await setup.controller.removeSet(index.address);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized SetToken");
        });
      });
    });

    describe("#setAnyoneBid", async () => {
      let subjectStatus: boolean;

      beforeEach(async () => {
        subjectCaller = owner;
        subjectSetToken = index;
        subjectStatus = true;
      });

      async function subject(): Promise<ContractTransaction> {
        return await auctionModule.connect(subjectCaller.wallet).setAnyoneBid(
          subjectSetToken.address,
          subjectStatus
        );
      }

      it("anyoneBid should be flipped to true", async () => {
        await subject();
        const anyoneBid = await auctionModule.permissionInfo(subjectSetToken.address);
        expect(anyoneBid).to.be.true;
      });

      it("should emit AnyoneBidUpdated event", async () => {
        await expect(subject()).to.emit(auctionModule, "AnyoneBidUpdated").withArgs(
          subjectSetToken.address,
          true
        );
      });

      describe("when the caller is not the manager", async () => {
        beforeEach(async () => {
          subjectCaller = await getRandomAccount();
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be the SetToken manager");
        });
      });

      describe("when the SetToken has not initialized the module", async () => {
        beforeEach(async () => {
          await setup.controller.removeSet(index.address);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized SetToken");
        });
      });
    });

    describe("#removeModule", async () => {
      let subjectStatuses: boolean[];
      let subjectBidders: Address[];

      beforeEach(async () => {
        subjectSetToken = index;
        subjectCaller = owner;
        subjectBidders = [bidder.address, await getRandomAddress()];
        subjectStatuses = [true, false];
      });

      afterEach(restoreModule);

      async function restoreModule() {
        const isModuleEnabled = await subjectSetToken.isInitializedModule(auctionModule.address);

        if (!isModuleEnabled) {
          await subjectSetToken.connect(subjectCaller.wallet).addModule(auctionModule.address);
          await auctionModule.connect(subjectCaller.wallet).initialize(subjectSetToken.address);
        }
      }

      describe("removal", async () => {
        async function subject(): Promise<any> {
          return subjectSetToken.connect(subjectCaller.wallet).removeModule(auctionModule.address);
        }

        it("should remove the module", async () => {
          await subject();
          const isModuleEnabled = await subjectSetToken.isInitializedModule(auctionModule.address);
          expect(isModuleEnabled).to.eq(false);
        });
      });

      describe("when restoring module after removal and using permissionInfo", async () => {
        beforeEach(async () => {
          await auctionModule.connect(subjectCaller.wallet).setBidderStatus(
            subjectSetToken.address,
            subjectBidders,
            subjectStatuses
          );

          await auctionModule.connect(subjectCaller.wallet).setAnyoneBid(
            subjectSetToken.address,
            true
          );
        });

        async function subject(): Promise<any> {
          await subjectSetToken.connect(subjectCaller.wallet).removeModule(auctionModule.address);
          await restoreModule();
        }

        it("should have removed bidders from the permissions whitelist", async () => {
          let isBidderOne = await auctionModule.getIsAllowedBidder(subjectSetToken.address, subjectBidders[0]);
          expect(isBidderOne).to.be.true;

          await subject();

          isBidderOne = await auctionModule.getIsAllowedBidder(subjectSetToken.address, subjectBidders[0]);
          expect(isBidderOne).to.be.false;
        });

        it("should have set anyoneBid to false", async () => {
          // The public getter return sig generated for permissionInfo's abi
          // is  <bool>anyoneBid (and nothing else).
          let anyoneBid = await auctionModule.permissionInfo(subjectSetToken.address);
          expect(anyoneBid).to.be.true;

          await subject();

          anyoneBid = await auctionModule.permissionInfo(subjectSetToken.address);
          expect(anyoneBid).to.be.false;
        });
      });
    });

    describe("#bid", async () => {
      let subjectComponent: Address;
      let subjectIncreaseTime: BigNumber;
      let subjectComponentQuantity: BigNumber;
      let subjectEthQuantityLimit: BigNumber;

      let expectedOut: BigNumber;

      let daiPerWethPrice: BigNumber;
      let wbtcPerWethPrice: BigNumber;
      let usdcPerWethPrice: BigNumber;

      before(async () => {
        daiPerWethPrice = ether(0.0005);
        const daiPerWethBytes = await constantPriceAdapter.getEncodedData(daiPerWethPrice);
        const indexDaiAuctionExecutionParams = {
          targetUnit: ether(8000),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: daiPerWethBytes
        } as AuctionExecutionParams;

        const wbtcPerWethDecimalFactor = ether(1).div(bitcoin(1));
        wbtcPerWethPrice = ether(14.5).mul(wbtcPerWethDecimalFactor);
        const wbtcPerWethBytes = await constantPriceAdapter.getEncodedData(wbtcPerWethPrice);
        const indexWbtcAuctionExecutionParams = {
          targetUnit: bitcoin(.54),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: wbtcPerWethBytes
        } as AuctionExecutionParams;

        const usdcPerWethDecimalFactor = ether(1).div(usdc(1));
        usdcPerWethPrice = ether(0.0005).mul(usdcPerWethDecimalFactor);
        const usdcPerWeth = await constantPriceAdapter.getEncodedData(usdcPerWethPrice);
        const indexUsdcAuctionExecutionParams = {
          targetUnit: usdc(840),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: usdcPerWeth
        } as AuctionExecutionParams;

        subjectSetToken = index;
        subjectCaller = owner;

        duration = ONE_DAY_IN_SECONDS.mul(5);

        newComponents = [setup.usdc.address];
        newComponentsAuctionParams = [indexUsdcAuctionExecutionParams];
        oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams];
        issueAmount = ether(1);
      });

      const startRebalance = async () => {
        await setup.approveAndIssueSetToken(subjectSetToken, issueAmount);
        await auctionModule.startRebalance(
          subjectSetToken.address,
          newComponents,
          newComponentsAuctionParams,
          oldComponentsAuctionParams,
          duration,
          await index.positionMultiplier()
        );

        await setup.weth.connect(owner.wallet).transfer(bidder.address, ether(1));
        await setup.weth.connect(bidder.wallet).approve(auctionModule.address, ether(1));
      };

      const initializeSubjectVariables = () => {
        subjectSetToken = index;
        subjectCaller = bidder;
        subjectComponent = setup.dai.address;
        subjectIncreaseTime = ONE_HOUR_IN_SECONDS.mul(5);
        subjectComponentQuantity = ether(2000);
        subjectEthQuantityLimit = ether(1);
      };

      async function subject(): Promise<ContractTransaction> {
        await increaseTimeAsync(subjectIncreaseTime);
        return await auctionModule.connect(subjectCaller.wallet).bid(
          subjectSetToken.address,
          subjectComponent,
          subjectComponentQuantity,
          subjectEthQuantityLimit
        );
      }

      describe("with default target units", async () => {
        beforeEach(async () => {
          initializeSubjectVariables();

          expectedOut = ether(1);
          subjectEthQuantityLimit = expectedOut;
        });
        cacheBeforeEach(startRebalance);

        it("the position units should be set as expected, price using ConstantPriceAdapter", async () => {
          const currentDaiAmount = await setup.dai.balanceOf(subjectSetToken.address);
          const currentWethAmount = await setup.weth.balanceOf(subjectSetToken.address);
          const totalSupply = await subjectSetToken.totalSupply();

          await subject();

          const expectedWethPositionUnits = preciseDiv(currentWethAmount.add(expectedOut), totalSupply);
          const expectedDaiPositionUnits = preciseDiv(currentDaiAmount.sub(subjectComponentQuantity), totalSupply);

          const wethPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
          const daiPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.dai.address);

          expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
          expect(daiPositionUnits).to.eq(expectedDaiPositionUnits);
        });

        it("emits the correct BidExecuted event", async () => {
          const totalSupply = await subjectSetToken.totalSupply();

          await expect(subject()).to.emit(auctionModule, "BidExecuted").withArgs(
            subjectSetToken.address,
            subjectComponent,
            subjectCaller.address,
            constantPriceAdapter.address,
            true,
            daiPerWethPrice,
            subjectComponentQuantity,
            expectedOut,
            0,
            totalSupply
          );
        });

        describe("when there is a protcol fee charged", async () => {
          let feePercentage: BigNumber;

          beforeEach(async () => {
            feePercentage = ether(0.005);
            setup.controller = setup.controller.connect(owner.wallet);
            await setup.controller.addFee(
              auctionModule.address,
              ZERO, // Fee type on bid function denoted as 0
              feePercentage // Set fee to 5 bps
            );
          });

          it("the position units should be set as expected, price using ConstantPriceAdapter", async () => {
            const currentDaiAmount = await setup.dai.balanceOf(subjectSetToken.address);
            const currentWethAmount = await setup.weth.balanceOf(subjectSetToken.address);
            const totalSupply = await subjectSetToken.totalSupply();

            await subject();

            const protocolFee = expectedOut.mul(feePercentage).div(ether(1));
            const expectedWethPositionUnits = preciseDiv(currentWethAmount.add(expectedOut).sub(protocolFee), totalSupply);
            const expectedDaiPositionUnits = preciseDiv(currentDaiAmount.sub(subjectComponentQuantity), totalSupply);

            const wethPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
            const daiPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.dai.address);

            expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
            expect(daiPositionUnits).to.eq(expectedDaiPositionUnits);
          });

          it("the fees should be received by the fee recipient", async () => {
            const feeRecipient = await setup.controller.feeRecipient();
            const beforeWethBalance = await setup.weth.balanceOf(feeRecipient);

            await subject();

            const wethBalance = await setup.weth.balanceOf(feeRecipient);

            const protocolFee = expectedOut.mul(feePercentage).div(ether(1));
            const expectedWethBalance = beforeWethBalance.add(protocolFee);

            expect(wethBalance).to.eq(expectedWethBalance);
          });

          it("emits the correct BidExecuted event", async () => {
            const protocolFee = expectedOut.mul(feePercentage).div(ether(1));
            const totalSupply = await subjectSetToken.totalSupply();
            await expect(subject()).to.emit(auctionModule, "BidExecuted").withArgs(
              subjectSetToken.address,
              subjectComponent,
              subjectCaller.address,
              constantPriceAdapter.address,
              true,
              daiPerWethPrice,
              subjectComponentQuantity,
              expectedOut.sub(protocolFee),
              protocolFee,
              totalSupply
            );
          });
        });

        describe("when the component is being bought, price using ConstantPriceAdapter", async () => {
          beforeEach(async () => {
            await subject();  // execute bid that sells dai for weth

            await setup.wbtc.connect(owner.wallet).transfer(bidder.address, bitcoin(0.04));
            await setup.wbtc.connect(bidder.wallet).approve(auctionModule.address, bitcoin(0.04));

            subjectComponent = setup.wbtc.address;
            subjectComponentQuantity = bitcoin(0.04);
            subjectEthQuantityLimit = ether(0.58);
          });

          it("the position units should be set as expected", async () => {
            const expectedIn = subjectComponentQuantity;
            const expectedOut = preciseMul(wbtcPerWethPrice, expectedIn);

            const currentWbtcAmount = await setup.wbtc.balanceOf(subjectSetToken.address);
            const currentWethAmount = await setup.weth.balanceOf(subjectSetToken.address);

            const wethUnit = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
            const wbtcUnit = await subjectSetToken.getDefaultPositionRealUnit(setup.wbtc.address);
            const totalSupply = await subjectSetToken.totalSupply();

            await subject();

            const wbtcExcess = currentWbtcAmount.sub(preciseMul(totalSupply, wbtcUnit));
            const wethExcess = currentWethAmount.sub(preciseMul(totalSupply, wethUnit));

            const expectedWethPositionUnits = preciseDiv(currentWethAmount.sub(expectedOut).sub(wethExcess), totalSupply);
            const expectedWbtcPositionUnits = preciseDiv(currentWbtcAmount.add(expectedIn).sub(wbtcExcess), totalSupply);

            const wethPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
            const wbtcPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.wbtc.address);

            expect(wbtcPositionUnits).to.eq(expectedWbtcPositionUnits);
            expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
          });

          it("emits the correct BidExecuted event", async () => {
            const totalSupply = await subjectSetToken.totalSupply();

            await expect(subject()).to.emit(auctionModule, "BidExecuted").withArgs(
              subjectSetToken.address,
              setup.wbtc.address,
              bidder.address,
              constantPriceAdapter.address,
              false,
              wbtcPerWethPrice,
              preciseMul(wbtcPerWethPrice, subjectComponentQuantity),
              subjectComponentQuantity,
              0,
              totalSupply
            );
          });
        });

        describe("when the bid is priced using the BoundedStepwiseLinearPriceAdapter", async () => {
          describe("when component is being sold and priced using the BoundedStepwiseLinearPriceAdapter", async () => {
            beforeEach(async () => {
              const daiAuctionParams = await boundedStepwiseLinearPriceAdapter.getEncodedData(
                ether(0.00055),
                ether(0.00001),
                ONE_HOUR_IN_SECONDS,
                true,
                ether(0.00055),
                ether(0.00049)
              );
              const indexDaiAuctionExecutionParams = {
                targetUnit: ether(8000),
                priceAdapterName: boundedStepwiseLinearPriceAdapterName,
                priceAdapterData: daiAuctionParams
              } as AuctionExecutionParams;

              const wbtcPerWethDecimalFactor = ether(1).div(bitcoin(1));
              wbtcPerWethPrice = ether(14.5).mul(wbtcPerWethDecimalFactor);
              const wbtcPerWethBytes = await constantPriceAdapter.getEncodedData(wbtcPerWethPrice);
              const indexWbtcAuctionExecutionParams = {
                targetUnit: bitcoin(.54),
                priceAdapterName: constantPriceAdapterName,
                priceAdapterData: wbtcPerWethBytes
              } as AuctionExecutionParams;

              oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams];

              await auctionModule.startRebalance(
                subjectSetToken.address,
                newComponents,
                newComponentsAuctionParams,
                oldComponentsAuctionParams,
                duration,
                await index.positionMultiplier()
              );
            });

            it("the position units should be set as expected", async () => {
              const currentDaiAmount = await setup.dai.balanceOf(subjectSetToken.address);
              const currentWethAmount = await setup.weth.balanceOf(subjectSetToken.address);
              const totalSupply = await subjectSetToken.totalSupply();

              await subject();

              const expectedWethPositionUnits = preciseDiv(currentWethAmount.add(expectedOut), totalSupply);
              const expectedDaiPositionUnits = preciseDiv(currentDaiAmount.sub(subjectComponentQuantity), totalSupply);

              const wethPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
              const daiPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.dai.address);

              expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
              expect(daiPositionUnits).to.eq(expectedDaiPositionUnits);
            });

            it("emits the correct BidExecuted event", async () => {
              const totalSupply = await subjectSetToken.totalSupply();

              await expect(subject()).to.emit(auctionModule, "BidExecuted").withArgs(
                subjectSetToken.address,
                subjectComponent,
                subjectCaller.address,
                boundedStepwiseLinearPriceAdapter.address,
                true,
                ether(0.0005),
                subjectComponentQuantity,
                expectedOut,
                ZERO,
                totalSupply
              );
            });
          });

          describe("when component is being bought and priced using the BoundedStepwiseLinearPriceAdapter", async () => {
            beforeEach(async () => {
              daiPerWethPrice = ether(0.0005);
              const daiPerWethBytes = await constantPriceAdapter.getEncodedData(daiPerWethPrice);
              const indexDaiAuctionExecutionParams = {
                targetUnit: ether(8000),
                priceAdapterName: constantPriceAdapterName,
                priceAdapterData: daiPerWethBytes
              } as AuctionExecutionParams;

              const wbtcPerWethDecimalFactor = ether(1).div(bitcoin(1));
              const wbtcAuctionParams = await boundedStepwiseLinearPriceAdapter.getEncodedData(
                ether(14).mul(wbtcPerWethDecimalFactor),
                ether(0.05).mul(wbtcPerWethDecimalFactor),
                ONE_HOUR_IN_SECONDS,
                false,
                ether(15).mul(wbtcPerWethDecimalFactor),
                ether(14).mul(wbtcPerWethDecimalFactor)
              );
              const indexWbtcAuctionExecutionParams = {
                targetUnit: bitcoin(.54),
                priceAdapterName: boundedStepwiseLinearPriceAdapterName,
                priceAdapterData: wbtcAuctionParams
              } as AuctionExecutionParams;

              oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams];

              await auctionModule.startRebalance(
                subjectSetToken.address,
                newComponents,
                newComponentsAuctionParams,
                oldComponentsAuctionParams,
                duration,
                await index.positionMultiplier()
              );

              await subject();  // execute bid that sells dai for weth

              await setup.wbtc.connect(owner.wallet).transfer(bidder.address, bitcoin(0.04));
              await setup.wbtc.connect(bidder.wallet).approve(auctionModule.address, bitcoin(0.04));

              subjectComponent = setup.wbtc.address;
              subjectComponentQuantity = bitcoin(0.04);
              subjectEthQuantityLimit = ether(0.58);
            });

            it("the position units should be set as expected", async () => {
              const expectedIn = subjectComponentQuantity;
              const expectedOut = preciseMul(wbtcPerWethPrice, expectedIn);

              const currentWbtcAmount = await setup.wbtc.balanceOf(subjectSetToken.address);
              const currentWethAmount = await setup.weth.balanceOf(subjectSetToken.address);

              const wethUnit = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
              const wbtcUnit = await subjectSetToken.getDefaultPositionRealUnit(setup.wbtc.address);
              const totalSupply = await subjectSetToken.totalSupply();

              await subject();

              const wbtcExcess = currentWbtcAmount.sub(preciseMul(totalSupply, wbtcUnit));
              const wethExcess = currentWethAmount.sub(preciseMul(totalSupply, wethUnit));

              const expectedWethPositionUnits = preciseDiv(currentWethAmount.sub(expectedOut).sub(wethExcess), totalSupply);
              const expectedWbtcPositionUnits = preciseDiv(currentWbtcAmount.add(expectedIn).sub(wbtcExcess), totalSupply);

              const wethPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
              const wbtcPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.wbtc.address);

              expect(wbtcPositionUnits).to.eq(expectedWbtcPositionUnits);
              expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
            });

            it("emits the correct BidExecuted event", async () => {
              const totalSupply = await subjectSetToken.totalSupply();

              await expect(subject()).to.emit(auctionModule, "BidExecuted").withArgs(
                subjectSetToken.address,
                setup.wbtc.address,
                bidder.address,
                boundedStepwiseLinearPriceAdapter.address,
                false,
                wbtcPerWethPrice,
                preciseMul(wbtcPerWethPrice, subjectComponentQuantity),
                subjectComponentQuantity,
                0,
                totalSupply
              );
            });
          });
        });

        describe("when the bid is priced using the BoundedStepwiseExponentialPriceAdapter", async () => {
          describe("when component is being sold and priced using the BoundedStepwiseExponentialPriceAdapter", async () => {
            beforeEach(async () => {
              const daiAuctionParams = await boundedStepwiseExponentialPriceAdapter.getEncodedData(
                ether(0.00055),
                ether(0.00005),
                ONE_HOUR_IN_SECONDS.mul(5),
                true,
                ether(0.00055),
                ether(0.00049)
              );
              const indexDaiAuctionExecutionParams = {
                targetUnit: ether(8000),
                priceAdapterName: boundedStepwiseExponentialPriceAdapterName,
                priceAdapterData: daiAuctionParams
              } as AuctionExecutionParams;

              const wbtcPerWethDecimalFactor = ether(1).div(bitcoin(1));
              wbtcPerWethPrice = ether(14.5).mul(wbtcPerWethDecimalFactor);
              const wbtcPerWethBytes = await constantPriceAdapter.getEncodedData(wbtcPerWethPrice);
              const indexWbtcAuctionExecutionParams = {
                targetUnit: bitcoin(.54),
                priceAdapterName: constantPriceAdapterName,
                priceAdapterData: wbtcPerWethBytes
              } as AuctionExecutionParams;

              oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams];

              await auctionModule.startRebalance(
                subjectSetToken.address,
                newComponents,
                newComponentsAuctionParams,
                oldComponentsAuctionParams,
                duration,
                await index.positionMultiplier()
              );
            });

            it("the position units should be set as expected", async () => {
              const currentDaiAmount = await setup.dai.balanceOf(subjectSetToken.address);
              const currentWethAmount = await setup.weth.balanceOf(subjectSetToken.address);
              const totalSupply = await subjectSetToken.totalSupply();

              await subject();

              const expectedWethPositionUnits = preciseDiv(currentWethAmount.add(expectedOut), totalSupply);
              const expectedDaiPositionUnits = preciseDiv(currentDaiAmount.sub(subjectComponentQuantity), totalSupply);

              const wethPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
              const daiPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.dai.address);

              expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
              expect(daiPositionUnits).to.eq(expectedDaiPositionUnits);
            });

            it("emits the correct BidExecuted event", async () => {
              const totalSupply = await subjectSetToken.totalSupply();

              await expect(subject()).to.emit(auctionModule, "BidExecuted").withArgs(
                subjectSetToken.address,
                subjectComponent,
                subjectCaller.address,
                boundedStepwiseExponentialPriceAdapter.address,
                true,
                ether(0.0005),
                subjectComponentQuantity,
                expectedOut,
                ZERO,
                totalSupply
              );
            });
          });

          describe("when component is being bought and priced using the BoundedStepwiseExponentialPriceAdapter", async () => {
            beforeEach(async () => {
              daiPerWethPrice = ether(0.0005);
              const daiPerWethBytes = await constantPriceAdapter.getEncodedData(daiPerWethPrice);
              const indexDaiAuctionExecutionParams = {
                targetUnit: ether(8000),
                priceAdapterName: constantPriceAdapterName,
                priceAdapterData: daiPerWethBytes
              } as AuctionExecutionParams;

              const wbtcPerWethDecimalFactor = ether(1).div(bitcoin(1));
              const wbtcAuctionParams = await boundedStepwiseExponentialPriceAdapter.getEncodedData(
                ether(14).mul(wbtcPerWethDecimalFactor),
                ether(0.5).mul(wbtcPerWethDecimalFactor),
                ONE_HOUR_IN_SECONDS.mul(10),
                false,
                ether(15).mul(wbtcPerWethDecimalFactor),
                ether(14).mul(wbtcPerWethDecimalFactor)
              );
              const indexWbtcAuctionExecutionParams = {
                targetUnit: bitcoin(.54),
                priceAdapterName: boundedStepwiseExponentialPriceAdapterName,
                priceAdapterData: wbtcAuctionParams
              } as AuctionExecutionParams;

              oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams];

              await auctionModule.startRebalance(
                subjectSetToken.address,
                newComponents,
                newComponentsAuctionParams,
                oldComponentsAuctionParams,
                duration,
                await index.positionMultiplier()
              );

              await subject();  // execute bid that sells dai for weth

              await setup.wbtc.connect(owner.wallet).transfer(bidder.address, bitcoin(0.04));
              await setup.wbtc.connect(bidder.wallet).approve(auctionModule.address, bitcoin(0.04));

              subjectComponent = setup.wbtc.address;
              subjectComponentQuantity = bitcoin(0.04);
              subjectEthQuantityLimit = ether(0.58);
            });

            it("the position units should be set as expected", async () => {
              const expectedIn = subjectComponentQuantity;
              const expectedOut = preciseMul(wbtcPerWethPrice, expectedIn);

              const currentWbtcAmount = await setup.wbtc.balanceOf(subjectSetToken.address);
              const currentWethAmount = await setup.weth.balanceOf(subjectSetToken.address);

              const wethUnit = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
              const wbtcUnit = await subjectSetToken.getDefaultPositionRealUnit(setup.wbtc.address);
              const totalSupply = await subjectSetToken.totalSupply();

              await subject();

              const wbtcExcess = currentWbtcAmount.sub(preciseMul(totalSupply, wbtcUnit));
              const wethExcess = currentWethAmount.sub(preciseMul(totalSupply, wethUnit));

              const expectedWethPositionUnits = preciseDiv(currentWethAmount.sub(expectedOut).sub(wethExcess), totalSupply);
              const expectedWbtcPositionUnits = preciseDiv(currentWbtcAmount.add(expectedIn).sub(wbtcExcess), totalSupply);

              const wethPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
              const wbtcPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.wbtc.address);

              expect(wbtcPositionUnits).to.eq(expectedWbtcPositionUnits);
              expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
            });

            it("emits the correct BidExecuted event", async () => {
              const totalSupply = await subjectSetToken.totalSupply();

              await expect(subject()).to.emit(auctionModule, "BidExecuted").withArgs(
                subjectSetToken.address,
                setup.wbtc.address,
                bidder.address,
                boundedStepwiseExponentialPriceAdapter.address,
                false,
                wbtcPerWethPrice,
                preciseMul(wbtcPerWethPrice, subjectComponentQuantity),
                subjectComponentQuantity,
                0,
                totalSupply
              );
            });
          });
        });

        describe("when adding a new asset", async () => {
          beforeEach(async () => {
            await subject();  // execute bid that sells dai for weth

            await setup.usdc.connect(owner.wallet).transfer(bidder.address, usdc(840));
            await setup.usdc.connect(bidder.wallet).approve(auctionModule.address, usdc(840));

            subjectComponent = setup.usdc.address;
            subjectComponentQuantity = usdc(840);
            subjectEthQuantityLimit = ether(0.42);
          });

          it("the position units should be set as expected", async () => {
            const expectedIn = subjectComponentQuantity;
            const expectedOut = preciseMul(usdcPerWethPrice, expectedIn);

            const currentUsdcAmount = await setup.usdc.balanceOf(subjectSetToken.address);
            const currentWethAmount = await setup.weth.balanceOf(subjectSetToken.address);

            const wethUnit = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
            const usdcUnit = await subjectSetToken.getDefaultPositionRealUnit(setup.usdc.address);
            const totalSupply = await subjectSetToken.totalSupply();

            const componentsBefore = await subjectSetToken.getComponents();
            expect(componentsBefore).to.not.contain(setup.usdc.address);

            await subject();

            const usdcExcess = currentUsdcAmount.sub(preciseMul(totalSupply, usdcUnit));
            const wethExcess = currentWethAmount.sub(preciseMul(totalSupply, wethUnit));

            const expectedWethPositionUnits = preciseDiv(currentWethAmount.sub(expectedOut).sub(wethExcess), totalSupply);
            const expectedUsdcPositionUnits = preciseDiv(currentUsdcAmount.add(expectedIn).sub(usdcExcess), totalSupply);

            const wethPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
            const usdcPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.usdc.address);

            const componentsAfter = await subjectSetToken.getComponents();
            expect(componentsAfter).to.contain(setup.usdc.address);

            expect(usdcPositionUnits).to.eq(expectedUsdcPositionUnits);
            expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
          });
        });

        describe("when anyoneBid is true and a random address calls", async () => {
          beforeEach(async () => {
            await auctionModule.setAnyoneBid(subjectSetToken.address, true);
            subjectCaller = await getRandomAccount();

            await setup.weth.connect(owner.wallet).transfer(subjectCaller.address, ether(1));
            await setup.weth.connect(subjectCaller.wallet).approve(auctionModule.address, ether(1));
          });

          it("the bid should not revert", async () => {
            await expect(subject()).to.not.be.reverted;
          });
        });

        describe("when bid takes more than maximum input eth amount, while selling component", async () => {
          beforeEach(async () => {
            subjectEthQuantityLimit = ether(0.9);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("WETH input exceeds maximum");
          });
        });

        describe("when exchange returns less than minimum output eth amount, while buying component", async () => {
          beforeEach(async () => {
            subjectComponent = setup.wbtc.address;
            subjectComponentQuantity = bitcoin(0.04);
            subjectEthQuantityLimit = ether(0.59);
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("WETH output below minimum");
          });
        });

        describe("when anyoneBid is false and a random address calls", async () => {
          beforeEach(async () => {
            subjectCaller = await getRandomAccount();
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Address not permitted to bid");
          });
        });

        describe("when the rebalance duration has elapsed", async () => {
          beforeEach(async () => {
            await subject();
            subjectIncreaseTime = duration;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Rebalance must be in progress");
          });
        });

        describe("when exchange adapter has been removed from integration registry", async () => {
          beforeEach(async () => {
            await setup.integrationRegistry.removeIntegration(auctionModule.address, constantPriceAdapterName);
          });

          afterEach(async () => {
            await setup.integrationRegistry.addIntegration(
              auctionModule.address,
              constantPriceAdapterName,
              constantPriceAdapter.address
            );
          });

          it("the bid reverts", async () => {
            await expect(subject()).to.be.revertedWith("Must be valid adapter");
          });
        });

        describe("when the passed component is not included in the rebalance", async () => {
          beforeEach(async () => {
            subjectComponent = indexWithWeth.address;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Component not part of rebalance");
          });
        });

        describe("when there are external positions for a component", async () => {
          beforeEach(async () => {
            await subjectSetToken.connect(positionModule.wallet).addExternalPositionModule(
              subjectComponent,
              positionModule.address
            );
          });

          afterEach(async () => {
            await subjectSetToken.connect(positionModule.wallet).removeExternalPositionModule(
              subjectComponent,
              positionModule.address
            );
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("External positions not allowed");
          });
        });

        describe("when the component is weth", async () => {
          beforeEach(async () => {
            subjectComponent = setup.weth.address;
          });

          it("should revert", async () => {
            expect(subject()).to.be.revertedWith("Can not explicitly bid WETH");
          });
        });
      });

      describe("with alternative target units", async () => {
        before(async () => {
          const daiPerWethBytes = await constantPriceAdapter.getEncodedData(daiPerWethPrice);
          const indexDaiAuctionExecutionParams = {
            targetUnit: ZERO,
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: daiPerWethBytes
          } as AuctionExecutionParams;

          const wbtcPerWethBytes = await constantPriceAdapter.getEncodedData(wbtcPerWethPrice);
          const indexWbtcAuctionExecutionParams = {
            targetUnit: bitcoin(.54),
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: wbtcPerWethBytes
          } as AuctionExecutionParams;

          oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams];

          await setup.weth.connect(owner.wallet).transfer(bidder.address, ether(4));
          await setup.weth.connect(bidder.wallet).approve(auctionModule.address, ether(4));
        });

        after(async () => {
          const daiPerWethBytes = await constantPriceAdapter.getEncodedData(daiPerWethPrice);
          const indexDaiAuctionExecutionParams = {
            targetUnit: ether(8000),
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: daiPerWethBytes
          } as AuctionExecutionParams;

          const wbtcPerWethBytes = await constantPriceAdapter.getEncodedData(wbtcPerWethPrice);
          const indexWbtcAuctionExecutionParams = {
            targetUnit: bitcoin(.54),
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: wbtcPerWethBytes
          } as AuctionExecutionParams;

          oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams];
        });

        beforeEach(async () => {
          initializeSubjectVariables();

          subjectComponentQuantity = ether(10000);

          expectedOut = ether(5);
          subjectEthQuantityLimit = expectedOut;
        });
        cacheBeforeEach(startRebalance);

        describe("when the sell happens using the ConstantPriceAdapter", async () => {
          beforeEach(async () => {
            await setup.weth.connect(owner.wallet).transfer(bidder.address, expectedOut);
            await setup.weth.connect(bidder.wallet).approve(auctionModule.address, expectedOut);
          });

          it("the position units should be set as expected", async () => {
            const currentDaiAmount = await setup.dai.balanceOf(subjectSetToken.address);
            const currentWethAmount = await setup.weth.balanceOf(subjectSetToken.address);
            const totalSupply = await subjectSetToken.totalSupply();

            await subject();

            const expectedWethPositionUnits = preciseDiv(currentWethAmount.add(expectedOut), totalSupply);
            const expectedDaiPositionUnits = preciseDiv(currentDaiAmount.sub(subjectComponentQuantity), totalSupply);

            const wethPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
            const daiPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.dai.address);

            expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
            expect(daiPositionUnits).to.eq(expectedDaiPositionUnits);
          });

          describe("sell bid zeroes out the asset", async () => {
            it("should remove the asset from the index", async () => {
              await subject();

              const components = await subjectSetToken.getComponents();
              const positionUnit = await subjectSetToken.getDefaultPositionRealUnit(setup.dai.address);

              expect(components).to.not.contain(setup.dai.address);
              expect(positionUnit).to.eq(ZERO);
            });
          });
        });

        describe("when the buy happens using the ConstantPriceAdapter", async () => {
          beforeEach(async () => {
            await setup.weth.connect(owner.wallet).transfer(bidder.address, expectedOut);
            await setup.weth.connect(bidder.wallet).approve(auctionModule.address, expectedOut);

            await subject();  // execute bid that sells dai for weth

            await setup.wbtc.connect(owner.wallet).transfer(bidder.address, bitcoin(0.04));
            await setup.wbtc.connect(bidder.wallet).approve(auctionModule.address, bitcoin(0.04));

            subjectComponent = setup.wbtc.address;
            subjectComponentQuantity = bitcoin(0.04);
            subjectEthQuantityLimit = ether(0.58);
          });

          it("the position units should be set as expected", async () => {
            const expectedIn = subjectComponentQuantity;
            const expectedOut = preciseMul(wbtcPerWethPrice, expectedIn);

            const currentWbtcAmount = await setup.wbtc.balanceOf(subjectSetToken.address);
            const currentWethAmount = await setup.weth.balanceOf(subjectSetToken.address);

            const wethUnit = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
            const wbtcUnit = await subjectSetToken.getDefaultPositionRealUnit(setup.wbtc.address);
            const totalSupply = await subjectSetToken.totalSupply();

            await subject();

            const wbtcExcess = currentWbtcAmount.sub(preciseMul(totalSupply, wbtcUnit));
            const wethExcess = currentWethAmount.sub(preciseMul(totalSupply, wethUnit));

            const expectedWethPositionUnits = preciseDiv(currentWethAmount.sub(expectedOut).sub(wethExcess), totalSupply);
            const expectedWbtcPositionUnits = preciseDiv(currentWbtcAmount.add(expectedIn).sub(wbtcExcess), totalSupply);

            const wethPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
            const wbtcPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.wbtc.address);

            expect(wbtcPositionUnits).to.eq(expectedWbtcPositionUnits);
            expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
          });
        });
      });

      describe("when alternative issue amount", async () => {
        before(async () => {
          issueAmount = ether(0.6942);
        });

        after(async () => {
          issueAmount = ether(1);
        });

        beforeEach(async () => {
          initializeSubjectVariables();

          subjectComponentQuantity = ether(1388.4);

          expectedOut = ether(0.6942);
          subjectEthQuantityLimit = expectedOut;
        });
        cacheBeforeEach(startRebalance);

        describe("when fees are accrued and target is met", async () => {
          beforeEach(async () => {
            await subject();

            await setup.streamingFeeModule.accrueFee(subjectSetToken.address);
          });

          it("the bid reverts", async () => {
            const targetUnit = (await auctionModule.executionInfo(subjectSetToken.address, setup.dai.address)).targetUnit;
            const currentUnit = await subjectSetToken.getDefaultPositionRealUnit(setup.dai.address);

            expect(targetUnit).to.not.eq(currentUnit);
            await expect(subject()).to.be.revertedWith("Target already met");
          });
        });

        describe("when the target has been met", async () => {
          beforeEach(async () => {
            await subject();
          });

          it("the bid reverts", async () => {
            await expect(subject()).to.be.revertedWith("Target already met");
          });
        });
      });

      describe("when set has weth as component", async () => {
        beforeEach(async () => {
          const daiPerWethBytes = await constantPriceAdapter.getEncodedData(daiPerWethPrice);
          const indexDaiAuctionExecutionParams = {
            targetUnit: ether(8000),
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: daiPerWethBytes
          } as AuctionExecutionParams;

          const wbtcPerWethBytes = await constantPriceAdapter.getEncodedData(wbtcPerWethPrice);
          const indexWbtcAuctionExecutionParams = {
            targetUnit: bitcoin(.54),
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: wbtcPerWethBytes
          } as AuctionExecutionParams;

          const indexWethAuctionExecutionParams = {
            targetUnit: ether(4),
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: ZERO_BYTES
          } as AuctionExecutionParams;

          subjectSetToken = indexWithWeth;

          oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams, indexWethAuctionExecutionParams];

          initializeSubjectVariables();
          subjectSetToken = indexWithWeth;

          expectedOut = ether(1);
          subjectEthQuantityLimit = expectedOut;
        });
        cacheBeforeEach(startRebalance);

        it("the position units should be set as expected, price using ConstantPriceAdapter", async () => {
          const currentDaiAmount = await setup.dai.balanceOf(subjectSetToken.address);
          const currentWethAmount = await setup.weth.balanceOf(subjectSetToken.address);
          const totalSupply = await subjectSetToken.totalSupply();

          await subject();

          const expectedWethPositionUnits = preciseDiv(currentWethAmount.add(expectedOut), totalSupply);
          const expectedDaiPositionUnits = preciseDiv(currentDaiAmount.sub(subjectComponentQuantity), totalSupply);

          const wethPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.weth.address);
          const daiPositionUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.dai.address);

          expect(wethPositionUnits).to.eq(expectedWethPositionUnits);
          expect(daiPositionUnits).to.eq(expectedDaiPositionUnits);
        });
      });
    });

    describe("#setRaiseTargetPercentage", async () => {
      let subjectRaiseTargetPercentage: BigNumber;

      beforeEach(async () => {
        subjectSetToken = index;
        subjectCaller = owner;
        subjectRaiseTargetPercentage = ether("0.02");
      });

      async function subject(): Promise<ContractTransaction> {
        return await auctionModule.connect(subjectCaller.wallet).setRaiseTargetPercentage(
          subjectSetToken.address,
          subjectRaiseTargetPercentage
        );
      }

      it("sets raiseTargetPercentage", async () => {
        await subject();
        const newRaiseTargetPercentage = (await auctionModule.rebalanceInfo(subjectSetToken.address)).raiseTargetPercentage;

        expect(newRaiseTargetPercentage).to.eq(subjectRaiseTargetPercentage);
      });

      it("emits correct RaiseTargetPercentageUpdated event", async () => {
        await expect(subject()).to.emit(auctionModule, "RaiseTargetPercentageUpdated").withArgs(
          subjectSetToken.address,
          subjectRaiseTargetPercentage
        );
      });

      describe("when target percentage is 0", async () => {
        beforeEach(async () => {
          subjectRaiseTargetPercentage = ZERO;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Target percentage must be > 0");
        });
      });
    });

    describe("#raiseAssetTargets", async () => {
      let subjectRaiseTargetPercentage: BigNumber;

      before(async () => {
        const daiPerWethPrice = ether(0.0005);
        const daiPerWethBytes = await constantPriceAdapter.getEncodedData(daiPerWethPrice);
        const indexDaiAuctionExecutionParams = {
          targetUnit: ether(8000),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: daiPerWethBytes
        } as AuctionExecutionParams;

        const wbtcPerWethDecimalFactor = ether(1).div(bitcoin(1));
        const wbtcPerWethPrice = ether(14.5).mul(wbtcPerWethDecimalFactor);
        const wbtcPerWethBytes = await constantPriceAdapter.getEncodedData(wbtcPerWethPrice);
        const indexWbtcAuctionExecutionParams = {
          targetUnit: bitcoin(.54),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: wbtcPerWethBytes
        } as AuctionExecutionParams;

        const usdcPerWethDecimalFactor = ether(1).div(usdc(1));
        const usdcPerWethPrice = ether(0.0005).mul(usdcPerWethDecimalFactor);
        const usdcPerWeth = await constantPriceAdapter.getEncodedData(usdcPerWethPrice);
        const indexUsdcAuctionExecutionParams = {
          targetUnit: usdc(500),
          priceAdapterName: constantPriceAdapterName,
          priceAdapterData: usdcPerWeth
        } as AuctionExecutionParams;

        subjectSetToken = index;
        subjectCaller = owner;

        duration = ONE_DAY_IN_SECONDS.mul(5);

        newComponents = [setup.usdc.address];
        newComponentsAuctionParams = [indexUsdcAuctionExecutionParams];
        oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams];
        issueAmount = ether(1);
      });

      const startRebalance = async (bid: boolean = true, accrueFee: boolean = false) => {
        await setup.approveAndIssueSetToken(subjectSetToken, issueAmount);

        if (accrueFee) {
          await increaseTimeAsync(ONE_DAY_IN_SECONDS);
          await setup.streamingFeeModule.accrueFee(subjectSetToken.address);
        }

        await auctionModule.startRebalance(
          subjectSetToken.address,
          newComponents,
          newComponentsAuctionParams,
          oldComponentsAuctionParams,
          duration,
          await index.positionMultiplier()
        );

        if (bid) {
          await setup.weth.connect(owner.wallet).transfer(bidder.address, ether(1));
          await setup.weth.connect(bidder.wallet).approve(auctionModule.address, ether(1));
          await auctionModule.connect(bidder.wallet).bid(subjectSetToken.address, setup.dai.address, ether(2000), ether(1));

          await setup.wbtc.connect(owner.wallet).transfer(bidder.address, bitcoin(0.04));
          await setup.wbtc.connect(bidder.wallet).approve(auctionModule.address, bitcoin(0.04));
          await auctionModule.connect(bidder.wallet).bid(subjectSetToken.address, setup.wbtc.address, bitcoin(0.04), ether(0.58));

          await setup.usdc.connect(owner.wallet).transfer(bidder.address, usdc(500));
          await setup.usdc.connect(bidder.wallet).approve(auctionModule.address, usdc(500));
          await auctionModule.connect(bidder.wallet).bid(subjectSetToken.address, setup.usdc.address, usdc(500), ether(0.25));
        }

        await auctionModule.setRaiseTargetPercentage(subjectSetToken.address, subjectRaiseTargetPercentage);
      };

      async function subject(): Promise<ContractTransaction> {
        return await auctionModule.connect(subjectCaller.wallet).raiseAssetTargets(subjectSetToken.address);
      }

      const initialializeSubjectVariables = () => {
        subjectSetToken = index;
        subjectCaller = bidder;
      };

      describe("with default target units", () => {
        beforeEach(async () => {
          initialializeSubjectVariables();
          subjectRaiseTargetPercentage = ether(.0025);
          await startRebalance();
        });

        it("the position units should be set as expected", async () => {
          const prePositionMultiplier = (await auctionModule.rebalanceInfo(subjectSetToken.address)).positionMultiplier;

          await subject();

          const expectedPositionMultiplier = preciseDiv(
            prePositionMultiplier,
            PRECISE_UNIT.add(ether(.0025))
          );

          const positionMultiplier = (await auctionModule.rebalanceInfo(subjectSetToken.address)).positionMultiplier;

          expect(positionMultiplier).to.eq(expectedPositionMultiplier);
        });

        it("emits correct AssetTargetsRaised event", async () => {
          const prePositionMultiplier = (await auctionModule.rebalanceInfo(subjectSetToken.address)).positionMultiplier;

          const expectedPositionMultiplier = preciseDiv(
            prePositionMultiplier,
            PRECISE_UNIT.add(subjectRaiseTargetPercentage)
          );

          await expect(subject()).to.emit(auctionModule, "AssetTargetsRaised").withArgs(
            subjectSetToken.address,
            expectedPositionMultiplier
          );
        });

        describe("when the calling address is not a permissioned address", async () => {
          beforeEach(async () => {
            subjectCaller = await getRandomAccount();
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Address not permitted to bid");
          });
        });
      });

      describe("when the raiseTargetPercentage is the lowest valid decimal (1e-6)", () => {
        beforeEach(async () => {
          initialializeSubjectVariables();
          subjectRaiseTargetPercentage = ether(.000001);
          await startRebalance();
        });

        afterEach(() => {
          subjectRaiseTargetPercentage = ether(.0025);
        });

        it("the position multiplier should be set as expected", async () => {
          const prePositionMultiplier = (await auctionModule.rebalanceInfo(subjectSetToken.address)).positionMultiplier;

          await subject();

          const expectedPositionMultiplier = preciseDiv(
            prePositionMultiplier,
            PRECISE_UNIT.add(subjectRaiseTargetPercentage)
          );

          const positionMultiplier = (await auctionModule.rebalanceInfo(subjectSetToken.address)).positionMultiplier;

          expect(positionMultiplier).to.eq(expectedPositionMultiplier);
        });
      });

      describe("when the raiseTargetPercentage is MAX_UINT_256", () => {
        beforeEach(async () => {
          initialializeSubjectVariables();
          subjectRaiseTargetPercentage = MAX_UINT_256;
          await startRebalance();
        });

        afterEach(() => {
          subjectRaiseTargetPercentage = ether(.0025);
        });

        it("it should revert", async () => {
          await expect(subject()).to.be.revertedWith("addition overflow");
        });
      });

      describe("when protocol fees are charged", () => {
        beforeEach(async () => {
          const feePercentage = ether(0.005);
          setup.controller = setup.controller.connect(owner.wallet);
          await setup.controller.addFee(
            auctionModule.address,
            ZERO, // Fee type on bid function denoted as 0
            feePercentage // Set fee to 5 bps
          );

          const daiPerWethPrice = ether(0.0005);
          const daiPerWethBytes = await constantPriceAdapter.getEncodedData(daiPerWethPrice);
          const indexDaiAuctionExecutionParams = {
            targetUnit: ether(8000),
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: daiPerWethBytes
          } as AuctionExecutionParams;

          const wbtcPerWethDecimalFactor = ether(1).div(bitcoin(1));
          const wbtcPerWethPrice = ether(14.5).mul(wbtcPerWethDecimalFactor);
          const wbtcPerWethBytes = await constantPriceAdapter.getEncodedData(wbtcPerWethPrice);
          const indexWbtcAuctionExecutionParams = {
            targetUnit: bitcoin(.54),
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: wbtcPerWethBytes
          } as AuctionExecutionParams;

          const usdcPerWethDecimalFactor = ether(1).div(usdc(1));
          const usdcPerWethPrice = ether(0.0005).mul(usdcPerWethDecimalFactor);
          const usdcPerWeth = await constantPriceAdapter.getEncodedData(usdcPerWethPrice);
          const indexUsdcAuctionExecutionParams = {
            targetUnit: usdc(500),
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: usdcPerWeth
          } as AuctionExecutionParams;

          subjectSetToken = index;
          subjectCaller = bidder;

          duration = ONE_DAY_IN_SECONDS.mul(5);

          newComponents = [setup.usdc.address];
          newComponentsAuctionParams = [indexUsdcAuctionExecutionParams];
          oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams];
          issueAmount = ether(1);

          await setup.approveAndIssueSetToken(subjectSetToken, issueAmount);

          await auctionModule.startRebalance(
            subjectSetToken.address,
            newComponents,
            newComponentsAuctionParams,
            oldComponentsAuctionParams,
            duration,
            await index.positionMultiplier()
          );

          await setup.weth.connect(owner.wallet).transfer(bidder.address, ether(1));
          await setup.weth.connect(bidder.wallet).approve(auctionModule.address, ether(1));
          await auctionModule.connect(bidder.wallet).bid(
            subjectSetToken.address,
            setup.dai.address,
            ether(2000),
            ether(1)
          );

          await setup.wbtc.connect(owner.wallet).transfer(bidder.address, bitcoin(0.040201));
          await setup.wbtc.connect(bidder.wallet).approve(auctionModule.address, bitcoin(0.040201));
          await auctionModule.connect(bidder.wallet).bid(
            subjectSetToken.address,
            setup.wbtc.address,
            bitcoin(0.040201),
            ether(0.58 * 1.005025)
          );

          await setup.usdc.connect(owner.wallet).transfer(bidder.address, usdc(502.512562));
          await setup.usdc.connect(bidder.wallet).approve(auctionModule.address, usdc(502.512562));
          await auctionModule.connect(bidder.wallet).bid(
            subjectSetToken.address,
            setup.usdc.address,
            usdc(502.512562),
            ether(0.25 * 1.005025)
          );

          await auctionModule.setRaiseTargetPercentage(subjectSetToken.address, subjectRaiseTargetPercentage);
        });

        it("the position units should be set as expected", async () => {
          const prePositionMultiplier = (await auctionModule.rebalanceInfo(subjectSetToken.address)).positionMultiplier;

          await subject();

          const expectedPositionMultiplier = preciseDiv(
            prePositionMultiplier,
            PRECISE_UNIT.add(ether(.0025))
          );

          const positionMultiplier = (await auctionModule.rebalanceInfo(subjectSetToken.address)).positionMultiplier;

          expect(positionMultiplier).to.eq(expectedPositionMultiplier);
        });
      });

      describe("when a component is being removed", async () => {
        beforeEach(async () => {
          const daiPerWethPrice = ether(0.0005);
          const daiPerWethBytes = await constantPriceAdapter.getEncodedData(daiPerWethPrice);
          const indexDaiAuctionExecutionParams = {
            targetUnit: ZERO,
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: daiPerWethBytes
          } as AuctionExecutionParams;

          const wbtcPerWethDecimalFactor = ether(1).div(bitcoin(1));
          const wbtcPerWethPrice = ether(14.5).mul(wbtcPerWethDecimalFactor);
          const wbtcPerWethBytes = await constantPriceAdapter.getEncodedData(wbtcPerWethPrice);
          const indexWbtcAuctionExecutionParams = {
            targetUnit: bitcoin(.54),
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: wbtcPerWethBytes
          } as AuctionExecutionParams;

          const usdcPerWethDecimalFactor = ether(1).div(usdc(1));
          const usdcPerWethPrice = ether(0.0005).mul(usdcPerWethDecimalFactor);
          const usdcPerWeth = await constantPriceAdapter.getEncodedData(usdcPerWethPrice);
          const indexUsdcAuctionExecutionParams = {
            targetUnit: usdc(840),
            priceAdapterName: constantPriceAdapterName,
            priceAdapterData: usdcPerWeth
          } as AuctionExecutionParams;

          subjectSetToken = index;
          subjectCaller = bidder;

          duration = ONE_DAY_IN_SECONDS.mul(5);

          newComponents = [setup.usdc.address];
          newComponentsAuctionParams = [indexUsdcAuctionExecutionParams];
          oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams];
          issueAmount = ether(1);

          await setup.approveAndIssueSetToken(subjectSetToken, issueAmount);

          await auctionModule.startRebalance(
            subjectSetToken.address,
            newComponents,
            newComponentsAuctionParams,
            oldComponentsAuctionParams,
            duration,
            await index.positionMultiplier()
          );

          await setup.weth.connect(owner.wallet).transfer(bidder.address, ether(5));
          await setup.weth.connect(bidder.wallet).approve(auctionModule.address, ether(5));
          await auctionModule.connect(bidder.wallet).bid(subjectSetToken.address, setup.dai.address, ether(10000), ether(5));

          await setup.wbtc.connect(owner.wallet).transfer(bidder.address, bitcoin(0.04));
          await setup.wbtc.connect(bidder.wallet).approve(auctionModule.address, bitcoin(0.04));
          await auctionModule.connect(bidder.wallet).bid(subjectSetToken.address, setup.wbtc.address, bitcoin(0.04), ether(0.58));

          await setup.usdc.connect(owner.wallet).transfer(bidder.address, usdc(840));
          await setup.usdc.connect(bidder.wallet).approve(auctionModule.address, usdc(840));
          await auctionModule.connect(bidder.wallet).bid(subjectSetToken.address, setup.usdc.address, usdc(840), ether(0.42));

          await auctionModule.setRaiseTargetPercentage(subjectSetToken.address, subjectRaiseTargetPercentage);
        });

        it("the position units should be set as expected and the unit should be zeroed out", async () => {
          const prePositionMultiplier = (await auctionModule.rebalanceInfo(subjectSetToken.address)).positionMultiplier;

          await subject();

          const expectedPositionMultiplier = preciseDiv(
            prePositionMultiplier,
            PRECISE_UNIT.add(ether(.0025))
          );

          const positionMultiplier = (await auctionModule.rebalanceInfo(subjectSetToken.address)).positionMultiplier;
          const daiUnits = await subjectSetToken.getDefaultPositionRealUnit(setup.dai.address);

          expect(positionMultiplier).to.eq(expectedPositionMultiplier);
          expect(daiUnits).to.eq(ZERO);
        });
      });

      describe("with alternative target units", async () => {
        describe("when the target has been met and no ETH remains", async () => {
          beforeEach(async () => {
            const daiPerWethPrice = ether(0.0005);
            const daiPerWethBytes = await constantPriceAdapter.getEncodedData(daiPerWethPrice);
            const indexDaiAuctionExecutionParams = {
              targetUnit: ether(8000),
              priceAdapterName: constantPriceAdapterName,
              priceAdapterData: daiPerWethBytes
            } as AuctionExecutionParams;

            const wbtcPerWethDecimalFactor = ether(1).div(bitcoin(1));
            const wbtcPerWethPrice = ether(14.5).mul(wbtcPerWethDecimalFactor);
            const wbtcPerWethBytes = await constantPriceAdapter.getEncodedData(wbtcPerWethPrice);
            const indexWbtcAuctionExecutionParams = {
              targetUnit: bitcoin(.54),
              priceAdapterName: constantPriceAdapterName,
              priceAdapterData: wbtcPerWethBytes
            } as AuctionExecutionParams;

            const usdcPerWethDecimalFactor = ether(1).div(usdc(1));
            const usdcPerWethPrice = ether(0.0005).mul(usdcPerWethDecimalFactor);
            const usdcPerWeth = await constantPriceAdapter.getEncodedData(usdcPerWethPrice);
            const indexUsdcAuctionExecutionParams = {
              targetUnit: usdc(840),
              priceAdapterName: constantPriceAdapterName,
              priceAdapterData: usdcPerWeth
            } as AuctionExecutionParams;

            const indexWethAuctionExecutionParams = {
              targetUnit: ether(4),
              priceAdapterName: constantPriceAdapterName,
              priceAdapterData: ZERO_BYTES
            } as AuctionExecutionParams;

            subjectSetToken = indexWithWeth;
            subjectCaller = bidder;

            duration = ONE_DAY_IN_SECONDS.mul(5);

            newComponents = [setup.usdc.address];
            newComponentsAuctionParams = [indexUsdcAuctionExecutionParams];
            oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams, indexWethAuctionExecutionParams];
            issueAmount = ether(1);

            await setup.approveAndIssueSetToken(subjectSetToken, issueAmount);

            await auctionModule.startRebalance(
              subjectSetToken.address,
              newComponents,
              newComponentsAuctionParams,
              oldComponentsAuctionParams,
              duration,
              await index.positionMultiplier()
            );

            await setup.weth.connect(owner.wallet).transfer(bidder.address, ether(1));
            await setup.weth.connect(bidder.wallet).approve(auctionModule.address, ether(1));
            await auctionModule.connect(bidder.wallet).bid(subjectSetToken.address, setup.dai.address, ether(2000), ether(1));

            await setup.wbtc.connect(owner.wallet).transfer(bidder.address, bitcoin(0.04));
            await setup.wbtc.connect(bidder.wallet).approve(auctionModule.address, bitcoin(0.04));
            await auctionModule.connect(bidder.wallet).bid(subjectSetToken.address, setup.wbtc.address, bitcoin(0.04), ether(0.58));

            await setup.usdc.connect(owner.wallet).transfer(bidder.address, usdc(840));
            await setup.usdc.connect(bidder.wallet).approve(auctionModule.address, usdc(840));
            await auctionModule.connect(bidder.wallet).bid(subjectSetToken.address, setup.usdc.address, usdc(840), ether(0.42));

            await auctionModule.setRaiseTargetPercentage(subjectSetToken.address, subjectRaiseTargetPercentage);
          });

          it("the bid reverts", async () => {
            await expect(subject()).to.be.revertedWith("Targets not met or ETH =~ 0");
          });
        });

        describe("when set has weth as a component", async () => {
          describe("when the target has been met and ETH is below target unit", async () => {
            beforeEach(async () => {
              const daiPerWethPrice = ether(0.0005);
              const daiPerWethBytes = await constantPriceAdapter.getEncodedData(daiPerWethPrice);
              const indexDaiAuctionExecutionParams = {
                targetUnit: ether(8000),
                priceAdapterName: constantPriceAdapterName,
                priceAdapterData: daiPerWethBytes
              } as AuctionExecutionParams;

              const wbtcPerWethDecimalFactor = ether(1).div(bitcoin(1));
              const wbtcPerWethPrice = ether(14.5).mul(wbtcPerWethDecimalFactor);
              const wbtcPerWethBytes = await constantPriceAdapter.getEncodedData(wbtcPerWethPrice);
              const indexWbtcAuctionExecutionParams = {
                targetUnit: bitcoin(.54),
                priceAdapterName: constantPriceAdapterName,
                priceAdapterData: wbtcPerWethBytes
              } as AuctionExecutionParams;

              const usdcPerWethDecimalFactor = ether(1).div(usdc(1));
              const usdcPerWethPrice = ether(0.0005).mul(usdcPerWethDecimalFactor);
              const usdcPerWeth = await constantPriceAdapter.getEncodedData(usdcPerWethPrice);
              const indexUsdcAuctionExecutionParams = {
                targetUnit: usdc(840),
                priceAdapterName: constantPriceAdapterName,
                priceAdapterData: usdcPerWeth
              } as AuctionExecutionParams;

              const indexWethAuctionExecutionParams = {
                targetUnit: ether(4.1),
                priceAdapterName: constantPriceAdapterName,
                priceAdapterData: ZERO_BYTES
              } as AuctionExecutionParams;

              subjectSetToken = indexWithWeth;
              subjectCaller = bidder;

              duration = ONE_DAY_IN_SECONDS.mul(5);

              newComponents = [setup.usdc.address];
              newComponentsAuctionParams = [indexUsdcAuctionExecutionParams];
              oldComponentsAuctionParams = [indexDaiAuctionExecutionParams, indexWbtcAuctionExecutionParams, indexWethAuctionExecutionParams];
              issueAmount = ether(1);

              await setup.approveAndIssueSetToken(subjectSetToken, issueAmount);

              await auctionModule.startRebalance(
                subjectSetToken.address,
                newComponents,
                newComponentsAuctionParams,
                oldComponentsAuctionParams,
                duration,
                await index.positionMultiplier()
              );

              await setup.weth.connect(owner.wallet).transfer(bidder.address, ether(1));
              await setup.weth.connect(bidder.wallet).approve(auctionModule.address, ether(1));
              await auctionModule.connect(bidder.wallet).bid(subjectSetToken.address, setup.dai.address, ether(2000), ether(1));

              await setup.wbtc.connect(owner.wallet).transfer(bidder.address, bitcoin(0.04));
              await setup.wbtc.connect(bidder.wallet).approve(auctionModule.address, bitcoin(0.04));
              await auctionModule.connect(bidder.wallet).bid(subjectSetToken.address, setup.wbtc.address, bitcoin(0.04), ether(0.58));

              await setup.usdc.connect(owner.wallet).transfer(bidder.address, usdc(840));
              await setup.usdc.connect(bidder.wallet).approve(auctionModule.address, usdc(840));
              await auctionModule.connect(bidder.wallet).bid(subjectSetToken.address, setup.usdc.address, usdc(840), ether(0.42));

              await auctionModule.setRaiseTargetPercentage(subjectSetToken.address, subjectRaiseTargetPercentage);
            });

            it("the bid reverts", async () => {
              await expect(subject()).to.be.revertedWith("Targets not met or ETH =~ 0");
            });
          });
        });
      });
    });
  });
});
