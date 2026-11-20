import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import { generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import {
  runDiagnosisSteps,
  type DiagnosisDeps,
  type DiagnosisParams,
  type StepRunner
} from "./diagnosis-steps";
import { MAX_OUTPUT_TOKENS, MODEL } from "./model";
import type { KubePilotAgent } from "./server";
import type { DiagnosisProgress } from "./types";

const LLM_RETRY = {
  retries: { limit: 3, delay: "2 seconds", backoff: "exponential" },
  timeout: "2 minutes"
} as const;

/**
 * Durable diagnosis. Each `step.do` is checkpointed: if the Worker restarts,
 * finished steps are not repeated, and LLM steps retry with backoff on model
 * errors, rate limits or invalid JSON. Step logic lives in diagnosis-steps.ts.
 */
export class DiagnosisWorkflow extends AgentWorkflow<
  KubePilotAgent,
  DiagnosisParams,
  DiagnosisProgress
> {
  async run(
    event: AgentWorkflowEvent<DiagnosisParams>,
    step: AgentWorkflowStep
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const deps: DiagnosisDeps = {
      ask: async (system, prompt) => {
        const { text, finishReason } = await generateText({
          model: workersai(MODEL),
          system: `${system}\nRespond with ONLY the JSON object, no prose, no code fences.`,
          prompt,
          temperature: 0.2,
          maxOutputTokens: MAX_OUTPUT_TOKENS
        });
        if (finishReason === "length") {
          throw new Error("Model output was cut off at the token limit");
        }
        return text;
      },
      similar: (signals) => this.agent.similarIncidents(signals)
    };

    // step.do wants provably serializable results; ours are plain JSON.
    const steps: StepRunner = {
      run: async <T>(name: string, retry: boolean, fn: () => Promise<T>) => {
        const body = (async () => {
          try {
            return await fn();
          } catch (e) {
            // Visible in Worker logs; the user only sees a friendly message.
            console.error(`diagnosis step "${name}" failed`, e);
            throw e;
          }
        }) as unknown as () => Promise<never>;
        const out = retry
          ? await step.do(name, LLM_RETRY, body)
          : await step.do(name, body);
        return out as unknown as T;
      }
    };

    const result = await runDiagnosisSteps(
      { deps, steps, report: (p) => this.reportProgress(p) },
      event.payload
    );

    // The agent writes the incident and timeline when it receives this.
    await step.reportComplete(result);
    return result;
  }
}
