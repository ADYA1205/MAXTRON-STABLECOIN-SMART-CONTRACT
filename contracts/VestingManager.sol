// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract VestingManager is Ownable {
    struct Pool {
        uint40 tgeTimestamp;
        uint40 cliffSeconds;
        uint40 vestingSeconds;
        uint16 tgePercentBps;
        uint40 monthlySliceSeconds;
        bytes32 merkleRoot;
        uint256 totalAllocation;
        uint256 totalClaimed;
        bool finalized;
        uint40 vestingEndTimestamp;
        bool burnPerformed;
    }

    IERC20 public immutable token;
    mapping(uint256 => Pool) public pools;
    mapping(uint256 => mapping(address => uint256)) public claimed;

    uint256 public constant BPS_DENOM = 10_000;
    uint256 public constant DAYS_365 = 365 days;

    event PoolConfigured(uint256 indexed poolId, bytes32 merkleRoot, uint256 totalAllocation);
    event PoolFinalized(uint256 indexed poolId);
    event Deposited(uint256 indexed poolId, uint256 amount);
    event Claimed(uint256 indexed poolId, address indexed account, uint256 amount);
    event UnclaimedBurned(uint256 indexed poolId, uint256 amount);

    constructor(address tokenAddress) Ownable(msg.sender) {
        require(tokenAddress != address(0), "token=0");
        token = IERC20(tokenAddress);
    }

    function configurePool(
        uint256 poolId,
        uint40 tgeTimestamp,
        uint40 cliffSeconds,
        uint40 vestingSeconds,
        uint16 tgePercentBps,
        uint40 monthlySliceSeconds,
        bytes32 merkleRoot,
        uint256 totalAllocation
    ) external onlyOwner {
        Pool storage p = pools[poolId];
        require(!p.finalized, "pool finalized");
        p.tgeTimestamp = tgeTimestamp;
        p.cliffSeconds = cliffSeconds;
        p.vestingSeconds = vestingSeconds;
        p.tgePercentBps = tgePercentBps;
        p.monthlySliceSeconds = monthlySliceSeconds;
        p.merkleRoot = merkleRoot;
        p.totalAllocation = totalAllocation;
        p.vestingEndTimestamp = tgeTimestamp + vestingSeconds;
        emit PoolConfigured(poolId, merkleRoot, totalAllocation);
    }

    function depositForPool(uint256 poolId, uint256 amount) external onlyOwner {
        require(token.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        emit Deposited(poolId, amount);
    }

    function finalizePool(uint256 poolId) external onlyOwner {
        Pool storage p = pools[poolId];
        require(p.merkleRoot != bytes32(0), "not set");
        p.finalized = true;
        emit PoolFinalized(poolId);
    }

    function claim(uint256 poolId, uint256 allocation, bytes32[] calldata merkleProof) external {
        Pool storage p = pools[poolId];
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, allocation));
        require(MerkleProof.verify(merkleProof, p.merkleRoot, leaf), "invalid proof");
        uint256 vested = vestedAmount(poolId, allocation);
        uint256 prev = claimed[poolId][msg.sender];
        require(vested > prev, "nothing");
        uint256 due = vested - prev;
        claimed[poolId][msg.sender] = vested;
        p.totalClaimed += due;
        require(token.transfer(msg.sender, due), "transfer failed");
        emit Claimed(poolId, msg.sender, due);
    }

    function vestedAmount(uint256 poolId, uint256 allocation) public view returns (uint256) {
        Pool memory p = pools[poolId];
        if (block.timestamp < p.tgeTimestamp) return 0;
        uint256 tgeAmt = (allocation * p.tgePercentBps) / BPS_DENOM;
        if (block.timestamp >= p.vestingEndTimestamp) return allocation;
        uint256 elapsed = block.timestamp - p.tgeTimestamp;
        if (elapsed <= p.cliffSeconds) return tgeAmt;
        uint256 linearTotal = allocation - tgeAmt;
        uint256 linearDuration = p.vestingSeconds - p.cliffSeconds;
        uint256 linearElapsed = elapsed - p.cliffSeconds;
        uint256 slices = p.monthlySliceSeconds > 0 ? (linearElapsed / p.monthlySliceSeconds) : 0;
        uint256 totalSlices = p.monthlySliceSeconds > 0 ? (linearDuration / p.monthlySliceSeconds) : 1;
        uint256 unlocked = (linearTotal * slices) / totalSlices;
        return tgeAmt + unlocked;
    }

    function burnUnclaimed(uint256 poolId) external {
        Pool storage p = pools[poolId];
        require(block.timestamp > p.vestingEndTimestamp + DAYS_365, "too early");
        require(!p.burnPerformed, "already burned");
        uint256 remaining = p.totalAllocation > p.totalClaimed ? p.totalAllocation - p.totalClaimed : 0;
        if (remaining > 0) {
            (bool ok, ) = address(token).call(abi.encodeWithSignature("burn(uint256)", remaining));
            require(ok, "burn failed");
            emit UnclaimedBurned(poolId, remaining);
        }
        p.burnPerformed = true;
    }
}