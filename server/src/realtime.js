import { WebSocketServer, WebSocket } from "ws";
import config from "./config.js";

const REALTIME_MODEL = "gpt-realtime-2";
const OPENAI_WS_URL  = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

// Country is injected at session-build time so the AI never asks for it.
function buildSystemPrompt(country = "Sri Lanka") {
  return `You are Aahaas AI, a warm live-call receptionist for Aahaas. Sound natural, quick, and human. Never scripted or robotic.

START: Greet immediately: "Hello, this is Aahaas. How can I help?"

CALLER CONTEXT (never ask — already known):
- Country: ${country}
- Default trip: 2 travelers, 3-star hotel, 3 nights, next week.

════════════════════════════════════════
PACKAGE TOOL — fetch_travel_package
════════════════════════════════════════
Call this tool whenever the customer says ANYTHING about travel. You must:

1. Pass customer_voice_prompt = the customer's EXACT spoken words (do not rewrite).
2. Pick the correct action from this list:

   new_request   → first travel request, or customer wants a completely new trip
   add_hotel     → customer mentions a specific hotel to add or switch to
   add_product   → customer wants to add an activity / tour / experience
   change        → customer changes nights, dates, travelers, stars, or removes something
   price_query   → customer asks about cost, total, or price (INSTANT — no re-plan)
   confirm       → customer says yes / agrees / wants to book

3. Speak the voice_text from the response word-for-word — it is already optimised for TTS.
4. Also mention additional options naturally: "You could also add [name] for around [price]."

RULES:
- Call fetch_travel_package for EVERY travel-related turn (add, change, price check, confirm).
- NEVER invent package details — only speak what the tool returns.
- Do NOT ask the customer structured questions (destination, nights, etc.) — just let them speak naturally and pass their words to the tool.
- After price_query or confirm, the tool returns instantly (no hold music needed).

════════════════════════════════════════
AFTER THE CUSTOMER CONFIRMS THE PACKAGE
════════════════════════════════════════
1. Ask: "Great! May I have your name?"
2. Ask: "And your WhatsApp number?"
3. IMPORTANT — Read the number back digit-by-digit and confirm:
   "I have your number as [read number clearly] — is that correct?"
4. If the customer says YES → call send_whatsapp_quotation.
   If the customer says NO / corrects it → update the number and read it back again.
5. Say: "Done! We've sent the package details to your WhatsApp. Thanks for calling Aahaas!"

Do NOT ask for: email, full name, country, or anything else.
Do NOT send the WhatsApp UNTIL the customer explicitly confirms the number is correct.

VOICE STYLE:
- Short natural phrases: "Sure", "Of course", "Got it", "Perfect", "Absolutely".
- Use contractions. Keep every reply 1-2 sentences.
- Never say "please continue" or "thank you for providing".`;
}

const REALTIME_TOOLS = [
  {
    type: "function",
    name: "fetch_travel_package",
    description:
      "Call the Aahaas travel package API with the customer's exact voice utterance and the detected action type. " +
      "Call this on EVERY travel-related turn — new request, hotel change, activity add, price check, or confirmation. " +
      "The session is maintained automatically between calls.",
    parameters: {
      type: "object",
      properties: {
        customer_voice_prompt: {
          type: "string",
          description: "The customer's exact spoken words this turn — do NOT rephrase or summarise.",
        },
        action: {
          type: "string",
          enum: ["new_request", "add_hotel", "add_product", "change", "price_query", "confirm"],
          description:
            "Detected intent: new_request=first trip or new destination, add_hotel=add/switch hotel, " +
            "add_product=add activity/tour/experience, change=modify nights/dates/pax/stars/remove, " +
            "price_query=ask cost (instant), confirm=customer agrees to book.",
        },
      },
      required: ["customer_voice_prompt", "action"],
    },
  },
  {
    type: "function",
    name: "send_whatsapp_quotation",
    description:
      "Send the confirmed package to the customer via WhatsApp. " +
      "Call ONLY after the customer confirms AND provides name and phone number.",
    parameters: {
      type: "object",
      properties: {
        customer_name:   { type: "string", description: "Customer's first name or preferred name" },
        phone_number:    { type: "string", description: "Customer's WhatsApp phone number (any format)" },
        package_summary: { type: "string", description: "Full confirmed package: destination, hotel, activities, nights, total price, currency" },
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
