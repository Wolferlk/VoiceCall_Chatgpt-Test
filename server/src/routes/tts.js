import express from "express";
import config from "../config.js";
import { ensureElevenLabsClient, streamToBuffer } from "../lib/elevenlabs.js";

const router = express.Router();

router.post("/", async (req, res, next) => {
  try {
    const text = req.body?.text?.trim();

    if (!text) {
      return res.status(400).json({ message: "Text is required for speech synthesis." });
    }

    const elevenlabs = ensureElevenLabsClient();
    const audioStream = await elevenlabs.textToSpeech.convert(config.elevenlabsVoiceId, {
      text,
      modelId: config.elevenlabsModelId,
      outputFormat: "mp3_44100_128"
    });

    const audioBuffer = await streamToBuffer(audioStream);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    return res.send(audioBuffer);
  } catch (error) {
    next(error);
  }
});

export default router;
