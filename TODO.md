# TODO

**Audience:** Claude Code, other models, and humans. Answers "what next?"

## Next up (Claude / model work)

- [x] **Full IRONMAN swim-start CFS blend, with real course numbers** —
  researched actual swim-start distances (nvdmcoaching / endurancenation
  race guides, cross-checked against public river-mile data): CKTT1
  (Chickamauga Dam) sits ~8 river miles upstream of CHAT1/Ross's Landing;
  70.3 starts 1.4mi upstream of Ross's Landing (17.5% of that span), full
  starts 2.4mi upstream (30% of that span). `upstreamWeight()` now uses
  those real fractions instead of a guessed 50/50 — and applies to *both*
  race types, not just full (70.3 gets a real, if small, 17.5% blend too).
  Falls back to CHAT1-only whenever CKTT1 has no valid flow reading (the
  common case). These are third-party-sourced, not from the primary
  official athlete-guide PDF — reasonable confidence, not surveyed.
  - [x] **Full-distance cancellation thresholds** — checked: full's cutoff
    is 2:20 over its 2.4mi start distance (58.3 min/mi), 70.3's is 1:20 over
    1.4mi (57.1 min/mi) — within ~2% of each other, full actually *slightly*
    more forgiving per mile. `cfsProbability()` now applies that as a small
    `paceScale` adjustment rather than a separate hand-picked ladder, since
    the two distances turned out not to be meaningfully different on a
    pace-cutoff basis. Re-open if real per-distance cancellation history
    ever gives a stronger empirical signal than this.
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
- [ ] Confirm swim-start distances/cutoffs against the **primary official
  IRONMAN athlete guide PDF** — current numbers (1.4mi/1:20 for 70.3,
  2.4mi/2:20 for full, 8mi CKTT1–CHAT1 span) came from third-party race-guide
  sites and public river-mile data, cross-checked but not from IRONMAN's own
  course-map PDF.
