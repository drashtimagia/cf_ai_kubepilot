import { useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";

/** Copies text to the clipboard and briefly confirms. */
export function CopyButton({
  text,
  label = "Copy"
}: {
  text: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      // Clipboard can be blocked (insecure context, permissions). Nothing to do.
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-kumo-subtle hover:bg-kumo-control hover:text-kumo-default"
    >
      {done ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      {done ? "Copied" : label}
    </button>
  );
}

/** Monospace block with a copy button, for pasted logs and commands. */
export function CodeBlock({
  text,
  maxHeight = "16rem"
}: {
  text: string;
  maxHeight?: string;
}) {
  return (
    <div className="rounded-lg border border-kumo-line bg-kumo-control">
      <div className="flex justify-end px-1 pt-1">
        <CopyButton text={text} />
      </div>
      <pre
        className="overflow-auto px-3 pb-3 font-mono text-[12px] leading-relaxed text-kumo-default whitespace-pre"
        style={{ maxHeight }}
      >
        {text}
      </pre>
    </div>
  );
}
