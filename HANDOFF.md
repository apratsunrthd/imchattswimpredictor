# Handoff

**Audience:** a model or person seeing this repo for the first time.

## Where things live

- Everything is in one file: [src/App.jsx](src/App.jsx) (~480 lines) — data
  fetching, probability model, and UI all inline. No component split, all
  styling is inline `style={{}}` objects (not `src/App.css`).
- [src/App.css](src/App.css) and the Vite-template rules in
  [src/index.css](src/index.css), plus `src/assets/react.svg`, `vite.svg`,
  `hero.png`, are **dead** — leftovers from `npm create vite`, referenced by
  nothing. Safe to delete whenever someone's in there; not removed yet
  because it wasn't in scope for the fix that touched this file.
- `README.md` is the most detailed doc of the intended model (probability
  factors, confidence weighting, race history) — but it describes the target
  design, not always the current code. Cross-check against `App.jsx` before
  trusting a README claim about *current* behavior; check `BRIEF.md` for
  what's actually shipped.

## How to run it

```
npm install
npm run dev
```

**Known broken right now:** local Node 22.4.1 is below what `vite@8`
(rolldown-based) requires (`^22.13.0`). `npm run dev` / `npm run build` fail
with a "Cannot find native binding" error — this is an npm optional-deps
resolution issue tied to the Node version, not the app code. Fix is to
upgrade Node (`nvm install 22.13` or later) before running.

Deploy is `npm run deploy` → builds and pushes `dist/` to GitHub Pages via
`gh-pages`. Same Node-version blocker applies.

## Gotchas

- **NOAA CHAT1 stageflow** (`api.water.noaa.gov/nwps/v1/gauges/CHAT1/stageflow`):
  the most recent 1–2 entries in `observed.data` are frequently sentinel
  values (`secondary: -999`) before the real hourly reading lands — always
  scan backward for the last entry with `secondary >= 0`, don't just take
  the last array element.
- **CKTT1** (Chickamauga Dam tailwater, upstream of CHAT1) has the same API
  shape but its `secondary` (flow) field is *always* `-999` — this gauge has
  no flow rating, only stage (`primary`, ft). Don't assume it behaves like
  CHAT1.
- **api.weather.gov** needs no auth and no special headers here — all three
  endpoints used (`points`, `forecast`, `gridpoints/.../forecastGridData`,
  `alerts/active`) returned `access-control-allow-origin: *`, confirmed by
  direct curl. Real rain-inches come from grid `quantitativePrecipitation`
  (mm, convert ×0.0393701), not from guessing off precipitation probability.
- All three APIs (NOAA NWPS, USGS NWIS, NWS) are free, public, CORS-open, and
  need zero keys — that's what makes the "no backend" architecture in the
  README actually true once the data layer is fixed.

## Conventions

- No component library, no state management beyond `useState`/`useEffect`.
- Styling: inline objects, dark theme, hardcoded hex colors throughout — not
  extracted into a token system.
- `RACES` array in `App.jsx` drives which race the header/prediction target;
  extend this array rather than branching UI code when adding races.

## Gotchas (continued)

- **Screenshot debugging:** `google-chrome --headless --disable-gpu
  --screenshot=...` (legacy headless mode) produced false-positive visual
  bugs when auditing this UI — phantom horizontal overflow and phantom text
  clipping that don't exist in a real render. Confirmed via Playwright
  (`chromium.launch()` + `page.screenshot()`) that the actual page has zero
  overflow at 390px. If you see a visual bug that looks structural, verify
  with Playwright or a real browser before trusting legacy `--headless
  --disable-gpu` captures.
- Icons are hand-authored inline SVG in the `Icon` component in
  `src/App.jsx` (no icon library dependency) — add new names there rather
  than reaching for an emoji or a new package.

## Open threads

See [TODO.md](TODO.md) — full IRONMAN swim-start CFS estimate, CKTT1
integration (blocked on the flow-data gap above), simulated triathlete
review panel, impeccable design review, and the Node/Vite toolchain fix.
