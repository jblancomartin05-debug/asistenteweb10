// pages/api/chat.js
// Next.js API route: POST /api/chat

import dotenv from "dotenv";
dotenv.config();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Método no permitido" });
  }

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) {
    return res.status(500).json({ error: "OpenAI API key no configurada." });
  }

  const body = req.body || {};
  const userMessage = (body.message || "").toString();
  const clientHistory = Array.isArray(body.history) ? body.history.slice(-10) : [];

  if (!userMessage || userMessage.trim().length === 0) {
    return res.status(400).json({ error: "El mensaje está vacío." });
  }
  if (userMessage.length > 8000) {
    return res.status(400).json({ error: "Mensaje demasiado largo." });
  }

  const systemPrompt = process.env.SYSTEM_PROMPT || `Eres Atenea, un asistente virtual profesional, amable y servicial para empresas hispanas.\nResponde en español de forma clara, concisa y profesional.\nNo des consejos médicos, legales o financieros específicos; sugiere consultar a un especialista.`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...clientHistory.map(h => ({ role: h.role === "assistant" ? "assistant" : "user", content: String(h.content) })),
    { role: "user", content: userMessage }
  ];

  const payload = {
    model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
    messages,
    temperature: Number(process.env.TEMPERATURE || 0.2),
    max_tokens: Number(process.env.MAX_TOKENS || 800)
  };

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!openaiRes.ok) {
      const txt = await openaiRes.text().catch(() => "");
      console.error("OpenAI API error:", openaiRes.status, txt);
      return res.status(502).json({ error: "Error comunicándose con el servicio de IA." });
    }

    const data = await openaiRes.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) {
      console.error("OpenAI returned unexpected response:", JSON.stringify(data));
      return res.status(502).json({ error: "Respuesta inesperada del servicio de IA." });
    }

    return res.status(200).json({ reply: reply.trim() });
  } catch (err) {
    console.error("API handler error:", err);
    return res.status(500).json({ error: "Error del servidor al procesar la solicitud." });
  }
}