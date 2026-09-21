# ENRG — Competitive Landscape (DePIN on Solana)

> **Status:** Active (2026-09-18)
> **Purpose:** who ENRG competes with, in which ring, and on what evidence.
> **Rule:** `docs/POSITIONING.md` remains the single source of truth for how we
> describe ENRG. This document supplies the *market* facts behind its section 7
> and MUST NOT introduce alternative positioning.
> **Snapshot discipline:** every third-party status below was read on
> **2026-09-18** and is a dated fact, not a permanent truth. Refresh per
> section 9 before any pitch, grant or deck.

---

## 1. What "competitor" means here (four rings)

| Ring | Definition | Who decides the deal |
|---|---|---|
| **1 — Direct** | Energy DePIN / energy-data verification with physical hardware on Solana | The operator or asset owner choosing whose hardware + data layer to run |
| **2 — Trust layer** | Oracle & attestation providers on Solana | Grant committees and L1 ecosystem teams (one "oracle / verification infra" budget) |
| **3 — Adjacent DePIN** | Non-energy DePIN on Solana (compute, wireless, mapping, sensing) | Attention, capital and builder talent; they set the DePIN "scoreboard" |
| **4 — Off-chain / off-Solana** | Energy Web, Power Ledger, Daylight, registries, ESG/MRV firms | The first pilot and the customer's budget |

ENRG must win **Ring 1** on trust architecture, and be *visibly distinct* in Ring 2.

---

## 2. Sources and method

| Source | Snapshot (2026-09-18) | What it measures |
|---|---|---|
| Colosseum Copilot API (`copilot.colosseum.com/api/v1`) | 5 400+ Solana hackathon submissions; cluster `v1-c29` "Solar Energy DePIN and Verification" = **138 projects / 10 winners**; `v1-c10` "Solana DePIN Infrastructure Networks" = **189 projects / 23 winners** | *Intent density* — how many teams aim at the space. Submissions are mostly prototypes, not companies. |
| The Grid GraphQL (`https://beta.node.thegrid.id/graphql`, public, no key) | ~6 300 products; `productType = depin` → **86 products**, nearly all tagged `solana` | *Shipping reality* — each product carries a status: `live`, `open_beta`, `in_development`, `discontinued`, `support_ended` |
| Colosseum crypto archives | a16z "Why DePIN matters, and how to make it work" (2025-03-25); a16z "6 use cases for DePIN" (2025-06-18); Helius "Bringing Slashing to Solana" (2025-08-12); Galaxy "Far Beyond Price Feeds: What Chainlink Actually Does Today" (2025-12-08) | Frameworks and named players worth tracking |

**Why both sources:** Colosseum alone overstates the market (138 submissions in the niche), The Grid alone understates intent (only products that exist as products). The gap between the two is itself the finding — see section 7.

Reproduction commands: section 9.

---

## 3. Ring 1 — Direct competitors (energy on Solana)

### 3.1 Products that are actually live (The Grid, 2026-09-18)

