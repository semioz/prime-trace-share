import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SPECIAL_CALL = /\b(rlm\.(?:spawn|list_subagents|delete_subagent|collect|run)|agent_message\.send|agent_observe\.[A-Za-z_][A-Za-z0-9_]*|goal\.[A-Za-z_][A-Za-z0-9_]*|compact\.[A-Za-z_][A-Za-z0-9_]*|rlm_heartbeat\.[A-Za-z_][A-Za-z0-9_]*|bash)\s*\(/g;

export function collectPrimeTraces({ cwd, sessionDir, secrets = [] }) {
  const root = path.resolve(cwd);
  return fs.readdirSync(sessionDir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort()
    .flatMap((file) => {
      const source = path.join(sessionDir, file);
      const trace = parseTrace(source);
      const header = trace[0];
      if (!header || header.type !== "session" || typeof header.cwd !== "string" || !isWithin(root, header.cwd)) return [];

      const redacted = trace.map((entry) => redact(entry, secrets));
      const safeFile = `trace-${crypto.createHash("sha256").update(file).update(JSON.stringify(redacted)).digest("hex").slice(0, 16)}.jsonl`;
      return [{ file: safeFile, trace: redacted, row: datasetRow(safeFile, redacted) }];
    });
}

export function datasetFiles(traces) {
  const files = new Map();
  for (const trace of traces) files.set(trace.file, `${trace.trace.map(JSON.stringify).join("\n")}\n`);
  files.set("train.jsonl", `${traces.map((trace) => JSON.stringify(trace.row)).join("\n")}\n`);
  return files;
}

function parseTrace(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  try {
    return lines.map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function redact(value, secrets) {
  if (typeof value === "string") return secrets.reduce((text, secret) => secret ? text.replaceAll(secret, "[REDACTED]") : text, value);
  if (Array.isArray(value)) return value
    .filter((item) => !(isRecord(item) && (item.type === "thinking" || item.type === "image")))
    .map((item) => redact(item, secrets));
  if (!isRecord(value)) return value;

  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "cwd" && key !== "parentSession" && key !== "fullOutputPath" && !secrets.some((secret) => secret && key.includes(secret)))
    .map(([key, item]) => [key, redact(item, secrets)]));
}

function datasetRow(file, trace) {
  const header = trace[0] ?? {};
  const messages = trace
    .filter((entry) => entry.type === "message" && isRecord(entry.message))
    .map((entry) => ({ role: String(entry.message.role ?? "unknown"), content: entry.message.content ?? "" }));
  const specialCalls = {};
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

  const assistant = trace.find((entry) => entry.type === "message" && isRecord(entry.message) && entry.message.role === "assistant")?.message ?? {};
  return {
    harness: "prime-agent",
    session_id: typeof header.id === "string" ? header.id : crypto.createHash("sha256").update(file).digest("hex").slice(0, 16),
    prompt: textContent(messages.find((message) => message.role === "user")?.content),
    messages,
    tools: [{ type: "function", function: { name: "ipython", parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } } }],
    metadata: {
      source_file: file,
      session_version: header.version,
      model_provider: assistant.provider,
      model: assistant.model,
      special_calls: specialCalls,
    },
    sent_at: header.timestamp,
    num_user_messages: messages.filter((message) => message.role === "user").length,
    num_tool_calls: toolCalls,
    trace,
    file_path: file,
  };
}

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(isRecord).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
