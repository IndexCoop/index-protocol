/*
    Copyright 2023 Index Coop

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

    SPDX-License-Identifier: Apache License, Version 2.0
*/

pragma solidity 0.6.10;
pragma experimental "ABIEncoderV2";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

import { AddressArrayUtils } from "../../../lib/AddressArrayUtils.sol";
import { IAuctionPriceAdapterV1 } from "../../../interfaces/IAuctionPriceAdapterV1.sol";
import { IController } from "../../../interfaces/IController.sol";
import { Invoke } from "../../lib/Invoke.sol";
import { ISetToken } from "../../../interfaces/ISetToken.sol";
import { IWETH } from "../../../interfaces/external/IWETH.sol";
import { ModuleBase } from "../../lib/ModuleBase.sol";
import { Position } from "../../lib/Position.sol";
import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";

/**
 * @title AuctionRebalanceModuleV1
 * @author Index Coop / Set Protocol
 * @notice Smart contract that facilitates rebalances for indices via single asset auctions for an intermediate asset 
 * (WETH). Index managers input the target allocation of each component in precise units (10 ** 18), the individual
 * component auction parameters, and the duration of the rebalance to startRebalance(). Once the rebalance is started
 * allowed bidders can call bid() to bid on the component auctions. If excess WETH is left over after all component
 * targets are met, the manager can call raiseAssetTargets() to raise all component targets by a specified percentage.
 * @dev Security assumption: works with StreamingFeeModule and BasicIssuanceModule (any other module additions to Sets
 * using this module need to be examined separately)
 */
