# TODO

**Audience:** Claude Code, other models, and humans. Answers "what next?"

## Next up (Claude / model work)

- [x] **CFS ladder recalibration** — 2026-09-27: full IRONMAN Chattanooga
  swam without incident at 37,000 CFS + moderate rain in the forecast, but
  the model showed 1% / "CANCELLED. It's tradition." The old ladder put
  35-45k CFS at just 4% base, which combined with any weather penalty and
  the flat -9 discount floors straight to 1% regardless of how mild
  conditions actually are — a structural bug, not just bad luck. Recalibrated
  `cfsProbability()`'s brackets against the app's own recorded ground truth:
  the 2025 cancellation happened at 50,000+ CFS (see CANCEL_HISTORY), so
  that's the real danger threshold, not ~35k. 37,000 CFS now scores 50% base
  (29% final with today's weather) instead of 4% base (1% final). Still
  leans pessimistic by design — this is not a claim of statistical rigor,
  just removing a floor that was demonstrably wrong on its own terms.
  - [ ] Still open: only one non-cancellation data point exists to calibrate
    against (today). If more "swam fine at X CFS" outcomes get recorded
    over time, revisit these brackets again — a proper history of
    completed swims (not just the Hall of Shame's cancellations) would
    make this a lot less single-point-dependent.
- [x] **Hall of Shame row alignment, take 2** — the baseline-alignment fix
  above wasn't actually the problem (see the `#root` global stylesheet bug
  just above) and still looked wrong once that bug was exposed. Restructured
  the hierarchy instead of re-tweaking align properties: event name is now
  the bold primary line, with year + reason demoted to a single small
  secondary line below it (same size, same baseline, comma/dot-separated) —
  removes the giant-22px-number-next-to-tiny-12px-text size clash entirely
  rather than trying to align two very different type sizes against each
  other.
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
- [x] **Impeccable design/UX review** — ran the `impeccable` skill against
  the UI. Found and fixed:
  - Real functional bug: `getCurrentRace()` skipped straight past the full
    IRONMAN's own race day to 2027's 70.3, because date-only strings parse
    as UTC midnight and the check was a naive `now < date`. Now stays
    "current" through the full race day.
  - Stale/misleading copy left over from the old fake-Claude data layer
    ("web search takes ~10 seconds"), and a footer citation still claiming
    USGS 03568000 as the live source when it's actually NOAA CHAT1/CKTT1.
  - Craft-floor bans: replaced all emoji/unicode-glyph icons (weather,
    verdict, loading, refresh, map-pin, wave) with a small hand-authored
    inline SVG icon set; removed the gradient/shimmer header text for a
    solid color; fixed a CSS Grid mobile-overflow bug in the Hall of Shame
    table (restructured to stacked rows); bumped several low-contrast
    functional text colors (countdown, timestamps, error states, axis
    labels) to legible levels; scoped monospace to actual data/status
    readouts and moved pure prose (weather summary, footer disclaimer) to
    Inter.
  - Mechanical detector (`impeccable detect`) also caught a layout-thrash
    animation (`transition: width` on the countdown bar) — fixed to
    `transform: scaleX()`. One remaining detector finding (Inter is an
    "overused font") was left as-is: it's the incumbent body font, not
    something to swap silently mid-bugfix; revisit with `/impeccable typeset`
    or `bolder` if a distinct type voice is wanted later.
  - Verified via Playwright screenshots at desktop/mobile — **note:**
    `google-chrome --headless --disable-gpu --screenshot` produced false
    positives (phantom overflow, phantom text clipping) not present in a
    real Chromium render; if debugging this UI again, verify with Playwright
    (or a real browser) before trusting that legacy headless mode.
- [ ] **Simulated triathlete review panel** — spawn ~10 subagent personas
  (varying experience level, risk tolerance, race history, tech-savviness)
  to critique the app and probability model as a cheap proxy signal, now
  that the impeccable pass above is done. **Flag before running** — this is
  a large parallel subagent fan-out and should get an explicit go-ahead per
  token-budget policy.
- [ ] Wire the USGS NWIS gauge 03568000 historical fallback (README already
  describes this; not implemented — `fetchRiverCfs` currently has no
  fallback path if NOAA is down).
- [x] **Deleted dead files** (`src/App.css`, `src/index.css`, unused
  assets) — `src/index.css` turned out not to be fully dead: it carried a
  leftover Vite-template `#root { text-align: center; ... }` rule that was
  silently inherited by every element on the page. Masked everywhere else
  because every other block already had its own explicit `textAlign:
  "center"` (so the inherited rule changed nothing visible), or sat on a
  shrink-to-fit box (centering text within a box exactly as wide as the
  text does nothing). The Hall of Shame rewrite was the first left-aligned,
  full-width text block on the page, so it was the first thing to expose
  it — reads as "weird alignment" but the real bug was a global stylesheet
  leftover, not the row's own layout. Removed the file and its import from
  `main.jsx` entirely rather than patching around it, since nothing in the
  app actually needs it (all real styling lives in App.jsx's own inline
  `<style>` block).
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
