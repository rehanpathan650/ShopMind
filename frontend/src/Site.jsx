import { useState, useEffect } from "react";
import { motion } from "framer-motion";

const NAV = [["Product", [["Features", "features"], ["How it works", "how"], ["Security", "security"]]],
  ["Solutions", [["Hardware & building", "solutions"], ["Wholesale & retail", "solutions"], ["Agriculture", "solutions"], ["Logistics", "solutions"]]],
  ["Pricing", "pricing"], ["Company", [["About", "about"], ["Contact", "contact"]]]];
const rise = { hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.2, 0.7, 0.2, 1] } } };
const view = { initial: "hidden", whileInView: "show", viewport: { once: true, margin: "-60px" }, variants: rise };
const demo = [["u", "Who owes me more than ₹10,000?"], ["a", "Sharma Traders ₹18,500\nPatil Constructions ₹12,000"], ["u", "Send both a reminder."], ["a", "I'll remind 2 customers. Confirm?"], ["u", "Yes."], ["a", "Done ✓ Reminders sent."]];

const INFO = {
  features: { t: "Everything a shop needs, in one chat", s: "Six abilities the AI can use for you, each one safe by design.", c: [
    ["Dues & udhaar", "Ask who owes you money and how much. Filter by amount."], ["Stock", "Check or update any product's stock in one sentence."],
    ["Credit sales", "Record what a customer bought on credit."], ["Payments", "Record payments received and see the new balance."],
    ["Reminders", "Remind one customer, or everyone above an amount."], ["Live dashboard", "Dues and stock sit beside your chat, always up to date."]] },
  how: { t: "How ShopMind works", s: "Simple layers, each doing exactly one job.", c: [
    ["01 · You chat", "Type like you're texting. No forms, no menus."], ["02 · AI understands", "It works out what you mean and picks the right action."],
    ["03 · MCP server acts", "A fixed menu of safe actions runs on your shop's data."], ["04 · You confirm", "Anything that changes data waits for your yes."],
    ["05 · It's logged", "Every action lands in an audit log you can read."], ["06 · Numbers update", "Your dues and stock refresh instantly."]] },
  security: { t: "Built so you can trust it", s: "AI that touches real business data has to earn trust.", c: [
    ["Separate shops", "Every query is tied to your shop. Other shops' data is out of reach."], ["Confirm before change", "The AI can only stage changes. You approve each one."],
    ["Audit log", "Who asked, what happened, and when."], ["Hashed passwords", "Passwords are never stored in plain text."],
    ["Signed sessions", "Login tokens are signed and expire after 7 days."], ["No guessing", "The AI reads real numbers from tools instead of inventing them."]] },
  solutions: { t: "Made for the shops that run India", s: "If you sell on credit and count stock, ShopMind fits.", c: [
    ["Hardware & building", "Cement, steel, pipes: track dues and stock by chat."], ["Wholesale & distribution", "Know which dealers owe you, and remind them in seconds."],
    ["Agri inputs", "Seeds and fertiliser on seasonal credit, tracked simply."], ["Logistics & transport", "Pending payments and balances per party."],
    ["Small manufacturing", "Raw material stock and customer dues in one place."], ["Professional firms", "Track pending client payments without a spreadsheet."]] },
  about: { t: "Software as easy as a WhatsApp message", s: "We build AI tools for small businesses that big software forgot.", c: [
    ["Our mission", "Make powerful software feel as easy as texting a friend."], ["Why chat", "Shopkeepers already live in chat apps. Software should meet them there."],
    ["Why careful", "AI should help, not surprise you. Nothing changes without your yes."]] },
};

function Nav({ open }) {
  return (
    <header className="nav">
      <a href="#/" className="logo">Shop<i>Mind</i></a>
      <nav className="links">
        {NAV.map(([n, x]) => Array.isArray(x)
          ? <div className="dd" key={n}><span>{n} ▾</span><div className="menu"><div>{x.map(([l, p]) => <a key={l} href={`#/${p}`}>{l}</a>)}</div></div></div>
          : <a key={n} href={`#/${x}`}>{n}</a>)}
      </nav>
      <button className="btn ghost" onClick={() => open("login")}>Log in</button>
      <button className="btn hide" onClick={() => open("register")}>Get started</button>
    </header>
  );
}

