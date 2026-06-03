import { useEffect, useRef, useState } from "react";
import { Conversation } from "@11labs/client";

const LARAVEL_API  = import.meta.env.VITE_LARAVEL_API_BASE_URL || "http://localhost:8000/api";
const SUGGEST_API  = import.meta.env.VITE_SUGGEST_API  || "https://travel-parser-live.aahaas.com/v1/voice/suggest";
const WHATSAPP_API = import.meta.env.VITE_WHATSAPP_API || "https://travel-parser-live.aahaas.com/v1/voice/send-whatsapp";
const EL_AGENT_ID  = (import.meta.env.VITE_ELEVENLABS_AGENT_ID || "").trim();
const EL_API_KEY   = (import.meta.env.VITE_ELEVENLABS_API_KEY  || "").trim();

// ── voices ────────────────────────────────────────────────────────────────────
const EL_VOICES = [
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte · Warm British Female" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica · Expressive Female"      },
  { id: "9BWtsMINqrJLrRacOk9x", name: "Aria · Natural American Female"   },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George · British Male"            },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will · Friendly American Male"    },
];

// ── phases ────────────────────────────────────────────────────────────────────
const PHASES = {
  idle:           { label: "Ready",        color: "#6b7280" },
  connecting:     { label: "Connecting…",  color: "#3b82f6" },
  connected:      { label: "Connected",    color: "#10b981" },
  listening:      { label: "Listening",    color: "#10b981" },
  agent_speaking: { label: "AI Speaking",  color: "#8b5cf6" },
  searching:      { label: "Searching…",   color: "#f59e0b" },
  sending_wa:     { label: "Sending WA",   color: "#f59e0b" },
  completed:      { label: "Call Ended",   color: "#6b7280" },
  failed:         { label: "Failed",       color: "#ef4444" },
};

// ── system prompt ─────────────────────────────────────────────────────────────
// Country and defaults are injected at connect time — this is the base template.
const BASE_PROMPT = `You are Aahaas AI — a premium travel concierge on a live phone call. Sound like a warm, sharp, real human travel consultant. Never robotic, never scripted.

VOICE RULES — NON-NEGOTIABLE
- Max 2 sentences per turn, then stop and listen.
- NEVER repeat anything you already said.
- NEVER say "Great!", "Certainly!", "Of course!", "Sure!", "Thank you for that information", "Absolutely!", "No problem!", "I understand."
- No filler. No pleasantries. Get straight to what matters.
- If the customer is still speaking, stay silent.

OPENING — say ONLY this, once:
"Hello, this is Aahaas. How can I help today?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION FLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1 · LISTEN & FETCH
The moment the customer mentions a travel need → call fetch_travel_package immediately with their exact spoken words.

DEFAULT ASSUMPTIONS — apply silently when the customer hasn't specified:
• Hotel or stay-only plan → 3 nights · 2 adults · 3-star · start next Friday
• Flight booking → price per person (one-way unless return mentioned)
• Trip with activities → include airport transfers + key activities
• Travel to another country (outside CALLER_COUNTRY) → include return flight automatically
• Departure city → CALLER_COUNTRY capital or main airport

STEP 2 · PRESENT NATURALLY
Summarize the result in 1–2 sentences — key highlights only (destination, nights, price if available). Do NOT read the full list. Then ask one smart follow-up if needed to complete the picture.

STEP 3 · BUILD THE PACKAGE
Each customer addition or change → call fetch_travel_package again with that specific request.
Keep building until the customer stops adding things or goes quiet for a turn.

STEP 4 · SUMMARIZE & CONFIRM
When the package feels complete, say a single natural paragraph covering:
- What's included (destinations, nights, activities, flights if any)
- Number of travelers and dates
- Rough price range if known

Then ask: "Does that sound right, or would you like to change anything?"

STEP 5 · ADJUST OR PROCEED
- If changes → call fetch_travel_package with action "change", re-summarize, ask again.
- If happy → ask: "Shall I send you this as a quotation on WhatsApp?"

STEP 6 · COLLECT CONTACT (only after "yes" to quotation)
Ask: "What name should I put on the quote?"
Then: "And your WhatsApp number with country code?"
Read it back digit by digit: "So that's [read each digit]. Is that correct?"
Wait for explicit confirmation before calling send_whatsapp_quotation.

STEP 7 · SEND & CLOSE
Call send_whatsapp_quotation with the full package summary as the summary field.
Say: "Sent — you'll get it on WhatsApp shortly. Thanks for calling Aahaas!"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BOOKING POLICY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This call creates a quotation only — nothing is booked. NEVER say "booking confirmed."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
fetch_travel_package — the ONLY product search tool. Call it for every customer request without exception:
  • new_request  — first request or completely new trip (resets context)
  • add_hotel    — hotel or accommodation search (any star rating, any location)
  • add_product  — flights, activities, day tours, airport transfers, visa services, or any other service
  • change       — modify nights / dates / pax / star rating / remove or swap an item
  • price_query  — customer asks about cost (no hold needed, answer immediately)
  • confirm      — customer is happy and approves the plan

IMPORTANT: Use fetch_travel_package for:
  ✓ Travel packages    ✓ Hotel bookings     ✓ Flight tickets
  ✓ Airport transfers  ✓ Day tours          ✓ Activities
  ✓ Safari / excursions ✓ Visa assistance   ✓ Any Aahaas service

send_whatsapp_quotation — ONLY after digit-by-digit number confirmation. The summary field must be a complete paragraph of everything agreed.

When unclear → ask once, briefly. "Could you say that again?"

Aahaas offers: Travel packages · Hotel bookings · Airport transfers · Tours & activities · Dining & lifestyle · Flights · Sri Lanka and international destinations.`;

