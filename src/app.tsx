import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import {
  Badge,
  Button,
  Empty,
  InputArea,
  PoweredByCloudflare,
  Switch,
  Text
} from "@cloudflare/kumo";
import { Toasty } from "@cloudflare/kumo/components/toast";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import {
  BugIcon,
  ChatCircleDotsIcon,
  CircleIcon,
  ListIcon,
  MoonIcon,
  XIcon,
  PaperPlaneRightIcon,
  StopIcon,
  SunIcon,
  TrashIcon
} from "@phosphor-icons/react";
import { flagCommandBlocks } from "./commands";
import { CodeBlock } from "./copy-button";
import { fixture } from "./fixtures";
import { getClusterId } from "./cluster-id";
import { SidePanel } from "./side-panel";
import type { KubePilotState } from "./types";
import type { KubePilotAgent } from "./server";

const SAMPLES = [
  { id: "crashloop-describe", label: "CrashLoopBackOff" },
  { id: "pending-describe", label: "Pending: insufficient CPU" },
  { id: "imagepull-describe", label: "ImagePullBackOff" }
] as const;

const MAX_INPUT_CHARS = 50_000;
const MODEL_LIMIT_CHARS = 12_000;

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
  );

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    const mode = next ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [dark]);

  return (
    <Button
      variant="secondary"
      shape="square"
      icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      onClick={toggle}
      aria-label="Toggle theme"
    />
  );
}

