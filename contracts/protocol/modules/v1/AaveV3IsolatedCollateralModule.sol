/*
    Copyright 2025 Index Cooperative

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

pragma solidity ^0.6.10;
pragma experimental "ABIEncoderV2";

import { IController } from "../../../interfaces/IController.sol";
import { Invoke } from "../../lib/Invoke.sol";
import { IPool } from "../../../interfaces/external/aave-v3/IPool.sol";
import { ISetToken } from "../../../interfaces/ISetToken.sol";
import { ModuleBase } from "../../lib/ModuleBase.sol";

/**
 * @title AaveV3IsolatedCollateralModule
 * @author Index Cooperative
 *
 * Module that enables SetTokens to use isolated collateral on Aave V3.
 */
contract AaveV3IsolatedCollateralModule is ModuleBase {
    using Invoke for ISetToken;

    IPool public immutable aavePool;

    /* ============ Constructor ============ */

    constructor(
        IController _controller,
        IPool _aavePool
    ) public ModuleBase(_controller) {
        aavePool = _aavePool;
    }

    /* ============ External Functions ============ */

    function initialize(
        ISetToken _setToken
    )
        external
        onlyValidAndPendingSet(_setToken)
        onlySetManager(_setToken, msg.sender)
    {
        _setToken.initializeModule();
    }

    function setUserUseReserveAsCollateral(
        ISetToken _setToken,
        address _asset,
        bool _useAsCollateral
    )
        external
        onlyManagerAndValidSet(_setToken)
    {
        require(_setToken.isComponent(_asset), "Must be component");
        bytes memory callData = abi.encodeWithSignature(
            "setUserUseReserveAsCollateral(address,bool)",
            _asset,
            _useAsCollateral
        );
        _setToken.invoke(address(aavePool), 0, callData);
    }

    function removeModule() external override {}
}
