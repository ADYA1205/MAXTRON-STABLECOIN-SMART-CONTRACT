require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-network-helpers");

/** @type import("hardhat/config").HardhatUserConfig */
const config = {
  solidity: "0.8.24",
  defaultNetwork: "hardhat",
};

module.exports = config;

