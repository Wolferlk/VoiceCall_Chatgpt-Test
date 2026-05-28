# Laravel Server

This folder contains the Laravel backend for the ElevenLabs text-to-speech project.

It exposes a small API used by the React frontend:

- `GET /api/health`
- `POST /api/tts`
- `POST /api/ai-call`
- `POST /api/text-ai-voice`
- `POST /api/trip-call/session`
- `POST /api/trip-call/turn`
- `POST /api/trip-call/end`
- `POST /api/reception-call/session`
- `POST /api/reception-call/turn`
- `POST /api/reception-call/end`

The frontend sends text to this Laravel server, and Laravel forwards that text to the ElevenLabs API and returns MP3 audio.

## What This Backend Does

- Accepts text from the frontend
- Accepts recorded microphone audio for AI-call mode
- Accepts typed text for AI voice chat mode
- Starts an OpenAI-only travel planning call session
- Accepts recorded microphone audio for the travel planning agent
- Saves the final trip summary in the database with a plan ID
- Starts an OpenAI-only receptionist call session with an auto-generated call ID
- Collects customer details and service requirements one question at a time
- Saves a structured end-of-call report with requested products and categories
- Validates the input
- Sends text to ElevenLabs
- Sends audio to OpenAI speech-to-text
- Sends the transcript and conversation history to OpenAI chat
- Returns generated audio as `audio/mpeg`
- Allows requests from the React frontend running on `http://localhost:5173`

## Project Files

- `routes/api.php`
  Defines the API routes
- `app/Http/Controllers/TextToSpeechController.php`
  Handles the ElevenLabs text-to-speech request
- `app/Http/Middleware/CorsMiddleware.php`
  Allows the frontend to call the Laravel API from another port
- `.env`
  Stores backend configuration and ElevenLabs credentials

## Requirements

Install these first on your machine:

1. PHP 8.3 or higher
2. Composer
3. Internet connection for ElevenLabs API requests

Optional:

1. Node.js and npm for the React frontend

## Backend Setup

Open a terminal inside `Laravel_Server` and run:

```bash
cp .env.example .env
composer install
php artisan key:generate
```

Then open `Laravel_Server/.env` and set these values:

```env
APP_NAME=Laravel
APP_ENV=local
APP_KEY=
APP_DEBUG=true
APP_URL=http://localhost:8000
FRONTEND_URL=http://localhost:5173

ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
OPENAI_API_KEY=your_openai_api_key
OPENAI_CHAT_MODEL=gpt-4.1-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
OPENAI_VOICE_MODEL=gpt-4o-mini-tts
OPENAI_VOICE_NAME=coral
OPENAI_VOICE_INSTRUCTIONS="Speak clearly, warmly, and naturally like a polished travel call agent."
OPENAI_CALL_SYSTEM_PROMPT="You are a helpful AI phone assistant. Reply naturally, briefly, and conversationally. Keep answers concise enough to sound good when spoken aloud."
OPENAI_TEXT_VOICE_SYSTEM_PROMPT="You are a helpful AI voice assistant. Reply naturally, clearly, and briefly so the answer sounds smooth when spoken aloud."
OPENAI_TRIP_CALL_SYSTEM_PROMPT="You are Aahaas, a warm and capable travel planning voice agent. Help the caller plan trips step by step. Ask focused follow-up questions when details are missing, suggest practical travel ideas, keep replies concise enough for voice playback, and naturally ask whether the caller wants any changes before ending the call."
OPENAI_TRIP_SUMMARY_SYSTEM_PROMPT="Summarize this completed travel planning call as a final trip plan. Include destination, dates if known, travelers, budget, transport, lodging, activities, and special requests. If some details are missing, clearly mark them as pending."
OPENAI_TRIP_CALL_GREETING="Hello, this is Aahaas travel planning support. Tell me about the trip you want, and I will help you plan it step by step."
OPENAI_TRIP_CALL_HOLD_MESSAGE="We are planning your trip according to your requirements. We need a short time to analyze your travel plan, so please stay on the call. Aahaas is your travel partner for making the most of your valuable free time."
OPENAI_RECEPTION_VOICE_NAME=coral
OPENAI_RECEPTION_VOICE_INSTRUCTIONS="Speak like a polished premium call-center receptionist: warm, upbeat, clear, and reassuring."
OPENAI_RECEPTION_CALL_GREETING="Welcome to Aahaas. Thank you for calling Aahaas, Sri Lanka's AI-powered travel and lifestyle platform. My name is Aahaas AI Assistant, and I'm here to help you with travel planning, hotel bookings, flights, tours, lifestyle experiences, transportation, shopping, and customer support services. Before we begin, may I collect a few details to better assist you?"
OPENAI_RECEPTION_HOLD_MESSAGE="Thank you for staying on the line. Aahaas is reviewing your request carefully so we can guide you to the right travel, lifestyle, or support service. Please stay connected for just a moment."
OPENAI_RECEPTION_CLOSING_MESSAGE="Your request has been successfully recorded, and our team will assist you shortly. If needed, one of our travel or lifestyle consultants will contact you for further assistance. Have a wonderful day!"
OPENAI_RECEPTION_SYSTEM_PROMPT="You are Aahaas AI Assistant, a warm receptionist for Aahaas..."
OPENAI_RECEPTION_REPORT_PROMPT="Create a final structured customer call report for Aahaas..."
```

