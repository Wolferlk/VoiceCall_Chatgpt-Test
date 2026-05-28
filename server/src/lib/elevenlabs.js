import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import config from "../config.js";

const client = config.elevenlabsApiKey
  ? new ElevenLabsClient({ apiKey: config.elevenlabsApiKey })
  : null;

export function ensureElevenLabsClient() {
  if (!client) {
    throw new Error("ELEVENLABS_API_KEY is missing. Add it to your .env file.");
  }

  return client;
}

export async function streamToBuffer(stream) {
  if (typeof stream?.getReader === "function") {
    const reader = stream.getReader();
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        chunks.push(Buffer.from(value));
      }
    }

    return Buffer.concat(chunks);
  }

  const chunks = [];

  for await (const chunk of stream) {
    if (!chunk) {
      continue;
    }

    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}
