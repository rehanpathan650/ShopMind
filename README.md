# ShopMind 🛍️
### Your shop's AI-powered business assistant

**ShopMind helps small Indian shop owners manage everyday business operations through a simple conversation.** Instead of navigating multiple dashboards or manually updating records, shop owners can interact with an AI assistant to check inventory, track customer dues, record credit sales, and more.

Built with **React, Node.js, PostgreSQL, Claude, and the Model Context Protocol (MCP)**.

🌐 **Live Demo:** https://shopmind-frontend.vercel.app/

📦 **Source Code:** https://github.com/rehanpathan650/ShopMind

---

## 💡 The Idea

Running a small shop involves a lot of repetitive work: checking stock, remembering who owes money, recording credit sales, and keeping business information organized.

ShopMind explores a different approach: **what if you could manage your shop by simply asking an AI assistant?**

For example, instead of opening several screens to find information, a shop owner could ask:

- "Which products are running low on stock?"
- "How much does this customer owe me?"
- "Record this sale as a credit sale."
- "Add 20 units of rice to my inventory."

The assistant uses connected tools to retrieve information or perform supported operations through ShopMind's backend.

*These are illustrative examples of the intended interaction. The exact requests supported depend on the available tools and implementation.*

## ✨ Features

- **Conversational business management** — interact with shop operations using natural language.
- **Inventory management** — check stock and add inventory.
- **Customer dues** — look up outstanding customer balances.
- **Credit sales** — record supported credit-sale transactions.
- **AI tool calling** — connect language-model reasoning to actual backend operations.
- **MCP integration** — expose business functionality through a Model Context Protocol server.
- **Explicit action confirmation** — confirm data-changing actions before execution.
- **Shop-specific context** — associate the MCP integration with the relevant shop.
- **Auditability** — maintain an audit trail of supported operations.

## 🧠 How It Works

ShopMind combines a conversational interface with backend tools that an AI model can invoke.

```text
Shop Owner
    |
    | Natural-language request
    v
ShopMind Chat Interface
    |
    v
Claude / AI Tool Calling
    |
    v
ShopMind MCP Server
    |
    v
Backend APIs and PostgreSQL
    |
    v
Business Data / Operation Result
    |
    v
Response to the Shop Owner
```

### Why MCP?

The **Model Context Protocol (MCP)** provides a standardized way for AI applications to discover and use tools exposed by a server.

In ShopMind, the MCP server acts as the bridge between an AI agent and shop-management operations. Instead of embedding every business action directly into a chatbot, functionality can be exposed as tools that a compatible agent can invoke.

This also creates an opportunity to make ShopMind's business tools accessible to other compatible AI clients, subject to the required connection, authentication, and configuration.

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React |
| UI and animations | Framer Motion |
| Backend | Node.js, Express |
| Database | PostgreSQL |
| AI integration | Claude tool calling |
| Tool integration | Model Context Protocol (MCP) |
| Deployment | Vercel for the frontend; backend hosting as configured |

## 🏗️ Project Architecture

ShopMind separates the user-facing chat experience from the business logic and database operations.

- **Frontend:** provides the conversational interface.
- **Backend:** handles application logic and business operations.
- **MCP server:** exposes supported business functionality as tools for compatible AI clients.
- **Database:** stores shop-related information.
- **AI model:** interprets requests and selects relevant tools.

This separation makes the system easier to extend with additional business operations and compatible AI clients.

## 🚀 Getting Started

### Prerequisites

Before running ShopMind locally, make sure you have:

- Node.js and npm installed.
- Access to a PostgreSQL database.
- The environment variables required by the frontend and backend.
- The necessary AI provider credentials.
- The MCP configuration required by the client you intend to use.

### Installation

Clone the repository:

```bash
git clone https://github.com/rehanpathan650/ShopMind.git
cd ShopMind
```

Install dependencies in the relevant frontend and backend directories, following the repository's package structure.

```bash
npm install
```

Configure the required environment variables using the example configuration provided in the relevant project directory, if available.

Start the frontend and backend using the scripts defined in their respective `package.json` files.

> **Note:** Exact commands, environment variable names, database migrations, and MCP client configuration depend on the current repository setup. Refer to the project files for the authoritative instructions.

## 🔐 Security and Data Integrity

AI-powered business operations need safeguards because some actions modify real records.

ShopMind is designed around principles such as:

- Explicit confirmation for data-changing actions.
- Server-side validation of incoming operations.
- Shop-specific access boundaries.
- Protected credentials and environment variables.
- Auditable business operations.

The effectiveness of these protections depends on the actual implementation and deployment configuration. Do not connect production business data to an unverified setup.

## 🗺️ What's Next?

Potential directions for future development include:

- Support for additional MCP-compatible AI clients.
- More inventory and sales analytics.
- Automated business summaries.
- Low-stock alerts and customer payment reminders.
- Improved onboarding and simpler MCP configuration.
- Additional tools for everyday small-business workflows.

## 🎯 Why I Built ShopMind

ShopMind explores how AI agents can move beyond answering questions and become useful interfaces for real-world business workflows.

The project combines conversational AI, tool calling, backend APIs, database operations, and MCP into a practical small-business use case.

The broader goal is to make business software more accessible by letting people interact with their data in natural language.

## 🤝 Contributing

Contributions, suggestions, and discussions about AI agents, MCP integrations, and small-business automation are welcome.

Feel free to open an issue or submit a pull request.

## 📄 License

See the repository's `LICENSE` file for the applicable license and usage permissions.

---

**Built to explore a simple idea: make everyday business operations as easy as having a conversation.**