contract AuctionRebalanceModuleV1 is ModuleBase, ReentrancyGuard {
    using SafeCast for int256;
    using SafeCast for uint256;
    using SafeMath for uint256;
    using Position for uint256;
    using Math for uint256;
    using Position for ISetToken;
    using Invoke for ISetToken;
    using AddressArrayUtils for address[];
    using AddressArrayUtils for IERC20[];

    /* ============ Struct ============ */

    struct AuctionExecutionParams {
        uint256 targetUnit;                       // Target unit of component for Set
        string priceAdapterName;                  // Name of price adapter
        bytes priceAdapterData;                   // Arbitrary data that can be used to encode price adapter specific settings
    }

    struct BidPermissionInfo {
        bool anyoneBid;                           // Boolean indicating if anyone can execute a bid
        address[] biddersHistory;                 // Tracks permissioned bidders to be deleted on module removal
        mapping(address => bool) bidAllowList;    // Mapping indicating which addresses are allowed to execute a bid
    }

    struct RebalanceInfo {
        uint256 startTime;                        // Time that the rebalance began
        uint256 duration;                         // Time in seconds from start to end of rebalance
        uint256 positionMultiplier;               // Position multiplier at the beginning of rebalance
        uint256 raiseTargetPercentage;            // Amount to raise all unit targets by if allowed (in precise units)
        address[] rebalanceComponents;            // Array of components involved in rebalance
    }

    struct BidInfo {
        ISetToken setToken;                       // Instance of SetToken
        IERC20 component;                         // Instance of the component being bid on
        IAuctionPriceAdapterV1 priceAdapter;      // Instance of PriceAdapter
        bytes priceAdapterData;                   // Arbitrary data that can be used to encode price adapter specific settings
        uint256 setTotalSupply;                   // Total supply of Set (in precise units)
        bool isSendToken;                         // Boolean indicating if component is being sent away by SetToken in the bid
        uint256 maxComponentQuantity;             // Quantity of component being auctioned off
        address sendToken;                        // Address of token being sent away by SetToken in the bid
        address receiveToken;                     // Address of token being received by SetToken in the bid
        uint256 price;                            // Price quote from the PriceAdapter (in precise units)
        uint256 sendQuantity;                     // Total quantity of token being sent away by SetToken in the bid
        uint256 receiveQuantity;                  // Total quantity of token received by SetToken in the bid
        uint256 preBidSendTokenBalance;           // Total initial balance of token being sent away by SetToken in the bid
        uint256 preBidReceiveTokenBalance;        // Total initial balance of token received by SetToken in the bid
    }

    /* ============ Events ============ */

    /**
     * @dev Emitted on setRaiseTargetPercentage()
     * @param _setToken                 Instance of the SetToken being rebalanced
     * @param _raiseTargetPercentage    Amount to raise all component's unit targets by (in precise units)
     */
    event RaiseTargetPercentageUpdated(
        ISetToken indexed _setToken, 
        uint256 _raiseTargetPercentage
    );

    /**
     * @dev Emitted on raiseAssetTargets()
     * @param _setToken              Instance of the SetToken being rebalanced
     * @param _positionMultiplier    Updated reference positionMultiplier for the SetToken rebalance
     */
    event AssetTargetsRaised(
        ISetToken indexed _setToken, 
        uint256 _positionMultiplier
    );

    /**
     * @dev Emitted on setAnyoneBid()
     * @param _setToken        Instance of the SetToken being rebalanced
     * @param _status          Boolean indicating if anyone can bid
     */
    event AnyoneBidUpdated(
        ISetToken indexed _setToken, 
        bool _status
    );

    /**
     * @dev Emitted on setBidderStatus()
     * @param _setToken        Instance of the SetToken being rebalanced
     * @param _bidder          Address of the bidder to toggle status
     * @param _status          Boolean indicating if bidder can bid
     */
    event BidderStatusUpdated(
        ISetToken indexed _setToken, 
        address indexed _bidder, 
        bool _status
    );

    /**
     * @dev Emitted on startRebalance()
     * @param _setToken                  Instance of the SetToken being rebalanced
     * @param _duration                  Time in seconds from start to end of rebalance
     * @param _positionMultiplier        Position multiplier when target units were calculated, needed in order to 
     *                                   adjust target units if fees accrued
     * @param _rebalanceComponents       Array of components involved in rebalance
     */
    event RebalanceStarted(
        ISetToken indexed _setToken,
        uint256 _duration,
        uint256 _positionMultiplier,
        address[] _rebalanceComponents 
    );

    /**
     * @dev Emitted on bid()
     * @param _setToken                     Instance of the SetToken to be rebalanced
     * @param _component                    Instance of the component being bid on
     * @param _bidder                       Address of the bidder
     * @param _priceAdapter                 Address of the price adapter
     * @param _isSendToken                  Boolean indicating if component is being sent away by SetToken in the bid
     * @param _price                        Price quote from the PriceAdapter (in precise units)
     * @param _netSendAmount                Total quantity of token being sent away by SetToken in the bid
     * @param _netReceiveAmount             Total quantity of token received by SetToken in the bid
     * @param _protocolFee                  Amount of receive token taken as protocol fee
     * @param _setTotalSupply               Total supply of SetToken (in precise units)
     */
    event BidExecuted(
        ISetToken indexed _setToken,
        address indexed _component,
        address indexed _bidder,
        IAuctionPriceAdapterV1 _priceAdapter,
        bool _isSendToken,
        uint256 _price,
        uint256 _netSendAmount,
        uint256 _netReceiveAmount,
        uint256 _protocolFee,
        uint256 _setTotalSupply
    );


    /* ============ Constants ============ */

    uint256 private constant AUCTION_REBALANCE_MODULE_PROTOCOL_FEE_INDEX = 0;               // Id of protocol fee % assigned to this module in the Controller

    /* ============ State Variables ============ */

    mapping(ISetToken => mapping(IERC20 => AuctionExecutionParams)) public executionInfo;   // Mapping of SetToken to execution parameters of each asset on SetToken
    mapping(ISetToken => BidPermissionInfo) public permissionInfo;                          // Mapping of SetToken to bid permissions
    mapping(ISetToken => RebalanceInfo) public rebalanceInfo;                               // Mapping of SetToken to relevant data for latest rebalance
    IWETH public immutable weth;                                                            // Instance of WETH

    /* ============ Modifiers ============ */

    modifier onlyAllowedBidder(ISetToken _setToken) {
        _validateOnlyAllowedBidder(_setToken);
        _;
    }

    /* ============ Constructor ============ */

    /**
     * @dev Deploy AuctionModuleV1 with passed controller and WETH address.
     * 
     * @param _controller           Instance of the Controller
     * @param _weth                 Instance of WETH
     */
    constructor(
        IController _controller, 
        IWETH _weth
    ) 
        public 
        ModuleBase(_controller) 
    {
        weth = _weth;
    }

    /* ============ External Functions ============ */

    /**
     * @dev MANAGER ONLY: Changes the target allocation of the Set, opening up auctions for filling by the Sets designated bidders. The manager
     * must pass in any new components and their target units (units defined by the amount of that component the manager wants in 10**18
     * units of a SetToken). Old component target units must be passed in, in the current order of the components array on the
     * SetToken. If a component is being removed it's index in the _oldComponentsTargetUnits should be set to 0. Additionally, the
     * positionMultiplier is passed in, in order to adjust the target units in the event fees are accrued or some other activity occurs
     * that changes the positionMultiplier of the Set. This guarantees the same relative allocation between all the components. If the target
     * allocation is not reached within the duration, the rebalance closes with the allocation that was reached.
     *
     * @param _setToken                         Instance of the SetToken to be rebalanced
     * @param _newComponents                    Array of new components to add to allocation
     * @param _newComponentsAuctionParams       Array of AuctionExecutionParams for new components, maps to same index of _newComponents array
     * @param _oldComponentsAuctionParams       Array of AuctionExecutionParams for old component, maps to same index of
     *                                               _setToken.getComponents() array, if component being removed set to 0.
     * @param _duration                         Time in seconds from start to end of rebalance
     * @param _positionMultiplier               Position multiplier when target units were calculated, needed in order to adjust target units
     *                                               if fees accrued
     */
    function startRebalance(
        ISetToken _setToken,
        address[] calldata _newComponents,
        AuctionExecutionParams[] memory _newComponentsAuctionParams,
        AuctionExecutionParams[] memory _oldComponentsAuctionParams,
        uint256 _duration,
        uint256 _positionMultiplier
    )
        external
        onlyManagerAndValidSet(_setToken)
    {
        ( address[] memory aggregateComponents, AuctionExecutionParams[] memory aggregateAuctionParams ) = _getAggregateComponentsAndAuctionParams(
            _setToken.getComponents(),
            _newComponents,
            _newComponentsAuctionParams,
            _oldComponentsAuctionParams
        );

        for (uint256 i = 0; i < aggregateComponents.length; i++) {
            require(!_setToken.hasExternalPosition(aggregateComponents[i]), "External positions not allowed");
            executionInfo[_setToken][IERC20(aggregateComponents[i])] = aggregateAuctionParams[i];
        }

        rebalanceInfo[_setToken].startTime = block.timestamp;
        rebalanceInfo[_setToken].duration = _duration;
        rebalanceInfo[_setToken].positionMultiplier = _positionMultiplier;
        rebalanceInfo[_setToken].rebalanceComponents = aggregateComponents;

        emit RebalanceStarted(_setToken, _duration, _positionMultiplier, aggregateComponents);
    }

    /**
     * @dev ACCESS LIMITED: Calling bid() pushes the current component units closer to the target units defined by the manager in startRebalance().
     * Only approved addresses can call, if anyoneBid is false then contracts are allowed to call otherwise calling address must be EOA.
     * 
     * Bidder can pass in a max/min amount of ETH spent/received in the bid based on if the component is being bought/sold. The parameters defined
     * by the manager are used to determine which exchange will be used and the size of the bid. Any bid size that does not push the component units
     * past the target units will be reverted. Protocol fees, if enabled, are collected in the token received in a bid.
     * 
     * @param _setToken             Instance of the SetToken to be rebalanced
     * @param _component            Instance of the component auction to bid on
     * @param _componentQuantity    Amount of component in the bid
     * @param _ethQuantityLimit     Max/min amount of ETH spent/received during bid
     */
    function bid(
        ISetToken _setToken,
        IERC20 _component,
        uint256 _componentQuantity,
        uint256 _ethQuantityLimit
    )
        external
        nonReentrant
        onlyAllowedBidder(_setToken)
        virtual
    {
        _validateBidTargets(_setToken, _component);

        BidInfo memory bidInfo = _createBidInfo(_setToken, _component, _componentQuantity, _ethQuantityLimit);

        _executeBid(bidInfo);

        uint256 protocolFee = _accrueProtocolFee(bidInfo);

        (uint256 netSendAmount, uint256 netReceiveAmount) = _updatePositionState(bidInfo);

        emit BidExecuted(
            bidInfo.setToken,
            address(bidInfo.component),
            msg.sender,
            bidInfo.priceAdapter,
            bidInfo.isSendToken,
            bidInfo.price,
            netSendAmount,
            netReceiveAmount,
            protocolFee,
            bidInfo.setTotalSupply
        );
    } 

    /**
     * @dev ACCESS LIMITED: For situation where all target units met and remaining WETH, uniformly raise targets by same percentage by applying
     * to logged positionMultiplier in RebalanceInfo struct, in order to allow further bidding. Can be called multiple times if necessary,
     * targets are increased by amount specified by raiseAssetTargetsPercentage as set by manager. In order to reduce tracking error
     * raising the target by a smaller amount allows greater granularity in finding an equilibrium between the excess ETH and components
     * that need to be bought. Raising the targets too much could result in vastly under allocating to WETH as more WETH than necessary is
     * spent buying the components to meet their new target.
     *
     * @param _setToken             Instance of the SetToken being rebalanced
     */
    function raiseAssetTargets(
        ISetToken _setToken
    ) 
        external 
        onlyAllowedBidder(_setToken) 
        virtual 
    {
        require(
            _allTargetsMet(_setToken)
            && _getDefaultPositionRealUnit(_setToken, weth) > _getNormalizedTargetUnit(_setToken, weth),
            "Targets not met or ETH =~ 0"
        );

        // positionMultiplier / (10^18 + raiseTargetPercentage)
        // ex: (10 ** 18) / ((10 ** 18) + ether(.0025)) => 997506234413965087
        rebalanceInfo[_setToken].positionMultiplier = rebalanceInfo[_setToken].positionMultiplier.preciseDiv(
            PreciseUnitMath.preciseUnit().add(rebalanceInfo[_setToken].raiseTargetPercentage)
        );
        emit AssetTargetsRaised(_setToken, rebalanceInfo[_setToken].positionMultiplier);
    }

    /**
     * @dev MANAGER ONLY: Set amount by which all component's targets units would be raised. Can be called at any time.
     *
     * @param _setToken                     Instance of the SetToken being rebalanced
     * @param _raiseTargetPercentage        Amount to raise all component's unit targets by (in precise units)
     */
    function setRaiseTargetPercentage(
        ISetToken _setToken,
        uint256 _raiseTargetPercentage
    )
        external
        onlyManagerAndValidSet(_setToken)
    {
        require(_raiseTargetPercentage > 0, "Target percentage must be > 0");
        rebalanceInfo[_setToken].raiseTargetPercentage = _raiseTargetPercentage;
        emit RaiseTargetPercentageUpdated(_setToken, _raiseTargetPercentage);
    }

    /**
     * @dev MANAGER ONLY: Toggles ability for passed addresses to call bid(). Can be called at any time.
     *
     * @param _setToken        Instance of the SetToken being rebalanced
     * @param _bidders         Array bidder addresses to toggle status
     * @param _statuses        Booleans indicating if matching bidder can bid
     */
    function setBidderStatus(
        ISetToken _setToken,
        address[] memory _bidders,
        bool[] memory _statuses
    )
        external
        onlyManagerAndValidSet(_setToken)
    {
        _bidders.validatePairsWithArray(_statuses);

        for (uint256 i = 0; i < _bidders.length; i++) {
            _updateBiddersHistory(_setToken, _bidders[i], _statuses[i]);
            permissionInfo[_setToken].bidAllowList[_bidders[i]] = _statuses[i];
            emit BidderStatusUpdated(_setToken, _bidders[i], _statuses[i]);
        }
    }

    /**
     * @dev MANAGER ONLY: Toggle whether anyone can bid, if true bypasses the bidAllowList. Can be called at anytime.
     *
     * @param _setToken         Instance of the SetToken
     * @param _status           Boolean indicating if anyone can bid
     */
    function setAnyoneBid(
        ISetToken _setToken, 
        bool _status
    ) 
        external 
        onlyManagerAndValidSet(_setToken) 
    {
        permissionInfo[_setToken].anyoneBid = _status;
        emit AnyoneBidUpdated(_setToken, _status);
    }

    /**
     * @dev MANAGER ONLY: Called to initialize module to SetToken in order to allow AuctionRebalanceModuleV1 access for rebalances.
     * Grabs the current units for each asset in the Set and set's the targetUnit to that unit in order to prevent any
     * bidding until startRebalance() is explicitly called. Position multiplier is also logged in order to make sure any
     * position multiplier changes don't unintentionally open the Set for rebalancing.
     *
     * @param _setToken         Address of the Set Token
     */
    function initialize(ISetToken _setToken)
        external
        onlySetManager(_setToken, msg.sender)
        onlyValidAndPendingSet(_setToken)
    {
        ISetToken.Position[] memory positions = _setToken.getPositions();

        for (uint256 i = 0; i < positions.length; i++) {
            ISetToken.Position memory position = positions[i];
            require(position.positionState == 0, "External positions not allowed");
            executionInfo[_setToken][IERC20(position.component)].targetUnit = position.unit.toUint256();
        }

        rebalanceInfo[_setToken].positionMultiplier = _setToken.positionMultiplier().toUint256();
        _setToken.initializeModule();
    }

    /**
     * @dev Called by a SetToken to notify that this module was removed from the SetToken.
     * Clears the rebalanceInfo and permissionsInfo of the calling SetToken.
     * IMPORTANT: SetToken's auction execution settings, including auction params,
     * are NOT DELETED. Restoring a previously removed module requires that care is taken to
     * initialize execution settings appropriately.
     */
    function removeModule() external override {
        BidPermissionInfo storage tokenPermissionInfo = permissionInfo[ISetToken(msg.sender)];

        for (uint i = 0; i < tokenPermissionInfo.biddersHistory.length; i++) {
            tokenPermissionInfo.bidAllowList[tokenPermissionInfo.biddersHistory[i]] = false;
        }

        delete rebalanceInfo[ISetToken(msg.sender)];
        delete permissionInfo[ISetToken(msg.sender)];
    }


    /* ============ External View Functions ============ */

    /**
     * @dev Get the array of SetToken components involved in rebalance.
     *
     * @param _setToken         Address of the SetToken
     *
     * @return address[]        Array of _setToken components involved in rebalance
     */
    function getRebalanceComponents(ISetToken _setToken)
        external
        view
        onlyValidAndInitializedSet(_setToken)
        returns (address[] memory)
    {
        return rebalanceInfo[_setToken].rebalanceComponents;
    }

    /**
     * @dev Calculates the amount of a component is remaining to be auctioned and whether the component is being bought or sold.
     * If currentUnit and targetUnit are the same, function will revert.
     *
     * @param _setToken                 Instance of the SetToken to rebalance
     * @param _component                IERC20 component to bid
     *
     * @return isSendTokenFixed         Boolean indicating fixed asset is send token
     * @return componentQuantity        Amount of component in the bid
     */
    function getAuctionSizeAndDirection(
        ISetToken _setToken,
        IERC20 _component
    )
        external
        view
        onlyValidAndInitializedSet(_setToken)
        returns (bool, uint256)
    {
        require(
            rebalanceInfo[_setToken].rebalanceComponents.contains(address(_component)),
            "Component not recognized"
        );
        uint256 totalSupply = _setToken.totalSupply();
        return _calculateAuctionSizeAndDirection(_setToken, _component, totalSupply);
    }

    /**
     * @dev Calculates the amount of a component is going to be exchanged in bid and whether 
     * the component is being bought or sold.
     *
     * @param _setToken             Instance of the SetToken to be rebalanced
     * @param _component            Instance of the component auction to bid on
     * @param _componentQuantity    Amount of component in the bid
     * @param _ethQuantityLimit     Max/min amount of ETH spent/received during bid
     *
     * @return bidInfo              Struct containing data for bid
     */
    function getBidPreview(
        ISetToken _setToken,
        IERC20 _component,
        uint256 _componentQuantity,
        uint256 _ethQuantityLimit
    )
        external
        view
        onlyValidAndInitializedSet(_setToken)
        returns (BidInfo memory bidInfo)
    {
        _validateBidTargets(_setToken, _component);

        bidInfo = _createBidInfo(_setToken, _component, _componentQuantity, _ethQuantityLimit);
    }

    /**
     * @dev Get if a given address is an allowed bidder.
     *
     * @param _setToken         Address of the SetToken
     * @param _bidder           Address of the bidder
     *
     * @return bool             True if _bidder is allowed to bid, else false
     */
    function getIsAllowedBidder(
        ISetToken _setToken, 
        address _bidder
    )
        external
        view
        onlyValidAndInitializedSet(_setToken)
        returns (bool)
    {
        return _isAllowedBidder(_setToken, _bidder);
    }

    /**
     * @dev Get the list of bidders who are allowed to call bid()
     *
     * @param _setToken         Address of the SetToken
     *
     * @return address[]
     */
    function getAllowedBidders(ISetToken _setToken)
        external
        view
        onlyValidAndInitializedSet(_setToken)
        returns (address[] memory)
    {
        return permissionInfo[_setToken].biddersHistory;
    }

    /* ============ Internal Functions ============ */

    /**
     * @dev Create and return BidInfo struct. This function reverts if the target has already been met.
     *
     * @param _setToken             Address of the SetToken to be rebalanced
     * @param _component            Address of the component auction to bid on
     * @param _componentQuantity    Amount of component in the bid
     * @param _ethQuantityLimit     Max/min amount of ETH spent/received during bid
     *
     * @return bidInfo              Struct containing data for bid
     */
    function _createBidInfo(
        ISetToken _setToken,
        IERC20 _component,
        uint256 _componentQuantity,
        uint256 _ethQuantityLimit
    )
        internal
        view
        virtual
        returns (BidInfo memory bidInfo)
    {
        bidInfo.setToken = _setToken;
        bidInfo.component = _component;
        bidInfo.setTotalSupply = _setToken.totalSupply();

        bidInfo.priceAdapter = _getAuctionPriceAdapter(_setToken, _component);
        bidInfo.priceAdapterData = executionInfo[_setToken][_component].priceAdapterData;
        
        (
            bidInfo.isSendToken,
            bidInfo.maxComponentQuantity
        ) = _calculateAuctionSizeAndDirection(_setToken, _component, bidInfo.setTotalSupply);

        require(_componentQuantity <= bidInfo.maxComponentQuantity, "Bid size too large");

        bidInfo.price = bidInfo.priceAdapter.getPrice(
            _setToken,
            _component,
            _componentQuantity,
            block.timestamp - rebalanceInfo[_setToken].startTime,
            rebalanceInfo[_setToken].duration,
            bidInfo.priceAdapterData
        );

        uint256 ethQuantity = _componentQuantity.preciseMul(bidInfo.price);

        if (bidInfo.isSendToken){
            bidInfo.sendToken = address(_component);
            bidInfo.receiveToken = address(weth);

            require(ethQuantity <= _ethQuantityLimit, "WETH input exceeds maximum");

            bidInfo.sendQuantity = _componentQuantity;
            bidInfo.receiveQuantity = ethQuantity;
        } else {
            bidInfo.sendToken = address(weth);
            bidInfo.receiveToken = address(_component);

            require(ethQuantity >= _ethQuantityLimit, "WETH output below minimum");

            bidInfo.sendQuantity = ethQuantity;
            bidInfo.receiveQuantity = _componentQuantity;
        }

        bidInfo.preBidSendTokenBalance = IERC20(bidInfo.sendToken).balanceOf(address(_setToken));
        bidInfo.preBidReceiveTokenBalance = IERC20(bidInfo.receiveToken).balanceOf(address(_setToken));
    }

    /**
     * @dev Execute the token transfers of the bid
     *
     * @param _bidInfo          Struct containing data for bid
     */
    function _executeBid(
        BidInfo memory _bidInfo
    )
        internal 
        virtual
    {
        transferFrom(
            IERC20(_bidInfo.receiveToken),
            msg.sender,
            address(_bidInfo.setToken),
            _bidInfo.receiveQuantity
        );

        _bidInfo.setToken.strictInvokeTransfer(
            _bidInfo.sendToken,
            msg.sender,
            _bidInfo.sendQuantity
        );
    }

    /**
     * @dev Retrieve fee from controller and calculate total protocol fee and send from SetToken to protocol recipient.
     * The protocol fee is collected from the amount of received token in the bid.
     *
     * @param _bidInfo                Struct containing bid information used in internal functions
     *
     * @return protocolFee              Amount of receive token taken as protocol fee
     */
    function _accrueProtocolFee(BidInfo memory _bidInfo) internal returns (uint256 protocolFee) {
        uint256 exchangedQuantity =  IERC20(_bidInfo.receiveToken)
            .balanceOf(address(_bidInfo.setToken))
            .sub(_bidInfo.preBidReceiveTokenBalance);

        protocolFee = getModuleFee(AUCTION_REBALANCE_MODULE_PROTOCOL_FEE_INDEX, exchangedQuantity);
        payProtocolFeeFromSetToken(_bidInfo.setToken, _bidInfo.receiveToken, protocolFee);
    }

    /**
     * @dev Update SetToken positions. This function is intended to be called after the fees have been accrued, 
     * hence it returns the amount of tokens bought net of fees.
     *
     * @param _bidInfo                Struct containing bid information used in internal functions
     *
     * @return netSendAmount            Amount of sendTokens used in the bid
     * @return netReceiveAmount         Amount of receiveTokens received in the bid (net of fees)
     */
    function _updatePositionState(BidInfo memory _bidInfo)
        internal
        returns (uint256 netSendAmount, uint256 netReceiveAmount)
    {
        (uint256 postBidSendTokenBalance,,) = _bidInfo.setToken.calculateAndEditDefaultPosition(
            _bidInfo.sendToken,
            _bidInfo.setTotalSupply,
            _bidInfo.preBidSendTokenBalance
        );
        (uint256 postBidReceiveTokenBalance,,) = _bidInfo.setToken.calculateAndEditDefaultPosition(
            _bidInfo.receiveToken,
            _bidInfo.setTotalSupply,
            _bidInfo.preBidReceiveTokenBalance
        );

        netSendAmount = _bidInfo.preBidSendTokenBalance.sub(postBidSendTokenBalance);
        netReceiveAmount = postBidReceiveTokenBalance.sub(_bidInfo.preBidReceiveTokenBalance);
    }

    /**
     * @dev Validate that component is a valid component with an active auction. Bids cannot be explicitly placed on WETH, 
     * it may only implicitly be bid on by being the quote asset for other component bids.
     *
     * @param _setToken         Instance of the SetToken
     * @param _component        IERC20 component to be validated
     */
    function _validateBidTargets(
        ISetToken _setToken,
        IERC20 _component
    )
        internal
        view
    {
        require(address(_component) != address(weth), "Can not explicitly bid WETH");
        require(
            rebalanceInfo[_setToken].rebalanceComponents.contains(address(_component)),
            "Component not part of rebalance"
        );

        require(!_setToken.hasExternalPosition(address(_component)), "External positions not allowed");

        require(rebalanceInfo[_setToken].startTime + rebalanceInfo[_setToken].duration > block.timestamp, "Rebalance must be in progress");
    }

    /**
     * @dev Calculates the amount of a component is remaining to be auctioned and whether the component is being bought or sold.
     * If currentUnit and targetUnit are the same, function will revert.
     *
     * @param _setToken                 Instance of the SetToken to rebalance
     * @param _component                Address of the component auction to bid on
     * @param _totalSupply              Total supply of _setToken
     *
     * @return isSendToken              Boolean indicating if sendToken is the component
     * @return maxComponentQuantity     Quantity of component to be exchanged to settle the auction
     */
    function _calculateAuctionSizeAndDirection(
        ISetToken _setToken,
        IERC20 _component,
        uint256 _totalSupply
    )
        internal
        view
        returns (bool isSendToken, uint256 maxComponentQuantity)
    {
        uint256 protocolFee = controller.getModuleFee(address(this), AUCTION_REBALANCE_MODULE_PROTOCOL_FEE_INDEX);

        (
            uint256 currentUnit,
            uint256 targetUnit,
            uint256 currentNotional,
            uint256 targetNotional
        ) = _getUnitsAndNotionalAmounts(_setToken, _component, _totalSupply);

        require(currentUnit != targetUnit, "Target already met");

        isSendToken = targetNotional < currentNotional;

        // In order to account for fees taken by protocol when buying the notional difference between currentUnit
        // and targetUnit is divided by (1 - protocolFee) to make sure that targetUnit can be met. Failure to
        // do so would lead to never being able to meet target of components that need to be bought.
        //
        // ? - lesserOf: (componentMaxSize, (currentNotional - targetNotional))
        // : - lesserOf: (componentMaxSize, (targetNotional - currentNotional) / 10 ** 18 - protocolFee)
        maxComponentQuantity = isSendToken
            ? currentNotional.sub(targetNotional)
            : targetNotional.sub(currentNotional).preciseDiv(PreciseUnitMath.preciseUnit().sub(protocolFee));
    }

    /**
     * @dev Extends and/or updates the current component set and its auction params with new components and auction params,
     * Validates inputs, requiring that that new components and new auction params arrays are the same size, and
     * that the number of old components auction params matches the number of current components. Throws if
     * a duplicate component has been added.
     *
     * @param  _currentComponents               Complete set of current SetToken components
     * @param _newComponents                    Array of new components to add to allocation
     * @param _newComponentsAuctionParams       Array of AuctionExecutionParams for new components, maps to same index of _newComponents array
     * @param _oldComponentsAuctionParams       Array of AuctionExecutionParams for old component, maps to same index of
     *                                               _setToken.getComponents() array, if component being removed set to 0.
     * @return aggregateComponents              Array of current components extended by new components, without duplicates
     * @return aggregateAuctionParams           Array of old component AuctionExecutionParams extended by new AuctionExecutionParams, without duplicates
     */
    function _getAggregateComponentsAndAuctionParams(
        address[] memory _currentComponents,
        address[] calldata _newComponents,
        AuctionExecutionParams[] memory _newComponentsAuctionParams,
        AuctionExecutionParams[] memory _oldComponentsAuctionParams
    )
        internal
        pure
        returns (address[] memory aggregateComponents, AuctionExecutionParams[] memory aggregateAuctionParams)
    {
        // Don't use validate arrays because empty arrays are valid
        require(_newComponents.length == _newComponentsAuctionParams.length, "Array length mismatch");
        require(_currentComponents.length == _oldComponentsAuctionParams.length, "Old Components targets missing");

        aggregateComponents = _currentComponents.extend(_newComponents);
        aggregateAuctionParams = _extendAuctionParams(_oldComponentsAuctionParams, _newComponentsAuctionParams);

        require(!aggregateComponents.hasDuplicate(), "Cannot duplicate components");
    }

    /**
     * @dev Adds or removes newly permissioned bidder to/from permissionsInfo bidderHistory. It's
     * necessary to verify that bidderHistory contains the address because AddressArrayUtils will
     * throw when attempting to remove a non-element and it's possible someone can set a new
     * bidder's status to false.
     *
     * @param _setToken                         Instance of the SetToken
     * @param _bidder                           Bidder whose permission is being set
     * @param _status                           Boolean permission being set
     */
    function _updateBiddersHistory(
        ISetToken _setToken, 
        address _bidder, 
        bool _status
    ) 
        internal 
    {
        if (_status && !permissionInfo[_setToken].biddersHistory.contains(_bidder)) {
            permissionInfo[_setToken].biddersHistory.push(_bidder);
        } else if(!_status && permissionInfo[_setToken].biddersHistory.contains(_bidder)) {
            permissionInfo[_setToken].biddersHistory.removeStorage(_bidder);
        }
    }

    /**
     * @dev Determine if passed address is allowed to call bid for the SetToken. If anyoneBid set to true anyone 
     * can call otherwise needs to be approved.
     *
     * @param _setToken             Instance of SetToken to be rebalanced
     * @param  _bidder              Address of the bidder who called contract function
     *
     * @return bool                 True if bidder is an approved bidder for the SetToken
     */
    function _isAllowedBidder(
        ISetToken _setToken, 
        address _bidder
    ) 
        internal 
        view 
        returns (bool) 
    {
        BidPermissionInfo storage permissions = permissionInfo[_setToken];
        return permissions.anyoneBid || permissions.bidAllowList[_bidder];
    }

    /**
     * @dev Returns the combination of the two arrays of AuctionExecutionParams
     * 
     * @param oldAuctionParams The first array
     * @param newAuctionParams The second array
     * @return Returns A extended by B
     */
    function _extendAuctionParams(
        AuctionExecutionParams[] memory oldAuctionParams, 
        AuctionExecutionParams[] memory newAuctionParams
    ) 
        internal 
        pure 
        returns (AuctionExecutionParams[] memory) 
    {
        uint256 aLength = oldAuctionParams.length;
        uint256 bLength = newAuctionParams.length;
        AuctionExecutionParams[] memory extendedAuctionParams = new AuctionExecutionParams[](aLength + bLength);
        for (uint256 i = 0; i < aLength; i++) {
            extendedAuctionParams[i] = oldAuctionParams[i];
        }
        for (uint256 j = 0; j < bLength; j++) {
            extendedAuctionParams[aLength + j] = newAuctionParams[j];
        }
        return extendedAuctionParams;
    }

    /**
     * @dev Gets unit and notional amount values for current position and target. These are necessary
     * to calculate the bid size and direction.
     *
     * @param _setToken                 Instance of the SetToken to rebalance
     * @param _component                IERC20 component to calculate notional amounts for
     * @param _totalSupply              SetToken total supply
     *
     * @return uint256              Current default position real unit of component
     * @return uint256              Normalized unit of the bid target
     * @return uint256              Current notional amount: total notional amount of SetToken default position
     * @return uint256              Target notional amount: Total SetToken supply * targetUnit
     */
    function _getUnitsAndNotionalAmounts(
        ISetToken _setToken, 
        IERC20 _component, 
        uint256 _totalSupply
    )
        internal
        view
        returns (uint256, uint256, uint256, uint256)
    {
        uint256 currentUnit = _getDefaultPositionRealUnit(_setToken, _component);
        uint256 targetUnit = _getNormalizedTargetUnit(_setToken, _component);

        return (
            currentUnit,
            targetUnit,
            _totalSupply.getDefaultTotalNotional(currentUnit),
            _totalSupply.preciseMulCeil(targetUnit)
        );
    }

    /**
     * @dev Gets price adapter address for a component after checking that it exists in the
     * IntegrationRegistry. This method is called during a bid and must validate the adapter
     * because its state may have changed since it was set in a separate transaction.
     *
     * @param _setToken                         Instance of the SetToken to be rebalanced
     * @param _component                        IERC20 component whose price adapter is fetched
     *
     * @return IAuctionPriceAdapter                 Adapter address
     */
    function _getAuctionPriceAdapter(
        ISetToken _setToken, 
        IERC20 _component
    ) 
        internal 
        view 
        returns(IAuctionPriceAdapterV1) 
    {
        return IAuctionPriceAdapterV1(getAndValidateAdapter(executionInfo[_setToken][_component].priceAdapterName));
    }

    /**
     * @dev Check if all targets are met.
     *
     * @param _setToken             Instance of the SetToken to be rebalanced
     *
     * @return bool                 True if all component's target units have been met, otherwise false
     */
    function _allTargetsMet(ISetToken _setToken) internal view returns (bool) {
        address[] memory rebalanceComponents = rebalanceInfo[_setToken].rebalanceComponents;

        for (uint256 i = 0; i < rebalanceComponents.length; i++) {
            if (_targetUnmet(_setToken, rebalanceComponents[i])) { return false; }
        }
        return true;
    }

    /**
     * @dev Determines if a target is met. Due to small rounding errors converting between virtual and
     * real unit on SetToken we allow for a 1 wei buffer when checking if target is met. In order to
     * avoid subtraction overflow errors targetUnits of zero check for an exact amount. WETH is not
     * checked as it is allowed to float around its target.
     *
     * @param _setToken                         Instance of the SetToken to be rebalanced
     * @param _component                        Component whose target is evaluated
     *
     * @return bool                             True if component's target units are met, false otherwise
     */
    function _targetUnmet(
        ISetToken _setToken, 
        address _component
    ) 
        internal 
        view 
        returns(bool) 
    {
        if (_component == address(weth)) return false;

        uint256 normalizedTargetUnit = _getNormalizedTargetUnit(_setToken, IERC20(_component));
        uint256 currentUnit = _getDefaultPositionRealUnit(_setToken, IERC20(_component));

        return (normalizedTargetUnit > 0)
            ? !(normalizedTargetUnit.approximatelyEquals(currentUnit, 1))
            : normalizedTargetUnit != currentUnit;
    }

    /**
     * @dev Get the SetToken's default position as uint256
     *
     * @param _setToken         Instance of the SetToken
     * @param _component        IERC20 component to fetch the default position for
     *
     * return uint256           Real unit position
     */
    function _getDefaultPositionRealUnit(
        ISetToken _setToken, 
        IERC20 _component
    ) 
        internal 
        view 
        returns (uint256) 
    {
        return _setToken.getDefaultPositionRealUnit(address(_component)).toUint256();
    }

    /**
     * @dev Calculates and returns the normalized target unit value.
     *
     * @param _setToken             Instance of the SetToken
     * @param _component            IERC20 component whose normalized target unit is required
     *
     * @return uint256                          Normalized target unit of the component
     */
    function _getNormalizedTargetUnit(
        ISetToken _setToken, 
        IERC20 _component
    ) 
        internal 
        view 
        returns(uint256) 
    {
        // (targetUnit * current position multiplier) / position multiplier when rebalance started
        return executionInfo[_setToken][_component]
            .targetUnit
            .mul(_setToken.positionMultiplier().toUint256())
            .div(rebalanceInfo[_setToken].positionMultiplier);
    }

    /* ============== Modifier Helpers ===============
     * Internal functions used to reduce bytecode size
     */

    /*
     * Bidder must be permissioned for SetToken
     */
    function _validateOnlyAllowedBidder(ISetToken _setToken) internal view {
        require(_isAllowedBidder(_setToken, msg.sender), "Address not permitted to bid");
    }
}
