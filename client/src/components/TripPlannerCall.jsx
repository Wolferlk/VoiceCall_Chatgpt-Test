import { useEffect, useRef, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_LARAVEL_API_BASE_URL || "http://localhost:8000/api";

function createAudioUrlFromBase64(base64, mimeType) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType || "audio/mpeg" });

  return URL.createObjectURL(blob);
}

function pickMimeType() {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") {
    return "";
  }

  const preferredTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus"
  ];

  return preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export default function TripPlannerCall() {
  const [planId, setPlanId] = useState("");
  const [status, setStatus] = useState("Start a new trip planning call to speak with the Aahaas agent.");
  const [error, setError] = useState("");
  const [isSessionStarting, setIsSessionStarting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [conversation, setConversation] = useState([]);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");
  const [finalSummary, setFinalSummary] = useState("");
  const mainAudioRef = useRef(null);
  const mainAudioUrlRef = useRef("");
  const holdAudioRef = useRef(null);
  const holdAudioUrlRef = useRef("");
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const discardRecordingRef = useRef(false);
  const waitToneTimerRef = useRef(0);
  const audioContextRef = useRef(null);
  const callSupported =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    return () => {
      stopMainAudio();
      stopHoldAudio();
      stopMicrophoneStream();
      stopWaitToneLoop();

      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  function getAudioContext() {
    if (typeof window === "undefined") {
      return null;
    }

    const Context = window.AudioContext || window.webkitAudioContext;

    if (!Context) {
      return null;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new Context();
    }

    return audioContextRef.current;
  }

  function playToneSequence(steps) {
    const context = getAudioContext();

    if (!context) {
      return;
    }

    const startAt = context.currentTime + 0.02;

    steps.reduce((cursor, step) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = step.type || "sine";
      oscillator.frequency.value = step.frequency;
      gain.gain.setValueAtTime(0.0001, cursor);
      gain.gain.exponentialRampToValueAtTime(step.gain || 0.035, cursor + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, cursor + step.duration);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(cursor);
      oscillator.stop(cursor + step.duration + 0.02);

      return cursor + step.duration + (step.gap || 0.05);
    }, startAt);
  }

  function playConnectTone() {
    playToneSequence([
      { frequency: 392, duration: 0.16, gap: 0.04, type: "triangle" },
      { frequency: 523.25, duration: 0.18, gap: 0.04, type: "triangle" },
      { frequency: 659.25, duration: 0.22, type: "triangle" }
    ]);
  }

  function playEndTone() {
    playToneSequence([
      { frequency: 587.33, duration: 0.15, gap: 0.04, type: "triangle" },
      { frequency: 440, duration: 0.2, gap: 0.03, type: "triangle" },
      { frequency: 329.63, duration: 0.26, type: "triangle" }
    ]);
  }

  function startWaitToneLoop() {
    stopWaitToneLoop();

    waitToneTimerRef.current = window.setInterval(() => {
      playToneSequence([
        { frequency: 392, duration: 0.12, gap: 0.04, gain: 0.02, type: "sine" },
        { frequency: 493.88, duration: 0.14, gap: 0.03, gain: 0.018, type: "sine" }
      ]);
    }, 1700);
  }

  function stopWaitToneLoop() {
    if (waitToneTimerRef.current) {
      window.clearInterval(waitToneTimerRef.current);
      waitToneTimerRef.current = 0;
    }
  }

  function stopMainAudio() {
    if (mainAudioRef.current) {
      mainAudioRef.current.pause();
      mainAudioRef.current.currentTime = 0;
      mainAudioRef.current = null;
    }

    if (mainAudioUrlRef.current) {
      URL.revokeObjectURL(mainAudioUrlRef.current);
      mainAudioUrlRef.current = "";
    }
  }

  function stopHoldAudio(options = {}) {
    const { revokeUrl = false } = options;

    if (holdAudioRef.current) {
      holdAudioRef.current.pause();
      holdAudioRef.current.currentTime = 0;
      holdAudioRef.current = null;
    }

    if (revokeUrl && holdAudioUrlRef.current) {
      URL.revokeObjectURL(holdAudioUrlRef.current);
      holdAudioUrlRef.current = "";
    }
  }

  async function playMainAudio(audioUrl) {
    stopMainAudio();

    const audio = new Audio(audioUrl);
    mainAudioRef.current = audio;
    mainAudioUrlRef.current = audioUrl;

    audio.onended = () => {
      if (mainAudioUrlRef.current) {
        URL.revokeObjectURL(mainAudioUrlRef.current);
        mainAudioUrlRef.current = "";
      }
    };

    await audio.play();
  }

  async function startHoldAudioLoop() {
    if (!holdAudioUrlRef.current) {
      return;
    }

    stopHoldAudio();

    const audio = new Audio(holdAudioUrlRef.current);
    audio.loop = true;
    holdAudioRef.current = audio;

    await audio.play().catch(() => {
      holdAudioRef.current = null;
    });
  }

  function stopMicrophoneStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function resetCallState() {
    if (mediaRecorderRef.current?.state === "recording") {
      discardRecordingRef.current = true;
      mediaRecorderRef.current.stop();
    }

    stopMainAudio();
    stopHoldAudio({ revokeUrl: true });
    stopWaitToneLoop();
    stopMicrophoneStream();
    setPlanId("");
    setStatus("Start a new trip planning call to speak with the Aahaas agent.");
    setError("");
    setIsSessionStarting(false);
    setIsRecording(false);
    setIsWaiting(false);
    setIsEnding(false);
    setCallEnded(false);
    setConversation([]);
    setLastTranscript("");
    setLastReply("");
    setFinalSummary("");
  }

  async function handleStartSession() {
    if (isSessionStarting || isRecording || isWaiting || isEnding) {
      return;
    }

    try {
      setIsSessionStarting(true);
      setError("");
      setStatus("Connecting you to the Aahaas travel agent...");

      const response = await fetch(`${API_BASE_URL}/trip-call/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Trip call session could not start.");
      }

      stopHoldAudio({ revokeUrl: true });
      setPlanId(data.plan_id || "");
      setConversation([]);
      setLastTranscript("");
      setLastReply(data.greeting || "");
      setFinalSummary("");
      setCallEnded(false);
      setStatus("The travel agent is ready. Tell us about the trip you want to plan.");

      if (data.hold_audio_base64) {
        holdAudioUrlRef.current = createAudioUrlFromBase64(
          data.hold_audio_base64,
          data.hold_audio_mime_type
        );
      }

      playConnectTone();

      if (data.greeting_audio_base64) {
        const greetingUrl = createAudioUrlFromBase64(
          data.greeting_audio_base64,
          data.greeting_audio_mime_type
        );

        await playMainAudio(greetingUrl);
      }
    } catch (err) {
      setError(err.message);
      setStatus("The trip call could not be started.");
    } finally {
      setIsSessionStarting(false);
    }
  }

  async function submitRecordedTurn(audioBlob) {
    const formData = new FormData();
    formData.append("plan_id", planId);
    formData.append("audio", audioBlob, "trip-call.webm");

    try {
      setIsWaiting(true);
      setError("");
      setStatus("We are planning your trip now. Please stay on the call while the agent prepares your answer.");
      startWaitToneLoop();
      startHoldAudioLoop();

      const response = await fetch(`${API_BASE_URL}/trip-call/turn`, {
        method: "POST",
        body: formData
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Trip call reply failed.");
      }

      setLastTranscript(data.transcript || "");
      setLastReply(data.reply || "");
      setConversation(data.conversation || []);
      setStatus("The travel agent replied. You can continue the call or finish and save the trip plan.");

      stopWaitToneLoop();
      stopHoldAudio();

      if (data.audio_base64) {
        const replyUrl = createAudioUrlFromBase64(data.audio_base64, data.audio_mime_type);
        await playMainAudio(replyUrl);
      }
    } catch (err) {
      stopWaitToneLoop();
      stopHoldAudio();
      setError(err.message);
      setStatus("The trip call could not complete this turn. Please try speaking again.");
    } finally {
      setIsWaiting(false);
    }
  }

  async function handleStartRecording() {
    if (!callSupported || !planId || callEnded || isRecording || isWaiting || isEnding) {
      return;
    }

    try {
      setError("");
      setStatus("Listening now. Speak naturally about your trip, then stop to send your request.");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      recordedChunksRef.current = [];
      discardRecordingRef.current = false;
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || "audio/webm"
        });

        recordedChunksRef.current = [];
        stopMicrophoneStream();
        setIsRecording(false);

        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          setStatus(planId ? "The travel agent is ready for the next part of the call." : status);
          return;
        }

        if (audioBlob.size === 0) {
          setStatus("No audio was captured. Please try again.");
          return;
        }

        await submitRecordedTurn(audioBlob);
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      stopMicrophoneStream();
      setIsRecording(false);
      setError(err.message || "Microphone access failed.");
      setStatus("Microphone permission is required for the trip call.");
    }
  }

  function handleStopRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      setStatus("Sending your trip request to the travel agent...");
      mediaRecorderRef.current.stop();
    }
  }

  async function handleEndCall() {
    if (!planId || callEnded || isRecording || isWaiting || isEnding) {
      return;
    }

    try {
      setIsEnding(true);
      setError("");
      setStatus("Saving your trip plan and preparing the final summary...");
      startWaitToneLoop();

      const response = await fetch(`${API_BASE_URL}/trip-call/end`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          plan_id: planId
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "Trip plan could not be completed.");
      }

      stopWaitToneLoop();
      stopHoldAudio();
      playEndTone();
      setCallEnded(true);
      setFinalSummary(data.summary || "");
      setLastReply(data.closing_message || lastReply);
      setStatus("The call is complete and your trip summary has been saved.");

      if (data.audio_base64) {
        const closingUrl = createAudioUrlFromBase64(data.audio_base64, data.audio_mime_type);
        await playMainAudio(closingUrl);
      }
    } catch (err) {
      stopWaitToneLoop();
      setError(err.message);
      setStatus("We could not save the final trip plan yet. Please try again.");
    } finally {
      setIsEnding(false);
    }
  }

  return (
    <div className="panel trip-call-panel">
      <div className="panel-header">
        <div>
          <h2>Call With Agent</h2>
          <p className="panel-copy trip-panel-copy">
            This call flow uses OpenAI voice only. Speak your travel needs, hear the agent
            reply in voice, continue the conversation naturally, and end the call with a
            saved trip summary and plan ID from Laravel.
          </p>
        </div>
        <span className="call-badge">OpenAI voice</span>
      </div>

      <div className="trip-call-actions">
        {!planId ? (
          <button
            type="button"
            className="primary-button"
            onClick={handleStartSession}
            disabled={isSessionStarting}
          >
            {isSessionStarting ? "Connecting..." : "Start trip call"}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={`primary-button ${isRecording ? "recording-button" : ""}`}
              onClick={isRecording ? handleStopRecording : handleStartRecording}
              disabled={!callSupported || isWaiting || isEnding || callEnded}
            >
              {isRecording ? "Stop and send" : "Speak to agent"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={handleEndCall}
              disabled={isRecording || isWaiting || isEnding || callEnded || conversation.length === 0}
            >
              {isEnding ? "Saving plan..." : "End and save plan"}
            </button>
          </>
        )}
        <button
          type="button"
          className="secondary-button"
          onClick={resetCallState}
          disabled={isSessionStarting || isWaiting || isEnding}
        >
          Reset
        </button>
      </div>

      <div className="call-status-card trip-status-card">
        <span>Live status</span>
        <strong>{status}</strong>
        {planId ? <span className="plan-id-chip">Plan ID: {planId}</span> : null}
      </div>

      {!callSupported ? (
        <p className="error-text">
          This browser does not support microphone recording for the trip planning call.
        </p>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}

      <div className="live-notes">
        <div>
          <span>Latest request</span>
          <p>{lastTranscript || "Your latest spoken trip request will appear here."}</p>
        </div>
        <div>
          <span>Agent reply</span>
          <p>{lastReply || "The OpenAI voice agent reply will appear here."}</p>
        </div>
      </div>

      <div className="conversation-log trip-conversation-log" aria-live="polite">
        {conversation.length === 0 ? (
          <p className="empty-state">
            Start the call, speak about your destination, budget, dates, group size, or
            activities, and the agent will build the plan with you.
          </p>
        ) : (
          conversation.map((message, index) => (
            <article
              key={`${message.role}-trip-${index}`}
              className={`message-bubble message-${message.role}`}
            >
              <span>{message.role === "assistant" ? "Travel agent" : "You"}</span>
              <p>{message.content}</p>
            </article>
          ))
        )}
      </div>

      {finalSummary ? (
        <div className="trip-summary-card">
          <span>Saved trip summary</span>
          <p>{finalSummary}</p>
        </div>
      ) : null}
    </div>
  );
}
