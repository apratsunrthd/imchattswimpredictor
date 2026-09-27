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

- Live 70.3 and full Chattanooga swim-odds calculation: real CFS + real
  weather → single probability, rendered in the existing UI.
- Race calendar auto-advances between 70.3 2026 / full 2026 / 70.3 2027.
- Full-IM swim-start CFS estimate, blending CKTT1 (upstream) and CHAT1 by
  their real river-mile-derived weights (see ARCHITECTURE.md), with an
  automatic, silent fallback to CHAT1-only whenever CKTT1 has no valid flow
  reading (the common case today) — ready to use real CKTT1 data the moment
  it's available again, no code change needed.
- Cutoff-pace-aware threshold adjustment: checked whether full's longer swim
  cutoff should mean a separate cancellation ladder — it doesn't, meaningfully
  (full is ~2% more forgiving per mile than 70.3), so that's a small ladder
  adjustment (`paceScale`) rather than two hand-tuned ladders.

- Impeccable design/UX pass complete: fixed a real bug (race calendar
  skipped the full IRONMAN's own race day), stale copy/citations, all
  emoji/gradient-text craft-floor violations (replaced with an authored SVG
  icon set and solid header color), a mobile-overflow bug in the Hall of
  Shame table, several low-contrast functional-text issues, and a
  layout-thrash animation the mechanical detector caught.

## In progress / planned

1. **Simulated triathlete review panel** — 10 subagent personas critique the
   app/model as a fast, cheap proxy before recruiting real race alumni. Next
   up, now that the impeccable pass is done.

## Key decisions

- Chose real government APIs over any LLM-based data extraction — free,
  deterministic, no key, CORS-open, and matches what the README always
  claimed the app did.
- Chose a simulated (subagent) triathlete panel before real recruitment, to
  get cheap signal first — sequenced after the impeccable design pass.
- Swim-start distances, cutoffs, and the CKTT1–CHAT1 river-mile span come
  from third-party race guides and public river-mile data, cross-checked
  but not from IRONMAN's own official athlete-guide PDF — reasonable
  confidence, not surveyed. See TODO.md to upgrade the source.
- CKTT1 will not meaningfully feed the probability model until NOAA (or TVA)
  gives it a real flow rating — the blend logic is ready and dormant, not
  disabled.
