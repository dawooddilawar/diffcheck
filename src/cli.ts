#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";

import { DEFAULT_BASE_BRANCH, DEFAULT_CONFIDENCE_THRESHOLD, DEFAULT_MODEL, parseArgs } from "./args";
import { aggregateIssues, computeStats } from "./aggregate";
import type { AggregatedReview } from "./types";
import { getDiff, isGitRepo, parseDiffStats, type DiffMode } from "./git";
import { listOpencodeModels, OpencodeNotFoundError } from "./opencode";
import { renderMarkdown } from "./renderMarkdown";
import { renderTerminal } from "./renderTerminal";
import { runAgents, runSynthesizer } from "./runAgents";
import {
  agentIcon,
  deriveAgentStatus,
  formatDuration,
  printBanner,
  printTimingSummary,
  printVerboseAgentDetails,
  printVerboseInlineIssues,
  statusDisplay,
  tc,
  T_BOLD,
  T_CYAN,
  T_DIM,
  T_GREEN,
  T_RED,
  T_WHITE,
  T_YELLOW,
} from "./terminal";

function printHelp(): void {
  process.stdout.write(`Usage: opencode-review [OPTIONS]

AI-powered code review using parallel focused agents via opencode.

Options:
  -m, --model MODEL         LLM model to use (default: ${DEFAULT_MODEL})
  -b, --base BRANCH         Base branch for diff (default: ${DEFAULT_BASE_BRANCH})
  -c, --confidence NUM      Minimum confidence threshold 0-100 (default: ${DEFAULT_CONFIDENCE_THRESHOLD})
  -v, --verbose             Show detailed agent outputs for debugging
      --debug               Stream raw agent stdout/stderr live as it runs
      --deep                Deep mode: agents use tools to explore the codebase (slower)
      --local-only          Review only local changes (staged + unstaged + untracked),
                            skip committed branch changes
      --fail-on-issues      Exit with non-zero code when issues are found (for CI/CD)
      --set-model           Interactively select and save the default model
      --save-defaults       Save current --model, --base, --confidence as defaults
      --format FORMAT       Output format: terminal|json|markdown (default: terminal)
  -h, --help                Show this help message

Requires: opencode CLI (npm install -g opencode-ai)

`);
}

function promptUserSelection(question: string, max: number): Promise<number | null> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const n = Number(answer.trim());
      if (Number.isNaN(n) || n < 1 || n > max) {
        resolve(null);
        return;
      }
      resolve(n);
    });
  });
}

async function fetchAndPickModel(configPath: string, currentModel?: string, preloadedModels?: string[]): Promise<string | null> {
  let models: string[];
  if (preloadedModels && preloadedModels.length > 0) {
    models = preloadedModels;
  } else {
    process.stderr.write(`  ${tc(T_DIM, "Fetching available models…")}\n\n`);
    try {
      models = await listOpencodeModels();
    } catch {
      process.stderr.write(`  ${tc(T_RED, "Could not retrieve models from opencode.")}\n`);
      return null;
    }
    if (models.length === 0) {
      process.stderr.write(`  ${tc(T_RED, "No models returned by")} ${tc(T_CYAN, "opencode models")}${tc(T_RED, ".")}\n`);
      return null;
    }
  }

  process.stderr.write(`  ${tc(T_BOLD, "Available models:")}\n\n`);
  for (let i = 0; i < models.length; i++) {
    let marker = "";
    if (currentModel && models[i] === currentModel) {
      marker = tc(T_GREEN, " (current)");
    }
    process.stderr.write(`    ${tc(T_CYAN, String(i + 1).padStart(2))}. ${models[i]}${marker}\n`);
  }
  process.stderr.write("\n");

  const choice = await promptUserSelection(
    `  ${tc(T_YELLOW, "Select a model [1-" + models.length + "]")} (or press Enter to abort): `,
    models.length,
  );

  if (choice === null) return null;
  return saveModelChoice(models[choice - 1]!, configPath);
}

