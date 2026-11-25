import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight, Boxes, Users, Receipt, Wallet, Truck, ShieldCheck, KeyRound,
  ScrollText, Lock, Fingerprint, Bot, Plug, Check, Menu, X, Github, Terminal, Sparkles,
} from "lucide-react";
import { Logo } from "../components/Logo.jsx";
import { Button } from "../components/ui.jsx";
import { useHashRoute } from "../lib/hooks.js";
import { titleCase } from "../lib/format.js";

const REPO = "https://github.com/rehanpathan650/ShopMind";
const MCP_URL = `${typeof window !== "undefined" ? window.location.origin : ""}/mcp`;

const rise = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.2, 0.7, 0.2, 1] } },
};
const inView = { initial: "hidden", whileInView: "show", viewport: { once: true, margin: "-60px" }, variants: rise };

// ---------------------------------------------------------------- NAV
const LINKS = [
  ["Product", "product"],
  ["Developers", "docs"],
  ["Security", "security"],
  ["Pricing", "pricing"],
];

function Nav({ open }) {
  const [mobile, setMobile] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);

  return (
    <header className={`site-nav ${scrolled ? "scrolled" : ""}`}>
      <div className="container nav-inner">
        <a href="#/" aria-label="ShopMind home" onClick={() => setMobile(false)}><Logo /></a>
        <nav className="nav-links" aria-label="Main">
          {LINKS.map(([label, path]) => <a key={path} href={`#/${path}`}>{label}</a>)}
          <a href={REPO} target="_blank" rel="noreferrer noopener">GitHub</a>
        </nav>
        <div className="nav-cta">
          <Button variant="ghost" size="sm" onClick={() => open("login")}>Log in</Button>
          <Button size="sm" onClick={() => open("register")}>Get started <ArrowRight size={14} /></Button>
        </div>
        <button className="icon-btn nav-toggle" aria-label={mobile ? "Close menu" : "Open menu"} aria-expanded={mobile} onClick={() => setMobile(!mobile)}>
          {mobile ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {mobile && (
        <nav className="mobile-nav container" aria-label="Mobile">
          {LINKS.map(([label, path]) => (
            <a key={path} href={`#/${path}`} onClick={() => setMobile(false)}>{label}</a>
          ))}
          <a href={REPO} target="_blank" rel="noreferrer noopener">GitHub</a>
          <div className="mobile-nav-cta">
            <Button variant="ghost" onClick={() => { setMobile(false); open("login"); }}>Log in</Button>
            <Button onClick={() => { setMobile(false); open("register"); }}>Get started</Button>
          </div>
        </nav>
      )}
    </header>
  );
}

