# ElevenLabs React + Laravel Project

This project now uses:

- A React frontend in `client/`
- A Laravel backend in `Laravel_Server/`
- ElevenLabs text-to-speech for MP3 audio generation

## Tech stack

- React + Vite
- Laravel
- ElevenLabs REST API

## Based on

This project follows the current ElevenLabs text-to-speech guide:

- https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/

The current docs redirect to the streaming guide, so this app uses the streaming API on the backend.

## Project structure

```text
ElevenlabsAPI/
  client/
  Laravel_Server/
  .env.example
  package.json
```

## Setup

1. Frontend env:

```bash
cp .env.example .env
```

2. Laravel env:

```env
cp Laravel_Server/.env.example Laravel_Server/.env
```

3. Add your real ElevenLabs values to `Laravel_Server/.env`:

```env
APP_URL=http://localhost:8000
FRONTEND_URL=http://localhost:5173
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

4. Install frontend dependencies:

```bash
npm install
```

5. Start the React frontend:

```bash
npm run dev
```

6. Start Laravel separately from `Laravel_Server/`:

```bash
composer install
php artisan serve
```

7. Open the client:

```text
http://localhost:5173
```

## Features

- Type custom text
- Generate and play MP3 audio using ElevenLabs
- Use the AI call feature for real-time voice-style conversations
- Start an OpenAI-powered trip planning call that saves a final trip summary with a plan ID
- Run an animated receptionist-style OpenAI voice call that auto-collects customer details and saves a call report

## AI Call Feature

The system AI call feature allows the user to speak through the browser microphone and interact with the assistant in a natural call-like flow. When audio is recorded, the React frontend sends it to the Laravel backend, where the speech is transcribed with OpenAI, combined with the previous conversation history, and passed to the chat model to generate a smart reply. That reply is then sent to ElevenLabs text-to-speech, which returns spoken audio to the frontend so the user can hear the answer immediately. This creates a complete voice conversation pipeline with speech input, AI understanding, contextual responses, and realistic audio output.

## API routes

- `GET /api/health`
- `POST /api/tts`
- `POST /api/trip-call/session`
- `POST /api/trip-call/turn`
- `POST /api/trip-call/end`
- `POST /api/reception-call/session`
- `POST /api/reception-call/turn`
- `POST /api/reception-call/end`

## Notes

- The React app is configured to call `http://localhost:8000/api`.
- The Laravel endpoint returns raw `audio/mpeg` from ElevenLabs.
- `php` and `composer` were not installed in this environment, so the Laravel app was scaffolded and wired, but not executed locally here.