const Head = ({ pill, t, s }) => (
  <motion.div className="hero1" style={{ paddingBottom: 10 }} initial="hidden" animate="show" transition={{ staggerChildren: 0.1 }}>
    <motion.span variants={rise} className="pill">{pill}</motion.span>
    <motion.h1 variants={rise} style={{ fontSize: "clamp(38px,6vw,68px)" }}>{t}</motion.h1>
    <motion.p variants={rise}>{s}</motion.p>
  </motion.div>
);
const Cards = ({ c }) => (
  <div className="grid">{c.map(([h, p], i) => (
    <motion.div key={h} className="card" initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: (i % 3) * 0.1 }}>
      <h3>{h}</h3><p>{p}</p></motion.div>))}</div>
);
const Cta = ({ open }) => (
  <motion.div className="cta" {...view}><h2>Ready to run your shop by chat?</h2><button className="btn" onClick={() => open("register")}>Start free →</button></motion.div>
);

function Home({ open }) {
  const faq = [["Is my shop's data safe?", "Every shop is walled off. The AI can only reach the logged-in shop, and every action is logged."],
    ["Can the AI change my records by itself?", "No. It can only stage a change. Nothing happens until you press Confirm."],
    ["Does it work on WhatsApp?", "Today it runs as a web chat. WhatsApp support is on the roadmap."], ["What does it cost?", "Pilot shops are free. See the pricing page for plans."]];
  return (<>
    <div className="wrap">
      <motion.section className="hero1" initial="hidden" animate="show" transition={{ staggerChildren: 0.12 }}>
        <motion.span variants={rise} className="pill">AI assistant for Indian shops</motion.span>
        <motion.h1 variants={rise}>Run your shop<br /><span>by texting it.</span></motion.h1>
        <motion.p variants={rise}>Ask who owes you money, update stock, send reminders. No forms, no menus. Just chat.</motion.p>
        <motion.div variants={rise} className="ask" onClick={() => open("register")}>⌕ <span>Ask ShopMind: “Who owes me more than ₹10,000?”</span></motion.div>
      </motion.section>
      <div className="stat"><span><b>6</b> smart tools</span><span><b>100%</b> of changes need your yes</span><span><b>Every</b> action in the audit log</span><span><b>1 shop</b> = 1 private workspace</span></div>

      <section className="s"><motion.div {...view}><span className="pill">The problem</span><h2>Running a shop shouldn't need five tools.</h2>
        <p className="sub">Credit in a notebook. Stock in your head. Bills in Tally. Reminders by phone call.</p></motion.div>
        <Cards c={[["Notebook udhaar", "Easy to lose, hard to total, awkward to chase."], ["Guesswork stock", "You find out you're out of cement when a customer asks."], ["Manual reminders", "Calling people one by one eats your afternoon."]]} /></section>

      <section className="s"><div className="split">
        <motion.div {...view}><span className="pill">See it in action</span><h2>Talk to your shop like a friend.</h2>
          <p className="sub">Plain sentences in. Real answers out. When something needs to change, ShopMind asks first.</p><button className="btn" onClick={() => open("register")}>Try it free</button></motion.div>
        <motion.div className="phone" {...view}>{demo.map(([w, t], i) => (
          <motion.div key={i} className={`b ${w}`} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.55 }}>{t}</motion.div>))}</motion.div></div></section>

      <section className="s"><motion.div {...view}><span className="pill">How it works</span><h2>Three steps. Zero training.</h2><p className="sub">If you can send a message, you can run ShopMind.</p></motion.div>
        <Cards c={[["1 · Sign up", "Create your shop in a minute. Add sample data to explore."], ["2 · Chat", "Ask about dues and stock, or tell it what happened today."], ["3 · Confirm", "Approve any change. See it instantly on your dashboard."]]} /></section>

      <section className="s"><motion.div {...view}><span className="pill">Features</span><h2>Everything in one place.</h2></motion.div><Cards c={INFO.features.c} />
        <p style={{ marginTop: 18 }}><a href="#/features" className="btn ghost">All features →</a></p></section>

      <section className="s"><div className="dark"><motion.div {...view}><span className="pill" style={{ background: "#161616", borderColor: "#333", color: "#aaa" }}>Security</span>
        <h2>AI you can actually trust with your books.</h2><p className="sub">Private workspaces, confirm-before-change, and a full audit trail.</p></motion.div>
        <Cards c={INFO.security.c.slice(0, 3)} /></div></section>

      <section className="s"><motion.div {...view}><span className="pill">Solutions</span><h2>Built for how Indian businesses sell.</h2></motion.div><Cards c={INFO.solutions.c.slice(0, 3)} />
        <p style={{ marginTop: 18 }}><a href="#/solutions" className="btn ghost">All industries →</a></p></section>

      <section className="s" style={{ maxWidth: 760, margin: "0 auto" }}><motion.div {...view}><h2>Questions, answered.</h2></motion.div>
        {faq.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</section>
      <Cta open={open} />
    </div></>);
}

