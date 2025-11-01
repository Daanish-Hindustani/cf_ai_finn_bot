import {
  WorkflowEntrypoint,
  WorkflowStep,
  type WorkflowEvent,
} from "cloudflare:workers";

// Environment binding expects AI and the workflow binding for Financial Advice
type Env = {
  AI: any;
  FINANCIAL_ADVICE_WORKFLOW: Workflow;
};

// Parameters expected by the financial advice workflow
type Params = { query: string };
interface DuckDuckGoResponse {
  Abstract?: string;
}
/**
 * FinancialAdviceWorkflow
 * Given a user query, it fetches external financial insights and then
 * uses the Cloudflare Workers AI binding to generate actionable advice.
 */
export class FinancialAdviceWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    // Step 1: Fetch financial insight from DuckDuckGo API
    const info = await step.do(
      "fetch insights",
      {
        retries: { limit: 3, delay: 2000, backoff: "constant" },
        timeout: "10 seconds",
      },
      async () => {
        const resp = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(event.payload.query)}&format=json`
        );
        const data = (await resp.json()) as DuckDuckGoResponse;
        return data.Abstract ?? "No financial insights found.";
      }
    );

    // Step 2: Use AI to generate actionable financial advice
    const advice = await step.do(
      "generate advice",
      {
        retries: { limit: 3, delay: 1000, backoff: "constant" },
        timeout: "20 seconds",
      },
      async () => {
        const ai = await this.env.AI.run(
          "@cf/meta/llama-3.3-70b-instruct",
          {
            prompt: `You are Finn, a financial advisor. Based on this data, provide actionable financial advice:\n${info}`,
          }
        );
        return ai.response ?? "No advice generated.";
      }
    );

    // Return the final advice as result
    return { finalAdvice: advice };
  }
}

// Worker fetch handler to expose the workflow as an API endpoint
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    // Endpoint to trigger the financial advice workflow
    if (url.pathname.startsWith("/advice")) {
      const query = url.searchParams.get("query") || "";

      // Create a new workflow instance with the query parameter
      const instance = await env.FINANCIAL_ADVICE_WORKFLOW.create({
        params: { query },
      });

      // Wait or check status (could be async polling in production)
      const details = await instance.status();

      // Return status and any results
      return Response.json({
        id: instance.id,
        ...details,
      });
    }

    // Fallback 404 response
    return new Response("Not found", { status: 404 });
  },
};
