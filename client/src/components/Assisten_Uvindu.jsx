import { useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_LARAVEL_API_BASE_URL || "http://localhost:8000/api";

/* ─── helpers ──────────────────────────────────────────────────────────── */

function b64ToUrl(b64, mime) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mime || "audio/mpeg" }));
}

function bestMime() {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find(
      (t) => MediaRecorder.isTypeSupported(t),
    ) || ""
  );
}

function fmt(v) {
  if (!v) return "—";
  return Array.isArray(v) ? v.join(", ") : String(v);
}

/* How long to listen depends on what was just asked */
function listenProfile(lastReply) {
  const q = (lastReply || "").toLowerCase();
  if (q.includes("name")) return { maxMs: 10000, silenceMs: 2200 };
  if (q.includes("phone") || q.includes("number")) return { maxMs: 14000, silenceMs: 2800 };
  if (q.includes("email")) return { maxMs: 18000, silenceMs: 3000 };
  if (q.includes("date") || q.includes("days") || q.includes("budget"))
    return { maxMs: 14000, silenceMs: 2800 };
  if (q.includes("help") || q.includes("today") || q.includes("assist"))
    return { maxMs: 25000, silenceMs: 3500 };
  if (q.includes("prefer") || q.includes("experience") || q.includes("interest"))
    return { maxMs: 20000, silenceMs: 3200 };
  return { maxMs: 18000, silenceMs: 3000 };
}

/* ─── component ─────────────────────────────────────────────────────────── */

