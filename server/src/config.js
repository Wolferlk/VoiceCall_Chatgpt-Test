import dotenv from "dotenv";

dotenv.config({ path: "../.env" });
dotenv.config();

const config = {
  port: Number(process.env.PORT || 5001),
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || "",
  elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb",
  elevenlabsModelId: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2"
};

export default config;
