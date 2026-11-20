import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import {
  runDiagnosisSteps,
  type DiagnosisDeps,
  type DiagnosisParams,
  type StepRunner
} from "./diagnosis-steps";
import { askModel } from "./llm";
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
    const deps: DiagnosisDeps = {
      ask: (system, prompt) => askModel(this.env.AI, system, prompt),
      similar: (signals) => this.agent.similarIncidents(signals),
      approve: async () => {
        try {
          await this.waitForApproval(step, { timeout: "10 minutes" });
          return true;
        } catch {
          // Rejected or timed out: keep only the read-only suggestions.
          return false;
        }
      }
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
