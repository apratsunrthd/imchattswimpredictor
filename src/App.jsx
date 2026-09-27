import { useState, useEffect, useCallback } from "react";

// ─── Data fetching direct from public government APIs (no key, CORS-open) ────

async function fetchGaugeCfs(gaugeId) {
  const res = await fetch(`https://api.water.noaa.gov/nwps/v1/gauges/${gaugeId}/stageflow`);
  if (!res.ok) throw new Error(`NOAA ${gaugeId} ${res.status}`);
  const data = await res.json();
  const points = data.observed?.data ?? [];
  // Trailing points can be unset sentinels (secondary: -999) before the hourly reading lands.
  const latest = [...points].reverse().find(p => p.secondary >= 0);
  return latest ? Math.round(latest.secondary * 1000) : null;
}

function fetchRiverCfs() {
  return fetchGaugeCfs("CHAT1");
}

// CKTT1 (Chickamauga Dam tailwater, upstream of CHAT1) has no reliable flow
// rating on NOAA's feed — secondary is almost always the -999 sentinel, even
// though the gauge is live and stage (primary) reports fine. fetchGaugeCfs
// already filters that out and returns null when every point is invalid, so
// this just needs to not blow up the rest of the app when that happens.
async function fetchUpstreamCfs() {
  try {
    return await fetchGaugeCfs("CKTT1");
  } catch {
    return null;
  }
}

// Swim course facts, sourced from IRONMAN/coaching race guides (nvdmcoaching,
// endurancenation) cross-checked against public river-mile data — not the
// primary official athlete-guide PDF, so treat as best-available rather than
// surveyed. See ARCHITECTURE.md for sources.
//   - CKTT1 (Chickamauga Dam tailwater) sits at Tennessee River Mile ~471.
//   - CHAT1 / Ross's Landing (both swim finishes) is ~8 river miles
//     downstream of the dam.
//   - 70.3 swim starts 1.4mi upstream of Ross's Landing, cutoff 1:20 (80min).
//   - Full swim starts 2.4mi upstream of Ross's Landing, cutoff 2:20 (140min).
const GAUGE_SPAN_MILES = 8;
const RACE_SWIM = {
  "70.3": { upstreamMiles: 1.4, cutoffMinutes: 80 },
  full:   { upstreamMiles: 2.4, cutoffMinutes: 140 },
};

// Fraction of the CKTT1→CHAT1 span the swim start sits at, i.e. how much of
// the effective CFS should come from the upstream gauge vs CHAT1.
function upstreamWeight(raceType) {
  const miles = RACE_SWIM[raceType]?.upstreamMiles ?? 0;
  return Math.min(1, miles / GAUGE_SPAN_MILES);
}

// Cutoff pace (minutes allowed per swim mile), relative to 70.3's. A race
// with a more generous per-mile cutoff can tolerate a given CFS with less
// risk, so its threshold ladder should read that CFS as slightly less severe.
function paceScale(raceType) {
  const race = RACE_SWIM[raceType];
  const base = RACE_SWIM["70.3"];
  if (!race) return 1;
  return (race.cutoffMinutes / race.upstreamMiles) / (base.cutoffMinutes / base.upstreamMiles);
}

function getEffectiveCfs(chatCfs, upstreamCfs, raceType) {
  const weight = upstreamWeight(raceType);
  if (weight > 0 && chatCfs !== null && upstreamCfs !== null) {
    return Math.round(upstreamCfs * weight + chatCfs * (1 - weight));
  }
  return chatCfs;
}

async function fetchWeather() {
  const points = await fetch("https://api.weather.gov/points/35.0456,-85.3097").then(r => r.json());
  const { forecast, forecastGridData } = points.properties;

  const [daily, grid, alerts] = await Promise.all([
    fetch(forecast).then(r => r.json()),
    fetch(forecastGridData).then(r => r.json()),
    fetch("https://api.weather.gov/alerts/active?area=TN").then(r => r.json()),
  ]);

  const summary = daily.properties?.periods?.[0]?.detailedForecast || "Forecast unavailable";

  const now = Date.now();
  const sevenDaysOut = now + 7 * 24 * 60 * 60 * 1000;
  const precipMm = (grid.properties?.quantitativePrecipitation?.values ?? [])
    .filter(v => {
      const t = new Date(v.validTime.split("/")[0]).getTime();
      return t >= now && t <= sevenDaysOut;
    })
    .reduce((sum, v) => sum + (v.value || 0), 0);
  const rainInchesNext7Days = Math.round(precipMm * 0.0393701 * 10) / 10;

  const floodWarning = (alerts.features ?? []).some(f =>
    /flood/i.test(f.properties?.event ?? "") && (f.properties?.areaDesc ?? "").includes("Hamilton")
  );

  const condition = floodWarning ? "flood_warning"
    : rainInchesNext7Days > 2 ? "heavy_rain"
    : rainInchesNext7Days > 1 ? "moderate_rain"
    : rainInchesNext7Days > 0 ? "light_rain"
    : "clear";

  return { summary, rainInchesNext7Days, floodWarning, condition };
}

