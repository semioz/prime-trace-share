#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRepo, uploadFiles } from "@huggingface/hub";
import { collectPrimeTraces, datasetFiles } from "./exporter.ts";
import { truffleHogFindings } from "./trufflehog.ts";

type Options = {
  cwd: string;
  sessionDir: string;
  repo: string;
  secrets: string[];
  dryRun: boolean;
  help: boolean;
};

const options = parseArgs(process.argv.slice(2));
if (options.help || !options.repo) {
  console.log("Usage: prime-trace-share --repo <user/dataset> [--cwd <project>] [--session-dir <dir>] [--secret <value>] [--dry-run]");
  process.exit(options.help ? 0 : 1);
}

const traces = collectPrimeTraces({ cwd: options.cwd, sessionDir: options.sessionDir, secrets: options.secrets });
const files = datasetFiles(traces);
files.set("README.md", datasetCard(options.repo));

console.log(`Collected ${traces.length} Prime Agent session(s).`);
console.log(`Prepared ${files.size} dataset file(s).`);

const staging = fs.mkdtempSync(path.join(os.tmpdir(), "prime-trace-share-"));
try {
  for (const [file, content] of files) fs.writeFileSync(path.join(staging, file), content);
  const findings = await truffleHogFindings(staging);
  if (findings.length > 0) throw new Error(`TruffleHog blocked upload: ${findings.length} finding(s).`);

  if (!options.dryRun) {
    const accessToken = process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN;
    if (!accessToken) throw new Error("Set HF_TOKEN or HUGGINGFACE_TOKEN with write access to the dataset repository.");

    try {
      await createRepo({ repo: { type: "dataset", name: options.repo }, visibility: "public", accessToken });
    } catch (error) {
      if (!String(error).includes("409")) throw error;
    }

    await uploadFiles({
      repo: { type: "dataset", name: options.repo },
      accessToken,
      commitTitle: `Upload ${traces.length} Prime Agent trace(s)`,
      files: [...files].map(([file, content]) => ({ path: file, content: new Blob([content]) })),
    });
  }
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}

function parseArgs(args: string[]): Options {
  const result: Options = {
    cwd: process.cwd(),
    sessionDir: path.join(os.homedir(), ".prime", "agent", "sessions"),
    repo: "",
    secrets: [],
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--repo") result.repo = required(args, ++index, argument);
    else if (argument === "--cwd") result.cwd = path.resolve(required(args, ++index, argument));
    else if (argument === "--session-dir") result.sessionDir = path.resolve(required(args, ++index, argument));
    else if (argument === "--secret") result.secrets.push(required(args, ++index, argument));
    else if (argument === "--dry-run") result.dryRun = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!fs.existsSync(result.sessionDir)) throw new Error(`Prime Agent session directory does not exist: ${result.sessionDir}`);
  return result;
}

function required(args: string[], index: number, option: string): string {
  if (!args[index]) throw new Error(`Missing value for ${option}`);
  return args[index];
}

function datasetCard(repo: string): string {
  return `---
pretty_name: Prime Agent traces
tags:
- agent-traces
- coding-agent
- prime-agent
language:
- en
- code
license: other
configs:
- config_name: default
  data_files:
  - split: train
    path: train.jsonl
---

# Prime Agent traces for ${repo}

Redacted Prime Agent sessions. Each train row preserves the redacted JSONL trace and adds semantic labels for programmatic calls inside the native ipython tool.
`;
}
