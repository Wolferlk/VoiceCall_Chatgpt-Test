import { useEffect, useRef, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_LARAVEL_API_BASE_URL || "http://localhost:8000/api";
const FLOW_SLUG = "4v-chatgpt-assis";
const HOLD_MUSIC_URL = `${API_BASE_URL}/${FLOW_SLUG}/hold-music`;
const OPENAI_VOICE_OPTIONS = [
  "random",
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
  "coral",
  "verse",
  "ballad",
  "ash",
  "sage",
  "marin",
  "cedar",
];

function createAudioUrlFromBase64(base64, mimeType) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType || "audio/wav" });
  return URL.createObjectURL(blob);
}

function pickMimeType() {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") return "";
  const preferredTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "";
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
  const lookupStatus = customerProfile.package_lookup_status || "";

  if (lookupStatus === "presented" || customerProfile.suggested_package) return "Package ready";
  if (lookupStatus === "queued" || lookupStatus === "pending") return "Retrieving package";
  if (lookupStatus === "failed" || lookupStatus === "api_unavailable") return "Package problem";

  return "Not started";
}

function isProductSearching(customerProfile) {
  const lookupStatus = customerProfile.package_lookup_status || "";
  return lookupStatus === "queued" || lookupStatus === "pending";
}

function isTravelServiceCategory(category) {
  return [
    "Hotel Booking",
    "Flight Booking",
    "Sri Lanka Tour Planning",
    "Transportation",
    "Activities and Experiences",
  ].includes(category);
}

function inferListeningProfile(questionText) {
  const normalized = String(questionText || "").toLowerCase();

  if (normalized.includes("full name")) {
    return { maxRecordMs: 10000, postSpeechSilenceMs: 2400, hint: "Mic ready. Say your full name clearly." };
  }
  if (normalized.includes("contact number") || normalized.includes("phone")) {
    return { maxRecordMs: 14000, postSpeechSilenceMs: 2800, hint: "Mic ready. Say the phone number clearly." };
  }
  if (normalized.includes("email")) {
    return { maxRecordMs: 18000, postSpeechSilenceMs: 3000, hint: "Mic ready. Say the email slowly if needed." };
  }
  if (normalized.includes("country") || normalized.includes("location")) {
    return { maxRecordMs: 10000, postSpeechSilenceMs: 2400, hint: "Mic ready. Say your country or city." };
  }
  if (normalized.includes("package is okay") || normalized.includes("okay for you")) {
    return { maxRecordMs: 12000, postSpeechSilenceMs: 2600, hint: "Mic ready. Say yes, or explain what to change." };
  }
  if (
    normalized.includes("special request") ||
    normalized.includes("preferences") ||
    normalized.includes("what needs to change")
  ) {
    return { maxRecordMs: 22000, postSpeechSilenceMs: 3200, hint: "Mic ready. Take your time to explain." };
  }
  if (
    normalized.includes("travel date") ||
    normalized.includes("how many days") ||
    normalized.includes("how many travelers") ||
    normalized.includes("budget")
  ) {
    return { maxRecordMs: 14000, postSpeechSilenceMs: 2800, hint: "Mic ready. Please answer whenever you are ready." };
  }
  if (normalized.includes("where would you like to go") || normalized.includes("destination")) {
    return { maxRecordMs: 20000, postSpeechSilenceMs: 3200, hint: "Mic ready. Tell us your destination and any key details." };
  }

  return { maxRecordMs: 18000, postSpeechSilenceMs: 3000, hint: "Mic ready. Please go ahead." };
}

function formatVoiceLabel(voice) {
  if (!voice || voice === "random") return "Random (Sol or Cove)";
  return voice.charAt(0).toUpperCase() + voice.slice(1);
}

function getRuntimeSearchMessage(runtimeState) {
  switch (runtimeState) {
    case "start":
      return "Aahaas API search is starting now.";
    case "running":
      return "Aahaas API search is running now.";
    case "paused":
      return "Aahaas API search is waiting or paused.";
    case "stop":
      return "Aahaas API search has been stopped for closeout.";
    case "done":
      return "Aahaas API search completed successfully.";
    case "error":
      return "Aahaas API search failed or returned an error.";
    default:
      return "Aahaas API is idle and waiting for the next product search.";
  }
}

function buildTerminalEntry(level, state, message, meta = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    level,
    state,
    message,
    meta,
    timestamp: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
}

function formatElapsedMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0.0s";
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function FourVChatGptAssis() {
  const [callId, setCallId] = useState("");
  const [callStatus, setCallStatus] = useState("Ready to start 4v ChatGPT ASSIS.");
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [conversation, setConversation] = useState([]);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [customerProfile, setCustomerProfile] = useState({});
  const [serviceCategories, setServiceCategories] = useState([]);
  const [liveSummary, setLiveSummary] = useState("");
  const [finalReport, setFinalReport] = useState(null);
  const [testMessage, setTestMessage] = useState("");
  const [callEnded, setCallEnded] = useState(false);
  const [pulseLevel, setPulseLevel] = useState(0);
  const [listeningHint, setListeningHint] = useState("");
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [voiceLabel, setVoiceLabel] = useState("Sol");
  const [selectedVoice, setSelectedVoice] = useState("random");
  const [speechSpeed, setSpeechSpeed] = useState(1.1);
  const [agentVolume, setAgentVolume] = useState(0.95);
  const [musicVolume, setMusicVolume] = useState(0.18);
  const [micSensitivity, setMicSensitivity] = useState(10);
  const [terminalFeed, setTerminalFeed] = useState(() => [
    buildTerminalEntry("idle", "ready", "4v runtime terminal ready.", { service: FLOW_SLUG }),
  ]);
  const [searchRuntimeState, setSearchRuntimeState] = useState("idle");
  const [searchRuntimeId, setSearchRuntimeId] = useState("AHS-IDLE");
  const [apiMonitor, setApiMonitor] = useState({
    endpoint: "https://travel-parser-live.aahaas.com/v1/voice/suggest",
    status: "idle",
    startedAt: 0,
    elapsedMs: 0,
    lastCompletedMs: 0,
    lastError: "",
    lastHttpState: "",
  });

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
  const callIdRef = useRef("");
  const lastReplyRef = useRef("");
  const packagePrefetchStartedRef = useRef(false);
  const packageWaitPollRef = useRef(0);
  const ambientMusicRef = useRef(null);
  const backgroundPackageMonitorRef = useRef(0);
  const pendingPackagePayloadRef = useRef(null);
  const searchRuntimeIdRef = useRef("AHS-IDLE");
  const apiMonitorTimerRef = useRef(0);

  const callSupported =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (!musicEnabled) {
      destroyAmbientMusic();
      return;
    }

    if (phase === "ringing" || phase === "connecting") {
      initAmbientMusic();
      setAmbientVolume(musicVolume * 0.25, 2.2);
    } else if (phase === "processing") {
      initAmbientMusic();
      setAmbientVolume(musicVolume, 3.2);
    } else if (phase === "assistant-speaking") {
      setAmbientVolume(musicVolume * 0.2, 1.1);
    } else if (phase === "listening") {
      setAmbientVolume(0.001, 0.5);
    } else if (phase === "idle" || phase === "completed" || phase === "ending") {
      destroyAmbientMusic();
    }
  }, [musicEnabled, phase, musicVolume]);

  useEffect(() => {
    return () => {
      autoLoopEnabledRef.current = false;
      if (packageWaitPollRef.current) {
        window.clearTimeout(packageWaitPollRef.current);
      }
      if (backgroundPackageMonitorRef.current) {
        window.clearTimeout(backgroundPackageMonitorRef.current);
      }
      if (apiMonitorTimerRef.current) {
        window.clearInterval(apiMonitorTimerRef.current);
      }
      stopAllAudio();
      stopMicrophone();
      stopSilenceMonitor();
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (mainAudioRef.current) {
      mainAudioRef.current.volume = agentVolume;
    }
  }, [agentVolume]);

  useEffect(() => {
    if (holdAudioRef.current) {
      holdAudioRef.current.volume = Math.max(0.12, musicVolume);
    }
  }, [musicVolume]);

  useEffect(() => {
    if (!error) return;
    appendTerminalEntry("error", "error", error, {
      runtime_id: searchRuntimeIdRef.current,
      phase,
    });
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const activeStates = ["starting", "running", "paused", "waiting_input"];

    if (!apiMonitor.startedAt || !activeStates.includes(apiMonitor.status)) {
      if (apiMonitorTimerRef.current) {
        window.clearInterval(apiMonitorTimerRef.current);
        apiMonitorTimerRef.current = 0;
      }
      return undefined;
    }

    apiMonitorTimerRef.current = window.setInterval(() => {
      setApiMonitor((current) => (
        current.startedAt
          ? { ...current, elapsedMs: Date.now() - current.startedAt }
          : current
      ));
    }, 200);

    return () => {
      if (apiMonitorTimerRef.current) {
        window.clearInterval(apiMonitorTimerRef.current);
        apiMonitorTimerRef.current = 0;
      }
    };
  }, [apiMonitor.startedAt, apiMonitor.status]);

  function appendTerminalEntry(level, state, message, meta = {}) {
    setTerminalFeed((current) => [
      buildTerminalEntry(level, state, message, meta),
      ...current,
    ].slice(0, 18));
  }

  function setRuntimeState(nextState, message, meta = {}) {
    setSearchRuntimeState(nextState);
    appendTerminalEntry(nextState === "error" ? "error" : "info", nextState, message, {
      runtime_id: searchRuntimeIdRef.current,
      ...meta,
    });
  }

  function createSearchRuntimeId() {
    const nextId = `AHS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    searchRuntimeIdRef.current = nextId;
    setSearchRuntimeId(nextId);
    return nextId;
  }

  function updateApiMonitor(status, patch = {}) {
    setApiMonitor((current) => {
      const now = Date.now();
      const nextStartedAt =
        status === "starting"
          ? now
          : patch.resetStart
            ? 0
            : (patch.startedAt ?? current.startedAt);
      const nextElapsed = nextStartedAt ? now - nextStartedAt : 0;

      return {
        ...current,
        status,
        startedAt: nextStartedAt,
        elapsedMs: nextElapsed,
        lastCompletedMs:
          status === "done" || status === "error"
            ? nextElapsed
            : (patch.lastCompletedMs ?? current.lastCompletedMs),
        lastError: patch.lastError ?? current.lastError,
        lastHttpState: patch.lastHttpState ?? current.lastHttpState,
      };
    });
  }

  function isApiSearchActive() {
    return ["starting", "running", "paused"].includes(apiMonitor.status);
  }

  function getAudioContext() {
    if (typeof window === "undefined") return null;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    if (!audioContextRef.current) audioContextRef.current = new Context();
    return audioContextRef.current;
  }

  function playToneSequence(steps) {
    const context = getAudioContext();
    if (!context) return;
    if (context.state === "suspended") context.resume().catch(() => {});
    const startAt = context.currentTime + 0.02;
    steps.reduce((cursor, step) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = step.type || "sine";
      oscillator.frequency.value = step.frequency;
      gain.gain.setValueAtTime(0.0001, cursor);
      gain.gain.exponentialRampToValueAtTime(step.gain || 0.04, cursor + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, cursor + step.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(cursor);
      oscillator.stop(cursor + step.duration + 0.02);
      return cursor + step.duration + (step.gap || 0.04);
    }, startAt);
  }

  function playRingTone() {
    playToneSequence([
      { frequency: 440, duration: 0.35, gap: 0.09, type: "triangle", gain: 0.05 },
      { frequency: 554.37, duration: 0.35, gap: 0.18, type: "triangle", gain: 0.04 },
      { frequency: 440, duration: 0.35, gap: 0.09, type: "triangle", gain: 0.05 },
      { frequency: 659.25, duration: 0.38, type: "triangle", gain: 0.04 },
    ]);
  }

  function playConnectTone() {
    playToneSequence([
      { frequency: 392, duration: 0.15, gap: 0.03, type: "sine" },
      { frequency: 523.25, duration: 0.15, gap: 0.03, type: "sine" },
      { frequency: 659.25, duration: 0.22, type: "sine" },
    ]);
  }

  function playHangupTone() {
    playToneSequence([
      { frequency: 587.33, duration: 0.14, gap: 0.03, type: "triangle" },
      { frequency: 440, duration: 0.14, gap: 0.03, type: "triangle" },
      { frequency: 293.66, duration: 0.22, type: "triangle" },
    ]);
  }

  function playListeningStartTone() {
    playToneSequence([
      { frequency: 783.99, duration: 0.1, gap: 0.03, type: "sine", gain: 0.03 },
      { frequency: 1046.5, duration: 0.12, type: "sine", gain: 0.028 },
    ]);
  }

  function playListeningStopTone() {
    playToneSequence([
      { frequency: 659.25, duration: 0.1, gap: 0.03, type: "triangle", gain: 0.026 },
      { frequency: 523.25, duration: 0.12, type: "triangle", gain: 0.024 },
    ]);
  }

  function initAmbientMusic() {
    if (!musicEnabled || ambientMusicRef.current) return;

    const context = getAudioContext();
    if (!context) return;
    if (context.state === "suspended") context.resume().catch(() => {});

    const audio = new Audio(HOLD_MUSIC_URL);
    audio.loop = true;
    audio.crossOrigin = "anonymous";

    const gainNode = context.createGain();
    gainNode.gain.value = 0.001;

    const source = context.createMediaElementSource(audio);
    source.connect(gainNode);
    gainNode.connect(context.destination);

    ambientMusicRef.current = { audio, gainNode, source };
    audio.play().catch(() => {});
  }

  function setAmbientVolume(target, fadeSec) {
    if (!ambientMusicRef.current) return;
    const context = audioContextRef.current;
    if (!context) return;

    const { gainNode } = ambientMusicRef.current;
    const now = context.currentTime;
    const current = gainNode.gain.value;

    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(Math.max(current, 0.001), now);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(target, 0.001), now + fadeSec);
  }

  function destroyAmbientMusic() {
    if (!ambientMusicRef.current) return;
    const { audio, gainNode } = ambientMusicRef.current;
    const context = audioContextRef.current;

    if (context && gainNode) {
      const now = context.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(Math.max(gainNode.gain.value, 0.001), now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.6);
      window.setTimeout(() => {
        audio.pause();
        audio.src = "";
      }, 1700);
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
    if (mainAudioUrlRef.current) {
      URL.revokeObjectURL(mainAudioUrlRef.current);
      mainAudioUrlRef.current = "";
    }
    if (holdAudioRef.current) {
      holdAudioRef.current.pause();
      holdAudioRef.current.currentTime = 0;
      holdAudioRef.current = null;
    }
    if (holdAudioUrlRef.current) {
      URL.revokeObjectURL(holdAudioUrlRef.current);
      holdAudioUrlRef.current = "";
    }
    if (holdMusicTimerRef.current) {
      window.clearInterval(holdMusicTimerRef.current);
      holdMusicTimerRef.current = 0;
    }
    destroyAmbientMusic();
  }

  async function playAgentAudio(audioUrl, onEnded) {
    if (mainAudioRef.current) mainAudioRef.current.pause();
    const audio = new Audio(audioUrl);
    audio.volume = agentVolume;
    mainAudioRef.current = audio;
    mainAudioUrlRef.current = audioUrl;
    setPhase("assistant-speaking");

    audio.onended = () => {
      if (mainAudioUrlRef.current) {
        URL.revokeObjectURL(mainAudioUrlRef.current);
        mainAudioUrlRef.current = "";
      }
      if (mainAudioRef.current === audio) mainAudioRef.current = null;
      onEnded?.();
    };

    await audio.play();
  }

  async function playHoldAudioLoop() {
    if (!holdAudioUrlRef.current) return;
    if (holdAudioRef.current) holdAudioRef.current.pause();
    const audio = new Audio(holdAudioUrlRef.current);
    audio.volume = Math.max(0.12, musicVolume);
    holdAudioRef.current = audio;
    await audio.play().catch(() => {
      holdAudioRef.current = null;
    });
  }

  function stopHoldAudioLoop() {
    if (holdAudioRef.current) {
      holdAudioRef.current.pause();
      holdAudioRef.current.currentTime = 0;
      holdAudioRef.current = null;
    }
  }

  function resetState() {
    autoLoopEnabledRef.current = false;
    finalizingRef.current = false;
    packagePrefetchStartedRef.current = false;
    if (packageWaitPollRef.current) {
      window.clearTimeout(packageWaitPollRef.current);
      packageWaitPollRef.current = 0;
    }
    if (backgroundPackageMonitorRef.current) {
      window.clearTimeout(backgroundPackageMonitorRef.current);
      backgroundPackageMonitorRef.current = 0;
    }
    pendingPackagePayloadRef.current = null;
    stopAllAudio();
    stopMicrophone();
    stopSilenceMonitor();
    callIdRef.current = "";
    lastReplyRef.current = "";
    setCallId("");
    setCallStatus("Ready to start 4v ChatGPT ASSIS.");
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
    setVoiceLabel(formatVoiceLabel(selectedVoice));
    searchRuntimeIdRef.current = "AHS-IDLE";
    setSearchRuntimeId("AHS-IDLE");
    setSearchRuntimeState("idle");
    setApiMonitor({
      endpoint: "https://travel-parser-live.aahaas.com/v1/voice/suggest",
      status: "idle",
      startedAt: 0,
      elapsedMs: 0,
      lastCompletedMs: 0,
      lastError: "",
      lastHttpState: "",
    });
    setTerminalFeed([
      buildTerminalEntry("idle", "ready", "4v runtime terminal reset.", { service: FLOW_SLUG }),
    ]);
  }

  async function handleStartCall() {
    if (!callSupported || phase !== "idle") return;

    try {
      autoLoopEnabledRef.current = true;
      setError("");
      setCallEnded(false);
      const runtimeId = createSearchRuntimeId();
      setRuntimeState("start", "Aahaas session boot started.", { runtime_id: runtimeId });
      setPhase("ringing");
      setCallStatus("Calling Aahaas. Please wait while we connect the assistant.");
      playRingTone();

      await new Promise((resolve) => window.setTimeout(resolve, 1600));
      setPhase("connecting");
      setCallStatus("Connecting you to 4v ChatGPT ASSIS now...");
      setRuntimeState("running", "Voice session connecting to Aahaas runtime.", { phase: "connecting" });
      playConnectTone();

      const response = await fetch(`${API_BASE_URL}/${FLOW_SLUG}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice: selectedVoice, speech_speed: speechSpeed }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "4v ChatGPT ASSIS session could not start.");

      callIdRef.current = data.call_id || "";
      lastReplyRef.current = data.greeting || "";
      setCallId(data.call_id || "");
      setLastReply(data.greeting || "");
      setConversation(data.greeting ? [{ role: "assistant", content: data.greeting }] : []);
      setCallStatus("Connected. The AI receptionist is greeting you.");
      setVoiceLabel(formatVoiceLabel(data.voice_label || selectedVoice));
      setRuntimeState("running", "Aahaas runtime connected and greeting started.", {
        call_id: data.call_id || "",
        voice: data.voice_label || selectedVoice,
      });

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
      setRuntimeState("error", "Aahaas session start failed.", { phase: "idle" });
    }
  }

  async function beginListening() {
    if (!callIdRef.current || !autoLoopEnabledRef.current || finalizingRef.current) return;

    if (pendingPackagePayloadRef.current) {
      await presentQueuedPackagePayload();
      return;
    }

    try {
      const profile = inferListeningProfile(lastReplyRef.current);
      setPhase("listening");
      setCallStatus("Listening for your answer now.");
      setListeningHint(profile.hint);
      setRuntimeState("paused", "Runtime paused for customer speech input.", { phase: "listening" });
      if (!isApiSearchActive()) {
        updateApiMonitor("waiting_input", { lastHttpState: "waiting_input", lastError: "" });
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      recordedChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) recordedChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        playListeningStopTone();
        const audioBlob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        recordedChunksRef.current = [];
        stopMicrophone();
        if (audioBlob.size === 0 || !autoLoopEnabledRef.current) return;

        if (!speakingDetectedRef.current) {
          await sendSilenceNudge();
          return;
        }

        await sendTurn(audioBlob);
      };

      recorder.start(250);
      playListeningStartTone();
      startSilenceMonitor(stream, recorder, profile);
    } catch (err) {
      setError(err.message || "Microphone access failed.");
      setCallStatus("Microphone access is required for the call.");
      setPhase("idle");
      setRuntimeState("error", "Microphone access failed for runtime input.", { phase: "idle" });
      updateApiMonitor("error", { lastError: err.message || "Microphone access failed.", lastHttpState: "mic_error" });
    }
  }

  function startSilenceMonitor(stream, recorder, profile) {
    stopSilenceMonitor();
    captureElapsedMsRef.current = 0;

    const context = getAudioContext();
    if (!context) {
      window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, profile.maxRecordMs);
      return;
    }

    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    analyserRef.current = analyser;
    sourceNodeRef.current = source;
    speakingDetectedRef.current = false;
    silenceMsRef.current = 0;

    const samples = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!analyserRef.current || recorder.state !== "recording") return;
      analyserRef.current.getByteFrequencyData(samples);
      const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      setPulseLevel(Math.min(1, average / 80));
      captureElapsedMsRef.current += 120;

      if (average > micSensitivity) {
        speakingDetectedRef.current = true;
        silenceMsRef.current = 0;
      } else {
        silenceMsRef.current += 120;
      }

      if (captureElapsedMsRef.current >= profile.maxRecordMs) {
        recorder.stop();
        return;
      }
      if (speakingDetectedRef.current && silenceMsRef.current >= profile.postSpeechSilenceMs) {
        recorder.stop();
        return;
      }

      silenceMonitorRef.current = window.setTimeout(tick, 120);
    };

    tick();
  }

  function stopSilenceMonitor() {
    if (silenceMonitorRef.current) {
      window.clearTimeout(silenceMonitorRef.current);
      silenceMonitorRef.current = 0;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    setPulseLevel(0);
    setListeningHint("");
  }

  function stopMicrophone() {
    stopSilenceMonitor();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  async function sendSilenceNudge() {
    if (!callIdRef.current || !autoLoopEnabledRef.current) return;

    try {
      setPhase("processing");
      setCallStatus("Checking if you are still there...");
      setRuntimeState("running", "Runtime is checking silent input state.", { phase: "processing" });

      const formData = new FormData();
      formData.append("call_id", callIdRef.current);
      formData.append("transcript", "__silent__");

      const response = await fetch(`${API_BASE_URL}/${FLOW_SLUG}/turn`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.audio_base64) {
        if (autoLoopEnabledRef.current) await beginListening();
        return;
      }

      setVoiceLabel(formatVoiceLabel(data.voice_label));
      const replyUrl = createAudioUrlFromBase64(data.audio_base64, data.audio_mime_type);
      await playAgentAudio(replyUrl, async () => {
        if (autoLoopEnabledRef.current) await beginListening();
      });
    } catch {
      setRuntimeState("error", "Silent input check failed; returning to listening state.");
      if (autoLoopEnabledRef.current) await beginListening();
    }
  }

  async function startPackagePrefetch() {
    if (!callIdRef.current || packagePrefetchStartedRef.current) return;

    packagePrefetchStartedRef.current = true;
    setRuntimeState("start", "Aahaas API product search queued.", {
      call_id: callIdRef.current,
    });
    updateApiMonitor("starting", { lastHttpState: "queued", lastError: "" });

    try {
      await fetch(`${API_BASE_URL}/${FLOW_SLUG}/package-prefetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callIdRef.current }),
      });
      setRuntimeState("running", "Aahaas API product search request sent.", {
        call_id: callIdRef.current,
      });
      updateApiMonitor("running", { lastHttpState: "prefetch_sent", lastError: "" });
      startBackgroundPackageMonitor();
    } catch {
      packagePrefetchStartedRef.current = false;
      setRuntimeState("error", "Aahaas API product search request failed to start.", {
        call_id: callIdRef.current,
      });
      updateApiMonitor("error", { lastError: "Product search request failed to start.", lastHttpState: "prefetch_error" });
    }
  }

  function canInterruptForPackagePresentation() {
    const recorderState = mediaRecorderRef.current?.state || "";

    return (
      recorderState !== "recording" &&
      phase !== "assistant-speaking" &&
      phase !== "ringing" &&
      phase !== "connecting" &&
      phase !== "ending"
    );
  }

  function applyPackagePayloadToState(data) {
    stopHoldAudioLoop();
    setConversation(data.conversation || []);
    setCustomerProfile(data.customer_profile || {});
    setServiceCategories(data.service_categories || []);
    lastReplyRef.current = data.reply || "";
    setLastReply(data.reply || "");
    setVoiceLabel(formatVoiceLabel(data.voice_label));
  }

  async function presentQueuedPackagePayload() {
    const data = pendingPackagePayloadRef.current;

    if (!data) return;

    pendingPackagePayloadRef.current = null;
    applyPackagePayloadToState(data);

    const replyUrl = createAudioUrlFromBase64(data.audio_base64, data.audio_mime_type);
    await playAgentAudio(replyUrl, async () => {
      if (data.failed) {
        setCallStatus("Package search had a problem. The assistant is continuing the conversation.");
        if (autoLoopEnabledRef.current) await beginListening();
        return;
      }

      if (data.should_end) {
        autoLoopEnabledRef.current = false;
        setCallEnded(true);
        setCallStatus("The call has ended.");
        setPhase("completed");
        return;
      }

      if (autoLoopEnabledRef.current) await beginListening();
    });
  }

  function startBackgroundPackageMonitor() {
    if (!callIdRef.current) return;

    if (backgroundPackageMonitorRef.current) {
      window.clearTimeout(backgroundPackageMonitorRef.current);
      backgroundPackageMonitorRef.current = 0;
    }

    const poll = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/${FLOW_SLUG}/package-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ call_id: callIdRef.current }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "Could not check package status.");

        if (!data.ready && !data.failed) {
          setRuntimeState("paused", "Aahaas API search is still pending in background.", {
            call_id: callIdRef.current,
            api_state: data.package_lookup_status || "pending",
          });
          updateApiMonitor("paused", { lastHttpState: data.package_lookup_status || "pending", lastError: "" });
          backgroundPackageMonitorRef.current = window.setTimeout(poll, 3500);
          return;
        }

        setRuntimeState(data.failed ? "error" : "done", data.failed
          ? "Aahaas API background search returned an error state."
          : "Aahaas API background search completed successfully.", {
          call_id: callIdRef.current,
          api_state: data.package_lookup_status || "",
        });
        updateApiMonitor(data.failed ? "error" : "done", {
          lastError: data.failed ? (data.package_lookup_error || "Aahaas API returned an error state.") : "",
          lastHttpState: data.package_lookup_status || (data.failed ? "failed" : "done"),
        });

        if (canInterruptForPackagePresentation()) {
          pendingPackagePayloadRef.current = data;
          await presentQueuedPackagePayload();
          return;
        }

        pendingPackagePayloadRef.current = data;
        setRuntimeState(data.failed ? "error" : "done", data.failed
          ? "Aahaas API result queued after error state."
          : "Aahaas API result is ready and queued for the next safe playback moment.", {
          call_id: callIdRef.current,
        });
      } catch (err) {
        setError(err.message);
        setRuntimeState("error", "Aahaas API background polling failed.", { call_id: callIdRef.current });
        updateApiMonitor("error", { lastError: err.message, lastHttpState: "poll_error" });
      }
    };

    backgroundPackageMonitorRef.current = window.setTimeout(poll, 3500);
  }

  async function waitForPackageResult() {
    if (!callIdRef.current || finalizingRef.current) return;

    try {
      setPhase("processing");
      setCallStatus("Waiting for Aahaas product options. Please hold for a moment.");
      setRuntimeState("running", "Aahaas API search is running.", {
        call_id: callIdRef.current,
        phase: "processing",
      });
      await playHoldAudioLoop();

      const poll = async () => {
        const response = await fetch(`${API_BASE_URL}/${FLOW_SLUG}/package-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ call_id: callIdRef.current }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "Could not check package status.");

        if (!data.ready && !data.failed) {
          setRuntimeState("paused", "Aahaas API search is still pending.", {
            call_id: callIdRef.current,
            api_state: data.package_lookup_status || "pending",
          });
          packageWaitPollRef.current = window.setTimeout(() => {
            poll().catch(async (err) => {
              stopHoldAudioLoop();
              setError(err.message);
              setRuntimeState("error", "Aahaas API polling failed.", { call_id: callIdRef.current });
              if (autoLoopEnabledRef.current) await beginListening();
            });
          }, 2500);
          return;
        }

        if (packageWaitPollRef.current) {
          window.clearTimeout(packageWaitPollRef.current);
          packageWaitPollRef.current = 0;
        }

        stopHoldAudioLoop();
        setConversation(data.conversation || []);
        setCustomerProfile(data.customer_profile || {});
        setServiceCategories(data.service_categories || []);
        lastReplyRef.current = data.reply || "";
        setLastReply(data.reply || "");
        setVoiceLabel(formatVoiceLabel(data.voice_label));
        setRuntimeState(data.failed ? "error" : "done", data.failed
          ? "Aahaas API returned an error state."
          : "Aahaas API search completed successfully.", {
          call_id: callIdRef.current,
          api_state: data.package_lookup_status || "",
        });

        const replyUrl = createAudioUrlFromBase64(data.audio_base64, data.audio_mime_type);
        await playAgentAudio(replyUrl, async () => {
          if (data.failed) {
            setCallStatus("Package search had a problem. The assistant is continuing the conversation.");
            if (autoLoopEnabledRef.current) await beginListening();
            return;
          }

          if (data.should_end) {
            autoLoopEnabledRef.current = false;
            setCallEnded(true);
            setCallStatus("The call has ended.");
            setPhase("completed");
            return;
          }

          if (autoLoopEnabledRef.current) await beginListening();
        });
      };

      await poll();
    } catch (err) {
      stopHoldAudioLoop();
      setError(err.message);
      setCallStatus("We could not finish checking the Aahaas package yet.");
      setRuntimeState("error", "Aahaas API wait cycle failed.", { call_id: callIdRef.current });
      if (autoLoopEnabledRef.current) await beginListening();
    }
  }

  async function sendTurn(audioBlob, transcriptText = "") {
    try {
      setPhase("processing");
      setCallStatus("Aahaas is reviewing the request and preparing the next question.");
      setRuntimeState("running", "Runtime is processing customer request.", {
        call_id: callIdRef.current,
        phase: "processing",
      });

      const formData = new FormData();
      formData.append("call_id", callIdRef.current);
      if (audioBlob) formData.append("audio", audioBlob, "4v-chatgpt-assis.webm");
      if (transcriptText.trim()) formData.append("transcript", transcriptText.trim());

      const response = await fetch(`${API_BASE_URL}/${FLOW_SLUG}/turn`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "4v ChatGPT ASSIS reply failed.");

      setLastTranscript(data.transcript || "");
      lastReplyRef.current = data.reply || "";
      setLastReply(data.reply || "");
      setTestMessage("");
      setConversation(data.conversation || []);
      setCustomerProfile(data.customer_profile || {});
      setServiceCategories(data.service_categories || []);
      setLiveSummary(data.live_summary || "");
      setVoiceLabel(formatVoiceLabel(data.voice_label));
      setRuntimeState("running", "Runtime received turn result from Aahaas flow.", {
        call_id: callIdRef.current,
        api_state: data.package_lookup_status || "none",
      });

      if (data.package_lookup_status === "queued") {
        startPackagePrefetch();
      }

      const replyUrl = createAudioUrlFromBase64(data.audio_base64, data.audio_mime_type);
      await playAgentAudio(replyUrl, async () => {
        if (data.should_end) {
          await finalizeCall(data.ended_reason || "completed_by_assistant");
          return;
        }
        if (autoLoopEnabledRef.current) await beginListening();
      });
    } catch (err) {
      stopHoldAudioLoop();
      setError(err.message);
      setCallStatus("There was a temporary issue, but the call is still open. Please continue when you are ready.");
      setPhase("connected");
      setRuntimeState("error", "Runtime turn processing failed.", { call_id: callIdRef.current });
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
      setRuntimeState("stop", "Runtime is finalizing booking and closing session.", {
        call_id: callIdRef.current,
      });

      const response = await fetch(`${API_BASE_URL}/${FLOW_SLUG}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callIdRef.current, ended_reason: endedReason }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Call report could not be created.");

      setFinalReport(data.report || null);
      setServiceCategories(data.report?.service_categories || serviceCategories);
      setCustomerProfile(data.report?.customer_profile || customerProfile);
      setVoiceLabel(formatVoiceLabel(data.voice_label));
      setCallEnded(true);
      setCallStatus("The call has ended and the report was created successfully.");
      setRuntimeState("done", "Runtime completed and final report saved.", {
        call_id: callIdRef.current,
      });
      playHangupTone();

      const closingUrl = createAudioUrlFromBase64(data.audio_base64, data.audio_mime_type);
      await playAgentAudio(closingUrl, () => {
        setPhase("completed");
      });
    } catch (err) {
      setError(err.message);
      setCallStatus("The live call ended, but the final report could not be saved yet.");
      setPhase("completed");
      setRuntimeState("error", "Runtime finished with report save failure.", {
        call_id: callIdRef.current,
      });
    } finally {
      finalizingRef.current = false;
    }
  }

  async function handleHangUp() {
    if (!callId) {
      resetState();
      return;
    }

    const activeTravelCall = serviceCategories.some(isTravelServiceCategory);
    const packageState = customerProfile.package_state || "";

    if (activeTravelCall && !["accepted", "api_unavailable"].includes(packageState) && !finalizingRef.current) {
      await sendTurn(null, "I would like to end the call now. Please confirm the recommended package first.");
      return;
    }

    await finalizeCall("manual_hangup");
  }

  const profileFields = [
    ["WhatsApp", customerProfile.whatsapp_number],
    ["Email", customerProfile.email_address],
    ["Country", customerProfile.current_living_country],
    ["Travelers", customerProfile.traveler_count || customerProfile.number_of_travelers],
    ["Duration", customerProfile.stay_length || customerProfile.number_of_days],
    ["Hotel class", customerProfile.hotel_rating_preference || customerProfile.hotel_category],
    ["Date plan", customerProfile.travel_date_range || customerProfile.planned_travel_date_range],
  ];

  const packageStatusLabel = getPackageStatusLabel(customerProfile);
  const packageIssue = customerProfile.package_lookup_error || "";
  const searchingProduct = isProductSearching(customerProfile) || phase === "processing";

  return (
    <div className="panel reception-panel">
      <div className="reception-backdrop" />
      <div className="panel-header reception-header">
        <div>
          <p className="eyebrow">OpenAI Voice</p>
          <h2>4v ChatGPT ASSIS</h2>
          <p className="panel-copy reception-copy">
            This is the cloned Aahaas product search flow. It keeps the conversation short,
            searches the best fitting Aahaas package or product first, and asks for changes only after the summary.
          </p>
        </div>
        <span className="call-badge reception-badge">Home page flow</span>
      </div>

      <div className="reception-switch-row">
        <label className="reception-switch">
          <input
            type="checkbox"
            checked={musicEnabled}
            onChange={(event) => setMusicEnabled(event.target.checked)}
          />
          <span>Background music</span>
        </label>
        <label className="reception-voice-picker">
          <span>Voice agent</span>
          <select
            value={selectedVoice}
            onChange={(event) => {
              setSelectedVoice(event.target.value);
              if (!callId) setVoiceLabel(formatVoiceLabel(event.target.value));
            }}
            disabled={phase !== "idle"}
          >
            {OPENAI_VOICE_OPTIONS.map((voice) => (
              <option key={voice} value={voice}>
                {formatVoiceLabel(voice)}
              </option>
            ))}
          </select>
        </label>
        <label className="reception-slider-control">
          <span>Voice speed {speechSpeed.toFixed(2)}x</span>
          <input
            type="range"
            min="0.8"
            max="1.5"
            step="0.05"
            value={speechSpeed}
            onChange={(event) => setSpeechSpeed(Number(event.target.value))}
            disabled={phase !== "idle"}
          />
        </label>
        <label className="reception-slider-control">
          <span>Output volume {Math.round(agentVolume * 100)}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={agentVolume}
            onChange={(event) => setAgentVolume(Number(event.target.value))}
          />
        </label>
        <label className="reception-slider-control">
          <span>Music level {Math.round(musicVolume * 100)}%</span>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            value={musicVolume}
            onChange={(event) => setMusicVolume(Number(event.target.value))}
          />
        </label>
        <label className="reception-slider-control">
          <span>Mic sensitivity {micSensitivity}</span>
          <input
            type="range"
            min="6"
            max="20"
            step="1"
            value={micSensitivity}
            onChange={(event) => setMicSensitivity(Number(event.target.value))}
          />
        </label>
        <div className="reception-inline-meta">
          <span className="reception-mini-chip">Voice: {voiceLabel}</span>
          <span className="reception-mini-chip">OpenAI voice agent</span>
          <span className="reception-mini-chip">Defaults: 2 pax, 3-star, 3 days, +7 days</span>
        </div>
      </div>

      <div className="reception-stage">
        <div className={`call-orb phase-${phase}`}>
          <div className="call-orb-core" style={{ transform: `scale(${1 + pulseLevel * 0.3})` }} />
          <div className="call-orb-ring ring-one" />
          <div className="call-orb-ring ring-two" />
          <div className="call-orb-ring ring-three" />
        </div>
        <div className="reception-status">
          <span>Call status</span>
          <strong>{callStatus}</strong>
          <p>{callId ? `Call ID: ${callId}` : "A new call ID will be generated automatically."}</p>
          {listeningHint ? <p>{listeningHint}</p> : null}
        </div>
      </div>

      <div className="reception-controls">
        <button
          type="button"
          className="primary-button reception-call-button"
          onClick={handleStartCall}
          disabled={!callSupported || phase !== "idle"}
        >
          Start call
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={handleHangUp}
          disabled={!callId || phase === "ending" || phase === "completed"}
        >
          End call
        </button>
        <button type="button" className="secondary-button" onClick={resetState}>
          Reset
        </button>
      </div>

      {!callSupported ? (
        <p className="error-text">This browser does not support microphone recording for 4v ChatGPT ASSIS.</p>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}

      <div className="reception-grid">
        <div className="reception-card">
          <span>Latest transcript</span>
          <p>{lastTranscript || "The customer speech transcript will appear here during the call."}</p>
        </div>
        <div className="reception-card">
          <span>Assistant reply</span>
          <p>{lastReply || "The assistant greeting and next smart question will appear here."}</p>
        </div>
        <div className="reception-card">
          <span>Live summary</span>
          <p>{liveSummary || "The intake summary will build while the assistant understands the request."}</p>
        </div>
      </div>

      <div className={`trip-summary-card reception-search-card ${searchingProduct ? "reception-search-card-active" : ""}`}>
        <span>Aahaas product search</span>
        <div className="reception-search-row">
          <div className="reception-search-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p>
            {getRuntimeSearchMessage(searchRuntimeState)}
          </p>
        </div>
      </div>

      <div className={`trip-summary-card api-monitor-card api-monitor-${apiMonitor.status}`}>
        <div className="api-monitor-head">
          <span>Aahaas API Monitor</span>
          <strong>{apiMonitor.status}</strong>
        </div>
        <p className="api-monitor-endpoint">{apiMonitor.endpoint}</p>
        <div className="api-monitor-grid">
          <p><strong>Current:</strong> {apiMonitor.status}</p>
          <p><strong>Elapsed:</strong> {formatElapsedMs(apiMonitor.elapsedMs)}</p>
          <p><strong>Last Result:</strong> {formatElapsedMs(apiMonitor.lastCompletedMs)}</p>
          <p><strong>HTTP/State:</strong> {apiMonitor.lastHttpState || "idle"}</p>
        </div>
        {apiMonitor.lastError ? (
          <p className="api-monitor-error"><strong>Last error:</strong> {apiMonitor.lastError}</p>
        ) : null}
      </div>

      <div className={`trip-summary-card terminal-card terminal-state-${searchRuntimeState}`}>
        <div className="terminal-card-head">
          <span>Aahaas Runtime Terminal</span>
          <strong>{searchRuntimeId}</strong>
        </div>
        <div className="terminal-card-subhead">
          <span>Current state</span>
          <strong>{searchRuntimeState}</strong>
        </div>
        <div className="terminal-log" aria-live="polite">
          {terminalFeed.map((entry) => (
            <article key={entry.id} className={`terminal-line terminal-line-${entry.level}`}>
              <span className="terminal-time">{entry.timestamp}</span>
              <span className="terminal-state">{entry.state}</span>
              <p>{entry.message}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="trip-summary-card reception-test-card">
        <span>Quick test chat</span>
        <p>Use this text box if you want to simulate caller answers without the microphone.</p>
        <div className="reception-test-row">
          <input
            className="records-search reception-test-input"
            value={testMessage}
            onChange={(event) => setTestMessage(event.target.value)}
            placeholder="Type a caller answer for testing..."
          />
          <button
            type="button"
            className="primary-button"
            onClick={handleSendTestMessage}
            disabled={!callId || !testMessage.trim() || phase === "processing" || phase === "ending"}
          >
            Send test reply
          </button>
        </div>
      </div>

      <div className="reception-columns">
        <div className="conversation-log reception-log" aria-live="polite">
          {conversation.length === 0 ? (
            <p className="empty-state">
              Start the call and the assistant will search the best matching Aahaas package or
              product first, then ask only whether anything needs to change.
            </p>
          ) : (
            conversation.map((message, index) => (
              <article
                key={`${message.role}-chatgpt3v-${index}`}
                className={`message-bubble message-${message.role}`}
              >
                <span>{message.role === "assistant" ? "AI assistant" : "Caller"}</span>
                <p>{message.content}</p>
              </article>
            ))
          )}
        </div>

        <div className="reception-side">
          <div className="trip-summary-card">
            <span>Customer information</span>
            {profileFields.map(([label, value]) => (
              <p key={label}>
                <strong>{label}:</strong> {formatProfileValue(value)}
              </p>
            ))}
          </div>
          <div className="trip-summary-card">
            <span>Detected service categories</span>
            <p>{serviceCategories.length > 0 ? serviceCategories.join(", ") : "No category confirmed yet."}</p>
          </div>
          <div className="trip-summary-card">
            <span>Aahaas package status</span>
            <p>{packageStatusLabel}</p>
            {customerProfile.travel_package_prompt ? (
              <p>
                <strong>Prompt:</strong> {customerProfile.travel_package_prompt}
              </p>
            ) : null}
            {packageIssue ? (
              <p>
                <strong>Issue:</strong> {packageIssue}
              </p>
            ) : null}
          </div>
          {customerProfile.suggested_package ? (
            <div className="trip-summary-card">
              <span>Suggested package</span>
              <pre className="records-pre">{formatDebugJson(customerProfile.suggested_package)}</pre>
            </div>
          ) : null}
          {finalReport ? (
            <div className="trip-summary-card reception-report-card">
              <span>Final call report</span>
              <pre className="records-pre">{formatDebugJson(finalReport)}</pre>
            </div>
          ) : null}
        </div>
      </div>

      {callEnded ? (
        <p className="reception-finish-note">
          The assistant has ended the call and stored the report for this customer request.
        </p>
      ) : null}
    </div>
  );
}
