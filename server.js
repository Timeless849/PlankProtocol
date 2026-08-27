import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const path = require("path");
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Optional shared-secret. If set, the laptop script must send it back in
// the "x-api-key" header on every POST. Leave API_KEY unset while testing
// locally; set it before you expose the server to the public internet.
const API_KEY = process.env.API_KEY || null;

// Simple in-memory event store. Fine for a live dashboard - if you restart
// the server the history clears, but nothing about "showing live crashes"
// requires a database. Add Postgres later if you want permanent history.
const MAX_EVENTS = 50;
let events = [];

app.use(cors());
app.use(express.json({ limit: "10mb" })); // room for a base64-encoded JPEG snapshot
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function checkApiKey(req, res, next) {
  if (!API_KEY) return next();
  const provided = req.headers["x-api-key"];
  if (provided !== API_KEY) {
    return res.status(401).json({ success: false, error: "Invalid or missing API key" });
  }
  next();
}

// The laptop detector POSTs here whenever it thinks it has seen a crash.
app.post("/api/crash-events", checkApiKey, (req, res) => {
  const { timestamp, confidence, label, classesInvolved, cameraId, image } = req.body || {};

  if (!timestamp || confidence === undefined || confidence === null) {
    return res.status(400).json({
      success: false,
      error: "Request body must include at least 'timestamp' and 'confidence'."
    });
  }

  const event = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    timestamp,
    confidence: Number(confidence),
    label: label || "possible crash",
    classesInvolved: Array.isArray(classesInvolved) ? classesInvolved : [],
    cameraId: cameraId || "camera-1",
    image: image || null, // base64 JPEG string, no "data:" prefix
    receivedAt: new Date().toISOString()
  };

  events.unshift(event);
  if (events.length > MAX_EVENTS) events = events.slice(0, MAX_EVENTS);

  io.emit("crash-event", event);
  console.log(
    `[crash-event] ${event.label} - confidence ${(event.confidence * 100).toFixed(0)}% - ${event.timestamp}`
  );

  // Don't echo the (large) image back in the response - the dashboard gets it via websocket.
  res.status(201).json({ success: true, event: { ...event, image: undefined } });
});

// Dashboard calls this on page load to backfill recent history.
app.get("/api/crash-events", (req, res) => {
  res.json({ success: true, events });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", eventsStored: events.length, uptimeSeconds: process.uptime() });
});

io.on("connection", (socket) => {
  console.log("Dashboard connected:", socket.id);
  socket.on("disconnect", () => console.log("Dashboard disconnected:", socket.id));
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, "0.0.0.0", () => {
  console.log(`Crash detection server listening on port ${port}`);
  if (!API_KEY) {
    console.log("NOTE: API_KEY is not set - the /api/crash-events endpoint is open to anyone. Set API_KEY before going public.");
  }
});
