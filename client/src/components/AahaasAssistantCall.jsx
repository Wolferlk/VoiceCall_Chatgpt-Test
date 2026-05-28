import { useEffect, useRef, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_LARAVEL_API_BASE_URL || "http://localhost:8000/api";

function createAudioUrlFromBase64(base64, mimeType) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType || "audio/mpeg" });
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

function isTravelServiceCategory(category) {
  return [
    "AI Travel Planning",
    "Flight Booking",
    "Hotel Reservations",
    "Tours and Activities",
    "Transportation Services",
    "Group Travel Planning",
  ].includes(category);
}

function inferListeningProfile(questionText) {
  const normalized = String(questionText || "").toLowerCase();

  if (normalized.includes("full name") || normalized.includes("your full name")) {
    return { maxRecordMs: 10000, postSpeechSilenceMs: 2400, hint: "Mic ready. Say your full name clearly." };
  }
  if (normalized.includes("contact number") || normalized.includes("phone")) {
    return { maxRecordMs: 14000, postSpeechSilenceMs: 2800, hint: "Mic ready. Say the phone number clearly." };
  }
  if (normalized.includes("email")) {
    return { maxRecordMs: 18000, postSpeechSilenceMs: 3000, hint: "Mic ready. Say the email slowly, letter by letter if needed." };
  }
  if (normalized.includes("country") || normalized.includes("location")) {
    return { maxRecordMs: 10000, postSpeechSilenceMs: 2400, hint: "Mic ready. Say your country or city." };
  }
  if (normalized.includes("booking id") || normalized.includes("reference number")) {
    return { maxRecordMs: 14000, postSpeechSilenceMs: 2800, hint: "Mic ready. Say the booking ID clearly." };
  }
  if (
    normalized.includes("package is okay") ||
    normalized.includes("okay for you") ||
    normalized.includes("is this package okay")
  ) {
    return { maxRecordMs: 12000, postSpeechSilenceMs: 2600, hint: "Mic ready. Say yes, or explain what to change." };
  }
  if (
    normalized.includes("what needs to change") ||
    normalized.includes("what need to change") ||
    normalized.includes("special request") ||
    normalized.includes("preferences")
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
  if (normalized.includes("help") || normalized.includes("assist") || normalized.includes("today")) {
    // Opening question — give the most time so customer can explain freely
    return { maxRecordMs: 25000, postSpeechSilenceMs: 3500, hint: "Mic ready. Please tell us how we can help you." };
  }
  return { maxRecordMs: 18000, postSpeechSilenceMs: 3000, hint: "Mic ready. Please go ahead." };
}

export default function AahaasAssistantCall() {
  const [callId, setCallId] = useState("");
  const [callStatus, setCallStatus] = useState("Ready to call the Aahaas AI assistant.");
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
  // Refs that mirror state so async callbacks always see the latest value (avoids stale closure)
  const callIdRef = useRef("");
  const lastReplyRef = useRef("");

  const callSupported =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    currentPhaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    return () => {
      autoLoopEnabledRef.current = false;
      stopAllAudio();
      stopMicrophone();
      stopSilenceMonitor();
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

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

  function playHoldMusicPhrase() {
    playToneSequence([
      { frequency: 261.63, duration: 0.38, gap: 0.08, type: "sine", gain: 0.01 },
      { frequency: 329.63, duration: 0.38, gap: 0.08, type: "sine", gain: 0.01 },
      { frequency: 392, duration: 0.52, gap: 0.12, type: "sine", gain: 0.01 },
      { frequency: 329.63, duration: 0.34, gap: 0.08, type: "sine", gain: 0.009 },
    ]);
  }

  function startHoldMusicLoop() {
    stopHoldMusicLoop();
    playHoldMusicPhrase();
    holdMusicTimerRef.current = window.setInterval(() => {
      playHoldMusicPhrase();
    }, 2500);
  }

  function stopHoldMusicLoop() {
    if (holdMusicTimerRef.current) {
      window.clearInterval(holdMusicTimerRef.current);
      holdMusicTimerRef.current = 0;
    }
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
    stopHoldMusicLoop();
  }

  async function playAgentAudio(audioUrl, onEnded) {
    if (mainAudioRef.current) mainAudioRef.current.pause();
    const audio = new Audio(audioUrl);
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
    if (!holdAudioUrlRef.current) {
      startHoldMusicLoop();
      return;
    }
    if (holdAudioRef.current) holdAudioRef.current.pause();
    const audio = new Audio(holdAudioUrlRef.current);
    audio.volume = 0.8;
    holdAudioRef.current = audio;
    startHoldMusicLoop();
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
    stopHoldMusicLoop();
  }

  function resetState() {
    autoLoopEnabledRef.current = false;
    finalizingRef.current = false;
    stopAllAudio();
    stopMicrophone();
    stopSilenceMonitor();
    callIdRef.current = "";
    lastReplyRef.current = "";
    setCallId("");
    setCallStatus("Ready to call the Aahaas AI assistant.");
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
  }

  async function handleStartCall() {
    if (!callSupported || phase !== "idle") return;

    try {
      autoLoopEnabledRef.current = true;
      setError("");
      setCallEnded(false);
      setPhase("ringing");
      setCallStatus("Calling Aahaas. Please wait while we connect your call.");
      playRingTone();

      await new Promise((resolve) => window.setTimeout(resolve, 1600));
      setPhase("connecting");
      setCallStatus("Connecting you to the Aahaas AI assistant now...");
      playConnectTone();

      const response = await fetch(`${API_BASE_URL}/aahaas-call/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Aahaas call session could not start.");

      callIdRef.current = data.call_id || "";
      lastReplyRef.current = data.greeting || "";
      setCallId(data.call_id || "");
      setLastReply(data.greeting || "");
      setConversation(data.greeting ? [{ role: "assistant", content: data.greeting }] : []);
      setCallStatus("Connected. The Aahaas assistant is greeting you.");

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
    }
  }

  async function beginListening() {
    if (!callIdRef.current || !autoLoopEnabledRef.current || finalizingRef.current) return;

    try {
      const profile = inferListeningProfile(lastReplyRef.current);
      setPhase("listening");
      setCallStatus("Listening for your answer now.");
      setListeningHint(profile.hint);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

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

        // If the microphone captured no actual speech, ask gently instead of sending silence to the API
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
      setCallStatus("Microphone access is required for the continuous call.");
      setPhase("idle");
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

      if (average > 10) {
        speakingDetectedRef.current = true;
        silenceMsRef.current = 0;
      } else if (speakingDetectedRef.current) {
        silenceMsRef.current += 120;
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

      const formData = new FormData();
      formData.append("call_id", callIdRef.current);
      formData.append("transcript", "__silent__");

      const response = await fetch(`${API_BASE_URL}/aahaas-call/turn`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.audio_base64) {
        // Network issue — just restart listening quietly
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

  async function sendTurn(audioBlob, transcriptText = "") {
    try {
      setPhase("processing");
      setCallStatus("Aahaas is reviewing your request and preparing the next question.");
      await playHoldAudioLoop();

      const formData = new FormData();
      formData.append("call_id", callIdRef.current);
      if (audioBlob) formData.append("audio", audioBlob, "aahaas-call.webm");
      if (transcriptText.trim()) formData.append("transcript", transcriptText.trim());

      const response = await fetch(`${API_BASE_URL}/aahaas-call/turn`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Aahaas call reply failed.");

      stopHoldAudioLoop();
      setLastTranscript(data.transcript || "");
      lastReplyRef.current = data.reply || "";
      setLastReply(data.reply || "");
      setTestMessage("");
      setConversation(data.conversation || []);
      setCustomerProfile(data.customer_profile || {});
      setServiceCategories(data.service_categories || []);
      setLiveSummary(data.live_summary || "");

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

      const response = await fetch(`${API_BASE_URL}/aahaas-call/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callIdRef.current, ended_reason: endedReason }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Call report could not be created.");

      setFinalReport(data.report || null);
      setServiceCategories(data.report?.service_categories || serviceCategories);
      setCustomerProfile(data.report?.customer_profile || customerProfile);
      setCallEnded(true);
      setCallStatus("The call has ended and the report was created successfully.");
      playHangupTone();

      const closingUrl = createAudioUrlFromBase64(data.audio_base64, data.audio_mime_type);
      await playAgentAudio(closingUrl, () => {
        setPhase("completed");
      });
    } catch (err) {
      setError(err.message);
      setCallStatus("The live call ended, but the final report could not be saved yet.");
      setPhase("completed");
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

    if (
      activeTravelCall &&
      !["accepted", "api_unavailable"].includes(packageState) &&
      !finalizingRef.current
    ) {
      await sendTurn(null, "I would like to end the call now. Please confirm the recommended package first.");
      return;
    }

    await finalizeCall("manual_hangup");
  }

  const profileFields = [
    ["Full name", customerProfile.full_name],
    ["Contact number", customerProfile.contact_number],
    ["Email", customerProfile.email_address],
    ["Country", customerProfile.current_living_country],
  ];

  return (
    <div className="panel reception-panel">
      <div className="reception-backdrop" />
      <div className="panel-header reception-header">
        <div>
          <p className="eyebrow">ElevenLabs Voice</p>
          <h2>Call Aahaas Assistant</h2>
          <p className="panel-copy reception-copy">
            This call runs like a receptionist-led conversation. It rings, connects,
            greets the customer, asks one question at a time, keeps listening
            automatically, can be tested with a small text box, and ends by saving a
            structured service report. Voice playback is powered by ElevenLabs.
          </p>
        </div>
        <span className="call-badge reception-badge">ElevenLabs voice</span>
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
        <p className="error-text">
          This browser does not support microphone recording for the receptionist call.
        </p>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}

      <div className="reception-grid">
        <div className="reception-card">
          <span>Latest transcript</span>
          <p>{lastTranscript || "The customer speech transcript will appear here during the call."}</p>
        </div>
        <div className="reception-card">
          <span>Assistant reply</span>
          <p>{lastReply || "The assistant greeting and next question will appear here."}</p>
        </div>
        <div className="reception-card">
          <span>Live summary</span>
          <p>{liveSummary || "The call summary will build while the assistant categorizes the request."}</p>
        </div>
      </div>

      <div className="trip-summary-card reception-test-card">
        <span>Quick test chat</span>
        <p>Use this small text box during testing if you want to simulate customer answers without the microphone.</p>
        <div className="reception-test-row">
          <input
            className="records-search reception-test-input"
            value={testMessage}
            onChange={(event) => setTestMessage(event.target.value)}
            placeholder="Type a customer answer for testing..."
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
              Start the call and the assistant will collect customer details and service
              requirements one question at a time.
            </p>
          ) : (
            conversation.map((message, index) => (
              <article
                key={`${message.role}-aahaas-${index}`}
                className={`message-bubble message-${message.role}`}
              >
                <span>{message.role === "assistant" ? "Aahaas assistant" : "Customer"}</span>
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
            <p>
              {serviceCategories.length > 0
                ? serviceCategories.join(", ")
                : "No category confirmed yet."}
            </p>
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
              <p>{finalReport.summary || "No summary returned."}</p>
              <p>
                <strong>Products needed:</strong>{" "}
                {finalReport.products_needed?.length
                  ? finalReport.products_needed.join(", ")
                  : "Not specified"}
              </p>
              <p>
                <strong>Follow-up:</strong>{" "}
                {finalReport.follow_up_actions?.length
                  ? finalReport.follow_up_actions.join(", ")
                  : "None"}
              </p>
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
