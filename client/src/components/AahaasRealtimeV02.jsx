import { useCallback, useEffect, useRef, useState } from "react";

// WebSocket proxy runs on the Node.js server (port 5001).
// The Node.js server opens the OpenAI connection with the real API key.
const WS_BASE = (import.meta.env.VITE_NODE_API_BASE_URL || "http://localhost:5001/api")
  .replace(/^http/, "ws")
  .replace(/\/api$/, "");

const LARAVEL_API = import.meta.env.VITE_LARAVEL_API_BASE_URL || "http://localhost:8000/api";

const OPENAI_VOICES = [
  { value: "alloy",   label: "Alloy — Neutral, balanced" },
  { value: "ash",     label: "Ash — Warm, casual" },
  { value: "coral",   label: "Coral — Professional, upbeat (default)" },
  { value: "echo",    label: "Echo — Clear, resonant" },
  { value: "sage",    label: "Sage — Calm, thoughtful" },
  { value: "shimmer", label: "Shimmer — Light, cheerful" },
  { value: "verse",   label: "Verse — Versatile, natural" },
];

const PHASES = {
  idle:         { label: "Ready",       color: "#6b7280" },
  connecting:   { label: "Connecting",  color: "#3b82f6" },
  connected:    { label: "Ready",       color: "#10b981" },
  listening:    { label: "Listening",   color: "#10b981" },
  speaking:     { label: "AI Speaking", color: "#8b5cf6" },
  tool_running: { label: "Looking up",  color: "#f59e0b" },
  completed:    { label: "Done",        color: "#10b981" },
  failed:       { label: "Failed",      color: "#ef4444" },
};

function msToDisplay(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// Convert Float32 mic samples → Int16 PCM
function float32ToPcm16(float32) {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32768)));
  }
  return pcm;
}

