# `/v1/voice/suggest` — Voice Agent Integration Guide

Stateful endpoint for live travel calls. The voice agent calls it **once per
turn** of the conversation. It builds a package, lets the customer add/change
products across turns, and returns the **exact total** plus extra options to
upsell — all as structured JSON (not just a spoken paragraph).

- **Live base URL:** `https://travel-parser-live.aahaas.com`
- **Endpoint:** `POST /v1/voice/suggest`
- **Content-Type:** `application/json`

---

## The one rule that matters: `session_id`

The endpoint is **stateful per call**. To keep context across turns:

1. On the **first** request, send **no** `session_id`.
2. The response returns a generated `"session_id": "vs_..."`.
3. Send that **same `session_id` on every later request** in the same call.

Without a reused `session_id`, every turn starts from scratch (no "add hotel",
no exact total carried forward).

---

## Request

```jsonc
{
  "prompt": "I want to go to Singapore for 5 nights for 2 adults",  // REQUIRED
  "session_id": "vs_8f3...",   // omit on first turn; reuse on every later turn
  "action": "price_query",     // OPTIONAL — force the intent (see table below)
  "max_products": 5            // OPTIONAL — cap included products (default 5)
}
```

| Field | Required | Notes |
|---|---|---|
| `prompt` | ✅ | Exactly what the customer said this turn. Aliases also accepted: `chatInput`, `input`. |
| `session_id` | turn 2+ | Copy it from the first response. Stable for the whole call. |
| `action` | optional | Skips the intent classifier (faster + deterministic). One of the actions below. |
| `max_products` | optional | Max items in `products[]`. Default `5`. |

> The endpoint reads **only `prompt`** for the customer's intent — it does not
> read separate `destination` / `nights` / `travelers` fields. Put that detail
> in the `prompt` sentence (e.g. *"Singapore, 5 nights, 2 adults, 3-star"*).

### `action` values (optional intent override)

| action | Meaning | Re-plans? |
|---|---|---|
| `new_request` | Start a fresh trip (resets the session's plan) | yes |
| `add_product` | Add an activity / tour / experience | yes |
| `add_hotel` | Add or set a specific hotel | yes |
| `change` | Change dates, nights, pax, stars, or remove something | yes |
| `price_query` | Read back the cost/total of what exists | **no — instant** |
| `confirm` | Customer agrees to proceed | **no — instant** |

If you omit `action`, the server classifies the utterance automatically. The
first turn (no existing plan) is always treated as `new_request`.

---

## Response

```jsonc
{
  "success": true,
  "session_id": "vs_8f3...",       // <-- store and resend on the next turn
  "intent": "new_request",          // what the server decided this turn was

  "voice_text": "For your 5-night Singapore trip we've put together ...",
                                    // the line for the agent to speak (TTS-ready)

  "destination": "Singapore",
  "currency": "SGD",

  "hotel": {                        // included stay (null if none)
    "name": "Village Hotel Bugis",
    "stays": [ { "name": "...", "city": "Singapore", "stars": 4,
                 "check_in": "2026-05-31", "check_out": "2026-06-04" } ],
    "stars": 4,
    "nights": 1,
    "total_amount": 480.0,          // EXACT (from the pushed cart), or null
    "currency": "SGD"
  },

  "products": [                     // items INCLUDED in the itinerary
    {
      "id": 16123,
      "name": "2-Parks Pass: Night Safari + River Wonders",
      "type": "ticket",            // activity | tour | ticket | dining | transfer | hotel
      "city": "Singapore",
      "day": 2,
      "rate": 86.0,                // per-person DB rate (indicative)
      "total_amount": 173.04,      // EXACT line cost from the cart (null if no cart)
      "currency": "SGD",
      "timeSlot": "morning"
    }
  ],

  "pricing": {                      // the Travel Summary figure
    "source": "cart",              // "cart" = EXACT | "estimate" = indicative only
    "currency": "SGD",
    "hotels_total": 480.0,
    "activities_total": 209.09,
    "grand_total": 689.09,
    "line_items": [ { "name": "...", "type": "activity",
                      "total_amount": 173.04, "currency": "SGD" } ]
  },

  "additional_options": [           // extras the customer could ADD (not in cart)
    {
      "id": 999,
      "name": "Gardens by the Bay",
      "type": "ticket",
      "city": "Singapore",
      "unit_price": 28.0,          // per person
      "indicative_price": 56.0,    // unit_price x pax (approx — not yet priced by cart)
      "currency": "SGD"
    }
  ],

  "meta": {
    "turn": 1,
    "product_count": 5,
    "option_count": 6,
    "request_type": "city_wise_itinerary",
    "country": "Singapore",
    "cities": ["singapore"],
    "total_days": 6,
    "total_nights": 5,
    "cart_id": 40764,
    "cart_reference": "CART_...",
    "pricing_source": "cart"
  }
}
```

### Two pricing tiers — read these correctly

- **Included items** (`products[]`, `hotel`, `pricing`) carry **exact** cost
  (`pricing.source: "cart"`) once they're in the cart — this is the same number
  as the Travel Summary page.
- **`additional_options[]`** carry **indicative** price only (`indicative_price`)
  because they aren't in the cart yet. Speak these as *"around X"*.
- If the cart wasn't created (e.g. cart push disabled server-side),
  `pricing.source` is `"estimate"` and totals are approximate — the
  `voice_text` will already hedge them as approximate.

---

## Example: one full call

**Turn 1 — first ask** (no `session_id`):
```json
POST /v1/voice/suggest
{ "prompt": "I want to go to Singapore for 5 nights for 2 adults, 3-star hotel" }
```
→ Save `response.session_id`. Speak `response.voice_text`.

**Turn 2 — add a hotel:**
```json
{ "prompt": "add the hotel Boss to my itinerary", "session_id": "vs_8f3..." }
```

**Turn 3 — add a product:**
```json
{ "prompt": "also add a Sentosa day tour", "session_id": "vs_8f3..." }
```

**Turn 4 — exact cost** (instant, no re-plan):
```json
{ "prompt": "what's the full cost?", "session_id": "vs_8f3...", "action": "price_query" }
```
→ Read `response.pricing.grand_total` + `response.currency`.

---

## Behaviour & performance notes

- **`price_query` / `confirm` are instant** — they answer from stored state and
  do **not** rebuild the plan.
- **`new_request` / `add_product` / `add_hotel` / `change` rebuild the plan and
  push the cart**, so they take longer (roughly 20–40s). Show/say a brief
  "let me put that together" filler while waiting.
- Sessions live ~**2 hours** then expire. Start a new call → new `session_id`.
- Passing `action` explicitly (when your agent already knows the turn type)
  skips the classifier and is slightly faster + fully deterministic.

---

## Errors

- `400` — `prompt` missing/empty. Body: `{ "error": "...", "message": "..." }`.
- On a planning failure the endpoint still returns `200` with a `voice_text`
  apologising and an empty/short `products` list — safe to read aloud.

Always branch on `success` and on whether `products`/`pricing` are present
before quoting numbers.
