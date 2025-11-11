/**
 * server.js
 * Production-minded Express server for Atenea assistant.
 *
 * See README.md for usage and configuration.
 */
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import IORedis from "ioredis";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || `Eres Atenea, un asistente virtual profesional, amable y servicial para empresas hispanas.
Responde en español de forma clara, concisa y profesional. No ofrezcas consejos legales, médicos o financieros específicos; sugiere consultar a un especialista cuando corresponda.`;
const RAG_ENABLED = (process.env.RAG_ENABLED || "false").toLowerCase() === "true";
const RAG_TOP_K = Number(process.env.RAG_TOP_K || 3);

if (!OPENAI_KEY) {
  console.error("OPENAI_API_KEY is not set. Create a .env with your key from .env.example");
}

app.use(express.json({ limit: "128kb" }));
app.use(cors());
app.use(express.static("."));

// Rate limiting
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 60);

let limiter;
if (process.env.RATE_LIMIT_REDIS_URL) {
  const redisClient = new IORedis(process.env.RATE_LIMIT_REDIS_URL);
  limiter = rateLimit({
    store: new RedisStore({
      sendCommand: (...args) => redisClient.call(...args)
    }),
    windowMs: rateLimitWindowMs,
    max: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiadas solicitudes. Intenta de nuevo más tarde." }
  });
  console.log("Using Redis-backed rate limiter.");
} else {
  limiter = rateLimit({
    windowMs: rateLimitWindowMs,
    max: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiadas solicitudes. Intenta de nuevo más tarde." }
  });
  console.log("Using in-memory rate limiter (suitable for single-instance/dev).");
}
app.use("/api/", limiter);

// Load RAG vectors if enabled and available
let RAG_VECTORS = [];
if (RAG_ENABLED) {
  try {
    const vPath = path.join(process.cwd(), "vectors.json");
    const raw = fs.readFileSync(vPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      RAG_VECTORS = parsed.map(v => ({ id: v.id, text: v.text, embedding: v.embedding }));
      console.log(`Loaded ${RAG_VECTORS.length} RAG vectors from vectors.json`);
    } else {
      console.warn("vectors.json is not an array; ignoring.");
    }
  } catch (err) {
    console.warn("RAG enabled but vectors.json not found or invalid. Run embed_docs.js to build embeddings.");
  }
}

// Utilities
function validateMessageText(text) {
  if (!text || typeof text !== "string") return "El mensaje está vacío o no es válido.";
  if (text.trim().length === 0) return "El mensaje está vacío.";
  if (text.length > 8000) return "Mensaje demasiado largo.";
  return null;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] || 0) * (b[i] || 0);
  return s;
}
function norm(a) {
  return Math.sqrt(dot(a, a));
}
function cosineSim(a, b) {
  const n = norm(a) * norm(b);
  if (n === 0) return 0;
  return dot(a, b) / n;
}

