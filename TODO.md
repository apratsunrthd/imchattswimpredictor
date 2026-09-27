# TODO

**Audience:** Claude Code, other models, and humans. Answers "what next?"

## Next up (Claude / model work)

- [x] **Full IRONMAN swim-start CFS blend** — `getEffectiveCfs()` blends
  CKTT1 (upstream) and CHAT1 50/50 for `race.type === "full"`, falling back
  to CHAT1-only whenever CKTT1 has no valid flow reading (the common case —
  see below). Ready to start using CKTT1 automatically the moment it
  reports real data again, no code change needed.
  - [ ] Still open: full-distance-specific cancellation thresholds (its
    swim cutoff time differs from 70.3's, so the same CFS carries different
    risk) — `cfsProbability()` currently applies the same ladder to both.
  - [ ] Still open: confirm the 50/50 weighting and "midway between CKTT1
    and CHAT1" assumption against an actual course map (see human TODO
    below) — currently the user's estimate, not measured.
- [x] **CKTT1 upstream gauge** — wired in (`fetchUpstreamCfs()`), but NOAA's
  feed reports `secondary: -999` (no flow rating) for it essentially always
  in practice — this is apparently a known flaky/uncalibrated sensor at that
  gauge, not a bug in our fetch. Code already ignores it whenever invalid
  and shows a "CKTT1 upstream: unavailable" note on the full-IM tile instead
  of silently guessing. If TVA's own dam-release data turns out to be more
  reliable than waiting on NOAA's rating, that's still an open option to
  revisit.
- [ ] **Impeccable design/UX review** — run the `impeccable` skill against
  the live UI. **Do this before the simulated panel** so the panel is
  reviewing a polished product, not a rough one.
- [ ] **Simulated triathlete review panel** — spawn ~10 subagent personas
  (varying experience level, risk tolerance, race history, tech-savviness)
  to critique the app and probability model as a cheap proxy signal, after
  the impeccable pass above. **Flag before running** — this is a large
  parallel subagent fan-out and should get an explicit go-ahead per
  token-budget policy.
- [ ] Wire the USGS NWIS gauge 03568000 historical fallback (README already
  describes this; not implemented — `fetchRiverCfs` currently has no
  fallback path if NOAA is down).
- [ ] Delete dead files: `src/App.css`, unused Vite-template rules in
  `src/index.css`, `src/assets/react.svg`, `src/assets/vite.svg`,
  `src/assets/hero.png` — none referenced anywhere in `src/`.
- [ ] Pre-existing eslint error at `src/App.jsx:188` (`react-hooks/set-state-in-effect`,
  calling `fetchAll()` synchronously in the mount effect) — not touched by
  the data-layer fix; needs a decision on whether/how to restructure.

## Next up (human work)

- [ ] **Upgrade local Node** to `^22.13.0`+ (or `^20.19.0`/`>=24`) — current
  `22.4.1` doesn't meet `vite@8`/rolldown's engine requirement, so
  `npm run dev` / `npm run build` / `npm run deploy` all fail locally right
  now with a "Cannot find native binding" error.
- [ ] Decide whether to recruit real Chattanooga race alumni for a follow-up
  review after the simulated panel (real recruiting channel, incentive, and
  timeline are all open).
- [ ] Confirm exact swim-start GPS/river-mile locations for both the 70.3
  and full-distance courses (from official IRONMAN course maps) — the
  "~1.2mi upstream, roughly midway between CKTT1 and CHAT1" figure is the
  user's estimate, not yet verified against a course map or river-mile
  chart.