// ─── Probability model ────────────────────────────────────────────────────────

// Calibrated against the app's own recorded outcomes, not just guessed
// brackets: the 2025 70.3 cancellation happened at "50,000+ CFS" (see
// CANCEL_HISTORY) — that's the real failure threshold, not 35,000. The old
// ladder put 35-45k CFS at just 4% base, which combined with any weather
// penalty and the flat -9 discount floors straight to 1% ("cancelled") even
// though full IRONMAN Chattanooga swam without incident on 2026-09-27 at
// 37,000 CFS + moderate rain in the forecast. Brackets pushed out so the
// model's danger zone actually starts near the real historical failure
// point instead of ~15k CFS below it.
function cfsProbability(cfs, raceType = "70.3") {
  const adjusted = cfs / paceScale(raceType);
  if (adjusted < 15000) return 97;
  if (adjusted < 22000) return 88;
  if (adjusted < 30000) return 72;
  if (adjusted < 38000) return 50;
  if (adjusted < 45000) return 28;
  if (adjusted < 50000) return 12;
  if (adjusted < 55000) return 4;
  return 1;
}

// Labels say "7-day" explicitly because this delta is driven by
// rainInchesNext7Days (accumulated forecast precip over the coming week),
// not today's conditions — it can legitimately disagree with the "today"
// summary sentence shown elsewhere (e.g. sunny today, rain later this week).
// Panel feedback flagged the unlabeled version as reading like a bug.
const WEATHER_MODIFIERS = {
  clear:         { delta:   0, label: "Clear 7-day outlook",        icon: "sun",             color: "#4ade80" },
  light_rain:    { delta:  -5, label: "Light rain in 7-day outlook",     icon: "cloud-drizzle",   color: "#a3e635" },
  moderate_rain: { delta: -12, label: "Moderate rain in 7-day outlook",  icon: "cloud-rain",      color: "#facc15" },
  heavy_rain:    { delta: -22, label: "Heavy rain in 7-day outlook",     icon: "cloud-lightning", color: "#f97316" },
  flood_warning: { delta: -35, label: "Flood warning active",       icon: "alert-triangle",  color: "#ef4444" },
};

function calcProbability(cfs, weatherCondition, raceType = "70.3") {
  const base = cfsProbability(cfs, raceType);
  const weatherDelta = WEATHER_MODIFIERS[weatherCondition]?.delta ?? 0;
  return Math.max(1, base + weatherDelta - 9); // Chattanooga Discount™
}

// ─── Race calendar logic ─────────────────────────────────────────────────────
const RACES = [
  { name: "IRONMAN 70.3 Chattanooga", year: 2026, date: new Date("2026-05-17"), label: "May 17, 2026",   type: "70.3" },
  { name: "IRONMAN Chattanooga",      year: 2026, date: new Date("2026-09-27"), label: "~Sept 27, 2026", type: "full" },
  { name: "IRONMAN 70.3 Chattanooga", year: 2027, date: new Date("2027-05-01"), label: "TBD 2027",       type: "70.3" },
];
function getCurrentRace() {
  const now = new Date();
  // Keep a race "current" through its own race day (date-only strings parse
  // as UTC midnight, so a naive `now < date` check flips to the next race
  // hours before the current one is actually over).
  const ONE_DAY = 24 * 60 * 60 * 1000;
  return RACES.find(r => now < new Date(r.date.getTime() + ONE_DAY)) ?? RACES[RACES.length - 1];
}

// ─── Static data ──────────────────────────────────────────────────────────────

