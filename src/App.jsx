import { useState, useEffect, useCallback } from "react";

// ─── Data fetching via Anthropic API (CSP blocks direct external fetches) ────

async function callClaude(systemPrompt, userMessage) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const textBlock = [...(data.content || [])].reverse().find(b => b.type === "text");
  if (!textBlock?.text) throw new Error("no text block");
  const clean = textBlock.text.replace(/```json[\s\S]*?```|```/g, "").trim();
  const match = clean.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error("no JSON found");
  return JSON.parse(match[0]);
}

async function fetchRiverCfs() {
  const json = await callClaude(
    `You are a data extraction bot. Search USGS for current river flow data, then respond ONLY with valid JSON: {"cfs": <number or null>}. No markdown, no explanation.`,
    "What is the current Tennessee River discharge in cubic feet per second at USGS gauge 03568000 near Chattanooga TN? Return only JSON."
  );
  return typeof json.cfs === "number" ? Math.round(json.cfs) : null;
}

async function fetchWeather() {
  const json = await callClaude(
    `You are a weather data extraction bot. Search for current Chattanooga TN weather and 7-day forecast, then respond ONLY with valid JSON in this exact shape:
{"summary": "<1 sentence>", "rainInchesNext7Days": <number or null>, "floodWarning": <true or false>, "condition": "<clear|light_rain|moderate_rain|heavy_rain|flood_warning>"}
No markdown, no explanation. Pick condition based on: flood_warning if any active flood/flash flood watch or warning; heavy_rain if >2 inches total rain expected in 7 days; moderate_rain if 1-2 inches; light_rain if under 1 inch; clear otherwise.`,
    "What is the current weather forecast for Chattanooga TN for the next 7 days? Any flood watches or warnings active? How much total rain is expected? Return only JSON."
  );
  return {
    summary: json.summary || "Forecast unavailable",
    rainInchesNext7Days: typeof json.rainInchesNext7Days === "number" ? json.rainInchesNext7Days : null,
    floodWarning: json.floodWarning === true,
    condition: json.condition || "clear",
  };
}

// ─── Probability model ────────────────────────────────────────────────────────

function cfsProbability(cfs) {
  if (cfs < 8000)  return 97;
  if (cfs < 12000) return 88;
  if (cfs < 16000) return 72;
  if (cfs < 20000) return 52;
  if (cfs < 25000) return 28;
  if (cfs < 35000) return 12;
  if (cfs < 45000) return 4;
  if (cfs < 50000) return 2;
  return 1;
}

const WEATHER_MODIFIERS = {
  clear:         { delta:   0, label: "Clear skies",             icon: "☀️",  color: "#4ade80" },
  light_rain:    { delta:  -5, label: "Light rain expected",     icon: "🌦️",  color: "#a3e635" },
  moderate_rain: { delta: -12, label: "Moderate rain ahead",     icon: "🌧️",  color: "#facc15" },
  heavy_rain:    { delta: -22, label: "Heavy rain forecast",     icon: "⛈️",  color: "#f97316" },
  flood_warning: { delta: -35, label: "⚠️ Flood warning active", icon: "🚨",  color: "#ef4444" },
};

function calcProbability(cfs, weatherCondition) {
  const base = cfsProbability(cfs);
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
  return RACES.find(r => now < r.date) ?? RACES[RACES.length - 1];
}

// ─── Static data ──────────────────────────────────────────────────────────────

const CANCEL_HISTORY = [
  { year: 2025, event: "70.3 Chattanooga",     reason: "50,000+ CFS — river said no",   badge: "CANCELLED",        color: "#ef4444" },
  { year: 2024, event: "IRONMAN Chattanooga",  reason: "Hurricane Helene flooding",      badge: "CANCELLED",        color: "#ef4444" },
  { year: 2020, event: "70.3 Chattanooga",     reason: "COVID-19 (river just lucky)",    badge: "WHOLE RACE NUKED", color: "#a855f7" },
  { year: 2019, event: "70.3 Chattanooga",     reason: "High river flow",                badge: "SHORTENED",        color: "#f97316" },
  { year: 2018, event: "IRONMAN Chattanooga",  reason: "High water / flooding",          badge: "CANCELLED",        color: "#ef4444" },
];

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
  if (prob >= 85) return { text: "Looks good. Don't tell anyone.",  icon: "🏊‍♂️", sub: "Jinxing it is a real risk." };
  if (prob >= 65) return { text: "Nervous optimism.",               icon: "😬",   sub: "Probably fine. Probably." };
  if (prob >= 40) return { text: "Pack your running shoes.",        icon: "👟",   sub: "Might become a duathlon." };
  if (prob >= 20) return { text: "Just stretch for the bike.",      icon: "🚴",   sub: "The river has opinions." };
  if (prob >= 8)  return { text: "Honestly, just bring the bike.",  icon: "🚲",   sub: "History is not encouraging." };
  return               { text: "CANCELLED. It's tradition.",      icon: "💀",   sub: "The river wins again." };
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
        <div style={{ fontSize:11, color:"#64748b", letterSpacing:3, marginTop:4, textTransform:"uppercase" }}>Swim Odds</div>
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
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:15, color:"#475569", letterSpacing:3 }}>LOADING</div>
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

    fetchRiverCfs()
      .then(v => { setCfs(v); setErrorRiver(v === null); })
      .catch(() => { setErrorRiver(true); setCfs(null); })
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
  const prob      = cfs !== null ? calcProbability(cfs, condition) : null;
  const riverSt   = cfs !== null ? getRiverStatus(cfs) : null;
  const verdict   = prob !== null ? getVerdict(prob) : null;
  const wMod      = WEATHER_MODIFIERS[condition] ?? WEATHER_MODIFIERS.clear;
  const cfsDelta  = cfs !== null ? cfsProbability(cfs) : null;
  const fmtCountdown = `${Math.floor(countdown/60)}:${String(countdown%60).padStart(2,"0")}`;
  const race      = getCurrentRace();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:#06090f;}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.4;transform:scale(.75);}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
        @keyframes shimmer{0%{background-position:-200% center;}100%{background-position:200% center;}}
        @keyframes flicker{0%,97%,100%{opacity:1;}98.5%{opacity:.75;}}
        @keyframes spin{from{transform:rotate(270deg);}to{transform:rotate(630deg);}}
        .card{animation:fadeIn .55s ease both;}
        .cancel-row:hover{background:#0f172a!important;}
        .refresh-btn:hover{background:#1e293b!important;color:#94a3b8!important;}
      `}</style>

      <div style={{ minHeight:"100vh", background:"#06090f", fontFamily:"'Inter',sans-serif",
        color:"#e2e8f0", padding:"32px 16px 64px", maxWidth:700, margin:"0 auto" }}>

        {/* Header */}
        <div className="card" style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{
            fontFamily:"'Bebas Neue',sans-serif", fontSize:"clamp(28px,7vw,52px)", letterSpacing:4,
            background:"linear-gradient(90deg,#f97316,#fbbf24,#f97316)",
            backgroundSize:"200% auto", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            animation:"shimmer 4s linear infinite"
          }}>Will the Swim Happen?</div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:"clamp(11px,2.5vw,16px)",
            letterSpacing:5, color:"#334155", marginTop:4 }}>
            {race.name.toUpperCase()} {race.year} — OFFICIAL PESSIMISM DASHBOARD
          </div>
          <div style={{ marginTop:6, fontFamily:"'JetBrains Mono',monospace", fontSize:11,
            color:"#f97316", letterSpacing:2, opacity:.7 }}>
            PREDICTING FOR: {race.name} · {race.label}
          </div>
          <div style={{ marginTop:8, fontSize:12, color:"#1e293b", fontFamily:"'JetBrains Mono',monospace" }}>
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
                <div style={{ color: loadingRiver  ? "#f97316" : "#22c55e" }}>
                  {loadingRiver  ? "⏳ Checking Tennessee River flow…" : "✓ River data loaded"}
                </div>
                <div style={{ color: loadingWeather ? "#f97316" : "#22c55e" }}>
                  {loadingWeather ? "⏳ Checking Chattanooga forecast…" : "✓ Weather loaded"}
                </div>
                <div style={{ marginTop:10, color:"#1e293b", fontSize:10 }}>
                  (web search takes ~10 seconds — hang tight)
                </div>
              </div>
            </div>
          ) : prob === null ? (
            <div style={{ textAlign:"center", padding:"40px 0" }}>
              <div style={{ fontSize:42, marginBottom:12 }}>🌊</div>
              <div style={{ color:"#94a3b8", fontFamily:"'JetBrains Mono',monospace", fontSize:13, lineHeight:2 }}>
                River data unavailable.<br/>Much like the swim.
              </div>
              <button className="refresh-btn" onClick={fetchAll} style={{
                marginTop:20, background:"#0f172a", border:"1px solid #1e293b",
                borderRadius:8, color:"#64748b", padding:"8px 20px",
                fontSize:12, cursor:"pointer", fontFamily:"'JetBrains Mono',monospace" }}>
                ↻ Try again
              </button>
            </div>
          ) : (
            <>
              <ProbabilityRing prob={prob ?? 50}/>

              {/* Verdict */}
              <div style={{ textAlign:"center", marginTop:26 }}>
                <div style={{ fontSize:38, marginBottom:8 }}>{verdict.icon}</div>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif",
                  fontSize:"clamp(20px,5vw,30px)", letterSpacing:2,
                  color:"#f1f5f9", animation:"flicker 7s infinite" }}>{verdict.text}</div>
                <div style={{ color:"#475569", fontSize:13, marginTop:6, fontStyle:"italic" }}>
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
                      color: row.bold ? "#e2e8f0" : "#475569",
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
                    <div style={{ color:"#334155", fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}>
                      River data unavailable
                    </div>
                  ) : (
                    <>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace",
                        fontSize:"clamp(20px,4vw,30px)", fontWeight:700,
                        color:riverSt.color, filter:`drop-shadow(0 0 6px ${riverSt.color})` }}>
                        {cfs?.toLocaleString()}
                      </div>
                      <div style={{ fontSize:10, color:"#475569", letterSpacing:3, marginTop:3 }}>
                        CFS · {riverSt.label}
                      </div>
                    </>
                  )}
                </div>
                <div style={{ background:"#0a0f1a", border:`1px solid ${wMod.color}28`,
                  borderRadius:12, padding:"14px", textAlign:"center" }}>
                  {errorWeather ? (
                    <div style={{ color:"#334155", fontSize:11, fontFamily:"'JetBrains Mono',monospace" }}>
                      Weather unavailable
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize:26 }}>{wMod.icon}</div>
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
                  borderRadius:12, padding:"11px 15px",
                  fontFamily:"'JetBrains Mono',monospace", fontSize:11,
                  color:"#475569", fontStyle:"italic", lineHeight:1.6 }}>
                  📍 {weather.summary}
                </div>
              )}

              {/* CFS bar */}
              {!errorRiver && (
                <div style={{ marginTop:14 }}>
                  <div style={{ height:7, borderRadius:6, position:"relative",
                    background:"linear-gradient(90deg,#22c55e 0%,#a3e635 25%,#facc15 50%,#f97316 70%,#ef4444 85%,#dc2626 100%)" }}>
                    <div style={{
                      position:"absolute", left:`${Math.min(98,(cfs/60000)*100)}%`,
                      top:"50%", transform:"translate(-50%,-50%)",
                      width:13, height:13, background:"#fff", borderRadius:"50%",
                      border:`2px solid ${riverSt.color}`,
                      boxShadow:`0 0 8px ${riverSt.color}`, transition:"left 1.2s ease"
                    }}/>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:4,
                    fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#1e293b" }}>
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
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#334155" }}>
                · {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1, minWidth:120 }}>
            <div style={{ flex:1, height:3, background:"#1e293b", borderRadius:4, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${((300-countdown)/300)*100}%`,
                background:"linear-gradient(90deg,#f97316,#facc15)", transition:"width 1s linear" }}/>
            </div>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10,
              color:"#334155", whiteSpace:"nowrap" }}>{fmtCountdown}</span>
          </div>
          <button className="refresh-btn" onClick={fetchAll} disabled={loading} style={{
            background:"#0f172a", border:"1px solid #1e293b", borderRadius:8,
            color: loading ? "#1e293b" : "#64748b", padding:"5px 12px", fontSize:11,
            cursor: loading ? "default" : "pointer",
            fontFamily:"'JetBrains Mono',monospace", letterSpacing:1, transition:"all .2s" }}>
            ↻ REFRESH
          </button>
        </div>

        {/* Hall of Shame */}
        <div className="card" style={{ animationDelay:".28s" }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:20, letterSpacing:4,
            color:"#475569", marginBottom:12, display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ color:"#f97316" }}>▌</span> HALL OF SHAME
          </div>
          <div style={{ background:"#0d1117", border:"1px solid #1e293b", borderRadius:16, overflow:"hidden" }}>
            <div style={{ display:"grid", gridTemplateColumns:"60px 1fr auto",
              padding:"10px 16px", borderBottom:"1px solid #1e293b",
              fontFamily:"'JetBrains Mono',monospace", fontSize:10,
              color:"#334155", letterSpacing:2, textTransform:"uppercase" }}>
              <span>Year</span><span>Reason</span><span>Verdict</span>
            </div>
            {CANCEL_HISTORY.map((row, i) => (
              <div key={row.year} className="cancel-row" style={{
                display:"grid", gridTemplateColumns:"60px 1fr auto", gap:8,
                padding:"13px 16px",
                borderBottom: i < CANCEL_HISTORY.length-1 ? "1px solid #0a0f1a" : "none",
                alignItems:"center", background:"transparent", transition:"background .2s",
                animation:"fadeIn .5s ease both", animationDelay:`${.32+i*.06}s` }}>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, color:"#94a3b8" }}>
                  {row.year}
                </div>
                <div>
                  <div style={{ fontSize:12, color:"#94a3b8", fontWeight:500 }}>{row.event}</div>
                  <div style={{ fontSize:11, color:"#475569", marginTop:2, fontStyle:"italic" }}>{row.reason}</div>
                </div>
                <div style={{ background:`${row.color}18`, border:`1px solid ${row.color}40`,
                  color:row.color, borderRadius:6, padding:"4px 8px",
                  fontSize:9, fontFamily:"'JetBrains Mono',monospace",
                  letterSpacing:1, whiteSpace:"nowrap", fontWeight:700 }}>{row.badge}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:10, textAlign:"center", fontFamily:"'JetBrains Mono',monospace",
            fontSize:11, color:"#1e293b" }}>
            5 events · 4 cancellations · 1 shortened · 0 refunds
          </div>
        </div>

        {/* Footer */}
        <div className="card" style={{ animationDelay:".5s", marginTop:32, textAlign:"center",
          fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:"#1e293b", lineHeight:2 }}>
          <div>Not affiliated with IRONMAN, WTC, or anyone who swims faster than a 3 mph current.</div>
          <div>River: USGS NWIS Gauge 03568000 · Weather: NWS Chattanooga</div>
          <div style={{ color:"#0f172a" }}>The Chattanooga Discount™ is real and legally binding.</div>
        </div>

      </div>
    </>
  );
}
