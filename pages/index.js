import { useEffect, useRef, useState } from "react";

export default function Home() {
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("atenea_history_v1") || "[]");
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [isWaiting, setIsWaiting] = useState(false);
  const messagesRef = useRef(null);

  useEffect(() => {
    localStorage.setItem("atenea_history_v1", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [history]);

  const pushHistory = (role, content) => {
    setHistory(prev => {
      const next = [...prev, { role, content, ts: Date.now() }];
      while (next.length > 200) next.shift();
      return next;
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || isWaiting) return;
    pushHistory("user", text);
    setInput("");
    setIsWaiting(true);

    const last = JSON.parse(localStorage.getItem("atenea_history_v1") || "[]").slice(-10).map(h => ({ role: h.role, content: h.content }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: last })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        pushHistory("assistant", "⚠️ Error del servidor: " + (err?.error || res.statusText));
        setIsWaiting(false);
        return;
      }

      const data = await res.json();
      const reply = data?.reply || "Lo siento, no obtuve respuesta.";
      pushHistory("assistant", reply);
    } catch (e) {
      console.error(e);
      pushHistory("assistant", "⚠️ Error de conexión. Por favor intenta nuevamente.");
    } finally {
      setIsWaiting(false);
    }
  };

  const clearConversation = () => {
    if (!confirm("¿Borrar toda la conversación?")) return;
    localStorage.removeItem("atenea_history_v1");
    setHistory([]);
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
      <div style={{ width: 720, maxWidth: "95%", boxShadow: "0 8px 30px rgba(0,0,0,.08)", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
        <div style={{ background: "#0078d7", color: "#fff", padding: 16, fontWeight: 700, display: "flex", alignItems: "center" }}>
          <div>🤖 Atenea — Asistente</div>
          <div style={{ marginLeft: "auto", opacity: 0.9 }}>Profesional • Español</div>
        </div>

        <div ref={messagesRef} style={{ height: "60vh", overflow: "auto", padding: 16, background: "linear-gradient(#fff,#f8fafc)", display: "flex", flexDirection: "column", gap: 10 }}>
          {history.length === 0 && (
            <div style={{ padding: 12, borderRadius: 10, background: "#e6f0ff", alignSelf: "flex-start" }}>
              <strong>Atenea:</strong> ¡Hola! Soy Atenea. ¿En qué puedo ayudarte?
            </div>
          )}
          {history.map((m, i) => (
            <div key={i} style={{ padding: 12, borderRadius: 10, maxWidth: "85%", alignSelf: m.role === "user" ? "flex-end" : "flex-start", background: m.role === "user" ? "#d7ffd9" : "#e6f0ff" }}>
              <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 6 }}><strong>{m.role === "user" ? "Tú" : "Atenea"}</strong></div>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
            </div>
          ))}
          {isWaiting && <div style={{ fontStyle: "italic" }}>Atenea está escribiendo...</div>}
        </div>

        <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid #eee", alignItems: "center" }}>
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Escribe tu mensaje..."
            style={{ flex: 1, borderRadius: 8, border: "1px solid #e6e6e6", padding: 10, resize: "none" }}
            disabled={isWaiting}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={send} style={{ background: "#0078d7", color: "#fff", border: "none", padding: "10px 14px", borderRadius: 8 }} disabled={isWaiting}>Enviar</button>
            <button onClick={clearConversation} style={{ background: "transparent", border: "1px solid rgba(0,120,215,0.12)", color: "#0078d7", borderRadius: 8, padding: "8px" }}>Borrar</button>
          </div>
        </div>

        <footer style={{ padding: 8, fontSize: 12, color: "#666", textAlign: "center" }}>La API está en /api/chat. Guarda tu OPENAI_API_KEY como variable en Vercel.</footer>
      </div>
    </div>
  );
}