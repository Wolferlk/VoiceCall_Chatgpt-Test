import { useCallback, useEffect, useRef, useState } from "react";

const WS_BASE    = (import.meta.env.VITE_NODE_API_BASE_URL || "http://localhost:5001/api")
  .replace(/^http/, "ws").replace(/\/api$/, "");
const LARAVEL_API = import.meta.env.VITE_LARAVEL_API_BASE_URL || "http://localhost:8000/api";

const OPENAI_VOICES = [
  { value: "alloy",   label: "Alloy — Neutral" },
  { value: "ash",     label: "Ash — Warm" },
  { value: "coral",   label: "Coral — Professional (default)" },
  { value: "echo",    label: "Echo — Clear" },
  { value: "sage",    label: "Sage — Calm" },
  { value: "shimmer", label: "Shimmer — Cheerful" },
  { value: "verse",   label: "Verse — Natural" },
];

const COUNTRY_CODES = {
  "Sri Lanka": "94", "India": "91", "Pakistan": "92", "Bangladesh": "880",
  "Nepal": "977", "Maldives": "960", "United Kingdom": "44", "UK": "44",
  "Australia": "61", "United States": "1", "USA": "1", "Canada": "1",
  "Germany": "49", "France": "33", "Netherlands": "31",
  "Singapore": "65", "Malaysia": "60", "Thailand": "66",
  "UAE": "971", "United Arab Emirates": "971", "Saudi Arabia": "966",
  "Qatar": "974", "Kuwait": "965", "Bahrain": "973",
  "South Africa": "27", "Kenya": "254", "Nigeria": "234",
};

const PHASES = {
  idle:         { label: "Ready",        color: "#6b7280" },
  detecting:    { label: "Detecting",    color: "#3b82f6" },
  connecting:   { label: "Connecting",   color: "#3b82f6" },
  connected:    { label: "Ready",        color: "#10b981" },
  listening:    { label: "Listening",    color: "#10b981" },
  speaking:     { label: "AI Speaking",  color: "#8b5cf6" },
  searching:    { label: "Searching...", color: "#f59e0b" },
  sending_wa:   { label: "Sending WA",   color: "#f59e0b" },
  completed:    { label: "Done",         color: "#10b981" },
  failed:       { label: "Failed",       color: "#ef4444" },
};