function Chat() {
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [clusterId] = useState(getClusterId);
  const [requireApproval, setRequireApproval] = useState(false);

  const agent = useAgent<KubePilotAgent, KubePilotState>({
    agent: "KubePilotAgent",
    name: clusterId,
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onError: useCallback(
      (error: Event) => console.error("WebSocket error:", error),
      []
    )
  });

  const {
    messages,
    sendMessage,
    clearHistory,
    stop,
    status,
    error,
    clearError
  } = useAgentChat({
    agent,
    experimental_throttle: 100
  });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isStreaming) textareaRef.current?.focus();
  }, [isStreaming]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, isStreaming, sendMessage]);

  const hasUserMessage = messages.some((m) => m.role === "user");
  const diagnosisRunning = agent.state?.diagnosis?.status === "running";
  const canRun = connected && !isStreaming && hasUserMessage;

  const runDiagnosis = useCallback(async () => {
    setNotice(null);
    try {
      const r = (await agent.call("runDiagnosisNow", [requireApproval])) as {
        error?: string;
      };
      if (r.error) setNotice(r.error);
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Could not start the diagnosis."
      );
    }
  }, [agent, requireApproval]);

  const reviewChanges = useCallback(
    (approve: boolean) => void agent.call("reviewChanges", [approve]),
    [agent]
  );

  const selectIncident = useCallback(
    (id: string) => void agent.call("selectIncident", [id]),
    [agent]
  );

  const sendText = useCallback(
    (text: string) =>
      sendMessage({ role: "user", parts: [{ type: "text", text }] }),
    [sendMessage]
  );

  const panel = (
    <SidePanel
      state={agent.state}
      canRun={canRun}
      onRun={runDiagnosis}
      onSelectIncident={selectIncident}
      clusterId={clusterId}
      requireApproval={requireApproval}
      onRequireApproval={setRequireApproval}
      onReview={reviewChanges}
    />
  );

  return (
    <div className="flex h-dvh bg-kumo-elevated">
      <div className="flex flex-col flex-1 min-w-0">
        <header className="px-3 sm:px-5 py-3 sm:py-4 bg-kumo-base border-b border-kumo-line">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-kumo-default">
                <span className="mr-2">☸️</span>KubePilot
              </h1>
              <span className="hidden sm:inline-flex">
                <Badge variant="secondary">Llama 3.3 · Workers AI</Badge>
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-1.5">
                <CircleIcon
                  size={8}
                  weight="fill"
                  className={
                    connected ? "text-kumo-success" : "text-kumo-danger"
                  }
                />
                <span className="hidden sm:inline">
                  <Text size="xs" variant="secondary">
                    {connected ? "Connected" : "Disconnected"}
                  </Text>
                </span>
              </div>
              <div className="hidden sm:flex items-center gap-1.5">
                <BugIcon size={14} className="text-kumo-inactive" />
                <Switch
                  checked={showDebug}
                  onCheckedChange={setShowDebug}
                  size="sm"
                  aria-label="Toggle debug mode"
                />
              </div>
              <ThemeToggle />
              <Button
                variant="secondary"
                icon={<TrashIcon size={16} />}
                onClick={clearHistory}
                aria-label="Clear chat"
              >
                <span className="hidden sm:inline">Clear</span>
              </Button>
              <span className="lg:hidden">
                <Button
                  variant="secondary"
                  icon={<ListIcon size={16} />}
                  onClick={() => setShowPanel(true)}
                  aria-label="Open details panel"
                >
                  <span className="hidden min-[480px]:inline">
                    {diagnosisRunning ? "Running…" : "Details"}
                  </span>
                </Button>
              </span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">
            {!connected && (
              <output className="block rounded-lg bg-kumo-control p-3 text-sm text-kumo-subtle">
                Connecting to the agent…
              </output>
            )}

            {messages.length === 0 && (
              <Empty
                icon={<ChatCircleDotsIcon size={32} />}
                title="Try a sample incident"
                description="One click loads real kubectl output. Then press Run diagnosis."
                contents={
                  <div className="flex flex-wrap justify-center gap-2">
                    {SAMPLES.map((sample) => (
                      <Button
                        key={sample.id}
                        variant="outline"
                        size="sm"
                        disabled={isStreaming || !connected}
                        onClick={() => sendText(fixture(sample.id))}
                      >
                        {sample.label}
                      </Button>
                    ))}
                  </div>
                }
              />
            )}

            {messages.map((message: UIMessage, index: number) => {
              const isUser = message.role === "user";
              const isLastAssistant =
                message.role === "assistant" && index === messages.length - 1;

              return (
                <div key={message.id} className="space-y-2">
                  {showDebug && (
                    <pre className="text-[11px] text-kumo-subtle bg-kumo-control rounded-lg p-3 overflow-auto max-h-64">
                      {JSON.stringify(message, null, 2)}
                    </pre>
                  )}
                  {message.parts.map((part, i) => {
                    if (isToolUIPart(part)) {
                      return (
                        <div key={`${message.id}-${i}`} className="flex">
                          <Badge variant="secondary">
                            {part.state === "output-available"
                              ? "✓"
                              : part.state === "output-error"
                                ? "✗"
                                : "…"}{" "}
                            {getToolName(part)}
                          </Badge>
                        </div>
                      );
                    }
                    if (part.type !== "text" || !part.text) return null;
                    const key = `${message.id}-${i}`;

                    if (
                      isUser &&
                      part.text.includes("\n") &&
                      part.text.length > 200
                    ) {
                      return (
                        <div key={key} className="flex justify-end">
                          <div className="w-full max-w-[92%] space-y-1">
                            <Text size="xs" variant="secondary">
                              Pasted {part.text.split("\n").length} lines
                            </Text>
                            <CodeBlock text={part.text} />
                          </div>
                        </div>
                      );
                    }

                    if (isUser) {
                      return (
                        <div key={key} className="flex justify-end">
                          <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-kumo-contrast text-kumo-inverse leading-relaxed whitespace-pre-wrap break-words">
                            {part.text}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={key} className="flex justify-start">
                        <div className="max-w-[92%] sm:max-w-[85%] rounded-2xl rounded-bl-md bg-kumo-base text-kumo-default leading-relaxed">
                          <Streamdown
                            className="sd-theme rounded-2xl rounded-bl-md p-3"
                            plugins={{ code }}
                            controls={{ code: { copy: true, download: false } }}
                            isAnimating={isLastAssistant && isStreaming}
                          >
                            {flagCommandBlocks(part.text)}
                          </Streamdown>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="border-t border-kumo-line bg-kumo-base">
          {(error || notice) && (
            <div
              role="alert"
              className="mx-3 sm:mx-5 mt-3 flex items-start justify-between gap-2 rounded-lg border border-kumo-danger p-2.5 text-sm text-kumo-danger max-w-3xl lg:mx-auto"
            >
              <span>{error?.message || notice}</span>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={() => {
                  clearError();
                  setNotice(null);
                }}
              >
                <XIcon size={14} />
              </button>
            </div>
          )}
          {hasUserMessage && (
            <div className="max-w-3xl mx-auto px-3 sm:px-5 pt-3">
              <Button
                variant="outline"
                size="sm"
                disabled={!canRun || diagnosisRunning}
                onClick={runDiagnosis}
              >
                {diagnosisRunning ? "Diagnosis running…" : "Run diagnosis"}
              </Button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="max-w-3xl mx-auto px-3 sm:px-5 py-3 sm:py-4"
          >
            <div className="flex items-end gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm focus-within:ring-2 focus-within:ring-kumo-ring focus-within:border-transparent transition-shadow">
              <InputArea
                ref={textareaRef}
                value={input}
                onValueChange={setInput}
                maxLength={MAX_INPUT_CHARS}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                }}
                placeholder="Paste kubectl output or logs…"
                disabled={!connected || isStreaming}
                rows={1}
                className="flex-1 ring-0! focus:ring-0! shadow-none! bg-transparent! outline-none! resize-none max-h-40"
              />
              {isStreaming ? (
                <Button
                  type="button"
                  variant="secondary"
                  shape="square"
                  aria-label="Stop generation"
                  icon={<StopIcon size={18} />}
                  onClick={stop}
                  className="mb-0.5"
                />
              ) : (
                <Button
                  type="submit"
                  variant="primary"
                  shape="square"
                  aria-label="Send message"
                  disabled={!input.trim() || !connected}
                  icon={<PaperPlaneRightIcon size={18} />}
                  className="mb-0.5"
                />
              )}
            </div>
          </form>
          {input.length > MODEL_LIMIT_CHARS && (
            <p className="text-center text-xs text-kumo-subtle pb-1">
              Long paste: the middle will be trimmed to fit the model.
            </p>
          )}
          <div className="flex justify-center pb-3">
            <PoweredByCloudflare href="https://developers.cloudflare.com/agents/" />
          </div>
        </div>
      </div>
      <aside className="hidden lg:block w-96 shrink-0 border-l border-kumo-line bg-kumo-base overflow-y-auto">
        {panel}
      </aside>
      {showPanel && (
        <dialog
          open
          aria-label="Details"
          className="fixed inset-0 z-20 m-0 h-full w-full max-w-none overflow-y-auto bg-kumo-base p-0 text-kumo-default lg:hidden"
        >
          <div className="sticky top-0 flex justify-end bg-kumo-base border-b border-kumo-line p-2">
            <Button
              variant="secondary"
              icon={<XIcon size={16} />}
              onClick={() => setShowPanel(false)}
              aria-label="Close details panel"
            >
              Close
            </Button>
          </div>
          {panel}
        </dialog>
      )}
    </div>
  );
}

export default function App() {
  return (
    <Toasty>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-dvh text-kumo-inactive">
            Loading...
          </div>
        }
      >
        <Chat />
      </Suspense>
    </Toasty>
  );
}
