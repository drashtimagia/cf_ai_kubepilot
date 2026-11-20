import type { ContainerFacts, K8sFacts, PodFacts } from "./k8s-parse";

const HEALTHY = new Set(["Running", "Completed", "Succeeded"]);

/** The pod a diagnosis is most likely about: the first unhealthy one. */
export function primaryPod(facts: K8sFacts): PodFacts | undefined {
  return (
    facts.pods.find(
      (p) =>
        (p.status && !HEALTHY.has(p.status)) ||
        (p.ready?.split("/")[0] !== p.ready?.split("/")[1] && p.ready) ||
        (p.restarts ?? 0) > 0
    ) ?? facts.pods[0]
  );
}

/** payments-api-7d9f8b6c5-x2k4p becomes payments-api (the Deployment). */
export function deploymentName(pod: string): string {
  return pod.replace(/-[a-f0-9]{8,10}-[a-z0-9]{5}$/, "");
}

const token = (names: string[]) => new RegExp(`<(?:${names.join("|")})>`, "gi");

/**
 * Replaces `<ns>`, `<pod>`, `<node>`, `<container>` and Deployment placeholders
 * with values taken from the parsed evidence. A placeholder stays as it is when
 * the evidence does not say what it should be, so we never invent a name.
 */
export function fillPlaceholders(
  command: string,
  facts: K8sFacts,
  namespaceHint = ""
): string {
  const pod = primaryPod(facts);
  const namespace = pod?.namespace || namespaceHint;
  const container: ContainerFacts | undefined = pod?.containers[0];

  let out = command;
  const swap = (names: string[], value: string | undefined) => {
    if (value) out = out.replace(token(names), value);
  };
  swap(["ns", "namespace"], namespace);
  swap(["pod", "pod-name", "pod_name"], pod?.name);
  swap(["node", "node-name"], pod?.node);
  swap(["container", "container-name"], container?.name);
  swap(
    ["deployment", "deploy", "deployment-name"],
    pod && deploymentName(pod.name)
  );
  if (pod)
    out = out.replace(
      /\b(deployment|deploy)\/<name>/gi,
      `$1/${deploymentName(pod.name)}`
    );
  // Models copy "namespace/pod" from alert text; kubectl wants just the pod.
  if (pod && namespace)
    out = out.split(`${namespace}/${pod.name}`).join(pod.name);
  return out;
}
