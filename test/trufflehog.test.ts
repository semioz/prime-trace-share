import assert from "node:assert/strict";
import test from "node:test";
import { truffleHogFindings } from "../src/trufflehog.ts";

test("truffleHogFindings rejects scanner failures", async () => {
  await assert.rejects(
    truffleHogFindings("/redacted", async () => ({ code: 1, stdout: "", stderr: "scanner failed" })),
    /scanner failed/,
  );
});

test("truffleHogFindings rejects malformed scanner output", async () => {
  await assert.rejects(
    truffleHogFindings("/redacted", async () => ({ code: 0, stdout: "not json\n", stderr: "" })),
    /malformed JSON/,
  );
});

test("truffleHogFindings blocks every reported finding", async () => {
  const findings = await truffleHogFindings("/redacted", async () => ({
    code: 0,
    stdout: `${JSON.stringify({ DetectorName: "GitHub", Raw: "ghp_secret" })}\n`,
    stderr: "",
  }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].DetectorName, "GitHub");
});