// ---------------------------------------------------------------- HERO PRODUCT MOCK
function ProductMock() {
  return (
    <div className="mock">
      <div className="mock-bar">
        <span /><span /><span />
        <em>shopmind.app / assistant</em>
      </div>
      <div className="mock-body">
        <div className="mock-msg user">Who owes me more than ₹10,000? Remind the oldest one.</div>
        <div className="mock-tools">
          <code>get_dues</code><code>dues_aging</code><code>draft_reminder_message</code>
        </div>
        <div className="mock-msg bot">
          <table>
            <tbody>
              <tr><td>Deshmukh Builders</td><td>₹31,500</td><td className="muted">75 days</td></tr>
              <tr><td>Kale Hardware</td><td>₹21,020</td><td className="muted">9 days</td></tr>
              <tr><td>Patil Constructions</td><td>₹12,000</td><td className="muted">21 days</td></tr>
            </tbody>
          </table>
          Deshmukh is over their ₹30,000 limit. I drafted a firm reminder in English and Hindi.
        </div>
        <div className="mock-approval">
          <div>
            <span className="eyebrow">Needs your approval</span>
            <strong>Record ₹5,000 payment from Deshmukh Builders via UPI</strong>
          </div>
          <div className="mock-approval-btns">
            <span className="pill-btn ghost">Cancel</span>
            <span className="pill-btn">Confirm</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- SECTIONS
const FEATURES = [
  [Bot, "AI operator", "Ask in English, Hindi or Hinglish. Claude plans multi-step work across 44 tools and shows every step."],
  [Boxes, "Inventory", "Stock, pricing, margins, reorder levels, valuation and restock suggestions from real sales velocity."],
  [Users, "Udhaar & customers", "Credit ledger, statements with running balance, credit limits, aging buckets and reminder drafts."],
  [Receipt, "Sales & billing", "Itemised bills that deduct stock, split by cash, UPI, card or credit, with one-click voids."],
  [Wallet, "Expenses & P&L", "Track rent, salaries and bills. Get gross margin and net profit for any period."],
  [Truck, "Suppliers", "Log goods received, keep cost prices current and see spend per supplier."],
];

const STEPS = [
  ["01", "Connect your shop", "Sign up in a minute, or load a realistic demo shop to explore."],
  ["02", "Talk or click", "Chat with the assistant, use the dashboard, or plug in any MCP client."],
  ["03", "Approve changes", "Agents propose. You approve. Every action lands in an immutable audit log."],
];

const SECURITY = [
  [ShieldCheck, "Human-in-the-loop writes", "AI and API agents can only stage changes. Nothing touches your books until you confirm."],
  [Lock, "httpOnly sessions", "Session tokens live in secure, SameSite=Strict cookies that page scripts can't read."],
  [KeyRound, "Scoped API keys", "Read or read+write keys, hashed at rest (SHA-256), with expiry, last-used and one-click revoke."],
  [Fingerprint, "Brute-force defence", "Rate limits on every route, account lockout after failed logins, strong password policy."],
  [ScrollText, "Append-only audit log", "Who did what, through which channel, with what result. Exportable."],
  [Plug, "Tenant isolation", "Every query is scoped to your shop ID from a verified credential. No cross-shop reads."],
];

function Home({ open }) {
  return (
    <>
      <section className="hero container">
        <motion.div className="hero-copy" initial="hidden" animate="show" transition={{ staggerChildren: 0.08 }}>
          <motion.a variants={rise} href="#/docs" className="announce">
            <Sparkles size={14} /> New: remote MCP server with 44 tools <ArrowRight size={13} />
          </motion.a>
          <motion.h1 variants={rise}>
            The AI back office for <span className="hl">India's small businesses.</span>
          </motion.h1>
          <motion.p variants={rise} className="lede">
            ShopMind runs inventory, udhaar, billing, expenses and suppliers from one conversation.
            Powered by Claude, open to any agent through MCP, and nothing changes without your approval.
          </motion.p>
          <motion.div variants={rise} className="hero-cta">
            <Button size="lg" onClick={() => open("register")}>Start free <ArrowRight size={16} /></Button>
            <a className="btn btn-ghost btn-lg" href="#/docs"><Terminal size={16} /> Read the docs</a>
          </motion.div>
          <motion.ul variants={rise} className="hero-checks">
            <li><Check size={14} /> Free during pilot</li>
            <li><Check size={14} /> Demo data in one click</li>
            <li><Check size={14} /> Open source</li>
          </motion.ul>
        </motion.div>
        <motion.div className="hero-visual" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.7 }}>
          <ProductMock />
        </motion.div>
      </section>

      <section className="container builtwith">
        <span>Built on</span>
        <b>Claude</b><b>Model Context Protocol</b><b>PostgreSQL</b><b>Node.js</b><b>React</b>
      </section>

      <section className="container metrics">
        {[
          ["44", "business tools for agents"],
          ["6", "modules, one workspace"],
          ["0", "writes without your approval"],
          ["100%", "of actions audit-logged"],
        ].map(([n, l]) => (
          <motion.div key={l} {...inView} className="metric">
            <strong>{n}</strong>
            <span>{l}</span>
          </motion.div>
        ))}
      </section>

      <section className="container section" id="product">
        <motion.div {...inView} className="section-head">
          <span className="eyebrow">Product</span>
          <h2>Everything your munshi does. Instantly, and on the record.</h2>
          <p>Six modules share one data model, so the assistant can reason across stock, credit and cash at once.</p>
        </motion.div>
        <div className="feature-grid">
          {FEATURES.map(([Icon, title, body], i) => (
            <motion.article key={title} className="feature" initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: (i % 3) * 0.07 }}>
              <span className="feature-icon"><Icon size={18} /></span>
              <h3>{title}</h3>
              <p>{body}</p>
            </motion.article>
          ))}
        </div>
      </section>

      <section className="container section">
        <motion.div {...inView} className="section-head">
          <span className="eyebrow">How it works</span>
          <h2>Agents propose. Owners approve.</h2>
        </motion.div>
        <div className="steps">
          {STEPS.map(([n, t, b]) => (
            <motion.div key={n} {...inView} className="step">
              <span className="step-n">{n}</span>
              <h3>{t}</h3>
              <p>{b}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <DevSection />

      <section className="container section">
        <div className="dark-panel">
          <motion.div {...inView} className="section-head">
            <span className="eyebrow">Security</span>
            <h2>Built to be trusted with the books.</h2>
            <p>An AI that can touch money needs guardrails that hold even when the AI is wrong.</p>
          </motion.div>
          <div className="feature-grid">
            {SECURITY.map(([Icon, t, b]) => (
              <div key={t} className="feature dark">
                <span className="feature-icon"><Icon size={18} /></span>
                <h3>{t}</h3>
                <p>{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Faq />
      <Cta open={open} />
    </>
  );
}

function DevSection() {
  return (
    <section className="container section dev">
      <motion.div {...inView} className="dev-copy">
        <span className="eyebrow">For developers & agents</span>
        <h2>Your shop, as an MCP server.</h2>
        <p>
          Create a scoped API key and connect Claude Desktop, Claude Code or any MCP client.
          Read tools answer instantly. Write tools land in the owner's approval queue.
        </p>
        <ul className="ticks">
          <li><Check size={15} /> 44 tools, 3 resources, 3 prompt templates</li>
          <li><Check size={15} /> Streamable HTTP transport, stateless</li>
          <li><Check size={15} /> Same tools over REST: <code>POST /api/tools/:name</code></li>
        </ul>
        <a className="btn btn-ghost" href="#/docs">Explore the API <ArrowRight size={15} /></a>
      </motion.div>
      <motion.pre {...inView} className="code">
{`# Connect Claude Code to your shop
claude mcp add --transport http shopmind \\
  ${MCP_URL} \\
  --header "Authorization: Bearer sm_live_..."

# Or call a tool over REST
curl -X POST ${typeof window !== "undefined" ? window.location.origin : ""}/api/tools/get_dues \\
  -H "Authorization: Bearer sm_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"args":{"min_amount":10000}}'`}
      </motion.pre>
    </section>
  );
}

function Faq() {
  const items = [
    ["Can the AI change my records by itself?", "No. Every change from the assistant or an API key is staged as a pending action. It only runs when you press Confirm, and pending actions expire after 24 hours."],
    ["Which AI model does ShopMind use?", "Anthropic's Claude via the official API. The server holds the API key; it never reaches your browser."],
    ["Does it send WhatsApp reminders?", "Not yet. ShopMind drafts reminders in English and Hindi with the exact balance, and you send them. Direct delivery is on the roadmap."],
    ["Can I export my data?", "Yes. Products, customers, sales, the credit ledger and expenses all export to CSV in one click."],
    ["Is it open source?", "Yes. The full source is on GitHub."],
  ];
  return (
    <section className="container section faq">
      <motion.div {...inView} className="section-head">
        <span className="eyebrow">FAQ</span>
        <h2>Questions, answered.</h2>
      </motion.div>
      <div className="faq-list">
        {items.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

const Cta = ({ open }) => (
  <section className="container">
    <motion.div {...inView} className="cta">
      <h2>Run your shop by chat, starting today.</h2>
      <p>Load the demo shop and ask it anything in under a minute.</p>
      <Button size="lg" onClick={() => open("register")}>Create your shop <ArrowRight size={16} /></Button>
    </motion.div>
  </section>
);

// ---------------------------------------------------------------- PAGES
const PageHero = ({ eyebrow, title, children }) => (
  <motion.section className="container page-hero" initial="hidden" animate="show" transition={{ staggerChildren: 0.08 }}>
    <motion.span variants={rise} className="eyebrow">{eyebrow}</motion.span>
    <motion.h1 variants={rise}>{title}</motion.h1>
    {children && <motion.p variants={rise} className="lede">{children}</motion.p>}
  </motion.section>
);

function Pricing({ open }) {
  const tiers = [
    ["Pilot", "₹0", "For the first shops we work with.", ["AI assistant (fair use)", "All 6 modules", "Audit log & CSV export", "2 API keys"], false],
    ["Shop", "₹499", "per month, for one busy shop.", ["Everything in Pilot", "Unlimited API keys & MCP", "Priority support", "Daily briefing prompts"], true],
    ["Business", "Talk to us", "Multi-branch and distributors.", ["Everything in Shop", "Multiple staff logins", "WhatsApp delivery (soon)", "Custom tools"], false],
  ];
  return (
    <>
      <PageHero eyebrow="Pricing" title="Simple pricing that pays for itself.">Start free. Upgrade when ShopMind is saving you hours every week.</PageHero>
      <section className="container pricing">
        {tiers.map(([name, price, desc, feats, hot]) => (
          <div key={name} className={`price-card ${hot ? "hot" : ""}`}>
            {hot && <span className="badge badge-accent">Most popular</span>}
            <h3>{name}</h3>
            <div className="price">{price}</div>
            <p>{desc}</p>
            <ul>{feats.map((f) => <li key={f}><Check size={15} /> {f}</li>)}</ul>
            <Button variant={hot ? "primary" : "ghost"} className="btn-block" onClick={() => open("register")}>Get started</Button>
          </div>
        ))}
      </section>
      <Faq />
    </>
  );
}

function Docs() {
  const [toolList, setToolList] = useState(null);
  useEffect(() => {
    fetch("/api/public/tools").then((r) => r.json()).then((d) => setToolList(d.tools)).catch(() => setToolList([]));
  }, []);
  const grouped = (toolList || []).reduce((acc, t) => ((acc[t.category] ||= []).push(t), acc), {});

  return (
    <>
      <PageHero eyebrow="Developers" title="The ShopMind API & MCP server.">
        Every capability of the assistant is a tool you can call over MCP or REST, with the same permissions and the same approval flow.
      </PageHero>
      <section className="container docs">
        <div className="docs-grid">
          <div className="doc-card">
            <h3>1. Create an API key</h3>
            <p>Dashboard → Developers → New key. Choose <code>read</code> or <code>read + write</code>. The key is shown once; we only store its hash.</p>
          </div>
          <div className="doc-card">
            <h3>2. Connect an MCP client</h3>
            <p>Endpoint <code>{MCP_URL}</code> (Streamable HTTP). Send <code>Authorization: Bearer sm_live_…</code>.</p>
          </div>
          <div className="doc-card">
            <h3>3. Approve writes</h3>
            <p>Write tools return <code>202 pending_approval</code>. The owner confirms them in the Approvals inbox.</p>
          </div>
        </div>

        <h2 className="docs-h">Claude Desktop config</h2>
        <pre className="code">{`{
  "mcpServers": {
    "shopmind": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${MCP_URL}",
               "--header", "Authorization: Bearer \${SHOPMIND_KEY}"],
      "env": { "SHOPMIND_KEY": "sm_live_..." }
    }
  }
}`}</pre>

        <h2 className="docs-h">REST</h2>
        <pre className="code">{`GET  /api/tools                 # tool catalog with JSON schemas
POST /api/tools/:name           # { "args": { ... } }
GET  /api/actions?status=pending
GET  /api/export/{products|customers|sales|ledger|expenses}`}</pre>

        <h2 className="docs-h">Tool catalog {toolList && <span className="muted">· {toolList.length} tools</span>}</h2>
        {!toolList && <p className="muted">Loading tools…</p>}
        {toolList && toolList.length === 0 && <p className="muted">Tool catalog unavailable right now.</p>}
        <div className="catalog">
          {Object.entries(grouped).map(([cat, list]) => (
            <div key={cat} className="catalog-group">
              <h3>{titleCase(cat)}</h3>
              {list.map((t) => (
                <div key={t.name} className="catalog-row">
                  <code>{t.name}</code>
                  <span className={`badge ${t.write ? (t.destructive ? "badge-danger" : "badge-warn") : "badge-ok"}`}>
                    {t.write ? (t.destructive ? "destructive" : "write") : "read"}
                  </span>
                  <p>{t.description}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function SecurityPage({ open }) {
  return (
    <>
      <PageHero eyebrow="Security" title="Guardrails that hold even when the AI is wrong.">
        ShopMind is designed so a confused model, a leaked API key or a malicious page can't quietly change your books.
      </PageHero>
      <section className="container">
        <div className="feature-grid">
          {SECURITY.map(([Icon, t, b]) => (
            <div key={t} className="feature">
              <span className="feature-icon"><Icon size={18} /></span>
              <h3>{t}</h3>
              <p>{b}</p>
            </div>
          ))}
          {[
            [Lock, "Hardened HTTP", "Strict security headers, CSP, HSTS in production, CORS allow-list, CSRF header check, 256 KB body limit."],
            [Bot, "Prompt-injection aware", "Tool output is treated as data. The model can't approve its own actions; only an authenticated owner can."],
            [KeyRound, "Secrets stay server-side", "The Anthropic API key and database credentials live only in server environment variables."],
          ].map(([Icon, t, b]) => (
            <div key={t} className="feature">
              <span className="feature-icon"><Icon size={18} /></span>
              <h3>{t}</h3>
              <p>{b}</p>
            </div>
          ))}
        </div>
      </section>
      <Cta open={open} />
    </>
  );
}

function About({ open }) {
  return (
    <>
      <PageHero eyebrow="About" title="Software as easy as a WhatsApp message.">
        India has tens of millions of small shops running on notebooks and memory. We're building the AI back office they never had: one that speaks their language, and never acts without their say.
      </PageHero>
      <section className="container about">
        <p>
          ShopMind is open source. Read the code, file an issue or contribute on{" "}
          <a href={REPO} target="_blank" rel="noreferrer noopener">GitHub</a>.
        </p>
      </section>
      <Cta open={open} />
    </>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Logo />
          <p className="muted">The AI back office for India's small businesses.</p>
        </div>
        <div>
          <h4>Product</h4>
          <a href="#/product">Features</a><a href="#/pricing">Pricing</a><a href="#/security">Security</a>
        </div>
        <div>
          <h4>Developers</h4>
          <a href="#/docs">API & MCP</a><a href={REPO} target="_blank" rel="noreferrer noopener">GitHub</a>
        </div>
        <div>
          <h4>Company</h4>
          <a href="#/about">About</a>
        </div>
      </div>
      <div className="container footer-base">
        <span>© {new Date().getFullYear()} ShopMind. Made in India.</span>
        <a href={REPO} target="_blank" rel="noreferrer noopener" aria-label="GitHub"><Github size={16} /></a>
      </div>
    </footer>
  );
}

export default function Site({ open }) {
  const route = useHashRoute();
  const page = route.split("/")[0];

  useEffect(() => {
    if (page === "product") document.getElementById("product")?.scrollIntoView({ behavior: "smooth" });
  }, [page]);

  const body =
    page === "pricing" ? <Pricing open={open} />
    : page === "docs" ? <Docs />
    : page === "security" ? <SecurityPage open={open} />
    : page === "about" ? <About open={open} />
    : <Home open={open} />;

  return (
    <div className="site">
      <Nav open={open} />
      <main>{body}</main>
      <Footer />
    </div>
  );
}
