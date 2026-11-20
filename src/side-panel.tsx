import { Badge, Button, Text } from "@cloudflare/kumo";
import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleNotchIcon,
  PlayIcon,
  WarningCircleIcon
} from "@phosphor-icons/react";
import { CopyButton } from "./copy-button";
import type {
  Diagnosis,
  Incident,
  KubePilotState,
  Severity,
  StepStatus,
  TimelineEntry
} from "./types";

const SEVERITY_VARIANT: Record<
  Severity,
  "secondary" | "primary" | "destructive"
> = {
  low: "secondary",
  medium: "secondary",
  high: "primary",
  critical: "destructive"
};

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <Text size="sm" bold>
        {title}
      </Text>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <Text size="xs" variant="secondary">
    {children}
  </Text>
);

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "complete")
    return (
      <CheckCircleIcon size={16} weight="fill" className="text-kumo-success" />
    );
  if (status === "running")
    return (
      <CircleNotchIcon size={16} className="animate-spin text-kumo-default" />
    );
  if (status === "error")
    return (
      <WarningCircleIcon size={16} weight="fill" className="text-kumo-danger" />
    );
  return <CircleDashedIcon size={16} className="text-kumo-inactive" />;
}

function DiagnosisCard({
  diagnosis,
  canRun,
  onRun
}: {
  diagnosis: Diagnosis | null;
  canRun: boolean;
  onRun: () => void;
}) {
  const running = diagnosis?.status === "running";
  return (
    <Section title="Diagnosis workflow">
      <Button
        variant="primary"
        size="sm"
        icon={<PlayIcon size={14} />}
        disabled={!canRun || running}
        onClick={onRun}
      >
        {running ? "Running…" : diagnosis ? "Run again" : "Run diagnosis"}
      </Button>
      {!diagnosis && (
        <Empty>
          Paste evidence or pick a sample, then run a multi-step diagnosis.
        </Empty>
      )}
      {diagnosis && (
        <ol className="space-y-1.5">
          {diagnosis.steps.map((s) => (
            <li
              key={s.id}
              className="flex items-start gap-2 text-sm text-kumo-default"
            >
              <span className="mt-0.5">
                <StepIcon status={s.status} />
              </span>
              <span>
                {s.label}
                {s.message && (
                  <span className="block text-xs text-kumo-subtle">
                    {s.message}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {diagnosis?.status === "error" && (
        <div
          role="alert"
          className="rounded-lg border border-kumo-danger p-2 text-xs text-kumo-danger"
        >
          {diagnosis.error ?? "Diagnosis failed."} Press Run again to retry.
        </div>
      )}
      {diagnosis?.result && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={SEVERITY_VARIANT[diagnosis.result.severity]}>
              {diagnosis.result.severity}
            </Badge>
            <Badge variant="secondary">{diagnosis.result.category}</Badge>
          </div>
          <Text size="xs" variant="secondary">
            {diagnosis.result.summary}
          </Text>
          <Text size="xs" variant="secondary">
            Ranked hypotheses (AI guesses, not facts):
          </Text>
          <ol className="space-y-2">
            {diagnosis.result.hypotheses.map((h) => (
              <li
                key={h.title}
                className="rounded-lg border border-kumo-line bg-kumo-base p-2.5 space-y-1"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-kumo-default">{h.title}</span>
                  <Badge variant="secondary">{h.confidence}</Badge>
                </div>
                <div className="text-xs text-kumo-subtle">{h.why}</div>
                <div className="rounded-md bg-kumo-control p-2 font-mono text-[11px] break-all text-kumo-default">
                  {h.command}
                </div>
                <div className="flex items-center justify-between">
                  {h.readOnly ? (
                    <span className="text-[11px] text-kumo-success">
                      ✓ read-only
                    </span>
                  ) : (
                    <span className="text-[11px] text-kumo-danger">
                      ⚠ changes the cluster
                    </span>
                  )}
                  <CopyButton text={h.command} />
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Section>
  );
}

const KIND_LABEL: Record<TimelineEntry["kind"], string> = {
  evidence: "evidence",
  hypothesis: "AI hypothesis",
  action: "action",
  note: "note"
};

function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0)
    return (
      <Empty>No entries yet. Evidence, hypotheses and actions land here.</Empty>
    );
  return (
    <ul className="space-y-1.5">
      {entries.map((e) => (
        <li key={e.id} className="text-xs text-kumo-default">
          <span
            className={
              e.kind === "hypothesis"
                ? "text-kumo-warning font-medium"
                : "text-kumo-subtle font-medium"
            }
          >
            {KIND_LABEL[e.kind]}
          </span>{" "}
          {e.text}
        </li>
      ))}
    </ul>
  );
}

function IncidentRow({
  incident,
  active,
  onSelect
}: {
  incident: Incident;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={`w-full text-left rounded-lg border p-2.5 space-y-1 ${active ? "border-kumo-ring bg-kumo-base" : "border-kumo-line bg-kumo-base hover:bg-kumo-control"}`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={SEVERITY_VARIANT[incident.severity]}>
            {incident.severity}
          </Badge>
          <Badge variant="secondary">{incident.status}</Badge>
          <span className="text-[11px] font-mono text-kumo-subtle">
            {incident.id}
          </span>
        </div>
        <div className="text-sm text-kumo-default">{incident.title}</div>
        {incident.resolution && (
          <div className="text-xs text-kumo-subtle">
            Fix: {incident.resolution}
          </div>
        )}
      </button>
    </li>
  );
}

/** Everything the agent knows and is doing, from synced agent state. */
export function SidePanel({
  state,
  canRun,
  onRun,
  onSelectIncident
}: {
  state: KubePilotState | undefined;
  canRun: boolean;
  onRun: () => void;
  onSelectIncident: (id: string) => void;
}) {
  if (!state) {
    return (
      <div className="p-4 space-y-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg bg-kumo-control"
          />
        ))}
      </div>
    );
  }
  const { cluster, incidents, timeline, activeIncidentId, diagnosis } = state;
  const facts = [
    ["Cluster", cluster.name],
    ["Namespace", cluster.namespace],
    ["Version", cluster.version],
    ["CNI", cluster.cni],
    ["Platform", cluster.platform]
  ].filter(([, v]) => v);

  return (
    <div className="flex flex-col gap-5 p-4">
      <DiagnosisCard diagnosis={diagnosis} canRun={canRun} onRun={onRun} />

      <Section title="Cluster facts">
        {facts.length === 0 && cluster.notes.length === 0 ? (
          <Empty>
            Nothing yet. Say e.g. "we run Calico on bare metal" and it is
            remembered.
          </Empty>
        ) : (
          <div className="text-sm text-kumo-default space-y-1">
            {facts.map(([k, v]) => (
              <div key={k}>
                {k}: {v}
              </div>
            ))}
            <ul className="list-disc pl-4 text-xs text-kumo-subtle">
              {cluster.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title={`Incidents (${incidents.length})`}>
        {incidents.length === 0 ? (
          <Empty>Reported incidents are remembered here across sessions.</Empty>
        ) : (
          <ul className="space-y-2">
            {incidents.map((i) => (
              <IncidentRow
                key={i.id}
                incident={i}
                active={i.id === activeIncidentId}
                onSelect={() => onSelectIncident(i.id)}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Active incident timeline">
        <Timeline entries={timeline} />
      </Section>
    </div>
  );
}
