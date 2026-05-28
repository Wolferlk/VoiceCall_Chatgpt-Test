import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_LARAVEL_API_BASE_URL || "http://localhost:8000/api";

const OPENAI_VOICES = [
  { value: "alloy",   label: "Alloy — Neutral, balanced" },
  { value: "ash",     label: "Ash — Warm, casual" },
  { value: "ballad",  label: "Ballad — Smooth, storytelling" },
  { value: "cedar",   label: "Cedar — Rich, polished" },
  { value: "coral",   label: "Coral — Professional, upbeat (default)" },
  { value: "echo",    label: "Echo — Clear, resonant" },
  { value: "fable",   label: "Fable — Expressive, dynamic" },
  { value: "marin",   label: "Marin — Natural, premium" },
  { value: "nova",    label: "Nova — Bright, energetic" },
  { value: "onyx",    label: "Onyx — Deep, authoritative" },
  { value: "sage",    label: "Sage — Calm, thoughtful" },
  { value: "shimmer", label: "Shimmer — Light, cheerful" },
  { value: "verse",   label: "Verse — Versatile, natural" },
];

const TERMINAL_STATES = {
  idle:               { label: "Ready",              color: "#6b7280" },
  ringing:            { label: "Dialing",            color: "#3b82f6" },
  connecting:         { label: "Connecting",         color: "#3b82f6" },
  listening:          { label: "Listening",          color: "#10b981" },
  processing:         { label: "Processing",         color: "#f59e0b" },
  "wait-for-response":{ label: "Wait for Response",  color: "#f59e0b" },
  "assistant-speaking":{ label: "Speaking",          color: "#8b5cf6" },
  ending:             { label: "Ending",             color: "#f97316" },
  completed:          { label: "Done",               color: "#10b981" },
  failed:             { label: "Failed",             color: "#ef4444" },
  timeout:            { label: "Timeout",            color: "#ef4444" },
  connected:          { label: "Connected",          color: "#3b82f6" },
};

function createAudioUrlFromBase64(base64, mimeType) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType || "audio/mpeg" });
  return URL.createObjectURL(blob);
}

