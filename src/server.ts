import { callable, routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { withDedupedStreaming } from "./ai-binding";
import {
  timelineEntriesFor,
  type DiagnosisParams,
  type PastIncident
} from "./diagnosis-steps";
import { friendlyError } from "./errors";
import { IncidentStore } from "./incident-store";
import { parseK8sOutput } from "./k8s-parse";
import { truncateMiddle } from "./limits";
import { evidenceText, limitMessageText, userTexts } from "./messages";
import { normalizeState, resolveKind } from "./memory";
import { MAX_OUTPUT_TOKENS, MODEL } from "./model";
import { lookupRunbook } from "./runbooks";
import { buildSystemPrompt } from "./system-prompt";
import {
  DIAGNOSIS_STEPS,
  INITIAL_STATE,
  SEVERITIES,
  STATUSES,
  TIMELINE_KINDS,
  type Diagnosis,
  type DiagnosisProgress,
  type DiagnosisResult,
  type KubePilotState
} from "./types";

export { DiagnosisWorkflow } from "./workflow";

const MAX_CLUSTER_NOTES = 10;
/** Tool-call rounds per turn. The last one is forced to be a written answer. */
const MAX_STEPS = 6;
const MAX_FIELD = 200;

/**
 * One instance per name; the client uses the default name, so every browser
 * session talks to the same agent and shares its memory.
 */
export class KubePilotAgent extends AIChatAgent<Env, KubePilotState> {
  maxPersistedMessages = 100;
  initialState = INITIAL_STATE;

  private incidents!: IncidentStore;

  onStart() {
    this.incidents = new IncidentStore(this.sql.bind(this));
    this.incidents.init();
    // Upgrade state saved by an older version, then refresh the mirrors.
    this.setState(normalizeState(this.state));
    this.syncMemory();
  }

  /** Mirrors incidents and the active timeline into synced state. */
  private syncMemory(patch: Partial<KubePilotState> = {}) {
    const next = { ...this.state, ...patch };
    this.setState({
      ...next,
      incidents: this.incidents.search(undefined, 20),
      timeline: next.activeIncidentId
        ? this.incidents.timeline(next.activeIncidentId)
        : []
    });
  }

  /** Called by the workflow over RPC to find related past incidents. */
  async similarIncidents(signals: string[]): Promise<PastIncident[]> {
    const seen = new Map<string, PastIncident>();
    for (const signal of signals.slice(0, 3)) {
      for (const i of this.incidents.search(signal, 3)) {
        seen.set(i.id, {
          id: i.id,
          title: i.title,
          status: i.status,
          resolution: i.resolution
        });
      }
    }
    return [...seen.values()].slice(0, 3);
  }

  // ---- diagnosis workflow ----

  private setDiagnosis(diagnosis: Diagnosis) {
    this.setState({ ...this.state, diagnosis });
  }

  private async beginDiagnosis(): Promise<
    { started: true } | { error: string }
  > {
    if (this.state.diagnosis?.status === "running") {
      return { error: "A diagnosis is already running." };
    }
    const input = truncateMiddle(evidenceText(this.messages));
    if (!input) return { error: "Paste some kubectl output or logs first." };

    const { cluster } = this.state;
    const params: DiagnosisParams = {
      input,
      clusterSummary: [
        cluster.name,
        cluster.namespace,
        cluster.version && `k8s ${cluster.version}`,
        cluster.cni,
        cluster.platform,
        ...cluster.notes
      ]
        .filter(Boolean)
        .join(", ")
    };
    // Set state first so early progress callbacks find the diagnosis.
    const id = crypto.randomUUID();
    this.setDiagnosis({
      id,
      status: "running",
      steps: DIAGNOSIS_STEPS.map((s) => ({ ...s, status: "pending" })),
      result: null,
      error: null
    });
    try {
      await this.runWorkflow("DIAGNOSIS_WORKFLOW", params, { id });
    } catch (e) {
      this.setDiagnosis({
        ...(this.state.diagnosis as Diagnosis),
        status: "error",
        error: friendlyError(e)
      });
      return { error: friendlyError(e) };
    }
    return { started: true };
  }

  /** The UI's "Run diagnosis" button. */
  @callable()
  async runDiagnosisNow() {
    return this.beginDiagnosis();
  }

  /** Lets the UI switch the active incident. */
  @callable()
  async selectIncident(id: string) {
    if (!this.incidents.get(id)) return { error: `No incident with id ${id}` };
    this.syncMemory({ activeIncidentId: id });
    return { active: id };
  }

  async onWorkflowProgress(
    _workflowName: string,
    instanceId: string,
    progress: unknown
  ) {
    const d = this.state.diagnosis;
    if (!d || d.id !== instanceId) return;
    const p = progress as DiagnosisProgress;
    this.setDiagnosis({
      ...d,
      steps: d.steps.map((s) =>
        s.id === p.step ? { ...s, status: p.status, message: p.message } : s
      )
    });
  }

  async onWorkflowComplete(
    _workflowName: string,
    instanceId: string,
    result?: unknown
  ) {
    const d = this.state.diagnosis;
    if (!d || d.id !== instanceId) return;
    const r = result as Omit<DiagnosisResult, "incidentId">;

    // Write to the active incident, or open one if the user had none.
    const incident =
      this.incidents.get(this.state.activeIncidentId ?? "") ??
      this.incidents.create({
        title: `${r.category}: ${r.summary}`.slice(0, 100),
        severity: r.severity,
        summary: r.summary,
        signals: r.signals
      });
    for (const e of timelineEntriesFor(r)) {
      this.incidents.addEntry(incident.id, e.kind, e.text, "workflow");
    }
    this.syncMemory({
      activeIncidentId: incident.id,
      diagnosis: {
        ...d,
        status: "complete",
        steps: d.steps.map((s) => ({ ...s, status: "complete" as const })),
        result: { ...r, incidentId: incident.id }
      }
    });
  }

  async onWorkflowError(
    _workflowName: string,
    instanceId: string,
    error: string
  ) {
    console.error(`diagnosis workflow ${instanceId} failed`, error);
    const d = this.state.diagnosis;
    if (!d || d.id !== instanceId) return;
    this.setDiagnosis({
      ...d,
      status: "error",
      error: friendlyError(error),
      steps: d.steps.map((s) =>
        s.status === "running" ? { ...s, status: "error" as const } : s
      )
    });
  }

  // ---- chat ----

  private tools() {
    const short = (max = MAX_FIELD) => z.string().max(max);
    return {
      parseK8sOutput: tool({
        description:
          "Extract structured facts (pods, namespace, status, restarts, exit codes, reasons, events, signals) from kubectl get/describe/logs output in the user's most recent message that contains it. Takes no input.",
        inputSchema: z.object({}),
        execute: async () =>
          parseK8sOutput(truncateMiddle(evidenceText(this.messages)))
      }),

      lookupRunbook: tool({
        description:
          "Look up known causes, read-only checks and fixes for a failure mode, e.g. OOMKilled, CrashLoopBackOff, ImagePullBackOff, FailedScheduling.",
        inputSchema: z.object({
          query: short().describe("A signal name or short description")
        }),
        execute: async ({ query }) =>
          lookupRunbook(query) ?? { error: `No runbook matches "${query}"` }
      }),

      recordIncident: tool({
        description:
          "Save a newly reported incident to memory. It becomes the active incident.",
        inputSchema: z.object({
          title: short(100).describe(
            "Short title, e.g. 'payments pod OOMKilled'"
          ),
          severity: z.enum(SEVERITIES),
          summary: short(400).describe("One or two sentences: what is failing"),
          signals: z
            .array(short(60))
            .max(10)
            .describe("Failure signals, e.g. CrashLoopBackOff, OOMKilled")
        }),
        execute: async (input) => {
          const incident = this.incidents.create(input);
          this.syncMemory({ activeIncidentId: incident.id });
          return { saved: incident.id, active: true };
        }
      }),

      setActiveIncident: tool({
        description: "Switch the active incident the conversation is about.",
        inputSchema: z.object({ id: short(40) }),
        execute: async ({ id }) => {
          if (!this.incidents.get(id))
            return { error: `No incident with id ${id}` };
          this.syncMemory({ activeIncidentId: id });
          return { active: id };
        }
      }),

      addTimelineEntry: tool({
        description:
          "Add an entry to an incident timeline (default: the active incident). Use kind 'evidence' only for text the user pasted or said, copied verbatim. Use 'hypothesis' for anything you infer, 'action' for what the user did, 'note' otherwise.",
        inputSchema: z.object({
          kind: z.enum(TIMELINE_KINDS),
          text: short(500),
          incidentId: short(40).optional()
        }),
        execute: async ({ kind, text, incidentId }) => {
          const id = incidentId ?? this.state.activeIncidentId;
          if (!id) return { error: "No active incident. Record one first." };
          // Unverifiable "evidence" is downgraded to a hypothesis.
          const stored = resolveKind(kind, text, userTexts(this.messages));
          const entry = this.incidents.addEntry(
            id,
            stored,
            text,
            stored === "evidence" ? "user" : "agent"
          );
          if (!entry) return { error: `No incident with id ${id}` };
          this.syncMemory();
          return {
            saved: entry.id,
            kind: stored,
            ...(stored !== kind && {
              note: "Not found in the user's messages, so stored as a hypothesis."
            })
          };
        }
      }),

      updateIncident: tool({
        description:
          "Change an incident's status, optionally recording the fix.",
        inputSchema: z.object({
          id: short(40).describe("Incident id, e.g. inc-a1b2c3"),
          status: z.enum(STATUSES),
          resolution: short(400)
            .optional()
            .describe("What fixed or mitigated it")
        }),
        execute: async ({ id, status, resolution }) => {
          const incident = this.incidents.update(id, status, resolution);
          if (!incident) return { error: `No incident with id ${id}` };
          this.syncMemory();
          return { updated: incident.id, status: incident.status };
        }
      }),

      recallIncidents: tool({
        description:
          "Search past incidents by keyword, or list the newest when no query is given.",
        inputSchema: z.object({
          query: short()
            .optional()
            .describe("Keyword, e.g. OOMKilled or a service name")
        }),
        execute: async ({ query }) => ({
          incidents: this.incidents.search(query).map((i) => ({
            id: i.id,
            title: i.title,
            severity: i.severity,
            status: i.status,
            summary: i.summary,
            resolution: i.resolution,
            createdAt: i.createdAt
          }))
        })
      }),

      setClusterContext: tool({
        description:
          "Remember cluster facts the user states: name, namespace, Kubernetes version, CNI, platform (bare metal or cloud), or a durable note.",
        inputSchema: z.object({
          name: short(80).optional(),
          namespace: short(80).optional(),
          version: short(40).optional().describe("e.g. 1.31"),
          cni: short(40).optional().describe("e.g. Calico"),
          platform: short(80).optional().describe("e.g. bare metal, AWS EKS"),
          note: short().optional().describe("One other durable fact")
        }),
        execute: async ({ note, ...fields }) => {
          const { cluster } = this.state;
          const notes =
            note && !cluster.notes.includes(note)
              ? [...cluster.notes, note].slice(-MAX_CLUSTER_NOTES)
              : cluster.notes;
          this.setState({
            ...this.state,
            cluster: {
              name: fields.name ?? cluster.name,
              namespace: fields.namespace ?? cluster.namespace,
              version: fields.version ?? cluster.version,
              cni: fields.cni ?? cluster.cni,
              platform: fields.platform ?? cluster.platform,
              notes
            }
          });
          return { saved: true };
        }
      }),

      runDiagnosis: tool({
        description:
          "Run the full multi-step diagnosis workflow on the user's pasted evidence. Takes no input. Progress shows in the side panel.",
        inputSchema: z.object({}),
        execute: async () => {
          const r = await this.beginDiagnosis();
          return "error" in r
            ? r
            : {
                started: true,
                note: "Running. Tell the user briefly and stop."
              };
        }
      }),

      generatePostmortem: tool({
        description:
          "Fetch everything recorded about a RESOLVED incident so you can write a blameless postmortem (timeline, impact, root cause, action items).",
        inputSchema: z.object({ id: short(40) }),
        execute: async ({ id }) => {
          const incident = this.incidents.get(id);
          if (!incident) return { error: `No incident with id ${id}` };
          if (incident.status !== "resolved") {
            return {
              error:
                "Only resolved incidents get a postmortem. Resolve it first."
            };
          }
          return {
            incident,
            timeline: this.incidents.timeline(id, 40),
            cluster: this.state.cluster,
            instructions:
              "Write a blameless postmortem with sections: Summary, Impact, Timeline, Root cause, Action items. Use only the data above. Write 'not recorded' where data is missing, and mark hypotheses as unconfirmed."
          };
        }
      })
    };
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({
      binding: withDedupedStreaming(this.env.AI)
    });

    const result = streamText({
      model: workersai(MODEL),
      system: buildSystemPrompt(this.state),
      messages: pruneMessages({
        messages: await convertToModelMessages(limitMessageText(this.messages)),
        toolCalls: "before-last-2-messages"
      }),
      tools: this.tools(),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      stopWhen: stepCountIs(MAX_STEPS),
      // Without this the model can spend every step on tools and say nothing.
      prepareStep: ({ stepNumber }) =>
        stepNumber >= MAX_STEPS - 1 ? { toolChoice: "none" } : undefined,
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse({ onError: friendlyError });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
