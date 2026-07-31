"""
Extended tokenomics tests — mock level (no Solana needed).

Covers critical logic not yet in test_mainnet_critical.py:
  1. claimRewards        — linear reward accrual + no double-claim
  2. verifyMerkleProof   — Merkle proof for device blacklist
  3. founderVesting      — linear unlock over time
  4. createPool / joinPool — liquidity pools + LP share
"""

import hashlib
from typing import List, Optional, Tuple


# ──────────────────────────────────────────────
#  1.  claimRewards  (linear formula)
# ──────────────────────────────────────────────

SECONDS_IN_YEAR = 365 * 24 * 3600


class MockStake:
    def __init__(self, staked_amount: int = 0):
        self.staked_amount = staked_amount
        self.reward_debt = 0          # rewards already claimed
        self.last_update_ts = 0


class MockPool:
    def __init__(self, reward_rate: float = 0.05):
        self.reward_rate = reward_rate  # 5% annual


def accrue_rewards(stake: MockStake, pool: MockPool, now_ts: int) -> int:
    """
    Linear reward accrual:
      rewards = staked_amount * reward_rate * (delta / seconds_in_year)
    Returns total accrued rewards since last accrual.
    """
    delta = max(now_ts - stake.last_update_ts, 0)
    return stake.staked_amount * pool.reward_rate * (delta / SECONDS_IN_YEAR)


def claim_rewards(stake: MockStake, pool: MockPool, now_ts: int) -> int:
    """
    Claim and reset accrual. Returns the amount sent to the user.
    Ensures no double-claim via reward_debt.
    """
    accrued = int(accrue_rewards(stake, pool, now_ts))
    claimable = accrued - stake.reward_debt
    if claimable <= 0:
        return 0
    stake.reward_debt = accrued
    stake.last_update_ts = now_ts
    return claimable


def test_claim_rewards_linear_accrual():
    """1 year staking at 5% APY yields exactly 5% of principal."""
    stake = MockStake(staked_amount=10_000_000_000)  # 10k SRC
    pool = MockPool(reward_rate=0.05)
    stake.last_update_ts = 1_700_000_000
    now = stake.last_update_ts + SECONDS_IN_YEAR  # exactly 1 year later

    rewards = claim_rewards(stake, pool, now)
    expected = int(10_000_000_000 * 0.05)
    assert rewards == expected, f"Expected {expected}, got {rewards}"
    print(f"✅ claimRewards: {rewards} SRC after 1yr @5%")


def test_claim_rewards_no_double_claim():
    """Claiming twice at the same timestamp must only pay once."""
    stake = MockStake(staked_amount=5_000_000_000)
    pool = MockPool(reward_rate=0.05)
    stake.last_update_ts = 1_700_000_000
    now = stake.last_update_ts + 365 * 24 * 3600

    first = claim_rewards(stake, pool, now)
    second = claim_rewards(stake, pool, now)  # same ts, nothing new accrued
    assert first > 0, "First claim must pay"
    assert second == 0, "Second claim at same ts must be zero"
    print("✅ claimRewards: no double-claim (second=0)")


def test_claim_rewards_zero_stake():
    """Zero stake must yield zero rewards."""
    stake = MockStake(staked_amount=0)
    pool = MockPool()
    stake.last_update_ts = 1_700_000_000
    now = stake.last_update_ts + SECONDS_IN_YEAR

    rewards = claim_rewards(stake, pool, now)
    assert rewards == 0, "Zero stake must give zero rewards"
    print("✅ claimRewards: zero stake → zero rewards")


# ──────────────────────────────────────────────
#  2.  verifyMerkleProof  (SML blacklist proof)
# ──────────────────────────────────────────────

