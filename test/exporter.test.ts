import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectPrimeTraces } from "../src/exporter.ts";

test("collectPrimeTraces keeps project sessions and produces safe Prime dataset rows", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prime-share-hf-"));
  const project = path.join(root, "prime-agent");
  const sessions = path.join(root, "sessions");
  fs.mkdirSync(path.join(project, "packages"), { recursive: true });
  fs.mkdirSync(sessions);

  const inside = [
    { type: "session", version: 3, id: "inside", timestamp: "2026-01-01T00:00:00.000Z", cwd: path.join(project, "packages"), parentSession: "/private/session.jsonl" },
    { type: "message", message: { role: "user", content: "Check token secret-token" } },
    { type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "private" }, { type: "toolCall", name: "ipython", arguments: { code: "await rlm.spawn('review', name='reviewer')\nawait bash('npm test')", "secret-token": "value" } }, { type: "image", data: "x".repeat(300), mimeType: "image/png" }] } },
  ];
  fs.writeFileSync(path.join(sessions, "secret-token.jsonl"), `${inside.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  fs.writeFileSync(path.join(sessions, "outside.jsonl"), `${JSON.stringify({ type: "session", cwd: path.join(root, "private") })}\n`);

  try {
    const traces = collectPrimeTraces({ cwd: project, sessionDir: sessions, secrets: ["secret-token"] });
    assert.equal(traces.length, 1);
    assert.equal(traces[0].row.harness, "prime-agent");
    assert.equal(traces[0].row.prompt, "Check token [REDACTED]");
    assert.deepEqual(traces[0].row.metadata.special_calls, { "rlm.spawn": 1, bash: 1 });
    assert.equal(JSON.stringify(traces[0].trace).includes("private"), false);
    assert.equal(JSON.stringify(traces[0].trace).includes(project), false);
    assert.equal(JSON.stringify(traces[0].trace).includes("secret-token"), false);
    assert.equal(traces[0].file.includes("secret-token"), false);
    assert.equal(JSON.stringify(traces[0].row).includes("secret-token"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
