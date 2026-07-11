# ENRG Smart Contract v2 Tasks

Status: Active

Related:

- CONTRACT_V2_ROADMAP.md
- ENRG Protocol Specification

---

# Critical

## C-001

Replace temporary Ed25519 verification.

Current:

Signature verification is stubbed.

Target:

Implement complete Ed25519 verification.

Status:

OPEN

---

## C-002

Replace asymptotic emission model.

Current:

Dynamic emission.

Target:

1 MWh = 1 SRC.

Status:

OPEN

---

## C-003

Synchronize contract with Protocol Specification.

Status:

OPEN

---

# High Priority

## H-001

Remove obsolete emission functions.

- calculate_energy_per_token()
- exp_approx()

Status:

OPEN

---

## H-002

Replace obsolete events.

Current:

EmissionDifficultyChanged

Target:

- ProofAccepted
- EnergyMinted

Status:

OPEN

---

## H-003

Remove obsolete ErrorCode variants.

Current:

- InvalidParameter
- ExcessiveEnergyRequired
- InsufficientEnergy

Status:

OPEN

---

## H-004

Replace magic numbers with named constants.

Examples:

- 900
- 10
- 60
- 31_536_000
- 94_608_000

Status:

OPEN

---

## H-005

Review PDA constraints.

Review:

- Vault
- Producer
- Staking
- Founder Vesting

Status:

OPEN

---

# Medium Priority

## M-001

Reduce duplicated mint_to() logic.

Status:

OPEN

---

## M-002

Review Vault roles.

Current:

- deployer
- authority

Determine whether both fields are required.

Status:

OPEN

---

## M-003

Review Pool architecture.

Current implementation stores producer list inside Pool.

Evaluate scalability.

Status:

OPEN

---

## M-004

Remove Anchor template remnants.

Includes:

- initialize.rs
- initialize_funds()
- obsolete constants

Status:

OPEN

---

## M-005

Split lib.rs into modules.

Target:

src/
    instructions/
    state/
    events.rs
    errors.rs
    constants.rs
    utils.rs

Status:

PLANNED

---

# Low Priority

## L-001

Improve logging.

Replace msg! where appropriate with protocol events.

Status:

PLANNED

---

## L-002

Review account size allocation.

Status:

PLANNED

---

## L-003

General code cleanup.

Status:

PLANNED

---

# Completion Rule

Each completed task SHALL:

- compile successfully;
- pass tests;
- remain protocol compliant;
- be committed separately.