async function getEmbedding(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Embeddings error: ${res.status} ${txt}`);
  }
  const j = await res.json();
  return j?.data?.[0]?.embedding;
}

async function runModerationCheck(content) {
  if (!OPENAI_KEY) return { flagged: false };
  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({ input: content, model: "omni-moderation-latest" })
    });
    if (!res.ok) {
      console.error("Moderation API error status:", res.status);
      return { flagged: false };
    }
    const j = await res.json();
    const r = j?.results?.[0];
    return { flagged: !!r?.flagged, result: r };
  } catch (err) {
    console.error("Moderation failed:", err);
    return { flagged: false };
  }
}

function buildMessagesWithRAG(systemPrompt, history, userMessage, topDocs) {
  const ragSystem = topDocs && topDocs.length
    ? `${systemPrompt}\n\nDocumentos relevantes:\n${topDocs.map((d, i) => `Documento ${i + 1}:\n${d.text}`).join("\n\n")}\n\nUsa esta información cuando sea pertinente y cita la fuente si es necesario.`
    : systemPrompt;

  const messages = [
    { role: "system", content: ragSystem },
    ...history.map(h => ({ role: h.role === "assistant" ? "assistant" : "user", content: String(h.content) })),
    { role: "user", content: userMessage }
  ];
  return messages;
}

async function callOpenAIChat(payload) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify(payload)
  });
  return res;
}

// POST /api/chat (non-streaming)
app.post("/api/chat", async (req, res) => {
  const body = req.body || {};
  const userMessage = (body.message || "").toString();
  const clientHistory = Array.isArray(body.history) ? body.history.slice(-20) : [];

  const v = validateMessageText(userMessage);
  if (v) {
    res.status(400).json({ error: v });
    return;
  }

  try {
    const mod = await runModerationCheck(userMessage);
    if (mod.flagged) {
      res.status(400).json({ error: "El contenido del mensaje ha sido bloqueado por políticas de seguridad." });
      return;
    }
  } catch (e) {
    console.warn("Moderation step failed:", e);
  }

  let topDocs = [];
  if (RAG_ENABLED && RAG_VECTORS.length > 0) {
    try {
      const qemb = await getEmbedding(userMessage);
      const sims = RAG_VECTORS.map(v => ({ ...v, sim: cosineSim(qemb, v.embedding) }));
      sims.sort((a, b) => b.sim - a.sim);
      topDocs = sims.slice(0, RAG_TOP_K);
    } catch (e) {
      console.error("RAG embedding error:", e);
    }
  }

  const messages = buildMessagesWithRAG(SYSTEM_PROMPT, clientHistory, userMessage, topDocs);

  const payload = {
    model: OPENAI_MODEL,
    messages,
    temperature: Number(process.env.TEMPERATURE || 0.2),
    max_tokens: Number(process.env.MAX_TOKENS || 800),
    top_p: Number(process.env.TOP_P || 1),
    frequency_penalty: Number(process.env.FREQUENCY_PENALTY || 0),
    presence_penalty: Number(process.env.PRESENCE_PENALTY || 0)
  };

  if (!OPENAI_KEY) {
    res.status(500).json({ error: "OpenAI API key not configured." });
    return;
  }

  try {
    const openaiRes = await callOpenAIChat(payload);
    if (!openaiRes.ok) {
      const txt = await openaiRes.text().catch(() => "");
      console.error("OpenAI chat error:", openaiRes.status, txt);
      res.status(502).json({ error: "Error comunicándose con el servicio de IA." });
      return;
    }
    const data = await openaiRes.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) {
      console.error("OpenAI unexpected response shape:", JSON.stringify(data));
      res.status(502).json({ error: "Respuesta inesperada del servicio de IA." });
      return;
    }
    res.json({ reply: reply.trim() });
  } catch (err) {
    console.error("Error in /api/chat:", err);
    res.status(500).json({ error: "Error del servidor al procesar la solicitud." });
  }
});

// POST /api/chat/stream (streaming)
app.post("/api/chat/stream", async (req, res) => {
  const body = req.body || {};
  const userMessage = (body.message || "").toString();
  const clientHistory = Array.isArray(body.history) ? body.history.slice(-20) : [];

  const v = validateMessageText(userMessage);
  if (v) {
    res.status(400).json({ error: v });
    return;
  }

  try {
    const mod = await runModerationCheck(userMessage);
    if (mod.flagged) {
      res.status(400).json({ error: "El contenido del mensaje ha sido bloqueado por políticas de seguridad." });
      return;
    }
  } catch (e) {
    console.warn("Moderation step failed:", e);
  }

  let topDocs = [];
  if (RAG_ENABLED && RAG_VECTORS.length > 0) {
    try {
      const qemb = await getEmbedding(userMessage);
      const sims = RAG_VECTORS.map(v => ({ ...v, sim: cosineSim(qemb, v.embedding) }));
      sims.sort((a, b) => b.sim - a.sim);
      topDocs = sims.slice(0, RAG_TOP_K);
    } catch (e) {
      console.error("RAG embedding error:", e);
    }
  }

  const messages = buildMessagesWithRAG(SYSTEM_PROMPT, clientHistory, userMessage, topDocs);

  if (!OPENAI_KEY) {
    res.status(500).json({ error: "OpenAI API key not configured." });
    return;
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        temperature: Number(process.env.TEMPERATURE || 0.2),
        max_tokens: Number(process.env.MAX_TOKENS || 800),
        stream: true
      })
    });

    if (!openaiRes.ok || !openaiRes.body) {
      const txt = await openaiRes.text().catch(() => "");
      console.error("OpenAI streaming error:", openaiRes.status, txt);
      res.write(`event: error\ndata: ${JSON.stringify({ error: "Error en streaming desde OpenAI" })}\n\n`);
      res.end();
      return;
    }

    const reader = openaiRes.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let done = false;

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          if (line.trim() === "") continue;
          if (line.startsWith("data:")) {
            const payload = line.replace(/^data:\s*/, "");
            res.write(`data: ${payload}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify(line)}\n\n`);
          }
        }
      }
    }
    res.write(`event: done\ndata: [DONE]\n\n`);
    res.end();
  } catch (err) {
    console.error("Streaming endpoint error:", err);
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ error: "Error en el servidor durante el streaming." })}\n\n`);
      res.end();
    } catch (e) {}
  }
});

app.get("/healthz", (req, res) => {
  res.json({ status: "ok", rag: RAG_ENABLED, rag_vectors: RAG_VECTORS.length });
});

app.listen(PORT, () => {
  console.log(`Atenea server listening on http://localhost:${PORT} (PORT=${PORT})`);
});
