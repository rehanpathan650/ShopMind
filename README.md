# ShopMind 🛍️
### The AI back office for India's small businesses

**ShopMind runs inventory, udhaar (customer credit), billing, expenses and suppliers from one conversation.** It's powered by Claude, open to any AI agent through the Model Context Protocol (MCP), and **nothing changes without the owner's approval**.

Built with **React, Node.js, PostgreSQL, Claude and MCP**.

🌐 **Live demo:** https://shopmind-frontend.vercel.app/
📦 **Source:** https://github.com/rehanpathan650/ShopMind

---

## ✨ What it does

| Module | Highlights |
|---|---|
| 🤖 **AI assistant** | Claude plans multi-step work across 44 tools. It replies in English, Hindi or Hinglish, shows which tools it used, and turns proposed changes into Approve/Reject cards. |
| 📦 **Inventory** | Products with SKU, category, unit, price, cost and reorder level. Margins, stock valuation, low-stock report with reorder suggestions based on sales velocity, and stock counts. |
| 👥 **Customers & udhaar** | Credit ledger with running-balance statements, credit limits, dues aging (0-30/31-60/61-90/90+), and reminder drafts in English and Hindi. |
| 🧾 **Sales** | Itemised bills that deduct stock and capture cost for profit. Payment by cash, UPI, card or credit (credit adds to dues). Discounts, one-click voids, top products, revenue by day and by payment method. |
| 💸 **Expenses & P&L** | Categorised expenses and a profit & loss statement (revenue, COGS, gross margin, expenses, net profit) for any period. |
| 🚚 **Suppliers** | Supplier directory and goods-received log that adds stock and updates cost price. |
| 🔌 **API & MCP** | Scoped API keys, a remote MCP server (44 tools, 3 resources, 3 prompts) and REST access to the same tools. |
| 📜 **Audit & export** | Append-only activity log for every read, staged change, approval, login and export. CSV export for products, customers, sales, ledger and expenses. |

## 🧠 Architecture

```text
Browser (React)                MCP clients / scripts
  │ httpOnly session cookie       │ Bearer sm_live_... (scoped API key)
  ▼                               ▼
Express API ── security layer: helmet · CORS allow-list · CSRF guard · rate limits
  │
  ├── /api/chat ──► AI agent (Claude) ──► in-process MCP client ─┐
  ├── /mcp  (Streamable HTTP) ───────────────────────────────────┤
  ├── /api/tools/:name (REST) ───────────────────────────────────┤
  │                                                              ▼
  │                                   Tool registry (44 tools, zod-validated)
  │                                     reads ──► run now
  │                                     writes ─► staged in pending_actions
  │                                                 └─► owner approves ─► run in a transaction + audit
  ▼
PostgreSQL (shop-scoped rows, append-only audit_log)
```

The AI assistant reaches data **only through the MCP server**, so it has exactly the same tools and approval rules as any external agent.

### Backend layout

```text
backend/src/
├── index.js            # boot: migrate, listen, housekeeping, graceful shutdown
├── app.js              # express app, middleware, routes, error handler
├── config.js           # all env vars, validated once
├── db.js · migrations.js · seed.js
├── actions.js          # tool engine: run reads, stage writes, approve/cancel
├── security/           # auth (cookies + API keys), apiKeys, password, middleware
├── ai/                 # agent loop (Claude, optional Groq) + system prompt
├── mcp/server.js       # MCP tools, resources, prompts; in-process + remote HTTP
├── tools/              # inventory, customers, sales, expenses, suppliers, analytics
├── routes/             # auth.js, api.js
└── lib/http.js         # errors, validation, paging, CSV
```

### Frontend layout

```text
frontend/src/
├── App.jsx                  # session bootstrap, site vs app
├── site/                    # marketing site, docs, pricing, auth modal
├── app/Shell.jsx            # sidebar app shell
├── app/pages/               # Overview, Assistant, Approvals, Inventory, Customers,
│                            # Sales, Expenses, Suppliers, Activity, Developers, Settings
├── components/ui.jsx        # buttons, cards, modals, forms, toasts
└── lib/                     # api client, hooks, formatters
```

## 🔐 Security