// ── client tools definition (passed as overrides to ElevenLabs) ───────────────
const TOOL_SCHEMAS = [
  {
    type: "client",
    name: "fetch_travel_package",
    description: "Search Aahaas products and build the travel package. Call this for EVERY customer request — hotel search, flight search, activity/tour search, transfer search, travel package search, price query, or any change. This is the ONLY search API — use it for all product types. Always pass the customer's exact spoken words plus any defaults you applied.",
    parameters: {
      type: "object",
      properties: {
        customer_voice_prompt: {
          type: "string",
          description: "Full search prompt including customer's spoken words and any silent defaults applied (e.g. '3 nights 2 adults 3-star hotel Kandy starting next Friday', or 'return flight Colombo to Dubai for 2 adults', or 'city tour Kandy half day'). Be specific — the more detail, the better the results.",
        },
        action: {
          type: "string",
          enum: ["new_request", "add_hotel", "add_product", "change", "price_query", "confirm"],
          description: "new_request=first or completely new search; add_hotel=hotel/accommodation search; add_product=flight, activity, tour, transfer, or any service; change=modify existing item; price_query=cost question; confirm=customer approves the plan.",
        },
      },
      required: ["customer_voice_prompt", "action"],
    },
  },
  {
    type: "client",
    name: "send_whatsapp_quotation",
    description: "Send the full quotation to the customer's WhatsApp. Call ONLY after the customer has confirmed their phone number digit-by-digit out loud.",
    parameters: {
      type: "object",
      properties: {
        customer_name:   { type: "string", description: "Customer's full name as they gave it." },
        whatsapp_number: { type: "string", description: "WhatsApp number with country code, digits only. E.g. 94772897856" },
        summary:         { type: "string", description: "Complete paragraph describing the agreed package: destinations, hotel names, nights, number of travelers, dates, activities, flights if any, and total price range. This becomes the WhatsApp message body." },
      },
      required: ["customer_name", "whatsapp_number", "summary"],
    },
  },
];

