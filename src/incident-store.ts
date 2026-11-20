import type {
  Incident,
  IncidentStatus,
  Severity,
  TimelineEntry,
  TimelineKind,
  TimelineSource
} from "./types";

/** The shape of `this.sql` on an Agent: a tagged template over DO SQLite. */
export type Sql = <T = Record<string, string | number | null>>(
  strings: TemplateStringsArray,
  ...values: (string | number | boolean | null)[]
) => T[];

interface IncidentRow {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  summary: string;
  signals: string;
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

interface TimelineRow {
  id: number;
  incident_id: string;
  kind: TimelineKind;
  text: string;
  source: TimelineSource;
  created_at: string;
}

function toEntry(row: TimelineRow): TimelineEntry {
  return {
    id: row.id,
    incidentId: row.incident_id,
    kind: row.kind,
    text: row.text,
    source: row.source,
    createdAt: row.created_at
  };
}

function toIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    title: row.title,
    severity: row.severity,
    status: row.status,
    summary: row.summary,
    signals: JSON.parse(row.signals) as string[],
    resolution: row.resolution,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Incident history, stored in the agent's own Durable Object SQLite. */
export class IncidentStore {
  constructor(private readonly sql: Sql) {}

  init(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        summary TEXT NOT NULL,
        signals TEXT NOT NULL DEFAULT '[]',
        resolution TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`;
    this.sql`
      CREATE TABLE IF NOT EXISTS timeline (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`;
    this.sql`
      CREATE TABLE IF NOT EXISTS alerts (
        key TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL
      )`;
  }

  /** The incident an alert already opened, so a re-fire does not open another. */
  incidentForAlert(key: string): string | undefined {
    const [row] = this.sql<{ incident_id: string }>`
      SELECT incident_id FROM alerts WHERE key = ${key}`;
    return row?.incident_id;
  }

  linkAlert(key: string, incidentId: string): void {
    this.sql`
      INSERT OR REPLACE INTO alerts (key, incident_id) VALUES (${key}, ${incidentId})`;
  }

  /** Returns the new entry, or undefined if the incident does not exist. */
  addEntry(
    incidentId: string,
    kind: TimelineKind,
    text: string,
    source: TimelineSource
  ): TimelineEntry | undefined {
    if (!this.get(incidentId)) return undefined;
    const now = new Date().toISOString();
    this.sql`
      INSERT INTO timeline (incident_id, kind, text, source, created_at)
      VALUES (${incidentId}, ${kind}, ${text}, ${source}, ${now})`;
    const [row] = this.sql<TimelineRow>`
      SELECT * FROM timeline WHERE incident_id = ${incidentId} ORDER BY id DESC LIMIT 1`;
    return row ? toEntry(row) : undefined;
  }

  /** Newest `limit` entries, returned oldest first. */
  timeline(incidentId: string, limit = 8): TimelineEntry[] {
    return this.sql<TimelineRow>`
      SELECT * FROM timeline WHERE incident_id = ${incidentId}
      ORDER BY id DESC LIMIT ${limit}`
      .map(toEntry)
      .reverse();
  }

  create(input: {
    title: string;
    severity: Severity;
    summary: string;
    signals: string[];
  }): Incident {
    const id = `inc-${crypto.randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();
    this.sql`
      INSERT INTO incidents (id, title, severity, status, summary, signals, created_at, updated_at)
      VALUES (${id}, ${input.title}, ${input.severity}, 'open', ${input.summary},
              ${JSON.stringify(input.signals)}, ${now}, ${now})`;
    return this.get(id) as Incident;
  }

  get(id: string): Incident | undefined {
    const [row] = this
      .sql<IncidentRow>`SELECT * FROM incidents WHERE id = ${id}`;
    return row ? toIncident(row) : undefined;
  }

  /** Returns the updated incident, or undefined if the id does not exist. */
  update(
    id: string,
    status: IncidentStatus,
    resolution?: string
  ): Incident | undefined {
    if (!this.get(id)) return undefined;
    const now = new Date().toISOString();
    this.sql`
      UPDATE incidents
      SET status = ${status}, resolution = COALESCE(${resolution ?? null}, resolution), updated_at = ${now}
      WHERE id = ${id}`;
    return this.get(id);
  }

  /** Newest first. With a query, matches title, summary, signals or resolution. */
  search(query?: string, limit = 5): Incident[] {
    const q = query?.trim();
    const rows = q
      ? this.sql<IncidentRow>`
          SELECT * FROM incidents
          WHERE title LIKE ${`%${q}%`} OR summary LIKE ${`%${q}%`}
             OR signals LIKE ${`%${q}%`} OR resolution LIKE ${`%${q}%`}
          ORDER BY created_at DESC LIMIT ${limit}`
      : this.sql<IncidentRow>`
          SELECT * FROM incidents ORDER BY created_at DESC LIMIT ${limit}`;
    return rows.map(toIncident);
  }
}
