import { WebSocketServer, WebSocket } from "ws";
import config from "./config.js";

const REALTIME_MODEL = "gpt-realtime-2";
const OPENAI_WS_URL  = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

const SYSTEM_PROMPT = `You are Aahaas AI, a warm live-call receptionist for Aahaas. Sound natural, quick, and human on the phone. Never sound scripted or robotic.

START: Begin immediately with a short, warm greeting — one of these:
"Hello, this is Aahaas. How can I help?"
"Hi, Aahaas here. What can I do for you?"
"Good day, Aahaas speaking. How can I help?"

GOAL:
- Keep replies to 1-2 short spoken sentences.
- Move the conversation forward in one turn.
- Ask only one clear question at a time.

DEFAULTS (never ask about these unless the caller changes them):
- 2 travelers, 3-star hotel, 3 nights, starting next week, Sri Lanka origin.

PACKAGE RULES:
- As soon as travel intent is clear, call fetch_travel_package immediately.
- While the package loads, say one short natural line like "Let me check options for you."
- When the package is ready, present it in one short spoken paragraph and ask if it works.
- If the caller wants changes, acknowledge and ask for the one new detail.

CONTACT RULES:
- Only collect full name and WhatsApp number after the package is confirmed.
- Do not ask for email.

VOICE STYLE:
- Use contractions: "I'll", "you'll", "we've".
- Use short natural phrases: "Sure", "Of course", "Got it", "Perfect", "Absolutely".
- Avoid: "please continue", "I have recorded that", "thank you for providing that information".

CLOSING: Once the caller confirms everything, say: "Thanks for calling Aahaas. We'll send the details via WhatsApp shortly."`;

const REALTIME_TOOLS = [
  {
    type: "function",
    name: "fetch_travel_package",
    description: "Look up a travel package from Aahaas based on the caller's requirements. Call this as soon as travel intent is clear.",
    parameters: {
      type: "object",
      properties: {
        destination:      { type: "string",  description: "Travel destination country or city" },
        travelers:        { type: "integer", description: "Number of travelers (default 2)" },
        nights:           { type: "integer", description: "Number of nights (default 3)" },
        hotel_stars:      { type: "integer", description: "Hotel star rating 1-5 (default 3)" },
        start_date:       { type: "string",  description: "Travel start date or timeframe" },
        purpose:          { type: "string",  description: "Purpose of travel" },
        special_requests: { type: "string",  description: "Any special requests" },
      },
      required: ["destination"],
    },
  },
];

function buildSessionUpdate(voice = "coral") {
  return JSON.stringify({
    type: "session.update",
    session: {
      type:              "realtime",       // required by GA API
      instructions:      SYSTEM_PROMPT,
      output_modalities: ["audio"],        // GA API only supports ["audio"] OR ["text"], not both
      audio: {
        input: {
          turn_detection: {
            type:                "server_vad",
            threshold:           0.8,   // raised from 0.5 — only real speech, not ambient noise
            prefix_padding_ms:   300,
            silence_duration_ms: 1000,  // wait 1 s of silence before committing
            create_response:     true,
          },
          transcription: { model: "gpt-realtime-whisper" },  // GA API model name
        },
        output: {
          voice,                           // moved under audio.output in GA API
        },
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
    const url   = new URL(req.url, `http://localhost`);
    const voice = url.searchParams.get("voice") || "coral";

    console.log(`[Realtime] Browser connected — voice: ${voice}`);

    // Open connection to OpenAI Realtime GA API
    const openaiWs = new WebSocket(OPENAI_WS_URL, {
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
    });

    let openaiReady     = false;
    const pendingToAI   = [];   // messages buffered before OpenAI is ready

    openaiWs.on("open", () => {
      openaiReady = true;
      console.log("[Realtime] OpenAI connection open — sending session.update");

      // Configure session server-side (API key never leaves the server)
      openaiWs.send(buildSessionUpdate(voice));

      // Flush any messages the client sent before OpenAI was ready
      for (const msg of pendingToAI) openaiWs.send(msg);
      pendingToAI.length = 0;
    });

    // OpenAI → browser
    // The `ws` library delivers messages as Buffer objects regardless of whether
    // the frame was text or binary. Calling .toString() converts the Buffer back
    // to a UTF-8 string so the browser receives a TEXT frame that JSON.parse can read.
    openaiWs.on("message", (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data.toString("utf8"));
      }
    });

    // Browser → OpenAI
    // Same issue in the other direction: convert Buffer to string so OpenAI
    // receives a text frame (it only accepts text frames for JSON events).
    clientWs.on("message", (data) => {
      const text = data.toString("utf8");
      if (openaiReady && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.send(text);
      } else {
        pendingToAI.push(text);
      }
    });

    function sendErrorToClient(message) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "error", error: { message } }));
      }
    }

    function cleanup(reason) {
      console.log(`[Realtime] Closing — ${reason}`);
      if (openaiWs.readyState === WebSocket.OPEN)  openaiWs.close();
      if (clientWs.readyState  === WebSocket.OPEN)  clientWs.close();
    }

    clientWs.on("close",  () => cleanup("browser disconnected"));
    clientWs.on("error",  (e) => { sendErrorToClient(`Proxy error: ${e.message}`); cleanup(`browser error: ${e.message}`); });
    openaiWs.on("close",  (code, reason) => { sendErrorToClient(`OpenAI closed: ${code} ${reason}`); cleanup(`OpenAI disconnected (${code})`); });
    openaiWs.on("error",  (e) => { sendErrorToClient(`OpenAI error: ${e.message}`); cleanup(`OpenAI error: ${e.message}`); });
  });

  console.log(`[Realtime] WebSocket proxy ready at ws://localhost:${config.port}/api/realtime`);
}
