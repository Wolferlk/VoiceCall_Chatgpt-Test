import cors from "cors";
import express from "express";
import morgan from "morgan";
import config from "./config.js";
import ttsRoutes from "./routes/tts.js";

const app = express();

app.use(
  cors({
    origin: config.clientUrl
  })
);
app.use(express.json());
app.use(morgan("dev"));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    elevenlabsConfigured: Boolean(config.elevenlabsApiKey)
  });
});

app.use("/api/tts", ttsRoutes);

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode || 500;
  res.status(statusCode).json({
    message: error.message || "Internal server error."
  });
});

export default app;
