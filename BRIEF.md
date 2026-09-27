# Brief

**Audience:** Claude Code / other models picking up this repo.

## What this is

A joke-but-functional single-page app that predicts the odds IRONMAN
Chattanooga's swim leg actually happens, based on live Tennessee River flow
and weather. No backend — everything fetches directly from public,
CORS-open, no-auth government APIs from the browser.

## Current state (2026-09-27)

Just fixed the core bug: the app previously "fetched" river CFS and weather
by POSTing to `api.anthropic.com/v1/messages` and asking Claude to web-search
and guess a JSON blob — no API key was ever configured, so this 401'd on
every load and the app never actually worked. Replaced with real direct
fetches:

- River CFS: NOAA NWPS gauge `CHAT1` stageflow endpoint.
- Weather: `api.weather.gov` points → daily forecast text, gridpoint
  `quantitativePrecipitation` summed over the next 7 days (real inches, not
  a guessed proxy), and active TN alerts filtered to Hamilton County for
  flood warnings.

Both verified working against the live APIs (see git history for the
verification run). See [ARCHITECTURE.md](ARCHITECTURE.md) for the data flow
and [TODO.md](TODO.md) for what's next.

## What works

- Live 70.3 Chattanooga (May) swim-odds calculation: real CFS + real weather
  → single probability, rendered in the existing UI.
- Race calendar auto-advances between 70.3 2026 / full 2026 / 70.3 2027.

## In progress / planned

1. **Full IRONMAN support** — the full-distance swim (2.4mi) starts ~1.2mi
   further upstream than the 70.3 start (~1.2mi), roughly midway between the
   `CHAT1` gauge and the upstream `CKTT1` gauge (Chickamauga Dam tailwater).
   Needs its own CFS estimate and its own cancellation thresholds (different
   swim cutoff time than 70.3).
2. **CKTT1 upstream gauge** — intended as a leading indicator / interpolation
   input for the full-IM swim-start estimate. **Key finding:** CKTT1 does not
   publish a flow (CFS) rating — `secondary` is always `-999` in NOAA's feed,
   only `primary` (pool stage, ft) is populated. Folding it into the
   probability math requires either TVA's own Chickamauga Dam release data or
   a stage-based proxy calibrated against CHAT1 history — not a direct
   linear interpolation between two CFS readings as originally assumed.
3. **Simulated triathlete review panel** — 10 subagent personas critique the
   app/model as a fast, cheap proxy before recruiting real race alumni.
4. **Impeccable design review** — UX/visual pass via the `impeccable` skill.

## Key decisions

- Chose real government APIs over any LLM-based data extraction — free,
  deterministic, no key, CORS-open, and matches what the README always
  claimed the app did.
- Chose a simulated (subagent) triathlete panel before real recruitment, to
  get cheap signal first.
- CKTT1 will not feed the probability model until its flow-data gap is
  resolved (see #2 above) — display-only trend/stage signal in the meantime.
