import { createServer } from "http";
import app from "./app.js";
import config from "./config.js";
import { setupRealtimeProxy } from "./realtime.js";

// Wrap Express in a plain HTTP server so we can attach the WebSocket proxy
const httpServer = createServer(app);

setupRealtimeProxy(httpServer);

httpServer.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});
