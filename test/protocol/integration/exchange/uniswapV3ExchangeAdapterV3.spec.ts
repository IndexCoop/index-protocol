import "module-alias/register";
import { BigNumber, BigNumberish } from "ethers";
import { solidityPack } from "ethers/lib/utils";

import { Address, Bytes } from "@utils/types";
import { Account } from "@utils/test/types";
import { ZERO } from "@utils/constants";
import DeployHelper from "@utils/deploys";
import { ether } from "@utils/index";
import {
  addSnapshotBeforeRestoreAfterEach,
  getAccounts,
  getSystemFixture,
  getWaffleExpect,
  getRandomAddress,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";
import { ISwapRouter02__factory } from "../../../../typechain/factories/ISwapRouter02__factory";
import { ISwapRouter02Interface } from "../../../../typechain/ISwapRouter02";
import { UniswapV3ExchangeAdapterV3  } from "../../../../typechain/UniswapV3ExchangeAdapterV3";
const expect = getWaffleExpect();

describe("UniswapV3ExchangeAdapterV3", () => {
  let owner: Account;
  let mockSetToken: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;
  let swapRouterInterface: ISwapRouter02Interface;
  let swapRouterAddress: Address;
  let uniswapV3ExchangeAdapter: UniswapV3ExchangeAdapterV3;

  before(async () => {
    [owner, mockSetToken] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    swapRouterInterface = ISwapRouter02__factory.createInterface();
    swapRouterAddress = await getRandomAddress();
    uniswapV3ExchangeAdapter = await deployer.adapters.deployUniswapV3ExchangeAdapterV3(
      swapRouterAddress,
    );
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#constructor", async () => {
    let subjectSwapRouter: Address;

    beforeEach(async () => {
      subjectSwapRouter = swapRouterAddress;
    });

    async function subject(): Promise<any> {
      return await deployer.adapters.deployUniswapV3ExchangeAdapterV3(subjectSwapRouter);
    }

    it("should have the correct SwapRouter address", async () => {
      const deployedUniswapV3ExchangeAdapterV3 = await subject();

      const actualRouterAddress = await deployedUniswapV3ExchangeAdapterV3.swapRouter();
      expect(actualRouterAddress).to.eq(swapRouterAddress);
    });
  });

  describe("#getSpender", async () => {
    async function subject(): Promise<any> {
      return await uniswapV3ExchangeAdapter.getSpender();
    }

    it("should return the correct spender address", async () => {
      const spender = await subject();

      expect(spender).to.eq(swapRouterAddress);
    });
  });

  describe("#getTradeCalldata", async () => {
    let fixIn: boolean;

    let subjectMockSetToken: Address;
    let subjectSourceToken: Address;
    let subjectDestinationToken: Address;
    let subjectSourceQuantity: BigNumber;
    let subjectMinDestinationQuantity: BigNumber;
    let subjectPath: Bytes;

    beforeEach(async () => {
      fixIn = true;

      subjectSourceToken = setup.wbtc.address;
      subjectSourceQuantity = BigNumber.from(100000000);
      subjectDestinationToken = setup.weth.address;
      subjectMinDestinationQuantity = ether(25);
      subjectMockSetToken = mockSetToken.address;
      subjectPath = solidityPack(
        ["address", "uint24", "address", "bool"],
        [subjectSourceToken, BigNumber.from(3000), subjectDestinationToken, fixIn],
      );
    });

    async function subject(): Promise<any> {
      return await uniswapV3ExchangeAdapter.getTradeCalldata(
        subjectSourceToken,
        subjectDestinationToken,
        subjectMockSetToken,
        subjectSourceQuantity,
        subjectMinDestinationQuantity,
        subjectPath,
      );
    }

    it("should return the correct trade calldata", async () => {
      const calldata = await subject();
      const encodedPathWithoutBool = solidityPack(
        ["address", "uint24", "address"],
        [subjectSourceToken, BigNumber.from(3000), subjectDestinationToken],
      );

      const expectedCallData = swapRouterInterface.encodeFunctionData("exactInput", [
        {
          path: encodedPathWithoutBool,
          recipient: mockSetToken.address,
          amountIn: subjectSourceQuantity,
          amountOutMinimum: subjectMinDestinationQuantity,
        },
      ]);

      expect(JSON.stringify(calldata)).to.eq(
        JSON.stringify([swapRouterAddress, ZERO, expectedCallData]),
      );
    });

    describe("when fixIn is false", async () => {
      beforeEach(async () => {
        fixIn = false;

        subjectPath = solidityPack(
          ["address", "uint24", "address", "bool"],
          [subjectDestinationToken, BigNumber.from(3000), subjectSourceToken, fixIn],
        );
      });

      it("should return the correct trade calldata", async () => {
        const calldata = await subject();
        const encodedPathWithoutBool = solidityPack(
          ["address", "uint24", "address"],
          [subjectDestinationToken, BigNumber.from(3000), subjectSourceToken],
        );

        const expectedCallData = swapRouterInterface.encodeFunctionData("exactOutput", [
          {
            path: encodedPathWithoutBool,
            recipient: mockSetToken.address,
            amountOut: subjectMinDestinationQuantity,
            amountInMaximum: subjectSourceQuantity,
          },
        ]);

        expect(JSON.stringify(calldata)).to.eq(
          JSON.stringify([swapRouterAddress, ZERO, expectedCallData]),
        );
      });
    });

    context("when data is of invalid length", async () => {
      beforeEach(() => {
        // Skip encoding `fixIn` bool
        subjectPath = solidityPack(
          ["address", "uint24", "address"],
          [subjectSourceToken, BigNumber.from(3000), subjectDestinationToken],
        );
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Invalid data");
      });
    });

    context("when source token does not match path", async () => {
      beforeEach(async () => {
        subjectSourceToken = await getRandomAddress();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Source token path mismatch");
      });
    });

    context("when destination token does not match path", async () => {
      beforeEach(async () => {
        subjectDestinationToken = await getRandomAddress();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Destination token path mismatch");
      });
    });

    context("when fixIn boolean is invalid number", async () => {
      beforeEach(async () => {
        subjectPath = solidityPack(
          ["address", "uint24", "address", "uint8"],
          [subjectSourceToken, BigNumber.from(3000), subjectDestinationToken, BigNumber.from(2)],
        );
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Invalid bool data");
      });
    });
  });

  describe("#generateDataParam", async () => {
    let subjectToken1: Address;
    let subjectFee1: BigNumberish;
    let subjectToken2: Address;
    let subjectFee2: BigNumberish;
    let subjectToken3: Address;
    let subjectFixIn: boolean;

    beforeEach(async () => {
      subjectToken1 = setup.wbtc.address;
      subjectFee1 = 3000;
      subjectToken2 = setup.dai.address;
      subjectFee2 = 500;
      subjectToken3 = setup.weth.address;
      subjectFixIn = true;
    });

    async function subject(): Promise<string> {
      return await uniswapV3ExchangeAdapter.generateDataParam(
        [subjectToken1, subjectToken2, subjectToken3],
        [subjectFee1, subjectFee2],
        subjectFixIn,
      );
    }

    it("should create the correct path data", async () => {
      const data = await subject();

      const expectedData = solidityPack(
        ["address", "uint24", "address", "uint24", "address", "bool"],
        [subjectToken1, subjectFee1, subjectToken2, subjectFee2, subjectToken3, subjectFixIn],
      );

      expect(data).to.eq(expectedData);
    });

    describe("when fixIn is false", async () => {
      beforeEach(async () => {
        subjectFixIn = false;
      });

      it("should create the correct path data", async () => {
        const data = await subject();

        const expectedData = solidityPack(
          ["address", "uint24", "address", "uint24", "address", "bool"],
          [subjectToken1, subjectFee1, subjectToken2, subjectFee2, subjectToken3, subjectFixIn],
        );

        expect(data).to.eq(expectedData);
      });
    });
  });
});
