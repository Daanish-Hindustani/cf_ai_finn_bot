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

// --- Initialize Workers AI ---
const workersai = createWorkersAI({ binding: env.AI });

// 💡 Model choice: lightweight + fast
const model = workersai("@cf/meta/llama-3.2-1b-instruct");

/**
 * Chat Agent that handles user messages, executes tools,
 * and always responds with clean financial insights.
 */
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
        // --- Clean + process previous tool calls ---
        const cleanedMessages = cleanupMessages(this.messages);

        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions,
        });

        // --- Stream model response ---
        const result = streamText({
          system: `
You are **Finn**, a friendly and intelligent financial assistant.

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

          // Final callback when the stream finishes
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<typeof allTools>,

          // Prevent infinite loops
          stopWhen: stepCountIs(10),
        });

        writer.merge(result.toUIMessageStream());
      },
    });

    return createUIMessageStreamResponse({ stream });
  }

  /**
   * Executes scheduled financial tasks.
   */
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          { type: "text", text: `Running scheduled task: ${description}` },
        ],
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
