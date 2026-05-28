import { useEffect, useRef, useState } from "react";
import AahaasAssistantCall from "./components/AahaasAssistantCall";
import AahaasAssistentFinalV01 from "./components/AahaasAssistentFinalV01";
import AahaasChatGpt3vHome from "./components/AahaasChatGpt3vHome";
import AiAssistentFinalTest from "./components/AiAssistentFinalTest";
import AssistenUvindu from "./components/Assisten_Uvindu";
import ApiTestPage from "./components/ApiTestPage";
import PhoneApiTestPage from "./components/PhoneApiTestPage";
import ChatbotPage from "./components/ChatbotPage";
import FiveVChatGptAssis from "./components/FiveVChatGptAssis";
import FourVChatGptAssis from "./components/FourVChatGptAssis";
import RecordsPage from "./components/RecordsPage";
import ReceptionistCall from "./components/ReceptionistCall";
import SixVChatGptAssis from "./components/SixVChatGptAssis";
import TripPlannerCall from "./components/TripPlannerCall";

const BACKEND_OPTIONS = {
  laravel: {
    label: "Laravel",
    baseUrl: import.meta.env.VITE_LARAVEL_API_BASE_URL || "http://localhost:8000/api"
  },
  node: {
    label: "Node",
    baseUrl: import.meta.env.VITE_NODE_API_BASE_URL || "http://localhost:5001/api"
  }
};

const WORKSPACE_MODES = [
  {
    id: "5v-chatgpt-assis",
    label: "5v ChatGPT ASSIS",
    kicker: "OpenAI voice receptionist",
    description: "Cloned AI ASSISTENT FINAL TEST flow with ChatGPT voices only, random Sol or Cove voice selection, full report saving, and live voice controls."
  },
  {
    id: "6v-chatgpt-assis",
    label: "6v ChatGPT ASSIS",
    kicker: "OpenAI voice receptionist",
    description: "Cloned AI ASSISTENT FINAL TEST flow with ChatGPT voices only, random Sol or Cove voice selection, full report saving, and live voice controls."
  },
  {
    id: "4v-chatgpt-assis",
    label: "4v ChatGPT ASSIS",
    kicker: "OpenAI voice receptionist",
    description: "Cloned receptionist intake flow with low-latency OpenAI voices, random Sol or Cove default voice, report saving, and live call controls."
  },
  {
    id: "aahaas-chatgpt-3v",
    label: "AaHAAs ChatGPT 3v",
    kicker: "OpenAI home receptionist",
    description: "Cloned Aahaas receptionist intake call with OpenAI voices, random Sol or Cove selection, report saving, and optional background music."
  },
  {
    id: "ai-assistent-final-test",
    label: "AI ASSISTENT FINAL TEST",
    kicker: "Home page receptionist",
    description: "Animated Aahaas receptionist intake call using ElevenLabs voice and ChatGPT only for reasoning and follow-up questions."
  },
  {
    id: "aahaas-assistent-final-v01",
    label: "Aahaas Assistent Final (V0.1)",
    kicker: "Home page receptionist",
    description: "Cloned from AI ASSISTENT FINAL TEST with the same ElevenLabs voice flow and natural intake conversation."
  },
  {
    id: "tts",
    label: "Text to Speech",
    kicker: "Voice generation",
    description: "Turn written text into spoken audio with your selected backend."
  },
  {
    id: "ai-call",
    label: "AI Call",
    kicker: "Classic voice turn",
    description: "Record one message, let Laravel process it, and hear the AI reply."
  },
  {
    id: "reception",
    label: "Call Aahaas Assistant",
    kicker: "Reception flow",
    description: "Run the animated receptionist intake call with auto follow-up questions."
  },
  {
    id: "agent",
    label: "Call With Agent",
    kicker: "Trip planner",
    description: "Plan a trip with the OpenAI travel agent and save the final plan ID."
  },
  {
    id: "text-ai",
    label: "Text AI Voice",
    kicker: "Typed GPT voice",
    description: "Type a prompt and get a spoken AI response automatically."
  },
  {
    id: "aahaas-assistant",
    label: "Call Aahaas Assistant",
    kicker: "ElevenLabs ConvAI",
    description: "Hands-free Aahaas assistant call with ElevenLabs voice playback and Laravel-managed conversation flow."
  },
  {
    id: "uvindu",
    label: "Assisten Uvindu",
    kicker: "ElevenLabs voice",
    description: "Call Uvindu — your Aahaas AI assistant. Runs the full receptionist intake flow with ElevenLabs voice."
  }
];

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

