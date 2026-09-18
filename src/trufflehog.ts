import { spawn } from "node:child_process";

type CommandResult = { code: number; stdout: string; stderr: string };
type Runner = (directory: string) => Promise<CommandResult>;
type Finding = Record<string, unknown>;

export async function truffleHogFindings(directory: string, run: Runner = runTruffleHog): Promise<Finding[]> {
  const result = await run(directory);
  if (result.code !== 0) throw new Error(`TruffleHog failed: ${result.stderr || result.stdout}`);

  return result.stdout.split("\n").filter(Boolean).map((line) => {
    try {
      const finding = JSON.parse(line) as unknown;
      if (typeof finding !== "object" || finding === null || Array.isArray(finding)) throw new Error("not an object");
      return finding as Finding;
    } catch {
      throw new Error("TruffleHog emitted malformed JSON");
    }
  });
}

function runTruffleHog(directory: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("trufflehog", ["filesystem", "--json", "--no-update", directory]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
