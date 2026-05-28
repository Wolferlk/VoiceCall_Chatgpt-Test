import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_LARAVEL_API_BASE_URL || "http://localhost:8000/api";

const VOICES = [
  { value: "alloy",   label: "Alloy"   },
  { value: "ash",     label: "Ash"     },
  { value: "coral",   label: "Coral"   },
  { value: "echo",    label: "Echo"    },
  { value: "nova",    label: "Nova"    },
  { value: "onyx",    label: "Onyx"    },
  { value: "sage",    label: "Sage"    },
  { value: "shimmer", label: "Shimmer" },
];

const PROFILE_ROWS = [
  { key: "full_name",              label: "Full Name",    color: "#6366f1" },
  { key: "contact_number",         label: "WhatsApp",     color: "#10b981" },
  { key: "current_living_country", label: "Country",      color: "#f59e0b" },
  { key: "traveler_count",         label: "Travelers",    color: "#3b82f6" },
  { key: "travel_start_date",      label: "Start Date",   color: "#ec4899" },
  { key: "number_of_days",         label: "Duration",     color: "#06b6d4" },
  { key: "hotel_star_preference",  label: "Hotel Stars",  color: "#8b5cf6" },
  { key: "activities",             label: "Activities",   color: "#f97316" },
];

function createAudioUrlFromBase64(base64, mimeType) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType || "audio/mpeg" }));
}

function pickMimeType() {
  if (typeof window === "undefined" || !window.MediaRecorder) return "";
  const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return preferred.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 4, padding: "10px 14px", alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          width: 7, height: 7, borderRadius: "50%", background: "#94a3b8", display: "block",
          animation: "tdot 1.1s ease-in-out infinite", animationDelay: `${i * 0.15}s`,
        }} />
      ))}
      <style>{`@keyframes tdot{0%,80%,100%{transform:scale(.55);opacity:.35}40%{transform:scale(1);opacity:1}}`}</style>
    </div>
  );
}

