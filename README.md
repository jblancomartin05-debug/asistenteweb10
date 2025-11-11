# Atenea — Next.js / Vercel-ready

This repository is converted to Next.js and is ready to deploy on Vercel.

Local development
1. Install:
   npm install

2. Add environment variables:
   cp .env.example .env.local
   # Edit .env.local and set OPENAI_API_KEY=sk-...

3. Run:
   npm run dev
4. Open http://localhost:3000

API
- POST /api/chat
  Request: { "message":"...", "history":[ { "role":"user"|"assistant", "content":"..." } ] }
  Response: { "reply":"..." }

Deploy to Vercel
1. Push this repo (branch vercel-nextjs).
2. In Vercel, Import Project → choose this repo.
   - Framework Preset: Next.js
3. Add Environment Variables in Vercel:
   - OPENAI_API_KEY = <your key>
   - OPENAI_MODEL = gpt-3.5-turbo
   - SYSTEM_PROMPT = (optional)
4. Deploy.

Notes
- Keep secrets out of git. Use Vercel Environment Variables.
- If you need streaming or RAG, I can add those next.
