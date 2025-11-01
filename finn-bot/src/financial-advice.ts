import {
  WorkflowEntrypoint,
  WorkflowStep,
  type WorkflowEvent,
} from "cloudflare:workers";

type Env = { AI: any };

interface Params {
  query: string;
}

interface DuckDuckGoResponse {
  Abstract?: string;
}

export class FinancialAdviceWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { query } = event.payload;

    const info = await step.do("fetch-insight", {}, async () => {
      const resp = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`
      );
      const data = (await resp.json()) as DuckDuckGoResponse;
      return data.Abstract ?? "No financial insights found.";
    });

    const advice = await step.do("generate-advice", {}, async () => {
      const ai = await this.env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct",
        {
          prompt: `You are Finn, a financial advisor. Based on this data, provide actionable financial advice:\n${info}`,
        }
      );
      return ai.response ?? "No advice generated.";
    });

    return { finalAdvice: advice };
  }
}
