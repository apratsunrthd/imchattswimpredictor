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

## Planned extensions (not yet built — see TODO.md)

- **Full IRONMAN swim-start estimate**: the full-distance swim starts ~1.2mi
  upstream of the 70.3 start, roughly midway between `CKTT1` (Chickamauga Dam
  tailwater) and `CHAT1`. Intent is to estimate conditions at that
  intermediate point rather than reusing the CHAT1 (downstream) reading
  as-is.
- **CKTT1 as an upstream signal**: blocked on a real gap — CKTT1's flow
  (`secondary`) field is always `-999` in NOAA's feed; only stage (`primary`,
  ft) is populated. A CFS-to-CFS interpolation between CKTT1 and CHAT1 isn't
  possible with this API alone. Needs either TVA's own dam-release data or a
  stage-based proxy calibrated against CHAT1 history before it can feed the
  probability math; until then it's a display-only trend indicator at best.
