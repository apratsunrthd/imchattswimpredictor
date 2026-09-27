# Architecture

**Audience:** Claude Code, other models, and humans.

## Shape

Static single-page React app, no backend, no auth, no cost. Built with Vite,
deployed to GitHub Pages. All data comes from direct browser `fetch()` calls
to three public U.S. government APIs, all of which serve `Access-Control-Allow-Origin: *`
(confirmed by direct request), so no proxy/backend is needed.

```
Browser (React SPA)
  ├─ NOAA NWPS  api.water.noaa.gov/nwps/v1/gauges/CHAT1/stageflow   → live + forecast river CFS
  ├─ NWS        api.weather.gov/points/{lat},{lon}                  → grid + forecast URLs
  │             api.weather.gov/gridpoints/{office}/{x},{y}         → forecast, quantitativePrecipitation
  │             api.weather.gov/gridpoints/{office}/{x},{y}/forecast→ daily text summary
  │             api.weather.gov/alerts/active?area=TN               → flood warnings
  └─ USGS NWIS  waterservices.usgs.gov/nwis/dv (gauge 03568000)     → historical fallback (not yet wired in)
```

## Components (all in `src/App.jsx`)

- **Data fetching** — `fetchRiverCfs()`, `fetchWeather()`. Both are plain
  `fetch()` calls, no polling library, refreshed every 5 minutes via
  `setInterval` in the main component's `useEffect`.
- **Probability model** — `cfsProbability(cfs)` (threshold ladder) +
  `WEATHER_MODIFIERS` (flat delta per condition) + a flat −9 constant
  ("Chattanooga Discount"), combined in `calcProbability()`. This is a
  simplified stand-in for the multi-factor, confidence-weighted model
  described in `README.md` (historical base-rate blending, race-day forecast
  override, river trend, distance-to-race decay) — that fuller model is not
  implemented in code yet.
- **Race calendar** — `RACES` array + `getCurrentRace()`, picks the next
  upcoming race by date.
- **UI** — `ProbabilityRing`, `LoadingRing`, `Pulse`, and the main render
  tree; everything styled inline, no CSS modules/Tailwind/component library.

## Key technical decisions

- **No LLM in the data path.** An earlier version routed both "current CFS"
  and "current weather" through a call to Claude with web search, asking it
  to guess and return JSON. Replaced because it was non-deterministic, had no
  API key configured (so it always failed), and duplicated data that's
  available directly, for free, with zero auth, from the source APIs.
- **Real precipitation, not a proxy.** Rain-inches-next-7-days is computed
  from NWS gridpoint `quantitativePrecipitation` (actual forecast mm, summed
  and converted), not from a probability-of-precipitation heuristic — more
  accurate and no arbitrary scaling constant to justify.
- **Sentinel filtering on NOAA data.** `CHAT1`'s trailing observed points are
  sometimes unset (`secondary: -999`); the fetch always scans backward for
  the last valid reading rather than trusting the array's last element.

## Swim course model (implemented)

Sourced facts (third-party race guides — nvdmcoaching, endurancenation —
cross-checked against public river-mile data; not the primary official
athlete-guide PDF, see `TODO.md`):

| | upstream of Ross's Landing / CHAT1 | swim cutoff |
|---|---|---|
| CKTT1 (Chickamauga Dam tailwater) | ~8.0mi | — |
| 70.3 swim start | 1.4mi | 1:20 (80min) |
| Full swim start | 2.4mi | 2:20 (140min) |

**CFS blend.** `upstreamWeight(raceType)` = the swim start's fraction of the
CKTT1→CHAT1 span (70.3: 1.4/8 = 17.5%, full: 2.4/8 = 30%) — replacing an
earlier guessed 50/50 that only applied to full. `getEffectiveCfs()` blends
CKTT1 and CHAT1 by that weight whenever CKTT1 has a valid reading; both race
types get a real (if small, for 70.3) blend now, not just full.

CKTT1's flow field (`secondary`) is essentially always the `-999` sentinel in
NOAA's feed — it isn't reliably rated for flow, only stage (`primary`, ft) —
so `fetchUpstreamCfs()` returns `null` whenever that's the case and
`getEffectiveCfs()` falls back to CHAT1-only automatically, with a small note
on the UI tile. No code change is needed if/when CKTT1 starts reporting
valid flow again — the blend picks it up the next fetch cycle.

**Cutoff-based threshold adjustment.** Checked whether the full's longer
swim cutoff should mean a separate cancellation ladder: cutoff pace works
out to 58.3 min/mi for full vs 57.1 min/mi for 70.3 — within ~2% of each
other, full actually *slightly* more forgiving. `paceScale(raceType)`
captures that ratio and `cfsProbability()` divides the input CFS by it
before applying the (shared) threshold ladder, rather than maintaining two
separately hand-tuned ladders for a ~2% difference that isn't really there.

## Planned extensions (not yet built — see TODO.md)

- TVA's own Chickamauga Dam release data, as a possible alternative to
  waiting on NOAA to rate CKTT1 for flow.
- Revisit the pace-scale adjustment if real per-distance cancellation
  history ever gives a stronger empirical signal than the cutoff-pace math
  above.
