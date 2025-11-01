/**
 * Tool definitions for the AI chat agent
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod/v3";
import type { Chat } from "./server";
import { getCurrentAgent } from "agents";
import { scheduleSchema } from "agents/schedule";

/**
 * --- Search Web (DuckDuckGo) ---
 */
const searchWeb = tool({
  description: "Search the web for up-to-date information about a given query",
  inputSchema: z.object({
    query: z.string().describe("The search query or topic to look up")
  }),
  execute: async ({ query }) => {
    console.log(`Searching the web for: ${query}`);

    try {
      const response = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: {
        AbstractText?: string;
        RelatedTopics?: { Text?: string }[];
      } = await response.json();

      if (data.AbstractText && data.AbstractText.trim() !== "") {
        return data.AbstractText;
      }

      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        const related = data.RelatedTopics.slice(0, 3)
          .map((t) => t.Text)
          .filter(Boolean)
          .join("\n");
        return related
          ? `No direct summary found. Here are related topics:\n${related}`
          : "No relevant text found in related topics.";
      }

      return "No relevant information found.";
    } catch (error) {
      console.error("Error performing web search:", error);
      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      return `Error searching the web: ${message}`;
    }
  }
});

/**
 * --- Schedule Task ---
 */
const scheduleTask = tool({
  description: "Schedule a task to be executed at a later time",
  inputSchema: scheduleSchema,
  execute: async ({ when, description }) => {
    const { agent } = getCurrentAgent<Chat>();

    function throwError(msg: string): string {
      throw new Error(msg);
    }

    if (when.type === "no-schedule") {
      return "Not a valid schedule input";
    }

    const input =
      when.type === "scheduled"
        ? when.date
        : when.type === "delayed"
          ? when.delayInSeconds
          : when.type === "cron"
            ? when.cron
            : throwError("not a valid schedule input");

    try {
      agent!.schedule(input!, "executeTask", description);
    } catch (error) {
      console.error("error scheduling task", error);
      return `Error scheduling task: ${error}`;
    }

    return `Task scheduled for type "${when.type}" : ${input}`;
  }
});

/**
 * --- List Scheduled Tasks ---
 */
const getScheduledTasks = tool({
  description: "List all tasks that have been scheduled",
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent<Chat>();
    try {
      const tasks = agent!.getSchedules();
      if (!tasks || tasks.length === 0) {
        return "No scheduled tasks found.";
      }
      return tasks;
    } catch (error) {
      console.error("Error listing scheduled tasks", error);
      return `Error listing scheduled tasks: ${error}`;
    }
  }
});

/**
 * --- Cancel Scheduled Task ---
 */
const cancelScheduledTask = tool({
  description: "Cancel a scheduled task using its ID",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task to cancel")
  }),
  execute: async ({ taskId }) => {
    const { agent } = getCurrentAgent<Chat>();
    try {
      await agent!.cancelSchedule(taskId);
      return `Task ${taskId} has been successfully canceled.`;
    } catch (error) {
      console.error("Error canceling scheduled task", error);
      return `Error canceling task ${taskId}: ${error}`;
    }
  }
});

/**
 * --- Export all tools ---
 */
export const tools = {
  searchWeb,
  scheduleTask,
  getScheduledTasks,
  cancelScheduledTask
} satisfies ToolSet;

/**
 * --- Executions for confirmation-required tools ---
 */
export const executions = {};