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

// 💡 You can switch to other models like:
// const model = workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
const model = workersai("@cf/meta/llama-3.2-1b-instruct");

/**
 * Chat Agent implementation that handles AI chat interactions
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
        // Clean up incomplete or duplicate tool calls
        const cleanedMessages = cleanupMessages(this.messages);

        // Process pending tool calls from previous messages
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions,
        });

        // --- AI Model Stream ---
        const result = streamText({
          system: `
You are Finn, a helpful assistant.

Only call tools that are explicitly available to you.
If you don’t have the right tool, just explain the answer conversationally.
Do not invent new tools such as "getSolarInformation".
Respond in natural language, not JSON, unless explicitly asked.


${getSchedulePrompt({ date: new Date() })}

If the user asks to schedule something, use the **schedule** tool.
If unsure, ask clarifying questions.
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
 * Worker entry point for routing requests
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      const hasAI = !!env.AI;
      return Response.json({ success: hasAI });
    }

    if (!env.AI) {
      console.error(
        "AI binding is missing.\nAdd this to wrangler.json or .dev.vars:\n\n" +
          `"ai": { "binding": "AI" }`
      );
    }

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