function pickMimeType() {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") return "";
  const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return preferred.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function formatProfileValue(value) {
  if (!value) return "Pending";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function formatDebugJson(value) {
  if (!value) return "No package suggested yet.";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function getPackageStatusLabel(customerProfile) {
  const s = customerProfile.package_lookup_status || "";
  if (s === "presented" || customerProfile.suggested_package) return "Package ready";
  if (s === "queued" || s === "pending") return "Retrieving package";
  if (s === "failed" || s === "api_unavailable") return "Package problem";
  return "Not started";
}

function isTravelServiceCategory(category) {
  return ["Hotel Booking", "Flight Booking", "Sri Lanka Tour Planning", "Transportation", "Activities and Experiences"].includes(category);
}

function inferListeningProfile(questionText) {
  const n = String(questionText || "").toLowerCase();
  if (n.includes("full name") || n.includes("your full name"))
    return { maxRecordMs: 10000, postSpeechSilenceMs: 2400, hint: "Mic ready. Say your full name clearly." };
  if (n.includes("contact number") || n.includes("phone"))
    return { maxRecordMs: 14000, postSpeechSilenceMs: 2800, hint: "Mic ready. Say the phone number clearly." };
  if (n.includes("email"))
    return { maxRecordMs: 18000, postSpeechSilenceMs: 3000, hint: "Mic ready. Say the email slowly." };
  if (n.includes("country") || n.includes("location"))
    return { maxRecordMs: 10000, postSpeechSilenceMs: 2400, hint: "Mic ready. Say your country or city." };
  if (n.includes("booking id") || n.includes("reference"))
    return { maxRecordMs: 14000, postSpeechSilenceMs: 2800, hint: "Mic ready. Say the booking ID." };
  if (n.includes("package is okay") || n.includes("okay for you"))
    return { maxRecordMs: 12000, postSpeechSilenceMs: 2600, hint: "Mic ready. Say yes or explain what to change." };
  if (n.includes("special request") || n.includes("preferences") || n.includes("what needs to change"))
    return { maxRecordMs: 22000, postSpeechSilenceMs: 3200, hint: "Mic ready. Take your time to explain." };
  if (n.includes("travel date") || n.includes("how many days") || n.includes("travelers") || n.includes("budget"))
    return { maxRecordMs: 14000, postSpeechSilenceMs: 2800, hint: "Mic ready. Please answer when ready." };
  if (n.includes("help") || n.includes("assist") || n.includes("today"))
    return { maxRecordMs: 25000, postSpeechSilenceMs: 3500, hint: "Mic ready. Please tell us how we can help." };
  return { maxRecordMs: 18000, postSpeechSilenceMs: 3000, hint: "Mic ready. Please go ahead." };
}

function msToDisplay(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function AahaasAssistentFinalV01() {
  const [callId, setCallId] = useState("");
  const [callStatus, setCallStatus] = useState("Ready to start.");
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [conversation, setConversation] = useState([]);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [customerProfile, setCustomerProfile] = useState({});
  const [serviceCategories, setServiceCategories] = useState([]);
  const [liveSummary, setLiveSummary] = useState("");
  const [finalReport, setFinalReport] = useState(null);
  const [quotationStatus, setQuotationStatus] = useState(null); // null | { queued, error }
  const [testMessage, setTestMessage] = useState("");
  const [callEnded, setCallEnded] = useState(false);
  const [pulseLevel, setPulseLevel] = useState(0);
  const [listeningHint, setListeningHint] = useState("");

  // Controls
  const [selectedVoice, setSelectedVoice] = useState("coral");
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [outputVolume, setOutputVolume] = useState(1.0);
  const [musicLevel, setMusicLevel] = useState(0.18);
  const [micSensitivity, setMicSensitivity] = useState(10);
  const [bgMusicEnabled, setBgMusicEnabled] = useState(true);
  const [micMuted, setMicMuted] = useState(false);

  // Terminal status
  const [terminalLog, setTerminalLog] = useState([]);
  const [currentApiCall, setCurrentApiCall] = useState("");
  const [apiCallStartTime, setApiCallStartTime] = useState(null);
  const [apiResponseTime, setApiResponseTime] = useState(null);
  const [callStartTime, setCallStartTime] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const callDurationTimerRef = useRef(null);

  const mainAudioRef = useRef(null);
  const mainAudioUrlRef = useRef("");
  const holdAudioRef = useRef(null);
  const holdAudioUrlRef = useRef("");
  const holdMusicTimerRef = useRef(0);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const analyserRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const silenceMonitorRef = useRef(0);
  const speakingDetectedRef = useRef(false);
  const silenceMsRef = useRef(0);
  const captureElapsedMsRef = useRef(0);
  const autoLoopEnabledRef = useRef(false);
  const finalizingRef = useRef(false);
  const currentPhaseRef = useRef("idle");
  const callIdRef = useRef("");
  const lastReplyRef = useRef("");
  const packagePrefetchStartedRef = useRef(false);
  const packageWaitPollRef = useRef(0);
  const ambientMusicRef = useRef(null);
  const outputGainNodeRef = useRef(null);
  const terminalEndRef = useRef(null);

  const callSupported =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => { currentPhaseRef.current = phase; }, [phase]);

  useEffect(() => {
    if (phase === "ringing" || phase === "connecting") {
      if (bgMusicEnabled) { initAmbientMusic(); setAmbientVolume(musicLevel * 0.4, 2.5); }
    } else if (phase === "processing") {
      if (bgMusicEnabled) { initAmbientMusic(); setAmbientVolume(musicLevel, 4.0); }
    } else if (phase === "assistant-speaking") {
      setAmbientVolume(bgMusicEnabled ? musicLevel * 0.25 : 0, 1.2);
    } else if (phase === "listening") {
      setAmbientVolume(0, 0.5);
    } else if (phase === "idle" || phase === "completed" || phase === "ending") {
      destroyAmbientMusic();
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ambientMusicRef.current) {
      setAmbientVolume(bgMusicEnabled ? musicLevel : 0, 0.6);
    }
  }, [bgMusicEnabled, musicLevel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (outputGainNodeRef.current) {
      outputGainNodeRef.current.gain.value = outputVolume;
    }
    if (mainAudioRef.current) {
      mainAudioRef.current.volume = outputVolume;
    }
  }, [outputVolume]);

  useEffect(() => {
    return () => {
      autoLoopEnabledRef.current = false;
      if (packageWaitPollRef.current) window.clearTimeout(packageWaitPollRef.current);
      stopAllAudio();
      stopMicrophone();
      stopSilenceMonitor();
      stopCallDurationTimer();
      if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    };
  }, []);

  // Auto-scroll terminal log
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [terminalLog]);

  function addTerminalEntry(type, message, detail = "") {
    const ts = new Date().toISOString().slice(11, 23);
    setTerminalLog((prev) => [...prev.slice(-80), { ts, type, message, detail }]);
  }

  function startCallDurationTimer() {
    const t = Date.now();
    setCallStartTime(t);
    setCallDuration(0);
    callDurationTimerRef.current = window.setInterval(() => {
      setCallDuration(Date.now() - t);
    }, 500);
  }

  function stopCallDurationTimer() {
    if (callDurationTimerRef.current) {
      window.clearInterval(callDurationTimerRef.current);
      callDurationTimerRef.current = null;
    }
  }

  function markApiStart(label) {
    const t = Date.now();
    setCurrentApiCall(label);
    setApiCallStartTime(t);
    setApiResponseTime(null);
    addTerminalEntry("api-start", `→ ${label}`, "");
  }

  function markApiEnd(label, success, responseMs, detail = "") {
    setApiResponseTime(responseMs);
    setCurrentApiCall("");
    addTerminalEntry(
      success ? "api-ok" : "api-err",
      `${success ? "✓" : "✗"} ${label} — ${msToDisplay(responseMs)}`,
      detail
    );
  }

  function getAudioContext() {
    if (typeof window === "undefined") return null;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    if (!audioContextRef.current) audioContextRef.current = new Context();
    return audioContextRef.current;
  }

  function playToneSequence(steps) {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const startAt = ctx.currentTime + 0.02;
    steps.reduce((cursor, step) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = step.type || "sine";
      osc.frequency.value = step.frequency;
      gain.gain.setValueAtTime(0.0001, cursor);
      gain.gain.exponentialRampToValueAtTime((step.gain || 0.04) * outputVolume, cursor + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, cursor + step.duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(cursor);
      osc.stop(cursor + step.duration + 0.02);
      return cursor + step.duration + (step.gap || 0.04);
    }, startAt);
  }

  function playRingTone() {
    playToneSequence([
      { frequency: 440,    duration: 0.35, gap: 0.09, type: "triangle", gain: 0.05 },
      { frequency: 554.37, duration: 0.35, gap: 0.18, type: "triangle", gain: 0.04 },
      { frequency: 440,    duration: 0.35, gap: 0.09, type: "triangle", gain: 0.05 },
      { frequency: 659.25, duration: 0.38,             type: "triangle", gain: 0.04 },
    ]);
  }

  function playConnectTone() {
    playToneSequence([
      { frequency: 392,    duration: 0.15, gap: 0.03, type: "sine" },
      { frequency: 523.25, duration: 0.15, gap: 0.03, type: "sine" },
      { frequency: 659.25, duration: 0.22,             type: "sine" },
    ]);
  }

  function playHangupTone() {
    playToneSequence([
      { frequency: 587.33, duration: 0.14, gap: 0.03, type: "triangle" },
      { frequency: 440,    duration: 0.14, gap: 0.03, type: "triangle" },
      { frequency: 293.66, duration: 0.22,             type: "triangle" },
    ]);
  }

  function playListeningStartTone() {
    playToneSequence([
      { frequency: 783.99, duration: 0.1, gap: 0.03, type: "sine", gain: 0.03 },
      { frequency: 1046.5, duration: 0.12,             type: "sine", gain: 0.028 },
    ]);
  }

  function playListeningStopTone() {
    playToneSequence([
      { frequency: 659.25, duration: 0.1, gap: 0.03, type: "triangle", gain: 0.026 },
      { frequency: 523.25, duration: 0.12,             type: "triangle", gain: 0.024 },
    ]);
  }

  function playHoldMusicPhrase() {
    playToneSequence([
      { frequency: 293.66, duration: 0.28, gap: 0.06, type: "triangle", gain: 0.012 },
      { frequency: 369.99, duration: 0.28, gap: 0.06, type: "triangle", gain: 0.011 },
      { frequency: 440,    duration: 0.36, gap: 0.08, type: "triangle", gain: 0.011 },
      { frequency: 369.99, duration: 0.28, gap: 0.06, type: "triangle", gain: 0.010 },
      { frequency: 329.63, duration: 0.42, gap: 0.10, type: "triangle", gain: 0.010 },
    ]);
  }

  function startHoldMusicLoop() {
    stopHoldMusicLoop();
    playHoldMusicPhrase();
    holdMusicTimerRef.current = window.setInterval(() => playHoldMusicPhrase(), 2500);
  }

  function stopHoldMusicLoop() {
    if (holdMusicTimerRef.current) {
      window.clearInterval(holdMusicTimerRef.current);
      holdMusicTimerRef.current = 0;
    }
  }

  function initAmbientMusic() {
    if (ambientMusicRef.current) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const audio = new Audio(`${API_BASE_URL}/aahaas-assistent-v01/ambient-music`);
    audio.loop = true;
    audio.crossOrigin = "anonymous";

    const gainNode = ctx.createGain();
    gainNode.gain.value = 0.001;

    try {
      const source = ctx.createMediaElementSource(audio);
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      ambientMusicRef.current = { audio, gainNode, source };
    } catch {
      ambientMusicRef.current = { audio, gainNode, source: null };
    }

    audio.play().catch(() => {});
  }

  function setAmbientVolume(target, fadeSec) {
    if (!ambientMusicRef.current) return;
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const { gainNode } = ambientMusicRef.current;
    const now = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(Math.max(gainNode.gain.value, 0.001), now);
    if (target <= 0) {
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + fadeSec);
    } else {
      gainNode.gain.exponentialRampToValueAtTime(Math.max(target, 0.001), now + fadeSec);
    }
  }

  function destroyAmbientMusic() {
    if (!ambientMusicRef.current) return;
    const { audio, gainNode } = ambientMusicRef.current;
    const ctx = audioContextRef.current;
    if (ctx && gainNode) {
      const now = ctx.currentTime;
      try {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(Math.max(gainNode.gain.value, 0.001), now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 2.0);
      } catch {}
      window.setTimeout(() => { audio.pause(); audio.src = ""; }, 2100);
    } else {
      audio.pause();
      audio.src = "";
    }
    ambientMusicRef.current = null;
  }

  function stopAllAudio() {
    if (mainAudioRef.current) {
      mainAudioRef.current.pause();
      mainAudioRef.current.currentTime = 0;
      mainAudioRef.current = null;
    }
    if (mainAudioUrlRef.current) { URL.revokeObjectURL(mainAudioUrlRef.current); mainAudioUrlRef.current = ""; }
    if (holdAudioRef.current) {
      holdAudioRef.current.pause();
      holdAudioRef.current.currentTime = 0;
      holdAudioRef.current = null;
    }
    if (holdAudioUrlRef.current) { URL.revokeObjectURL(holdAudioUrlRef.current); holdAudioUrlRef.current = ""; }
    stopHoldMusicLoop();
    destroyAmbientMusic();
  }

  async function playAgentAudio(audioUrl, onEnded) {
    if (mainAudioRef.current) mainAudioRef.current.pause();
    const audio = new Audio(audioUrl);
    audio.volume = outputVolume;
    mainAudioRef.current = audio;
    mainAudioUrlRef.current = audioUrl;
    setPhase("assistant-speaking");
    addTerminalEntry("state", "Speaking (AI response audio)");

    audio.onended = () => {
      if (mainAudioUrlRef.current) { URL.revokeObjectURL(mainAudioUrlRef.current); mainAudioUrlRef.current = ""; }
      if (mainAudioRef.current === audio) mainAudioRef.current = null;
      onEnded?.();
    };

    await audio.play();
  }

  async function playHoldAudioLoop() {
    if (!holdAudioUrlRef.current) { startHoldMusicLoop(); return; }
    if (holdAudioRef.current) holdAudioRef.current.pause();
    const audio = new Audio(holdAudioUrlRef.current);
    audio.volume = musicLevel;
    holdAudioRef.current = audio;
    startHoldMusicLoop();
    await audio.play().catch(() => { holdAudioRef.current = null; });
  }

  function stopHoldAudioLoop() {
    if (holdAudioRef.current) {
      holdAudioRef.current.pause();
      holdAudioRef.current.currentTime = 0;
      holdAudioRef.current = null;
    }
    stopHoldMusicLoop();
  }

  function resetState() {
    autoLoopEnabledRef.current = false;
    finalizingRef.current = false;
    packagePrefetchStartedRef.current = false;
    if (packageWaitPollRef.current) { window.clearTimeout(packageWaitPollRef.current); packageWaitPollRef.current = 0; }
    stopAllAudio();
    stopMicrophone();
    stopSilenceMonitor();
    stopCallDurationTimer();
    callIdRef.current = "";
    lastReplyRef.current = "";
    setCallId("");
    setCallStatus("Ready to start.");
    setPhase("idle");
    setError("");
    setConversation([]);
    setLastTranscript("");
    setLastReply("");
    setCustomerProfile({});
    setServiceCategories([]);
    setLiveSummary("");
    setFinalReport(null);
    setTestMessage("");
    setCallEnded(false);
    setPulseLevel(0);
    setListeningHint("");
    setQuotationStatus(null);
    setCurrentApiCall("");
    setApiCallStartTime(null);
    setApiResponseTime(null);
    setCallStartTime(null);
    setCallDuration(0);
    setTerminalLog([]);
  }

  async function handleStartCall() {
    if (!callSupported || phase !== "idle") return;

    try {
      autoLoopEnabledRef.current = true;
      setError("");
      setCallEnded(false);
      setPhase("ringing");
      setCallStatus("Calling Aahaas. Please wait while we connect the assistant.");
      addTerminalEntry("state", "Dialing — initiating session");
      playRingTone();
      startCallDurationTimer();

      await new Promise((resolve) => window.setTimeout(resolve, 1600));
      setPhase("connecting");
      setCallStatus("Connecting to Aahaas Assistent V0.1...");
      addTerminalEntry("state", "Connecting...");
      playConnectTone();

      const t0 = Date.now();
      markApiStart("POST /aahaas-assistent-v01/session");

      const response = await fetch(`${API_BASE_URL}/aahaas-assistent-v01/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_name: selectedVoice, voice_speed: voiceSpeed }),
      });

      const data = await response.json().catch(() => ({}));
      const elapsed = Date.now() - t0;
      markApiEnd("POST /aahaas-assistent-v01/session", response.ok, elapsed, data.message || "");

      if (!response.ok) throw new Error(data.message || "Session could not start.");

      callIdRef.current = data.call_id || "";
      lastReplyRef.current = data.greeting || "";
      setCallId(data.call_id || "");
      setLastReply(data.greeting || "");
      setConversation(data.greeting ? [{ role: "assistant", content: data.greeting }] : []);
      setCallStatus("Connected. The AI assistant is greeting you.");
      addTerminalEntry("info", `Session started — ID: ${data.call_id}`, `Voice: ${selectedVoice}, Speed: ${voiceSpeed}x`);

      if (data.hold_audio_base64) {
        holdAudioUrlRef.current = createAudioUrlFromBase64(data.hold_audio_base64, data.hold_audio_mime_type);
      }

      const greetingUrl = createAudioUrlFromBase64(data.greeting_audio_base64, data.greeting_audio_mime_type);
      await playAgentAudio(greetingUrl, async () => {
        if (autoLoopEnabledRef.current) await beginListening();
      });
    } catch (err) {
      autoLoopEnabledRef.current = false;
      setPhase("idle");
      setError(err.message);
      setCallStatus("The call could not be started.");
      addTerminalEntry("error", `Failed: ${err.message}`);
      stopCallDurationTimer();
    }
  }

  async function beginListening() {
    if (!callIdRef.current || !autoLoopEnabledRef.current || finalizingRef.current) return;

    try {
      const profile = inferListeningProfile(lastReplyRef.current);
      setPhase("listening");
      setCallStatus("Listening for your answer now.");
      setListeningHint(profile.hint);
      addTerminalEntry("state", "Listening — mic active");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      recordedChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        playListeningStopTone();
        const audioBlob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        recordedChunksRef.current = [];
        stopMicrophone();
        if (audioBlob.size === 0 || !autoLoopEnabledRef.current) return;

        if (!speakingDetectedRef.current) {
          await sendSilenceNudge();
          return;
        }
        await sendTurn(audioBlob);
      };

      if (micMuted) {
        stream.getAudioTracks().forEach((t) => { t.enabled = false; });
      }

      recorder.start(250);
      playListeningStartTone();
      startSilenceMonitor(stream, recorder, profile);
    } catch (err) {
      setError(err.message || "Microphone access failed.");
      setCallStatus("Microphone access is required for the call.");
      setPhase("idle");
      addTerminalEntry("error", `Mic error: ${err.message}`);
    }
  }

  function startSilenceMonitor(stream, recorder, profile) {
    stopSilenceMonitor();
    captureElapsedMsRef.current = 0;

    const ctx = getAudioContext();
    if (!ctx) {
      window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, profile.maxRecordMs);
      return;
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    analyserRef.current = analyser;
    sourceNodeRef.current = source;
    speakingDetectedRef.current = false;
    silenceMsRef.current = 0;

    const samples = new Uint8Array(analyser.frequencyBinCount);
    const silenceThreshold = micSensitivity;

    const tick = () => {
      if (!analyserRef.current || recorder.state !== "recording") return;
      analyserRef.current.getByteFrequencyData(samples);
      const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
      setPulseLevel(Math.min(1, avg / 80));
      captureElapsedMsRef.current += 120;

      if (avg > silenceThreshold) {
        speakingDetectedRef.current = true;
        silenceMsRef.current = 0;
      } else if (speakingDetectedRef.current) {
        silenceMsRef.current += 120;
      } else {
        silenceMsRef.current += 120;
      }

      if (captureElapsedMsRef.current >= profile.maxRecordMs) { recorder.stop(); return; }
      if (speakingDetectedRef.current && silenceMsRef.current >= profile.postSpeechSilenceMs) { recorder.stop(); return; }

      silenceMonitorRef.current = window.setTimeout(tick, 120);
    };

    tick();
  }

  function stopSilenceMonitor() {
    if (silenceMonitorRef.current) { window.clearTimeout(silenceMonitorRef.current); silenceMonitorRef.current = 0; }
    if (sourceNodeRef.current) { sourceNodeRef.current.disconnect(); sourceNodeRef.current = null; }
    if (analyserRef.current) { analyserRef.current.disconnect(); analyserRef.current = null; }
    setPulseLevel(0);
    setListeningHint("");
  }

  function stopMicrophone() {
    stopSilenceMonitor();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }

  async function sendSilenceNudge() {
    if (!callIdRef.current || !autoLoopEnabledRef.current) return;
    try {
      setPhase("processing");
      setCallStatus("Checking if you are still there...");
      addTerminalEntry("state", "Silence detected — sending nudge");

      const t0 = Date.now();
      markApiStart("POST /aahaas-assistent-v01/turn (silence)");

      const formData = new FormData();
      formData.append("call_id", callIdRef.current);
      formData.append("transcript", "__silent__");
      formData.append("voice_name", selectedVoice);
      formData.append("voice_speed", String(voiceSpeed));

      const response = await fetch(`${API_BASE_URL}/aahaas-assistent-v01/turn`, { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      markApiEnd("POST /aahaas-assistent-v01/turn (silence)", response.ok, Date.now() - t0);

      if (!response.ok || !data.audio_base64) {
        if (autoLoopEnabledRef.current) await beginListening();
        return;
      }

      const replyUrl = createAudioUrlFromBase64(data.audio_base64, data.audio_mime_type);
      await playAgentAudio(replyUrl, async () => {
        if (autoLoopEnabledRef.current) await beginListening();
      });
    } catch {
      if (autoLoopEnabledRef.current) await beginListening();
    }
  }

  async function startPackagePrefetch() {
    if (!callIdRef.current || packagePrefetchStartedRef.current) return;
    packagePrefetchStartedRef.current = true;
    try {
      await fetch(`${API_BASE_URL}/aahaas-assistent-v01/package-prefetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callIdRef.current }),
      });
    } catch {
      packagePrefetchStartedRef.current = false;
    }
  }

  async function waitForPackageResult() {
    if (!callIdRef.current || finalizingRef.current) return;

    try {
      setPhase("processing");
      setCallStatus("Waiting for Aahaas product options. Please hold for a moment.");
      addTerminalEntry("state", "Waiting for package results");
      await playHoldAudioLoop();

      const poll = async () => {
        const t0 = Date.now();
        markApiStart("POST /aahaas-assistent-v01/package-status");

        const response = await fetch(`${API_BASE_URL}/aahaas-assistent-v01/package-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ call_id: callIdRef.current, voice_name: selectedVoice, voice_speed: voiceSpeed }),
        });

        const data = await response.json().catch(() => ({}));
        markApiEnd("POST /aahaas-assistent-v01/package-status", response.ok, Date.now() - t0);

        if (!response.ok) throw new Error(data.message || "Could not check package status.");

        if (!data.ready && !data.failed) {
          packageWaitPollRef.current = window.setTimeout(() => {
            poll().catch(async (error) => {
              stopHoldAudioLoop();
              setError(error.message);
              if (autoLoopEnabledRef.current) await beginListening();
            });
          }, 2500);
          return;
        }

        if (packageWaitPollRef.current) { window.clearTimeout(packageWaitPollRef.current); packageWaitPollRef.current = 0; }

        stopHoldAudioLoop();
        setConversation(data.conversation || []);
        setCustomerProfile(data.customer_profile || {});
        setServiceCategories(data.service_categories || []);
        lastReplyRef.current = data.reply || "";
        setLastReply(data.reply || "");

        const replyUrl = createAudioUrlFromBase64(data.audio_base64, data.audio_mime_type);
        await playAgentAudio(replyUrl, async () => {
          if (data.failed) {
            setCallStatus("Package search had a problem. The assistant is continuing.");
            if (autoLoopEnabledRef.current) await beginListening();
            return;
          }
          if (data.should_end) {
            autoLoopEnabledRef.current = false;
            setCallEnded(true);
            setCallStatus("The call has ended.");
            setPhase("completed");
            addTerminalEntry("state", "Call completed (package flow)");
            return;
          }
          if (autoLoopEnabledRef.current) await beginListening();
        });
      };

      await poll();
    } catch (err) {
      stopHoldAudioLoop();
      setError(err.message);
      setCallStatus("We could not finish checking the package yet.");
      if (autoLoopEnabledRef.current) await beginListening();
    }
  }

  async function sendTurn(audioBlob, transcriptText = "") {
    try {
      setPhase("processing");
      setCallStatus("Aahaas is reviewing your request and preparing the next question.");
      addTerminalEntry("state", "Processing — sending turn to API");

      const formData = new FormData();
      formData.append("call_id", callIdRef.current);
      if (audioBlob) formData.append("audio", audioBlob, "aahaas-v01.webm");
      if (transcriptText.trim()) formData.append("transcript", transcriptText.trim());
      formData.append("voice_name", selectedVoice);
      formData.append("voice_speed", String(voiceSpeed));

      const t0 = Date.now();
      markApiStart("POST /aahaas-assistent-v01/turn");

      const response = await fetch(`${API_BASE_URL}/aahaas-assistent-v01/turn`, { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      const elapsed = Date.now() - t0;
      markApiEnd("POST /aahaas-assistent-v01/turn", response.ok, elapsed, data.reply?.slice(0, 80) || data.message || "");

      if (!response.ok) throw new Error(data.message || "Turn reply failed.");

      setLastTranscript(data.transcript || "");
      lastReplyRef.current = data.reply || "";
      setLastReply(data.reply || "");
      setTestMessage("");
      setConversation(data.conversation || []);
      setCustomerProfile(data.customer_profile || {});
      setServiceCategories(data.service_categories || []);
      setLiveSummary(data.live_summary || "");

      if (data.package_lookup_status === "queued" && (data.service_categories || []).some(isTravelServiceCategory)) {
        startPackagePrefetch();
      }

      const replyUrl = createAudioUrlFromBase64(data.audio_base64, data.audio_mime_type);
      await playAgentAudio(replyUrl, async () => {
        if (data.should_end) {
          await finalizeCall(data.ended_reason || "completed_by_assistant");
          return;
        }
        if (data.wait_for_package) {
          await waitForPackageResult();
          return;
        }
        if (autoLoopEnabledRef.current) await beginListening();
      });
    } catch (err) {
      stopHoldAudioLoop();
      setError(err.message);
      setCallStatus("Temporary issue — call is still open. Please continue when ready.");
      setPhase("connected");
      addTerminalEntry("error", `Turn error: ${err.message}`);
    }
  }

  async function handleSendTestMessage() {
    if (!callIdRef.current || !testMessage.trim() || finalizingRef.current || callEnded) return;
    playListeningStopTone();
    await sendTurn(null, testMessage);
  }

  async function finalizeCall(endedReason = "completed") {
    if (!callIdRef.current || finalizingRef.current) return;

    try {
      finalizingRef.current = true;
      autoLoopEnabledRef.current = false;
      stopMicrophone();
      setPhase("ending");
      setCallStatus("Finalizing your call report and closing the conversation...");
      addTerminalEntry("state", "Ending call — generating report");

      const t0 = Date.now();
      markApiStart("POST /aahaas-assistent-v01/end");

      const response = await fetch(`${API_BASE_URL}/aahaas-assistent-v01/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callIdRef.current, ended_reason: endedReason, voice_name: selectedVoice, voice_speed: voiceSpeed }),
      });

      const data = await response.json().catch(() => ({}));
      markApiEnd("POST /aahaas-assistent-v01/end", response.ok, Date.now() - t0);

      if (!response.ok) throw new Error(data.message || "Call report could not be created.");

      setFinalReport(data.report || null);
      setServiceCategories(data.report?.service_categories || serviceCategories);
      setCustomerProfile(data.report?.customer_profile || customerProfile);
      setCallEnded(true);
      setCallStatus("The call has ended and the report was created successfully.");
      playHangupTone();
      stopCallDurationTimer();

      const qQueued = data.quotation_queued === true;
      setQuotationStatus({ queued: qQueued, error: null });
      addTerminalEntry(
        qQueued ? "info" : "api-err",
        qQueued
          ? "WhatsApp quotation queued — will be sent in background"
          : "Quotation NOT queued (contacts missing or incomplete)",
      );
      addTerminalEntry("info", "Call ended — report ready");

      const closingUrl = createAudioUrlFromBase64(data.audio_base64, data.audio_mime_type);
      await playAgentAudio(closingUrl, () => { setPhase("completed"); });
    } catch (err) {
      setError(err.message);
      setCallStatus("The live call ended, but the final report could not be saved yet.");
      setPhase("completed");
      stopCallDurationTimer();
      addTerminalEntry("error", `Finalize error: ${err.message}`);
    } finally {
      finalizingRef.current = false;
    }
  }

  async function handleHangUp() {
    if (!callId) { resetState(); return; }

    const activeTravelCall = serviceCategories.some(isTravelServiceCategory);
    const packageState = customerProfile.package_state || "";

    if (activeTravelCall && !["accepted", "api_unavailable"].includes(packageState) && !finalizingRef.current) {
      await sendTurn(null, "I would like to end the call now. Please confirm the recommended package first.");
      return;
    }

    await finalizeCall("manual_hangup");
  }

  function handleToggleMicMute() {
    setMicMuted((prev) => {
      const next = !prev;
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = !next; });
      }
      addTerminalEntry("info", next ? "Mic muted" : "Mic unmuted");
      return next;
    });
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const terminalState      = TERMINAL_STATES[phase] || TERMINAL_STATES.idle;
  const packageStatusLabel = getPackageStatusLabel(customerProfile);
  const packageIssue       = customerProfile.package_lookup_error || "";
  const controlDisabled    = !["idle", "completed", "failed", "timeout"].includes(phase);

  const phaseColorMap = {
    idle: "#94a3b8", ringing: "#3b82f6", connecting: "#3b82f6", connected: "#3b82f6",
    listening: "#10b981", processing: "#f59e0b", "wait-for-response": "#f59e0b",
    "assistant-speaking": "#8b5cf6", ending: "#f97316",
    completed: "#10b981", failed: "#ef4444", timeout: "#ef4444",
  };
  const phaseColor = phaseColorMap[phase] || "#94a3b8";

  // ── Style tokens ──────────────────────────────────────────────────────────
  const card = {
    background: "rgba(255,255,255,0.95)",
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: 14,
    padding: "16px 18px",
    boxShadow: "0 2px 12px rgba(15,23,42,0.06)",
  };
  const kicker = {
    fontSize: 10, fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.1em", color: "#94a3b8", marginBottom: 8, display: "block",
  };
  const profileRows = [
    { key: "full_name",              label: "Full Name", color: "#6366f1" },
    { key: "contact_number",         label: "WhatsApp",  color: "#10b981" },
    { key: "current_living_country", label: "Country",   color: "#f59e0b" },
  ];
  const fieldRow = {
    display: "flex", alignItems: "center", gap: 8,
    padding: "6px 0", borderBottom: "1px solid rgba(15,23,42,0.05)",
  };

  const sliders = [
    { label: "Voice Speed",     value: `${voiceSpeed.toFixed(1)}×`,          min: 0.5, max: 2.0,  step: 0.1,  val: voiceSpeed,      set: (v) => setVoiceSpeed(parseFloat(v)),          color: "#6366f1" },
    { label: "Output Volume",   value: `${Math.round(outputVolume * 100)}%`, min: 0,   max: 1,    step: 0.05, val: outputVolume,    set: (v) => setOutputVolume(parseFloat(v)),         color: "#10b981" },
    { label: "Music Level",     value: `${Math.round(musicLevel * 100)}%`,   min: 0,   max: 1,    step: 0.05, val: musicLevel,      set: (v) => setMusicLevel(parseFloat(v)),           color: "#f59e0b" },
    { label: "Mic Sensitivity", value: micSensitivity === 1 ? "Max" : micSensitivity === 50 ? "Min" : String(micSensitivity), min: 1, max: 50, step: 1, val: micSensitivity, set: (v) => setMicSensitivity(parseInt(v, 10)), color: "#8b5cf6" },
  ];

  const startDisabled = !callSupported || phase !== "idle";
  const endDisabled   = !callId || phase === "ending" || phase === "completed";
  const sendDisabled  = !callId || !testMessage.trim() || phase === "processing" || phase === "ending";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Space Grotesk','Segoe UI',system-ui,sans-serif", background: "#f0f4f8", minHeight: "100vh", paddingBottom: 32 }}>

      {/* ── HEADER ── */}
      <header style={{
        background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
        padding: "14px 22px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        boxShadow: "0 4px 24px rgba(0,0,0,0.22)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>🎙</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>Aahaas Assistant V0.1</div>
            <div style={{ color: "#94a3b8", fontSize: 11 }}>Live Call Management Dashboard</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {callId && (
            <span style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc", padding: "4px 10px", borderRadius: 8, fontSize: 11, fontFamily: "monospace", border: "1px solid rgba(99,102,241,0.25)" }}>
              {callId}
            </span>
          )}
          {callDuration > 0 && (
            <span style={{ background: "rgba(16,185,129,0.15)", color: "#6ee7b7", padding: "4px 10px", borderRadius: 8, fontSize: 11, fontFamily: "monospace", border: "1px solid rgba(16,185,129,0.25)" }}>
              {msToDisplay(callDuration)}
            </span>
          )}
          <span style={{ background: `${phaseColor}1a`, color: phaseColor, border: `1px solid ${phaseColor}40`, padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, minWidth: 80, textAlign: "center" }}>
            {terminalState.label}
          </span>
        </div>
      </header>

      {/* ── 3-COLUMN GRID ── */}
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr 280px", gap: 14, padding: "14px 14px 0", alignItems: "start" }}>

        {/* ── LEFT: CONTROLS ── */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Voice & Sliders */}
          <div style={card}>
            <span style={kicker}>Voice Settings</span>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 500, marginBottom: 5 }}>Voice Agent</div>
              <select
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                disabled={controlDisabled}
                style={{
                  width: "100%", padding: "7px 10px", borderRadius: 8,
                  border: "1px solid rgba(15,23,42,0.12)",
                  background: controlDisabled ? "#f1f5f9" : "#fff",
                  fontSize: 12, color: "#1e293b", outline: "none",
                  cursor: controlDisabled ? "not-allowed" : "pointer",
                }}
              >
                {OPENAI_VOICES.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>
            {sliders.map((s) => (
              <div key={s.label} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: s.color, fontWeight: 700 }}>{s.value}</span>
                </div>
                <input type="range" min={s.min} max={s.max} step={s.step} value={s.val}
                  onChange={(e) => s.set(e.target.value)}
                  style={{ width: "100%", accentColor: s.color, cursor: "pointer" }}
                />
              </div>
            ))}
          </div>

          {/* Toggles */}
          <div style={card}>
            <span style={kicker}>Controls</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Ambient Music", on: bgMusicEnabled, onColor: "#f59e0b", offColor: "#cbd5e1", onClick: () => setBgMusicEnabled((p) => !p) },
                { label: micMuted ? "Mic Muted" : "Mic Active", on: !micMuted, onColor: "#10b981", offColor: "#ef4444", onClick: handleToggleMicMute },
              ].map((t) => (
                <div key={t.label} onClick={t.onClick} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 12px", borderRadius: 10, cursor: "pointer",
                  background: t.on ? `${t.onColor}12` : `${t.offColor}10`,
                  border: `1px solid ${t.on ? t.onColor : t.offColor}30`,
                  transition: "all 0.18s",
                }}>
                  <span style={{ fontSize: 12, color: t.on ? t.onColor : t.offColor, fontWeight: 600 }}>{t.label}</span>
                  <div style={{ width: 36, height: 20, borderRadius: 10, background: t.on ? t.onColor : t.offColor, position: "relative", transition: "background 0.18s" }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: t.on ? 18 : 2, transition: "left 0.18s", boxShadow: "0 1px 4px rgba(0,0,0,0.18)" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* API Status */}
          <div style={{ ...card, padding: "12px 14px" }}>
            <span style={kicker}>API Status</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>State</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: currentApiCall ? "#f59e0b" : "#10b981" }}>{currentApiCall ? "Running" : "Idle"}</span>
              </div>
              {currentApiCall && (
                <div style={{ fontSize: 10, color: "#f59e0b", fontFamily: "monospace", background: "rgba(245,158,11,0.08)", padding: "3px 7px", borderRadius: 5 }}>{currentApiCall}</div>
              )}
              {apiResponseTime !== null && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "#64748b" }}>Last response</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6366f1" }}>{msToDisplay(apiResponseTime)}</span>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* ── CENTER: CALL ── */}
        <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Orb + Status + Buttons */}
          <div style={{ ...card, textAlign: "center", padding: "26px 22px" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
              <div className={`call-orb phase-${phase}`}>
                <div className="call-orb-core" style={{ transform: `scale(${1 + pulseLevel * 0.3})` }} />
                <div className="call-orb-ring ring-one" />
                <div className="call-orb-ring ring-two" />
                <div className="call-orb-ring ring-three" />
              </div>
            </div>
            <div style={{ fontWeight: 600, color: "#1e293b", fontSize: 14, marginBottom: 6 }}>{callStatus}</div>
            {listeningHint && (
              <div style={{ fontSize: 12, color: "#6366f1", background: "rgba(99,102,241,0.07)", padding: "4px 14px", borderRadius: 20, display: "inline-block", marginBottom: 10 }}>
                {listeningHint}
              </div>
            )}
            {error && (
              <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6, background: "rgba(239,68,68,0.06)", padding: "6px 12px", borderRadius: 8 }}>{error}</div>
            )}
            {!callSupported && (
              <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>Browser does not support microphone recording.</div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
              <button type="button" onClick={handleStartCall} disabled={startDisabled} style={{
                padding: "10px 24px", borderRadius: 10, border: "none",
                cursor: startDisabled ? "not-allowed" : "pointer",
                background: startDisabled ? "#e2e8f0" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                color: startDisabled ? "#94a3b8" : "#fff",
                fontWeight: 700, fontSize: 13,
                boxShadow: startDisabled ? "none" : "0 4px 14px rgba(99,102,241,0.32)",
              }}>▶ Start Call</button>
              <button type="button" onClick={handleHangUp} disabled={endDisabled} style={{
                padding: "10px 22px", borderRadius: 10, border: "none",
                cursor: endDisabled ? "not-allowed" : "pointer",
                background: endDisabled ? "#e2e8f0" : "linear-gradient(135deg,#ef4444,#dc2626)",
                color: endDisabled ? "#94a3b8" : "#fff",
                fontWeight: 700, fontSize: 13,
                boxShadow: endDisabled ? "none" : "0 4px 14px rgba(239,68,68,0.32)",
              }}>■ End Call</button>
              <button type="button" onClick={resetState} style={{
                padding: "10px 20px", borderRadius: 10,
                border: "1px solid rgba(15,23,42,0.12)", cursor: "pointer",
                background: "#f8fafc", color: "#475569", fontWeight: 600, fontSize: 13,
              }}>↺ Reset</button>
            </div>
          </div>

          {/* Transcript + Reply */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={card}>
              <span style={kicker}>Latest Transcript</span>
              <p style={{ fontSize: 12, color: lastTranscript ? "#1e293b" : "#94a3b8", margin: 0, lineHeight: 1.65 }}>
                {lastTranscript || "Customer speech will appear here..."}
              </p>
            </div>
            <div style={card}>
              <span style={kicker}>Assistant Reply</span>
              <p style={{ fontSize: 12, color: lastReply ? "#1e293b" : "#94a3b8", margin: 0, lineHeight: 1.65 }}>
                {lastReply || "AI response will appear here..."}
              </p>
            </div>
          </div>

          {/* Live Summary */}
          {liveSummary && (
            <div style={{ ...card, background: "rgba(99,102,241,0.04)", border: "1px solid rgba(99,102,241,0.14)" }}>
              <span style={{ ...kicker, color: "#6366f1" }}>Live Summary</span>
              <p style={{ fontSize: 12, color: "#374151", margin: 0, lineHeight: 1.65 }}>{liveSummary}</p>
            </div>
          )}

          {/* Test Input */}
          <div style={card}>
            <span style={kicker}>Quick Test Input</span>
            <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 10px" }}>Simulate caller answers without mic for testing.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSendTestMessage(); }}
                placeholder="Type a caller answer..."
                style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(15,23,42,0.12)", fontSize: 12, outline: "none", background: "#fff" }}
              />
              <button type="button" onClick={handleSendTestMessage} disabled={sendDisabled} style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                cursor: sendDisabled ? "not-allowed" : "pointer",
                background: sendDisabled ? "#e2e8f0" : "#6366f1",
                color: sendDisabled ? "#94a3b8" : "#fff",
                fontWeight: 600, fontSize: 12,
              }}>Send</button>
            </div>
          </div>
        </main>

        {/* ── RIGHT: LIVE INTEL ── */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Customer Profile */}
          <div style={card}>
            <span style={kicker}>Customer Profile</span>
            {profileRows.map((row) => {
              const val = customerProfile[row.key];
              const filled = !!val;
              return (
                <div key={row.key} style={fieldRow}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: filled ? row.color : "#cbd5e1", flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: "#64748b", minWidth: 62 }}>{row.label}</span>
                  <span style={{ fontSize: 12, color: filled ? "#1e293b" : "#94a3b8", fontWeight: filled ? 600 : 400, flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {filled ? formatProfileValue(val) : "Pending"}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Package Status */}
          <div style={card}>
            <span style={kicker}>Package Status</span>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: packageStatusLabel === "Package ready" ? "#10b981" : packageStatusLabel === "Package problem" ? "#ef4444" : "#f59e0b" }}>
              {packageStatusLabel}
            </div>
            {customerProfile.travel_package_prompt && (
              <p style={{ fontSize: 11, color: "#64748b", margin: "4px 0 0", lineHeight: 1.5 }}>
                <strong>Prompt:</strong> {customerProfile.travel_package_prompt}
              </p>
            )}
            {packageIssue && (
              <p style={{ fontSize: 11, color: "#ef4444", margin: "4px 0 0" }}><strong>Issue:</strong> {packageIssue}</p>
            )}
          </div>

          {/* Quotation Status */}
          {quotationStatus !== null && (
            <div style={{
              ...card,
              background: quotationStatus.queued ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)",
              border: `1px solid ${quotationStatus.queued ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
            }}>
              <span style={{ ...kicker, color: quotationStatus.queued ? "#10b981" : "#ef4444" }}>
                {quotationStatus.queued ? "✓ Quotation Queued" : "✕ Quotation Failed"}
              </span>
              <p style={{ fontSize: 12, color: "#475569", margin: 0 }}>
                {quotationStatus.queued ? "WhatsApp quotation queued for background delivery." : "Contact details may be incomplete."}
              </p>
              {quotationStatus.error && <p style={{ fontSize: 11, color: "#ef4444", margin: "5px 0 0" }}>{quotationStatus.error}</p>}
            </div>
          )}

          {/* Service Categories */}
          <div style={card}>
            <span style={kicker}>Service Categories</span>
            {serviceCategories.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {serviceCategories.map((cat) => (
                  <span key={cat} style={{ background: "rgba(99,102,241,0.08)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.2)", padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 500 }}>
                    {cat}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 12, color: "#94a3b8" }}>No categories yet</span>
            )}
          </div>

          {/* Final Report */}
          {finalReport && (
            <div style={{ ...card, background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.15)" }}>
              <span style={{ ...kicker, color: "#10b981" }}>Final Report</span>
              <p style={{ fontSize: 12, color: "#374151", margin: "0 0 8px", lineHeight: 1.6 }}>{finalReport.summary || "No summary."}</p>
              {finalReport.products_needed?.length > 0 && (
                <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 4px" }}><strong>Products:</strong> {finalReport.products_needed.join(", ")}</p>
              )}
              {finalReport.follow_up_actions?.length > 0 && (
                <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}><strong>Follow-up:</strong> {finalReport.follow_up_actions.join(", ")}</p>
              )}
            </div>
          )}

          {/* Suggested Package */}
          {customerProfile.suggested_package && (
            <div style={card}>
              <span style={kicker}>Suggested Package</span>
              <pre style={{ fontSize: 10, color: "#374151", margin: 0, overflow: "auto", maxHeight: 180, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {formatDebugJson(customerProfile.suggested_package)}
              </pre>
            </div>
          )}
        </aside>
      </div>

      {/* ── BOTTOM: TERMINAL + CONVERSATION ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, padding: "12px 14px 0" }}>

        {/* Terminal */}
        <div style={{ background: "#0d1117", borderRadius: 14, border: "1px solid rgba(255,255,255,0.07)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#374151", display: "block" }}>System Activity</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>Live Terminal</span>
            </div>
            <span style={{ fontSize: 11, color: terminalState.color, fontWeight: 700, background: `${terminalState.color}1a`, padding: "3px 10px", borderRadius: 6 }}>
              ● {terminalState.label}
            </span>
          </div>
          <div style={{ height: 260, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 3 }}>
            {terminalLog.length === 0 ? (
              <span style={{ fontSize: 11, color: "#4b5563", fontFamily: "monospace" }}>System ready. Start a call...</span>
            ) : (
              terminalLog.map((entry, i) => {
                const ec = { "api-start": "#3b82f6", "api-ok": "#10b981", "api-err": "#ef4444", error: "#ef4444", info: "#94a3b8", state: "#8b5cf6", warn: "#f59e0b" };
                const c = ec[entry.type] || "#94a3b8";
                return (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 10, color: "#4b5563", fontFamily: "monospace", flexShrink: 0, marginTop: 1 }}>{entry.ts}</span>
                    <span style={{ fontSize: 11, color: c, fontFamily: "monospace", lineHeight: 1.5 }}>
                      {entry.message}
                      {entry.detail && <span style={{ color: "#6b7280", marginLeft: 6 }}>{entry.detail}</span>}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={terminalEndRef} />
          </div>
        </div>

        {/* Conversation */}
        <div style={{ ...card, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
            <span style={{ ...kicker, marginBottom: 2 }}>Conversation Log</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>Live Intake History</span>
          </div>
          <div style={{ height: 260, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }} aria-live="polite">
            {conversation.length === 0 ? (
              <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>Start the call — conversation will appear here.</p>
            ) : (
              conversation.map((msg, idx) => (
                <div key={`${msg.role}-${idx}`} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "assistant" ? "flex-start" : "flex-end", gap: 3 }}>
                  <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", padding: msg.role === "assistant" ? "0 0 0 4px" : "0 4px 0 0" }}>
                    {msg.role === "assistant" ? "AI Assistant" : "Caller"}
                  </span>
                  <div style={{
                    maxWidth: "85%",
                    background: msg.role === "assistant" ? "rgba(99,102,241,0.08)" : "rgba(16,185,129,0.08)",
                    border: `1px solid ${msg.role === "assistant" ? "rgba(99,102,241,0.2)" : "rgba(16,185,129,0.2)"}`,
                    borderRadius: msg.role === "assistant" ? "4px 12px 12px 12px" : "12px 4px 12px 12px",
                    padding: "8px 12px", fontSize: 12, color: "#1e293b", lineHeight: 1.6,
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {callEnded && (
        <div style={{ margin: "12px 14px 0", background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 12, padding: "11px 16px", fontSize: 13, color: "#065f46", fontWeight: 500 }}>
          ✓ The assistant has ended the call and stored the final report.
        </div>
      )}
    </div>
  );
}