const CANCEL_HISTORY = [
  { year: 2025, event: "70.3 Chattanooga",     reason: "50,000+ CFS — river said no",   badge: "CANCELLED",        color: "#ef4444" },
  { year: 2024, event: "IRONMAN Chattanooga",  reason: "Hurricane Helene flooding",      badge: "CANCELLED",        color: "#ef4444" },
  { year: 2020, event: "70.3 Chattanooga",     reason: "COVID-19 (river just lucky)",    badge: "WHOLE RACE NUKED", color: "#a855f7" },
  { year: 2019, event: "70.3 Chattanooga",     reason: "High river flow",                badge: "SHORTENED",        color: "#f97316" },
  { year: 2018, event: "IRONMAN Chattanooga",  reason: "High water / flooding",          badge: "CANCELLED",        color: "#ef4444" },
];

// ─── Icons (authored inline, single stroke/fill weight — no emoji) ───────────

function Icon({ name, size = 20, color = "currentColor", style }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", style };

  if (name === "sun") return (
    <svg {...common} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round">
      <circle cx="12" cy="12" r="4"/>
      <line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/>
      <line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/>
      <line x1="4.9" y1="4.9" x2="6.3" y2="6.3"/><line x1="17.7" y1="17.7" x2="19.1" y2="19.1"/>
      <line x1="4.9" y1="19.1" x2="6.3" y2="17.7"/><line x1="17.7" y1="6.3" x2="19.1" y2="4.9"/>
    </svg>
  );

  if (name === "cloud-drizzle" || name === "cloud-rain" || name === "cloud-lightning") return (
    <svg {...common}>
      <circle cx="9" cy="12" r="3.4" fill={color}/>
      <circle cx="13.5" cy="10" r="4.2" fill={color}/>
      <circle cx="17" cy="12.3" r="2.6" fill={color}/>
      <rect x="6" y="12" width="12.5" height="4" rx="2" fill={color}/>
      {name === "cloud-drizzle" && (
        <g stroke={color} strokeWidth="1.75" strokeLinecap="round">
          <line x1="9" y1="19" x2="9" y2="21"/><line x1="14" y1="19" x2="14" y2="21"/>
        </g>
      )}
      {name === "cloud-rain" && (
        <g stroke={color} strokeWidth="1.75" strokeLinecap="round">
          <line x1="8" y1="19" x2="7.3" y2="22"/><line x1="12" y1="19" x2="11.3" y2="22"/><line x1="16" y1="19" x2="15.3" y2="22"/>
        </g>
      )}
      {name === "cloud-lightning" && <polygon points="13,16 9.5,21 12,21 10.5,23.5" fill={color}/>}
    </svg>
  );

  if (name === "alert-triangle") return (
    <svg {...common} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 2 20h20z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <circle cx="12" cy="16.3" r="0.9" fill={color} stroke="none"/>
    </svg>
  );

  if (name === "footprint") return (
    <svg {...common} fill="none" stroke={color} strokeWidth="1.75">
      <ellipse cx="9.5" cy="16" rx="3" ry="4"/>
      <ellipse cx="14.7" cy="8" rx="2.3" ry="3" transform="rotate(20 14.7 8)"/>
    </svg>
  );

  if (name === "bike") return (
    <svg {...common} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="17" r="3.2"/><circle cx="18" cy="17" r="3.2"/>
      <path d="M6 17 10 8h4l4 9M10 8l3 9M13 17h5"/>
    </svg>
  );

  if (name === "skull") return (
    <svg {...common}>
      <circle cx="12" cy="10.5" r="6.5" fill={color}/>
      <rect x="8.5" y="14" width="7" height="5" rx="2" fill={color}/>
      <circle cx="9.3" cy="10" r="1.6" fill="#06090f"/><circle cx="14.7" cy="10" r="1.6" fill="#06090f"/>
      <g stroke="#06090f" strokeWidth="1.2" strokeLinecap="round">
        <line x1="10" y1="18.5" x2="10" y2="20"/><line x1="12" y1="18.5" x2="12" y2="20"/><line x1="14" y1="18.5" x2="14" y2="20"/>
      </g>
    </svg>
  );

  if (name === "meh") return (
    <svg {...common} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round">
      <circle cx="12" cy="12" r="9"/>
      <circle cx="9" cy="10" r="1" fill={color} stroke="none"/><circle cx="15" cy="10" r="1" fill={color} stroke="none"/>
      <line x1="8" y1="15.5" x2="16" y2="15.5"/>
    </svg>
  );

  if (name === "map-pin") return (
    <svg {...common} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/>
      <circle cx="12" cy="10" r="2.4"/>
    </svg>
  );

  if (name === "wave") return (
    <svg {...common} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round">
      <path d="M2 13c1.8-2.6 3.6-2.6 5.4 0s3.6 2.6 5.4 0 3.6-2.6 5.4 0 3.6 2.6 5.4 0"/>
      <path d="M2 18c1.8-2.6 3.6-2.6 5.4 0s3.6 2.6 5.4 0 3.6-2.6 5.4 0 3.6 2.6 5.4 0" opacity="0.45"/>
    </svg>
  );

  if (name === "hourglass") return (
    <svg {...common} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round">
      <path d="M6 3h12l-6 9z"/><path d="M6 21h12l-6-9z"/>
    </svg>
  );

  if (name === "check") return (
    <svg {...common} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );

  if (name === "refresh") return (
    <svg {...common} fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round">
      <path d="M4 12a8 8 0 0 1 13.66-5.66M20 4v5h-5"/>
      <path d="M20 12a8 8 0 0 1-13.66 5.66M4 20v-5h5"/>
    </svg>
  );

  return null;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function getRiverStatus(cfs) {
  if (cfs < 10000) return { label: "TRICKLE",  color: "#4ade80" };
  if (cfs < 20000) return { label: "NORMAL",   color: "#a3e635" };
  if (cfs < 30000) return { label: "ELEVATED", color: "#facc15" };
  if (cfs < 40000) return { label: "HIGH",     color: "#fb923c" };
  if (cfs < 50000) return { label: "DANGER",   color: "#f87171" };
  return              { label: "RAGING",    color: "#dc2626" };
}

function getVerdict(prob) {
  if (prob >= 85) return { text: "Looks good. Don't tell anyone.",  icon: "wave",      sub: "Jinxing it is a real risk." };
  if (prob >= 65) return { text: "Nervous optimism.",               icon: "meh",       sub: "Probably fine. Probably." };
  if (prob >= 40) return { text: "Pack your running shoes.",        icon: "footprint", sub: "Might become a duathlon." };
  if (prob >= 20) return { text: "Just stretch for the bike.",      icon: "bike",      sub: "The river has opinions." };
  if (prob >= 8)  return { text: "Honestly, just bring the bike.",  icon: "bike",      sub: "History is not encouraging." };
  return               { text: "CANCELLED. It's tradition.",      icon: "skull",     sub: "The river wins again." };
}

function ProbabilityRing({ prob }) {
  const r = 80, circ = 2 * Math.PI * r;
  const color = prob >= 65 ? "#4ade80" : prob >= 35 ? "#facc15" : "#ef4444";
  return (
    <div style={{ position:"relative", width:220, height:220, margin:"0 auto" }}>
      <svg width="220" height="220" style={{ transform:"rotate(-90deg)" }}>
        <circle cx="110" cy="110" r={r} fill="none" stroke="#1e293b" strokeWidth="14"/>
        <circle cx="110" cy="110" r={r} fill="none" stroke={color} strokeWidth="14"
          strokeDasharray={`${(prob/100)*circ} ${circ}`} strokeLinecap="round"
          style={{ filter:`drop-shadow(0 0 10px ${color})`, transition:"stroke-dasharray 1.4s ease" }}/>
      </svg>
      <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", textAlign:"center", lineHeight:1 }}>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:56, color, filter:`drop-shadow(0 0 12px ${color})` }}>{prob}%</div>
        <div style={{ fontSize:11, color:"#8895ab", letterSpacing:3, marginTop:4, textTransform:"uppercase" }}>Swim Odds</div>
      </div>
    </div>
  );
}

function LoadingRing() {
  return (
    <div style={{ position:"relative", width:220, height:220, margin:"0 auto" }}>
      <svg width="220" height="220" style={{ transform:"rotate(-90deg)", animation:"spin 2s linear infinite" }}>
        <circle cx="110" cy="110" r="80" fill="none" stroke="#1e293b" strokeWidth="14"/>
        <circle cx="110" cy="110" r="80" fill="none" stroke="#f97316" strokeWidth="14"
          strokeDasharray="100 402" strokeLinecap="round" opacity="0.6"/>
      </svg>
      <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", textAlign:"center" }}>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:15, color:"#7c8aa3", letterSpacing:3 }}>LOADING</div>
      </div>
    </div>
  );
}

function Pulse({ color="#4ade80" }) {
  return <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%",
    background:color, verticalAlign:"middle", animation:"pulse 2s ease-in-out infinite" }}/>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function App() {
  const [cfs,            setCfs]           = useState(null);
  const [upstreamCfs,    setUpstreamCfs]   = useState(null);
  const [weather,        setWeather]        = useState(null);
  const [loadingRiver,   setLoadingRiver]   = useState(true);
  const [loadingWeather, setLoadingWeather] = useState(true);
  const [errorRiver,     setErrorRiver]     = useState(false);
  const [errorWeather,   setErrorWeather]   = useState(false);
  const [lastUpdated,    setLastUpdated]    = useState(null);
  const [countdown,      setCountdown]      = useState(300);

  const fetchAll = useCallback(() => {
    setLoadingRiver(true);
    setLoadingWeather(true);
    setErrorRiver(false);
    setErrorWeather(false);

    Promise.all([fetchRiverCfs(), fetchUpstreamCfs()])
      .then(([v, upstream]) => { setCfs(v); setUpstreamCfs(upstream); setErrorRiver(v === null); })
      .catch(() => { setErrorRiver(true); setCfs(null); setUpstreamCfs(null); })
      .finally(() => setLoadingRiver(false));

    fetchWeather()
      .then(w => { setWeather(w); setLastUpdated(new Date()); setCountdown(300); })
      .catch(() => setErrorWeather(true))
      .finally(() => setLoadingWeather(false));
  }, []);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 300_000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  useEffect(() => {
    const tick = setInterval(() => setCountdown(c => c <= 1 ? 300 : c - 1), 1000);
    return () => clearInterval(tick);
  }, []);

  const loading   = loadingRiver || loadingWeather;
  const condition = weather?.condition ?? "clear";
  const race      = getCurrentRace();
  const effectiveCfs = cfs !== null ? getEffectiveCfs(cfs, upstreamCfs, race.type) : null;
  const usesUpstream = upstreamWeight(race.type) > 0;
  const prob      = effectiveCfs !== null ? calcProbability(effectiveCfs, condition, race.type) : null;
  const riverSt   = effectiveCfs !== null ? getRiverStatus(effectiveCfs) : null;
  const verdict   = prob !== null ? getVerdict(prob) : null;
  const wMod      = WEATHER_MODIFIERS[condition] ?? WEATHER_MODIFIERS.clear;
  const cfsDelta  = effectiveCfs !== null ? cfsProbability(effectiveCfs, race.type) : null;
  const fmtCountdown = `${Math.floor(countdown/60)}:${String(countdown%60).padStart(2,"0")}`;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:#06090f;}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.4;transform:scale(.75);}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        @keyframes flicker{0%,97%,100%{opacity:1;}98.5%{opacity:.75;}}
        @keyframes spin{from{transform:rotate(270deg);}to{transform:rotate(630deg);}}
        .card{animation:fadeIn .55s ease both;}
        .cancel-row:hover{background:#0f172a!important;}
        .refresh-btn:hover{background:#1e293b!important;color:#94a3b8!important;}
      `}</style>

      <div style={{ minHeight:"100vh", background:"#06090f", fontFamily:"'Inter',sans-serif",
        color:"#e2e8f0", padding:"32px 16px 64px", maxWidth:700, margin:"0 auto", overflowX:"hidden" }}>

        {/* Header */}
        <div className="card" style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{
            fontFamily:"'Bebas Neue',sans-serif", fontSize:"clamp(28px,7vw,52px)", letterSpacing:4,
            lineHeight:1.15, color:"#f97316"
          }}>Will the Swim Happen?</div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:"clamp(11px,2.5vw,16px)",
            letterSpacing:5, color:"#7c8aa3", marginTop:4 }}>
            {race.name.toUpperCase()} {race.year} — OFFICIAL PESSIMISM DASHBOARD
          </div>
          <div style={{ marginTop:6, fontFamily:"'JetBrains Mono',monospace", fontSize:11,
            color:"#f97316", letterSpacing:2, opacity:.9 }}>
            PREDICTING FOR: {race.name} · {race.label}
          </div>
          <div style={{ marginTop:8, fontSize:12, color:"#334155", fontFamily:"'Inter',sans-serif" }}>
            Live river · Live weather · Refreshes every 5 min
          </div>
        </div>

        {/* Main probability card */}
        <div className="card" style={{ animationDelay:".08s",
          background:"linear-gradient(135deg,#0d1117,#0f1923)",
          border:"1px solid #1e293b", borderRadius:20, padding:"36px 24px",
          marginBottom:14, position:"relative", overflow:"hidden" }}>
          <div style={{ position:"absolute", inset:0,
            background:"radial-gradient(ellipse at 50% 0%,#f9731608 0%,transparent 60%)",
            pointerEvents:"none" }}/>

          {loading ? (
            <div style={{ textAlign:"center" }}>
              <LoadingRing/>
              <div style={{ marginTop:22, fontFamily:"'JetBrains Mono',monospace",
                fontSize:12, color:"#334155", lineHeight:2.2 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                  color: loadingRiver ? "#f97316" : "#22c55e" }}>
                  <Icon name={loadingRiver ? "hourglass" : "check"} size={13} color={loadingRiver ? "#f97316" : "#22c55e"}/>
                  <span>{loadingRiver ? "Checking Tennessee River flow…" : "River data loaded"}</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                  color: loadingWeather ? "#f97316" : "#22c55e" }}>
                  <Icon name={loadingWeather ? "hourglass" : "check"} size={13} color={loadingWeather ? "#f97316" : "#22c55e"}/>
                  <span>{loadingWeather ? "Checking Chattanooga forecast…" : "Weather loaded"}</span>
                </div>
              </div>
            </div>
          ) : prob === null ? (
            <div style={{ textAlign:"center", padding:"40px 0" }}>
              <div style={{ display:"flex", justifyContent:"center", marginBottom:12 }}>
                <Icon name="wave" size={44} color="#7c8aa3"/>
              </div>
              <div style={{ color:"#94a3b8", fontFamily:"'Inter',sans-serif", fontSize:13, lineHeight:2 }}>
                River data unavailable.<br/>Much like the swim.
              </div>
              <button className="refresh-btn" onClick={fetchAll} style={{
                marginTop:20, background:"#0f172a", border:"1px solid #1e293b",
                borderRadius:8, color:"#8895ab", padding:"8px 20px",
                fontSize:12, cursor:"pointer", fontFamily:"'JetBrains Mono',monospace",
                display:"inline-flex", alignItems:"center", gap:6 }}>
                <Icon name="refresh" size={12} color="#8895ab"/>Try again
              </button>
            </div>
          ) : (
            <>
              <ProbabilityRing prob={prob ?? 50}/>

              {/* Verdict */}
              <div style={{ textAlign:"center", marginTop:26 }}>
                <div style={{ display:"flex", justifyContent:"center", marginBottom:8 }}>
                  <Icon name={verdict.icon} size={38} color="#f1f5f9"/>
                </div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif",
                  fontSize:"clamp(20px,5vw,30px)", letterSpacing:2,
                  color:"#f1f5f9", animation:"flicker 7s infinite" }}>{verdict.text}</div>
                <div style={{ color:"#7c8aa3", fontSize:13, marginTop:6, fontStyle:"italic" }}>
                  {verdict.sub}
                </div>
              </div>

              {/* Breakdown */}
              <div style={{ marginTop:28, background:"#0a0f1a", border:"1px solid #1e293b",
                borderRadius:14, padding:"16px 18px" }}>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10,
                  color:"#334155", letterSpacing:2, marginBottom:12 }}>PROBABILITY BREAKDOWN</div>
                {[
                  { label:"River CFS base",          value:`${cfsDelta ?? "—"}%`,   color:"#94a3b8",  bold:false },
                  { label:`Weather · ${wMod.label}`, value:`${wMod.delta > 0 ? "+" : ""}${wMod.delta}%`, color:wMod.color, bold:false },
                  { label:"Chattanooga Discount™",   value:"−9%",                   color:"#ef444466", bold:false },
                  { label:"FINAL ODDS",              value:`${prob ?? "—"}%`,
                    color: prob >= 65 ? "#4ade80" : prob >= 35 ? "#facc15" : "#ef4444", bold:true },
                ].map(row => (
                  <div key={row.label} style={{ display:"flex", justifyContent:"space-between",
                    alignItems:"center",
                    borderTop: row.bold ? "1px solid #1e293b" : "none",
                    paddingTop: row.bold ? 8 : 0, marginBottom: row.bold ? 0 : 7 }}>
                    <span style={{ fontFamily:"'JetBrains Mono',monospace",
                      fontSize: row.bold ? 12 : 11,
                      color: row.bold ? "#e2e8f0" : "#7c8aa3",
                      fontWeight: row.bold ? 700 : 400 }}>{row.label}</span>
                    <span style={{ fontFamily:"'JetBrains Mono',monospace",
                      fontSize: row.bold ? 15 : 11, color:row.color, fontWeight: row.bold ? 700 : 400,
                      filter: row.bold ? `drop-shadow(0 0 6px ${row.color})` : "none"
                    }}>{row.value}</span>
                  </div>
                ))}
              </div>

              {/* Data tiles */}
              <div style={{ marginTop:12, display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div style={{ background:"#0a0f1a",
                  border:`1px solid ${riverSt?.color ?? "#1e293b"}28`,
                  borderRadius:12, padding:"14px", textAlign:"center" }}>
                  {errorRiver ? (
                    <div style={{ color:"#8895ab", fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}>
                      River data unavailable
                    </div>
                  ) : (
                    <>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace",
                        fontSize:"clamp(20px,4vw,30px)", fontWeight:700,
                        color:riverSt.color, filter:`drop-shadow(0 0 6px ${riverSt.color})` }}>
                        {effectiveCfs?.toLocaleString()}
                      </div>
                      <div style={{ fontSize:10, color:"#7c8aa3", letterSpacing:3, marginTop:3 }}>
                        CFS · {riverSt.label}
                      </div>
                      {usesUpstream && (
                        <div style={{ fontSize:9, color:"#334155", marginTop:4, fontFamily:"'JetBrains Mono',monospace" }}>
                          {upstreamCfs !== null
                            ? `↑ blended w/ CKTT1 upstream (${upstreamCfs.toLocaleString()} CFS)`
                            : "↑ CKTT1 upstream: unavailable — using CHAT1 only"}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div style={{ background:"#0a0f1a", border:`1px solid ${wMod.color}28`,
                  borderRadius:12, padding:"14px", textAlign:"center" }}>
                  {errorWeather ? (
                    <div style={{ color:"#8895ab", fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}>
                      Weather unavailable
                    </div>
                  ) : (
                    <>
                      <div style={{ display:"flex", justifyContent:"center" }}>
                        <Icon name={wMod.icon} size={28} color={wMod.color}/>
                      </div>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10,
                        color:wMod.color, letterSpacing:2, marginTop:5 }}>
                        {weather?.rainInchesNext7Days != null
                          ? `${weather.rainInchesNext7Days}" / 7 days`
                          : "Weather loaded"}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Weather summary */}
              {weather?.summary && !errorWeather && (
                <div style={{ marginTop:10, background:"#0a0f1a", border:"1px solid #1e293b",
                  borderRadius:12, padding:"11px 15px", display:"flex", gap:8, alignItems:"flex-start",
                  fontFamily:"'Inter',sans-serif", fontSize:11,
                  color:"#8895ab", fontStyle:"italic", lineHeight:1.6 }}>
                  <Icon name="map-pin" size={13} color="#7c8aa3" style={{ flexShrink:0, marginTop:3 }}/>
                  <span><strong style={{ fontStyle:"normal", color:"#94a3b8" }}>Today: </strong>{weather.summary}</span>
                </div>
              )}

              {/* CFS bar */}
              {!errorRiver && (
                <div style={{ marginTop:14 }}>
                  <div style={{ height:7, borderRadius:6, position:"relative",
                    background:"linear-gradient(90deg,#22c55e 0%,#a3e635 25%,#facc15 50%,#f97316 70%,#ef4444 85%,#dc2626 100%)" }}>
                    <div style={{
                      position:"absolute", left:`${Math.min(98,(effectiveCfs/60000)*100)}%`,
                      top:"50%", transform:"translate(-50%,-50%)",
                      width:13, height:13, background:"#fff", borderRadius:"50%",
                      border:`2px solid ${riverSt.color}`,
                      boxShadow:`0 0 8px ${riverSt.color}`, transition:"left 1.2s ease"
                    }}/>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:4,
                    fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#7c8aa3" }}>
                    <span>0</span><span>20K safe</span><span>40K</span><span>60K+ cancel</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Live indicator */}
        <div className="card" style={{ animationDelay:".18s", display:"flex", alignItems:"center",
          justifyContent:"space-between", padding:"11px 18px", background:"#0d1117",
          border:"1px solid #1e293b", borderRadius:12, marginBottom:16, gap:10, flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <Pulse color={loading ? "#f97316" : "#4ade80"}/>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11,
              color: loading ? "#f97316" : "#4ade80" }}>
              {loading ? "FETCHING" : "LIVE"}
            </span>
            {lastUpdated && !loading && (
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#8895ab" }}>
                · {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1, minWidth:120 }}>
            <div style={{ flex:1, height:3, background:"#1e293b", borderRadius:4, overflow:"hidden" }}>
              <div style={{ height:"100%", width:"100%", transformOrigin:"left",
                transform:`scaleX(${(300-countdown)/300})`,
                background:"linear-gradient(90deg,#f97316,#facc15)", transition:"transform 1s linear" }}/>
            </div>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10,
              color:"#8895ab", whiteSpace:"nowrap" }}>{fmtCountdown}</span>
          </div>
          <button className="refresh-btn" onClick={fetchAll} disabled={loading} style={{
            background:"#0f172a", border:"1px solid #1e293b", borderRadius:8,
            color: loading ? "#1e293b" : "#8895ab", padding:"5px 12px", fontSize:11,
            cursor: loading ? "default" : "pointer", display:"inline-flex", alignItems:"center", gap:6,
            fontFamily:"'JetBrains Mono',monospace", letterSpacing:1, transition:"all .2s" }}>
            <Icon name="refresh" size={11} color={loading ? "#1e293b" : "#8895ab"}/>REFRESH
          </button>
        </div>

        {/* Hall of Shame */}
        <div className="card" style={{ animationDelay:".28s" }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:4,
            color:"#7c8aa3", marginBottom:12, display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ display:"inline-block", width:4, height:18, background:"#f97316", borderRadius:2 }}/>
            HALL OF SHAME
          </div>
          <div style={{ background:"#0d1117", border:"1px solid #1e293b", borderRadius:16, overflow:"hidden" }}>
            {CANCEL_HISTORY.map((row, i) => (
              <div key={row.year} className="cancel-row" style={{
                padding:"13px 16px",
                borderBottom: i < CANCEL_HISTORY.length-1 ? "1px solid #0a0f1a" : "none",
                background:"transparent", transition:"background .2s",
                animation:"fadeIn .5s ease both", animationDelay:`${.32+i*.06}s` }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ minWidth:0, flex:1 }}>
                    <div style={{ fontSize:14, color:"#e2e8f0", fontWeight:600 }}>{row.event}</div>
                    <div style={{ fontSize:11, color:"#8895ab", marginTop:3 }}>
                      <span style={{ fontFamily:"'JetBrains Mono',monospace", color:"#94a3b8" }}>{row.year}</span>
                      <span style={{ color:"#334155", margin:"0 6px" }}>·</span>
                      <span style={{ fontStyle:"italic" }}>{row.reason}</span>
                    </div>
                  </div>
                  <span style={{ background:`${row.color}18`, border:`1px solid ${row.color}40`,
                    color:row.color, borderRadius:6, padding:"4px 8px",
                    fontSize:9, fontFamily:"'JetBrains Mono',monospace",
                    letterSpacing:1, whiteSpace:"nowrap", fontWeight:700, flexShrink:0 }}>{row.badge}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:10, textAlign:"center", fontFamily:"'JetBrains Mono',monospace",
            fontSize:11, color:"#334155" }}>
            5 events · 4 cancellations · 1 shortened · 0 refunds
          </div>
        </div>

        {/* Footer */}
        <div className="card" style={{ animationDelay:".5s", marginTop:32, textAlign:"center",
          fontSize:10, lineHeight:2 }}>
          <div style={{ fontFamily:"'Inter',sans-serif", color:"#334155" }}>
            Not affiliated with IRONMAN, WTC, or anyone who swims faster than a 3 mph current.
          </div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", color:"#334155" }}>
            River: NOAA NWPS CHAT1 / CKTT1 · Weather: NWS Chattanooga
          </div>
          <div style={{ fontFamily:"'Inter',sans-serif", color:"#1e293b" }}>
            The Chattanooga Discount™ is real and legally binding.
          </div>
        </div>

      </div>
    </>
  );
}