| Project | Status | What it is | Why it competes | Where ENRG differs |
|---|---|---|---|---|
| **Sourceful Energy** `sourceful.energy` | 3 products **live**: Energy Gateway, App, **Zap** (P1 meter, RJ12 → utility smart meter) | Closest physical analogue: home/distributed energy hardware + production data on Solana. Tagline: "Slash Your Energy Bills. Stabilize the Grid." | Same physical layer, same chain, same buyer (asset owner / operator) | We sell a *provable* reading (device-held Ed25519 key — SE050 tier for mainnet, ≥2 staked oracles, slashing, on-chain audit trail) — they sell a device plus app UX |
| **Starpower** `starpower.world` | `Starplug` live, `Starpower` open_beta, `Starbattery` / `Starcharger` in development | Consumer energy network: smart plugs that "mine $STAR", home batteries, EV chargers | Largest mindshare in Solana energy DePIN; token incentives and a real device fleet | Token- and device-led; no oracle quorum, no slashing, no signed-proof root of trust |
| **DeCharge** `decharge.network` | `DeCharge Beast` (7 kW AC) and `Mini` live; `Charging network` in development; **`DeCharge Beast with DePHY OSEM` — discontinued** | EV-charging DePIN: operators buy chargers and participate | Same "physical hardware + on-chain attestation" pattern | Their hardware-attestation module (OSEM) is `discontinued` — the hardware-trust niche is currently unheld |
| **CyberCharge** `cybercharge.org` | Smart Charger + Mobile App live | Charger hardware with a "Power Matching Protocol" | Same energy-hardware category | No verification / oracle layer |
| **Power Ledger** `powerledger.io` | `Powerledger Blockchain` (L1 forked from Solana's codebase) **support_ended**; `TraceX` (Energy Attribute Certificates) and `xGrid` live | Long-standing energy-crypto incumbent | Direct competitor for REC/GO/EAC issuance | They verify from market/registry data; ENRG verifies from device-rooted signed proofs |
| **GWatt** `greenkwh.net` | early_access | Green-kWh accounting | Same accounting narrative | — |
| **END Corp Climate Platform** `endcorp.co`, **Mālama** `malamalabs.com`, **Diol** (Inveniam) | in_development / live / live | Climate and institutional verified-data platforms | Compete for the same enterprise / ESG buyer | Not device-rooted; audit trail is not the product |

**Finding:** among *live* Solana energy products only **four brands** touch physical energy hardware (Sourceful, Starpower, DeCharge, CyberCharge) — and none of them is positioned as a verification / trust layer.

### 3.2 Hackathon-era competitors (Colosseum DB) — rivals for grants and attention

These are submissions, not necessarily companies; treat them as the pool ENRG competes with in grant tracks and hackathons.

| Project (`slug`) | Recognition | Angle |
|---|---|---|
| **Green Energy Network (GEN)** `green-energy-network-(gen)` | Honorable Mention, DePIN track (Breakout), team 2 | IoT/edge capture of facility energy data on Solana for impact investing |
| **NovenGrid** `novengrid` | 5th place, DePIN track (Breakout), team 3 | Tokenizing renewable generation + storage nodes |
| **SolaNX** `solanx` (Radar) | — | Staking solar panels for renewable yield |
| **SunChain** `sunchain` (Cypherpunk) | — | IoT solar microgrids in Nigeria, on-chain usage + stablecoin micropayments |
| **AMALGAM** `amalgam` (Renaissance) | — | P2P renewable trading + green energy investment |
| **Finovo** `finovo` (Renaissance) | — | Token rewards for community renewable generation and consumption |
| **Verified IoT** `verified-iot` (Cypherpunk) | — | Bridging IoT sensor streams to chain for energy/carbon MRV |
| **Orb Oracles** `orb-oracles` (Cypherpunk) | — | Constant-time aggregation oracles for arbitrary value streams (see Ring 2) |
| **DePHY** `dephy` (Renaissance) | — | Restaking security for DePIN — infrastructure, not an energy competitor |
| **GoTrade** `gotrade`, **Pivot Green** `pivot-green` | — | Guarantee-of-Origin / REC and cross-border clean-energy trading |
| **Carbon On Chain**, **CarbonChain**, **OCEANAVERSE**, **GreenVault**, **Revolutionizing Green Credits** | — | Carbon-credit and green-credit certification/trading |
| **Energy Pro** `energy-pro`, **Aledger**, **HeliosGrid**, **Skat Battery Energy** | — | P2P prosumer trading / battery networks |
| **Evora**, **DeVolt**, **dPort**, **Soltera** | — | EV charging, smart metering-as-a-service (Philippines) |
| **The Solar DePIN Project: Carbon Smart Meter**, **GreenVolt**, **Soltera**, **SolaNX (2nd entry)** | — | Smart-meter DePIN variants |

---

## 4. Ring 2 — Trust layer: oracles and attestation on Solana

Live oracle products found on Solana (The Grid, 2026-09-18):

| Provider | Products (status) | Data class |
|---|---|---|
| **Chainlink** `chain.link` | Data Feeds, VRF, Automation, CCIP, Data Streams, Functions, **CRE (Runtime Environment)**, DataLink — all `live` | Price/market data, cross-chain messaging, compute, automation |
| **Pyth** `pyth.network` | Price Feeds, Lazer, Pythnet — `live` | Low-latency market data |
| **Switchboard** `switchboard.xyz` | Oracle Network `live`; V2 Push `support_ended` | General-purpose oracle |
| **Supra** `supra.com`, **DIA** `diadata.org` (Lumina, xReal RWA Oracle) | `live` | General oracle / RWA price data |
| **ORAO** `orao.network`, **Hypernative** `hypernative.io`, **Wormhole Queries** | `live` | VRF, security signals, cross-chain queries |
| **Gateway Oracle** `gateway.fm`, **Kaiko Data Services** `kaiko.com`, **Noves Pricing API** | `live` | Enterprise/market data |

Early or hackathon-stage attestation players: **Attest Protocol** (`attest-protocol`, Public Goods Award $10 000, Cypherpunk), **Orb Oracles** (`orb-oracles`, constant-time aggregation), **Bright Sight Optimistic Oracle**, **Molpha Oracle** (`molpha-oracle`, turns any API into a configurable on-chain feed), **ASSAP** (anti-sybil attestations).

**Why this ring matters:** in a grant review, ENRG and these teams draw on the
same line item — "oracle / verification infrastructure". Galaxy's December 2025
research ("Far Beyond Price Feeds") shows reviewers already treat Chainlink as
the reference implementation of that category. Therefore ENRG must always
state the *data class* (physical production data, device-rooted identity) and
the *enforcement* (stake + slash + finalised-attestation mint gate) — never
simply "we are an oracle".

---

## 5. Ring 3 — Adjacent DePIN on Solana (attention, capital, talent)

None of these do energy, but they set the scoreboard ENRG is compared against,
compete for the same DePIN grants, and absorb builder talent. Cluster `v1-c10`
"Solana DePIN Infrastructure Networks" holds **189 submissions / 23 winners**.

| Sub-sector | Live products (The Grid, 2026-09-18) |
|---|---|
| Compute / AI | The Render Network, IO Cloud (io.net), Nosana Grid Network, Aethir (Earth, Atmosphere), Gradient Sentry, PublicAI Data Hub, Hivello, Inferix (`early_access`), BitRobot (`in_development`) |
| Wireless / connectivity | Helium Mobile Network, Roam, DoubleZero (`open_beta`), DAWN / DAWN Validator Extension (Andrena), Dabba (Network, Lite, Lite Hotspot, Pro), XNET, Ping Network, Beamable (`open_beta`), DePINsim, Huddle01 dRTC, Nym, Pipe CDN, Blockcast CDN |
| Mapping / sensing | Hivemapper (Network, Bee Dashcam, Beemaps), GEODNET RTK Service, NATIX (Network, Drive&, VX360), Wingbits (Network, Geosigner, Satellite), Onocoy (RTK, STREAM), Ambios Sensor Network, UpRock, ZePIN, MVL DePIN, 375.ai, AquaSave (`in_development`) |
| Storage / other | Diol (Inveniam), Mālama Platform, Solix Extension, Digital Miners |

ENRG's advantage in this ring is that physical-data verification is the one
DePIN function *every* one of them needs and none of them sells as a product
(see POSITIONING §4, item 4 — "DePIN verification toolkit").

---

## 6. Ring 4 — Off-chain / off-Solana competitors

| Player | Status / evidence | Approach |
|---|---|---|
| **Power Ledger** `powerledger.io` | In The Grid, tagged `solana` + `ethereum`; its own L1 based on Solana's codebase is `support_ended`; `TraceX` (EAC marketplace) and `xGrid` are `live` | Energy-attribute certificates from market/registry data |
| **Energy Web** | Cited in our own `docs/POSITIONING.md` §2 for "the verification gap" | Registry-level verification through portals/APIs |
| **Daylight** | Named in a16z "6 use cases for DePIN" (2025-06-18): a protocol letting solar owners sell energy *and* device data back to utilities | VPP / DER data monetisation |
| **Registries & ESG/MRV firms** | Not crypto | REC/GO and carbon registries, CSRD/CBAM/SAF assurance, annual manual audits |
| **Ferion** (AlloyX) `alloyx.com` | `live`, product type `rwa_tokenisation_platform` | Institutional RWA rails — potential *channel*, not competitor |

**Not found in The Grid** (no product profile): Daylight, Glow, Arkreen, Energy
Web. Absence does not mean they are inactive — it means these names currently
rest on secondary sources (a16z article, our own docs) and MUST be verified
individually before being quoted externally.

---

## 7. Density: reading the two numbers together

| Signal | Value (2026-09-18) | Interpretation |
|---|---|---|
| Submissions in `v1-c29` "Solar Energy DePIN and Verification" | **138 projects**, 10 winners | Intent and attention are abundant |
| Live Solana energy-hardware brands | **4** (Sourceful, Starpower, DeCharge, CyberCharge) | Shipped proof is scarce |
| Primitives inside `v1-c29` | `token` 111 vs `oracle` 53 | Tokenisation is the crowded default; verification is the minority |
| Tech stack inside `v1-c29` | `solana` 137, `iot` 31, `hardware` 10, `rust` 4 | Almost nobody works at the hardware/signing layer |
| Top problem tag in `v1-c29` | `greenwashing` (18) | The exact problem ENRG is built against |
| Corpus-wide (5 400+ submissions) | `iot` techStack: 86; prizes: GRAND_PRIZE 4, PUBLIC_GOODS_AWARD 4, CLIMATE_AWARD 2 (`endcoin`, `aquasave`), MOBILE_AWARD 1 | Climate-specific awards are rare — a funding angle to monitor |

---

## 8. Where ENRG wins and where ENRG is exposed

**Wins (facts, not claims):**

1. No *live* Solana energy product offers a hardware-rooted oracle quorum with
   slashing and a finalised-attestation mint gate.
2. DeCharge retired its own hardware-attestation module (`DePHY OSEM`,
   `discontinued`) — the layer ENRG owns is currently unoccupied.
3. Power Ledger's own chain is `support_ended`: the energy-crypto incumbent is
   retrenching toward marketplaces, not expanding into device trust.
4. The niche's headline problem tag is `greenwashing` — precisely our framing.

**Exposed:**

1. **Distribution.** Sourceful and Starpower already run devices with users;
   ENRG has devnet, firmware and 58 instructions. A pilot beats architecture.
2. **Grant-review priors.** Chainlink/Pyth are the default "trust" answer;
   ENRG has to fight for the "physical data" sub-category, not the category.
3. **Narrative fatigue.** 138 submissions means "solar tokenization" reads as
   noise — keep the verification framing (POSITIONING §6 is the defence).
4. **Discoverability.** ENRG has no profile in The Grid catalogue, so it is
   invisible to the ecosystem-mapping tools that investors and grant reviewers
   actually use.

---

## 9. Refresh procedure (quarterly, ~30 minutes)

Colosseum Copilot (read-only; `GET /status` first):

```bash
export COLOSSEUM_COPILOT_API_BASE="${COLOSSEUM_COPILOT_API_BASE:-https://copilot.colosseum.com/api/v1}"
: "${COLOSSEUM_COPILOT_PAT:?set COLOSSEUM_COPILOT_PAT first (colosseum.com/arena/copilot)}"
curl -s "$COLOSSEUM_COPILOT_API_BASE/status" -H "Authorization: Bearer $COLOSSEUM_COPILOT_PAT"

for q in "verifiable energy production oracle" "oracle quorum slashing" \
         "hardware attestation device identity" "renewable energy certificate REC verification"; do
  curl -s -X POST "$COLOSSEUM_COPILOT_API_BASE/search/projects" \
    -H "Authorization: Bearer $COLOSSEUM_COPILOT_PAT" -H "Content-Type: application/json" \
    -d "{\"query\": \"$q\", \"limit\": 10}"
done
```

The Grid (public, no key):

```bash
curl -s -X POST "https://beta.node.thegrid.id/graphql" -H "content-type: application/json" \
  --data-binary '{"query":"{products(limit:100,where:{productType:{slug:{_eq:\"depin\"}}}){name productStatus{slug}root{urlMain}}}"}'
```

**Known API limitations (observed 2026-09-18):**

- `references/api-reference.md` documents `clusterKeys` for
  `POST /search/projects`, but the live API rejects it:
  `{"error":"Unrecognized key(s) in object: 'clusterKeys'","code":"INVALID_QUERY"}`.
  Use semantic queries plus `GET /clusters/:key` for cluster metadata.
- Page size is capped (`limit <= 25`); filter-only browsing requires omitting
  `query` entirely.
- Facets returned are computed corpus-wide, not scoped to the semantic result
  set — treat them as ecosystem baselines.
- The Grid descriptions/product lists are heavy: run those queries in the
  background and read the JSON afterwards.

**Update rules:**

- Every row carries the date it was read. A status change
  (`in_development` → `live`) counts as an escalation: re-run POSITIONING §7.
- If any competitor ships a staked oracle quorum, slashing or a hardware root
  of trust, treat it as a positioning incident and update both documents the
  same day.

---

## 10. Caveats

- Colosseum data are hackathon submissions (mostly prototypes); prizes attach
  to submissions, not to companies.
- Product statuses in The Grid can lag reality, and absence from the catalogue
  is not evidence of inactivity.
- Ring 4 names drawn from secondary sources are marked as such and need
  individual verification before external use.
- This document reports public product metadata only. It makes no claim about
  any competitor's integrity, funding or code quality.

---

*Related: `docs/POSITIONING.md` (§7 competitive landscape, source of truth for
messaging), `docs/GRANTS.md` (funding plan and application template),
`docs/ONEPAGER.md`, `docs/STATE.md` (what ENRG itself has shipped).*