function pageFromHash(hash) {
  if (hash === "#/records")   return "records";
  if (hash === "#/chatbot")   return "chatbot";
  if (hash === "#/apitest")   return "apitest";
  if (hash === "#/phonetest") return "phonetest";
  return "workspace";
}

export default function App() {
  const [page, setPage] = useState(() =>
    typeof window !== "undefined" ? pageFromHash(window.location.hash) : "workspace"
  );
  const [activeMode, setActiveMode] = useState("aahaas-assistent-final-v01");
  const [speechText, setSpeechText] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [backend, setBackend] = useState(() => localStorage.getItem("tts-backend") || "laravel");
  const [textAiPrompt, setTextAiPrompt] = useState("");
  const [textAiError, setTextAiError] = useState("");
  const [textAiBusy, setTextAiBusy] = useState(false);
  const [textAiReply, setTextAiReply] = useState("");
  const [textAiHistory, setTextAiHistory] = useState([]);
  const [conversation, setConversation] = useState([]);
  const [callStatus, setCallStatus] = useState("Ready to start a new AI phone call.");
  const [callError, setCallError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastReply, setLastReply] = useState("");
  const audioRef = useRef(null);
  const audioUrlRef = useRef("");
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const conversationRef = useRef([]);
  const discardRecordingRef = useRef(false);
  const callSupported =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    localStorage.setItem("tts-backend", backend);
  }, [backend]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleHashChange = () => {
      setPage(pageFromHash(window.location.hash));
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }

      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }

      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }

      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function stopCurrentAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
  }

  async function playAudioFromUrl(audioUrl, options = {}) {
    const { onEnded, onError } = options;

    stopCurrentAudio();

    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audioUrlRef.current = audioUrl;

    audio.onended = () => {
      setSpeaking(false);
      setIsCalling(false);
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = "";
      }

      onEnded?.();
    };

    audio.onerror = () => {
      setSpeaking(false);
      setIsCalling(false);
      setError((current) => current || "");
      setCallError((current) => current || "Audio playback failed.");
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = "";
      }

      onError?.();
    };

    await audio.play();
  }

  async function handleSpeak() {
    const trimmed = speechText.trim();

    if (!trimmed) {
      return;
    }

    try {
      setSpeaking(true);
      setError("");
      setSpeechText(trimmed);

      const activeBackend = BACKEND_OPTIONS[backend] || BACKEND_OPTIONS.laravel;

      const response = await fetch(`${activeBackend.baseUrl}/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: trimmed })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          `${activeBackend.label} backend: ${data.message || "Failed to generate audio."}`
        );
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      await playAudioFromUrl(audioUrl);
    } catch (err) {
      setSpeaking(false);
      setError(err.message);
    }
  }

  async function handleTextAiVoice() {
    const trimmed = textAiPrompt.trim();

    if (!trimmed) {
      return;
    }

    try {
      setSpeaking(true);
      setTextAiBusy(true);
      setTextAiError("");

      const response = await fetch(`${BACKEND_OPTIONS.laravel.baseUrl}/text-ai-voice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: trimmed,
          history: textAiHistory
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "AI text voice request failed.");
      }

      setTextAiPrompt("");
      setTextAiReply(data.reply || "");
      setTextAiHistory((current) => [
        ...current,
        { role: "user", content: data.text || trimmed },
        { role: "assistant", content: data.reply || "" }
      ]);

      const audioUrl = createAudioUrlFromBase64(data.audio_base64, data.audio_mime_type);
      await playAudioFromUrl(audioUrl, {
        onEnded: () => {
          setTextAiBusy(false);
        },
        onError: () => {
          setTextAiBusy(false);
        }
      });
    } catch (err) {
      setSpeaking(false);
      setTextAiBusy(false);
      setTextAiError(err.message);
    }
  }

  function handleResetTextAiVoice() {
    setTextAiPrompt("");
    setTextAiReply("");
    setTextAiError("");
    setTextAiHistory([]);
    setTextAiBusy(false);
  }

  function stopMicrophoneStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  async function submitCallAudio(audioBlob) {
    const formData = new FormData();
    formData.append("audio", audioBlob, "ai-call.webm");
    formData.append("history", JSON.stringify(conversationRef.current));

    try {
      setIsCalling(true);
      setCallError("");
      setCallStatus("Transcribing your speech and preparing the AI reply...");

      const response = await fetch(`${BACKEND_OPTIONS.laravel.baseUrl}/ai-call`, {
        method: "POST",
        body: formData
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || "AI call failed.");
      }

      setLastTranscript(data.transcript || "");
      setLastReply(data.reply || "");
      setConversation((current) => [
        ...current,
        { role: "user", content: data.transcript || "" },
        { role: "assistant", content: data.reply || "" }
      ]);
      setCallStatus("AI replied. Playing the voice response now...");

      const audioUrl = createAudioUrlFromBase64(data.audio_base64, data.audio_mime_type);
      await playAudioFromUrl(audioUrl);
    } catch (err) {
      setIsCalling(false);
      setCallError(err.message);
      setCallStatus("The AI call could not finish. Try speaking again.");
    }
  }

  async function handleStartCall() {
    if (!callSupported || isRecording || isCalling) {
      return;
    }

    try {
      setCallError("");
      setCallStatus("Microphone is live. Speak your message, then stop the call.");

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
          setCallStatus("Ready to start a new AI phone call.");
          return;
        }

        if (audioBlob.size === 0) {
          setCallStatus("No audio was captured. Please try again.");
          return;
        }

        await submitCallAudio(audioBlob);
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      stopMicrophoneStream();
      setIsRecording(false);
      setCallError(err.message || "Microphone access failed.");
      setCallStatus("Microphone permission is required for AI call mode.");
    }
  }

  function handleStopCall() {
    if (mediaRecorderRef.current?.state === "recording") {
      setCallStatus("Sending your voice message to the Laravel AI call backend...");
      mediaRecorderRef.current.stop();
    }
  }

  function handleResetCall() {
    if (mediaRecorderRef.current?.state === "recording") {
      discardRecordingRef.current = true;
      mediaRecorderRef.current.stop();
    }

    stopMicrophoneStream();
    setConversation([]);
    setLastTranscript("");
    setLastReply("");
    setCallError("");
    setIsCalling(false);
    setIsRecording(false);
    setCallStatus("Ready to start a new AI phone call.");
  }

  function navigateTo(nextPage) {
    const hashMap = { records: "#/records", chatbot: "#/chatbot", apitest: "#/apitest", phonetest: "#/phonetest" };
    const nextHash = hashMap[nextPage] || "#/";
    if (typeof window !== "undefined" && window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
    setPage(nextPage);
  }

  const activeModeMeta = WORKSPACE_MODES.find((mode) => mode.id === activeMode) || WORKSPACE_MODES[0];

  function renderActivePanel() {
    if (activeMode === "4v-chatgpt-assis") {
      return <FourVChatGptAssis />;
    }

    if (activeMode === "tts") {
      return (
        <div className="panel workspace-panel">
          <div className="panel-header workspace-header">
            <div>
              <p className="workspace-kicker">{activeModeMeta.kicker}</p>
              <h2>{activeModeMeta.label}</h2>
            </div>
            <span className="call-badge">{BACKEND_OPTIONS[backend]?.label || "Laravel"}</span>
          </div>
          <p className="panel-copy">{activeModeMeta.description}</p>
          <div className="backend-switcher" role="group" aria-label="Backend selection">
            {Object.entries(BACKEND_OPTIONS).map(([key, option]) => (
              <button
                key={key}
                type="button"
                className={`backend-button ${backend === key ? "backend-button-active" : ""}`}
                onClick={() => {
                  setBackend(key);
                  setError("");
                }}
                disabled={speaking || isRecording || isCalling}
              >
                {option.label}
              </button>
            ))}
          </div>
          <textarea
            value={speechText}
            onChange={(event) => setSpeechText(event.target.value)}
            rows={10}
            placeholder="Type the exact text you want spoken..."
          />
          <div className="workspace-actions">
            <button
              type="button"
              className="primary-button"
              onClick={handleSpeak}
              disabled={speaking || isRecording || isCalling || !speechText.trim()}
            >
              {speaking ? "Generating audio..." : "Generate and play"}
            </button>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      );
    }

    if (activeMode === "ai-call") {
      return (
        <div className="panel workspace-panel">
          <div className="panel-header workspace-header">
            <div>
              <p className="workspace-kicker">{activeModeMeta.kicker}</p>
              <h2>{activeModeMeta.label}</h2>
            </div>
            <span className="call-badge">Laravel only</span>
          </div>
          <p className="panel-copy">{activeModeMeta.description}</p>
          <div className="call-controls">
            <button
              type="button"
              className={`primary-button ${isRecording ? "recording-button" : ""}`}
              onClick={isRecording ? handleStopCall : handleStartCall}
              disabled={!callSupported || isCalling}
            >
              {isRecording ? "Stop and send call" : "Start call"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={handleResetCall}
              disabled={isCalling || (conversation.length === 0 && !lastTranscript && !lastReply)}
            >
              Reset conversation
            </button>
          </div>
          <div className="call-status-card">
            <span>Status</span>
            <strong>{callStatus}</strong>
          </div>
          {!callSupported ? (
            <p className="error-text">
              This browser does not support microphone recording for the AI call feature.
            </p>
          ) : null}
          {callError ? <p className="error-text">{callError}</p> : null}
          <div className="live-notes">
            <div>
              <span>Latest transcript</span>
              <p>{lastTranscript || "Your speech transcript will appear here."}</p>
            </div>
            <div>
              <span>Latest AI reply</span>
              <p>{lastReply || "The spoken AI answer will appear here."}</p>
            </div>
          </div>
          <div className="conversation-log" aria-live="polite">
            {conversation.length === 0 ? (
              <p className="empty-state">
                Start the call to build a running phone-style conversation with memory on the
                frontend.
              </p>
            ) : (
              conversation.map((message, index) => (
                <article
                  key={`${message.role}-${index}`}
                  className={`message-bubble message-${message.role}`}
                >
                  <span>{message.role === "assistant" ? "AI voice" : "You"}</span>
                  <p>{message.content}</p>
                </article>
              ))
            )}
          </div>
        </div>
      );
    }

    if (activeMode === "ai-assistent-final-test") {
      return <AiAssistentFinalTest />;
    }

    if (activeMode === "aahaas-assistent-final-v01") {
      return <AahaasAssistentFinalV01 />;
    }

    if (activeMode === "aahaas-chatgpt-3v") {
      return <AahaasChatGpt3vHome />;
    }

    if (activeMode === "5v-chatgpt-assis") {
      return <FiveVChatGptAssis />;
    }

    if (activeMode === "6v-chatgpt-assis") {
      return <SixVChatGptAssis />;
    }

    if (activeMode === "reception") {
      return <ReceptionistCall />;
    }

    if (activeMode === "agent") {
      return <TripPlannerCall />;
    }

    if (activeMode === "aahaas-assistant") {
      return <AahaasAssistantCall />;
    }

    if (activeMode === "uvindu") {
      return <AssistenUvindu />;
    }

    return (
      <div className="panel workspace-panel">
        <div className="panel-header workspace-header">
          <div>
            <p className="workspace-kicker">{activeModeMeta.kicker}</p>
            <h2>{activeModeMeta.label}</h2>
          </div>
          <span className="call-badge">Laravel only</span>
        </div>
        <p className="panel-copy">{activeModeMeta.description}</p>
        <textarea
          value={textAiPrompt}
          onChange={(event) => setTextAiPrompt(event.target.value)}
          rows={8}
          placeholder="Ask ChatGPT something..."
        />
        <div className="call-controls">
          <button
            type="button"
            className="primary-button"
            onClick={handleTextAiVoice}
            disabled={textAiBusy || speaking || isRecording || isCalling || !textAiPrompt.trim()}
          >
            {textAiBusy ? "Thinking and speaking..." : "Ask and play voice"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handleResetTextAiVoice}
            disabled={
              speaking ||
              textAiBusy ||
              (textAiHistory.length === 0 && !textAiPrompt && !textAiReply)
            }
          >
            Clear chat
          </button>
        </div>
        {textAiError ? <p className="error-text">{textAiError}</p> : null}
        <div className="live-notes">
          <div>
            <span>Latest AI reply</span>
            <p>{textAiReply || "The newest GPT reply will appear here before the voice playback finishes."}</p>
          </div>
        </div>
        <div className="conversation-log" aria-live="polite">
          {textAiHistory.length === 0 ? (
            <p className="empty-state">
              Type a message to start a text conversation that is answered in voice.
            </p>
          ) : (
            textAiHistory.map((message, index) => (
              <article
                key={`${message.role}-text-${index}`}
                className={`message-bubble message-${message.role}`}
              >
                <span>{message.role === "assistant" ? "AI voice" : "You"}</span>
                <p>{message.content}</p>
              </article>
            ))
          )}
        </div>
      </div>
    );
  }

  const NAV_ITEMS = [
    { id: "workspace",  label: "Voice Workspace",  icon: "🎙" },
    { id: "chatbot",    label: "Chatbot",           icon: "🤖" },
    { id: "records",    label: "Stored Records",    icon: "🗄" },
    { id: "apitest",    label: "API Test Lab",      icon: "⚡" },
    { id: "phonetest",  label: "Phone API Test",    icon: "📞" },
  ];

  return (
    <div style={{ fontFamily: "'Space Grotesk','Segoe UI',system-ui,sans-serif", background: "#f0f4f8", minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* ── TOP NAV ── */}
      <header style={{
        background: "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)",
        padding: "0 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        boxShadow: "0 4px 24px rgba(0,0,0,0.22)",
        height: 60, flexShrink: 0,
      }}>
        {/* Logo / title */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
            ✦
          </div>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 14, letterSpacing: "-0.01em" }}>Aahaas Console</div>
            <div style={{ color: "#475569", fontSize: 10, fontWeight: 600 }}>Voice AI · Chatbot · Records</div>
          </div>
        </div>

        {/* Nav tabs */}
        <nav style={{ display: "flex", gap: 4 }}>
          {NAV_ITEMS.map((item) => {
            const active = page === item.id;
            return (
              <button key={item.id} type="button" onClick={() => navigateTo(item.id)} style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "7px 16px", borderRadius: 9, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 700, transition: "all 0.15s",
                background: active ? "rgba(99,102,241,0.2)" : "transparent",
                color: active ? "#a5b4fc" : "#64748b",
                outline: active ? "1px solid rgba(99,102,241,0.35)" : "1px solid transparent",
              }}>
                <span style={{ fontSize: 14 }}>{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Right: active mode badge (workspace only) */}
        {page === "workspace" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>Mode:</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#a5b4fc", background: "rgba(99,102,241,0.12)", padding: "3px 10px", borderRadius: 7, border: "1px solid rgba(99,102,241,0.2)" }}>
              {activeModeMeta.label}
            </span>
          </div>
        )}
      </header>

      {/* ── PAGE CONTENT ── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {page === "records" ? (
          <RecordsPage />
        ) : page === "chatbot" ? (
          <ChatbotPage />
        ) : page === "apitest" ? (
          <ApiTestPage />
        ) : page === "phonetest" ? (
          <PhoneApiTestPage />
        ) : (
          /* ── WORKSPACE ── */
          <div style={{ padding: "16px 16px 32px" }}>

            {/* Mode selector row */}
            <div style={{
              background: "rgba(255,255,255,0.95)", border: "1px solid rgba(15,23,42,0.08)",
              borderRadius: 14, padding: "12px 16px", marginBottom: 14,
              boxShadow: "0 2px 12px rgba(15,23,42,0.06)",
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            }}>
              <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>
                Select Mode
              </span>
              <select
                value={activeMode}
                onChange={(e) => setActiveMode(e.target.value)}
                style={{ padding: "7px 12px", borderRadius: 9, border: "1px solid rgba(15,23,42,0.12)", background: "#fff", fontSize: 13, color: "#1e293b", outline: "none", cursor: "pointer", minWidth: 260 }}
              >
                {WORKSPACE_MODES.map((m) => (
                  <option key={m.id} value={m.id}>{m.label} — {m.kicker}</option>
                ))}
              </select>
              <span style={{ fontSize: 12, color: "#64748b", flex: 1 }}>{activeModeMeta.description}</span>
              <div style={{ display: "flex", gap: 8 }}>
                {["ai-call", "tts"].includes(activeMode) && (
                  <span style={{ fontSize: 11, fontWeight: 700, background: speaking || isRecording || isCalling ? "rgba(245,158,11,0.12)" : "rgba(16,185,129,0.1)", color: speaking || isRecording || isCalling ? "#d97706" : "#10b981", padding: "4px 12px", borderRadius: 20, border: `1px solid ${speaking || isRecording || isCalling ? "rgba(245,158,11,0.25)" : "rgba(16,185,129,0.2)"}` }}>
                    {isRecording ? "● Recording" : isCalling ? "● Processing" : speaking ? "● Speaking" : "● Idle"}
                  </span>
                )}
              </div>
            </div>

            {/* Panel */}
            <section>{renderActivePanel()}</section>
          </div>
        )}
      </div>
    </div>
  );
}
