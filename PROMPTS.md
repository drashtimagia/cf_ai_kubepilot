# PROMPTS.md

Every prompt given to the AI coding assistant while building KubePilot, verbatim, in order.

## Prompt 1

> You are helping me build a take-home project for a Cloudflare Senior Software Engineer (Kubernetes Platform) application. Requirements:
> - LLM: Llama 3.3 on Workers AI (verify the current model ID in the Cloudflare docs, e.g. @cf/meta/llama-3.3-70b-instruct-fp8-fast)
> - Workflow/coordination: Cloudflare Agents SDK (Durable Objects) + Cloudflare Workflows
> - User input via chat, served from the same Worker (static assets) or Pages
> - Memory/state: Durable Object SQLite storage + agent state synced to the client
> - Repo name: cf_ai_kubepilot. Must have README.md (setup, local run, deploy, architecture) and PROMPTS.md.
>
> The app: "KubePilot", an AI incident copilot for Kubernetes. Users paste kubectl output, pod logs, events or alerts; the agent triages, runs a multi-step diagnosis workflow, suggests next commands/fixes, and remembers incidents and cluster context across sessions.
>
> Rules for the whole project:
> 1. TypeScript, strict mode. Keep it small and readable. Quality matters more than feature count.
> 2. Before using any Cloudflare API, check the current docs (use the Cloudflare docs MCP server if available) rather than relying on memory. APIs in `agents` change often.
> 3. After every one of my prompts, append it verbatim to PROMPTS.md under a numbered heading, with a one-line note on what changed.
> 4. At the end of each part, run typecheck/tests and tell me exactly how to verify it manually.
>
> Don't write code yet. Confirm the plan, list the files you expect to create, and flag anything in my requirements that looks wrong or outdated.

**What changed:** Planning only. Checked current Cloudflare docs; created this file. No code yet.

## Prompt 2

> Part 1: Scaffold.
> - Start from Cloudflare's official agents starter template (npm create cloudflare@latest with the agents-starter template; check the docs for the exact command).
> - Strip the demo tools down to nothing; keep the chat UI and the AIChatAgent wiring.
> - Configure wrangler.jsonc: Workers AI binding (AI), the agent Durable Object binding with a SQLite migration, compatibility date set to today.
> - Switch the model to Llama 3.3 on Workers AI (via workers-ai-provider). Remove any OpenAI dependency and key.
> - Make `npm run dev` work locally and `npm run deploy` work. Note any Workers AI local-dev limitations in the README.
> Done when: I can chat with Llama 3.3 in the browser locally and on a workers.dev URL.

**What changed:** Scaffolded from `cloudflare/agents-starter`; replaced demo tools/MCP/image UI with a minimal `KubePilotAgent` (`AIChatAgent`) on Llama 3.3 via `workers-ai-provider`; configured `wrangler.jsonc` (AI binding, DO + SQLite migration, compat date 2026-11-19).

*Follow-up in Part 1 (no new prompt):* fixed local dev (upgraded wrangler/vite plugin, registered workers.dev subdomain), fixed duplicated streamed tokens with `src/ai-binding.ts`, deployed to workers.dev.

## Prompt 3

> Start Part 2

**What changed:** Part 2: typed agent state (`cluster` + `incidents`) synced to the client, incident history in Durable Object SQLite (`IncidentStore`), four memory tools (`recordIncident`, `updateIncident`, `recallIncidents`, `setClusterContext`), memory injected into the system prompt, log truncation for the 24k context, a live memory sidebar, and 12 unit tests. Also extended the streaming dedupe wrapper to tool-call chunks.

## Prompt 4

> Deploy

**What changed:** Deployed Part 2 to https://cf-ai-kubepilot.drashtimagia02.workers.dev (version f4d1d826); no code changes.

## Prompt 5

> Start Part 3

**What changed:** Started a first sketch of the DiagnosisWorkflow (`src/workflow.ts`, state types, agent callbacks, wrangler binding); superseded by Prompt 8.

## Prompt 6

> Part 2: Make KubePilot good at Kubernetes triage.
>
> Behavior: it talks like a calm senior SRE. It names the failure mode and how confident it is, asks for the single most useful next piece of evidence, and gives exact kubectl commands, each marked as read-only or as changing the cluster. It never makes up facts about the cluster.
>
> Tools:
> - parseK8sOutput: a pure function, no LLM, that pulls structured facts (pod, namespace, status, restarts, exit codes, reasons, events) out of pasted `kubectl get`/`describe`/`logs` output.
> - lookupRunbook: a small local knowledge base covering about 10 common failure modes (causes, checks, fixes).
>
> Rules: stream the responses. Cut very long pastes down sensibly and tell the user you did. Keep the system prompt in its own file.
>
> Tests: unit tests for parseK8sOutput using 5 or more realistic fixtures, which Part 5 will reuse as the demo samples.
>
> Done when: pasting a CrashLoopBackOff `kubectl describe pod` gives a specific, correct diagnosis and a next command that's safe to run.

