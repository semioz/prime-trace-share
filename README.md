# prime-trace-share

Collect redacted [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) session traces and upload them to a public Hugging Face dataset.

## What it exports

- Prime sessions whose recorded working directory is inside `--cwd`
- one redacted JSONL file per session, with hashed filenames
- `train.jsonl`, with Pi-style metadata plus the complete redacted trace
- derived labels for `ipython` code such as `bash`, `rlm.spawn`, and `agent_message.send`

Thinking blocks, embedded images, session parent paths, output paths, project paths, and literal values supplied with `--secret` are removed before upload.

## Usage

```bash
cd /path/to/prime-trace-share
npm install
brew install trufflehog

node src/cli.mjs \
  --cwd /path/to/prime-agent \
  --repo your-hf-user/prime-agent-traces \
  --secret "$PRIME_API_KEY" \
  --dry-run
```

Remove `--dry-run` to create the public dataset repository if necessary and upload. Set `HF_TOKEN` or `HUGGINGFACE_TOKEN` to a Hugging Face write token first.

Prime Agent stores sessions in `~/.prime/agent/sessions/` by default. Run Prime Agent in the target public repository before exporting:

```bash
cd /path/to/prime-agent
prime-agent "Review the session format and run its focused tests."
```
