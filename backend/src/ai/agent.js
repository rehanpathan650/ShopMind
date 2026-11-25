import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { connect } from "../mcp/server.js";
import { q } from "../db.js";
import { buildSystemPrompt } from "./prompt.js";

// ==================================================
// AI AGENT
// The assistant reaches shop data only through the in-process MCP server,
// so it has exactly the same tools (and the same approval rules) as any
// external MCP client.
// ==================================================

const anthropic =
  config.ai.provider === "anthropic"
    ? new Anthropic({ apiKey: config.ai.anthropicApiKey, timeout: 120_000, maxRetries: 2 })
    : null;

const toolOutputText = (result) => {
  const textOut = (result.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  return textOut || "No result returned.";
};

const callMcpTool = async (mcp, allowed, name, input, trace) => {
  if (!allowed.has(name)) {
    trace.push({ tool: name, ok: false });
    return { content: `Unknown tool: ${name}`, isError: true };
  }
  try {
    const result = await mcp.callTool({ name, arguments: input ?? {} });
    trace.push({ tool: name, ok: !result.isError });
    return { content: toolOutputText(result), isError: Boolean(result.isError) };
  } catch (error) {
    console.error(`Tool call failed (${name}):`, error);
    trace.push({ tool: name, ok: false });
    return { content: "Tool execution failed.", isError: true };
  }
};

// ---------------------------------------------------------------- Anthropic
async function runAnthropic({ system, messages, defs, mcp, trace }) {
  const toolDefs = defs.map((t) => ({
    name: t.name,
    description: t.description || "",
    input_schema: t.inputSchema || { type: "object", properties: {} },
  }));
  const allowed = new Set(defs.map((t) => t.name));
  const conversation = [...messages];

  for (let round = 0; round < config.ai.maxToolRounds; round++) {
    const request = {
      model: config.ai.anthropicModel,
      max_tokens: 16000,
      system,
      tools: toolDefs,
      messages: conversation,
      output_config: { effort: config.ai.effort },
      cache_control: { type: "ephemeral" }, // caches tools + system + history prefix
    };

    // Server-side refusal fallbacks re-run a declined request on a fallback model.
    const response = config.ai.fallbacks
      ? await anthropic.beta.messages.create({
          ...request,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        })
      : await anthropic.messages.create(request);

    if (response.stop_reason === "refusal") {
      return "Sorry, I can't help with that request. Try asking about your shop's stock, customers, sales or expenses.";
    }

    const toolCalls = response.content.filter((b) => b.type === "tool_use");
    const replyText = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (response.stop_reason !== "tool_use" || toolCalls.length === 0) {
      if (response.stop_reason === "max_tokens" && !replyText) {
        return "That answer got too long. Try a narrower question.";
      }
      return replyText || "Done.";
    }

    // Echo the full assistant content (thinking/fallback blocks included) unchanged.
    conversation.push({ role: "assistant", content: response.content });

    const results = await Promise.all(
      toolCalls.map(async (call) => {
        const out = await callMcpTool(mcp, allowed, call.name, call.input, trace);
        return { type: "tool_result", tool_use_id: call.id, content: out.content, is_error: out.isError };
      })
    );
    conversation.push({ role: "user", content: results });
  }

  return "That took too many steps. Try asking in smaller pieces.";
}

// ---------------------------------------------------------------- Groq (optional)
async function runGroq({ system, messages, defs, mcp, trace }) {
  const toolDefs = defs.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description || "", parameters: t.inputSchema },
  }));
  const allowed = new Set(defs.map((t) => t.name));
  const conversation = [{ role: "system", content: system }, ...messages];

  for (let round = 0; round < config.ai.maxToolRounds; round++) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.ai.groqApiKey}` },
      body: JSON.stringify({
        model: config.ai.groqModel,
        messages: conversation,
        tools: toolDefs,
        tool_choice: "auto",
        max_tokens: 2048,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Groq API error:", response.status, data.error?.message);
      throw new Error("AI provider error");
    }
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("AI provider returned an empty response");
    const calls = message.tool_calls || [];
    if (!calls.length) return message.content || "Done.";

    conversation.push(message);
    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = {};
      }
      const out = await callMcpTool(mcp, allowed, call.function?.name, args, trace);
      conversation.push({ role: "tool", tool_call_id: call.id, content: out.content });
    }
  }
  return "That took too many steps. Try asking in smaller pieces.";
}

/**
 * Run one chat turn. Returns { reply, pending, tools }.
 */
export async function chat(ctx, messages) {
  const [shop] = await q(`SELECT name FROM shops WHERE id = $1`, [ctx.shopId]);
  const system = buildSystemPrompt(shop?.name || "your shop");
  const mcp = await connect(ctx);
  const trace = [];

  try {
    const defs = (await mcp.listTools()).tools;
    const run = config.ai.provider === "groq" ? runGroq : runAnthropic;
    const reply = await run({ system, messages, defs, mcp, trace });
    return { reply, pending: ctx.pending, tools: trace };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      const e = new Error("The AI is busy right now. Please try again in a moment.");
      e.status = 503;
      e.expose = true;
      throw e;
    }
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("Anthropic API key rejected. Check ANTHROPIC_API_KEY.");
      const e = new Error("AI is not configured correctly. Contact support.");
      e.status = 503;
      e.expose = true;
      throw e;
    }
    throw error;
  } finally {
    await mcp.close();
  }
}
