import "module-alias/register";
import { BigNumber, utils } from "ethers";
import { solidityPack } from "ethers/lib/utils";

import { Address, Bytes } from "@utils/types";
import { Account } from "@utils/test/types";
import { ZERO } from "@utils/constants";
import DeployHelper from "@utils/deploys";
import { ether, usdc } from "@utils/index";
import {
  getAccounts,
  getLastBlockTimestamp,
  getWaffleExpect,
  getRandomAddress,
  addSnapshotBeforeRestoreAfterEach,
} from "@utils/test/index";
import { AerodromeSlipstreamExchangeAdapter } from "../../../../typechain/AerodromeSlipstreamExchangeAdapter";
import { IAerodromeSlipstreamRouterInterface } from "../../../../typechain/IAerodromeSlipstreamRouter";
import { IAerodromeSlipstreamRouter__factory } from "../../../../typechain/factories/IAerodromeSlipstreamRouter__factory";
import { IWETH } from "@typechain/IWETH";
import { IWETH__factory } from "@typechain/factories/IWETH__factory";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { IERC20 } from "@typechain/IERC20";
import { IERC20__factory } from "@typechain/factories/IERC20__factory";
const expect = getWaffleExpect();

describe.only("@forked-base AerodromeSlipstreamExchangeAdapter", () => {
  let owner: Account;
  let mockSetToken: Account;
  let deployer: DeployHelper;
  let swapRouterInterface: IAerodromeSlipstreamRouterInterface;
  let swapRouterAddress: Address;
  let wethAddress: Address;
  let usdcAddress: Address;
  let usdcContract: IERC20;
  let weth: IWETH;
  let aerodromeExchangeAdapter: AerodromeSlipstreamExchangeAdapter;

  before(async () => {
    [owner, mockSetToken] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);

    swapRouterInterface = IAerodromeSlipstreamRouter__factory.createInterface();
    swapRouterAddress = "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5";
    wethAddress = "0x4200000000000000000000000000000000000006";
    usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    weth = IWETH__factory.connect(wethAddress, owner.wallet);
    usdcContract = IERC20__factory.connect(usdcAddress, owner.wallet);
    aerodromeExchangeAdapter =
      await deployer.adapters.deployAerodromeSlipstreamExchangeAdapter(swapRouterAddress);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#constructor", async () => {
    let subjectSwapRouter: Address;

    beforeEach(async () => {
      subjectSwapRouter = swapRouterAddress;
    });

    async function subject(): Promise<any> {
      return await deployer.adapters.deployAerodromeSlipstreamExchangeAdapter(subjectSwapRouter);
    }

    it("should have the correct SwapRouter address", async () => {
      const deployedAerodromeSlipstreamExchangeAdapter = await subject();

      const actualRouterAddress = await deployedAerodromeSlipstreamExchangeAdapter.swapRouter();
      expect(actualRouterAddress).to.eq(swapRouterAddress);
    });
  });

  describe("#getSpender", async () => {
    async function subject(): Promise<any> {
      return await aerodromeExchangeAdapter.getSpender();
    }

    it("should return the correct spender address", async () => {
      const spender = await subject();

      expect(spender).to.eq(swapRouterAddress);
    });
  });

  describe("#getTradeCalldata", async () => {
    let subjectMockSetToken: Address;
    let subjectSourceToken: Address;
    let subjectDestinationToken: Address;
    let subjectSourceQuantity: BigNumber;
    let subjectMinDestinationQuantity: BigNumber;
    let subjectPath: Bytes;

    beforeEach(async () => {
      subjectSourceToken = wethAddress;
      subjectSourceQuantity = ether(1);
      subjectDestinationToken = usdcAddress;
      subjectMinDestinationQuantity = usdc(1000);
      subjectMockSetToken = mockSetToken.address;
      subjectPath = solidityPack(
        ["address", "int24", "address"],
        [subjectSourceToken, BigNumber.from(100), subjectDestinationToken],
      );
    });

    async function subject(): Promise<any> {
      return await aerodromeExchangeAdapter.getTradeCalldata(
        subjectSourceToken,
        subjectDestinationToken,
        subjectMockSetToken,
        subjectSourceQuantity,
        subjectMinDestinationQuantity,
        subjectPath,
      );
    }

    it("should return the correct trade calldata", async () => {
      const blockTimestamp = await getLastBlockTimestamp();
      const [spender, value, calldata] = await subject();

      const expectedCallData = swapRouterInterface.encodeFunctionData("exactInput", [{
        path: subjectPath,
        recipient: subjectMockSetToken,
        deadline: blockTimestamp,
        amountIn: subjectSourceQuantity,
        amountOutMinimum: subjectMinDestinationQuantity,
      }]);

      expect(calldata).to.eq(expectedCallData);
      expect(value).to.eq(ZERO);
      expect(spender).to.eq(swapRouterAddress);
    });

    it("should be able to use data to swap", async () => {
      await weth.deposit({ value: subjectSourceQuantity });
      const tx = await weth.approve(swapRouterAddress, subjectSourceQuantity);
      await tx.wait();

      const wethBalanceBefore = await weth.balanceOf(owner.address);
      const usdcBalanceBefore = await usdcContract.balanceOf(mockSetToken.address);

      const [to, value, data] = await subject();
      const blockTimestamp = await getLastBlockTimestamp();
      await time.setNextBlockTimestamp(blockTimestamp);
      await owner.wallet.sendTransaction({ to, data, value, gasLimit: 2_000_000 });

      const wethBalanceAfter = await weth.balanceOf(owner.address);
      const usdcBalanceAfter = await usdcContract.balanceOf(mockSetToken.address);
      expect(wethBalanceAfter).to.eq(wethBalanceBefore.sub(subjectSourceQuantity));
      expect(usdcBalanceAfter).to.gt(usdcBalanceBefore.add(subjectMinDestinationQuantity));
    });

    context("when data is of invalid length", async () => {
      beforeEach(() => {
        subjectPath = utils.defaultAbiCoder.encode(
          ["address", "uint256", "address"],
          [subjectSourceToken, BigNumber.from(3000), subjectDestinationToken],
        );
      });

      it("should revert", async () => {
        await expect(subject()).to.be.reverted;
      });
    });

    context("when source token does not match path", async () => {
      beforeEach(async () => {
        subjectSourceToken = await getRandomAddress();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith(
          "AerodromeSlipstreamExchangeAdapter: source token path mismatch",
        );
      });
    });

    context("when destination token does not match path", async () => {
      beforeEach(async () => {
        subjectDestinationToken = await getRandomAddress();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith(
          "AerodromeSlipstreamExchangeAdapter: destination token path mismatch",
        );
      });
    });
  });

  describe("#generateDataParam", async () => {
    let subjectTokens: Address[];
    let subjectTickSpacing: number[];

    beforeEach(async () => {
      subjectTokens = [wethAddress, usdcAddress];
      subjectTickSpacing = [100];
    });

    async function subject(): Promise<string> {
      return await aerodromeExchangeAdapter.generateDataParam(subjectTokens, subjectTickSpacing);
    }

    it("should create correct calldata", async () => {
      const data = await subject();

      const expectedData = solidityPack(
        ["address", "int24", "address"],
        [subjectTokens[0], BigNumber.from(100), subjectTokens[1]],
      );

      expect(data).to.eq(expectedData);
    });
  });
});
