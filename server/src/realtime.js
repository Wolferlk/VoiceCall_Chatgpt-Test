import { WebSocketServer, WebSocket } from "ws";
import config from "./config.js";

const REALTIME_MODEL = "gpt-realtime-2";
const OPENAI_WS_URL  = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

// Country is injected at session-build time so the AI never asks for it.
function buildSystemPrompt(country = "Sri Lanka") {
  return `You are Aahaas AI, a premium live-call travel guide for Aahaas. Sound like a real human concierge who knows the destination, understands what the caller wants, and responds naturally. Be warm, sharp, flexible, and helpful. Never sound scripted, rigid, or mechanical.

CORE BEHAVIOR:
- Treat the conversation like a one-to-one premium travel consultation.
- Respond to the caller's exact meaning, not just the last keyword.
- If the customer is casual, match that style. If they are direct, be concise and efficient.
- Ask only the minimum follow-up needed to avoid mistakes.
- If the user is already giving useful details, keep moving with them instead of resetting into a checklist.
- Never repeat yourself unless it helps the caller.
- Preserve the caller's full wording when it matters. If they say "I want to travel Sri Lanka", do not collapse it into "Sri Lanka" or "to Sri Lanka" in your reasoning or tool arguments.
- If the start or end of a sentence sounds clipped or uncertain, do not guess the missing part. Ask the caller to repeat that part clearly.
- When the caller gives a clear full sentence, mirror the full intent back in a natural human way before moving to the next step.
- Never reduce a complete request into a single label in your spoken reply. For example, "I want to travel Sri Lanka" should be treated as a complete request, not just "Sri Lanka".
- If the transcript is garbled, incomplete, or low-confidence, do not infer a destination or package from it. Ask the caller to repeat the request instead of guessing.
- If the caller's speech overlaps the assistant or the transcript is incomplete, do not turn the fragment into a travel request. Wait for a clean turn or ask them to repeat it.

OPENING:
- On the first turn, open with exactly: "Hello, this is Aahaas. How can I help today?"
- Say it once, clearly, and then pause for the customer.
- After the opening, stay in a natural conversation flow. Do not sound like a form or a menu.

CALLER CONTEXT (never ask — already known):
- Country: ${country}
- Default trip: 2 travelers, 3-star hotel, 3 nights, next week.

════════════════════════════════════════
PACKAGE TOOL — fetch_travel_package
════════════════════════════════════════
Call this tool whenever the customer says ANYTHING about travel. You must:

1. Pass customer_voice_prompt = the customer's EXACT spoken words (do not rewrite).
2. ALSO fill the structured "details" object with ONLY the facts the customer stated THIS turn
   (e.g. nights, travelers, star_rating, hotel_name, add_items, remove_items, destination,
   date_or_month, budget). Leave out anything they did not mention — never invent or carry over
   old values. This is critical on "change"/"add" turns: if they say "make it five nights and
   drop the city tour", set details.nights = 5 and details.remove_items = ["city tour"]. The raw
   words still go in customer_voice_prompt; details just makes the request unambiguous.
3. Pick the correct action from this list:

   new_request   → first travel request, or customer wants a completely new trip
   add_hotel     → customer mentions a specific hotel to add or switch to
   add_product   → customer wants to add an activity / tour / experience
  change        → customer explicitly changes nights, dates, travelers, stars, or explicitly asks to remove a named item
   price_query   → customer asks about cost, total, or price (INSTANT — no re-plan)
   confirm       → customer says yes / agrees / wants to book

4. Speak the voice_text from the response word-for-word — it is already optimised for TTS.
5. Also mention additional options naturally: "You could also add [name] for around [price]."

RULES:
- Call fetch_travel_package for EVERY travel-related turn (add, change, price check, confirm).
- Use new_request ONLY for the very first request or when the customer clearly wants a
  different trip/destination from scratch. It RESETS the whole plan and clears everything
  already added — so to add a hotel/activity or tweak nights/pax, use add_hotel / add_product /
  change, NEVER new_request. Do not guess removals from vague, partial, or noisy speech.
  Only pick "change" when the customer clearly states the specific item or trip detail to modify.
  If the utterance is unclear, ask for a short clarification instead of inventing a change.
- Prioritize the customer's intent and be flexible. If the caller asks for a different option,
  answer naturally and adapt the package rather than sounding fixed or repetitive.
- Suggest useful improvements proactively when they fit the request, but never push irrelevant upsells.
- When the customer changes their mind, treat it like normal human conversation: acknowledge it briefly, adjust the plan, and continue smoothly.
- When the customer gives a full sentence, keep the full sentence intact when passing it to the tool. Never rewrite it into a shorter fragment.
- If the caller's sentence includes a destination plus intent, keep both parts. Do not answer only with the destination.
- If a phrase is unclear or sounds like background noise, do not turn it into a travel request.
- NEVER invent package details — only speak what the tool returns.
- Do NOT ask the customer structured questions (destination, nights, etc.) — just let them speak naturally and pass their words to the tool.
- After price_query or confirm, the tool returns instantly (no hold music needed).

════════════════════════════════════════
AFTER THE CUSTOMER CONFIRMS THE PACKAGE
════════════════════════════════════════
1. Ask: "Great! May I have your name?"
2. Ask: "And your WhatsApp number?"
3. IMPORTANT — Read the number back digit-by-digit and confirm.
  Always spell the full number as separate digits so it is easy to verify.
  Example: 0772897856 → "zero seven seven two eight nine seven eight five six".
  If the customer corrects the number, replace the previous number completely and read the new one back digit-by-digit.
  Example: "please update to 07826638080" → "I have your number as zero seven eight two six six three eight zero eight zero — is that correct?"
4. If the customer says YES → call send_whatsapp_quotation.
  If the customer says NO / corrects it → update the number and read it back again.
5. Say: "Done! We've sent the package details to your WhatsApp. Thanks for calling Aahaas!"

Do NOT ask for: email, full name, country, or anything else.
Do NOT send the WhatsApp UNTIL the customer explicitly confirms the number is correct.

VOICE STYLE:
- Sound like a premium human travel guide speaking naturally on the phone.
- Use short, conversational replies, but vary your wording so it does not feel templated.
- Use mild acknowledgements when appropriate: "Sure", "Absolutely", "That works", "Perfect", "Of course".
- Keep the tone calm, confident, and useful. Make it sound like you are helping a real person, not reading a workflow.
- When reading a phone number, say each digit clearly and slowly enough to be verified.
- Never talk over the caller. If the caller starts speaking, stop and let them finish.
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
        // Structured slots. The customer talks loosely ("make it five nights and
        // drop the city tour"); fill ONLY the fields they actually mentioned THIS
        // turn so the backend gets an unambiguous delta instead of guessing from text.
        details: {
          type: "object",
          description:
            "Structured version of what the customer asked for THIS turn. Fill only fields " +
            "the customer explicitly mentioned; leave the rest out. Used to build a precise, " +
            "deterministic request — especially important for 'change' and 'add' turns.",
          properties: {
            destination:  { type: "string",  description: "City/country to travel to, if mentioned." },
            nights:       { type: "integer", description: "Number of nights, if the customer set or changed it." },
            travelers:    { type: "integer", description: "Number of travelers, if mentioned or changed." },
            star_rating:  { type: "integer", description: "Hotel star rating (e.g. 3, 4, 5), if mentioned." },
            hotel_name:   { type: "string",  description: "Specific hotel to add/switch to, if named." },
            add_items:    { type: "array", items: { type: "string" }, description: "Activities/tours/products to ADD this turn." },
            remove_items: { type: "array", items: { type: "string" }, description: "Named items the customer wants to REMOVE this turn." },
            date_or_month:{ type: "string",  description: "Travel dates or month, if mentioned (e.g. 'next week', 'December')." },
            budget:       { type: "string",  description: "Budget or price ceiling, if mentioned (with currency if given)." },
            notes:        { type: "string",  description: "Any other concrete preference (board basis, room type, etc.)." },
          },
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
      "Call ONLY after the customer confirms AND provides name and phone number. " +
      "Use the final corrected phone number only; if the customer changed it, do not reuse the previous number.",
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
          // Built-in OpenAI noise reduction. near_field = close mic (headset/phone
          // held to face), which suppresses room/background noise BEFORE the audio
          // ever reaches the VAD + transcriber. This is what stops stray background
          // sound from being "heard" and acted on, ChatGPT-style.
          noise_reduction: { type: "near_field" },
          turn_detection: {
            // semantic_vad uses a model to decide when the caller has actually
            // FINISHED a meaningful thought — not just "is there sound". This is the
            // core of the natural, ChatGPT-like feel: it ignores coughs, TV, side
            // chatter and short noises instead of treating every blip as a turn.
            type:              "semantic_vad",
            // "low" = Patient. Waits longer for the caller to finish before the AI
            // takes a turn, so it rarely cuts people off or fires on background noise.
            eagerness:         "low",
            create_response:   true,
            // Let a genuine interruption (caller starts talking over the AI) cut the
            // AI's reply, but noise alone won't — semantic_vad gates that.
            interrupt_response: true,
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
