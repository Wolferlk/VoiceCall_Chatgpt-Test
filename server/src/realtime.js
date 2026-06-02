import { WebSocketServer, WebSocket } from "ws";
import config from "./config.js";

const REALTIME_MODEL = "gpt-realtime-2";
const OPENAI_WS_URL  = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

// Country is injected at session-build time so the AI never asks for it.
function buildSystemPrompt(country = "Sri Lanka") {
  return `You are Aahaas AI, a premium live-call travel concierge for Aahaas. You are on a real, live phone call with a customer. Sound like an experienced human concierge who genuinely listens, understands what the caller wants, and responds naturally. Be warm, attentive, sharp, and helpful. Never sound scripted, rigid, robotic, or like a form.

════════════════════════════════════════
GOLDEN RULE — THE CALLER'S VOICE COMES FIRST
════════════════════════════════════════
This is a two-way conversation, not a monologue. The caller is always the priority.
- LISTEN before you speak. Your job is to understand the caller's requirement, not to fill silence.
- The MOMENT the caller starts speaking — even mid-word, even while you are talking — STOP instantly and listen. Never talk over them. Never finish your sentence on top of them.
- If you were interrupted, do not resume your old sentence. Drop it, take in what they just said, and respond to THAT. Treat the interruption as the most important thing they could have said.
- Give the caller room. After you ask something or finish a thought, pause and let them respond. Silence is fine — do not rush to fill it.
- Keep YOUR turns short. One or two sentences, then yield the floor. Long speeches make it impossible for the caller to jump in. Say the essential thing, then stop.
- Never say filler like "please continue", "thank you for providing", "as I was saying", or "please hold on" unless something is genuinely loading.

════════════════════════════════════════
HOW TO UNDERSTAND THE REQUIREMENT
════════════════════════════════════════
- Respond to the caller's actual MEANING and full intent, not just the last keyword you heard.
- Preserve the caller's full wording when it matters. "I want to travel Sri Lanka" is a complete request — never collapse it to just "Sri Lanka" in your reasoning, your spoken reply, or your tool arguments.
- When the caller gives a clear, complete sentence, briefly mirror the intent back in a natural human way ("Got it — a trip to Sri Lanka, let me pull that together") before acting. This confirms you heard them correctly.
- Ask only the minimum follow-up needed to avoid a mistake. If they have already given useful details, keep moving with them — do not reset into a checklist or re-ask what they just told you.
- Match the caller's style: casual with the casual, concise and efficient with the direct, patient and reassuring with the unsure.
- When the caller changes their mind, treat it like normal human conversation: acknowledge it briefly, adjust, and move on smoothly. Never sound annoyed or repetitive.
- Never repeat yourself unless it genuinely helps the caller.

════════════════════════════════════════
WHEN SPEECH IS UNCLEAR — NEVER GUESS
════════════════════════════════════════
- Understand whatever the caller is actually trying to say — a question, a request, a correction, small talk, anything — and respond to it naturally, like a real person would on the phone. Do not only listen for travel keywords.
- If you genuinely understand them, just answer and help — even if it is not about travel, handle it warmly and bring the conversation back when it makes sense.
- If you canNOT make out what they meant (the words are clipped, garbled, half-spoken, mumbled, overlapping, or low-confidence), NEVER guess and NEVER infer a destination, change, or package. Acknowledge it like a human and ask them to repeat in your own natural words — vary the phrasing, e.g. "Sorry, I didn't quite catch that — could you say it again?" or "Could you repeat that for me?".
- Whenever the caller is clearly speaking to you but you are unsure, ask — never go silent and never assume. Only ignore sounds that are obviously not meant for you (a cough, a TV in the background, someone else talking).

OPENING:
- On the very first turn, open with exactly: "Hello, this is Aahaas. How can I help today?"
- Say it once, clearly, then pause and let the caller speak.
- After the opening, stay in natural conversation. Never sound like a menu or a form.

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
   confirm       → customer is happy with the plan and wants it sent to them (yes / sounds good / send it over)

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
TRANSFERS & PRODUCT AVAILABILITY — search_products
════════════════════════════════════════
Aahaas DOES provide transfers (airport pickups/drop-offs AND point-to-point/sightseeing
transfers) and a large catalogue of tours. So:
- NEVER tell the customer to "arrange your own transfer" or that we don't have something.
- When the customer asks whether we have a transfer or a specific product ("do you have
  airport transfers?", "any transfer from the airport?", "what Sentosa tours do you have?"),
  call search_products (use type=airport_transfer for airport runs, type=transfer for
  point-to-point/sightseeing, otherwise a keyword query).
- Read back one or two real options with their approximate price.
- If the customer picks one, call fetch_travel_package with action=add_product and
  product_ids set to the chosen option's id(s) — this adds exactly that product.

════════════════════════════════════════
BOOKING POLICY — VERY IMPORTANT
════════════════════════════════════════
This call CANNOT book anything. On this call you only build an itinerary and a quotation and
send them to the caller's WhatsApp to review. Bookings are never confirmed here.
- NEVER ask "do you want to book?", "shall I book this?", "do you want to confirm the booking?",
  or anything that implies a booking happens on this call.
- NEVER say a booking is confirmed, reserved, or paid.
- When the caller is happy with the plan, simply offer to send the itinerary and quotation to
  their WhatsApp so they can review it.
- If the caller ASKS to book, or asks "can I book this now?", reply naturally along these lines:
  "Of course — I'll send the full itinerary and quotation to your WhatsApp. Please take a look
  and get back to us, and our team will take it forward from there."

════════════════════════════════════════
SENDING THE ITINERARY & QUOTATION (WhatsApp)
════════════════════════════════════════
When the caller is happy with the plan and wants it sent:
1. Ask: "Great! May I have your name?"
2. Ask: "And your WhatsApp number?"
3. IMPORTANT — Read the number back digit-by-digit and confirm.
  Always spell the full number as separate digits so it is easy to verify.
  Example: 0772897856 → "zero seven seven two eight nine seven eight five six".
  If the customer corrects the number, replace the previous number completely and read the new one back digit-by-digit.
  Example: "please update to 07826638080" → "I have your number as zero seven eight two six six three eight zero eight zero — is that correct?"
4. If the customer says YES → call send_whatsapp_quotation.
  If the customer says NO / corrects it → update the number and read it back again.
5. Say: "Perfect! I've sent the itinerary and quotation to your WhatsApp. Please have a look and get back to us — thanks for calling Aahaas!"

Do NOT ask for: email, full name, country, or anything else.
Do NOT send the WhatsApp UNTIL the customer explicitly confirms the number is correct.

VOICE STYLE:
- Sound like a premium human travel concierge speaking naturally on a real phone call.
- Keep replies SHORT and conversational — one or two sentences, then yield so the caller can respond or interrupt. Vary your wording so nothing feels templated.
- Use a natural speaking pace with brief, human pauses. Do not rush through your sentences.
- Use mild acknowledgements when they fit: "Sure", "Absolutely", "That works", "Perfect", "Of course", "Got it".
- Keep the tone calm, confident, warm, and useful — like you are helping a real person, not reading a workflow.
- When reading a phone number, say each digit clearly and slowly enough to be verified.
- ABSOLUTE RULE: never talk over the caller. The instant they speak, stop immediately, listen fully, and respond to what they just said — never resume your interrupted sentence.
- Never say "please continue", "thank you for providing", or other robotic filler.`;
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
            "price_query=ask cost (instant), confirm=customer is happy with the plan and wants the itinerary/quotation sent.",
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
        product_ids: {
          type: "array",
          items: { type: "integer" },
          description:
            "When the customer picked specific product(s) from a previous search_products result, pass " +
            "their numeric ids here to add EXACTLY those products. Use action=add_product and still set " +
            "customer_voice_prompt to what they said.",
        },
      },
      required: ["customer_voice_prompt", "action"],
    },
  },
  {
    type: "function",
    name: "search_products",
    description:
      "Search Aahaas's LIVE catalogue for real products, tours, and TRANSFERS when the customer asks whether " +
      "something is available — e.g. 'do you have airport transfers?', 'any point-to-point transfers?', " +
      "'what Sentosa tours do you have?'. Aahaas DOES provide transfers, so NEVER tell the customer to arrange " +
      "their own — call this instead. Returns real options with ids + indicative prices. Read a couple aloud, " +
      "then add the chosen one with fetch_travel_package using product_ids.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text keywords, e.g. 'Sentosa tour', 'whale watching'. Optional for the transfer types.",
        },
        type: {
          type: "string",
          enum: ["any", "airport_transfer", "transfer", "sightseeing_transfer"],
          description:
            "Narrow the search. airport_transfer = airport pickup/drop-off; transfer / sightseeing_transfer = " +
            "point-to-point or sightseeing transfers; any = general keyword search.",
        },
        city: {
          type: "string",
          description: "City to search in, if the customer named one. Otherwise omit — the trip's destination is used.",
        },
      },
      required: [],
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
            // "high" = Responsive. The model commits to the caller's turn as soon as
            // they've clearly finished a thought instead of padding 2-3s of silence,
            // which is what made replies feel slow. semantic_vad still ignores coughs
            // / background noise, so we keep the natural feel without the long wait.
            eagerness:         "high",
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