// ── helpers ───────────────────────────────────────────────────────────────────
function msToTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ── component ─────────────────────────────────────────────────────────────────
export default function AahaasRealtimeV03() {
  const [phase, setPhase]         = useState("idle");
  const [error, setError]         = useState("");
  const [statusMsg, setStatusMsg] = useState("Tap call to connect");

  const [callDuration, setCallDuration]       = useState(0);
  const [detectedCountry, setDetectedCountry] = useState("Sri Lanka");
  const [conversationId, setConversationId]   = useState("");
  const [selectedVoice, setSelectedVoice]     = useState(EL_VOICES[0].id);

  const [micMuted, setMicMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [aiLevel, setAiLevel]   = useState(0);

  const [conversation, setConversation]   = useState([]);
  const [userTranscript, setUserTranscript] = useState("");
  const [aiTranscript, setAiTranscript]     = useState("");

  const [packageStatus, setPackageStatus]       = useState("idle");
  const [fetchedPackages, setFetchedPackages]   = useState([]);
  const [confirmedPackage, setConfirmedPackage] = useState(null);

  const [quotationStatus, setQuotationStatus] = useState("idle");
  const [quotationInfo, setQuotationInfo]     = useState(null);

  const [devMode, setDevMode] = useState(false);
  const [devTab, setDevTab]   = useState("terminal");
  const [terminalLog, setTerminalLog]   = useState([]);
  const [apiResponses, setApiResponses] = useState([]);

  const [rptTitle,    setRptTitle]    = useState("V0.3 Test Report");
  const [rptSeverity, setRptSeverity] = useState("medium");
  const [rptDetails,  setRptDetails]  = useState("");
  const [rptSaving,   setRptSaving]   = useState(false);
  const [rptMsg,      setRptMsg]      = useState("");

  // refs
  const convRef          = useRef(null);   // @11labs/client Conversation instance
  const phaseRef         = useRef("idle");
  const sessionTokenRef  = useRef(0);
  const disconnectingRef = useRef(false);
  const callTimerRef     = useRef(null);
  const callStartRef     = useRef(0);
  const volumePollRef    = useRef(null);
  const terminalEndRef   = useRef(null);
  const detectedCountryRef  = useRef("Sri Lanka");
  const confirmedPkgRef     = useRef(null);
  const selectedVoiceRef    = useRef(EL_VOICES[0].id);
  const packageSummaryRef   = useRef("");  // accumulated package summary for WhatsApp

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { detectedCountryRef.current = detectedCountry; }, [detectedCountry]);
  useEffect(() => { confirmedPkgRef.current = confirmedPackage; }, [confirmedPackage]);
  useEffect(() => { selectedVoiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => {
    if (terminalEndRef.current) terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [terminalLog]);
  useEffect(() => {
    // mute/unmute by setting the SDK's microphone state
    if (convRef.current) {
      convRef.current.setMicMuted?.(micMuted);
    }
  }, [micMuted]);
  useEffect(() => () => teardown(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── helpers ──────────────────────────────────────────────────────────────────
  function addLog(type, msg) {
    const ts = new Date().toISOString().slice(11, 23);
    setTerminalLog(p => [...p.slice(-200), { ts, type, msg }]);
  }
  function pushMsg(role, content) {
    if (!content?.trim()) return;
    setConversation(p => [...p, { role, content: content.trim(), ts: Date.now() }]);
  }
  function pushApiResp(type, data) {
    setApiResponses(p => [...p.slice(-40), { type, data, ts: Date.now() }]);
  }
  function startTimer() {
    callStartRef.current = Date.now();
    setCallDuration(0);
    callTimerRef.current = setInterval(() => setCallDuration(Date.now() - callStartRef.current), 500);
  }
  function stopTimer() {
    if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
  }
  function stopVolumePoll() {
    if (volumePollRef.current) { clearInterval(volumePollRef.current); volumePollRef.current = null; }
  }
  async function teardown() {
    stopVolumePoll(); stopTimer();
    const conv = convRef.current;
    convRef.current = null;
    if (conv) {
      try {
        conv.setMicMuted?.(true);
      } catch {}
      // Give the SDK a moment to stop the input worklet before we close the session.
      await new Promise((resolve) => setTimeout(resolve, 80));
      try {
        await conv.endSession?.();
      } catch {}
    }
  }

  function isCurrentSession(token) {
    return token === sessionTokenRef.current && !disconnectingRef.current;
  }

  // ── country detection (Cloudflare trace — CORS-friendly, no rate limits) ────────
  async function detectCountry() {
    try {
      const res  = await fetch("https://cloudflare.com/cdn-cgi/trace", { cache: "no-store" });
      const text = await res.text();
      const code = text.match(/loc=([A-Z]{2})/)?.[1];
      if (code) {
        const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
        setDetectedCountry(name); detectedCountryRef.current = name;
        addLog("info", `Country: ${name} (${code})`);
        return name;
      }
    } catch {}
    addLog("warn", "Country detection failed — using Sri Lanka");
    return "Sri Lanka";
  }

  // ── resolve connection options (3-tier) ───────────────────────────────────────
  async function resolveConnection() {
    // Tier 1: conversation token from Laravel (best for private voice agents / WebRTC)
    try {
      addLog("api-start", "→ GET conversation token (Laravel)");
      const res  = await fetch(`${LARAVEL_API}/elevenlabs/conversation-token`);
      const data = await res.json();
      if (res.ok && data.conversation_token) {
        addLog("api-ok", "✓ Using conversation token (Laravel)");
        return { conversationToken: data.conversation_token };
      }
      addLog("warn", `Laravel: ${data.error || res.status}`);
    } catch (e) {
      addLog("warn", `Laravel unreachable: ${e.message}`);
    }

    // Tier 2: conversation token from ElevenLabs API directly (browser → EL, needs api key)
    if (EL_AGENT_ID && EL_API_KEY) {
      try {
        addLog("api-start", "→ GET conversation token (direct ElevenLabs API)");
        const res  = await fetch(
          `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(EL_AGENT_ID)}`,
          { headers: { "xi-api-key": EL_API_KEY } }
        );
        const data = await res.json();
        if (res.ok && data.token) {
          addLog("api-ok", "✓ Using conversation token (direct EL API)");
          return { conversationToken: data.token };
        }
        addLog("warn", `Direct EL API: ${JSON.stringify(data).slice(0, 120)}`);
      } catch (e) {
        addLog("warn", `Direct EL API error: ${e.message}`);
      }
    }

    // Tier 3: agentId only — works for PUBLIC agents (no auth required)
    if (EL_AGENT_ID) {
      addLog("warn", "Using agentId only — agent must be set to Public in ElevenLabs dashboard");
      return { agentId: EL_AGENT_ID };
    }

    throw new Error(
      "No ElevenLabs agent ID found.\n" +
      "Set VITE_ELEVENLABS_AGENT_ID in client/.env, " +
      "or fix ELEVENLABS_AGENT_ID in Laravel .env.\n" +
      "API key also needs permission to request a WebRTC conversation token."
    );
  }

  // ── connect ───────────────────────────────────────────────────────────────────
  async function handleConnect() {
    setError(""); setPhase("connecting"); setStatusMsg("Connecting to Aahaas AI…");
    setMicMuted(false);
    addLog("state", "Initiating connection");
    try {
      sessionTokenRef.current += 1;
      const sessionToken = sessionTokenRef.current;
      disconnectingRef.current = false;
      const preflightStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      preflightStream.getTracks().forEach((track) => track.stop());
      const country = await detectCountry();
      if (!isCurrentSession(sessionToken)) return;
      const connOpts = await resolveConnection();
      if (!isCurrentSession(sessionToken)) return;

      const systemPrompt = BASE_PROMPT
        .replace(/CALLER_COUNTRY/g, country) +
        `\n\nCALLER CONTEXT (detected)\n- Current country: ${country}\n- Session started: ${new Date().toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric" })}\n- "Next Friday" reference date is pre-calculated for you to use in defaults.`;

      addLog("api-start", `→ Conversation.startSession() [${connOpts.conversationToken ? "conversationToken" : connOpts.agentId ? `agentId=${connOpts.agentId}` : "unknown"}]`);

      const conv = await Conversation.startSession({
        ...connOpts,
        connectionType: "webrtc",

        overrides: {
          agent: {
            prompt: { prompt: systemPrompt },
            firstMessage: "Hello, this is Aahaas. How can I help today?",
          },
          tts: { voiceId: selectedVoiceRef.current },
        },

        // ── client tools ──────────────────────────────────────────────────────
        clientTools: {
          fetch_travel_package: async (params) => {
            addLog("api-start", `→ fetch_travel_package action="${params.action}"`);
            setPhase("searching"); setStatusMsg("Finding packages…"); setPackageStatus("loading");
            try {
              const res  = await fetch(SUGGEST_API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: params.customer_voice_prompt }),
              });
              const data = await res.json();
              pushApiResp("fetch_travel_package", data);
              if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

              const pkg = { ...data, action: params.action, ts: Date.now() };
              setFetchedPackages(p => [...p, pkg]);
              setPackageStatus("ready");

              // accumulate running summary for WhatsApp
              if (data.voice_text) {
                packageSummaryRef.current = data.voice_text;
              }

              if (params.action === "confirm") {
                setConfirmedPackage(data); confirmedPkgRef.current = data;
              }
              addLog("api-ok", `✓ Package: ${String(data.voice_text || "").slice(0, 80)}`);
              setPhase("listening"); setStatusMsg("Listening…");
              return data.voice_text || data.message || "Package details retrieved.";
            } catch (e) {
              addLog("api-err", `Package fetch failed: ${e.message}`);
              setPackageStatus("failed");
              setPhase("listening"); setStatusMsg("Listening…");
              return `Error retrieving package: ${e.message}`;
            }
          },

          send_whatsapp_quotation: async (params) => {
            addLog("api-start", `→ send_whatsapp to ${params.whatsapp_number}`);
            setPhase("sending_wa"); setStatusMsg("Sending WhatsApp quotation…");
            setQuotationStatus("sending");
            setQuotationInfo({ name: params.customer_name, phone: params.whatsapp_number });
            try {
              const confirmed = confirmedPkgRef.current;
              const summary   = params.summary ||
                packageSummaryRef.current ||
                (typeof confirmed?.voice_text === "string" ? confirmed.voice_text : "Aahaas Travel Package");

              const res  = await fetch(WHATSAPP_API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  prompt:       summary,
                  waId:         params.whatsapp_number,
                  customerName: params.customer_name,
                }),
              });
              const data = await res.json();
              pushApiResp("send_whatsapp", data);
              if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

              setQuotationStatus("sent");
              addLog("api-ok", `✓ WhatsApp sent to ${params.whatsapp_number}`);
              setPhase("listening"); setStatusMsg("Listening…");
              return "WhatsApp quotation sent successfully.";
            } catch (e) {
              addLog("api-err", `WhatsApp send failed: ${e.message}`);
              setQuotationStatus("failed");
              setPhase("listening"); setStatusMsg("Listening…");
              return `Error: ${e.message}`;
            }
          },
        },

        // ── event callbacks ───────────────────────────────────────────────────
        onConnect: ({ conversationId: cid }) => {
          if (!isCurrentSession(sessionToken)) return;
          setConversationId(cid || "");
          setPhase("connected"); setStatusMsg("Connected — listening for you");
          startTimer();
          addLog("api-ok", `✓ Connected — session ${cid}`);

          // Poll volume for waveform
          volumePollRef.current = setInterval(() => {
            if (!convRef.current) return;
            setMicLevel(convRef.current.getInputVolume?.() || 0);
            setAiLevel(convRef.current.getOutputVolume?.() || 0);
          }, 60);
        },

        onStatusChange: ({ status }) => {
          if (!isCurrentSession(sessionToken)) return;
          addLog("state", `Status → ${status}`);
        },

        onDisconnect: () => {
          if (!isCurrentSession(sessionToken)) return;
          disconnectingRef.current = true;
          addLog("state", "Disconnected");
          stopVolumePoll(); stopTimer();
          setMicLevel(0); setAiLevel(0);
          if (!["completed", "failed"].includes(phaseRef.current)) {
            setPhase("completed"); setStatusMsg("Call ended.");
          }
        },

        onMessage: ({ message, source }) => {
          if (!isCurrentSession(sessionToken)) return;
          if (!message?.trim()) return;
          if (source === "user") {
            setUserTranscript(message);
            pushMsg("user", message);
            addLog("event", `USER: ${message.slice(0, 80)}`);
          } else {
            setAiTranscript(message);
            pushMsg("assistant", message);
            addLog("event", `AI: ${message.slice(0, 80)}`);
          }
        },

        onModeChange: ({ mode }) => {
          if (!isCurrentSession(sessionToken)) return;
          addLog("state", `Mode → ${mode}`);
          if (mode === "speaking") {
            setPhase("agent_speaking"); setStatusMsg("AI is speaking…");
          } else {
            setPhase("listening"); setStatusMsg("Listening…");
          }
        },

        onError: (message, context) => {
          if (!isCurrentSession(sessionToken)) return;
          const msg = typeof message === "string" ? message : JSON.stringify(message);
          setError(msg); addLog("api-err", `EL error: ${msg}`);
        },
      });

      convRef.current = conv;
      disconnectingRef.current = false;
      addLog("api-ok", "Session active");

    } catch (err) {
      await teardown();
      setPhase("failed");
      // @11labs/client may throw non-standard error objects — extract whatever we can
      const errStr =
        err?.message ||
        (typeof err === "string" ? err : null) ||
        err?.reason ||
        err?.code ||
        (err ? JSON.stringify(err) : null) ||
        "Conversation.startSession() failed.\n\nCheck: agent exists, agent is set to Public in ElevenLabs dashboard, and the VITE_ELEVENLABS_AGENT_ID in client/.env is correct.";
      setError(errStr);
      setStatusMsg("Connection failed.");
      addLog("api-err", `Connect error: ${errStr}`);
    }
  }

  async function handleDisconnect() {
    addLog("state", "Hanging up");
    disconnectingRef.current = true;
    sessionTokenRef.current += 1;
    await teardown();
    setPhase("completed"); setStatusMsg("Call ended.");
    setMicLevel(0); setAiLevel(0);
  }

  async function handleReset() {
    disconnectingRef.current = true;
    sessionTokenRef.current += 1;
    await teardown();
    disconnectingRef.current = false;
    setPhase("idle"); setError(""); setStatusMsg("Tap call to connect");
    setConversation([]); setUserTranscript(""); setAiTranscript("");
    setPackageStatus("idle"); setFetchedPackages([]); setConfirmedPackage(null);
    packageSummaryRef.current = "";
    setQuotationStatus("idle"); setQuotationInfo(null);
    setTerminalLog([]); setApiResponses([]); setCallDuration(0);
    setMicLevel(0); setAiLevel(0); setConversationId(""); setMicMuted(false);
    setDetectedCountry("Sri Lanka"); detectedCountryRef.current = "Sri Lanka";
    confirmedPkgRef.current = null;
  }

  async function handleSaveReport() {
    if (!rptTitle.trim()) return;
    setRptSaving(true); setRptMsg("");
    try {
      const res = await fetch(`${LARAVEL_API}/aahaas-realtime/error-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: rptTitle, severity: rptSeverity, details: rptDetails,
          component: "AahaasRealtimeV03", conversation: conversation.slice(-10),
          conversation_id: conversationId, timestamp: new Date().toISOString(),
        }),
      });
      setRptMsg(res.ok ? "Report saved." : "Save failed.");
    } catch (e) { setRptMsg(`Error: ${e.message}`); }
    setRptSaving(false);
  }

  // ── derived ───────────────────────────────────────────────────────────────────
  const canConnect    = ["idle", "failed", "completed"].includes(phase);
  const canDisconnect = !canConnect && phase !== "connecting";
  const phaseInfo     = PHASES[phase] || PHASES.idle;
  const waveActive    = phase === "agent_speaking" || phase === "listening";
  const waColor  = { idle: "#6b7280", sending: "#f59e0b", sent: "#10b981", failed: "#ef4444" }[quotationStatus];
  const pkgColor = { idle: "#6b7280", loading: "#f59e0b", ready: "#10b981", failed: "#ef4444" }[packageStatus];
  const DEV_CARD = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 14px" };

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Space Grotesk','Segoe UI',system-ui,sans-serif", minHeight: "100vh", background: "#0f172a", display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes ring-pulse {
          0%,100% { transform: scale(1);   opacity: 0.7; }
          50%      { transform: scale(1.18); opacity: 0;   }
        }
        @keyframes wave-bar {
          0%,100% { transform: scaleY(0.25); }
          50%     { transform: scaleY(1);    }
        }
        @keyframes spin-ring {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .call-btn { transition: all 0.18s; }
        .call-btn:hover { filter: brightness(1.15); transform: scale(1.05); }
        .call-btn:active { transform: scale(0.96); }
        .dev-fade { animation: devFade 0.22s ease; }
        @keyframes devFade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
        @media (max-width: 520px) {
          .avatar-wrap { width: 170px !important; height: 170px !important; }
          .avatar-circle { width: 150px !important; height: 150px !important; }
        }
      `}</style>

      {/* ════════════════════════════════════════ CALL SCREEN */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "space-between", position: "relative",
        background: "linear-gradient(180deg,#0f172a 0%,#1e1b4b 60%,#0f172a 100%)",
        padding: "0 20px 28px", minHeight: 480,
      }}>

        {/* ── TOP BAR */}
        <div style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>✦</div>
            <div>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: 13, lineHeight: 1.2 }}>Aahaas Realtime V0.3</div>
              <div style={{ color: "#475569", fontSize: 10 }}>ElevenLabs Conversational AI</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {callDuration > 0 && (
              <span style={{ color: "#6ee7b7", fontSize: 12, fontFamily: "monospace", background: "rgba(16,185,129,0.15)", padding: "3px 10px", borderRadius: 8, border: "1px solid rgba(16,185,129,0.25)" }}>
                {msToTime(callDuration)}
              </span>
            )}
            <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 20, background: `${phaseInfo.color}20`, color: phaseInfo.color, border: `1px solid ${phaseInfo.color}40` }}>
              {phaseInfo.label}
            </span>
          </div>
        </div>

        {/* ── AVATAR + STATUS */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, justifyContent: "center", paddingTop: 16 }}>

          <div className="avatar-wrap" style={{ position: "relative", width: 210, height: 210, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
            {/* Spinning ring when connecting */}
            {phase === "connecting" && (
              <div style={{ position: "absolute", inset: -10, borderRadius: "50%", border: "2px solid transparent", borderTopColor: "#3b82f6", borderRightColor: "#3b82f6", animation: "spin-ring 1s linear infinite" }} />
            )}
            {/* Pulse rings */}
            {canDisconnect && phase !== "connecting" && (<>
              <div style={{ position: "absolute", inset: -14, borderRadius: "50%", background: `${phaseInfo.color}15`, border: `1px solid ${phaseInfo.color}28`, animation: `ring-pulse ${phase === "listening" ? "1.1s" : "2s"} ease-out infinite` }} />
              <div style={{ position: "absolute", inset: -6, borderRadius: "50%", background: `${phaseInfo.color}08`, border: `1px solid ${phaseInfo.color}20`, animation: `ring-pulse ${phase === "listening" ? "1.1s" : "2s"} ease-out infinite`, animationDelay: "0.3s" }} />
            </>)}
            {/* Avatar circle */}
            <div className="avatar-circle" style={{ width: 180, height: 180, borderRadius: "50%", background: "linear-gradient(145deg,#1e1b4b 0%,#2d2b6e 40%,#1e293b 100%)", border: `2.5px solid ${phaseInfo.color}60`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxShadow: `0 0 60px ${phaseInfo.color}18, 0 20px 60px rgba(0,0,0,0.5), inset 0 0 40px rgba(0,0,0,0.3)`, transition: "border-color 0.5s, box-shadow 0.5s", zIndex: 1 }}>
              <div style={{ fontSize: 42, marginBottom: 6, lineHeight: 1 }}>✦</div>
              <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em" }}>Aahaas</div>
              <div style={{ color: "#64748b", fontSize: 10, marginTop: 2, letterSpacing: "0.06em", textTransform: "uppercase" }}>AI Concierge</div>
            </div>
          </div>

          {/* Waveform bars */}
          <div style={{ height: 30, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 12 }}>
            {waveActive
              ? [0.6, 0.9, 0.5, 1.0, 0.7, 0.85, 0.45, 0.95, 0.6].map((d, i) => {
                  const vol = phase === "agent_speaking" ? aiLevel : micLevel;
                  return (
                    <div key={i} style={{ width: 4, height: 18, borderRadius: 3, background: phaseInfo.color, animation: `wave-bar ${0.5 + d * 0.5}s ease-in-out infinite`, animationDelay: `${i * 0.08}s`, opacity: 0.6 + Math.min(0.4, vol * 1.5) }} />
                  );
                })
              : null}
          </div>

          <p style={{ color: "#cbd5e1", fontSize: 15, margin: "0 0 6px", fontWeight: 500, textAlign: "center", minHeight: 22 }}>{statusMsg}</p>
          {detectedCountry && phase !== "idle" && (
            <p style={{ color: "#475569", fontSize: 12, margin: "0 0 4px" }}>📍 {detectedCountry}</p>
          )}
          {quotationStatus !== "idle" && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 12px", borderRadius: 20, background: `${waColor}18`, color: waColor, border: `1px solid ${waColor}30`, margin: "4px 0 0" }}>
              {quotationStatus === "sending" ? "⏳ Sending WhatsApp…" : quotationStatus === "sent" ? "✅ WhatsApp Sent" : "❌ WA Failed"}
            </span>
          )}
          {error && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "8px 16px", margin: "12px 0 0", maxWidth: 380, textAlign: "center" }}>
              <p style={{ color: "#fca5a5", fontSize: 12, margin: 0, lineHeight: 1.5 }}>{error}</p>
            </div>
          )}

          {/* Voice selector when idle */}
          {canConnect && (
            <div style={{ marginTop: 16 }}>
              <select value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)} style={{ background: "rgba(255,255,255,0.07)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "8px 14px", fontSize: 12, outline: "none", cursor: "pointer", minWidth: 240 }}>
                {EL_VOICES.map(v => <option key={v.id} value={v.id} style={{ background: "#1e293b" }}>{v.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* ── CONTROL BUTTONS */}
        <div style={{ display: "flex", alignItems: "center", gap: 22, marginTop: 8, paddingTop: 8 }}>

          {/* Mute */}
          <button className="call-btn" onClick={() => setMicMuted(p => !p)} disabled={!canDisconnect} title={micMuted ? "Unmute" : "Mute"} style={{ width: 60, height: 60, borderRadius: "50%", border: "none", cursor: canDisconnect ? "pointer" : "not-allowed", background: micMuted ? "rgba(239,68,68,0.22)" : "rgba(255,255,255,0.08)", color: micMuted ? "#fca5a5" : "#94a3b8", fontSize: 22, display: "flex", alignItems: "center", justifyContent: "center", opacity: canDisconnect ? 1 : 0.35, outline: micMuted ? "2px solid rgba(239,68,68,0.4)" : "none" }}>
            {micMuted ? "🔇" : "🎙"}
          </button>

          {/* Main call / hang up */}
          {canConnect ? (
            <button className="call-btn" onClick={phase === "connecting" ? undefined : handleConnect} disabled={phase === "connecting"} title="Start call" style={{ width: 78, height: 78, borderRadius: "50%", border: "none", cursor: phase === "connecting" ? "not-allowed" : "pointer", background: phase === "connecting" ? "rgba(59,130,246,0.3)" : "linear-gradient(135deg,#10b981,#059669)", color: "#fff", fontSize: 28, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 32px rgba(16,185,129,0.4)" }}>
              {phase === "connecting" ? "⌛" : "📞"}
            </button>
          ) : (
            <button className="call-btn" onClick={handleDisconnect} title="Hang up" style={{ width: 78, height: 78, borderRadius: "50%", border: "none", cursor: "pointer", background: "linear-gradient(135deg,#ef4444,#dc2626)", color: "#fff", fontSize: 28, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 32px rgba(239,68,68,0.4)" }}>
              📵
            </button>
          )}

          {/* Dev mode */}
          <button className="call-btn" onClick={() => setDevMode(p => !p)} title="Developer Mode" style={{ width: 60, height: 60, borderRadius: "50%", border: "none", cursor: "pointer", background: devMode ? "rgba(99,102,241,0.28)" : "rgba(255,255,255,0.08)", color: devMode ? "#a5b4fc" : "#94a3b8", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", outline: devMode ? "2px solid rgba(99,102,241,0.45)" : "none" }}>
            ⚙️
          </button>
        </div>

        {(phase === "completed" || phase === "failed") && (
          <button className="call-btn" onClick={handleReset} style={{ marginTop: 14, padding: "10px 28px", borderRadius: 28, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#e2e8f0", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
            New Call
          </button>
        )}
      </div>

      {/* ════════════════════════════════════════ DEVELOPER PANEL */}
      {devMode && (
        <div className="dev-fade" style={{ background: "#080e1a", borderTop: "1px solid rgba(99,102,241,0.2)", maxHeight: 500, display: "flex", flexDirection: "column" }}>

          {/* Tab bar */}
          <div style={{ display: "flex", overflowX: "auto", gap: 2, padding: "8px 12px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0, scrollbarWidth: "none" }}>
            {[{ id: "status", icon: "📊", label: "API Status" }, { id: "terminal", icon: "⌨️", label: "Terminal" }, { id: "chat", icon: "💬", label: "Chat" }, { id: "products", icon: "🏨", label: "Products" }, { id: "summary", icon: "📋", label: "Summary" }, { id: "reports", icon: "⚠️", label: "Reports" }].map(t => (
              <button key={t.id} onClick={() => setDevTab(t.id)} style={{ padding: "6px 14px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", background: devTab === t.id ? "rgba(99,102,241,0.18)" : "transparent", color: devTab === t.id ? "#a5b4fc" : "#4b5563", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0, outline: devTab === t.id ? "1px solid rgba(99,102,241,0.28)" : "none" }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 16px", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}>

            {/* ── STATUS */}
            {devTab === "status" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 10 }}>
                {[
                  { label: "ElevenLabs", value: canDisconnect ? "Connected" : phase === "connecting" ? "Connecting" : "Disconnected", color: canDisconnect ? "#10b981" : phase === "connecting" ? "#3b82f6" : "#6b7280" },
                  { label: "SDK", value: "@11labs/client", color: "#a5b4fc" },
                  { label: "Session ID", value: conversationId ? conversationId.slice(0, 14) + "…" : "—", color: conversationId ? "#a5b4fc" : "#374151" },
                  { label: "Voice", value: EL_VOICES.find(v => v.id === selectedVoice)?.name.split("·")[0].trim() || "—", color: "#f59e0b" },
                  { label: "Country", value: detectedCountry, color: "#38bdf8" },
                  { label: "Package", value: packageStatus, color: pkgColor },
                  { label: "WhatsApp", value: quotationStatus, color: waColor },
                  { label: "Mic Input", value: micMuted ? "Muted" : `${(micLevel * 100).toFixed(0)}%`, color: micMuted ? "#ef4444" : "#10b981" },
                  { label: "AI Output", value: `${(aiLevel * 100).toFixed(0)}%`, color: "#8b5cf6" },
                ].map(item => (
                  <div key={item.label} style={DEV_CARD}>
                    <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>{item.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: item.color }}>{item.value}</div>
                  </div>
                ))}
                {apiResponses.length > 0 && (
                  <div style={{ ...DEV_CARD, gridColumn: "1/-1" }}>
                    <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Last API Response — <span style={{ color: "#a5b4fc" }}>{apiResponses[apiResponses.length - 1]?.type}</span></div>
                    <pre style={{ fontSize: 10, color: "#64748b", margin: 0, overflowX: "auto", maxHeight: 150, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {JSON.stringify(apiResponses[apiResponses.length - 1]?.data, null, 2)?.slice(0, 800)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* ── TERMINAL */}
            {devTab === "terminal" && (
              <div style={{ fontFamily: "monospace", fontSize: 11 }}>
                {terminalLog.length === 0
                  ? <p style={{ color: "#374151" }}>No entries yet. Start a call to see live events.</p>
                  : terminalLog.map((e, i) => (
                    <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.025)", display: "flex", gap: 10, alignItems: "baseline" }}>
                      <span style={{ color: "#374151", flexShrink: 0, fontSize: 10 }}>{e.ts}</span>
                      <span style={{ flexShrink: 0, width: 72, fontSize: 9, fontWeight: 800, letterSpacing: "0.04em", color: { info: "#94a3b8", warn: "#f59e0b", state: "#38bdf8", "api-start": "#f59e0b", "api-ok": "#10b981", "api-err": "#ef4444", event: "#374151" }[e.type] || "#4b5563" }}>
                        {e.type.toUpperCase()}
                      </span>
                      <span style={{ color: "#e2e8f0", wordBreak: "break-all", lineHeight: 1.5 }}>{e.msg}</span>
                    </div>
                  ))}
                <div ref={terminalEndRef} />
              </div>
            )}

            {/* ── CHAT */}
            {devTab === "chat" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {conversation.length === 0
                  ? <p style={{ color: "#374151", fontSize: 12 }}>Start a call to see the conversation transcript.</p>
                  : conversation.map((msg, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                      <div style={{ maxWidth: "82%", padding: "8px 12px", borderRadius: 12, background: msg.role === "user" ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.05)", border: `1px solid ${msg.role === "user" ? "rgba(99,102,241,0.28)" : "rgba(255,255,255,0.08)"}` }}>
                        <div style={{ fontSize: 9, color: "#4b5563", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{msg.role === "user" ? "You" : "Aahaas AI"}</div>
                        <p style={{ margin: 0, fontSize: 12, color: "#e2e8f0", lineHeight: 1.55 }}>{msg.content}</p>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* ── PRODUCTS */}
            {devTab === "products" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {fetchedPackages.length === 0
                  ? <p style={{ color: "#374151", fontSize: 12 }}>No packages yet. Ask about a destination.</p>
                  : fetchedPackages.map((pkg, i) => (
                    <div key={i} style={DEV_CARD}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#a5b4fc" }}>Package #{i + 1} — <span style={{ color: "#f59e0b" }}>{pkg.action || "—"}</span></span>
                        <span style={{ fontSize: 10, color: "#374151" }}>{pkg.ts ? new Date(pkg.ts).toLocaleTimeString() : ""}</span>
                      </div>
                      {pkg.voice_text && <p style={{ fontSize: 12, color: "#e2e8f0", margin: "0 0 10px", lineHeight: 1.55 }}>{pkg.voice_text}</p>}
                      {pkg.pricing?.grand_total && (
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 10px", borderRadius: 6 }}>
                          {pkg.currency || ""} {pkg.pricing.grand_total}
                        </span>
                      )}
                      <details style={{ marginTop: 10 }}>
                        <summary style={{ fontSize: 10, color: "#4b5563", cursor: "pointer" }}>Raw JSON</summary>
                        <pre style={{ fontSize: 10, color: "#374151", overflow: "auto", maxHeight: 130, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "6px 0 0" }}>
                          {JSON.stringify(pkg, null, 2)?.slice(0, 900)}
                        </pre>
                      </details>
                    </div>
                  ))}
              </div>
            )}

            {/* ── SUMMARY */}
            {devTab === "summary" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={DEV_CARD}>
                  <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Customer</div>
                  {quotationInfo ? (
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", alignItems: "baseline" }}>
                      {[["Name", quotationInfo.name], ["WhatsApp", `+${quotationInfo.phone}`], ["Country", detectedCountry], ["WA Status", quotationStatus.toUpperCase()]].map(([k, v]) => (
                        <>{`${k}`&&<span key={k+"k"} style={{ fontSize: 10, color: "#4b5563" }}>{k}</span>}<span key={k+"v"} style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{v}</span></>
                      ))}
                    </div>
                  ) : <p style={{ fontSize: 12, color: "#374151", margin: 0 }}>Waiting for customer to confirm the package…</p>}
                </div>

                {confirmedPackage?.voice_text && (
                  <div style={DEV_CARD}>
                    <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Confirmed Travel Summary</div>
                    <p style={{ fontSize: 12, color: "#e2e8f0", margin: 0, lineHeight: 1.6 }}>
                      {typeof confirmedPackage.voice_text === "string" ? confirmedPackage.voice_text : JSON.stringify(confirmedPackage.voice_text)}
                    </p>
                  </div>
                )}

                <div style={DEV_CARD}>
                  <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Session</div>
                  <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.7 }}>
                    {callStartRef.current > 0 && <>Started: {new Date(callStartRef.current).toLocaleString()}<br /></>}
                    Duration: {msToTime(callDuration)}<br />
                    Messages: {conversation.length}<br />
                    Packages fetched: {fetchedPackages.length}<br />
                    Conv ID: <span style={{ fontFamily: "monospace", color: "#a5b4fc" }}>{conversationId || "—"}</span>
                  </div>
                </div>

                {(userTranscript || aiTranscript) && (
                  <div style={DEV_CARD}>
                    <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Live Transcripts</div>
                    {userTranscript && <><div style={{ fontSize: 9, color: "#4b5563", marginBottom: 3 }}>CALLER</div><p style={{ fontSize: 12, color: "#e2e8f0", margin: "0 0 8px" }}>{userTranscript}</p></>}
                    {aiTranscript   && <><div style={{ fontSize: 9, color: "#4b5563", marginBottom: 3 }}>AAHAAS AI</div><p style={{ fontSize: 12, color: "#a5b4fc", margin: 0 }}>{aiTranscript}</p></>}
                  </div>
                )}
              </div>
            )}

            {/* ── REPORTS */}
            {devTab === "reports" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={DEV_CARD}>
                  <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12 }}>Submit Test Report</div>
                  <input value={rptTitle} onChange={e => setRptTitle(e.target.value)} placeholder="Report title…" style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#e2e8f0", fontSize: 12, marginBottom: 10, outline: "none", boxSizing: "border-box" }} />
                  <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    {["low", "medium", "high", "critical"].map(sv => {
                      const c = { low: "#10b981", medium: "#f59e0b", high: "#f97316", critical: "#ef4444" }[sv];
                      return <button key={sv} onClick={() => setRptSeverity(sv)} style={{ flex: 1, padding: "5px 0", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 800, background: rptSeverity === sv ? `${c}22` : "rgba(255,255,255,0.04)", color: rptSeverity === sv ? c : "#374151", outline: rptSeverity === sv ? `1px solid ${c}40` : "none", textTransform: "uppercase", letterSpacing: "0.06em" }}>{sv}</button>;
                    })}
                  </div>
                  <textarea value={rptDetails} onChange={e => setRptDetails(e.target.value)} placeholder="Describe what happened…" rows={4} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#e2e8f0", fontSize: 12, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.5 }} />
                  <button onClick={handleSaveReport} disabled={rptSaving || !rptTitle.trim()} style={{ width: "100%", marginTop: 10, padding: "9px", borderRadius: 9, border: "none", cursor: rptSaving ? "not-allowed" : "pointer", background: "rgba(99,102,241,0.22)", color: "#a5b4fc", fontWeight: 700, fontSize: 12, outline: "1px solid rgba(99,102,241,0.3)", opacity: rptSaving ? 0.6 : 1 }}>
                    {rptSaving ? "Saving…" : "Save Report"}
                  </button>
                  {rptMsg && <p style={{ fontSize: 11, color: rptMsg.includes("saved") ? "#10b981" : "#f87171", margin: "8px 0 0", textAlign: "center" }}>{rptMsg}</p>}
                </div>

                {canDisconnect && (
                  <div style={DEV_CARD}>
                    <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Live Mic Level</div>
                    <div style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(100, micLevel * 700)}%`, borderRadius: 4, background: micMuted ? "#ef4444" : "#10b981", transition: "width 0.1s" }} />
                    </div>
                    <p style={{ fontSize: 10, color: "#374151", margin: "6px 0 0" }}>{micMuted ? "Mic is muted" : `Input: ${(micLevel * 100).toFixed(1)}%`}</p>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
