# IM Chattanooga Swim Predictor

**[chattimswim.com](https://chattimswim.com)**

A real-time swim probability dashboard for the IM 70.3 Chattanooga triathlon. Because the swim has been cancelled or shortened so many times it felt wrong *not* to build this.

---

## What It Does

Pulls live river flow data, multi-day forecasts, historical race-day CFS across every year the race has been held, and NWS weather data — then blends them into a single swim probability that updates every 5 minutes. The further out from race day, the more the prediction leans on historical base rates. The closer in, the more it trusts live data.

---

## The Model

### Historical Base Rate

The IM 70.3 Chattanooga swim has a historical success rate of approximately **55%** — about 5 clean swims out of 9 events. This is the anchor. When we're far from race day and signal quality is low, the prediction regresses toward this number. It never falls below it entirely, and it never ignores it entirely.

### Signal Confidence

How much the model trusts live data vs. the historical base rate depends on how far out race day is and which signals are available:

| Days to race | Base signal confidence | Notes |
|---|---|---|
| 12+ days | 10% | Essentially just the base rate |
| 7–10 days | 25% | Trend and upstream QPF start to matter |
| 3–7 days | 50% | NWS forecast covers race week |
| 1–3 days | 85% | Strong signal, race-day forecast likely available |
| Race day | 100% | Full model, base rate ignored |

If a race-day CFS forecast is available (NOAA extends its forecast window ~7 days out), confidence gets a +30% boost. If race-day weather is available, +15%. If live river data is unavailable, −10%.

**Final probability = (base rate × (1 − confidence)) + (model × confidence)**

---

## The 8 Factors

Every factor is shown in the breakdown panel — including ones that aren't available yet, with an explanation of when they will be.

### 1. River CFS

**Source:** NOAA NWPS Gauge CHAT1 — Tennessee River at Chattanooga  
**API:** `https://api.water.noaa.gov/nwps/v1/gauges/CHAT1/stageflow`

The `secondary` field in the NOAA response is flow in **kcfs** (thousands of CFS). Multiplied by 1000 to get CFS. The `primary` field is pool elevation in feet — not used for the probability calculation.

CFS probability thresholds (IRONMAN's stated safe threshold is **20,000 CFS**; the 2025 swim was cancelled above **50,000 CFS**):

| CFS | Base probability |
|---|---|
| < 10,000 | 97% |
| 10,000–15,000 | 88% |
| 15,000–20,000 | 75% |
| **20,000 — safe limit** | |
| 20,000–25,000 | 55% |
| 25,000–30,000 | 38% |
| 30,000–40,000 | 22% |
| 40,000–50,000 | 8% |
| **50,000+ — 2025 cancel zone** | 2% |

**Fallback:** If live data is unavailable, fetches USGS daily values for race-week dates across all historical race years (see Factor 3). Ultimate fallback is a hardcoded ~25,000 CFS conservative May average.

**Effective CFS priority:**
1. Race-day CFS forecast (if NOAA forecast window covers race day)
2. 3-day forecast end (if higher than current — pessimistic leading indicator)
3. Live current CFS
4. Historical average
5. Hardcoded 25,000 CFS

---

### 2. River Trend

**Source:** NOAA CHAT1 observed data array — delta between latest reading and ~3 hours ago

Only shown when the river is actually moving (>2,000 CFS change in 3 hours). A stable river adds nothing to the breakdown.

| Trend | Modifier |
|---|---|
| Rising | Up to −15% (scaled by CFS delta / 1,000) |
| Falling | Up to +8% (scaled by CFS delta / 1,500) |
| Stable | 0% (not shown) |

A rising river is penalized more aggressively than a falling river is rewarded — consistent with how IRONMAN makes decisions in the days leading up to a race.

---

### 3. 3-Day CFS Forecast

**Source:** NOAA CHAT1 forecast array

NOAA publishes a ~3-day hydrograph forecast for this gauge. The app extracts the final forecast entry (furthest out) and shows the projected CFS and date. If the forecast end is higher than the current live reading, it's used as the effective CFS for the probability calculation — because a rising river 3 days from now is more relevant than where it is today.

Shown informational only when used as the effective CFS input (labeled in the breakdown).

---

### 4. Race-Day CFS Forecast

**Source:** NOAA CHAT1 forecast array — entry closest to race start time (May 17 at 7:15 AM)

Available only when the NOAA forecast window extends to race day, typically within ~7 days of the race. When available, this becomes the primary CFS input and overrides everything else. Shown as unavailable with an estimate of when it will become available.

---

### 5. Race-Day Weather

**Source:** NWS Hourly Forecast API  
**API:** `https://api.weather.gov/points/35.0456,-85.3097` → hourly forecast URL

Filters hourly periods to race morning (6 AM–noon on race day). Shows temperature, short forecast description, and average precipitation probability. Available within ~7 days of race day.

---

### 6. Upstream Precipitation / Weather Baseline

**Source:** NWS hourly forecast (QPF proxy) or Chattanooga May climatology

**When within 7 days:** Uses a 7-day upstream rainfall proxy — sums precipitation probability across all hourly periods where PoP > 40%, scaled to an estimated inches figure. This represents the rain falling in the Tennessee River watershed that will affect river levels 3–5 days later.

**When beyond 7 days:** Uses Chattanooga May climatology from NWS normals:
- ~42% chance of rain on any given May day
- ~4.5" average monthly rainfall
- Applied as a mild −3% baseline (Chattanooga May is rainy; ignoring that would be dishonest)

Weather modifiers (scaled by forecast confidence — 50% weight at 4–7 days, 100% at ≤3 days):

| Condition | Modifier |
|---|---|
| Clear skies | +5% |
| Light rain | −5% |
| Moderate rain | −12% |
| Heavy rain | −22% |
| Active flood warning (Hamilton County) | −35% |
| May climatology baseline | −3% |

Flood warnings are checked via `https://api.weather.gov/alerts/active?area=TN`, filtered to Hamilton County.

---

### 7. Chattanooga Discount™

A flat **−5%** penalty applied to every calculation. Earned through demonstrated institutional unreliability. The historical CFS data already reflects the bad years, so this is intentionally modest — it's a thumb on the scale, not a statement about the race organization.

---

### 8. Forecast Confidence

The blending weight between the raw model output and the 55% historical base rate. Shown explicitly in the breakdown so it's clear how much of the displayed probability is live signal vs. historical anchor. At 10% confidence (12+ days out), the prediction is essentially just the base rate with a small drag from elevated river levels.

---

## Historical CFS Data

**Source:** USGS NWIS Daily Values — Gauge 03568000  
**API:** `https://waterservices.usgs.gov/nwis/dv/?format=json&sites=03568000&parameterCd=00060`

Fetches daily discharge values for the race-week date (±2 days) for each historical race year in parallel:

| Year | Race date | Notes |
|---|---|---|
| 2015 | May 17 | Clean swim |
| 2016 | May 15 | Clean swim |
| 2017 | May 21 | Clean swim |
| 2018 | May 20 | Cancelled — high water |
| 2019 | May 19 | Shortened — high river flow |
| 2021 | May 23 | Clean swim |
| 2022 | May 22 | Clean swim |
| 2023 | May 21 | Clean swim |
| 2025 | May 18 | Cancelled — 50,000+ CFS |

Results are averaged to produce a historical mean with min/max range. Shown in the breakdown when used as the CFS input.

---

## Race Calendar

The app automatically advances to the next upcoming race. After the 70.3 swim on May 17, it flips to predicting the full IM Chattanooga in September, then back to the 2027 70.3.

| Race | Date | Swim start |
|---|---|---|
| IM 70.3 Chattanooga 2026 | May 17, 2026 | 7:15 AM |
| IM Chattanooga 2026 | ~Sept 27, 2026 | 7:00 AM |
| IM 70.3 Chattanooga 2027 | TBD | 7:15 AM |

---

## Hall of Shame

5 events. 4 cancellations. 1 shortened. 0 refunds.

| Year | Event | Reason | Verdict |
|---|---|---|---|
| 2025 | Chatt 70.3 | 50,000+ CFS — river said no | CANCELLED |
| 2024 | IM Chattanooga | Hurricane Helene flooding | CANCELLED |
| 2020 | Chatt 70.3 | COVID-19 (river just lucky) | WHOLE RACE NUKED |
| 2019 | Chatt 70.3 | High river flow | SHORTENED |
| 2018 | IM Chattanooga | High water / flooding | CANCELLED |

---

## Verdicts

| Probability | Message |
|---|---|
| ≥ 85% | River's behaving. Don't jinx it. |
| ≥ 65% | Probably swimming. Probably. |
| ≥ 40% | Wetsuit optional. Anxiety mandatory. |
| ≥ 20% | Start googling duathlon transition rules. |
| ≥ 8% | The river has other plans. |
| < 8% | CANCELLED. It's basically a tradition. |

---

## Data Sources

| Data | Source | Update frequency |
|---|---|---|
| Live river flow | NOAA NWPS CHAT1 | Hourly |
| River forecast | NOAA NWPS CHAT1 | ~3-day window |
| Historical CFS | USGS NWIS Gauge 03568000 | Historical (static) |
| Weather forecast | NWS Hourly — Chattanooga TN | Hourly |
| Flood alerts | NWS Active Alerts — TN | Real-time |

All APIs are free, public, and require no authentication. The app refreshes every 5 minutes.

---

## Tech Stack

- **React** (Vite)
- **GitHub Pages** (deployed via `gh-pages`)
- **No backend, no API keys, no cost**
- All data fetched client-side directly from public government APIs

---

## Local Development

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run deploy
```

Builds to `dist/` and pushes to the `gh-pages` branch. GitHub Pages serves from that branch at the root path.

---

## Disclaimer

This is entirely made up. The probability model was invented by a guy who is not a meteorologist, hydrologist, statistician, or anyone who should be trusted with numbers. The Chattanooga Discount™ is vibes-based. All of it is vibes. Do not make race travel decisions based on this website. Do not bet money on this. This is a joke. A very accurate joke, historically speaking, but still a joke.

Not affiliated with any race organization, timing company, or anyone who swims faster than a 3 mph current.

*The Chattanooga Discount™ is real and legally binding.*
