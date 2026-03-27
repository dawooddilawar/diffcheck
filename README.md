# diffcheck

[![CI](https://github.com/dawooddilawar/diffcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/dawooddilawar/diffcheck/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/diffcheck.svg)](https://www.npmjs.com/package/diffcheck)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AI-powered code review CLI using [opencode](https://opencode.ai) with parallel focused agents.

## Overview

Runs parallel AI agents against your git diff, each focused on a different concern. Agents are **auto-discovered** from Markdown files in the `agents/` directory — just drop in a new `.md` file and it runs on the next review.

Built-in agents:

| Agent | Focus |
|-------|-------|
| **Security** | Vulnerabilities, auth issues, injection risks |
| **Correctness** | Logic errors, bugs, edge cases |
| **Design** | Patterns, architecture, code organization |
| **Readability** | Code clarity, naming, complexity |
| **Tests** | Coverage, quality, edge cases |
| **Reliability** | Error handling, edge cases, robustness |

Issues are filtered by confidence score (default 80%) to reduce false positives.

## Prerequisites

- **Node.js** >= 20 and `npm`
- **[opencode](https://opencode.ai)** CLI installed and authenticated
- Git repository

### Install prerequisites

```bash
# Install opencode
npm install -g opencode-ai

# Authenticate with a provider (Optional - only needed if you have your own api key)
opencode auth login
```

> See [Opencode Docs](https://opencode.ai/docs/) for alternative installation methods.

## Installation

```bash
npm install -g diffcheck
```

Or run without installing:

```bash
npx diffcheck
```

## Usage

```bash
# Review staged changes (falls back to diff vs main)
diffcheck

# Use a specific model
diffcheck --model anthropic/claude-sonnet-4-20250514
diffcheck --model ollama/qwen3:8b

# Compare against a different base branch
diffcheck --base develop

# Lower confidence threshold to see more issues
diffcheck --confidence 60

# Output as JSON (useful for CI artifacts)
diffcheck --format json

# Fail if issues found (for CI/CD)
diffcheck --fail-on-issues

# Interactively change the default model
diffcheck --set-model

# Show help
diffcheck --help
```

### Options

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--model` | `-m` | `opencode/big-pickle` | LLM model to use |
| `--base` | `-b` | `main` | Base branch for diff comparison |
| `--confidence` | `-c` | `80` | Minimum confidence threshold (0–100) |
| `--verbose` | `-v` | `false` | Show detailed agent outputs for debugging |
| `--deep` | | `false` | Deep mode: agents use tools to explore the codebase (slower) |
| `--local-only` | | `false` | Review only local changes (staged + unstaged + untracked) |
| `--fail-on-issues` | | `false` | Exit with non-zero code when issues found (for CI/CD) |
| `--set-model` | | | Interactively select and save the default model |
| `--save-defaults` | | | Save current `--model`, `--base`, `--confidence` as defaults |
| `--format` | | `terminal` | Output format: `terminal`, `json`, `markdown` |
| `--help` | `-h` | | Show help message |

## How It Works

1. **Get diff** — checks staged changes (`git diff --staged`), falls back to branch comparison (`git diff <base>...HEAD`)
2. **Spawn agents** — discovers all `.md` files in `agents/` and runs them in parallel via `opencode`
3. **Collect results** — each agent outputs JSON with issues and confidence scores
4. **Aggregate** — merges all issues, filters by confidence threshold, removes duplicates
5. **Synthesize** — runs a final pass to validate and de-duplicate issues
6. **Display** — formats results as terminal output, JSON, or Markdown

## Output Example

```
  ╔═════════════════════════════════════════════╗
  ║            AGENT EXECUTION SUMMARY          ║
  ╚═════════════════════════════════════════════╝

  Total agents:       6
  Successful:         6
  Failed:             0
  Timed out:          0

  ──────────────────────────────────────────────

  security       ✓ OK     2 issues   18s
  correctness    ✓ OK     1 issue    22s
  design         ✓ OK     0 issues   15s
  readability    ✓ OK     0 issues   17s
  tests          ✓ OK     1 issue    20s
  reliability    ✓ OK     0 issues   16s

══════════════════════════════════════════════════
                  CODE REVIEW SUMMARY
══════════════════════════════════════════════════

Found 3 issue(s) (filtered from 4 candidates, threshold: 80%)

By Severity:
  HIGH:   1
  MEDIUM: 2

──────────────────────────────────────────────────

1. [SECURITY] SQL injection risk — raw user input in query
   Severity: HIGH | Confidence: 92%
   → src/controllers/UserController.php:45

2. [LOGIC] Null pointer possible — variable used before check
   Severity: MEDIUM | Confidence: 85%
   → src/services/OrderService.php:123

3. [TESTS] Missing error case — no test for invalid input
   Severity: MEDIUM | Confidence: 82%
   → tests/UserService.test.ts:89
```

## CI/CD Integration

### GitHub Actions

```yaml
name: AI Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install diffcheck
        run: npm install -g diffcheck
      - name: Run code review
        run: diffcheck --format json > review.json
        continue-on-error: true
      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: code-review
          path: review.json
      - name: Fail on issues
        run: diffcheck --fail-on-issues
```

### GitLab CI

```yaml
code_review:
  stage: test
  script:
    - npm install -g diffcheck
    - diffcheck --format json > review.json
  artifacts:
    paths:
      - review.json
    when: always
  allow_failure: true
```

## Configuration

### Using local models (Ollama)

For fully self-hosted reviews with no external API calls:

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull qwen3:8b

# Run code review
diffcheck --model ollama/qwen3:8b
```

> See [Ollama](https://ollama.com/download) for installation instructions.

### Saving defaults

Interactively pick a default model:

```bash
diffcheck --set-model
```

Or save any combination of model, base branch, and confidence threshold:

```bash
diffcheck --model ollama/qwen3:8b --base develop --confidence 70 --save-defaults
```

Saved defaults are stored in `.code-review.json` and can always be overridden per-run with explicit flags.

## File Structure

```
diffcheck/
├── agents/               # Agent prompts — each .md file = one agent (auto-discovered)
│   ├── security.md
│   ├── correctness.md
│   ├── design.md
│   ├── readability.md
│   ├── tests.md
│   ├── reliability.md
│   ├── synthesizer.md    # Final deduplication & validation
│   └── *.md              # Drop any new .md file here to add an agent
├── src/                  # TypeScript source (dist/cli.js is the bin entry point)
├── test/                 # Unit tests
├── .code-review.json     # Saved defaults (model, base branch, confidence)
└── package.json
```

## Customization

### Adding a new agent

Agents are auto-discovered from `agents/*.md` — no code changes required. To add one:

1. Create a new `.md` file in `agents/`:
   ```bash
   touch agents/accessibility.md
   ```

2. The agent output must follow this JSON schema:

   ```json
   {
     "issues": [
       {
         "type": "ACCESSIBILITY",
         "severity": "HIGH | MEDIUM | LOW",
         "title": "Brief description",
         "file": "path/to/file.ext",
         "line": 123,
         "evidence": "What you found and why it matters",
         "impact": "What could go wrong",
         "recommendation": "How to fix it",
         "confidence": 85
       }
     ]
   }
   ```

3. That's it. Run `diffcheck` and the new agent runs in parallel with all the others.

### Removing an agent

Delete or move the `.md` file out of `agents/`. It will no longer run.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License — see [LICENSE](LICENSE) for details.

## Acknowledgments

Built with:
- [opencode](https://opencode.ai) — LLM execution framework
- [Node.js](https://nodejs.org) — Runtime
- [TypeScript](https://www.typescriptlang.org/) — Type safety

---

**Made with ❤️ for better code reviews**
