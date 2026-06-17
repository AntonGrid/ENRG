ENRG Protocol Master Technical Specification v7.1.pdf

1. Executive Summary

ENRG Protocol — децентрализованный протокол верификации и расчётов за энергию. Протокол опирается на концепцию Proof-of-Production — криптографическое доказательство генерации энергии, получаемое от IoT- устройств. Ключевая инновация — асимптотическая модель эмиссии, при которой сложность добычи токенов растёт экспоненциально, что гарантирует вечный дефицит.

## 1.1 High-level architecture diagram

2. Mission and Vision

Миссия ENRG — создать открытый, программируемый и децентрализованный рынок энергии, доступный любому производителю вне зависимости от масштаба.

## 2.1 Value proposition matrix

| Аудитория | Боль сейчас | Что даёт ENRG |
|-----------|-------------|----------------|
| Домохозяйства | Нет прямого выхода на рынок | P2P-продажа энергии и токенизация |
| Малые производители | Зависимость от монополий | Прямой доступ к глобальному рынку |
| Промышленные игроки | Сложная отчётность | Верифицируемые данные о генерации |
| Инвесторы | Непрозрачность зелёных проектов | Ончейн-метрики, дефицитная эмиссия |

3. Energy Market Problem Текущий рынок энергии (~8 трлн) контролируется централизованными компаниями. Малые производители не имеют прямого доступа.

## 3.1 Problem landscape diagram

## 4. Protocol Overview

ENRG — DePIN-протокол на Solana. Связывает физическое устройство с очнейн-токеном через криптоконвейер.

## 4.1 End-to-end flow (sequence diagram)

## 5. Four Layer Architecture

## 5.1 Layer overview table

6. Device Layer

| Уровень | Описание | Технологии |
|---------|----------|-------------|
| Device Layer | Измерение и подпись данных | ESP32, PZEM-004T, Siemens |
| Oracle Layer | Валидация, агрегация | Node.js, Switchboard |
| ENRG Core | Минт, стейкинг, казначейство | Solana, Rust, Anchor |
| ENRG Market | P2P-торговля, деривативы, углеродные кредиты | DEX, API |

## 6. Device Layer

### 6.1 Device trust levels

| Уровень | Оборудование | Лимит майнинга |
|---------|--------------|----------------|
| Basic | ESP32 + PZEM | до 100 kWh/мес |
| Verified | Сертифицированный счётчик | до 10 MWh/мес |
| Industrial | Siemens, ABB | без ограничений |
| Institutional | Энергокомпании | без ограничений |

### 6.2 Схема устройства

7. Oracle Layer 7.1 Oracle pipeline diagram

## 7. Oracle Layer

## 7.1 Oracle pipeline diagram

## 8. ENRG Core Architecture

## 8.1 Program interaction diagram (CPI)

9. Current Smart Contract Components

Инструкции: initialize_vault initialize_fund create_produced mint_energy buyback_and_burn stake_unstake claim_reward

## 9.1 Instruction overview table

| Инструкция | Назначение | Ключевые проверки |
|------------|------------|-------------------|
| initialize_vault | Создание Vault PDA | seeds, authority |
| mint_energy | Минт по Proof | nonce, timestamp, лимиты |
| buyback_and_burn | Сжигание токенов | баланс buyback |
| stake/unstake | Стейкинг | владение аккаунтом |

## 10. Producer Account Model

Хранит: authority, device_id, nonce, energy_wh, timestamp, max_power_w, signature, is_initialized.

## 10.1 Producer state diagram

11. Vault Architecture 11.1 Vault & Treasury diagram

## 11. Vault Architecture

## 11.1 Vault & Treasury diagram

## 12. Mint Energy Flow

1. Оракул вызывает
2. Проверка authority, nonce, timestamp (≤15 мин).
3. Вычисление max_energy_wh = max_power_w * 10 / 60.
4. total_mint = energy_wh * ENRG_BASIS.
5. Распределение комиссии: 20% buyback, 40% стейкинг, 30% DAO, 10% emergency.
6. CPI mint_to распределяет токены.

13. Proof of Production Устройство подписывает пакет Ed25519, оракул проверяет и вызывает mint_energy.

## 13.1 PoP pipeline

## 14. Pool Architecture

14.1 Pool distribution diagram

## 16. Energy Reputation Score (ERS)

## 16.1 ERS factor diagram

## 17. Token Design

18. Tokenomics

15% комиссии минта распределяются: 20% buyback, 40% стейкинг, 30% DAO, 10% emergency.

## 18.1 Tokenomics breakdown table

| Поток | Доля от комиссии | Доля от общего минта |
|-------|------------------|----------------------|
| Производитель | — | 85% |
| Buyback & Burn | 20% | 3% |
| Staking Pool | 40% | 6% |
| DAO Treasury | 30% | 4.5% |
| Emergency Fund | 10% | 1.5% |

## 18.2 Tokenomics pie chart

23. Emission Mathematics

E(S) = 1 МВт·ч × k^S, где S — доля добытых токенов.

## 23.1 Emission table (k=10)

| Доля (S) | МВт·ч за 1 ENRG |
|----------|------------------|
| 0% | 1 |
| 25% | 1.78 |
| 50% | 10 |
| 75% | 178 |
| 90% | 1000 |
| 99% | 10000 |

## 23.2 Emission curve (log scale)

## 25. Threat Model (STRIDE)

25.1 STRIDE table

| Категория | Угроза | Митигация |
|-----------|--------|------------|
| Spoofing | Подмена устройства | Ed25519, ATECC608 |
| Tampering | Изменение данных | Подпись пакета |
| Repudiation | Отказ от действий | nonce, timestamp, лог |
| Information Disclosure | Утечка данных | Минимизация on-chain |
| Denial of Service | Перегрузка | rate limiting |
| Elevation of Privilege | Захват контроля | PDA, проверки auth |

## 26. Security Architecture

### 26.1 Security layers diagram

## 27. Anti-Fraud Framework

## 27.1 Fraud detection examples

| Аномалия | Пример | Реакция |
|----------|--------|---------|
| Постоянная мощность ночью | 5 кВт 24/7 | Снижение ERS, проверка |
| Резкий скачок | x10 за 1 час | Блокировка минта |
| Несогласованность с погодой | Солнечная генерация в грозу | Доп. проверка |

30.1 Market flow diagram

## 31. Carbon Credits Vision

Каждый верифицированный ENRG, полученный за зелёную энергию, может быть конвертирован в углеродный кредит.

## 32. API Specification

•  — принять подписанный пакет.
•  — статус устройства.
•  — статистика пула.

## 35. PDA Architecture Concept

## 35.1 PDA table

| Аккаунт | Seeds |
|---------|-------|
| vault | ["vault"] |
| buyback | ["buyback", mint] |

36. Scaling Strategy

## 36.1 Scaling diagram

## 37. KPI Framework

## 37.1 KPI table

39. Roadmap 2026-2030

## 39.1 Roadmap Gantt

## 40. Long-Term Vision

ENRG становится глобальным расчётным слоем для энергетического рынка, обеспечивая прозрачность, дефицит и справедливое вознаграждение для каждого производителя энергии.