import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_BASE = import.meta.env.VITE_LARAVEL_API_BASE_URL || "http://localhost:8000/api";

// ── helpers ───────────────────────────────────────────────────────────────────
function ts() { return new Date().toLocaleTimeString(); }
function statusColor(c) {
  if (!c) return "#94a3b8";
  if (c < 300) return "#10b981";
  if (c < 400) return "#f59e0b";
  return "#ef4444";
}
function prettyXml(str = "") {
  try {
    let d = 0;
    return str
      .replace(/>\s*</g, ">\n<")
      .split("\n")
      .map((l) => {
        l = l.trim();
        if (!l) return "";
        if (l.startsWith("</")) d--;
        const line = "  ".repeat(Math.max(0, d)) + l;
        if (l.startsWith("<") && !l.startsWith("</") && !l.startsWith("<?") && !l.endsWith("/>")) d++;
        return line;
      })
      .join("\n");
  } catch { return str; }
}
function prettyJson(v) {
  if (!v) return "";
  try { return JSON.stringify(typeof v === "string" ? JSON.parse(v) : v, null, 2); } catch { return String(v); }
}

// ── Twilio mock data builders ─────────────────────────────────────────────────
function buildInboundForm(from) {
  return new URLSearchParams({
    CallSid:       "CA" + Math.random().toString(36).slice(2, 12).toUpperCase(),
    AccountSid:    "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    From:          from || "+94771234567",
    To:            "+94112345678",
    Direction:     "inbound",
    CallStatus:    "ringing",
    ApiVersion:    "2010-04-01",
    Timestamp:     new Date().toUTCString(),
  });
}

function buildTurnForm(callId, recordingUrl, recordingSid) {
  return new URLSearchParams({
    CallSid:            "CA" + Math.random().toString(36).slice(2, 12).toUpperCase(),
    RecordingSid:       recordingSid || "RE" + Math.random().toString(36).slice(2, 12).toUpperCase(),
    RecordingUrl:       recordingUrl || "https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE_DEMO",
    RecordingDuration:  "5",
    RecordingStatus:    "completed",
    Digits:             "",
  });
}

// ── sub-components ────────────────────────────────────────────────────────────