function readConfig(configPath: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function saveModelChoice(selected: string, configPath: string): string {
  try {
    const cfg = readConfig(configPath);
    cfg.defaultModel = selected;
    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    process.stderr.write(`\n  ${tc(T_GREEN, "✓")} Default model updated to ${tc(T_BOLD, selected)}\n`);
    process.stderr.write(`  ${tc(T_DIM, "Saved to " + configPath)}\n\n`);
  } catch {
    process.stderr.write(`\n  ${tc(T_YELLOW, "⚠")} Could not save preference to ${configPath}\n`);
    process.stderr.write(`  ${tc(T_DIM, "You can manually pass")} ${tc(T_CYAN, `--model ${selected}`)}\n\n`);
  }
  return selected;
}

async function handleModelNotFound(failedModel: string, configPath: string, preloadedModels?: string[]): Promise<string | null> {
  process.stderr.write(
    `\n  ${tc(`${T_BOLD}${T_RED}`, "Error:")} Model ${tc(T_BOLD, `'${failedModel}'`)} is not available from the provider.\n`,
  );
  process.stderr.write(`  ${tc(T_DIM, "Tip: run")} ${tc(T_CYAN, "opencode models")} ${tc(T_DIM, "to see available models at any time.")}\n\n`);
  return await fetchAndPickModel(configPath, undefined, preloadedModels);
}

function loadConfig(configPath: string): { model?: string; baseBranch?: string; confidenceThreshold?: number } {
  const cfg = readConfig(configPath);
  return {
    model: typeof cfg.defaultModel === "string" ? cfg.defaultModel : undefined,
    baseBranch: typeof cfg.baseBranch === "string" ? cfg.baseBranch : undefined,
    confidenceThreshold: typeof cfg.confidenceThreshold === "number" ? cfg.confidenceThreshold : undefined,
  };
}

function saveDefaults(
  { model, baseBranch, confidenceThreshold }: { model: string; baseBranch: string; confidenceThreshold: number },
  configPath: string,
): void {
  try {
    const cfg = readConfig(configPath);
    cfg.defaultModel = model;
    cfg.baseBranch = baseBranch;
    cfg.confidenceThreshold = confidenceThreshold;
    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    process.stderr.write(`\n  ${tc(T_GREEN, "✓")} Defaults saved:\n`);
    process.stderr.write(`    model:      ${tc(T_BOLD, model)}\n`);
    process.stderr.write(`    branch:     ${tc(T_BOLD, baseBranch)}\n`);
    process.stderr.write(`    confidence: ${tc(T_BOLD, String(confidenceThreshold))}\n`);
    process.stderr.write(`  ${tc(T_DIM, "Saved to " + configPath)}\n\n`);
  } catch {
    process.stderr.write(`\n  ${tc(T_YELLOW, "⚠")} Could not save defaults to ${configPath}\n`);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(String(e instanceof Error ? e.message : e) + "\n");
    return 1;
  }

  if (args.help) {
    printHelp();
    return 0;
  }

  const toolRootDir = dirname(dirname(__filename));
  const configPath = join(toolRootDir, ".code-review.json");

  if (args.setModel) {
    const savedConfig = loadConfig(configPath);
    const currentModel = savedConfig.model ?? DEFAULT_MODEL;
    process.stderr.write(`\n  ${tc(T_BOLD, "Change default model")}\n`);
    process.stderr.write(`  ${tc(T_DIM, "Current:")} ${tc(T_WHITE, currentModel)}\n\n`);
    const selected = await fetchAndPickModel(configPath, currentModel);
    return selected ? 0 : 1;
  }

  const isTerminal = args.format === "terminal";
  const cwd = process.cwd();

  if (!isGitRepo(cwd)) {
    process.stderr.write("Error: Not in a git repository\n");
    return 1;
  }

  // Apply saved defaults for settings not explicitly passed on the CLI
  const savedConfig = loadConfig(configPath);
  if (!args.explicitModel && savedConfig.model) args.model = savedConfig.model;
  if (!args.explicitBaseBranch && savedConfig.baseBranch) args.baseBranch = savedConfig.baseBranch;
  if (!args.explicitConfidence && savedConfig.confidenceThreshold !== undefined) {
    args.confidenceThreshold = savedConfig.confidenceThreshold;
  }

  if (args.saveDefaults) {
    saveDefaults({ model: args.model, baseBranch: args.baseBranch, confidenceThreshold: args.confidenceThreshold }, configPath);
    return 0;
  }

  if (isTerminal) {
    printBanner(args.model, args.baseBranch, args.reviewMode);
    process.stderr.write(`  ${tc(T_DIM, "Collecting diff…")}\n`);
  }

  const reviewStartMs = Date.now();
  const { diff, mode } = getDiff({ cwd, baseBranch: args.baseBranch, localOnly: args.localOnly });
  if (!diff.trim()) {
    process.stdout.write(
      "No changes to review.\nTip: stage changes with `git add ...`, or run from a branch that differs from the base, or keep local unstaged changes.\n",
    );
    return 0;
  }

  if (isTerminal) {
    const modeMessages: Partial<Record<DiffMode, string>> = {
      combined: `Reviewing branch diff against ${args.baseBranch} + local changes…`,
      branch: `Reviewing branch diff against ${args.baseBranch}…`,
      local: "Reviewing local changes (staged + unstaged + untracked)…",
    };
    const modeMsg = modeMessages[mode] ?? `Reviewing changes (${mode})…`;
    process.stderr.write(`  ${tc(T_DIM, modeMsg)}\n`);
  }

  if (args.verbose) {
    const fileStats = parseDiffStats(diff);
    if (fileStats.length > 0) {
      let totalAdd = 0, totalDel = 0;
      for (const f of fileStats) { totalAdd += f.additions; totalDel += f.deletions; }
      process.stderr.write(`\n  ${tc(T_BOLD, `Files changed (${fileStats.length}):`)}\n`);
      for (const f of fileStats) {
        const add = f.additions > 0 ? tc(T_GREEN, `+${f.additions}`) : "";
        const del = f.deletions > 0 ? tc(T_RED, `-${f.deletions}`) : "";
        const sep = add && del ? ", " : "";
        process.stderr.write(`    ${tc(T_DIM, "•")} ${f.file} (${add}${sep}${del})\n`);
      }
      process.stderr.write(`    ${tc(T_DIM, "Total:")} ${tc(T_GREEN, `+${totalAdd}`)}, ${tc(T_RED, `-${totalDel}`)}\n`);
    }
  }

  const agentsDir = join(toolRootDir, "agents");
  if (!existsSync(agentsDir)) {
    process.stderr.write(`Error: agents directory not found at ${agentsDir}\n`);
    return 1;
  }

  if (isTerminal) {
    process.stderr.write(`  ${tc(T_DIM, "Verifying model availability…")}\n`);
  }

  let availableModels: string[] = [];
  try {
    availableModels = await listOpencodeModels();
    if (availableModels.length > 0 && !availableModels.includes(args.model)) {
      if (isTerminal && process.stdin.isTTY) {
        const selected = await handleModelNotFound(args.model, configPath, availableModels);
        if (!selected) return 1;
        args.model = selected;
      } else {
        process.stderr.write(
          `Error: Model '${args.model}' is not available.\n`,
        );
        process.stderr.write(`Fix: run \`opencode models\` to see available models, then pass one with \`--model <provider/model>\`.\n`);
        return 1;
      }
    }
  } catch (e) {
    if (e instanceof OpencodeNotFoundError) {
      process.stderr.write(`\n  ${tc(`${T_BOLD}${T_RED}`, "Error:")} ${e.message}\n\n`);
      return 1;
    }
    process.stderr.write(`  ${tc(T_YELLOW, "⚠")} Could not verify model availability, proceeding anyway.\n`);
  }

  if (isTerminal) {
    process.stderr.write(`  ${tc(T_DIM, "Running agents…")}\n\n`);
  }

  const timeoutMsPerAgent = args.reviewMode === "shallow" ? 180_000 : 600_000;

  const runReview = async (model: string) =>
    await runAgents({
      cwd,
      toolRootDir,
      model,
      diff,
      mode: args.reviewMode,
      timeoutMsPerAgent,
      verbose: args.verbose,
      debug: args.debug,
      onAgentStart: (agent) => {
        if (isTerminal) {
          process.stderr.write(`  ${agentIcon(agent)} ${tc(T_DIM, agent.padEnd(12))} ${tc(T_DIM, "running…")}\n`);
        }
      },
      onAgentDone: (result) => {
        if (!isTerminal) return;
        const status = deriveAgentStatus(result);
        const icon = agentIcon(result.agent);
        const statusStr = status === "OK" ? tc(`${T_BOLD}${T_GREEN}`, "✓ done") : statusDisplay(status);
        const issueCount = result.issues.length;
        const issueStr = issueCount > 0
          ? tc(T_WHITE, `${issueCount} issue${issueCount !== 1 ? "s" : ""}`)
          : tc(T_DIM, "0 issues");
        const dur = tc(T_DIM, formatDuration(result.durationMs));
        process.stderr.write(`  ${icon} ${tc(T_BOLD, result.agent.padEnd(12))} ${statusStr}   ${issueStr}   ${dur}\n`);
        if (args.verbose) {
          printVerboseInlineIssues(result);
        }
      },
    });

  let agentResults = await runReview(args.model);

  const modelNotFoundAgents = agentResults.filter((r) => r.modelNotFound);
  if (modelNotFoundAgents.length > 0) {
    if (isTerminal && process.stdin.isTTY) {
      const selected = await handleModelNotFound(args.model, configPath, availableModels);
      if (selected) {
        args.model = selected;
        process.stderr.write(`  ${tc(T_DIM, "Re-running review with")} ${tc(T_BOLD, selected)}${tc(T_DIM, "…")}\n\n`);
        agentResults = await runReview(selected);

        const stillMissing = agentResults.filter((r) => r.modelNotFound);
        if (stillMissing.length > 0) {
          process.stderr.write(
            `  ${tc(T_RED, "Error:")} Model '${selected}' also failed. Run ${tc(T_CYAN, "opencode models")} to check availability.\n`,
          );
          return 1;
        }
      } else {
        return 1;
      }
    } else {
      process.stderr.write(
        `Error: Model '${args.model}' was not found by provider for ${modelNotFoundAgents.length} agent(s).\n`,
      );
      process.stderr.write(`Fix: run \`opencode models\` to see available models, then pass one with \`--model <provider/model>\`.\n`);
      return 1;
    }
  }

  const apiErrorAgents = agentResults.filter((r) => r.apiError);
  if (apiErrorAgents.length > 0) {
    if (isTerminal) {
      process.stderr.write(
        `\n  ${tc(`${T_BOLD}${T_RED}`, "API Error:")} ${apiErrorAgents.length} agent(s) encountered an API error. Run with ${tc(T_CYAN, "-v")} for details.\n`,
      );
    } else {
      process.stderr.write(`Error: ${apiErrorAgents.length} agent(s) encountered an API error.\n`);
    }

    if (apiErrorAgents.length >= agentResults.length) {
      process.stderr.write(isTerminal ? "\n" : "");
      return 1;
    }
  }

  if (args.verbose) {
    process.stdout.write(`Model: ${args.model}\n`);
    process.stdout.write(`Base branch: ${args.baseBranch}\n`);
    process.stdout.write(`Confidence threshold: ${args.confidenceThreshold}\n`);
    process.stdout.write(`Diff mode: ${mode}\n\n`);
    printVerboseAgentDetails(agentResults);
  } else {
    const failedAgents = agentResults.filter((r) => r.exitCode !== 0 || r.timedOut);
    if (failedAgents.length > 0) {
      process.stdout.write(
        `Warning: ${failedAgents.length} agent(s) failed or timed out; run with -v for detailed diagnostics.\n`,
      );
    }
  }

  const allIssues = agentResults.map((r) => r.issues);
  const aggregated = aggregateIssues(allIssues, { confidenceThreshold: args.confidenceThreshold });

  if (isTerminal) {
    process.stderr.write(`  🔬 ${tc(T_DIM, "synthesizer".padEnd(12))} ${tc(T_DIM, "running…")}\n`);
  }

  const synthResult = await runSynthesizer({
    cwd,
    toolRootDir,
    model: args.model,
    diff,
    issues: aggregated.issues,
    timeoutMs: 180_000,
  });

  const finalIssues = synthResult.issues.length > 0 ? synthResult.issues : aggregated.issues;

  if (isTerminal) {
    const synthStatus = deriveAgentStatus({ ...synthResult, modelNotFound: false });
    const statusStr = synthStatus === "OK" ? tc(`${T_BOLD}${T_GREEN}`, "✓ done") : statusDisplay(synthStatus);
    const dur = tc(T_DIM, formatDuration(synthResult.durationMs));
    process.stderr.write(`  🔬 ${tc(T_BOLD, "synthesizer".padEnd(12))} ${statusStr}   ${dur}\n`);
  }

  if (synthResult.exitCode !== 0 || synthResult.timedOut) {
    const reason = synthResult.apiError
      ? "API error"
      : synthResult.timedOut
        ? "timed out"
        : `exit code ${synthResult.exitCode}`;
    if (args.verbose || synthResult.apiError) {
      process.stderr.write(`  ${tc(T_YELLOW, `⚠ synthesizer failed (${reason}), using aggregated issues.`)}\n`);
    }
  }

  const finalStats = synthResult.issues.length > 0
    ? computeStats(finalIssues, aggregated.stats.total_candidates, aggregated.stats.confidence_threshold, aggregated.stats.duplicates_removed)
    : aggregated.stats;
  const finalReview: AggregatedReview = { issues: finalIssues, stats: finalStats };

  if (isTerminal) {
    process.stderr.write("\n");
    if (args.verbose && synthResult.issues.length > 0) {
      const preSynthCount = aggregated.stats.filtered_count;
      const postSynthCount = finalReview.stats.filtered_count;
      process.stderr.write(`  ${tc(T_DIM, `Pre-synthesis: ${preSynthCount} issue(s) from agents → Synthesizer: ${postSynthCount} issue(s) after dedup & validation`)}\n\n`);
    }
    process.stdout.write(renderTerminal(finalReview) + "\n");
    const timingEntries = [
      ...agentResults,
      { agent: "synthesizer", durationMs: synthResult.durationMs },
    ];
    printTimingSummary(reviewStartMs, Date.now(), timingEntries);
  } else if (args.format === "json") {
    process.stdout.write(JSON.stringify(finalReview, null, 2) + "\n");
  } else {
    process.stdout.write(renderMarkdown(finalReview, { renderEmpty: true }) + "\n");
  }

  // Fail if issues were found and --fail-on-issues is set
  if (args.failOnIssues && finalReview.stats.filtered_count > 0) {
    return 1;
  }

  return 0;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(String(err instanceof Error ? err.stack ?? err.message : err) + "\n");
      process.exit(1);
    },
  );
}
