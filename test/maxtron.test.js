const assert = require("node:assert/strict");
const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

const ONE_DAY = 24n * 60n * 60n;
const ONE_MONTH = 30n * ONE_DAY;
const BPS_DENOM = 10_000n;

const toNumber = (value) => Number(value);

async function deployFixture() {
  const [deployer, beneficiary] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MaxtronToken");
  const token = await Token.deploy(deployer.address);
  await token.waitForDeployment();

  const Vesting = await ethers.getContractFactory("VestingManager");
  const vesting = await Vesting.deploy(token.target);
  await vesting.waitForDeployment();

  return { deployer, beneficiary, token, vesting };
}

describe("MaxtronToken", function () {
  it("exposes metadata, ownership, and capped supply", async function () {
    const { deployer, token } = await loadFixture(deployFixture);
    const expectedSupply = ethers.parseUnits("75000000", 18);

    assert.equal(await token.owner(), deployer.address);
    assert.equal(await token.name(), "Maxtron");
    assert.equal(await token.symbol(), "MAXTRON");
    assert.equal(await token.decimals(), 18n);
    assert.equal(await token.totalSupply(), expectedSupply);
    assert.equal(await token.balanceOf(deployer.address), expectedSupply);
  });

  it("is burnable without mint or pause controls", async function () {
    const { deployer, token } = await loadFixture(deployFixture);
    const burnAmount = ethers.parseUnits("1000", 18);
    const supplyBefore = await token.totalSupply();
    expect(token.mint).to.equal(undefined);
    expect(token.pause).to.equal(undefined);
    expect(token.unpause).to.equal(undefined);

    await token.connect(deployer).burn(burnAmount);
    assert.equal(await token.totalSupply(), supplyBefore - burnAmount);
  });
});

async function configurePoolFixture() {
  const { deployer, beneficiary, token, vesting } = await loadFixture(deployFixture);

  const allocation = ethers.parseUnits("100000", 18);
  const tgePercentBps = 1000n; // 10%
  const cliffSeconds = 3n * ONE_MONTH;
  const vestingSeconds = 12n * ONE_MONTH;
  const latest = await time.latest();
  const currentTimestamp = typeof latest === "bigint" ? latest : BigInt(latest);
  const tgeTimestamp = currentTimestamp + ONE_DAY;
  const merkleRoot = ethers.solidityPackedKeccak256(
    ["address", "uint256"],
    [beneficiary.address, allocation]
  );

  await token.connect(deployer).approve(vesting.target, allocation);
  await vesting
    .connect(deployer)
    .configurePool(
      0,
      tgeTimestamp,
      cliffSeconds,
      vestingSeconds,
      tgePercentBps,
      ONE_MONTH,
      merkleRoot,
      allocation
    );
  await vesting.connect(deployer).depositForPool(0, allocation);
  await vesting.connect(deployer).finalizePool(0);

  return {
    deployer,
    beneficiary,
    token,
    vesting,
    allocation,
    tgeTimestamp,
    cliffSeconds,
    vestingSeconds,
    tgePercentBps,
    proof: [],
  };
}

describe("VestingManager", function () {
  it("allows only TGE amount before the cliff", async function () {
    const { beneficiary, vesting, allocation, tgeTimestamp, tgePercentBps, proof } =
      await loadFixture(configurePoolFixture);
    const tgeAmount = (allocation * tgePercentBps) / BPS_DENOM;

    await time.increaseTo(toNumber(tgeTimestamp - 1n));
    const vestedBeforeCliff = await vesting.vestedAmount(0, allocation);
    assert.equal(vestedBeforeCliff, 0n);
    await expect(
      vesting.connect(beneficiary).claim.staticCall(0, allocation, proof)
    ).to.be.revertedWith("nothing");

    await time.increaseTo(toNumber(tgeTimestamp));
    await vesting.connect(beneficiary).claim(0, allocation, proof);

    assert.equal(await vesting.claimed(0, beneficiary.address), tgeAmount);

    await time.increaseTo(toNumber(tgeTimestamp + ONE_MONTH));
    await expect(vesting.connect(beneficiary).claim(0, allocation, proof)).to.be.revertedWith(
      "nothing"
    );
  });

  it("releases linearly each month until allocation exhausted", async function () {
    const {
      beneficiary,
      vesting,
      token,
      allocation,
      tgeTimestamp,
      cliffSeconds,
      vestingSeconds,
      tgePercentBps,
      proof,
    } = await loadFixture(configurePoolFixture);

    const tgeAmount = (allocation * tgePercentBps) / BPS_DENOM;
    const linearTotal = allocation - tgeAmount;
    const totalSlices = (vestingSeconds - cliffSeconds) / ONE_MONTH;

    await time.increaseTo(tgeTimestamp);
    await vesting.connect(beneficiary).claim(0, allocation, proof);

    for (let slice = 1n; slice <= totalSlices; slice += 1n) {
      const targetTime = tgeTimestamp + cliffSeconds + slice * ONE_MONTH;
      await time.increaseTo(toNumber(targetTime));

      const expectedVested = tgeAmount + (linearTotal * slice) / totalSlices;
      const alreadyClaimed = await vesting.claimed(0, beneficiary.address);
      const expectedClaim = expectedVested - alreadyClaimed;

      if (expectedClaim === 0n) {
        await expect(vesting.connect(beneficiary).claim(0, allocation, proof)).to.be.revertedWith(
          "nothing"
        );
      } else {
        await vesting.connect(beneficiary).claim(0, allocation, proof);
        assert.equal(await vesting.claimed(0, beneficiary.address), expectedVested);
      }
    }

    assert.equal(await vesting.claimed(0, beneficiary.address), allocation);
    assert.equal(await token.balanceOf(vesting.target), 0n);
  });

  it("burns remaining tokens only after 365 days post vesting end", async function () {
    const { deployer, vesting, token, allocation, tgeTimestamp, vestingSeconds } =
      await loadFixture(configurePoolFixture);

    await expect(vesting.burnUnclaimed(0)).to.be.revertedWith("too early");

    const burnReady = tgeTimestamp + vestingSeconds + 365n * ONE_DAY + 1n;
    await time.increaseTo(toNumber(burnReady));

    await vesting.connect(deployer).burnUnclaimed(0);
    assert.equal(await token.balanceOf(vesting.target), 0n);
    assert.equal(await vesting.claimed(0, deployer.address), 0n);

    await expect(vesting.connect(deployer).burnUnclaimed(0)).to.be.revertedWith("already burned");
  });
});

