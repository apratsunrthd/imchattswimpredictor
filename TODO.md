# TODO

**Audience:** Claude Code, other models, and humans. Answers "what next?"

## Next up (Claude / model work)

- [ ] **Full IRONMAN support** — model a separate swim-start CFS estimate for
  the full-distance race. Full swim starts ~1.2mi upstream of the 70.3 start,
  roughly midway between `CKTT1` and `CHAT1`. Also needs its own
  cancellation thresholds (full-distance swim cutoff time differs from
  70.3's, so the same CFS carries different risk).
- [ ] **CKTT1 upstream gauge integration** — blocked on a real data gap:
  CKTT1 reports stage (ft) but not flow (CFS) via NOAA's API (`secondary`
  is always `-999`). Before this can feed the probability model, research
  either (a) TVA's own Chickamauga Dam generation/release data, or (b) a
  stage-based proxy calibrated against historical CHAT1 correlation. Until
  resolved, surface CKTT1 as a display-only leading-indicator/trend badge,
  not a model input.
- [ ] **Simulated triathlete review panel** — spawn ~10 subagent personas
  (varying experience level, risk tolerance, race history, tech-savviness)
  to critique the app and probability model as a cheap proxy signal.
  **Flag before running** — this is a large parallel subagent fan-out and
  should get an explicit go-ahead per token-budget policy.
- [ ] **Impeccable design/UX review** — run the `impeccable` skill against
  the live UI once the toolchain is running locally (or against the
  deployed GitHub Pages build).
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