// ArrayBuffer → base64
function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// base64 → Int16Array PCM
function base64ToPcm16(b64) {
  const binary = atob(b64);
  const bytes   = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export default function AahaasRealtimeV02() {
  const [phase, setPhase]         = useState("idle");
  const [error, setError]         = useState("");
  const [statusMsg, setStatusMsg] = useState("Ready to connect.");
  const [selectedVoice, setSelectedVoice] = useState("coral");

  const [conversation, setConversation]     = useState([]);
  const [userTranscript, setUserTranscript] = useState("");
  const [aiTranscript, setAiTranscript]     = useState("");
  const [packageStatus, setPackageStatus]   = useState("idle");
  const [packageText, setPackageText]       = useState("");
  const [terminalLog, setTerminalLog]       = useState([]);
  const [callDuration, setCallDuration]     = useState(0);
  const [micLevel, setMicLevel]             = useState(0);      // 0–1 RMS for the indicator
  const [sensitivity, setSensitivity]       = useState(0.015);  // client-side noise-gate threshold

  const wsRef             = useRef(null);
  const audioCtxRef       = useRef(null);
  const micStreamRef      = useRef(null);
  const processorRef      = useRef(null);
  const nextPlayTimeRef   = useRef(0);
  const phaseRef          = useRef("idle");
  const callTimerRef      = useRef(null);
  const callStartRef      = useRef(0);
  const terminalEndRef    = useRef(null);
  const pendingFnRef      = useRef(null);
  const aiTransBufRef     = useRef("");

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    if (terminalEndRef.current) terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [terminalLog]);

  useEffect(() => () => teardown(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ───────────────────────────────────────────────────────────────
  function addLog(type, message, detail = "") {
    const ts = new Date().toISOString().slice(11, 23);
    setTerminalLog((p) => [...p.slice(-100), { ts, type, message, detail }]);
  }

  function pushMessage(role, content) {
    if (!content?.trim()) return;
    setConversation((p) => [...p, { role, content: content.trim() }]);
  }

  function startTimer() {
    callStartRef.current = Date.now();
    setCallDuration(0);
    callTimerRef.current = setInterval(() => setCallDuration(Date.now() - callStartRef.current), 500);
  }

  function stopTimer() {
    if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
  }

  function sendWs(obj) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(obj));
    }
  }

  // ── Audio: capture mic → PCM16 → WebSocket ────────────────────────────────
  async function startMicCapture() {
    const ctx = new AudioContext({ sampleRate: 24000 });
    audioCtxRef.current = ctx;
    nextPlayTimeRef.current = 0;

    // Layer 1: browser-level echo cancellation + noise suppression.
    // This removes the AI's own voice from the mic feed and filters
    // steady-state background noise (fans, hum, keyboard clicks).
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation:  true,
        noiseSuppression:  true,
        autoGainControl:   false, // keep false — AGC would boost quiet noise up to threshold
      },
    });
    micStreamRef.current = stream;

    const source    = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(1024, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;

      const float32 = e.inputBuffer.getChannelData(0);

      // Layer 2: client-side RMS noise gate.
      // Calculate the root-mean-square energy of this chunk.
      // If it is below the sensitivity slider value, replace with silence
      // so the server VAD never even sees the noise frame.
      let sum = 0;
      for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
      const rms = Math.sqrt(sum / float32.length);

      // Update mic level meter (smoothed)
      setMicLevel((prev) => prev * 0.6 + rms * 0.4);

      const gated = rms >= sensitivity ? float32ToPcm16(float32) : new Int16Array(float32.length);
      const base64 = bufToBase64(gated.buffer);
      wsRef.current.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64 }));
    };

    source.connect(processor);
    processor.connect(ctx.destination);
    addLog("info", "Mic capture started (echo cancel + noise gate active)");
  }

  // ── Audio: play PCM16 chunks from AI in sequence ──────────────────────────
  function playAudioDelta(base64) {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const pcm16  = base64ToPcm16(base64);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;

    const buf = ctx.createBuffer(1, float32.length, 24000);
    buf.copyToChannel(float32, 0);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);

    // Schedule back-to-back to avoid gaps
    const startAt = Math.max(nextPlayTimeRef.current, ctx.currentTime + 0.02);
    src.start(startAt);
    nextPlayTimeRef.current = startAt + buf.duration;
  }

  // ── Teardown ──────────────────────────────────────────────────────────────
  function teardown() {
    stopTimer();
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (audioCtxRef.current?.state !== "closed") audioCtxRef.current?.close();
    audioCtxRef.current = null;
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    nextPlayTimeRef.current = 0;
  }

  // ── Event handler ─────────────────────────────────────────────────────────
  const handleEvent = useCallback(async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const type = msg.type || "";

    if (type === "session.created" || type === "session.updated") {
      addLog("info", type === "session.created" ? "Session ready" : "Session configured");
      setPhase("connected");
      setStatusMsg("Connected — speak when ready.");
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      setPhase("listening");
      setStatusMsg("Listening...");
      addLog("state", "User speaking");
      // Reset play time so AI response doesn't queue behind old audio
      nextPlayTimeRef.current = 0;
      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      setPhase("connected");
      setStatusMsg("Processing...");
      addLog("state", "User stopped — processing");
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = msg.transcript || "";
      setUserTranscript(text);
      if (text) pushMessage("user", text);
      addLog("info", "You said", text.slice(0, 80));
      return;
    }

    if (type === "response.created") {
      aiTransBufRef.current = "";
      setAiTranscript("");
      setPhase("speaking");
      setStatusMsg("Aahaas is speaking...");
      return;
    }

    // GA API renamed response.audio.delta → response.output_audio.delta
    if (type === "response.output_audio.delta" && msg.delta) {
      playAudioDelta(msg.delta);
      return;
    }

    // GA API renamed response.audio_transcript.delta → response.output_audio_transcript.delta
    if (type === "response.output_audio_transcript.delta") {
      aiTransBufRef.current += (msg.delta || "");
      setAiTranscript(aiTransBufRef.current);
      return;
    }

    if (type === "response.output_audio_transcript.done") {
      const text = msg.transcript || aiTransBufRef.current;
      setAiTranscript(text);
      if (text) pushMessage("assistant", text);
      aiTransBufRef.current = "";
      addLog("info", "AI said", text.slice(0, 80));
      return;
    }

    if (type === "response.done") {
      setPhase("connected");
      setStatusMsg("Connected — speak when ready.");
      return;
    }

    // Function call — arguments stream
    if (type === "response.output_item.added" && msg.item?.type === "function_call") {
      pendingFnRef.current = { call_id: msg.item.call_id, name: msg.item.name, args: "" };
      addLog("info", `Tool: ${msg.item.name}`);
      return;
    }
    if (type === "response.function_call_arguments.delta" && pendingFnRef.current) {
      pendingFnRef.current.args += (msg.delta || "");
      return;
    }
    if (type === "response.function_call_arguments.done") {
      const fn = pendingFnRef.current;
      if (!fn) return;
      fn.args = msg.arguments || fn.args;
      pendingFnRef.current = null;
      addLog("info", `Tool args ready`, fn.args.slice(0, 100));
      await executeTool(fn);
      return;
    }

    if (type === "error") {
      const errMsg = msg.error?.message || "Realtime API error";
      addLog("api-err", `Error: ${errMsg}`);
      setError(errMsg);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tool execution (package lookup via Laravel) ────────────────────────────
  async function executeTool({ call_id, name, args }) {
    if (name !== "fetch_travel_package") {
      sendWs({ type: "conversation.item.create", item: { type: "function_call_output", call_id, output: "Unknown tool." } });
      sendWs({ type: "response.create" });
      return;
    }

    setPhase("tool_running");
    setStatusMsg("Looking up the best package...");
    setPackageStatus("loading");
    addLog("api-start", "→ POST /aahaas-realtime/tool");

    let toolArgs = {};
    try { toolArgs = JSON.parse(args || "{}"); } catch {}

    const t0 = Date.now();
    let output = "Could not fetch package right now. We will follow up via WhatsApp.";

    try {
      const res  = await fetch(`${LARAVEL_API}/aahaas-realtime/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "fetch_travel_package", ...toolArgs }),
      });
      const data = await res.json().catch(() => ({}));
      addLog(res.ok ? "api-ok" : "api-err", `${res.ok ? "✓" : "✗"} Package — ${msToDisplay(Date.now() - t0)}`);

      if (data.success && data.voice_text) {
        output = data.voice_text;
        setPackageStatus("ready");
        setPackageText(data.voice_text);
        addLog("info", "Package ready", data.voice_text.slice(0, 80));
      } else {
        output = data.result || output;
        setPackageStatus("failed");
      }
    } catch (err) {
      addLog("api-err", `Tool error: ${err.message}`);
      setPackageStatus("failed");
    }

    sendWs({ type: "conversation.item.create", item: { type: "function_call_output", call_id, output } });
    sendWs({ type: "response.create" });

    setPhase("speaking");
    setStatusMsg("Aahaas is presenting the package...");
  }

  // ── Connect ───────────────────────────────────────────────────────────────
  async function handleConnect() {
    if (!["idle", "failed", "completed"].includes(phase)) return;

    setError("");
    setPhase("connecting");
    setStatusMsg("Connecting...");
    setConversation([]);
    setUserTranscript("");
    setAiTranscript("");
    setPackageStatus("idle");
    setPackageText("");
    setTerminalLog([]);
    aiTransBufRef.current = "";

    addLog("state", "Requesting microphone");

    try {
      // Start mic capture first (requires user permission)
      await startMicCapture();

      // Open WebSocket to our Node.js proxy
      const wsUrl = `${WS_BASE}/api/realtime?voice=${encodeURIComponent(selectedVoice)}`;
      addLog("api-start", `→ WS ${wsUrl}`);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        addLog("api-ok", "WebSocket open — waiting for session");
        startTimer();
      };

      ws.onmessage = (e) => handleEvent(e.data);

      ws.onerror = () => {
        addLog("api-err", "WebSocket error");
        setError("WebSocket connection failed. Is the Node.js server running on port 5001?");
        setPhase("failed");
        setStatusMsg("Connection failed.");
        stopTimer();
        teardown();
      };

      ws.onclose = (e) => {
        addLog("state", `WebSocket closed (${e.code})`);
        if (!["completed", "failed"].includes(phaseRef.current)) {
          setPhase("idle");
          setStatusMsg("Connection closed.");
          stopTimer();
        }
      };

    } catch (err) {
      teardown();
      setPhase("failed");
      setError(err.message || "Connection failed.");
      setStatusMsg("Connection failed.");
      addLog("api-err", `Connect error: ${err.message}`);
      stopTimer();
    }
  }

  // ── Disconnect ────────────────────────────────────────────────────────────
  function handleDisconnect() {
    addLog("state", "Disconnecting");
    teardown();
    setPhase("completed");
    setStatusMsg("Session ended.");
    stopTimer();
  }

  function handleReset() {
    teardown();
    setPhase("idle");
    setError("");
    setStatusMsg("Ready to connect.");
    setConversation([]);
    setUserTranscript("");
    setAiTranscript("");
    setPackageStatus("idle");
    setPackageText("");
    setTerminalLog([]);
    setCallDuration(0);
    setMicLevel(0);
    aiTransBufRef.current = "";
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const phaseInfo     = PHASES[phase] || PHASES.idle;
  const canConnect    = ["idle", "failed", "completed"].includes(phase);
  const canDisconnect = ["connected", "listening", "speaking", "tool_running"].includes(phase);

  const pkgColor = packageStatus === "ready" ? "#10b981" : packageStatus === "loading" ? "#f59e0b" : packageStatus === "failed" ? "#ef4444" : "#6b7280";
  const pkgLabel = packageStatus === "ready" ? "Package Ready" : packageStatus === "loading" ? "Fetching Package..." : packageStatus === "failed" ? "Unavailable" : "Not started";

  const card   = { background: "rgba(255,255,255,0.95)", border: "1px solid rgba(15,23,42,0.08)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 2px 12px rgba(15,23,42,0.06)" };
  const kicker = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#94a3b8", marginBottom: 8, display: "block" };

  return (
    <div style={{ fontFamily: "'Space Grotesk','Segoe UI',system-ui,sans-serif", background: "#f0f4f8", minHeight: "100vh", paddingBottom: 32 }}>

      {/* ── HEADER ── */}
      <header style={{ background: "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)", padding: "14px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 4px 24px rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚡</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>Aahaas Realtime V0.2</div>
            <div style={{ color: "#94a3b8", fontSize: 11 }}>gpt-realtime-2 · WebSocket · PCM16 audio</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {callDuration > 0 && (
            <span style={{ background: "rgba(16,185,129,0.15)", color: "#6ee7b7", padding: "4px 10px", borderRadius: 8, fontSize: 11, fontFamily: "monospace", border: "1px solid rgba(16,185,129,0.25)" }}>
              {msToDisplay(callDuration)}
            </span>
          )}
          <span style={{ background: `${phaseInfo.color}1a`, color: phaseInfo.color, border: `1px solid ${phaseInfo.color}40`, padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, minWidth: 90, textAlign: "center" }}>
            {phaseInfo.label}
          </span>
        </div>
      </header>

      {/* ── BANNER ── */}
      <div style={{ background: "linear-gradient(90deg,rgba(99,102,241,0.08),rgba(139,92,246,0.08))", borderBottom: "1px solid rgba(99,102,241,0.12)", padding: "8px 22px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#6366f1", fontWeight: 700 }}>⚡ GA REALTIME API</span>
        <span style={{ fontSize: 11, color: "#64748b" }}>WebSocket proxy via Node.js · PCM16 audio · server VAD · ~300–800ms latency</span>
      </div>

      {/* ── MAIN GRID ── */}
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 260px", gap: 14, padding: "14px 14px 0", alignItems: "start" }}>

        {/* LEFT */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={card}>
            <span style={kicker}>Voice</span>
            <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} disabled={!canConnect}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(15,23,42,0.12)", background: !canConnect ? "#f1f5f9" : "#fff", fontSize: 12, color: "#1e293b", outline: "none", cursor: !canConnect ? "not-allowed" : "pointer" }}>
              {OPENAI_VOICES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>

          {/* Mic sensitivity control */}
          <div style={card}>
            <span style={kicker}>Mic Sensitivity</span>

            {/* Live mic level bar */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>Input level</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: micLevel > sensitivity ? "#10b981" : "#94a3b8" }}>
                  {micLevel > sensitivity ? "Voice detected" : "Silent"}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: "#e2e8f0", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 4,
                  width: `${Math.min(100, micLevel * 800)}%`,
                  background: micLevel > sensitivity ? "#10b981" : "#94a3b8",
                  transition: "width 0.08s, background 0.15s",
                }} />
              </div>
              {/* Threshold marker */}
              <div style={{ position: "relative", height: 0 }}>
                <div style={{
                  position: "absolute",
                  left: `${Math.min(100, sensitivity * 800)}%`,
                  top: -6, width: 2, height: 6, background: "#ef4444", borderRadius: 1,
                }} />
              </div>
            </div>

            {/* Noise gate slider */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>Noise gate</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#6366f1" }}>
                  {sensitivity < 0.008 ? "Very sensitive" : sensitivity < 0.02 ? "Balanced" : sensitivity < 0.04 ? "Less sensitive" : "Strict"}
                </span>
              </div>
              <input type="range" min={0.003} max={0.06} step={0.001} value={sensitivity}
                onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "#6366f1", cursor: "pointer" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                <span style={{ fontSize: 10, color: "#94a3b8" }}>Sensitive</span>
                <span style={{ fontSize: 10, color: "#94a3b8" }}>Strict</span>
              </div>
            </div>

            <p style={{ fontSize: 10, color: "#94a3b8", margin: "8px 0 0", lineHeight: 1.5 }}>
              The red marker is your gate threshold. Audio below it is sent as silence — the AI never hears it.
            </p>
          </div>

          <div style={{ ...card, background: "rgba(99,102,241,0.04)", border: "1px solid rgba(99,102,241,0.15)" }}>
            <span style={{ ...kicker, color: "#6366f1" }}>How It Works</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                ["1", "Mic → PCM16 @ 24 kHz"],
                ["2", "Browser → Node.js WebSocket"],
                ["3", "Node.js → OpenAI Realtime"],
                ["4", "Server VAD detects speech"],
                ["5", "AI audio streams back live"],
              ].map(([n, t]) => (
                <div key={n} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ background: "rgba(99,102,241,0.15)", color: "#6366f1", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{n}</span>
                  <span style={{ fontSize: 11, color: "#475569", lineHeight: 1.5 }}>{t}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={card}>
            <span style={kicker}>Package Status</span>
            <div style={{ fontSize: 12, fontWeight: 700, color: pkgColor, marginBottom: 4 }}>{pkgLabel}</div>
            {packageText && <p style={{ fontSize: 11, color: "#475569", margin: 0, lineHeight: 1.55, maxHeight: 120, overflow: "auto" }}>{packageText}</p>}
          </div>
        </aside>

        {/* CENTER */}
        <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Orb + controls */}
          <div style={{ ...card, textAlign: "center", padding: "28px 22px" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
              <div className={`call-orb phase-${phase === "listening" ? "listening" : phase === "speaking" ? "assistant-speaking" : phase === "connecting" ? "connecting" : phase === "connected" ? "connected" : "idle"}`}>
                <div className="call-orb-core" />
                <div className="call-orb-ring ring-one" />
                <div className="call-orb-ring ring-two" />
                <div className="call-orb-ring ring-three" />
              </div>
            </div>
            <div style={{ fontWeight: 600, color: "#1e293b", fontSize: 14, marginBottom: 6 }}>{statusMsg}</div>
            {error && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6, background: "rgba(239,68,68,0.06)", padding: "6px 12px", borderRadius: 8 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
              <button type="button" onClick={handleConnect} disabled={!canConnect}
                style={{ padding: "11px 28px", borderRadius: 10, border: "none", cursor: !canConnect ? "not-allowed" : "pointer", background: !canConnect ? "#e2e8f0" : "linear-gradient(135deg,#6366f1,#8b5cf6)", color: !canConnect ? "#94a3b8" : "#fff", fontWeight: 700, fontSize: 13, boxShadow: !canConnect ? "none" : "0 4px 14px rgba(99,102,241,0.32)" }}>
                ⚡ Connect
              </button>
              <button type="button" onClick={handleDisconnect} disabled={!canDisconnect}
                style={{ padding: "11px 24px", borderRadius: 10, border: "none", cursor: !canDisconnect ? "not-allowed" : "pointer", background: !canDisconnect ? "#e2e8f0" : "linear-gradient(135deg,#ef4444,#dc2626)", color: !canDisconnect ? "#94a3b8" : "#fff", fontWeight: 700, fontSize: 13, boxShadow: !canDisconnect ? "none" : "0 4px 14px rgba(239,68,68,0.32)" }}>
                ■ End
              </button>
              <button type="button" onClick={handleReset}
                style={{ padding: "11px 20px", borderRadius: 10, border: "1px solid rgba(15,23,42,0.12)", cursor: "pointer", background: "#f8fafc", color: "#475569", fontWeight: 600, fontSize: 13 }}>
                ↺ Reset
              </button>
            </div>
          </div>

          {/* Live transcripts */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={card}>
              <span style={kicker}>You Said (Live)</span>
              <p style={{ fontSize: 12, color: userTranscript ? "#1e293b" : "#94a3b8", margin: 0, lineHeight: 1.65 }}>{userTranscript || "Your words will appear here..."}</p>
            </div>
            <div style={card}>
              <span style={kicker}>Aahaas AI (Live)</span>
              <p style={{ fontSize: 12, color: aiTranscript ? "#1e293b" : "#94a3b8", margin: 0, lineHeight: 1.65 }}>{aiTranscript || "AI response will appear here..."}</p>
            </div>
          </div>

          {/* Conversation log */}
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
              <span style={{ ...kicker, marginBottom: 2 }}>Conversation Log</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>Full Session History</span>
            </div>
            <div style={{ height: 240, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              {conversation.length === 0
                ? <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>Connect and speak — conversation appears here in real time.</p>
                : conversation.map((msg, idx) => (
                  <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "assistant" ? "flex-start" : "flex-end", gap: 3 }}>
                    <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", padding: msg.role === "assistant" ? "0 0 0 4px" : "0 4px 0 0" }}>
                      {msg.role === "assistant" ? "Aahaas AI" : "You"}
                    </span>
                    <div style={{ maxWidth: "85%", background: msg.role === "assistant" ? "rgba(99,102,241,0.08)" : "rgba(16,185,129,0.08)", border: `1px solid ${msg.role === "assistant" ? "rgba(99,102,241,0.2)" : "rgba(16,185,129,0.2)"}`, borderRadius: msg.role === "assistant" ? "4px 12px 12px 12px" : "12px 4px 12px 12px", padding: "8px 12px", fontSize: 12, color: "#1e293b", lineHeight: 1.6 }}>
                      {msg.content}
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        </main>

        {/* RIGHT: Terminal */}
        <aside>
          <div style={{ background: "#0d1117", borderRadius: 14, border: "1px solid rgba(255,255,255,0.07)", overflow: "hidden" }}>
            <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>Live Terminal</span>
              <span style={{ fontSize: 11, color: phaseInfo.color, fontWeight: 700, background: `${phaseInfo.color}1a`, padding: "3px 10px", borderRadius: 6 }}>● {phaseInfo.label}</span>
            </div>
            <div style={{ height: 500, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 3 }}>
              {terminalLog.length === 0
                ? <span style={{ fontSize: 11, color: "#4b5563", fontFamily: "monospace" }}>Waiting for connection...</span>
                : terminalLog.map((e, i) => {
                  const c = { "api-start": "#3b82f6", "api-ok": "#10b981", "api-err": "#ef4444", error: "#ef4444", info: "#94a3b8", state: "#8b5cf6", warn: "#f59e0b" }[e.type] || "#94a3b8";
                  return (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 10, color: "#4b5563", fontFamily: "monospace", flexShrink: 0, marginTop: 1 }}>{e.ts}</span>
                      <span style={{ fontSize: 11, color: c, fontFamily: "monospace", lineHeight: 1.5 }}>
                        {e.message}{e.detail && <span style={{ color: "#6b7280", marginLeft: 6 }}>{e.detail}</span>}
                      </span>
                    </div>
                  );
                })
              }
              <div ref={terminalEndRef} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