function Pricing({ open }) {
  const T = [["Pilot", "Free", "For the first shops we work with", ["Full chat assistant", "Dues, stock, payments", "Audit log"]],
    ["Shop", "₹499/mo", "For one shop, day to day", ["Everything in Pilot", "Priority support", "Data export"], 1],
    ["Business", "Soon", "For multi-branch businesses", ["Everything in Shop", "WhatsApp chat", "Multiple users"]]];
  return (<div className="wrap"><Head pill="Pricing" t="Simple, honest pricing" s="Start free. Pay only when ShopMind is saving you time." />
    <div className="grid" style={{ paddingBottom: 60 }}>{T.map(([n, p, d, f, hot]) => (
      <div key={n} className={`card price ${hot ? "hot" : ""}`}><h3>{n}</h3><p>{d}</p><h4>{p}</h4>
        <ul>{f.map((x) => <li key={x}>✓ {x}</li>)}</ul><button className={`btn ${hot ? "" : "ghost"}`} style={hot ? { background: "#fff", color: "#000" } : {}} onClick={() => open("register")}>Get started</button></div>))}</div>
    <Cta open={open} /></div>);
}

function Contact() {
  const [sent, setSent] = useState(false);
  return (<div className="wrap"><Head pill="Contact" t="Let's talk" s="Questions, feedback, or want a pilot for your shop? Say hello." />
    <form className="form" style={{ margin: "0 auto 80px", width: "min(520px,100%)" }} onSubmit={(e) => { e.preventDefault(); setSent(true); }}>
      {sent ? <h3>Thanks! We'll be in touch.</h3> : <><input type="text" placeholder="Your name" required /><input type="email" placeholder="Email" required />
        <textarea rows="5" placeholder="How can we help?" required /><button className="btn">Send message</button></>}</form></div>);
}

function Footer() {
  const col = (h, l) => <div><h5>{h}</h5>{l.map(([n, p]) => <a key={n} href={`#/${p}`}>{n}</a>)}</div>;
  return (<footer><div className="wrap"><div className="fgrid">
    <div><span className="logo">Shop<i>Mind</i></span><p className="mute" style={{ marginTop: 10, maxWidth: 260 }}>The AI assistant for Indian shops. Chat in, results out.</p></div>
    {col("Product", [["Features", "features"], ["How it works", "how"], ["Security", "security"], ["Pricing", "pricing"]])}
    {col("Solutions", [["Hardware", "solutions"], ["Wholesale", "solutions"], ["Agriculture", "solutions"]])}
    {col("Company", [["About", "about"], ["Contact", "contact"]])}</div>
    <p className="mute">© {new Date().getFullYear()} ShopMind. Made in India.</p></div></footer>);
}

export default function Site({ open }) {
  const [page, setPage] = useState(location.hash.slice(2) || "home");
  useEffect(() => { const f = () => { setPage(location.hash.slice(2) || "home"); scrollTo(0, 0); }; addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  const i = INFO[page];
  return (<><Nav open={open} />
    {page === "pricing" ? <Pricing open={open} /> : page === "contact" ? <Contact /> : i
      ? <div className="wrap"><Head pill={page === "how" ? "How it works" : page[0].toUpperCase() + page.slice(1)} t={i.t} s={i.s} /><Cards c={i.c} /><div style={{ height: 60 }} /><Cta open={open} /></div>
      : <Home open={open} />}
    <Footer /></>);
}