function ProfileField({ label, value, color }) {
  const filled = value !== undefined && value !== null && value !== "";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 0", borderBottom: "1px solid rgba(15,23,42,0.05)" }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: filled ? color : "#cbd5e1", flexShrink: 0 }} />
      <span style={{ fontSize: 10, color: "#64748b", minWidth: 76 }}>{label}</span>
      <span style={{ fontSize: 11, color: filled ? "#1e293b" : "#94a3b8", fontWeight: filled ? 700 : 400, flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {filled ? String(Array.isArray(value) ? value.join(", ") : value) : "—"}
      </span>
    </div>
  );
}

export default function ChatbotPage() {
  // Session
  const [sessionId,       setSessionId]       = useState("");
  const [phase,           setPhase]           = useState("idle"); // idle|starting|active|ended
  // Chat
  const [messages,        setMessages]        = useState([]);
  const [customerProfile, setCustomerProfile] = useState({});
  const [serviceCategories, setServiceCategories] = useState([]);
  const [liveSummary,     setLiveSummary]     = useState("");
  const [suggestedPackage, setSuggestedPackage] = useState(null);
  const [packageFetchStatus, setPackageFetchStatus] = useState(""); // |fetching|ready|failed|presented
  const [bookingConfirmed, setBookingConfirmed] = useState(false);
  const [quotationStatus, setQuotationStatus] = useState(null);
  // Input
  const [input,           setInput]           = useState("");
  const [busy,            setBusy]            = useState(false);
  const [error,           setError]           = useState("");
  // Voice settings
  const [voice,           setVoice]           = useState("coral");
  const [voiceSpeed,      setVoiceSpeed]      = useState(1.0);
  const [voiceEnabled,    setVoiceEnabled]    = useState(true);
  const [playing,         setPlaying]         = useState(false);
  // Voice recording
  const [recording,       setRecording]       = useState(false);
  // Image attachment
  const [pendingImage,    setPendingImage]     = useState(null);
  const [pendingPreview,  setPendingPreview]   = useState("");

  const bottomRef       = useRef(null);
  const inputRef        = useRef(null);
  const audioRef        = useRef(null);
  const audioUrlRef     = useRef("");
  const mediaRecRef     = useRef(null);
  const mediaStreamRef  = useRef(null);
  const chunksRef       = useRef([]);
  const pollRef         = useRef(null);
  const sessionIdRef    = useRef("");
  const packageReadySentRef = useRef(false);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    return () => {
      stopAudio();
      stopPolling();
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── Package status polling ────────────────────────────────────────────────
  const startPolling = useCallback(() => {
    stopPolling();
    packageReadySentRef.current = false;
    pollRef.current = window.setInterval(async () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        const res  = await fetch(`${API_BASE_URL}/chatbot/package-status/${sid}`);
        const data = await res.json().catch(() => ({}));
        const st   = data.package_fetch_status || "";

        if (st === "ready" && data.package && !packageReadySentRef.current) {
          packageReadySentRef.current = true;
          stopPolling();
          setPackageFetchStatus("ready");
          setSuggestedPackage(data.package);
          // Auto-send a "package ready" turn so AI presents it
          await sendTurn({ systemTrigger: "package_ready", packageData: data.package });
        } else if (st === "failed") {
          stopPolling();
          setPackageFetchStatus("failed");
          addMessage("system", "Package fetch failed — our team will prepare options manually.");
        }
      } catch { /* ignore poll errors */ }
    }, 3000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function stopPolling() {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
  }

  // ── Audio helpers ─────────────────────────────────────────────────────────
  function stopAudio() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = ""; }
    setPlaying(false);
  }

  async function playBase64Audio(base64, mimeType) {
    if (!voiceEnabled || !base64) return;
    stopAudio();
    const url = createAudioUrlFromBase64(base64, mimeType);
    audioUrlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlaying(true);
    audio.onended = () => { setPlaying(false); URL.revokeObjectURL(url); audioUrlRef.current = ""; };
    audio.onerror = () => setPlaying(false);
    await audio.play().catch(() => setPlaying(false));
  }

  // ── Message helpers ───────────────────────────────────────────────────────
  function addMessage(role, content, meta = {}) {
    setMessages((prev) => [...prev, { role, content, ...meta, ts: Date.now() }]);
  }

  // ── Start session ─────────────────────────────────────────────────────────
  async function startSession() {
    setPhase("starting");
    setBusy(true);
    setError("");
    setMessages([]);
    setCustomerProfile({});
    setServiceCategories([]);
    setLiveSummary("");
    setSuggestedPackage(null);
    setPackageFetchStatus("");
    setBookingConfirmed(false);
    setQuotationStatus(null);
    packageReadySentRef.current = false;

    try {
      const res  = await fetch(`${API_BASE_URL}/chatbot/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_name: voice, voice_speed: voiceSpeed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not start session.");

      setSessionId(data.session_id);
      sessionIdRef.current = data.session_id;
      setCustomerProfile(data.customer_profile || {});
      setPhase("active");
      addMessage("assistant", data.greeting);
      await playBase64Audio(data.greeting_audio_base64, data.greeting_audio_mime_type);
    } catch (err) {
      setError(err.message);
      setPhase("idle");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  // ── Core send turn ────────────────────────────────────────────────────────
  async function sendTurn(opts = {}) {
    const sid = sessionIdRef.current;
    if (!sid || busy) return;

    const { text, audioFile, imageFile, systemTrigger } = opts;

    setBusy(true);
    setError("");

    try {
      const form = new FormData();
      form.append("session_id", sid);
      form.append("voice_name",  voice);
      form.append("voice_speed", String(voiceSpeed));

      if (imageFile) {
        form.append("image", imageFile);
        if (text) form.append("message", text);
      } else if (audioFile) {
        form.append("audio", audioFile);
      } else if (systemTrigger === "package_ready") {
        form.append("message", "[SYSTEM: The travel package is now ready. Please present it to the customer.]");
      } else {
        form.append("message", text || "");
      }

      const res  = await fetch(`${API_BASE_URL}/chatbot/turn`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Turn failed.");

      setCustomerProfile(data.customer_profile || {});
      setServiceCategories(data.service_categories || []);
      setLiveSummary(data.live_summary || "");
      if (data.booking_confirmed) setBookingConfirmed(true);

      const fetchSt = data.package_fetch_status || "";
      setPackageFetchStatus(fetchSt);
      if (fetchSt === "fetching") startPolling();
      if (data.customer_profile?.suggested_package) setSuggestedPackage(data.customer_profile.suggested_package);

      // Add AI reply bubble
      if (!systemTrigger) {
        addMessage("assistant", data.reply, { inputType: data.input_type, transcript: data.transcript, imageDesc: data.image_description });
      } else {
        addMessage("assistant", data.reply);
      }

      await playBase64Audio(data.audio_base64, data.audio_mime_type);

      if (data.should_end) {
        setPhase("ended");
        if (data.quotation_queued) setQuotationStatus({ queued: true });
        stopPolling();
      }
    } catch (err) {
      setError(err.message);
      addMessage("error", err.message);
    } finally {
      setBusy(false);
    }
  }

  // ── Send text message ─────────────────────────────────────────────────────
  async function handleSend() {
    const txt = input.trim();
    if (!txt && !pendingImage) return;
    if (phase !== "active" || busy) return;

    if (pendingImage) {
      addMessage("user", txt || "[Image attached]", { inputType: "image", previewUrl: pendingPreview });
      await sendTurn({ text: txt, imageFile: pendingImage });
      setPendingImage(null);
      setPendingPreview("");
    } else {
      addMessage("user", txt);
      setInput("");
      await sendTurn({ text: txt });
    }
    setInput("");
  }

  // ── Voice recording ───────────────────────────────────────────────────────
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) { setError("Microphone not supported."); return; }
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecRef.current    = recorder;

      recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (blob.size > 0) {
          const file = new File([blob], "voice.webm", { type: blob.type });
          addMessage("user", "🎤 Voice message", { inputType: "audio" });
          await sendTurn({ audioFile: file });
        }
      };
      recorder.start();
      setRecording(true);
    } catch (err) {
      setError("Microphone: " + err.message);
    }
  }

  function stopRecording() {
    if (mediaRecRef.current?.state === "recording") mediaRecRef.current.stop();
  }

  // ── Image attachment ──────────────────────────────────────────────────────
  function handleImageSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingImage(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPendingPreview(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  // ── Manual send quotation ─────────────────────────────────────────────────
  async function handleSendQuotation() {
    if (!sessionId) return;
    setQuotationStatus({ sending: true });
    try {
      const res  = await fetch(`${API_BASE_URL}/chatbot/send-quotation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Send failed.");
      setQuotationStatus({ queued: data.sent, sent: data.sent, waId: data.wa_id, error: data.sent ? null : data.message });
    } catch (err) {
      setQuotationStatus({ queued: false, error: err.message });
    }
  }

  // ── Style tokens ──────────────────────────────────────────────────────────
  const card = {
    background: "rgba(255,255,255,0.95)",
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: 14, padding: "14px 16px",
    boxShadow: "0 2px 12px rgba(15,23,42,0.06)",
  };
  const kicker = {
    fontSize: 10, fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.1em", color: "#94a3b8", marginBottom: 6, display: "block",
  };
  const pkgStatusColor = packageFetchStatus === "ready" || packageFetchStatus === "presented"
    ? "#10b981"
    : packageFetchStatus === "fetching" ? "#f59e0b"
    : packageFetchStatus === "failed"   ? "#ef4444"
    : "#94a3b8";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Space Grotesk','Segoe UI',system-ui,sans-serif", background: "#f0f4f8", height: "calc(100vh - 60px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── HEADER ── */}
      <div style={{ background: "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)", padding: "11px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 4px 20px rgba(0,0,0,0.2)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#8b5cf6,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🤖</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>Aahaas Travel Chatbot</div>
            <div style={{ fontSize: 11, color: busy ? "#f59e0b" : playing ? "#8b5cf6" : phase === "active" ? "#10b981" : "#475569", fontWeight: 600 }}>
              {busy ? "● Thinking…" : playing ? "● Speaking…" : phase === "starting" ? "● Starting…" : phase === "active" ? "● Active" : phase === "ended" ? "● Session Ended" : "● Ready to Start"}
            </div>
          </div>
          {sessionId && (
            <span style={{ fontSize: 10, color: "#475569", background: "rgba(255,255,255,0.06)", padding: "3px 9px", borderRadius: 6, fontFamily: "monospace", border: "1px solid rgba(255,255,255,0.1)" }}>
              {sessionId}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={phase === "active"} style={{ padding: "5px 9px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "#e2e8f0", fontSize: 11, outline: "none" }}>
            {VOICES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 10, color: "#64748b" }}>{voiceSpeed.toFixed(1)}×</span>
            <input type="range" min="0.5" max="2.0" step="0.1" value={voiceSpeed} onChange={(e) => setVoiceSpeed(parseFloat(e.target.value))} style={{ width: 70, accentColor: "#8b5cf6" }} />
          </div>
          <div onClick={() => { setVoiceEnabled((p) => !p); if (playing) stopAudio(); }} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: voiceEnabled ? "rgba(139,92,246,0.18)" : "rgba(255,255,255,0.05)", border: `1px solid ${voiceEnabled ? "rgba(139,92,246,0.35)" : "rgba(255,255,255,0.1)"}`, padding: "5px 11px", borderRadius: 8 }}>
            <span style={{ fontSize: 13 }}>{voiceEnabled ? "🔊" : "🔇"}</span>
            <span style={{ fontSize: 11, color: voiceEnabled ? "#c4b5fd" : "#64748b", fontWeight: 600 }}>{voiceEnabled ? "On" : "Off"}</span>
          </div>
          {playing && <button type="button" onClick={stopAudio} style={{ padding: "5px 11px", borderRadius: 7, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.12)", color: "#fca5a5", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>■ Stop</button>}
          {phase === "idle" && (
            <button type="button" onClick={startSession} disabled={busy} style={{ padding: "7px 18px", borderRadius: 9, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontWeight: 700, fontSize: 12, boxShadow: "0 3px 12px rgba(99,102,241,0.35)" }}>
              ▶ Start Chat
            </button>
          )}
          {phase === "ended" && (
            <button type="button" onClick={startSession} style={{ padding: "7px 16px", borderRadius: 9, border: "1px solid rgba(16,185,129,0.3)", cursor: "pointer", background: "rgba(16,185,129,0.15)", color: "#6ee7b7", fontWeight: 700, fontSize: 12 }}>
              ↺ New Session
            </button>
          )}
        </div>
      </div>

      {/* ── MAIN 2-COLUMN LAYOUT ── */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 270px", overflow: "hidden" }}>

        {/* ── LEFT: CHAT ── */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid rgba(15,23,42,0.07)" }}>

          {/* Package fetch banner */}
          {packageFetchStatus === "fetching" && (
            <div style={{ background: "linear-gradient(90deg,rgba(245,158,11,0.12),rgba(251,191,36,0.08))", borderBottom: "1px solid rgba(245,158,11,0.2)", padding: "8px 18px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 14, animation: "spin 1.5s linear infinite" }}>⚙</span>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              <span style={{ fontSize: 12, color: "#d97706", fontWeight: 600 }}>Fetching your personalized travel package… this may take up to 50 seconds. Chat continues normally.</span>
            </div>
          )}
          {packageFetchStatus === "ready" && !suggestedPackage?.voice_text && (
            <div style={{ background: "rgba(16,185,129,0.07)", borderBottom: "1px solid rgba(16,185,129,0.15)", padding: "7px 18px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <span>✓</span>
              <span style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>Package ready — presenting to customer…</span>
            </div>
          )}

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            {phase === "idle" && (
              <div style={{ textAlign: "center", paddingTop: 60, color: "#94a3b8" }}>
                <div style={{ fontSize: 48, marginBottom: 14 }}>✈️</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b", marginBottom: 8 }}>Aahaas Travel AI Chatbot</div>
                <div style={{ fontSize: 13, marginBottom: 20, maxWidth: 380, margin: "0 auto 20px" }}>
                  Your AI travel assistant can help you find packages, book hotels, plan tours, and more. Click Start Chat to begin.
                </div>
                <button type="button" onClick={startSession} disabled={busy} style={{ padding: "12px 32px", borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontWeight: 700, fontSize: 14, boxShadow: "0 4px 18px rgba(99,102,241,0.35)" }}>
                  ▶ Start Chat
                </button>
              </div>
            )}

            {messages.map((msg, i) => {
              const isAI    = msg.role === "assistant";
              const isErr   = msg.role === "error";
              const isSys   = msg.role === "system";
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: isAI || isErr || isSys ? "flex-start" : "flex-end", gap: 3 }}>
                  {(isAI || msg.role === "user") && (
                    <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", padding: isAI ? "0 0 0 4px" : "0 4px 0 0" }}>
                      {isAI ? "Aahaas AI" : msg.inputType === "audio" ? "🎤 Voice" : msg.inputType === "image" ? "📎 Image" : "You"}
                    </span>
                  )}
                  {msg.previewUrl && (
                    <img src={msg.previewUrl} alt="attachment" style={{ maxWidth: 180, maxHeight: 130, borderRadius: 10, marginBottom: 4, border: "1px solid rgba(15,23,42,0.1)" }} />
                  )}
                  <div style={{
                    maxWidth: "75%",
                    background: isErr ? "rgba(239,68,68,0.08)" : isSys ? "rgba(99,102,241,0.06)" : isAI ? "rgba(255,255,255,0.97)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                    border: isErr ? "1px solid rgba(239,68,68,0.2)" : isSys ? "1px solid rgba(99,102,241,0.15)" : isAI ? "1px solid rgba(15,23,42,0.08)" : "none",
                    borderRadius: isAI || isErr || isSys ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
                    padding: "10px 15px",
                    fontSize: 13,
                    color: isErr ? "#dc2626" : isSys ? "#6366f1" : isAI ? "#1e293b" : "#fff",
                    lineHeight: 1.65,
                    boxShadow: isAI ? "0 2px 10px rgba(15,23,42,0.06)" : isErr || isSys ? "none" : "0 4px 14px rgba(99,102,241,0.3)",
                  }}>
                    {msg.content}
                  </div>
                  {msg.transcript && msg.role === "user" && (
                    <span style={{ fontSize: 10, color: "#94a3b8", paddingRight: 4 }}>Heard: "{msg.transcript}"</span>
                  )}
                </div>
              );
            })}

            {busy && phase !== "idle" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
                <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", paddingLeft: 4 }}>Aahaas AI</span>
                <div style={{ background: "rgba(255,255,255,0.97)", border: "1px solid rgba(15,23,42,0.08)", borderRadius: "4px 16px 16px 16px", boxShadow: "0 2px 10px rgba(15,23,42,0.06)" }}>
                  <TypingDots />
                </div>
              </div>
            )}

            {phase === "ended" && (
              <div style={{ textAlign: "center", padding: "12px 20px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.18)", borderRadius: 12, margin: "0 auto", maxWidth: 400 }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>✅</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#065f46", marginBottom: 4 }}>Session completed successfully</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>WhatsApp quotation has been queued for delivery.</div>
              </div>
            )}

            {error && <div style={{ fontSize: 12, color: "#ef4444", background: "rgba(239,68,68,0.07)", padding: "8px 14px", borderRadius: 9, border: "1px solid rgba(239,68,68,0.18)" }}>{error}</div>}
            <div ref={bottomRef} />
          </div>

          {/* ── INPUT BAR ── */}
          <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(15,23,42,0.08)", background: "rgba(255,255,255,0.85)", flexShrink: 0 }}>
            {/* Pending image preview */}
            {pendingPreview && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "6px 10px", background: "rgba(99,102,241,0.06)", borderRadius: 8, border: "1px solid rgba(99,102,241,0.15)" }}>
                <img src={pendingPreview} alt="pending" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover" }} />
                <span style={{ fontSize: 12, color: "#6366f1", flex: 1 }}>{pendingImage?.name}</span>
                <button type="button" onClick={() => { setPendingImage(null); setPendingPreview(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16 }}>×</button>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              {/* Image upload */}
              <label style={{ width: 40, height: 40, borderRadius: 10, border: "1px solid rgba(15,23,42,0.12)", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: phase === "active" ? "pointer" : "default", fontSize: 16, opacity: phase === "active" ? 1 : 0.4, flexShrink: 0 }} title="Attach image">
                📎
                <input type="file" accept="image/*" onChange={handleImageSelect} style={{ display: "none" }} disabled={phase !== "active"} />
              </label>

              {/* Voice record */}
              <button
                type="button"
                onMouseDown={phase === "active" ? startRecording : undefined}
                onMouseUp={phase === "active" ? stopRecording : undefined}
                onTouchStart={(e) => { e.preventDefault(); if (phase === "active") startRecording(); }}
                onTouchEnd={(e) => { e.preventDefault(); if (phase === "active") stopRecording(); }}
                disabled={phase !== "active" || busy}
                title="Hold to record voice"
                style={{ width: 40, height: 40, borderRadius: 10, border: `1px solid ${recording ? "rgba(239,68,68,0.5)" : "rgba(15,23,42,0.12)"}`, background: recording ? "rgba(239,68,68,0.12)" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: phase === "active" ? "pointer" : "default", fontSize: 16, opacity: phase === "active" ? 1 : 0.4, flexShrink: 0, userSelect: "none" }}>
                {recording ? "🔴" : "🎤"}
              </button>

              {/* Text input */}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={phase === "idle" ? "Start a session first…" : phase === "ended" ? "Session ended — start a new one" : recording ? "Recording… release to send" : "Type a message… (Enter to send)"}
                disabled={phase !== "active" || busy || recording}
                rows={1}
                style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(15,23,42,0.12)", fontSize: 13, outline: "none", resize: "none", lineHeight: 1.6, background: phase === "active" && !recording ? "#fff" : "#f8fafc", color: "#1e293b", maxHeight: 110, overflowY: "auto", boxShadow: "0 1px 6px rgba(15,23,42,0.05)" }}
                onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 110)}px`; }}
              />

              {/* Send button */}
              <button type="button" onClick={handleSend} disabled={(!input.trim() && !pendingImage) || phase !== "active" || busy || recording} style={{ width: 44, height: 44, borderRadius: 12, border: "none", cursor: ((!input.trim() && !pendingImage) || phase !== "active" || busy || recording) ? "not-allowed" : "pointer", background: ((!input.trim() && !pendingImage) || phase !== "active" || busy || recording) ? "#e2e8f0" : "linear-gradient(135deg,#6366f1,#8b5cf6)", color: ((!input.trim() && !pendingImage) || phase !== "active" || busy || recording) ? "#94a3b8" : "#fff", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: ((!input.trim() && !pendingImage) || phase !== "active") ? "none" : "0 4px 14px rgba(99,102,241,0.3)" }}>
                ↑
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginTop: 6, gap: 16 }}>
              <span style={{ fontSize: 10, color: "#94a3b8" }}>Enter — Send</span>
              <span style={{ fontSize: 10, color: "#94a3b8" }}>Shift+Enter — New line</span>
              <span style={{ fontSize: 10, color: "#94a3b8" }}>Hold 🎤 — Voice message</span>
            </div>
          </div>
        </div>

        {/* ── RIGHT: INTEL SIDEBAR ── */}
        <div style={{ overflow: "hidden auto", padding: "14px 12px", display: "flex", flexDirection: "column", gap: 11, background: "rgba(248,250,252,0.9)" }}>

          {/* Customer Profile */}
          <div style={card}>
            <span style={kicker}>Customer Profile</span>
            {PROFILE_ROWS.map((row) => (
              <ProfileField key={row.key} label={row.label} value={customerProfile[row.key]} color={row.color} />
            ))}
          </div>

          {/* Package Status */}
          <div style={card}>
            <span style={kicker}>Package Status</span>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: packageFetchStatus === "fetching" ? 8 : 0 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: pkgStatusColor, flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: pkgStatusColor }}>
                {packageFetchStatus === "fetching" ? "Fetching…"
                  : packageFetchStatus === "ready"   ? "Ready"
                  : packageFetchStatus === "presented" ? "Presented"
                  : packageFetchStatus === "failed"  ? "Failed"
                  : "Not started"}
              </span>
            </div>
            {packageFetchStatus === "fetching" && (
              <div style={{ fontSize: 11, color: "#64748b", background: "rgba(245,158,11,0.06)", padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(245,158,11,0.15)" }}>
                Package API is searching (30–50s). Chat continues normally.
              </div>
            )}
            {suggestedPackage && (
              <div style={{ marginTop: 8, background: "rgba(16,185,129,0.04)", borderRadius: 8, border: "1px solid rgba(16,185,129,0.12)", padding: "8px 10px" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#10b981", textTransform: "uppercase", letterSpacing: "0.08em" }}>Package Ready</span>
                <pre style={{ fontSize: 9, color: "#374151", margin: "6px 0 0", overflow: "auto", maxHeight: 140, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {typeof suggestedPackage === "string" ? suggestedPackage : JSON.stringify(suggestedPackage, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* Booking + Quotation */}
          <div style={card}>
            <span style={kicker}>Booking</span>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: bookingConfirmed ? "#10b981" : "#cbd5e1", flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: bookingConfirmed ? "#10b981" : "#94a3b8" }}>
                {bookingConfirmed ? "Booking Confirmed" : "Awaiting Confirmation"}
              </span>
            </div>
            {quotationStatus ? (
              <div style={{ fontSize: 11, color: quotationStatus.queued ? "#10b981" : "#ef4444", background: quotationStatus.queued ? "rgba(16,185,129,0.07)" : "rgba(239,68,68,0.07)", padding: "6px 9px", borderRadius: 7, border: `1px solid ${quotationStatus.queued ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                {quotationStatus.sending ? "Sending WhatsApp quotation…"
                  : quotationStatus.queued ? `✓ WhatsApp sent${quotationStatus.waId ? ` → ${quotationStatus.waId}` : ""}`
                  : `✕ ${quotationStatus.error || "Failed"}`}
              </div>
            ) : null}
            {phase === "active" && bookingConfirmed && !quotationStatus && (
              <button type="button" onClick={handleSendQuotation} style={{ marginTop: 8, width: "100%", padding: "7px 0", borderRadius: 8, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#10b981,#059669)", color: "#fff", fontWeight: 700, fontSize: 12, boxShadow: "0 2px 10px rgba(16,185,129,0.28)" }}>
                📤 Send WhatsApp Now
              </button>
            )}
          </div>

          {/* Service Categories */}
          {serviceCategories.length > 0 && (
            <div style={card}>
              <span style={kicker}>Services</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {serviceCategories.map((cat) => (
                  <span key={cat} style={{ fontSize: 10, background: "rgba(99,102,241,0.08)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.18)", padding: "3px 9px", borderRadius: 20, fontWeight: 600 }}>{cat}</span>
                ))}
              </div>
            </div>
          )}

          {/* Live Summary */}
          {liveSummary && (
            <div style={{ ...card, background: "rgba(99,102,241,0.04)", border: "1px solid rgba(99,102,241,0.12)" }}>
              <span style={{ ...kicker, color: "#6366f1" }}>Live Summary</span>
              <p style={{ fontSize: 11, color: "#374151", margin: 0, lineHeight: 1.6 }}>{liveSummary}</p>
            </div>
          )}

          {/* Controls */}
          <div style={{ ...card, padding: "11px 14px" }}>
            <span style={kicker}>Session</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>Messages</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#6366f1" }}>{messages.length}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>Phase</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#1e293b", textTransform: "capitalize" }}>{phase}</span>
              </div>
              {phase === "active" && (
                <button type="button" onClick={startSession} style={{ marginTop: 4, padding: "6px 0", borderRadius: 7, border: "1px solid rgba(15,23,42,0.1)", background: "#fff", color: "#475569", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>↺ New Session</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
