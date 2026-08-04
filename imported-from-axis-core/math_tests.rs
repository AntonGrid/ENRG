use enrg_mvp::math::*;

#[test]
fn emission_share_zero_supply() {
    assert_eq!(
        emission_share(0),
        0.0
    );
}

#[test]
fn emission_share_half_supply() {
    assert_eq!(
        emission_share(500_000_000),
        0.5
    );
}

#[test]
fn emission_share_full_supply() {
    assert_eq!(
        emission_share(1_000_000_000),
        1.0
    );
}

#[test]
fn energy_per_src_increases() {

    let e0 = energy_per_src(0);

    let e50 =
        energy_per_src(500_000_000);

    let e90 =
        energy_per_src(900_000_000);

    assert!(e50 > e0);
    assert!(e90 > e50);
}

#[test]
fn reward_decreases_as_supply_grows() {

    let reward0 =
        calculate_reward(
            10_000_000,
            0,
        );

    let reward50 =
        calculate_reward(
            10_000_000,
            500_000_000,
        );

    let reward90 =
        calculate_reward(
            10_000_000,
            900_000_000,
        );

    assert!(reward0 > reward50);
    assert!(reward50 > reward90);
}

#[test]
fn zero_energy_produces_zero_reward() {

    assert_eq!(
        calculate_reward(
            0,
            0,
        ),
        0,
    );
}
