/**
 * embed_docs.js
 * Simple helper to embed all files inside ./docs and write vectors.json.
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const DOCS_DIR = path.join(process.cwd(), "docs");
const OUT_FILE = path.join(process.cwd(), "vectors.json");

if (!OPENAI_KEY) {
  console.error("OPENAI_API_KEY not set. See .env.example.");
  process.exit(1);
}

async function embedText(text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify({ input: text, model: EMBEDDING_MODEL })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Embedding failed: ${res.status} ${txt}`);
  }
  const j = await res.json();
  return j?.data?.[0]?.embedding;
}

(async function main(){
  try {
    const files = fs.readdirSync(DOCS_DIR).filter(f => !f.startsWith("."));
    const out = [];
    for (const f of files) {
      const p = path.join(DOCS_DIR, f);
      const stat = fs.statSync(p);
      if (!stat.isFile()) continue;
      const text = fs.readFileSync(p, "utf8");
      console.log("Embedding:", f);
      const embedding = await embedText(text);
      out.push({ id: f, text: text.slice(0, 10000), embedding });
      await new Promise(r => setTimeout(r, 200));
    }
    fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
    console.log("Wrote", OUT_FILE);
  } catch (err) {
    console.error("embed_docs error:", err);
    process.exit(1);
  }
})();