Important:

- `APP_URL` is the Laravel backend URL
- `FRONTEND_URL` is the React frontend URL
- `ELEVENLABS_API_KEY` must be a valid ElevenLabs API key
- `ELEVENLABS_VOICE_ID` selects the voice used for speech generation
- `ELEVENLABS_MODEL_ID` selects the ElevenLabs model
- `OPENAI_API_KEY` must be a valid OpenAI API key
- `OPENAI_CHAT_MODEL` selects the OpenAI chat model used for the reply
- `OPENAI_TRANSCRIPTION_MODEL` selects the OpenAI speech-to-text model
- `OPENAI_VOICE_MODEL` selects the OpenAI text-to-speech model
- `OPENAI_VOICE_NAME` selects the OpenAI built-in voice for the trip agent
- `OPENAI_VOICE_INSTRUCTIONS` controls the general speaking style for OpenAI audio output
- `OPENAI_CALL_SYSTEM_PROMPT` controls the assistant's phone-call speaking style
- `OPENAI_TEXT_VOICE_SYSTEM_PROMPT` controls the typed AI voice chat speaking style
- `OPENAI_TRIP_CALL_SYSTEM_PROMPT` controls the behavior of the travel planning voice agent
- `OPENAI_TRIP_SUMMARY_SYSTEM_PROMPT` controls how the final saved trip summary is written
- `OPENAI_TRIP_CALL_GREETING` is the first spoken welcome message for the call
- `OPENAI_TRIP_CALL_HOLD_MESSAGE` is the hold-style message used while the trip reply is being prepared
- `OPENAI_RECEPTION_VOICE_NAME` selects the OpenAI receptionist voice
- `OPENAI_RECEPTION_VOICE_INSTRUCTIONS` controls the receptionist speaking style
- `OPENAI_RECEPTION_CALL_GREETING` is the welcome message for the receptionist call
- `OPENAI_RECEPTION_HOLD_MESSAGE` is the hold-style message during receptionist processing
- `OPENAI_RECEPTION_CLOSING_MESSAGE` is the spoken closing message at the end of the receptionist call
- `OPENAI_RECEPTION_SYSTEM_PROMPT` controls the one-question-at-a-time receptionist workflow
- `OPENAI_RECEPTION_REPORT_PROMPT` controls the final customer call report format

## Run The Laravel Backend

From inside `Laravel_Server`, run:

```bash
php artisan serve
```

Laravel will usually start at:

```text
http://127.0.0.1:8000
```

or

```text
http://localhost:8000
```

## API Endpoints

### `GET /api/health`

Checks whether the backend is running and whether the ElevenLabs API key is configured.

Example:

```bash
curl http://localhost:8000/api/health
```

Example response:

```json
{
  "status": "ok",
  "elevenlabsConfigured": true,
  "openaiConfigured": true
}
```

