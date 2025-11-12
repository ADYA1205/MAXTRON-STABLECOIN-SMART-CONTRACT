const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying from:", deployer.address);

  const Token = await ethers.getContractFactory("MaxtronToken");
  const token = await Token.deploy(deployer.address);
  await token.waitForDeployment();
  console.log("Token deployed at:", token.target);

  const Vest = await ethers.getContractFactory("VestingManager");
  const vest = await Vest.deploy(token.target);
  await vest.waitForDeployment();
  console.log("Vesting contract deployed at:", vest.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});