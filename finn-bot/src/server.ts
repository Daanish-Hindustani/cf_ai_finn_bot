import { routeAgentRequest, type Schedule } from "agents";
import { getSchedulePrompt } from "agents/schedule";
import { AIChatAgent } from "agents/ai-chat-agent";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";
import { env } from "cloudflare:workers";



type Env = {
  FINANCIAL_ADVICE_WORKFLOW: Workflow;
  AI: any;
};

const workersai = createWorkersAI({ binding: env.AI });
const model = workersai("@cf/meta/llama-3.2-1b-instruct");

export class Chat extends AIChatAgent<Env> {
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    const allTools = {
      ...tools,
      ...this.mcp.getAITools(),
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const cleanedMessages = cleanupMessages(this.messages);
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions,
        });
        const result = streamText({
          system: `
You are **Finn**, a friendly and intelligent financial assistant.
          
          You do NOT have access to real-time stock or Nasdaq data.
If users ask about live data, tell them where they can find it (like Yahoo Finance or Bloomberg),
but do not attempt to call any tool for it.
🧭 Your job:
- Help users with financial questions, investing concepts, or budgeting tips.
- If a question is NOT related to finance, politely say you cannot answer.
- DO NOT return JSON, code, or structured objects.
- Provide only natural, human-readable text as your final answer.
- When using tools (like "searchWeb"), summarize the findings and end with actionable financial advice.
- Always wrap up with a clear recommendation or insight — e.g., “Based on this, you might consider...”.

${getSchedulePrompt({ date: new Date() })}

If the user asks to schedule something, use the **schedule** tool.
If unsure, ask clarifying questions before acting.
          `.trim(),

          messages: convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<typeof allTools>,
          stopWhen: stepCountIs(10),
        });

        writer.merge(result.toUIMessageStream());
      },
    });

    return createUIMessageStreamResponse({ stream });
  }

  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [{ type: "text", text: `Running scheduled task: ${description}` }],
        metadata: { createdAt: new Date() },
      },
    ]);
  }
}

/**
 * --- Worker entry point ---
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Healthcheck endpoint
    if (url.pathname === "/check-open-ai-key") {
      const hasAI = !!env.AI;
      return Response.json({ success: hasAI });
    }

    // Advice workflow endpoint (NEW)
    if (url.pathname.startsWith("/advice")) {
      const query = url.searchParams.get("query") || "";
      // Create a new workflow instance with the query parameter
      const instance = await env.FINANCIAL_ADVICE_WORKFLOW.create({
        params: { query },
      });
      // Wait or check status
      const details = await instance.status();
      // Return status and any results
      return Response.json({
        id: instance.id,
        ...details,
      });
    }

    // Error check for missing binding
    if (!env.AI) {
      console.error(
        "AI binding is missing.\nAdd this to wrangler.json or .dev.vars:\n\n" +
        `"ai": { "binding": "AI" }`
      );
    }

    // Delegate all chat traffic
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