function msToDisplay(ms) { return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`; }

// Keep the mic muted for a short tail after the AI's last audio chunk finishes, so
// the speaker echo of its final words doesn't leak back and trigger a false turn.
const AI_ECHO_TAIL_SEC = 0.35;

// Actions the /v1/voice/suggest API understands. Anything outside this set is
// dropped from the payload so the API classifies the turn itself — we never
// default a missing/garbled action to new_request, which would reset the cart.
const VALID_SUGGEST_ACTIONS = ["new_request", "add_hotel", "add_product", "change", "price_query", "confirm"];

function float32ToPcm16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32768)));
  return out;
}
function bufToBase64(buf) {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.byteLength; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function base64ToPcm16(b64) {
  const bin = atob(b64); const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new Int16Array(b.buffer);
}

function normalizePhone(phone, country) {
  let d = phone.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) {
    const code = COUNTRY_CODES[country] || "94";
    d = code + d.slice(1);
  }
  return d;
}

function normalizeTextForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordOverlapScore(a, b) {
  const left = new Set(normalizeTextForCompare(a).split(" ").filter(Boolean));
  const right = new Set(normalizeTextForCompare(b).split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let matches = 0;
  for (const word of left) {
    if (right.has(word)) matches += 1;
  }
  return matches / Math.max(left.size, right.size);
}

export default function AahaasRealtimeV02() {
  const [phase, setPhase]         = useState("idle");
  const [error, setError]         = useState("");
  const [statusMsg, setStatusMsg] = useState("Ready to connect.");
  const [selectedVoice, setSelectedVoice] = useState("verse");

  const [detectedCountry, setDetectedCountry]   = useState("Sri Lanka");
  const [conversation, setConversation]         = useState([]);
  const [userTranscript, setUserTranscript]     = useState("");
  const [aiTranscript, setAiTranscript]         = useState("");
  const [packageStatus, setPackageStatus]       = useState("idle"); // idle|loading|ready|failed
  const [packageText, setPackageText]           = useState("");
  const [fetchedPackages, setFetchedPackages]   = useState([]); // [{id, text, ts}] — all fetches
  const [confirmedPackage, setConfirmedPackage] = useState(null); // summary after user confirms
  const [quotationStatus, setQuotationStatus]   = useState("idle"); // idle|sending|sent|failed
  const [quotationInfo, setQuotationInfo]       = useState(null);   // {name, phone}
  const [holdMusicEnabled, setHoldMusicEnabled] = useState(true);
  const [holdMusicVolume, setHoldMusicVolume]   = useState(0.28); // 0-1
  const [holdMusicActive, setHoldMusicActive]   = useState(false); // true while music plays
  const [terminalLog, setTerminalLog]           = useState([]);
  const [reportCollapsed, setReportCollapsed]   = useState(true);
  const [errorReportTitle, setErrorReportTitle] = useState("Realtime Test Report");
  const [errorReportSeverity, setErrorReportSeverity] = useState("medium");
  const [errorReportDetails, setErrorReportDetails] = useState("");
  const [errorReportSaving, setErrorReportSaving] = useState(false);
  const [errorReportMessage, setErrorReportMessage] = useState("");
  const [errorReports, setErrorReports]         = useState([]);
  const [errorReportsLoading, setErrorReportsLoading] = useState(false);
  const [errorReportsTab, setErrorReportsTab]   = useState("form"); // form|reports
  const [selectedErrorReportIndex, setSelectedErrorReportIndex] = useState(0);
  const [downloadAllSaving, setDownloadAllSaving] = useState(false);
  const [resetErrorsSaving, setResetErrorsSaving] = useState(false);
  const [callDuration, setCallDuration]         = useState(0);
  const [micLevel, setMicLevel]                 = useState(0);
  const [sensitivity, setSensitivity]           = useState(0.015);
//
  const wsRef              = useRef(null);
  const audioCtxRef        = useRef(null);
  const micStreamRef       = useRef(null);
  const processorRef       = useRef(null);
  const nextPlayTimeRef    = useRef(0);
  const phaseRef           = useRef("idle");
  const callTimerRef       = useRef(null);
  const callStartRef       = useRef(0);
  const terminalEndRef     = useRef(null);
  const pendingFnRef       = useRef(null);
  const aiTransBufRef      = useRef("");
  const lastUserTranscriptRef = useRef("");
  const responseBusyRef    = useRef(false);
  const queuedResponseRef  = useRef(false);
  const openingSentRef     = useRef(false);
  const sessionEpochRef    = useRef(0);
  const detectedCountryRef   = useRef("Sri Lanka");
  const holdMusicEnabledRef  = useRef(true);
  const holdMusicVolumeRef   = useRef(0.28);
  const voiceSessionIdRef    = useRef(null);   // persists the vs_... session across turns
  const activeAudioRef       = useRef([]);     // all live AudioBufferSourceNodes (for overlap fix)
  // Hold music refs
  const holdBufRef           = useRef(null);
  const holdGainRef        = useRef(null);
  const holdSourceRef      = useRef(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { detectedCountryRef.current = detectedCountry; }, [detectedCountry]);
  useEffect(() => { holdMusicEnabledRef.current = holdMusicEnabled; }, [holdMusicEnabled]);
  useEffect(() => { holdMusicVolumeRef.current = holdMusicVolume; }, [holdMusicVolume]);
  useEffect(() => { if (terminalEndRef.current) terminalEndRef.current.scrollIntoView({ behavior: "smooth" }); }, [terminalLog]);
  useEffect(() => {
    if (error && !errorReportDetails) {
      setErrorReportDetails(error);
      setReportCollapsed(false);
    }
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!reportCollapsed) {
      loadErrorReports().catch(() => {});
    }
  }, [reportCollapsed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSelectedErrorReportIndex((prev) => {
      if (errorReports.length === 0) return 0;
      return Math.min(prev, errorReports.length - 1);
    });
  }, [errorReports]);
  useEffect(() => () => teardown(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ───────────────────────────────────────────────────────────────
  function addLog(type, msg, detail = "") {
    const ts = new Date().toISOString().slice(11, 23);
    setTerminalLog((p) => [...p.slice(-100), { ts, type, message: msg, detail }]);
  }
  function pushMessage(role, content) {
    if (!content?.trim()) return;
    setConversation((p) => [...p, { role, content: content.trim() }]);
  }
  function looksLikeGarbledTurn(transcript, proposedPrompt) {
    const actual = normalizeTextForCompare(transcript);
    const proposed = normalizeTextForCompare(proposedPrompt);
    if (!actual || !proposed) return false;
    const actualWords = actual.split(" ").filter(Boolean);
    if (actualWords.length <= 5) return wordOverlapScore(actual, proposed) < 0.4;
    return wordOverlapScore(actual, proposed) < 0.25;
  }
  function sendWs(obj) {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(obj));
  }
  function requestResponseCreate() {
    if (responseBusyRef.current) {
      queuedResponseRef.current = true;
      return;
    }
    sendWs({ type: "response.create" });
    responseBusyRef.current = true;
  }
  function queueFollowupResponse() {
    queuedResponseRef.current = true;
    flushQueuedResponseCreate();
  }
  function flushQueuedResponseCreate() {
    if (!queuedResponseRef.current || responseBusyRef.current) return;
    queuedResponseRef.current = false;
    sendWs({ type: "response.create" });
    responseBusyRef.current = true;
  }
  function startTimer() {
    callStartRef.current = Date.now(); setCallDuration(0);
    callTimerRef.current = setInterval(() => setCallDuration(Date.now() - callStartRef.current), 500);
  }
  function stopTimer() { if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; } }

  // ── Country detection via IP ───────────────────────────────────────────────
  async function detectCountry() {
    try {
      const res  = await fetch("https://ipapi.co/json/");
      const data = await res.json();
      const c    = data.country_name || "Sri Lanka";
      setDetectedCountry(c);
      detectedCountryRef.current = c;
      addLog("info", `Country detected: ${c}`);
      return c;
    } catch {
      addLog("warn", "Country detection failed — defaulting to Sri Lanka");
      return "Sri Lanka";
    }
  }

  // ── Hold music (ambient-music.mp3 from /public) ───────────────────────────
  async function preloadHoldMusic() {
    const ctx = audioCtxRef.current;
    if (!ctx || holdBufRef.current) return;
    try {
      const res = await fetch("/ambient-music.mp3");
      const ab  = await res.arrayBuffer();
      holdBufRef.current = await ctx.decodeAudioData(ab);
      addLog("info", "Hold music loaded");
    } catch { addLog("warn", "Hold music unavailable"); }
  }

  function startHoldMusic() {
    const ctx = audioCtxRef.current;
    const buf = holdBufRef.current;
    if (!ctx || !buf || holdGainRef.current) return;

    const targetVol = Math.max(0.001, holdMusicVolumeRef.current);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(targetVol, ctx.currentTime + 2.5);
    gain.connect(ctx.destination);
    holdGainRef.current = gain;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop   = true;
    src.connect(gain);
    src.start(0);
    holdSourceRef.current = src;
    setHoldMusicActive(true);
    addLog("info", `Hold music started (vol ${Math.round(targetVol * 100)}%)`);
  }

  function stopHoldMusic() {
    const ctx  = audioCtxRef.current;
    const gain = holdGainRef.current;
    if (!ctx || !gain) return;

    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.001), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);

    setTimeout(() => {
      try { holdSourceRef.current?.stop(); } catch {}
      holdSourceRef.current = null;
      holdGainRef.current   = null;
      setHoldMusicActive(false);
    }, 2600);
    addLog("info", "Hold music fading out");
  }

  // Fix 4: stop all in-flight AI audio so a new response never overlaps the old one
  function stopAllActiveAudio() {
    for (const src of activeAudioRef.current) {
      try { src.stop(0); } catch {}
    }
    activeAudioRef.current  = [];
    nextPlayTimeRef.current = 0;
  }

  function beginNewCallSession() {
    sessionEpochRef.current += 1;
    voiceSessionIdRef.current = null;
  }

  function downloadJsonFile(payload, fileName = "download.json") {
    if (typeof window === "undefined") return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function getSelectedErrorReport() {
    if (!errorReports.length) return null;
    const safeIndex = Math.max(0, Math.min(selectedErrorReportIndex, errorReports.length - 1));
    return errorReports[safeIndex] || null;
  }

  function buildErrorReportPayload() {
    return {
      title: errorReportTitle.trim() || "Realtime Test Report",
      details: errorReportDetails.trim(),
      severity: errorReportSeverity,
      session_id: voiceSessionIdRef.current || "",
      country: detectedCountryRef.current,
      current_error: error || "",
      phase,
      latest_transcript: userTranscript || "",
      package_status: packageStatus,
      conversation,
      terminal_log: terminalLog,
      packages: fetchedPackages,
      quotation_status: quotationStatus,
    };
  }

  async function submitErrorReport() {
    const title = errorReportTitle.trim();
    const details = errorReportDetails.trim();
    if (!title || !details) {
      setErrorReportMessage("Title and details are required.");
      return;
    }

    setErrorReportSaving(true);
    setErrorReportMessage("");

    try {
      const res = await fetch(`${LARAVEL_API}/aahaas-realtime/error-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(buildErrorReportPayload()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not save error dataset.");

      setErrorReportMessage(`Saved to database as ${data.report?.report_id || "new error report"}.`);
      setErrorReports((prev) => [data.report, ...prev.filter((r) => r.report_id !== data.report?.report_id)]);
      setErrorReportDetails("");
      setErrorReportsTab("reports");
      setSelectedErrorReportIndex(0);
    } catch (err) {
      setErrorReportMessage(err.message || "Could not save error dataset.");
    } finally {
      setErrorReportSaving(false);
    }
  }

  async function loadErrorReports() {
    setErrorReportsLoading(true);
    try {
      const res = await fetch(`${LARAVEL_API}/aahaas-realtime/error-reports`, { headers: { Accept: "application/json" } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not load submitted errors.");
      setErrorReports(Array.isArray(data.reports) ? data.reports : []);
    } catch (err) {
      setErrorReportMessage(err.message || "Could not load submitted errors.");
    } finally {
      setErrorReportsLoading(false);
    }
  }

  async function downloadAllErrorReports() {
    setDownloadAllSaving(true);
    setErrorReportMessage("");
    try {
      const res = await fetch(`${LARAVEL_API}/aahaas-realtime/error-reports/download`, {
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not download all error reports.");

      downloadJsonFile(data.payload || {}, data.file_name || "error-reports.json");
      setErrorReportMessage(`Saved ${data.count || 0} report(s) to ${data.saved_path || "local storage"}.`);
    } catch (err) {
      setErrorReportMessage(err.message || "Could not download all error reports.");
    } finally {
      setDownloadAllSaving(false);
    }
  }

  async function resetAllErrorReports() {
    if (typeof window !== "undefined" && !window.confirm("Delete all submitted error reports? This cannot be undone.")) {
      return;
    }

    setResetErrorsSaving(true);
    setErrorReportMessage("");
    try {
      const res = await fetch(`${LARAVEL_API}/aahaas-realtime/error-reports`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not reset error reports.");
      setErrorReports([]);
      setSelectedErrorReportIndex(0);
      setErrorReportsTab("form");
      setErrorReportMessage(`Deleted ${data.deleted || 0} submitted error report(s).`);
    } catch (err) {
      setErrorReportMessage(err.message || "Could not reset error reports.");
    } finally {
      setResetErrorsSaving(false);
    }
  }

  // ── Mic capture ───────────────────────────────────────────────────────────
  async function startMicCapture() {
    const ctx = new AudioContext({ sampleRate: 24000 });
    audioCtxRef.current  = ctx;
    nextPlayTimeRef.current = 0;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    });
    micStreamRef.current = stream;

    const source    = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(1024, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      const f32 = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
      const rms = Math.sqrt(sum / f32.length);
      setMicLevel((p) => p * 0.6 + rms * 0.4);

      // ── Half-duplex echo guard ──────────────────────────────────────────────
      // On SPEAKERS the AI's own voice leaks back into the mic. Browser echo-
      // cancellation does not reliably cancel Web-Audio playback, so the model was
      // hearing itself, firing speech_started, and cutting its own reply off
      // mid-sentence (also what made it sound choppy). While the AI is speaking —
      // or searching with hold music — we send SILENCE upstream so it never hears
      // itself. When it's the caller's turn we stream the full mic and let the
      // server's noise_reduction + semantic_vad handle background noise.
      const ctx = audioCtxRef.current;
      const aiBusyPhase = ["speaking", "searching", "sending_wa"].includes(phaseRef.current);
      const aiAudioTail = ctx && ctx.currentTime < nextPlayTimeRef.current + AI_ECHO_TAIL_SEC;
      // Keep the mic muted while the assistant is speaking so playback does not leak
      // back into the model and break the response on hosted deployments.
      const muteMic     = responseBusyRef.current || aiBusyPhase || aiAudioTail;

      const pcm = muteMic ? new Int16Array(f32.length) : float32ToPcm16(f32);
      wsRef.current.send(JSON.stringify({ type: "input_audio_buffer.append", audio: bufToBase64(pcm.buffer) }));
    };

    source.connect(processor);
    processor.connect(ctx.destination);
    await preloadHoldMusic();
  }

  // ── PCM16 playback — tracks every source so stopAllActiveAudio can cancel them ──
  function playAudioDelta(b64) {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const pcm = base64ToPcm16(b64);
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
    const buf = ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const at = Math.max(nextPlayTimeRef.current, ctx.currentTime + 0.02);
    src.start(at);
    nextPlayTimeRef.current = at + buf.duration;
    // Track so we can stop it on interruption
    activeAudioRef.current.push(src);
    src.onended = () => {
      const i = activeAudioRef.current.indexOf(src);
      if (i !== -1) activeAudioRef.current.splice(i, 1);
    };
  }

  // ── Teardown ──────────────────────────────────────────────────────────────
  function teardown() {
    stopTimer(); stopHoldMusic();
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    micStreamRef.current?.getTracks().forEach((t) => t.stop()); micStreamRef.current = null;
    if (audioCtxRef.current?.state !== "closed") audioCtxRef.current?.close();
    audioCtxRef.current = null; holdBufRef.current = null;
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    voiceSessionIdRef.current = null;
    nextPlayTimeRef.current = 0; setMicLevel(0);
  }

  // ── Event handler ─────────────────────────────────────────────────────────
  const handleEvent = useCallback(async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const type = msg.type || "";

    if (type === "session.created" || type === "session.updated") {
      addLog("info", type === "session.created" ? "Session ready" : "Session configured");
      setPhase("connected"); setStatusMsg("Connected — speak when ready.");
      if (type === "session.updated" && !openingSentRef.current) {
        openingSentRef.current = true;
        requestResponseCreate();
      }
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      stopAllActiveAudio(); // user interrupted — cancel AI audio immediately
      setPhase("listening"); setStatusMsg("Listening...");
      addLog("state", "User speaking"); return;
    }
    if (type === "input_audio_buffer.speech_stopped") {
      setPhase("connected"); setStatusMsg("Processing..."); addLog("state", "Processing"); return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = msg.transcript || "";
      lastUserTranscriptRef.current = text;
      setUserTranscript(text); if (text) pushMessage("user", text);
      addLog("info", "You said", text.slice(0, 80)); return;
    }
    if (type === "response.created") {
      stopAllActiveAudio(); // cancel any previous response still playing — prevents overlap
      responseBusyRef.current = true;
      aiTransBufRef.current = ""; setAiTranscript("");
      setPhase("speaking"); setStatusMsg("Aahaas is speaking..."); return;
    }
    if (type === "response.output_audio.delta" && msg.delta) { playAudioDelta(msg.delta); return; }
    if (type === "response.output_audio_transcript.delta") {
      aiTransBufRef.current += (msg.delta || ""); setAiTranscript(aiTransBufRef.current); return;
    }
    if (type === "response.output_audio_transcript.done") {
      const text = msg.transcript || aiTransBufRef.current;
      setAiTranscript(text); if (text) pushMessage("assistant", text);
      aiTransBufRef.current = ""; addLog("info", "AI said", text.slice(0, 80)); return;
    }
    if (type === "response.done") {
      responseBusyRef.current = false;
      flushQueuedResponseCreate();
      setPhase("connected"); setStatusMsg("Connected — speak when ready."); return;
    }
    if (type === "response.output_item.added" && msg.item?.type === "function_call") {
      pendingFnRef.current = { call_id: msg.item.call_id, name: msg.item.name, args: "" };
      addLog("info", `Tool: ${msg.item.name}`); return;
    }
    if (type === "response.function_call_arguments.delta" && pendingFnRef.current) {
      pendingFnRef.current.args += (msg.delta || ""); return;
    }
    if (type === "response.function_call_arguments.done") {
      const fn = pendingFnRef.current; if (!fn) return;
      fn.args = msg.arguments || fn.args; pendingFnRef.current = null;
      await executeTool(fn); return;
    }
    if (type === "error") {
      const m = msg.error?.message || "Realtime error";
      addLog("api-err", `Error: ${m}`); setError(m);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tool execution ────────────────────────────────────────────────────────
  async function executeTool({ call_id, name, args }) {
    let parsed = {}; try { parsed = JSON.parse(args || "{}"); } catch {}

    if (name === "fetch_travel_package") {
      await executePackageFetch(call_id, parsed);
    } else if (name === "send_whatsapp_quotation") {
      await executeWhatsApp(call_id, parsed);
    } else {
      sendWs({ type: "conversation.item.create", item: { type: "function_call_output", call_id, output: "Unknown tool." } });
      requestResponseCreate();
    }
  }

  async function executePackageFetch(call_id, args) {
    const requestEpoch = sessionEpochRef.current;
    const customerPrompt = String(args.customer_voice_prompt ?? "").trim();
    const actualTranscript = lastUserTranscriptRef.current || "";
    // Only honour a known action; an unknown/missing one is left null and omitted
    // from the payload so the API classifies the turn (never silently new_request).
    const action = VALID_SUGGEST_ACTIONS.includes(args.action) ? args.action : null;

    // If the model's proposed prompt does not line up with what the user actually
    // said, treat it as a bad/garbled turn and ask for a repeat instead of guessing.
    if (looksLikeGarbledTurn(actualTranscript, customerPrompt)) {
      addLog("warn", "Tool prompt did not match transcript — asking for clarification", actualTranscript.slice(0, 80));
      sendWs({ type: "conversation.item.create", item: { type: "function_call_output", call_id,
        output: "The caller's words were unclear or low confidence. Do not guess a destination or change. Ask them to repeat the request clearly and naturally." } });
      queueFollowupResponse();
      setPhase("speaking");
      return;
    }

    // Guard: malformed/empty tool args must not trigger a destructive empty call.
    if (!customerPrompt) {
      addLog("warn", "Tool call had no prompt — asking AI to restate");
      sendWs({ type: "conversation.item.create", item: { type: "function_call_output", call_id,
        output: "No customer words were captured this turn. Do NOT change the plan. Politely ask the customer to repeat what they'd like." } });
      queueFollowupResponse();
      setPhase("speaking");
      return;
    }

    // Fast actions (price_query, confirm) don't rebuild — no hold music needed.
    // An unknown action may re-plan server-side, so treat it as slow.
    const isSlowAction = !["price_query", "confirm"].includes(action);

    setPhase("searching");
    setStatusMsg(isSlowAction ? "Searching packages... 🎵" : "Checking price...");
    setPackageStatus("loading");
    addLog("api-start", `→ fetch_travel_package [${action || "auto"}]`, customerPrompt.slice(0, 60));

    if (isSlowAction && holdMusicEnabledRef.current) startHoldMusic();

    const payload = {
      tool: "fetch_travel_package",
      customer_voice_prompt: customerPrompt,
    };
    if (action) payload.action = action;   // omit when unknown => API classifies
    // Structured slots the model extracted this turn (nights, travelers, add/remove
    // items, etc.). Laravel composes these into a precise, deterministic prompt so a
    // "change" turn isn't left to free-text guessing. Only forward a non-empty object.
    if (args.details && typeof args.details === "object" && Object.keys(args.details).length > 0) {
      payload.details = args.details;
    }
    // Automatically include session_id if we have one (maintains cart state)
    if (voiceSessionIdRef.current) payload.session_id = voiceSessionIdRef.current;

    const t0 = Date.now();
    let aiOutput = "Package service unavailable. We will follow up via WhatsApp.";

    try {
      const res  = await fetch(`${LARAVEL_API}/aahaas-realtime/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (requestEpoch !== sessionEpochRef.current) return;
      addLog(res.ok ? "api-ok" : "api-err",
        `${res.ok ? "✓" : "✗"} [${action || "auto"}] — ${msToDisplay(Date.now() - t0)}`);

      if (data.success) {
        // Save session_id for subsequent turns — this is how the API maintains cart state
        if (data.session_id) {
          voiceSessionIdRef.current = data.session_id;
          addLog("info", `Session: ${data.session_id}`);
        }

        // success:true can still carry an empty package (API's apology fallback).
        // Don't show a green "Ready" badge unless real content came back.
        const hasContent = (data.products?.length > 0) || data.hotel || data.pricing?.grand_total;
        setPackageStatus(hasContent ? "ready" : "empty");
        setPackageText(data.voice_text || "");

        // Accumulate every fetch as a structured numbered entry
        setFetchedPackages((prev) => [
          ...prev,
          {
            id:                 prev.length + 1,
            ts:                 new Date().toLocaleTimeString(),
            intent:             data.intent || action,
            voice_text:         data.voice_text || "",
            destination:        data.destination || "",
            currency:           data.currency || "USD",
            hotel:              data.hotel || null,
            products:           data.products || [],
            pricing:            data.pricing || null,
            additional_options: data.additional_options || [],
          },
        ]);

        // The ai_output is a rich text block the AI reads — includes exact prices + upsell options
        aiOutput = data.ai_output || data.voice_text || "Package found.";
        addLog("info", "Package ready", (data.voice_text || "").slice(0, 80));
      } else {
        aiOutput = data.result || aiOutput;
        setPackageStatus("failed");
        addLog("warn", "Package failed", data.result);
      }
    } catch (e) {
      addLog("api-err", `Package error: ${e.message}`);
      setPackageStatus("failed");
    }

    if (isSlowAction && holdMusicEnabledRef.current) stopHoldMusic();

    sendWs({ type: "conversation.item.create", item: { type: "function_call_output", call_id, output: aiOutput } });
    queueFollowupResponse();
    setPhase("speaking");
    setStatusMsg("Aahaas is speaking...");
  }

  async function executeWhatsApp(call_id, args) {
    const requestEpoch = sessionEpochRef.current;
    const { customer_name = "", phone_number = "", package_summary = "" } = args;
    const waId = normalizePhone(phone_number, detectedCountryRef.current);

    setPhase("sending_wa"); setQuotationStatus("sending");
    setQuotationInfo({ name: customer_name, phone: waId, sent: false });
    setConfirmedPackage(package_summary);           // store for display
    setStatusMsg("Sending WhatsApp quotation...");
    addLog("api-start", `→ WhatsApp to ${customer_name} (${waId})`);

    let output = "Could not send WhatsApp. Our team will follow up shortly.";

    try {
      const res  = await fetch(`${LARAVEL_API}/aahaas-realtime/tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "send_whatsapp_quotation", customer_name, phone_number: waId, package_summary }),
      });
      const data = await res.json().catch(() => ({}));

      if (requestEpoch !== sessionEpochRef.current) return;

      if (data.success) {
        output = data.result; setQuotationStatus("sent");
        setQuotationInfo({ name: customer_name, phone: waId, sent: true });
        addLog("api-ok", `✓ WhatsApp sent to ${customer_name}`);
      } else {
        output = data.result || output; setQuotationStatus("failed");
        addLog("api-err", `WhatsApp failed: ${data.result}`);
      }
    } catch (e) {
      setQuotationStatus("failed"); addLog("api-err", `WhatsApp error: ${e.message}`);
    }

    sendWs({ type: "conversation.item.create", item: { type: "function_call_output", call_id, output } });
    queueFollowupResponse();
    setPhase("speaking");
  }

  // ── Connect ───────────────────────────────────────────────────────────────
  async function handleConnect() {
    if (!["idle", "failed", "completed"].includes(phase)) return;

    setError(""); setPhase("detecting"); setStatusMsg("Detecting your location...");
    setConversation([]); setUserTranscript(""); setAiTranscript("");
    setPackageStatus("idle"); setPackageText("");
    setFetchedPackages([]); setConfirmedPackage(null);
    setQuotationStatus("idle"); setQuotationInfo(null);
    setTerminalLog([]); aiTransBufRef.current = "";
    responseBusyRef.current = false;
    queuedResponseRef.current = false;
    openingSentRef.current = false;
    setErrorReportMessage("");
    setErrorReportTitle("Realtime Test Report");
    setErrorReportSeverity("medium");
    setErrorReportDetails("");
    beginNewCallSession();  // reset session for new call and invalidate in-flight results

    try {
      const country = await detectCountry();

      setPhase("connecting"); setStatusMsg("Connecting...");
      addLog("state", "Requesting microphone");
      await startMicCapture();

      const wsUrl = `${WS_BASE}/api/realtime?voice=${encodeURIComponent(selectedVoice)}&country=${encodeURIComponent(country)}`;
      addLog("api-start", `→ WS ${wsUrl}`);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen    = () => { addLog("api-ok", "WebSocket open — waiting for session"); startTimer(); };
      ws.onmessage = (e) => handleEvent(e.data);
      ws.onerror   = () => {
        setError("WebSocket failed. Is the Node.js server running on port 5001?");
        setPhase("failed"); setStatusMsg("Connection failed."); stopTimer(); teardown();
      };
      ws.onclose = (e) => {
        addLog("state", `WebSocket closed (${e.code})`);
        if (!["completed", "failed"].includes(phaseRef.current)) {
          setPhase("idle"); setStatusMsg("Connection closed."); stopTimer();
        }
      };
    } catch (err) {
      teardown(); setPhase("failed");
      setError(err.message || "Connection failed.");
      setStatusMsg("Connection failed.");
      addLog("api-err", `Connect error: ${err.message}`); stopTimer();
    }
  }

  async function saveSession(endedReason = "completed", sessionIdOverride = "") {
    try {
      const lastPkg = fetchedPackages[fetchedPackages.length - 1] || null;
      const voiceSessionId = sessionIdOverride || voiceSessionIdRef.current || "";
      await fetch(`${LARAVEL_API}/aahaas-realtime/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation:      conversation,
          packages:          fetchedPackages,
          customer_name:     quotationInfo?.name     || "",
          customer_phone:    quotationInfo?.phone    || "",
          country:           detectedCountryRef.current,
          voice_session_id:  voiceSessionId,
          confirmed_package: confirmedPackage || "",
          total_amount:      lastPkg?.pricing?.grand_total || null,
          currency:          lastPkg?.currency || "",
          quotation_sent:    quotationStatus === "sent",
          call_duration_ms:  callDuration,
          ended_reason:      endedReason,
          started_at:        callStartRef.current ? new Date(callStartRef.current).toISOString() : null,
        }),
      });
      addLog("api-ok", "✓ Session saved to database");
    } catch (e) {
      addLog("api-err", `Session save failed: ${e.message}`);
    }
  }

  function handleDisconnect() {
    addLog("state", "Disconnecting");
    const sessionIdSnapshot = voiceSessionIdRef.current || "";
    sessionEpochRef.current += 1;
    voiceSessionIdRef.current = null;
    saveSession("manual_hangup", sessionIdSnapshot);
    teardown();
    setPhase("completed");
    setStatusMsg("Session ended.");
    stopTimer();
  }

  function handleReset() {
    teardown(); setPhase("idle"); setError(""); setStatusMsg("Ready to connect.");
    setConversation([]); setUserTranscript(""); setAiTranscript("");
    setPackageStatus("idle"); setPackageText("");
    setFetchedPackages([]); setConfirmedPackage(null);
    setQuotationStatus("idle"); setQuotationInfo(null);
    setTerminalLog([]); setCallDuration(0); setMicLevel(0);
    setHoldMusicActive(false);
    setDetectedCountry("Sri Lanka"); detectedCountryRef.current = "Sri Lanka";
    voiceSessionIdRef.current = null; activeAudioRef.current = [];
    sessionEpochRef.current += 1;
    responseBusyRef.current = false;
    queuedResponseRef.current = false;
    openingSentRef.current = false;
    aiTransBufRef.current = "";
    setErrorReportMessage("");
    setErrorReportTitle("Realtime Test Report");
    setErrorReportSeverity("medium");
    setErrorReportDetails("");
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const phaseInfo     = PHASES[phase] || PHASES.idle;
  const canConnect    = ["idle", "failed", "completed"].includes(phase);
  const canDisconnect = ["connected", "listening", "speaking", "searching", "sending_wa"].includes(phase);

  const pkgColor = { idle: "#6b7280", loading: "#f59e0b", ready: "#10b981", empty: "#f59e0b", failed: "#ef4444" }[packageStatus] || "#6b7280";
  const pkgLabel = { idle: "Not started", loading: "Searching...", ready: "Package Ready", empty: "No package found", failed: "Unavailable" }[packageStatus];
  const waColor  = { idle: "#6b7280", sending: "#f59e0b", sent: "#10b981", failed: "#ef4444" }[quotationStatus] || "#6b7280";

  const card   = { background: "rgba(255,255,255,0.95)", border: "1px solid rgba(15,23,42,0.08)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 2px 12px rgba(15,23,42,0.06)" };
  const kicker = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#94a3b8", marginBottom: 8, display: "block" };

  return (
    <div style={{ fontFamily: "'Space Grotesk','Segoe UI',system-ui,sans-serif", background: "#f0f4f8", minHeight: "100vh", paddingBottom: 32 }}>

      {/* HEADER */}
      <header style={{ background: "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)", padding: "14px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 4px 24px rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚡</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>Aahaas Realtime V0.2</div>
            <div style={{ color: "#94a3b8", fontSize: 11 }}>gpt-realtime-2 · WebSocket · PCM16 audio</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Country badge */}
          {phase !== "idle" && (
            <span style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc", padding: "4px 10px", borderRadius: 8, fontSize: 11, border: "1px solid rgba(99,102,241,0.25)" }}>
              📍 {detectedCountry}
            </span>
          )}
          {callDuration > 0 && (
            <span style={{ background: "rgba(16,185,129,0.15)", color: "#6ee7b7", padding: "4px 10px", borderRadius: 8, fontSize: 11, fontFamily: "monospace", border: "1px solid rgba(16,185,129,0.25)" }}>
              {msToDisplay(callDuration)}
            </span>
          )}
          <span style={{ background: `${phaseInfo.color}1a`, color: phaseInfo.color, border: `1px solid ${phaseInfo.color}40`, padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, minWidth: 100, textAlign: "center" }}>
            {phaseInfo.label}
          </span>
        </div>
      </header>

      {/* MAIN GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "230px 1fr 270px", gap: 14, padding: "14px 14px 0", alignItems: "start" }}>

        {/* LEFT */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Voice selector */}
          <div style={card}>
            <span style={kicker}>Voice</span>
            <select value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} disabled={!canConnect}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(15,23,42,0.12)", background: !canConnect ? "#f1f5f9" : "#fff", fontSize: 12, color: "#1e293b", outline: "none" }}>
              {OPENAI_VOICES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>

          {/* Hold music — toggle + volume + live level bar */}
          <div style={card}>
            <span style={kicker}>Search Hold Music</span>

            {/* Toggle row */}
            <div onClick={() => setHoldMusicEnabled((p) => !p)}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderRadius: 9, cursor: "pointer", marginBottom: 10, background: holdMusicEnabled ? "rgba(245,158,11,0.07)" : "rgba(100,116,139,0.06)", border: `1px solid ${holdMusicEnabled ? "rgba(245,158,11,0.25)" : "rgba(100,116,139,0.18)"}`, transition: "all 0.18s" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: holdMusicEnabled ? "#d97706" : "#64748b" }}>
                🎵 {holdMusicEnabled ? "Enabled" : "Disabled"}
              </span>
              <div style={{ width: 36, height: 20, borderRadius: 10, background: holdMusicEnabled ? "#f59e0b" : "#cbd5e1", position: "relative", transition: "background 0.18s", flexShrink: 0 }}>
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: holdMusicEnabled ? 18 : 2, transition: "left 0.18s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
              </div>
            </div>

            {/* Live level bar — shows activity when music is playing */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "#64748b" }}>Level</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: holdMusicActive ? "#f59e0b" : "#94a3b8" }}>
                  {holdMusicActive ? "▶ Playing" : "Silent"}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: "#e2e8f0", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 4,
                  width: holdMusicActive ? `${Math.round(holdMusicVolume * 100)}%` : "0%",
                  background: "linear-gradient(90deg,#f59e0b,#d97706)",
                  transition: "width 0.4s ease",
                }} />
              </div>
            </div>

            {/* Volume slider */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 10, color: "#64748b" }}>Volume</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b" }}>{Math.round(holdMusicVolume * 100)}%</span>
              </div>
              <input type="range" min={0.01} max={1} step={0.01} value={holdMusicVolume}
                onChange={(e) => setHoldMusicVolume(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "#f59e0b", cursor: "pointer" }} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                <span style={{ fontSize: 9, color: "#94a3b8" }}>Quiet</span>
                <span style={{ fontSize: 9, color: "#94a3b8" }}>Loud</span>
              </div>
            </div>

            <p style={{ fontSize: 10, color: "#94a3b8", margin: "6px 0 0", lineHeight: 1.5 }}>
              Plays only during package search (slow actions). Price checks are instant — no music.
            </p>
          </div>

          {/* Mic sensitivity */}
          <div style={card}>
            <span style={kicker}>Mic Sensitivity</span>
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>Input level</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: micLevel > sensitivity ? "#10b981" : "#94a3b8" }}>
                  {micLevel > sensitivity ? "Voice detected" : "Silent"}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 4, background: "#e2e8f0", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 4, width: `${Math.min(100, micLevel * 800)}%`, background: micLevel > sensitivity ? "#10b981" : "#94a3b8", transition: "width 0.08s" }} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: "#64748b" }}>Indicator threshold</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#6366f1" }}>
                {sensitivity < 0.008 ? "Very sensitive" : sensitivity < 0.025 ? "Balanced" : "Strict"}
              </span>
            </div>
            <input type="range" min={0.003} max={0.06} step={0.001} value={sensitivity}
              onChange={(e) => setSensitivity(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#6366f1", cursor: "pointer" }} />
            <p style={{ fontSize: 10, color: "#94a3b8", margin: "6px 0 0", lineHeight: 1.5 }}>
              Visual only. Actual noise filtering & turn-taking are handled automatically on the server (near-field noise reduction + semantic VAD).
            </p>
          </div>

          {/* WhatsApp Status */}
          <div style={{ ...card, border: `1px solid ${waColor}30`, background: quotationStatus === "idle" ? undefined : `${waColor}06` }}>
            <span style={{ ...kicker, color: quotationStatus !== "idle" ? waColor : undefined }}>WhatsApp Quotation</span>
            {quotationStatus === "idle" ? (
              <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>Will send after package confirmed.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>
                    {quotationStatus === "sending" ? "⏳" : quotationStatus === "sent" ? "✅" : "❌"}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: waColor }}>
                    {quotationStatus === "sending" ? "Sending..." : quotationStatus === "sent" ? "Sent!" : "Failed"}
                  </span>
                </div>
                {quotationInfo && (
                  <div style={{ background: "rgba(15,23,42,0.04)", borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>Name</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#1e293b" }}>{quotationInfo.name}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>WhatsApp</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#1e293b", fontFamily: "monospace" }}>+{quotationInfo.phone}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* CENTER */}
        <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          <div style={{ ...card, textAlign: "center", padding: "28px 22px" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
              <div className={`call-orb phase-${phase === "listening" ? "listening" : phase === "speaking" || phase === "searching" ? "assistant-speaking" : phase === "connecting" || phase === "detecting" ? "connecting" : phase === "connected" ? "connected" : "idle"}`}>
                <div className="call-orb-core" />
                <div className="call-orb-ring ring-one" />
                <div className="call-orb-ring ring-two" />
                <div className="call-orb-ring ring-three" />
              </div>
            </div>
            <div style={{ fontWeight: 600, color: "#1e293b", fontSize: 14, marginBottom: 6 }}>{statusMsg}</div>
            {error && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6, background: "rgba(239,68,68,0.06)", padding: "6px 12px", borderRadius: 8 }}>{error}</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
              <button type="button" onClick={handleConnect} disabled={!canConnect} style={{ padding: "11px 28px", borderRadius: 10, border: "none", cursor: !canConnect ? "not-allowed" : "pointer", background: !canConnect ? "#e2e8f0" : "linear-gradient(135deg,#6366f1,#8b5cf6)", color: !canConnect ? "#94a3b8" : "#fff", fontWeight: 700, fontSize: 13, boxShadow: !canConnect ? "none" : "0 4px 14px rgba(99,102,241,0.32)" }}>
                ⚡ Connect
              </button>
              <button type="button" onClick={handleDisconnect} disabled={!canDisconnect} style={{ padding: "11px 24px", borderRadius: 10, border: "none", cursor: !canDisconnect ? "not-allowed" : "pointer", background: !canDisconnect ? "#e2e8f0" : "linear-gradient(135deg,#ef4444,#dc2626)", color: !canDisconnect ? "#94a3b8" : "#fff", fontWeight: 700, fontSize: 13, boxShadow: !canDisconnect ? "none" : "0 4px 14px rgba(239,68,68,0.32)" }}>
                ■ End
              </button>
              <button type="button" onClick={handleReset} style={{ padding: "11px 20px", borderRadius: 10, border: "1px solid rgba(15,23,42,0.12)", cursor: "pointer", background: "#f8fafc", color: "#475569", fontWeight: 600, fontSize: 13 }}>
                ↺ Reset
              </button>
            </div>
          </div>

          {/* Transcripts */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={card}>
              <span style={kicker}>You Said</span>
              <p style={{ fontSize: 12, color: userTranscript ? "#1e293b" : "#94a3b8", margin: 0, lineHeight: 1.65 }}>{userTranscript || "Your words appear here..."}</p>
            </div>
            <div style={card}>
              <span style={kicker}>Aahaas AI</span>
              <p style={{ fontSize: 12, color: aiTranscript ? "#1e293b" : "#94a3b8", margin: 0, lineHeight: 1.65 }}>{aiTranscript || "AI response appears here..."}</p>
            </div>
          </div>

          {/* ── Package search results (structured, numbered per turn) ── */}
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(15,23,42,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>Package Results</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: pkgColor, background: `${pkgColor}15`, padding: "3px 10px", borderRadius: 20, border: `1px solid ${pkgColor}30` }}>
                {packageStatus === "loading" ? "🎵 Searching..." : fetchedPackages.length > 0 ? `${fetchedPackages.length} turn${fetchedPackages.length > 1 ? "s" : ""}` : pkgLabel}
              </span>
            </div>
            <div style={{ maxHeight: 400, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
              {fetchedPackages.length === 0 ? (
                <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>
                  {packageStatus === "loading" ? "🎵 Hold music playing while we build your package..." : "Results appear here as the conversation progresses."}
                </p>
              ) : (
                fetchedPackages.map((pkg) => {
                  const intentColors = {
                    new_request: "#6366f1", add_hotel: "#3b82f6", add_product: "#10b981",
                    change: "#f59e0b", price_query: "#8b5cf6", confirm: "#10b981",
                  };
                  const ic = intentColors[pkg.intent] || "#94a3b8";
                  return (
                    <div key={pkg.id} style={{ border: "1px solid rgba(99,102,241,0.18)", borderRadius: 12, overflow: "hidden" }}>
                      {/* Header */}
                      <div style={{ background: "rgba(99,102,241,0.05)", padding: "7px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: "#6366f1" }}>#{pkg.id}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: ic, background: `${ic}18`, padding: "2px 8px", borderRadius: 10, border: `1px solid ${ic}35` }}>
                          {pkg.intent?.replace("_", " ").toUpperCase()}
                        </span>
                        {pkg.destination && <span style={{ fontSize: 11, color: "#475569", fontWeight: 600 }}>📍 {pkg.destination}</span>}
                        <span style={{ marginLeft: "auto", fontSize: 10, color: "#94a3b8", fontFamily: "monospace" }}>{pkg.ts}</span>
                      </div>

                      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                        {/* Voice text summary */}
                        <p style={{ fontSize: 12, color: "#1e293b", margin: 0, lineHeight: 1.65 }}>{pkg.voice_text}</p>

                        {/* Included products */}
                        {pkg.products?.length > 0 && (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>Included</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                              {pkg.products.map((p, i) => (
                                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 8px", background: "rgba(15,23,42,0.03)", borderRadius: 6 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                                    <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#6366f1", padding: "1px 5px", borderRadius: 4, flexShrink: 0 }}>{p.type}</span>
                                    <span style={{ fontSize: 11, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                                  </div>
                                  {p.total_amount && (
                                    <span style={{ fontSize: 11, fontWeight: 700, color: "#1e293b", flexShrink: 0, marginLeft: 8 }}>
                                      {p.currency || pkg.currency} {Number(p.total_amount).toFixed(0)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Grand total */}
                        {pkg.pricing?.grand_total && (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "rgba(99,102,241,0.07)", borderRadius: 8, border: "1px solid rgba(99,102,241,0.15)" }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#6366f1" }}>
                              Grand Total {pkg.pricing.source === "cart" ? "(exact)" : "(estimate)"}
                            </span>
                            <span style={{ fontSize: 14, fontWeight: 800, color: "#6366f1" }}>
                              {pkg.pricing.currency || pkg.currency} {Number(pkg.pricing.grand_total).toLocaleString()}
                            </span>
                          </div>
                        )}

                        {/* Additional options (upsell) */}
                        {pkg.additional_options?.length > 0 && (
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>Could also add</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                              {pkg.additional_options.slice(0, 5).map((o, i) => (
                                <span key={i} style={{ fontSize: 10, color: "#64748b", background: "rgba(100,116,139,0.08)", border: "1px solid rgba(100,116,139,0.18)", padding: "3px 8px", borderRadius: 20 }}>
                                  {o.name} {o.indicative_price ? `~${o.currency || pkg.currency} ${Number(o.indicative_price).toFixed(0)}` : ""}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── Confirmed package summary ── */}
          {confirmedPackage && (
            <div style={{ ...card, background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.25)", padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(16,185,129,0.15)", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>✅</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981" }}>Customer Confirmed Package</span>
                {quotationInfo && (
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 10px", borderRadius: 20, border: "1px solid rgba(16,185,129,0.25)" }}>
                    Sent to {quotationInfo.name}
                  </span>
                )}
              </div>
              <div style={{ padding: "12px 16px" }}>
                <p style={{ fontSize: 12, color: "#1e293b", margin: 0, lineHeight: 1.7 }}>{confirmedPackage}</p>
              </div>
            </div>
          )}

          {/* Conversation */}
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
              <span style={{ ...kicker, marginBottom: 2 }}>Conversation</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>Full Session History</span>
            </div>
            <div style={{ height: 240, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              {conversation.length === 0
                ? <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>Connect and speak — conversation appears here in real time.</p>
                : conversation.map((m, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "assistant" ? "flex-start" : "flex-end", gap: 3 }}>
                    <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", padding: m.role === "assistant" ? "0 0 0 4px" : "0 4px 0 0" }}>
                      {m.role === "assistant" ? "Aahaas AI" : "You"}
                    </span>
                    <div style={{ maxWidth: "85%", background: m.role === "assistant" ? "rgba(99,102,241,0.08)" : "rgba(16,185,129,0.08)", border: `1px solid ${m.role === "assistant" ? "rgba(99,102,241,0.2)" : "rgba(16,185,129,0.2)"}`, borderRadius: m.role === "assistant" ? "4px 12px 12px 12px" : "12px 4px 12px 12px", padding: "8px 12px", fontSize: 12, color: "#1e293b", lineHeight: 1.6 }}>
                      {m.content}
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        </main>

        {/* RIGHT: Terminal */}
        <aside>
          {/* Error Test Report */}
          <div style={{ background: "#111827", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden", marginBottom: 12 }}>
            <div style={{ padding: "11px 16px", borderBottom: reportCollapsed ? "none" : "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Error Test Report</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>Write a report, then browse submitted data in a separate tab.</span>
                </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => setErrorReportsTab((p) => (p === "form" ? "reports" : "form"))}
                  style={{
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: errorReportsTab === "reports" ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.04)",
                    color: errorReportsTab === "reports" ? "#bfdbfe" : "#e2e8f0",
                    borderRadius: 8,
                    padding: "7px 10px",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                    minWidth: 96,
                  }}
                >
                  {errorReportsTab === "reports" ? "Stored Data" : "Write Report"}
                </button>
                <button
                  type="button"
                  onClick={() => setReportCollapsed((p) => !p)}
                  style={{
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.04)",
                    color: "#e2e8f0",
                    borderRadius: 8,
                    padding: "7px 10px",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                    minWidth: 72,
                  }}
                >
                  {reportCollapsed ? "Expand" : "Minimize"}
                </button>
              </div>
            </div>

            {!reportCollapsed && (
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setErrorReportsTab("form")}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: errorReportsTab === "form" ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.04)",
                      color: errorReportsTab === "form" ? "#fecaca" : "#e2e8f0",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Write Report
                  </button>
                  <button
                    type="button"
                    onClick={() => setErrorReportsTab("reports")}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: errorReportsTab === "reports" ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.04)",
                      color: errorReportsTab === "reports" ? "#bfdbfe" : "#e2e8f0",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Stored Data
                  </button>
                </div>

                {errorReportsTab === "form" ? (
                  <>
                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>Title</span>
                      <input
                        value={errorReportTitle}
                        onChange={(e) => setErrorReportTitle(e.target.value)}
                        placeholder="Realtime Test Report"
                        style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "#0f172a", color: "#e2e8f0", fontSize: 12, outline: "none" }}
                      />
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>Severity</span>
                      <select
                        value={errorReportSeverity}
                        onChange={(e) => setErrorReportSeverity(e.target.value)}
                        style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "#0f172a", color: "#e2e8f0", fontSize: 12, outline: "none" }}
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>Error details</span>
                      <textarea
                        value={errorReportDetails}
                        onChange={(e) => setErrorReportDetails(e.target.value)}
                        placeholder="Write the error or test notes here..."
                        rows={6}
                        style={{ width: "100%", padding: "10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "#0f172a", color: "#e2e8f0", fontSize: 12, outline: "none", resize: "vertical", lineHeight: 1.5 }}
                      />
                    </label>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button
                        type="button"
                        onClick={submitErrorReport}
                        disabled={errorReportSaving}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: "none",
                          cursor: errorReportSaving ? "not-allowed" : "pointer",
                          background: errorReportSaving ? "#475569" : "linear-gradient(135deg,#ef4444,#dc2626)",
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                        >
                        {errorReportSaving ? "Saving..." : "Submit Error"}
                      </button>
                      <button
                        type="button"
                        onClick={loadErrorReports}
                        disabled={errorReportsLoading && errorReports.length === 0}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(59,130,246,0.14)",
                          color: "#bfdbfe",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        List All Submitted Errors
                      </button>
                    </div>

                    <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                      {errorReportMessage || "Submit a report, then switch to the Reports tab to review, download, or reset saved errors."}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button
                        type="button"
                        onClick={loadErrorReports}
                        disabled={errorReportsLoading}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(255,255,255,0.04)",
                          color: "#e2e8f0",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: errorReportsLoading ? "not-allowed" : "pointer",
                        }}
                        >
                        {errorReportsLoading ? "Loading..." : "List All Submitted Errors"}
                      </button>
                      <button
                        type="button"
                        onClick={downloadAllErrorReports}
                        disabled={downloadAllSaving || errorReports.length === 0}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: downloadAllSaving || errorReports.length === 0 ? "rgba(255,255,255,0.04)" : "rgba(59,130,246,0.14)",
                          color: downloadAllSaving || errorReports.length === 0 ? "#64748b" : "#bfdbfe",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: downloadAllSaving || errorReports.length === 0 ? "not-allowed" : "pointer",
                        }}
                      >
                        {downloadAllSaving ? "Downloading..." : "Download All"}
                      </button>
                      <button
                        type="button"
                        onClick={resetAllErrorReports}
                        disabled={resetErrorsSaving || errorReports.length === 0}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: resetErrorsSaving || errorReports.length === 0 ? "rgba(255,255,255,0.04)" : "rgba(239,68,68,0.14)",
                          color: resetErrorsSaving || errorReports.length === 0 ? "#64748b" : "#fecaca",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: resetErrorsSaving || errorReports.length === 0 ? "not-allowed" : "pointer",
                        }}
                      >
                        {resetErrorsSaving ? "Deleting..." : "Reset All Errors"}
                      </button>
                    </div>

                    <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.55 }}>
                      {errorReportMessage || "Browse submitted errors one by one. Download all of them into one JSON file or clear everything from the database."}
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 10, alignItems: "start", marginTop: 2 }}>
                      <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4 }}>
                        {errorReports.length === 0 ? (
                          <div style={{ fontSize: 11, color: "#64748b", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px" }}>
                            No submitted errors yet.
                          </div>
                        ) : (
                          errorReports.map((report, index) => {
                            const isSelected = index === selectedErrorReportIndex;
                            return (
                              <button
                                key={report.report_id}
                                type="button"
                                onClick={() => setSelectedErrorReportIndex(index)}
                                style={{
                                  textAlign: "left",
                                  background: isSelected ? "rgba(59,130,246,0.16)" : "rgba(255,255,255,0.04)",
                                  border: `1px solid ${isSelected ? "rgba(96,165,250,0.35)" : "rgba(255,255,255,0.06)"}`,
                                  borderRadius: 8,
                                  padding: "10px 12px",
                                  color: "#e2e8f0",
                                  cursor: "pointer",
                                }}
                              >
                                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {index + 1}. {report.title}
                                </div>
                                <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.45 }}>
                                  {report.report_id}
                                  <br />
                                  {report.severity || "medium"} · {report.created_at ? new Date(report.created_at).toLocaleString() : "just now"}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>

                      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 12, minHeight: 260 }}>
                        {getSelectedErrorReport() ? (() => {
                          const report = getSelectedErrorReport();
                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 700 }}>
                                    {selectedErrorReportIndex + 1} of {errorReports.length}: {report.title}
                                  </div>
                                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>
                                    {report.report_id} · {report.severity || "medium"} · {report.created_at ? new Date(report.created_at).toLocaleString() : "just now"}
                                  </div>
                                </div>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedErrorReportIndex((i) => Math.max(0, i - 1))}
                                    disabled={selectedErrorReportIndex === 0}
                                    style={{
                                      padding: "7px 10px",
                                      borderRadius: 7,
                                      border: "1px solid rgba(255,255,255,0.12)",
                                      background: selectedErrorReportIndex === 0 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)",
                                      color: selectedErrorReportIndex === 0 ? "#64748b" : "#e2e8f0",
                                      fontWeight: 700,
                                      fontSize: 11,
                                      cursor: selectedErrorReportIndex === 0 ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    Previous
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedErrorReportIndex((i) => Math.min(errorReports.length - 1, i + 1))}
                                    disabled={selectedErrorReportIndex >= errorReports.length - 1}
                                    style={{
                                      padding: "7px 10px",
                                      borderRadius: 7,
                                      border: "1px solid rgba(255,255,255,0.12)",
                                      background: selectedErrorReportIndex >= errorReports.length - 1 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)",
                                      color: selectedErrorReportIndex >= errorReports.length - 1 ? "#64748b" : "#e2e8f0",
                                      fontWeight: 700,
                                      fontSize: 11,
                                      cursor: selectedErrorReportIndex >= errorReports.length - 1 ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    Next
                                  </button>
                                </div>
                              </div>

                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                <div style={{ background: "rgba(15,23,42,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, padding: 10 }}>
                                  <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Details</div>
                                  <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                                    {report.details}
                                  </div>
                                </div>
                                <div style={{ background: "rgba(15,23,42,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, padding: 10 }}>
                                  <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Meta</div>
                                  <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 6, lineHeight: 1.55 }}>
                                    Session: {report.session_id || "n/a"}
                                    <br />
                                    Country: {report.country || "n/a"}
                                    <br />
                                    Phase: {report.phase || "n/a"}
                                    <br />
                                    Package: {report.package_status || "n/a"}
                                    <br />
                                    Quote: {report.quotation_status || "n/a"}
                                    <br />
                                    Export File: {report.export_file_name || "n/a"}
                                  </div>
                                </div>
                              </div>

                              <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.5 }}>
                                Use Previous / Next to browse reports one by one. The list on the left selects a report directly.
                              </div>
                            </div>
                          );
                        })() : (
                          <div style={{ fontSize: 11, color: "#64748b" }}>Select a saved report to inspect it here.</div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div style={{ background: "#0d1117", borderRadius: 14, border: "1px solid rgba(255,255,255,0.07)", overflow: "hidden" }}>
            <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>Live Terminal</span>
              <span style={{ fontSize: 11, color: phaseInfo.color, fontWeight: 700, background: `${phaseInfo.color}1a`, padding: "3px 10px", borderRadius: 6 }}>● {phaseInfo.label}</span>
            </div>
            <div style={{ height: 530, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 3 }}>
              {terminalLog.length === 0
                ? <span style={{ fontSize: 11, color: "#4b5563", fontFamily: "monospace" }}>Waiting...</span>
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
