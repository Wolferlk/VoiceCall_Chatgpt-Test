import { WebSocketServer, WebSocket } from "ws";
import config from "./config.js";

const REALTIME_MODEL = "gpt-realtime-2";
const OPENAI_WS_URL  = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

// Country is injected at session-build time so the AI never asks for it.
function buildSystemPrompt(country = "Sri Lanka") {
  return `You are Aahaas AI, a warm live-call receptionist for Aahaas. Sound natural, quick, and human on the phone. Never sound scripted or robotic.

START: Begin immediately with a short, warm greeting:
"Hello, this is Aahaas. How can I help?"

GOAL:
- Keep replies to 1-2 short spoken sentences.
- Ask only one clear question at a time.

CALLER CONTEXT (already known — NEVER ask the caller for these):
- Caller's country: ${country}
- Default trip: 2 travelers, 3-star hotel, 3 nights, starting next week.

PACKAGE RULES:
- As soon as travel intent is clear, call fetch_travel_package immediately.
- Say one short line while loading: "Let me check the best options for you."
- Present the package in one short spoken paragraph and ask: "Does that work for you?"
- If the caller wants changes, acknowledge and ask for the one new detail.
- Re-fetch with updated requirements if the caller asks for changes.

AFTER PACKAGE CONFIRMATION:
1. Ask for their first name: "Great! May I have your name?"
2. Ask for their WhatsApp number: "And your WhatsApp number?"
3. Call send_whatsapp_quotation immediately with the name, number, and package summary.
4. Say: "Perfect! I've sent the package details to your WhatsApp. Thanks for calling Aahaas!"

RULES:
- Do NOT ask for: email, full name, country, or any other detail beyond name and phone.
- Do NOT make up package details — only present what fetch_travel_package returns.
- Keep current_living_country as ${country} throughout.

VOICE STYLE:
- Use contractions: "I'll", "you'll", "we've".
- Use short natural phrases: "Sure", "Of course", "Got it", "Perfect", "Absolutely".
- Avoid: "please continue", "I have recorded that", "thank you for providing".`;
}

const REALTIME_TOOLS = [
  {
    type: "function",
    name: "fetch_travel_package",
    description: "Search Aahaas for a travel package matching the caller's requirements. Call this as soon as travel intent is clear. Only present packages returned by this function — never invent details.",
    parameters: {
      type: "object",
      properties: {
        destination:      { type: "string",  description: "Travel destination country or city" },
        travelers:        { type: "integer", description: "Number of travelers (default 2)" },
        nights:           { type: "integer", description: "Number of nights (default 3)" },
        hotel_stars:      { type: "integer", description: "Hotel star rating 1-5 (default 3)" },
        start_date:       { type: "string",  description: "Travel start date or timeframe" },
        purpose:          { type: "string",  description: "Purpose of travel (leisure, honeymoon, family, etc.)" },
        special_requests: { type: "string",  description: "Special requests or preferences" },
      },
      required: ["destination"],
    },
  },
  {
    type: "function",
    name: "send_whatsapp_quotation",
    description: "Send the confirmed travel package quotation to the customer via WhatsApp. Call this ONLY after the customer has confirmed the package AND provided their name and phone number.",
    parameters: {
      type: "object",
      properties: {
        customer_name:   { type: "string", description: "Customer's first name or preferred name" },
        phone_number:    { type: "string", description: "Customer's WhatsApp phone number (any format)" },
        package_summary: { type: "string", description: "Complete description of the confirmed travel package including destination, nights, hotel, activities, and price" },
      },
      required: ["customer_name", "phone_number", "package_summary"],
    },
  },
];

function buildSessionUpdate(voice = "coral", country = "Sri Lanka") {
  return JSON.stringify({
    type: "session.update",
    session: {
      type:              "realtime",
      instructions:      buildSystemPrompt(country),
      output_modalities: ["audio"],
      audio: {
        input: {
          turn_detection: {
            type:                "server_vad",
            threshold:           0.8,
            prefix_padding_ms:   300,
            silence_duration_ms: 1000,
            create_response:     true,
          },
          transcription: { model: "gpt-realtime-whisper" },
        },
        output: { voice },
      },
      tools:       REALTIME_TOOLS,
      tool_choice: "auto",
    },
  });
}

export function setupRealtimeProxy(httpServer) {
  if (!config.openaiApiKey) {
    console.warn("[Realtime] OPENAI_API_KEY not set — proxy disabled.");
    return;
  }

  const wss = new WebSocketServer({ server: httpServer, path: "/api/realtime" });

  wss.on("connection", (clientWs, req) => {
    const url     = new URL(req.url, `http://localhost`);
    const voice   = url.searchParams.get("voice")   || "coral";
    const country = url.searchParams.get("country") || "Sri Lanka";

    console.log(`[Realtime] Connected — voice: ${voice}, country: ${country}`);

    const openaiWs = new WebSocket(OPENAI_WS_URL, {
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
    });

    let openaiReady   = false;
    const pendingToAI = [];

    openaiWs.on("open", () => {
      openaiReady = true;
      console.log("[Realtime] OpenAI open — sending session.update");
      openaiWs.send(buildSessionUpdate(voice, country));
      for (const msg of pendingToAI) openaiWs.send(msg);
      pendingToAI.length = 0;
    });

    openaiWs.on("message", (data) => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data.toString("utf8"));
    });

    clientWs.on("message", (data) => {
      const text = data.toString("utf8");
      if (openaiReady && openaiWs.readyState === WebSocket.OPEN) openaiWs.send(text);
      else pendingToAI.push(text);
    });

    function sendErrorToClient(message) {
      if (clientWs.readyState === WebSocket.OPEN)
        clientWs.send(JSON.stringify({ type: "error", error: { message } }));
    }

    function cleanup(reason) {
      console.log(`[Realtime] Closing — ${reason}`);
      if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
      if (clientWs.readyState  === WebSocket.OPEN) clientWs.close();
    }

    clientWs.on("close",  ()  => cleanup("browser disconnected"));
    clientWs.on("error",  (e) => { sendErrorToClient(`Proxy: ${e.message}`); cleanup(e.message); });
    openaiWs.on("close",  (c, r) => { sendErrorToClient(`OpenAI closed: ${c} ${r}`); cleanup(`OpenAI (${c})`); });
    openaiWs.on("error",  (e) => { sendErrorToClient(`OpenAI error: ${e.message}`); cleanup(e.message); });
  });

  console.log(`[Realtime] Proxy ready — ws://localhost:${config.port}/api/realtime`);
}
