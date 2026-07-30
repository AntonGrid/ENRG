# ADR-0009: Governance Model for ENRG Protocol

Status: Draft  
Date: 2026-07-17  
Authors: ENRG Protocol Team (draft by @AntonGrid / AI-architect)  
Related: ADR-0007, ADR-0008, README.md, docs/README.md

## Контекст / Background

ENRG — децентрализованный протокол с критичными on‑chain и off‑chain компонентами (root keys, registries, programs, oracle). Governance определяет, как принимаются решения, кто и с какими правами может менять параметры протокола, управлять root‑ключами и инициировать серьёзные изменения (migration, new features).

Модель должна обеспечить:
- Безопасность операций критичного уровня (root‑key rotation, emergency actions).
- Достаточную децентрализацию и представительность для параметрических изменений.
- Predictable, auditable, and reversible flows (timelocks, multisig, fallbacks).
- Процесс добавления features и перехода на новые протоколные уровни с rehearsals и testnet‑stage.

## Решение (Decision)

Гибридная модель governance, сочетающая on‑chain голосование для параметрических изменений и off‑chain/threshold multisig (Guardians) для критичных срочных операций.

Компоненты:
1. Token holders governance (On‑chain voting)
   - Используется для изменения экономических и поведенческих параметров (fees, slashing thresholds, timelocks, upgrade policies), а также для принятия новых RFC/ADR по функциональным изменениям.
   - Голосование — предложить → депозит → обсуждение → голосование (время голосования configurable) → результат при достижении quorum и порога.
2. Guardians multisig (Off‑chain / on‑chain-backed)
   - Набор доверенных участников (на старте: core maintainers / infrastructure operators / major stakeholders) управляющий экстренными операциями: root key rotation, emergency freezes, emergency anchors.
   - Multisig threshold (например, 5 of 7) — конфигурируемо, отражено в on‑chain contract/registry.
   - Guardians могут инициировать экстренные действия с кратким timelock (emergency flow) или с обычным timelock (safer flow).
3. Timelocks & Escrow
   - Все критичные изменения (например, upgrade contracts, root key rotations) подлежат timelock (например, 48–72 hours) перед исполнением, за исключением emergency flow (с более строгим кворумом и последующим аудитом).
4. Proposal lifecycle & RFC/ADR process
   - Changes start как ADR/RFC in docs/rfc.
   - For protocol‑level changes, a formal proposal containing tests, upgrade plan, and migration scripts must be submitted.
   - Proposals are subject to acceptance criteria and automated test suites (on testnet) before being scheduled for on‑chain vote or Guardian action.
5. Role definitions
   - Token holders: голосуют за параметры, long‑term direction.
   - Guardians: управляют emergency ops; обладают multisig keys; обязаны публиковать signed justification for emergency actions.
   - Maintainers/Core devs: prepare code, tests, PRs, and run rehearsals on testnet.
   - Auditors: external parties that review security‑critical changes.
6. Root Key Management
   - Root keys (Root Key Registry) — критичные артефакты; управление через Guardians multisig with on‑chain anchoring.
   - Routine rotations scheduled via governance proposals; emergency rotations can be executed by Guardians with higher threshold plus post‑action community review.
   - All root key changes are logged, anchor published on‑chain and must include signed rotation manifest and rollover plan.

### Voting mechanics (on‑chain)

- Proposal submission:
  - Proposer posts proposal contract with metadata and deposit (to avoid spam).
  - Voting period: configurable (default 7 days).
- Voting power:
  - Token‑weighted voting: user voting_power = snapshot(token_balance, block_at_proposal_start).
  - Delegation allowed (optional).
- Quorum:
  - Minimum participation threshold (e.g., 10% of circulating voting power) required for result to be valid.
- Thresholds:
  - Simple parameter changes: >50% of votes cast in favor and quorum satisfied.
  - Critical changes (e.g., change timelock, enable protocol upgrade): supermajority (e.g., 66%+).
  - Emergency operations are not handled via regular on‑chain voting but via Guardians.
- Execution:
  - If proposal passes, change is scheduled and executed after timelock (unless proposal explicitly requests immediate execution with higher quorum).
- Rejection & Appeals:
  - Failed proposals are archived. A re-proposal can be submitted after cooling period.

### Governance of Protocol Upgrades & Feature Additions

- Feature lifecycle:
  1. RFC/ADR authored and published (docs/rfc + ADR).
  2. Implementation in feature branch + test suites.
  3. Rehearsal on testnet (smoke tests, backward compatibility tests).
  4. Deployment plan (migration scripts, data migration, rollback plan).
  5. Governance proposal (on‑chain) to enable/accept the feature.
  6. Voting & timelock → execution.
- Backward compatibility:
  - Major version changes must include compatibility matrix and migration plan.
  - Soft‑fork style changes preferred where feasible; hard forks must have explicit migration procedure and community coordination.

### Emergency procedures

- Guardians may:
  - Execute emergency root key rotation (threshold e.g., 6-of-8).
  - Pause certain on‑chain operations (contract pause) for a limited window.
  - Publish signed justification and timeline and open emergency governance review.
- Post‑emergency:
  - Mandatory post‑mortem and community audit.
  - Possibility of on‑chain ratification/rollback via token holder vote.

## Rationale

- Hybrid model даёт баланс: on‑chain votes обеспечивают широту участия, multisig Guardians дают скорость и оперативность в критических ситуациях.
- Timelocks поддерживают прозрачность и дают время для обнаружения злоупотреблений.
- RFC/ADR + testnet rehearsal минимизируют риск ошибочных upgrades.

## Последствия (Consequences)

- Initial Guardian selection и threshold определяют степень централизма на старте; нужно планировать постепенную декентрализацию.
- Timelocks означают задержку в применении изменений; для срочных исправлений необходимы emergency flows.
- Governance требует инфраструктуры: contracts, snapshotting, voting UI, audit trails.

## Acceptance criteria (MUST)

1. ADR‑0009 добавлен в docs/architecture и утверждён как Draft.
2. Governance contracts (proposal, voting, timelock, multisig registry) — reference implementation и тесты.
3. Documented process for Guardian selection, rotation and accountability.
4. Root Key rotation workflow implemented as executable playbook and automated scripts for anchor/rollover.
5. RFC/ADR → testnet rehearsal → governance proposal checklist exists and CI validates base acceptance tests.

## Open questions

- Модель голосования: token‑weighted vs one‑entity‑one‑vote (предпочтение: token‑weighted, но обсудить).
- Guardian composition and onboarding criteria (stakeholder categories, vetting).
- Deposit size and spam protection economics for proposals.

## Implementation tasks / next steps

- Implement governance smart contracts (proposal, voting, timelock) with tests.
- Implement Guardian multisig registry and onboarding process (KYC/POA off‑chain notes).
- Build governance UI and snapshot mechanism.
- Draft and run testnet rehearsal for a non‑critical feature upgrade and for emergency rotation playbook.

Appendix: Example thresholds (initial recommendations)
- Guardians multisig threshold: 5 of 7
- Timelock for executed proposals: 48 hours (configurable)
- Voting period: 7 days
- Quorum: 10% circulating voting power
- Supermajority for critical changes: 66%
