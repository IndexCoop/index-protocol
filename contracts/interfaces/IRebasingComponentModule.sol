/*
    Copyright 2024 Index Cooperative

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

import { ISetToken } from "./ISetToken.sol";

/**
 * @title IRebasingComponentModule
 * @author Index Cooperative
 *
 * Interface for interacting with RebasingComponentModule
 */
interface IRebasingComponentModule {
    /**
     * Sync Set positions with ALL enabled rebasing component positions.
     *
     * @param _setToken    Instance of the SetToken
     */
    function sync(ISetToken _setToken) external;
}
