export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const STATUSES = ["open", "mitigated", "resolved"] as const;
export type IncidentStatus = (typeof STATUSES)[number];

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  summary: string;
  /** Failure signals seen, e.g. "OOMKilled", "ImagePullBackOff". */
  signals: string[];
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export const TIMELINE_KINDS = [
  "evidence",
  "hypothesis",
  "action",
  "note"
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/**
 * Where an entry came from. "user" and "tool" are facts we were given;
 * "agent" and "workflow" entries are LLM output and are never evidence.
 */
export type TimelineSource = "user" | "agent" | "workflow";

export interface TimelineEntry {
  id: number;
  incidentId: string;
  kind: TimelineKind;
  text: string;
  source: TimelineSource;
  createdAt: string;
}

/** What the user has told us about their cluster. Persisted across sessions. */
export interface ClusterContext {
  name: string;
  namespace: string;
  /** Kubernetes version, e.g. "1.31". */
  version: string;
  /** CNI plugin, e.g. "Calico". */
  cni: string;
  /** Where it runs, e.g. "bare metal" or "AWS EKS". */
  platform: string;
  notes: string[];
}

export const DIAGNOSIS_STEPS = [
  { id: "parse", label: "Parse evidence" },
  { id: "classify", label: "Classify failure" },
  { id: "context", label: "Gather context" },
  { id: "hypotheses", label: "Rank hypotheses" },
  { id: "save", label: "Write to timeline" }
] as const;
export type DiagnosisStepId = (typeof DIAGNOSIS_STEPS)[number]["id"];

export type StepStatus = "pending" | "running" | "complete" | "error";

export interface DiagnosisStep {
  id: DiagnosisStepId;
  label: string;
  status: StepStatus;
  message?: string;
}

export interface Hypothesis {
  title: string;
  confidence: "low" | "medium" | "high";
  why: string;
  /** A command that would confirm or rule this out. */
  command: string;
  /** False when the command changes or removes cluster resources. */
  readOnly: boolean;
}

export interface DiagnosisResult {
  category: string;
  severity: Severity;
  summary: string;
  signals: string[];
  /** Ranked, most likely first. These are LLM hypotheses, not facts. */
  hypotheses: Hypothesis[];
  incidentId: string;
}

export interface Diagnosis {
  /** Workflow instance id. */
  id: string;
  status: "running" | "complete" | "error";
  steps: DiagnosisStep[];
  result: DiagnosisResult | null;
  error: string | null;
}

/** Progress messages the workflow sends to the agent. */
export interface DiagnosisProgress {
  step: DiagnosisStepId;
  status: StepStatus;
  message?: string;
}

/**
 * Agent state: persisted by the Agents SDK and synced to every connected
 * client. `incidents` and `timeline` mirror SQLite rows for live UIs.
 */
export interface KubePilotState {
  cluster: ClusterContext;
  incidents: Incident[];
  /** The incident the conversation is about, if any. */
  activeIncidentId: string | null;
  /** Newest entries of the active incident, oldest first. */
  timeline: TimelineEntry[];
  /** The most recent diagnosis run, or null. */
  diagnosis: Diagnosis | null;
}

export const INITIAL_STATE: KubePilotState = {
  cluster: {
    name: "",
    namespace: "",
    version: "",
    cni: "",
    platform: "",
    notes: []
  },
  incidents: [],
  activeIncidentId: null,
  timeline: [],
  diagnosis: null
};