def sha256(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


def merkle_leaf(device_id: str, nonce: str) -> bytes:
    return sha256(f"{device_id}:{nonce}".encode())


def merkle_root(leaves: List[bytes]) -> Optional[bytes]:
    """Standard binary Merkle root (duplicate last node if odd)."""
    if not leaves:
        return None
    level = list(leaves)
    while len(level) > 1:
        if len(level) % 2 == 1:
            level.append(level[-1])
        level = [sha256(level[i] + level[i + 1]) for i in range(0, len(level), 2)]
    return level[0]


def verify_merkle_proof(
    leaf_index: int,
    leaf: bytes,
    proof: List[Tuple[bytes, str]],  # (sibling_hash, "left"|"right")
    root: bytes,
    leaf_count: int,
) -> bool:
    """
    Verify a Merkle proof.
    proof is a list of (sibling_hash, position) where position is
    whether the sibling is on the 'left' or 'right' of the current node.
    leaf_index is the 0-based index of the leaf in the original tree.
    """
    idx = leaf_index
    current = leaf
    siblings = list(proof)
    count = leaf_count

    for sibling_hash, pos in siblings:
        if idx % 2 == 0 and idx + 1 < count:
            expected_pos = "right"
        else:
            expected_pos = "left"
        if pos != expected_pos:
            return False
        if pos == "left":
            current = sha256(sibling_hash + current)
        else:
            current = sha256(current + sibling_hash)
        idx //= 2
        count = (count + 1) // 2

    return current == root


def test_verify_merkle_proof_valid_device():
    """A device present in the SML must verify successfully."""
    devices = [
        merkle_leaf("dev_solar_01", "n1"),
        merkle_leaf("dev_wind_02", "n2"),
        merkle_leaf("dev_solar_03", "n3"),
    ]
    root = merkle_root(devices)

    d0, d1, d2 = devices
    d3 = d2  # odd-level duplicate
    h01 = sha256(d0 + d1)
    h23 = sha256(d2 + d3)
    assert sha256(h01 + h23) == root

    # proof for leaf idx=1: sibling d0 is LEFT; sibling h23 is RIGHT
    proof = [(d0, "left"), (h23, "right")]
    assert verify_merkle_proof(1, d1, proof, root, leaf_count=3) is True
    print("✅ verifyMerkleProof: valid device verified")


def test_verify_merkle_proof_tampered_root():
    """Tampered root must fail verification."""
    devices = [
        merkle_leaf("dev_solar_01", "n1"),
        merkle_leaf("dev_wind_02", "n2"),
        merkle_leaf("dev_solar_03", "n3"),
    ]
    root = merkle_root(devices)
    bad_root = sha256(b"evil-root")

    d0 = merkle_leaf("dev_solar_01", "n1")
    d1 = merkle_leaf("dev_wind_02", "n2")
    d2 = merkle_leaf("dev_solar_03", "n3")
    d3 = d2
    h23 = sha256(d2 + d3)
    proof = [(d0, "left"), (h23, "right")]

    assert verify_merkle_proof(1, d1, proof, bad_root, leaf_count=3) is False
    print("✅ verifyMerkleProof: tampered root rejected")


def test_verify_merkle_proof_wrong_sibling():
    """Wrong sibling hash must fail verification."""
    devices = [
        merkle_leaf("dev_solar_01", "n1"),
        merkle_leaf("dev_wind_02", "n2"),
        merkle_leaf("dev_solar_03", "n3"),
    ]
    root = merkle_root(devices)

    d0 = merkle_leaf("dev_solar_01", "n1")
    d1 = merkle_leaf("dev_wind_02", "n2")
    d2 = merkle_leaf("dev_solar_03", "n3")
    d3 = d2
    h23 = sha256(d2 + d3)

    # Wrong sibling: use d2 instead of d0 (real left sibling is d0)
    bad_proof = [(d2, "left"), (h23, "right")]
    assert verify_merkle_proof(1, d1, bad_proof, root, leaf_count=3) is False
    print("✅ verifyMerkleProof: wrong sibling rejected")


# ──────────────────────────────────────────────
#  3.  founderVesting / claimVested
# ──────────────────────────────────────────────


class MockVestingAccount:
    def __init__(self, total_amount: int, start_ts: int, duration_seconds: int):
        self.total_amount = total_amount
        self.start_ts = start_ts
        self.duration_seconds = duration_seconds
        self.claimed = 0


def vested_amount(vest: MockVestingAccount, now_ts: int) -> int:
    """Linear unlock, capped at total_amount."""
    if now_ts <= vest.start_ts:
        return 0
    elapsed = now_ts - vest.start_ts
    if elapsed >= vest.duration_seconds:
        return vest.total_amount
    return int(vest.total_amount * (elapsed / vest.duration_seconds))


def claim_vested(vest: MockVestingAccount, now_ts: int) -> int:
    """Claim all currently vested (linear). Returns newly claimable delta."""
    vested = vested_amount(vest, now_ts)
    claimable = vested - vest.claimed
    if claimable <= 0:
        return 0
    vest.claimed += claimable
    return claimable


def test_vesting_linear_unlock_midpoint():
    """At halfway, half of the tokens are vested."""
    vest = MockVestingAccount(total_amount=100_000_000, start_ts=1_700_000_000,
                              duration_seconds=2 * SECONDS_IN_YEAR)
    halfway = vest.start_ts + vest.duration_seconds // 2
    assert vested_amount(vest, halfway) == 50_000_000
    print("✅ vesting: midpoint unlocks 50%")


def test_vesting_claim_delta_no_double_claim():
    """Claiming progressively returns only the delta, and caps at total."""
    vest = MockVestingAccount(total_amount=100_000_000, start_ts=1_700_000_000,
                              duration_seconds=2 * SECONDS_IN_YEAR)

    quarter = vest.start_ts + vest.duration_seconds // 4
    c1 = claim_vested(vest, quarter)
    assert c1 > 0 and c1 < 100_000_000

    halfway = vest.start_ts + vest.duration_seconds // 2
    c2 = claim_vested(vest, halfway)
    assert c2 == c1, "Halfway delta must equal quarter delta (linear)"

    end = vest.start_ts + vest.duration_seconds + 10
    c3 = claim_vested(vest, end)
    assert vest.claimed == 100_000_000, "Must cap at total"
    assert c3 == 100_000_000 - 2 * c1
    print(f"✅ vesting: progressive claim deltas {c1}/{c2}/{c3} cap at total")


def test_vesting_no_claim_before_start():
    """Nothing is vested before start time."""
    vest = MockVestingAccount(total_amount=100_000_000, start_ts=1_700_000_000,
                              duration_seconds=2 * SECONDS_IN_YEAR)
    before = vest.start_ts - 1000
    assert vested_amount(vest, before) == 0
    assert claim_vested(vest, before) == 0
    print("✅ vesting: no claim before start")


# ──────────────────────────────────────────────
#  4.  createPool / joinPool
# ──────────────────────────────────────────────


class MockLiquidityPool:
    def __init__(self, src_reserve: int, token_reserve: int):
        self.src_reserve = src_reserve
        self.token_reserve = token_reserve
        self.lp_total = int(src_reserve ** 0.5)  # simple proportional metric

    def join(self, src_amount: int, token_amount: int) -> int:
        """Join pool, mint LP share proportional to existing reserves."""
        if self.lp_total == 0:
            share = int((src_amount * token_amount) ** 0.5)
        else:
            ratio = min(src_amount / self.src_reserve, token_amount / self.token_reserve)
            share = int(ratio * self.lp_total)
        self.src_reserve += src_amount
        self.token_reserve += token_amount
        self.lp_total += share
        return share


def test_create_pool_initial():
    """Creating a pool establishes reserves and initial LP."""
    pool = MockLiquidityPool(1_000_000_000, 2_000_000_000)
    assert pool.src_reserve == 1_000_000_000
    assert pool.token_reserve == 2_000_000_000
    assert pool.lp_total > 0
    print(f"✅ createPool: SRC={pool.src_reserve} TOKEN={pool.token_reserve} LP={pool.lp_total}")


def test_join_pool_increases_reserves():
    """Joining adds liquidity and mints LP proportional to share."""
    pool = MockLiquidityPool(1_000_000_000, 2_000_000_000)
    initial_lp = pool.lp_total

    share = pool.join(1_000_000_000, 2_000_000_000)  # 1:1 ratio
    assert pool.src_reserve == 2_000_000_000
    assert pool.token_reserve == 4_000_000_000
    assert share > 0
    assert pool.lp_total == initial_lp + share
    print(f"✅ joinPool: LP allocated {share}, reserves doubled")


if __name__ == "__main__":
    test_claim_rewards_linear_accrual()
    test_claim_rewards_no_double_claim()
    test_claim_rewards_zero_stake()
    test_verify_merkle_proof_valid_device()
    test_verify_merkle_proof_tampered_root()
    test_verify_merkle_proof_wrong_sibling()
    test_vesting_linear_unlock_midpoint()
    test_vesting_claim_delta_no_double_claim()
    test_vesting_no_claim_before_start()
    test_create_pool_initial()
    test_join_pool_increases_reserves()
    print("\nAll extended tokenomics checks passed.")