function LogEntry({ entry }) {
  const [open, setOpen] = useState(false);
  const sc = statusColor(entry.status);
  return (
    <div style={{ border: "1px solid rgba(15,23,42,0.08)", borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
      <div
        onClick={() => setOpen((x) => !x)}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: "#f8fafc", cursor: "pointer" }}
      >
        <span style={{ fontSize: 10, fontWeight: 800, color: "#64748b" }}>{entry.time}</span>
        <span style={{ fontSize: 10, fontWeight: 800, background: `${sc}18`, color: sc, padding: "2px 8px", borderRadius: 20, border: `1px solid ${sc}30` }}>
          {entry.status || "—"}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#1e293b", flex: 1 }}>{entry.label}</span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>{entry.ms}ms</span>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "12px 14px", background: "#fff", display: "flex", flexDirection: "column", gap: 8 }}>
          {entry.twiml && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6366f1", textTransform: "uppercase", marginBottom: 5 }}>TwiML Response</div>
              <pre style={{ margin: 0, background: "#0f172a", color: "#7dd3fc", borderRadius: 10, padding: "12px 14px", fontSize: 11, lineHeight: 1.6, overflow: "auto", maxHeight: 240, whiteSpace: "pre-wrap" }}>
                {prettyXml(entry.twiml)}
              </pre>
            </div>
          )}
          {entry.error && (
            <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#dc2626" }}>
              {entry.error}
            </div>
          )}
          {entry.callId && (
            <div style={{ fontSize: 11, color: "#6366f1", fontFamily: "monospace", background: "rgba(99,102,241,0.05)", padding: "6px 12px", borderRadius: 8 }}>
              Call ID: {entry.callId}
            </div>
          )}
          {entry.note && (
            <div style={{ fontSize: 11, color: "#64748b" }}>{entry.note}</div>
          )}
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, color }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "6px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────
export default function PhoneApiTestPage() {
  // ── config
  const [baseUrl,     setBaseUrl]     = useState(DEFAULT_BASE);
  const [callerNum,   setCallerNum]   = useState("+94771234567");
  const [recordUrl,   setRecordUrl]   = useState("");
  const [configOpen,  setConfigOpen]  = useState(true);

  // ── active call state
  const [callId,      setCallId]      = useState("");
  const [callPhase,   setCallPhase]   = useState("idle"); // idle|session|active|package-wait|ended
  const [profile,     setProfile]     = useState(null);
  const [turnCount,   setTurnCount]   = useState(0);

  // ── log
  const [log,         setLog]         = useState([]);

  // ── audio simulator
  const [simAudioFile, setSimAudioFile] = useState(null);
  const [simTranscript, setSimTranscript] = useState("I need to plan a trip to Sri Lanka for 5 days next month, two people");
  const [inputMode,    setInputMode]   = useState("transcript"); // transcript | audio

  // ── live calls list
  const [liveCalls,   setLiveCalls]   = useState([]);
  const [liveBusy,    setLiveBusy]    = useState(false);

  // ── package wait polling
  const pollRef = useRef(null);

  // ── webhook direct test
  const [wh, setWh] = useState({ url: `${DEFAULT_BASE}/twilio/inbound`, method: "POST", body: "", resp: null, busy: false, ms: 0 });

  // ── busy
  const [busy, setBusy] = useState(false);

  // ── stats
  const total   = log.length;
  const success = log.filter((l) => l.status && l.status < 300).length;
  const errors  = log.filter((l) => l.status && l.status >= 300).length;
  const avgMs   = log.length ? Math.round(log.reduce((a, l) => a + (l.ms || 0), 0) / log.length) : 0;

  function addLog(entry) {
    setLog((p) => [entry, ...p]);
  }

  // ── update webhook URL when base changes
  useEffect(() => {
    setWh((w) => ({ ...w, url: `${baseUrl}/twilio/inbound` }));
  }, [baseUrl]);

  // ─── STEP 1: Start call (simulate inbound) ────────────────────────────────
  const startCall = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setCallPhase("session");
    setProfile(null);
    setTurnCount(0);

    const t0  = performance.now();
    const url = `${baseUrl}/twilio/inbound`;
    const body = buildInboundForm(callerNum);

    try {
      const res  = await fetch(url, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      const text = await res.text();
      const ms   = Math.round(performance.now() - t0);

      // Extract call_id from TwiML action URL
      const match = text.match(/call_id=([A-Z0-9\-]+)/);
      const id    = match ? decodeURIComponent(match[1]) : "";
      if (id) setCallId(id);
      setCallPhase(id ? "active" : "idle");

      addLog({ time: ts(), label: "▶ Inbound Call Started", status: res.status, twiml: text, ms, callId: id });
      return id;
    } catch (e) {
      addLog({ time: ts(), label: "▶ Inbound Call", status: 0, error: e.message, ms: Math.round(performance.now() - t0) });
      setCallPhase("idle");
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, baseUrl, callerNum]);

  // ─── STEP 2: Send turn ────────────────────────────────────────────────────
  const sendTurn = useCallback(async (currentCallId) => {
    const id = currentCallId || callId;
    if (!id || busy) return;
    setBusy(true);

    const t0   = performance.now();
    const url  = `${baseUrl}/twilio/turn?call_id=${encodeURIComponent(id)}`;

    let formBody;
    if (inputMode === "audio" && simAudioFile) {
      // Send actual audio file as a recording (simulate Twilio with a local file URL)
      // We send the file to /api/proxy or use transcript fallback
      const fd = new FormData();
      fd.append("call_id", id);
      fd.append("audio", simAudioFile);
      // Use the V01 turn endpoint directly for audio (same AI logic, returns JSON)
      const apiRes = await fetch(`${baseUrl}/aahaas-assistent-v01/turn`, { method: "POST", body: fd });
      const data   = await apiRes.json().catch(() => ({}));
      const ms     = Math.round(performance.now() - t0);

      if (data.customer_profile) setProfile(data.customer_profile);
      setTurnCount((c) => c + 1);
      if (data.should_end) setCallPhase("ended");

      addLog({
        time: ts(), label: `🎤 Audio Turn ${turnCount + 1}`,
        status: apiRes.status, ms,
        callId: id,
        note: `Transcript: "${data.transcript || "(empty)"}" | Reply: "${data.reply?.slice(0, 80) || ""}..." | WaitPkg: ${data.wait_for_package}`,
        twiml: JSON.stringify({ reply: data.reply, should_end: data.should_end, wait: data.wait_for_package }, null, 2),
      });
      setBusy(false);
      return;
    }

    // ── Transcript mode: simulate Twilio recording callback ──────────────────
    // Since we can't give Twilio a real recording URL, we call the V01 turn
    // with a transcript directly, which mirrors what Twilio would do after Whisper.
    const fd2 = new FormData();
    fd2.append("call_id", id);
    fd2.append("transcript", simTranscript || "Hello, I need some help");

    const apiRes = await fetch(`${baseUrl}/aahaas-assistent-v01/turn`, { method: "POST", body: fd2 });
    const data   = await apiRes.json().catch(() => ({}));
    const ms     = Math.round(performance.now() - t0);

    if (data.customer_profile) setProfile(data.customer_profile);
    setTurnCount((c) => c + 1);

    if (data.wait_for_package) {
      setCallPhase("package-wait");
      startPackagePoll(id);
    } else if (data.should_end) {
      setCallPhase("ended");
    }

    addLog({
      time: ts(),
      label: `💬 Turn ${turnCount + 1} — Transcript→AI`,
      status: apiRes.status,
      ms,
      callId: id,
      note: `Transcript: "${simTranscript}" | Reply: "${data.reply?.slice(0, 100) || ""}" | End: ${data.should_end} | WaitPkg: ${data.wait_for_package} | PkgStatus: ${data.package_lookup_status}`,
      twiml: apiRes.status < 300
        ? `<!-- What Twilio receives -->\n<Response>\n  <Play>[AI_AUDIO_URL]</Play>\n  ${data.should_end ? "<Hangup/>" : data.wait_for_package ? "<Redirect>[/package-wait]</Redirect>" : '<Record action="[TURN_URL]" maxLength="25" timeout="3"/>'}\n</Response>`
        : data.message || "Error",
    });

    setBusy(false);
  }, [callId, busy, baseUrl, inputMode, simAudioFile, simTranscript, turnCount]);

  // ─── Package status polling ───────────────────────────────────────────────
  function startPackagePoll(id) {
    stopPackagePoll();
    pollRef.current = window.setInterval(async () => {
      const t0  = performance.now();
      const res = await fetch(`${baseUrl}/aahaas-assistent-v01/package-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ call_id: id }),
      });
      const data = await res.json().catch(() => ({}));
      const ms   = Math.round(performance.now() - t0);

      addLog({
        time: ts(),
        label: `📦 Package Poll — ${data.package_lookup_status || "pending"}`,
        status: res.status, ms, callId: id,
        note: `Status: ${data.package_lookup_status} | Ready: ${data.ready} | Failed: ${data.failed}`,
      });

      if (data.ready || data.failed) {
        stopPackagePoll();
        if (data.customer_profile) setProfile(data.customer_profile);
        setCallPhase("active");
      }
    }, 3000);
  }

  function stopPackagePoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => () => stopPackagePoll(), []);

  // ─── End call ─────────────────────────────────────────────────────────────
  const endCall = useCallback(async () => {
    const id = callId;
    if (!id || busy) return;
    setBusy(true);
    stopPackagePoll();

    const t0  = performance.now();
    const res = await fetch(`${baseUrl}/aahaas-assistent-v01/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ call_id: id, ended_reason: "manual_hangup" }),
    }).catch(() => null);

    const data = res ? await res.json().catch(() => ({})) : {};
    const ms   = Math.round(performance.now() - t0);

    setCallPhase("ended");
    addLog({
      time: ts(),
      label: "📵 Call Ended — Final Report",
      status: res?.status || 0, ms, callId: id,
      note: `Summary: ${data.report?.summary?.slice(0, 120) || "(none)"} | WA Queued: ${data.quotation_queued}`,
      twiml: prettyJson(data.report),
    });
    setBusy(false);
  }, [callId, busy, baseUrl]);

  // ─── Load live calls ──────────────────────────────────────────────────────
  const loadLiveCalls = useCallback(async () => {
    setLiveBusy(true);
    const res  = await fetch(`${baseUrl}/records?type=service_calls`).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setLiveCalls((data.records || []).filter((r) => r.status === "active").slice(0, 20));
    setLiveBusy(false);
  }, [baseUrl]);

  // ─── Direct webhook test ──────────────────────────────────────────────────
  const fireWebhook = useCallback(async () => {
    if (wh.busy) return;
    setWh((w) => ({ ...w, busy: true, resp: null }));
    const t0 = performance.now();
    try {
      const res  = await fetch(wh.url, {
        method: wh.method,
        headers: { "Content-Type": wh.method === "GET" ? "application/json" : "application/x-www-form-urlencoded" },
        body: wh.method !== "GET" ? (wh.body || buildInboundForm(callerNum).toString()) : undefined,
      });
      const text = await res.text();
      const ms   = Math.round(performance.now() - t0);
      setWh((w) => ({ ...w, busy: false, resp: { status: res.status, body: text, ms } }));
    } catch (e) {
      setWh((w) => ({ ...w, busy: false, resp: { status: 0, body: e.message, ms: Math.round(performance.now() - t0) } }));
    }
  }, [wh, callerNum]);

  // ── Styles ────────────────────────────────────────────────────────────────
  const card = { background: "rgba(255,255,255,0.97)", border: "1px solid rgba(15,23,42,0.08)", borderRadius: 14, padding: "18px 20px", boxShadow: "0 2px 12px rgba(15,23,42,0.06)" };
  const kicker = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#94a3b8", marginBottom: 8, display: "block" };
  const inp = { padding: "8px 12px", borderRadius: 9, border: "1px solid rgba(15,23,42,0.12)", fontSize: 12, color: "#1e293b", background: "#fff", outline: "none", width: "100%", boxSizing: "border-box" };
  const btn = (bg, clr = "#fff") => ({ padding: "8px 20px", borderRadius: 9, border: "none", background: bg, color: clr, fontWeight: 800, fontSize: 12, cursor: "pointer", transition: "opacity 0.15s" });

  const phaseColors = { idle: "#94a3b8", session: "#f59e0b", active: "#10b981", "package-wait": "#6366f1", ended: "#64748b" };
  const phaseLabel  = { idle: "Idle", session: "Starting…", active: "Active Call", "package-wait": "Pkg Fetching", ended: "Ended" };

  return (
    <div style={{ fontFamily: "'Space Grotesk','Segoe UI',system-ui,sans-serif", background: "#f0f4f8", minHeight: "100vh", paddingBottom: 32 }}>

      {/* ── HEADER ── */}
      <header style={{ background: "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)", padding: "14px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 4px 24px rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#10b981,#059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>📞</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 17 }}>Phone API Test Lab</div>
            <div style={{ color: "#64748b", fontSize: 11 }}>Full Twilio integration test · Simulate real phone calls · Inspect TwiML</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <StatChip label="Requests" value={total}   color="#a5b4fc" />
          <StatChip label="Success"  value={success} color="#6ee7b7" />
          <StatChip label="Errors"   value={errors}  color="#fca5a5" />
          <StatChip label="Avg ms"   value={avgMs}   color="#fcd34d" />
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 14, padding: "14px 16px" }}>

        {/* ── LEFT COLUMN ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* ── CONFIGURATION ── */}
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: configOpen ? 14 : 0 }}>
              <span style={{ ...kicker, marginBottom: 0 }}>⚙ Configuration</span>
              <button type="button" onClick={() => setConfigOpen((x) => !x)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 14 }}>{configOpen ? "▲" : "▼"}</button>
            </div>
            {configOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                <div>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Server Base URL</span>
                  <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={{ ...inp, marginTop: 4, fontFamily: "monospace", fontSize: 11 }} />
                </div>
                <div>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Simulated Caller Number</span>
                  <input value={callerNum} onChange={(e) => setCallerNum(e.target.value)} style={{ ...inp, marginTop: 4 }} placeholder="+94771234567" />
                </div>
                <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 9, padding: "10px 12px" }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#d97706", textTransform: "uppercase" }}>Production Twilio Setup</span>
                  <p style={{ fontSize: 11, color: "#92400e", margin: "6px 0 0", lineHeight: 1.6 }}>
                    Set <code>APP_URL</code> to your public server (or ngrok URL) in <code>.env</code>.<br/>
                    In Twilio console → Phone Numbers → set Webhook URL to:<br/>
                    <code style={{ wordBreak: "break-all" }}>{baseUrl}/twilio/inbound</code>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── CALL FLOW SIMULATOR ── */}
          <div style={card}>
            <span style={kicker}>📞 Call Flow Simulator</span>

            {/* Phase indicator */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "8px 12px", background: "#f8fafc", borderRadius: 9, border: "1px solid rgba(15,23,42,0.07)" }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: phaseColors[callPhase] }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: phaseColors[callPhase] }}>{phaseLabel[callPhase]}</span>
              {callId && <span style={{ fontSize: 10, color: "#6366f1", fontFamily: "monospace", marginLeft: "auto" }}>{callId}</span>}
            </div>

            {/* Steps */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

              {/* Step 1 */}
              <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(15,23,42,0.07)" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#1e293b", marginBottom: 8 }}>STEP 1 — Inbound Call</div>
                <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 10px", lineHeight: 1.55 }}>
                  Simulates Twilio calling <code>/api/twilio/inbound</code>. Creates V01 session, generates greeting, returns TwiML.
                </p>
                <button type="button" onClick={startCall} disabled={busy || callPhase !== "idle"} style={{ ...btn("linear-gradient(135deg,#10b981,#059669)"), width: "100%", opacity: busy || callPhase !== "idle" ? 0.5 : 1 }}>
                  {busy && callPhase === "session" ? "Starting…" : "▶ Start Inbound Call"}
                </button>
              </div>

              {/* Step 2 */}
              <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(15,23,42,0.07)", opacity: callPhase === "idle" ? 0.5 : 1 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#1e293b", marginBottom: 8 }}>STEP 2 — Send Caller Speech</div>

                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  {["transcript", "audio"].map((m) => (
                    <button key={m} type="button" onClick={() => setInputMode(m)} style={{
                      padding: "4px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700,
                      background: inputMode === m ? "rgba(99,102,241,0.12)" : "rgba(15,23,42,0.05)",
                      color: inputMode === m ? "#6366f1" : "#64748b",
                    }}>{m === "transcript" ? "📝 Text" : "🎤 Audio File"}</button>
                  ))}
                </div>

                {inputMode === "transcript" ? (
                  <textarea
                    value={simTranscript}
                    onChange={(e) => setSimTranscript(e.target.value)}
                    rows={3}
                    placeholder="What the caller says…"
                    style={{ ...inp, resize: "vertical", fontSize: 12 }}
                  />
                ) : (
                  <input
                    type="file" accept="audio/*"
                    onChange={(e) => setSimAudioFile(e.target.files?.[0] || null)}
                    style={{ ...inp, fontSize: 11 }}
                  />
                )}

                <button type="button" onClick={() => sendTurn(callId)} disabled={busy || !["active", "package-wait"].includes(callPhase)} style={{ ...btn("linear-gradient(135deg,#6366f1,#8b5cf6)"), width: "100%", marginTop: 8, opacity: busy || !["active", "package-wait"].includes(callPhase) ? 0.5 : 1 }}>
                  {busy ? "Processing…" : `📤 Send Turn ${turnCount + 1}`}
                </button>
              </div>

              {/* Package wait indicator */}
              {callPhase === "package-wait" && (
                <div style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#6366f1", animation: "pulse 1s infinite" }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#6366f1" }}>Package fetching — polling every 3s…</span>
                  </div>
                  <p style={{ fontSize: 10, color: "#64748b", margin: "5px 0 0" }}>
                    On a real call, Twilio loops on <code>/api/twilio/package-wait/{"{callId}"}</code> with hold music until the job finishes.
                  </p>
                </div>
              )}

              {/* Step 3 */}
              <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(15,23,42,0.07)", opacity: !["active", "package-wait"].includes(callPhase) ? 0.5 : 1 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#1e293b", marginBottom: 8 }}>STEP 3 — End / Hang Up</div>
                <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 8px", lineHeight: 1.55 }}>
                  Generates final report, queues WhatsApp quotation if contact info is complete.
                </p>
                <button type="button" onClick={endCall} disabled={busy || !["active", "package-wait"].includes(callPhase)} style={{ ...btn("rgba(239,68,68,0.9)"), width: "100%", opacity: busy || !["active", "package-wait"].includes(callPhase) ? 0.5 : 1 }}>
                  📵 End Call
                </button>
              </div>

              {callPhase === "ended" && (
                <button type="button" onClick={() => { setCallId(""); setCallPhase("idle"); setProfile(null); setTurnCount(0); }} style={{ ...btn("#f8fafc", "#475569"), width: "100%", border: "1px solid rgba(15,23,42,0.12)" }}>
                  ↺ Reset
                </button>
              )}
            </div>
          </div>

          {/* ── LIVE CALLS MONITOR ── */}
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ ...kicker, marginBottom: 0 }}>🔴 Live Calls Monitor</span>
              <button type="button" onClick={loadLiveCalls} disabled={liveBusy} style={{ ...btn("rgba(99,102,241,0.1)", "#6366f1"), padding: "4px 12px", fontSize: 11 }}>
                {liveBusy ? "…" : "Refresh"}
              </button>
            </div>
            {liveCalls.length === 0 ? (
              <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", padding: "16px 0" }}>No active calls. Click Refresh.</p>
            ) : (
              liveCalls.map((c) => (
                <div key={c.public_id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 10px", background: "#f8fafc", borderRadius: 8, marginBottom: 5, cursor: "pointer" }} onClick={() => setCallId(c.public_id)}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontFamily: "monospace", color: "#6366f1", flex: 1 }}>{c.public_id}</span>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>{c.started_at ? new Date(c.started_at).toLocaleTimeString() : ""}</span>
                </div>
              ))
            )}
          </div>

        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* ── CUSTOMER PROFILE LIVE VIEW ── */}
          {profile && (
            <div style={card}>
              <span style={kicker}>👤 Live Customer Profile</span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {[
                  ["Full Name",    profile.full_name],
                  ["WhatsApp",     profile.contact_number],
                  ["Country",      profile.current_living_country],
                  ["Travelers",    profile.traveler_count],
                  ["Hotel Stars",  profile.hotel_star_preference],
                  ["Days",         profile.number_of_days],
                  ["Start Date",   profile.travel_start_date],
                  ["Pkg State",    profile.package_state],
                  ["Pkg Status",   profile.package_lookup_status],
                ].map(([label, val]) => (
                  <div key={label} style={{ background: "#f8fafc", borderRadius: 8, padding: "8px 12px", border: "1px solid rgba(15,23,42,0.06)" }}>
                    <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 12, color: val ? "#1e293b" : "#94a3b8", fontWeight: val ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{val || "—"}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── DIRECT WEBHOOK TESTER ── */}
          <div style={card}>
            <span style={kicker}>🔌 Direct Webhook Tester</span>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
              <select value={wh.method} onChange={(e) => setWh((w) => ({ ...w, method: e.target.value }))} style={{ ...inp, width: 90, fontWeight: 700, color: wh.method === "GET" ? "#10b981" : "#6366f1" }}>
                <option>GET</option><option>POST</option>
              </select>
              <select value={wh.url} onChange={(e) => setWh((w) => ({ ...w, url: e.target.value }))} style={{ ...inp, fontFamily: "monospace", fontSize: 11, flex: 1 }}>
                <option value={`${baseUrl}/twilio/inbound`}>POST /twilio/inbound</option>
                <option value={`${baseUrl}/twilio/turn?call_id=${callId || "V01-TEST"}`}>POST /twilio/turn</option>
                <option value={`${baseUrl}/twilio/package-wait/${callId || "V01-TEST"}`}>GET /twilio/package-wait</option>
                <option value={`${baseUrl}/twilio/status`}>POST /twilio/status</option>
                <option value={`${baseUrl}/twilio/hold-music`}>GET /twilio/hold-music</option>
                <option value={`${baseUrl}/health`}>GET /health</option>
              </select>
              <button type="button" onClick={fireWebhook} disabled={wh.busy} style={{ ...btn("linear-gradient(135deg,#6366f1,#8b5cf6)"), flexShrink: 0, opacity: wh.busy ? 0.6 : 1 }}>
                {wh.busy ? "…" : "▶ Fire"}
              </button>
            </div>

            <textarea
              value={wh.body}
              onChange={(e) => setWh((w) => ({ ...w, body: e.target.value }))}
              rows={4}
              placeholder={`Leave empty to auto-fill Twilio form data for this endpoint.\n\nOr manually enter: CallSid=CAxx&From=+94771234567&RecordingUrl=https://...`}
              style={{ ...inp, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
            />

            {wh.resp && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 900, color: statusColor(wh.resp.status), background: `${statusColor(wh.resp.status)}12`, border: `1px solid ${statusColor(wh.resp.status)}30`, padding: "3px 12px", borderRadius: 8 }}>{wh.resp.status}</span>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{wh.resp.ms}ms</span>
                  <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: "auto" }}>
                    {wh.resp.body.startsWith("<?xml") ? "TwiML" : "JSON/text"}
                  </span>
                </div>
                <pre style={{ margin: 0, background: "#0f172a", color: wh.resp.body.startsWith("<?xml") ? "#7dd3fc" : "#e2e8f0", borderRadius: 10, padding: "14px 16px", fontSize: 11, lineHeight: 1.65, overflow: "auto", maxHeight: 320, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {wh.resp.body.startsWith("<?xml") ? prettyXml(wh.resp.body) : wh.resp.body}
                </pre>
              </div>
            )}
          </div>

          {/* ── INTEGRATION CHECKLIST ── */}
          <div style={card}>
            <span style={kicker}>✅ Integration Checklist</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {[
                { label: "APP_URL is publicly reachable (ngrok in dev)", tip: "Twilio needs to reach your server. Use: ngrok http 8000" },
                { label: "TWILIO_ACCOUNT_SID set in .env", tip: "From twilio.com/console → Account Info" },
                { label: "TWILIO_AUTH_TOKEN set in .env", tip: "From twilio.com/console → Account Info" },
                { label: "TWILIO_PHONE_NUMBER configured", tip: "Buy a number in Twilio console with Voice capability" },
                { label: "Twilio webhook URL set to /api/twilio/inbound", tip: "Phone Numbers → Active Numbers → Voice Configuration → Incoming webhook" },
                { label: "Twilio webhook timeout ≥ 60s configured", tip: "Account → Voice Settings → HTTP Timeout (or accept 15s for fast servers)" },
                { label: "Queue worker running: php artisan queue:work --queue=aahaas-wa", tip: "Required for async package fetch and WhatsApp dispatch" },
                { label: "OPENAI_API_KEY set (for Whisper + GPT + TTS)", tip: "Required for transcription, AI turns, and voice synthesis" },
                { label: "Storage writable for twilio-audio/", tip: "chmod -R 755 storage/app/twilio-audio" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 12px", background: "#f8fafc", borderRadius: 8, border: "1px solid rgba(15,23,42,0.06)" }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>◻</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{item.tip}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── API REFERENCE ── */}
          <div style={card}>
            <span style={kicker}>📖 Phone API Endpoints</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { method: "POST", path: "/api/twilio/inbound",              desc: "Initial call webhook — creates V01 session, returns greeting TwiML" },
                { method: "POST", path: "/api/twilio/turn?call_id=V01-XXX", desc: "Recording callback — downloads MP3, transcribes, runs AI, returns next TwiML" },
                { method: "GET",  path: "/api/twilio/package-wait/{callId}",desc: "Hold loop — loops with hold music until package job finishes" },
                { method: "GET",  path: "/api/twilio/audio/{callId}/{key}", desc: "Serve stored MP3 so Twilio can play it on the call" },
                { method: "GET",  path: "/api/twilio/hold-music",           desc: "Redirects to hold music MP3 URL" },
                { method: "POST", path: "/api/twilio/status",               desc: "Status callback — marks call completed/failed when Twilio reports it" },
              ].map((ep) => (
                <div key={ep.path} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "7px 10px", background: "#f8fafc", borderRadius: 8, border: "1px solid rgba(15,23,42,0.06)" }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: ep.method === "GET" ? "#10b981" : "#6366f1", minWidth: 34, paddingTop: 1 }}>{ep.method}</span>
                  <span style={{ fontSize: 11, fontFamily: "monospace", color: "#374151", flex: 1, wordBreak: "break-all" }}>{ep.path}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8", maxWidth: 240, textAlign: "right" }}>{ep.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── REQUEST LOG ── */}
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ ...kicker, marginBottom: 0 }}>📋 Request Log ({log.length})</span>
              <button type="button" onClick={() => setLog([])} style={{ fontSize: 11, color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Clear</button>
            </div>
            {log.length === 0 ? (
              <div style={{ textAlign: "center", padding: "30px 0", color: "#94a3b8", fontSize: 13 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📞</div>
                Start a call simulation to see the full request log here.
              </div>
            ) : (
              log.map((entry, i) => <LogEntry key={i} entry={entry} />)
            )}
          </div>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }`}</style>
    </div>
  );
}