export default function AssistenUvindu() {
  /* state */
  const [phase, setPhase] = useState("idle"); // idle | ringing | connecting | speaking | listening | processing | ending | done
  const [callId, setCallId] = useState("");
  const [status, setStatus] = useState("Ready to call Uvindu.");
  const [hint, setHint] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [conversation, setConversation] = useState([]);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [profile, setProfile] = useState({});
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState("");
  const [report, setReport] = useState(null);
  const [ended, setEnded] = useState(false);
  const [pulse, setPulse] = useState(0);
  const [testInput, setTestInput] = useState("");

  /* refs — async callbacks always read these, never stale state */
  const callIdRef = useRef("");
  const lastReplyRef = useRef("");
  const loopRef = useRef(false);
  const finRef = useRef(false);
  const phaseRef = useRef("idle");

  /* audio refs */
  const audioRef = useRef(null);
  const audioUrlRef = useRef("");
  const holdUrlRef = useRef("");
  const holdTimerRef = useRef(0);

  /* mic refs */
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const silTimerRef = useRef(0);
  const talkRef = useRef(false);
  const silMsRef = useRef(0);
  const elapsedRef = useRef(0);

  const ctxRef = useRef(null);

  const supported =
    typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  /* sync phaseRef */
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  /* cleanup on unmount */
  useEffect(() => {
    return () => {
      loopRef.current = false;
      killAudio();
      killMic();
    };
  }, []);

  /* ─── audio context ─────────────────────────────────────────────────── */

  function getCtx() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!ctxRef.current) ctxRef.current = new Ctx();
    if (ctxRef.current.state === "suspended") ctxRef.current.resume().catch(() => {});
    return ctxRef.current;
  }

  function tone(steps) {
    const ctx = getCtx();
    if (!ctx) return;
    let t = ctx.currentTime + 0.02;
    for (const s of steps) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = s.type || "sine";
      osc.frequency.value = s.freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(s.vol || 0.04, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + s.dur + 0.02);
      t += s.dur + (s.gap || 0.04);
    }
  }

  const ringTone = () =>
    tone([
      { freq: 440, dur: 0.35, gap: 0.09, type: "triangle", vol: 0.05 },
      { freq: 554, dur: 0.35, gap: 0.18, type: "triangle", vol: 0.04 },
      { freq: 440, dur: 0.35, gap: 0.09, type: "triangle", vol: 0.05 },
      { freq: 659, dur: 0.38, type: "triangle", vol: 0.04 },
    ]);

  const connectTone = () =>
    tone([
      { freq: 392, dur: 0.15 },
      { freq: 523, dur: 0.15 },
      { freq: 659, dur: 0.22 },
    ]);

  const hangupTone = () =>
    tone([
      { freq: 587, dur: 0.14, type: "triangle" },
      { freq: 440, dur: 0.14, type: "triangle" },
      { freq: 293, dur: 0.22, type: "triangle" },
    ]);

  const startTone = () =>
    tone([
      { freq: 784, dur: 0.1, vol: 0.03 },
      { freq: 1046, dur: 0.12, vol: 0.028 },
    ]);

  const stopTone = () =>
    tone([
      { freq: 659, dur: 0.1, type: "triangle", vol: 0.026 },
      { freq: 523, dur: 0.12, type: "triangle", vol: 0.024 },
    ]);

  function holdPhrase() {
    tone([
      { freq: 261, dur: 0.38, gap: 0.08, vol: 0.01 },
      { freq: 329, dur: 0.38, gap: 0.08, vol: 0.01 },
      { freq: 392, dur: 0.52, gap: 0.12, vol: 0.01 },
      { freq: 329, dur: 0.34, vol: 0.009 },
    ]);
  }

  function startHold() {
    stopHold();
    holdPhrase();
    holdTimerRef.current = window.setInterval(holdPhrase, 2500);
  }

  function stopHold() {
    window.clearInterval(holdTimerRef.current);
    holdTimerRef.current = 0;
  }

  /* ─── audio playback ────────────────────────────────────────────────── */

  function killAudio() {
    stopHold();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
  }

  async function playAudio(url, onDone) {
    killAudio();
    const a = new Audio(url);
    audioRef.current = a;
    audioUrlRef.current = url;
    setPhase("speaking");
    a.onended = () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
      if (audioRef.current === a) audioRef.current = null;
      onDone?.();
    };
    await a.play();
  }

  /* ─── microphone ────────────────────────────────────────────────────── */

  function killMic() {
    window.clearTimeout(silTimerRef.current);
    if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current = null; }
    if (analyserRef.current) { analyserRef.current.disconnect(); analyserRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setPulse(0);
    setHint("");
  }

  async function startListening() {
    if (!callIdRef.current || !loopRef.current || finRef.current) return;

    const prof = listenProfile(lastReplyRef.current);
    setPhase("listening");
    setStatus("Listening… please speak.");
    setHint(hintText(lastReplyRef.current));

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErrorMsg("Microphone access denied. Please allow microphone and try again.");
      setPhase("idle");
      return;
    }

    const mime = bestMime();
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunksRef.current = [];
    recorderRef.current = rec;
    streamRef.current = stream;

    rec.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data); };

    rec.onstop = async () => {
      stopTone();
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      chunksRef.current = [];
      killMic();
      if (!loopRef.current || blob.size === 0) return;
      if (!talkRef.current) {
        await sendSilence();
      } else {
        await sendTurn(blob);
      }
    };

    rec.start(250);
    startTone();
    watchSilence(stream, rec, prof);
  }

  function hintText(reply) {
    const q = (reply || "").toLowerCase();
    if (q.includes("name")) return "Say your full name clearly.";
    if (q.includes("phone") || q.includes("number")) return "Say your phone number clearly.";
    if (q.includes("email")) return "Say your email slowly.";
    if (q.includes("date")) return "Say the date or date range.";
    if (q.includes("help") || q.includes("today")) return "Tell Uvindu what you need.";
    return "Speak whenever you're ready.";
  }

  function watchSilence(stream, rec, prof) {
    const ctx = getCtx();
    elapsedRef.current = 0;
    talkRef.current = false;
    silMsRef.current = 0;

    if (!ctx) {
      window.setTimeout(() => { if (rec.state === "recording") rec.stop(); }, prof.maxMs);
      return;
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);
    analyserRef.current = analyser;
    sourceRef.current = src;

    const buf = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!analyserRef.current || rec.state !== "recording") return;
      analyserRef.current.getByteFrequencyData(buf);
      const avg = buf.reduce((s, v) => s + v, 0) / buf.length;
      setPulse(Math.min(1, avg / 80));
      elapsedRef.current += 120;

      if (avg > 10) { talkRef.current = true; silMsRef.current = 0; }
      else if (talkRef.current) silMsRef.current += 120;
      else silMsRef.current += 120;

      if (elapsedRef.current >= prof.maxMs) { rec.stop(); return; }
      if (talkRef.current && silMsRef.current >= prof.silenceMs) { rec.stop(); return; }

      silTimerRef.current = window.setTimeout(tick, 120);
    };
    tick();
  }

  /* ─── API calls ─────────────────────────────────────────────────────── */

  async function startCall() {
    if (!supported || phase !== "idle") return;
    loopRef.current = true;
    finRef.current = false;
    setErrorMsg("");
    setEnded(false);
    setPhase("ringing");
    setStatus("Calling Uvindu… please wait.");
    ringTone();

    await delay(1600);
    setPhase("connecting");
    setStatus("Connecting you to Uvindu now…");
    connectTone();

    try {
      const res = await fetch(`${API_BASE}/uvindu-call/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not start the call.");

      callIdRef.current = data.call_id || "";
      lastReplyRef.current = data.greeting || "";
      setCallId(data.call_id || "");
      setLastReply(data.greeting || "");
      setConversation(data.greeting ? [{ role: "assistant", content: data.greeting }] : []);
      setStatus("Connected — Uvindu is speaking.");

      if (data.hold_audio_base64) holdUrlRef.current = b64ToUrl(data.hold_audio_base64, data.hold_audio_mime_type);

      await playAudio(b64ToUrl(data.greeting_audio_base64, data.greeting_audio_mime_type), async () => {
        if (loopRef.current) await startListening();
      });
    } catch (err) {
      loopRef.current = false;
      setPhase("idle");
      setErrorMsg(err.message);
      setStatus("Call could not be started.");
    }
  }

  async function sendSilence() {
    if (!callIdRef.current || !loopRef.current) return;
    setPhase("processing");
    setStatus("Checking if you're still there…");
    try {
      const fd = new FormData();
      fd.append("call_id", callIdRef.current);
      fd.append("transcript", "__silent__");
      const res = await fetch(`${API_BASE}/uvindu-call/turn`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.audio_base64) { if (loopRef.current) await startListening(); return; }
      lastReplyRef.current = data.reply || lastReplyRef.current;
      await playAudio(b64ToUrl(data.audio_base64, data.audio_mime_type), async () => {
        if (loopRef.current) await startListening();
      });
    } catch {
      if (loopRef.current) await startListening();
    }
  }

  async function sendTurn(blob, text = "") {
    setPhase("processing");
    setStatus("Uvindu is thinking…");
    startHold();

    try {
      const fd = new FormData();
      fd.append("call_id", callIdRef.current);
      if (blob) fd.append("audio", blob, "uvindu.webm");
      if (text.trim()) fd.append("transcript", text.trim());

      const res = await fetch(`${API_BASE}/uvindu-call/turn`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Turn failed.");

      stopHold();
      lastReplyRef.current = data.reply || "";
      setLastTranscript(data.transcript || "");
      setLastReply(data.reply || "");
      setConversation(data.conversation || []);
      setProfile(data.customer_profile || {});
      setCategories(data.service_categories || []);
      setSummary(data.live_summary || "");
      setTestInput("");

      await playAudio(b64ToUrl(data.audio_base64, data.audio_mime_type), async () => {
        if (data.should_end) {
          await endCall(data.ended_reason || "completed_by_assistant");
        } else if (loopRef.current) {
          await startListening();
        }
      });
    } catch (err) {
      stopHold();
      setErrorMsg(err.message);
      setStatus("There was a problem — the call is still open.");
      setPhase("connected");
    }
  }

  async function endCall(reason = "completed") {
    if (!callIdRef.current || finRef.current) return;
    finRef.current = true;
    loopRef.current = false;
    killMic();
    setPhase("ending");
    setStatus("Wrapping up your call report…");

    try {
      const res = await fetch(`${API_BASE}/uvindu-call/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callIdRef.current, ended_reason: reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not save the report.");

      setReport(data.report || null);
      setEnded(true);
      setStatus("Call ended — your report has been saved.");
      hangupTone();

      await playAudio(b64ToUrl(data.audio_base64, data.audio_mime_type), () => setPhase("done"));
    } catch (err) {
      setErrorMsg(err.message);
      setPhase("done");
    } finally {
      finRef.current = false;
    }
  }

  async function hangUp() {
    if (!callId) { reset(); return; }
    loopRef.current = false;
    killMic();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    await endCall("manual_hangup");
  }

  async function handleTest() {
    if (!callIdRef.current || !testInput.trim() || finRef.current || ended) return;
    stopTone();
    await sendTurn(null, testInput);
  }

  function reset() {
    loopRef.current = false;
    finRef.current = false;
    killAudio();
    killMic();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    callIdRef.current = "";
    lastReplyRef.current = "";
    holdUrlRef.current = "";
    setCallId(""); setPhase("idle"); setStatus("Ready to call Uvindu.");
    setHint(""); setErrorMsg(""); setConversation([]); setLastTranscript("");
    setLastReply(""); setProfile({}); setCategories([]); setSummary("");
    setReport(null); setEnded(false); setPulse(0); setTestInput("");
  }

  function delay(ms) { return new Promise((r) => window.setTimeout(r, ms)); }

  /* ─── render ────────────────────────────────────────────────────────── */

  const profileRows = [
    ["Full name", profile.full_name],
    ["Phone", profile.contact_number],
    ["Email", profile.email_address],
    ["Country", profile.current_living_country],
  ];

  const phaseLabel = {
    idle: "Ready",
    ringing: "Ringing…",
    connecting: "Connecting…",
    speaking: "Uvindu is speaking",
    listening: "Listening to you",
    processing: "Uvindu is thinking",
    ending: "Ending call",
    done: "Call ended",
  }[phase] || phase;

  return (
    <div className="panel reception-panel">
      <div className="reception-backdrop" />

      {/* header */}
      <div className="panel-header reception-header">
        <div>
          <p className="eyebrow">ElevenLabs Voice · ChatGPT Brain</p>
          <h2>Call Uvindu</h2>
          <p className="panel-copy reception-copy">
            Speak naturally — Uvindu listens, transcribes your voice, thinks with ChatGPT,
            and replies in ElevenLabs voice. Travel details are collected one question at a
            time and saved automatically.
          </p>
        </div>
        <span className="call-badge reception-badge">ElevenLabs</span>
      </div>

      {/* orb + status */}
      <div className="reception-stage">
        <div className={`call-orb phase-${phase}`}>
          <div className="call-orb-core" style={{ transform: `scale(${1 + pulse * 0.35})` }} />
          <div className="call-orb-ring ring-one" />
          <div className="call-orb-ring ring-two" />
          <div className="call-orb-ring ring-three" />
        </div>
        <div className="reception-status">
          <span>{phaseLabel}</span>
          <strong>{status}</strong>
          {callId && <p>Call ID: {callId}</p>}
          {hint && <p className="hint-text">{hint}</p>}
        </div>
      </div>

      {/* controls */}
      <div className="reception-controls">
        <button
          className="primary-button reception-call-button"
          onClick={startCall}
          disabled={!supported || phase !== "idle"}
        >
          Start call
        </button>
        <button
          className="secondary-button"
          onClick={hangUp}
          disabled={!callId || phase === "ending" || phase === "done"}
        >
          End call
        </button>
        <button className="secondary-button" onClick={reset}>
          Reset
        </button>
      </div>

      {!supported && (
        <p className="error-text">Microphone recording is not supported in this browser.</p>
      )}
      {errorMsg && <p className="error-text">{errorMsg}</p>}

      {/* live cards */}
      <div className="reception-grid">
        <div className="reception-card">
          <span>You said</span>
          <p>{lastTranscript || "Your speech will appear here."}</p>
        </div>
        <div className="reception-card">
          <span>Uvindu replied</span>
          <p>{lastReply || "Uvindu's response will appear here."}</p>
        </div>
        <div className="reception-card">
          <span>Live summary</span>
          <p>{summary || "Summary builds as the call progresses."}</p>
        </div>
      </div>

      {/* test chat */}
      <div className="trip-summary-card reception-test-card">
        <span>Test chat (text input)</span>
        <p>Use this to test without a microphone — type a reply and send it as if you spoke it.</p>
        <div className="reception-test-row">
          <input
            className="records-search reception-test-input"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleTest()}
            placeholder="Type your answer here and press Enter or Send…"
          />
          <button
            className="primary-button"
            onClick={handleTest}
            disabled={!callId || !testInput.trim() || phase === "processing" || phase === "ending" || ended}
          >
            Send
          </button>
        </div>
      </div>

      {/* conversation + sidebar */}
      <div className="reception-columns">
        {/* conversation log */}
        <div className="conversation-log reception-log" aria-live="polite">
          {conversation.length === 0 ? (
            <p className="empty-state">
              Start the call — Uvindu will ask for your name, understand your need, and
              collect the right details one question at a time.
            </p>
          ) : (
            conversation.map((msg, i) => (
              <article
                key={`${msg.role}-${i}`}
                className={`message-bubble message-${msg.role}`}
              >
                <span>{msg.role === "assistant" ? "Uvindu" : "You"}</span>
                <p>{msg.content}</p>
              </article>
            ))
          )}
        </div>

        {/* sidebar */}
        <div className="reception-side">
          {/* contact info */}
          <div className="trip-summary-card">
            <span>Customer details</span>
            {profileRows.map(([label, val]) => (
              <p key={label}>
                <strong>{label}:</strong> {fmt(val)}
              </p>
            ))}
          </div>

          {/* service categories */}
          <div className="trip-summary-card">
            <span>Service categories</span>
            <p>{categories.length ? categories.join(", ") : "Not identified yet."}</p>
          </div>

          {/* package */}
          {profile.suggested_package && (
            <div className="trip-summary-card">
              <span>Package suggestion</span>
              <pre className="records-pre">
                {typeof profile.suggested_package === "string"
                  ? profile.suggested_package
                  : JSON.stringify(profile.suggested_package, null, 2)}
              </pre>
            </div>
          )}

          {/* final report */}
          {report && (
            <div className="trip-summary-card reception-report-card">
              <span>Final call report</span>
              <p>{report.summary || "No summary."}</p>
              {report.products_needed?.length > 0 && (
                <p><strong>Products:</strong> {report.products_needed.join(", ")}</p>
              )}
              {report.follow_up_actions?.length > 0 && (
                <p><strong>Follow-up:</strong> {report.follow_up_actions.join(", ")}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {ended && (
        <p className="reception-finish-note">
          Uvindu has ended the call. All details are saved and the report is ready.
        </p>
      )}
    </div>
  );
}