- **Human-in-the-loop writes.** The AI assistant, MCP clients and API keys can only *stage* changes. They run only when the logged-in owner approves them. Pending actions expire after 24 hours, are re-validated before they run, and are row-locked so they can't run twice.
- **Sessions in httpOnly cookies** (`Secure`, `SameSite=Strict`), so JavaScript can't read the token. "Sign out everywhere" and password changes revoke all sessions through a token version.
- **CSRF guard.** Cookie-authenticated writes must send `X-Requested-With: ShopMind`, which browsers can't send cross-origin without a CORS preflight.
- **Scoped API keys** (`read` or `read + write`). Stored as SHA-256 hashes, shown once, with optional expiry, last-used tracking and instant revoke. Keys can never approve actions.
- **Brute-force protection.** Rate limits on auth, chat and the API; account lockout after 5 failed logins; constant-time login; and a password policy (10+ characters, letters and digits, not a common password).
- **Hardened HTTP.** helmet headers and CSP, HSTS in production, a CORS allow-list, a 256 KB body limit, request IDs, and errors that never expose SQL or stack traces. The Vercel config adds CSP, frame, referrer and permissions headers.
- **Tenant isolation.** Every query is scoped by the shop ID from a verified credential, with parameterized SQL only.
- **Validation.** Every tool input is checked with a strict zod schema. CSV exports are guarded against formula injection.
- **Secrets stay server-side.** The Anthropic API key never reaches the browser.

## 🚀 Getting started

### 1. Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `.env` and set at least:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Claude API key from https://platform.claude.com/settings/keys |
| `JWT_SECRET` | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `DATABASE_URL` | Your PostgreSQL connection string |
| `CORS_ORIGINS` | Your frontend origin(s), e.g. `https://shopmind-frontend.vercel.app` |

The model defaults to `claude-opus-5-5`. Set `ANTHROPIC_MODEL=claude-sonnet-5-5` for lower cost.

### 2. Run

With Docker:

```bash
docker compose up --build      # Postgres + API on http://localhost:4000
```

Or directly (Node 22+):

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev   # http://localhost:5173 (proxies /api and /mcp)
```

Migrations run automatically on boot. Tick **"Load a demo shop"** at sign-up to get products, customers, suppliers, two weeks of sales and expenses.

### 3. Deploy

- **Backend (e.g. Render):** set the env vars above plus `NODE_ENV=production` and `TRUST_PROXY=true`.
- **Frontend (Vercel):** `vercel.json` rewrites `/api/*` and `/mcp` to the backend, so the browser stays same-origin and cookies work. Update the backend URL there if it changes.

## 🔌 Connect an AI agent (MCP)

1. In the app, open **API & MCP**, click **New API key**, and pick read-only or read + propose changes.
2. Connect your client:

```bash
# Claude Code
claude mcp add --transport http shopmind https://<your-domain>/mcp \
  --header "Authorization: Bearer sm_live_..."
```

Or call tools over REST:

```bash
curl -X POST https://<your-domain>/api/tools/get_dues \
  -H "Authorization: Bearer sm_live_..." -H "Content-Type: application/json" \
  -d '{"args":{"min_amount":10000}}'
```

Write tools return `202 pending_approval` and appear in the owner's **Approvals** inbox.

**MCP resources:** `shopmind://summary`, `shopmind://inventory`, `shopmind://approvals`
**MCP prompts:** `daily_briefing`, `collections_plan`, `restock_plan`

<details>
<summary><b>All 44 tools</b></summary>

| Category | Read | Write (needs approval) |
|---|---|---|
| Inventory | list_products, get_stock, product_details, low_stock_report, inventory_valuation | create_product, update_product, delete_product, add_stock, remove_stock, adjust_stock, clear_stock |
| Customers | list_customers, get_dues, customer_statement, dues_aging, draft_reminder_message | create_customer, update_customer, delete_customer, record_credit_sale, record_payment, send_reminder |
| Sales | list_sales, sale_details, sales_report, top_products | record_sale, void_sale |
| Expenses | list_expenses, expense_report | record_expense, delete_expense |
| Suppliers | list_suppliers, list_purchases | create_supplier, update_supplier, delete_supplier, record_purchase |
| Analytics | business_summary, profit_and_loss, customer_insights, search_everything, recent_activity | — |

</details>

## 🗺️ What's next

- WhatsApp delivery for reminders and daily briefings
- Multiple staff logins with roles
- GST invoices and PDF bills
- Streaming assistant replies

## 🤝 Contributing

Issues and pull requests are welcome, especially new tools for everyday small-business workflows.

---

**Built to explore a simple idea: make everyday business operations as easy as having a conversation.**