**What changed:** Triage behavior. New pure `parseK8sOutput` (`src/k8s-parse.ts`), 10-entry `lookupRunbook` (`src/runbooks.ts`), SRE persona and rules in their own file (`src/system-prompt.ts`), truncation helpers moved to `src/limits.ts` with a marker the prompt tells the model to report, 6 realistic fixtures (`src/fixtures.ts`) and tests. Both tools are exposed to the agent. The half-built workflow now reuses the parser.

## Prompt 7

> Part 3: Memory. Give KubePilot durable memory using the agent's built-in SQLite and synced state.
>
> Persist: incidents (status, severity, summary), a per-incident timeline (evidence / hypothesis / action / note), and cluster facts the user states (k8s version, CNI, bare metal vs cloud). Expose these as agent tools. Each turn, put cluster facts and the active incident's recent timeline into the prompt, with a size limit.
>
> Rules: store only what the user said or what tools returned, and label anything the LLM guessed as a hypothesis. Sync incidents and the active incident to the UI via agent state.
>
> Done when: after a page refresh, the conversation and incidents are still there, and the agent remembers "we run Calico on bare metal" without being told again.

**What changed:** Memory: per-incident timeline (evidence/hypothesis/action/note with a source) in Durable Object SQLite, cluster facts (version, CNI, platform) and an active incident in synced state, `addTimelineEntry` and `setActiveIncident` tools, prompt memory with a size limit, and a rule that unverifiable "evidence" is stored as a hypothesis. Added a state migration for DOs saved by older versions. Verified live: Calico/bare metal survived a reload and was recalled.

## Prompt 8

> Part 4: Add a durable `DiagnosisWorkflow` (Cloudflare Workflows) that the agent starts through a `runDiagnosis` tool or a UI button.
>
> Steps: parse evidence → classify (LLM, strict JSON validated with zod) → gather context (runbook, cluster facts, similar past incidents) → ranked hypotheses, each with a command to confirm it → write the result back to the agent and the incident timeline.
>
> Rules: LLM steps retry with backoff, and each step reports its progress to agent state so the UI updates live. Keep the step logic in pure functions so it can be tested without Workers AI.
>
> Also: a `generatePostmortem` tool for resolved incidents (blameless: timeline, impact, root cause, action items).
>
> Done when: clicking "Run diagnosis" on a sample shows each step progressing and saves a structured diagnosis to the timeline.

**What changed:** `DiagnosisWorkflow` with steps parse, classify (zod-validated JSON), gather context (runbook, cluster facts, similar past incidents via agent RPC), ranked hypotheses, and write-back to the timeline. Step logic is pure (`src/diagnosis-steps.ts`) and tested with a mocked AI. Started by the `runDiagnosis` tool or the UI button; progress streams through agent state. Added `generatePostmortem`. Found and fixed a live bug: Workers AI truncated JSON at its default output limit, so `maxOutputTokens` is now set explicitly.

## Prompt 9

> Part 5: Make the demo work in 10 seconds for a reviewer who reads no docs.
>
> Layout: chat on one side; incidents, timeline, live workflow progress and cluster facts on the other. Show pasted logs and commands in monospace, with copy buttons, and flag commands that change the cluster.
>
> Add 3 one-click samples (CrashLoopBackOff, Pending with insufficient CPU, ImagePullBackOff). Include loading, empty and error states, and make it work on a phone-width screen. Add no new heavy dependencies.
>
> Done when: on the deployed URL, clicking a sample → chat → "Run diagnosis" works end to end on desktop and mobile.

**What changed:** Demo UI: chat plus a side panel (workflow progress, cluster facts, incidents, timeline), a drawer on phones, 3 one-click samples, monospace pastes with copy buttons, commands labelled read-only or "changes the cluster" by our own check, and loading, empty and error states. No new dependencies. Checked at desktop and 375px width.

## Prompt 10

> Part 6: Review this repo the way a skeptical Cloudflare engineer would, then fix what you find.
>
> - Code: remove leftover starter code, use strict types, set limits on input size, and handle Workers AI errors and rate limits cleanly. Commit no secrets.
> - Tests: the parser, the workflow steps (with a mocked AI), and one agent integration test if it's practical.
> - README: the live URL at the top, a 30-second demo path, a Mermaid architecture diagram, how each of the four required components maps to the code, local setup and deploy steps, trade-offs and limitations.
> - PROMPTS.md: complete and in order.
>
> Then deploy, and list the weaknesses that remain, ranked by how much a reviewer would care.