### `POST /api/tts`

Generates speech from input text.

Request body:

```json
{
  "text": "Hello from Laravel and ElevenLabs"
}
```

Example using `curl`:

```bash
curl -X POST http://localhost:8000/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello from Laravel and ElevenLabs"}' \
  --output sample.mp3
```

Successful response:

- Content type: `audio/mpeg`
- Response body: raw MP3 audio

Possible error responses:

```json
{
  "message": "Text is required for speech synthesis."
}
```

```json
{
  "message": "ELEVENLABS_API_KEY is missing in Laravel_Server/.env."
}
```

```json
{
  "message": "ElevenLabs request failed.",
  "details": {}
}
```

### `POST /api/ai-call`

Processes one AI-call turn from recorded microphone audio.

Request:

- `multipart/form-data`
- `audio`: uploaded audio file from the browser microphone
- `history`: optional JSON array of prior `{ role, content }` items

Successful response:

```json
{
  "transcript": "Hello assistant",
  "reply": "Hello, how can I help you today?",
  "audio_base64": "<base64 mp3>",
  "audio_mime_type": "audio/mpeg"
}
```

### `POST /api/text-ai-voice`

Processes one typed ChatGPT turn and returns an ElevenLabs voice reply.

Request body:

```json
{
  "text": "Explain Laravel simply",
  "history": []
}
```

Successful response:

```json
{
  "text": "Explain Laravel simply",
  "reply": "Laravel is a PHP framework for building web apps.",
  "audio_base64": "<base64 mp3>",
  "audio_mime_type": "audio/mpeg"
}
```

## Frontend Integration

The React frontend is configured to call this Laravel backend through:

```text
http://localhost:8000/api
```

The frontend code uses:

```js
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";
```

That means the frontend sends this request when you click the button:

```http
POST /api/tts
Content-Type: application/json
```

with:

```json
{
  "text": "Your typed text here"
}
```

Laravel returns MP3 audio, and the browser plays it using the `Audio` API.

## Run Frontend With Laravel Backend

From the project root:

```bash
npm install
npm run dev
```

The frontend usually runs at:

```text
http://localhost:5173
```

So in development:

1. Start Laravel backend in `Laravel_Server`
2. Start React frontend in the project root
3. Open `http://localhost:5173`
4. Type text
5. Click `Generate and play`

## Full Development Flow

Use two terminals:

Terminal 1:

```bash
cd Laravel_Server
composer install
php artisan key:generate
php artisan serve
```

Terminal 2:

```bash
npm install
npm run dev
```

## CORS

The backend includes a custom middleware:

- `app/Http/Middleware/CorsMiddleware.php`

This allows requests from:

```text
http://localhost:5173
```

If you change the frontend port or domain, update:

```env
FRONTEND_URL=http://localhost:5173
```

in `Laravel_Server/.env`.

## How The Controller Works

`TextToSpeechController` does this:

1. Validates that `text` exists and is a string
2. Trims the text
3. Reads ElevenLabs config from `.env`
4. Calls:

```text
https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128
```

5. Sends:

```json
{
  "text": "input text",
  "model_id": "eleven_multilingual_v2"
}
```

6. Returns the MP3 audio directly to the frontend

## Troubleshooting

### `composer: command not found`

Install Composer first:

https://getcomposer.org/

### `php: command not found`

Install PHP 8.3+ and make sure `php` is available in your terminal.

### `ELEVENLABS_API_KEY is missing`

Add your key to:

`Laravel_Server/.env`

### Frontend cannot call backend

Check:

1. Laravel is running on port `8000`
2. `FRONTEND_URL` matches your React app URL
3. `VITE_API_BASE_URL` points to `http://localhost:8000/api`

### ElevenLabs request fails

Check:

1. API key is valid
2. Voice ID exists
3. ElevenLabs account has access to the selected model
4. Internet connection is working

## Quick Start

```bash
cd Laravel_Server
cp .env.example .env
composer install
php artisan key:generate
php artisan serve
```

Then in another terminal from the project root:

```bash
npm install
npm run dev
```
