# ShopMind
Chat-first business assistant for Indian shops. React + framer-motion, Node/Express, Postgres, an MCP server, and Claude.

**Run:** `docker compose up db -d` → `cd backend && cp .env.example .env` (add ANTHROPIC_API_KEY) `&& npm i && npm run dev` → `cd frontend && npm i && npm run dev` → open http://localhost:5173

**Design:** the AI talks to an MCP server (`backend/src/mcp.js`) whose tools (`tools.js`) are bound to the logged-in shop's id. Writes are staged, then confirmed by the owner. Everything is audited.
**Next:** WhatsApp Cloud API, invoices, rate limiting, tests, TypeScript, Redis queue for reminders.