**What changed:** Review pass: removed leftover starter code and the bloated .gitignore, audited for secrets (none), friendly Workers AI error and rate-limit handling, server-side error logging, output-token limit, extracted and tested message helpers, rewrote the README (live URL, demo path, Mermaid diagram, component map, trade-offs), then deployed. Live testing on the deployed URL found and fixed two more bugs: the model could spend every step on tool calls and never answer (the last step is now forced to be text), and long inline commands overflowed chat bubbles on phones.

## Prompt 11

> Move this session to a folder

**What changed:** Copied the project to `~/Documents/cf_ai_kubepilot` and moved the session there (the first folder picker was cancelled; no code changes).

## Prompt 12

> is the project ready? we need to send github repo link

**What changed:** Initialised git, made the first commit, created the public repo https://github.com/drashtimagia/cf_ai_kubepilot and pushed `main`. No code changes.

## Prompt 13

> Note: AI-assisted coding is encouraged, but you have to submit prompt history.
> how to send this

**What changed:** Logged prompts 11 to 13 so the history in the repo is complete; no code changes.

## Prompt 14

> https://cf-ai-kubepilot.drashtimagia02.workers.dev/ add this to my portfolio as projects on vercel

**What changed:** No change to this repo. Added a KubePilot entry to `data/projects.ts` in the separate `portfolio-drashti` repo and pushed it, which triggered the Vercel deploy.

## Prompt 15

> Add an evaluation harness and publish the numbers
>
> * What: build 25 to 30 labelled incident scenarios (extending src/fixtures.ts) with the known root cause for each. A script runs each one through the real diagnosis workflow and reports:
>    * how often the correct cause is the top hypothesis, and how often it is in the top three;
>    * how often the suggested confirm command is read-only when it should be;
>    * how often a hypothesis states a cluster fact that isn't in the input (the hallucination rate).
> * Why it stands out: almost no take-home reports measured accuracy. It also backs your "never makes up facts" claim with a number instead of a promise. The README would say something like "top-3 correct on 24 of 30".
> * Effort: about a day. The pure step logic is already testable.
>
> 2. Make it proactive, and fix the shared-agent weakness
>
> * What: add an Alertmanager or Prometheus webhook endpoint. An incoming alert creates an incident and starts the diagnosis workflow automatically. Use one Durable Object per cluster instead of the single `default` one.
> * Why it stands out: today it only reacts to pastes. Reacting to alerts is the real platform use case, and one Durable Object per cluster is a better architecture story. It also resolves the top weakness I listed, that everyone shares one agent.
> * Effort: one to two days, including simple auth, such as a per-cluster token.
>
> 3. Add a way to pipe real cluster output in
>
> * What: a small `kubepilot` CLI or script, so `kubectl describe pod x | kubepilot` posts to an API endpoint and prints the diagnosis. Keep it read-only.
> * Why it stands out: it feels like a tool an engineer would use, not a web demo.
> * Effort: a few hours once the endpoint from step 2 exists.
>
> Smaller polish that adds credibility
>
> * Fill in placeholders: suggested commands should use the real namespace and pod from the parsed facts instead of `<ns>`. That is a visible flaw today.
> * Show it working: add a 60-second screen recording at the top of the README and a short "design decisions" section.
> * Use a Workflows approval step: `waitForApproval` before any cluster-changing suggestion would show off a Cloudflare primitive. It's lower priority, because KubePilot never runs commands.
>
> do all

**What changed:** Added a live evaluation harness (28 labelled incidents, `npm run eval`, results in `eval/RESULTS.md`: correct cause in the top 3 for 26/28, 0/111 hypotheses with an invented identifier). The eval exposed a parser bug (exit 137 was always called OOMKilled), fixed. Added one agent per cluster with per-cluster tokens, an Alertmanager webhook that opens incidents and starts diagnoses, and a `kubepilot` CLI. Suggested commands now get `<ns>`/`<pod>` filled from the evidence, with an `ns/pod` normalisation found by testing the webhook. Added an opt-in `waitForApproval` step (approve and reject both exercised live, by temporarily forcing the pause). README gained evaluation, alerts and CLI, and design decisions sections. Not deployed. I cannot record a screen video, so that item is not done.

## Prompt 16

> Deploy and push

**What changed:** Set the `WEBHOOK_SECRET` Worker secret, deployed to Cloudflare, verified the live site and webhook, and pushed to GitHub.
