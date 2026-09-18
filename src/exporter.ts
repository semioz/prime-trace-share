import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type Json = null | boolean | number | string | Json[] | JsonObject;
type JsonObject = { [key: string]: Json };

type CollectOptions = { cwd: string; sessionDir: string; secrets?: string[] };
type DatasetRow = {
  harness: "prime-agent";
  session_id: string;
  prompt: string;
  messages: Array<{ role: string; content: Json }>;
  tools: JsonObject[];
  metadata: JsonObject;
  sent_at: Json;
  num_user_messages: number;
  num_tool_calls: number;
  trace: JsonObject[];
  file_path: string;
};

type TraceFile = { file: string; trace: JsonObject[]; row: DatasetRow };

const SPECIAL_CALL = /\b(rlm\.(?:spawn|list_subagents|delete_subagent|collect|run)|agent_message\.send|agent_observe\.[A-Za-z_][A-Za-z0-9_]*|goal\.[A-Za-z_][A-Za-z0-9_]*|compact\.[A-Za-z_][A-Za-z0-9_]*|rlm_heartbeat\.[A-Za-z_][A-Za-z0-9_]*|bash)\s*\(/g;

export function collectPrimeTraces({ cwd, sessionDir, secrets = [] }: CollectOptions): TraceFile[] {
  const root = path.resolve(cwd);
  return fs.readdirSync(sessionDir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()
    .flatMap((file): TraceFile[] => {
      const trace = parseTrace(path.join(sessionDir, file));
      const header = trace[0];
      if (!header || header.type !== "session" || typeof header.cwd !== "string" || !isWithin(root, header.cwd)) return [];

      const redacted = trace.map((entry) => redact(entry, secrets) as JsonObject);
      const safeFile = `trace-${crypto.createHash("sha256").update(file).update(JSON.stringify(redacted)).digest("hex").slice(0, 16)}.jsonl`;
      return [{ file: safeFile, trace: redacted, row: datasetRow(safeFile, redacted) }];
    });
}

export function datasetFiles(traces: TraceFile[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const trace of traces) files.set(trace.file, `${trace.trace.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  files.set("train.jsonl", `${traces.map((trace) => JSON.stringify(trace.row)).join("\n")}\n`);
  return files;
}

function parseTrace(file: string): JsonObject[] {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as unknown)
      .filter(isRecord);
  } catch {
    return [];
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function redact(value: Json, secrets: string[]): Json {
  if (typeof value === "string") return secrets.reduce((text, secret) => secret ? text.replaceAll(secret, "[REDACTED]") : text, value);
  if (Array.isArray(value)) return value
    .filter((item) => !(isRecord(item) && (item.type === "thinking" || item.type === "image")))
    .map((item) => redact(item, secrets));
  if (!isRecord(value)) return value;

  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "cwd" && key !== "parentSession" && key !== "fullOutputPath" && !secrets.some((secret) => secret && key.includes(secret)))
    .map(([key, item]) => [key, redact(item, secrets)])) as JsonObject;
}

function datasetRow(file: string, trace: JsonObject[]): DatasetRow {
  const header = trace[0] ?? {};
  const messages = trace
    .filter((entry) => entry.type === "message" && isRecord(entry.message))
    .map((entry) => {
      const message = entry.message as JsonObject;
      return { role: typeof message.role === "string" ? message.role : "unknown", content: message.content ?? "" };
    });
  const specialCalls: Record<string, number> = {};
  let toolCalls = 0;

  for (const entry of trace) {
    if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "assistant" || !Array.isArray(entry.message.content)) continue;
    for (const part of entry.message.content) {
      if (!isRecord(part) || part.type !== "toolCall") continue;
      toolCalls++;
      if (part.name !== "ipython" || !isRecord(part.arguments) || typeof part.arguments.code !== "string") continue;
      for (const match of part.arguments.code.matchAll(SPECIAL_CALL)) specialCalls[match[1]] = (specialCalls[match[1]] ?? 0) + 1;
    }
  }

  const assistantEntry = trace.find((entry) => entry.type === "message" && isRecord(entry.message) && entry.message.role === "assistant");
  const assistant = assistantEntry && isRecord(assistantEntry.message) ? assistantEntry.message : {};
  return {
    harness: "prime-agent",
    session_id: typeof header.id === "string" ? header.id : crypto.createHash("sha256").update(file).digest("hex").slice(0, 16),
    prompt: textContent(messages.find((message) => message.role === "user")?.content),
    messages,
    tools: [{ type: "function", function: { name: "ipython", parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } } }],
    metadata: { source_file: file, session_version: header.version ?? null, model_provider: assistant.provider ?? null, model: assistant.model ?? null, special_calls: specialCalls },
    sent_at: header.timestamp ?? null,
    num_user_messages: messages.filter((message) => message.role === "user").length,
    num_tool_calls: toolCalls,
    trace,
    file_path: file,
  };
}

function textContent(content: Json | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(isRecord).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text as string).join("\n");
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
