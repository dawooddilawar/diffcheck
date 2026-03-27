import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

import type { CommandRunner } from "./opencode";
import type { ReviewMode } from "./args";
import type { Issue } from "./types";
import { extractIssues } from "./extractIssues";
import { runOpencode } from "./opencode";

export type AgentName = string;

export type RunAgentsOptions = {
  cwd: string;
  toolRootDir: string; // ai-code-review/ directory
  model: string;
  diff: string;
  mode: ReviewMode;
  timeoutMsPerAgent: number;
  runner?: CommandRunner;
  verbose?: boolean;
  debug?: boolean;
  onAgentStart?: (agent: AgentName) => void;
  onAgentDone?: (result: AgentRunResult) => void;
};

export type AgentRunResult = {
  agent: AgentName;
  rawStdout: string;
  rawStderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  startTimeMs: number;
  endTimeMs: number;
  issues: Issue[];
  modelNotFound: boolean;
  /** True if a known API error was detected in the output (rate limit, auth failure, quota, etc.). */
  apiError: boolean;
};

const RESERVED_AGENTS = new Set(["synthesizer"]);

export const API_ERROR_PATTERNS: RegExp[] = [
  /rate.?limit|too many requests|RateLimitError/i,
  /AuthenticationError|invalid.{0,10}api.?key|unauthorized/i,
  /insufficient.?quota|quota.?exceeded/i,
  /PermissionDeniedError|permission.?denied/i,
  /ServiceUnavailableError|service.?unavailable/i,
  /context.?length.?exceeded|maximum.?context|max.?tokens.?exceeded/i,
];

export function detectApiError(stderr: string): boolean {
  return API_ERROR_PATTERNS.some((p) => p.test(stderr));
}

export function discoverAgents(agentsDir: string): AgentName[] {
  return readdirSync(agentsDir)
    .filter((f) => extname(f) === ".md")
    .map((f) => basename(f, ".md"))
    .filter((name) => !RESERVED_AGENTS.has(name))
    .sort();
}

const SHALLOW_MODE_BLOCK = `## Review Mode: Shallow

**Do not call any tools.** Review only what is directly visible in the git diff below.
Do not read files, search the codebase, or run any shell commands.
Be conservative: only report issues you are confident about from the diff alone.
**Return at most 5 issues.** If you find more, keep only the 5 highest-confidence ones.`;

const DEEP_MODE_BLOCK = `## Review Mode: Deep

Use your tools actively as described in your workflow above.
**Return at most 5 issues.** If you find more, keep only the 5 highest-confidence ones.`;

function buildFullPrompt(agentPrompt: string, diff: string, mode: ReviewMode): string {
  const modeBlock = mode === "shallow" ? SHALLOW_MODE_BLOCK : DEEP_MODE_BLOCK;
  return `${agentPrompt}

${modeBlock}

Here is the git diff to review:

\`\`\`diff
${diff}
\`\`\``;
}

function detectModelNotFound(stdout: string, stderr: string): boolean {
  const hay = `${stdout}\n${stderr}`;
  return /ProviderModelNotFoundError|ModelNotFoundError/.test(hay);
}

export async function runAgents(opts: RunAgentsOptions): Promise<AgentRunResult[]> {
  const agentsDir = join(opts.toolRootDir, "agents");
  const agents = discoverAgents(agentsDir);
  const prompts = agents.map((agent) => readFileSync(join(agentsDir, `${agent}.md`), "utf8"));

  const jobs = agents.map(async (agent, i) => {
    opts.onAgentStart?.(agent);
    const startTimeMs = Date.now();
    const fullPrompt = buildFullPrompt(prompts[i]!, opts.diff, opts.mode);

    const debugPrefix = `[${agent}] `;
    const res = await runOpencode({
      cwd: opts.cwd,
      model: opts.model,
      prompt: fullPrompt,
      timeoutMs: opts.timeoutMsPerAgent,
      runner: opts.runner,
      killOnPatterns: API_ERROR_PATTERNS,
      onStdout: opts.debug ? (chunk) => process.stderr.write(debugPrefix + chunk) : undefined,
      onStderr: opts.debug ? (chunk) => process.stderr.write(debugPrefix + chunk) : undefined,
    });

    const parsed = extractIssues(res.stdout);
    const modelNotFound = detectModelNotFound(res.stdout, res.stderr);
    const apiError = !modelNotFound && detectApiError(res.stderr);
    const endTimeMs = Date.now();
    const result: AgentRunResult = {
      agent,
      rawStdout: res.stdout,
      rawStderr: res.stderr,
      exitCode: res.exitCode,
      timedOut: res.timedOut,
      durationMs: res.durationMs,
      startTimeMs,
      endTimeMs,
      issues: (parsed.issues as Issue[]).slice(0, 5),
      modelNotFound,
      apiError,
    };
    opts.onAgentDone?.(result);
    return result;
  });

  return await Promise.all(jobs);
}

export type SynthesizerOptions = {
  cwd: string;
  toolRootDir: string;
  model: string;
  diff: string;
  issues: Issue[];
  timeoutMs: number;
  runner?: CommandRunner;
};

export type SynthesizerResult = {
  issues: Issue[];
  rawStdout: string;
  rawStderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  apiError: boolean;
};

function buildSynthesizerPrompt(template: string, issues: Issue[], diff: string): string {
  return `${template}

## Candidate Issues

\`\`\`json
${JSON.stringify({ issues }, null, 2)}
\`\`\`

## Git Diff

\`\`\`diff
${diff}
\`\`\``;
}

export async function runSynthesizer(opts: SynthesizerOptions): Promise<SynthesizerResult> {
  const templatePath = join(opts.toolRootDir, "agents", "synthesizer.md");
  let template: string;
  try {
    template = readFileSync(templatePath, "utf8");
  } catch {
    return { issues: [], rawStdout: "", rawStderr: "", exitCode: 1, timedOut: false, durationMs: 0, apiError: false };
  }
  const prompt = buildSynthesizerPrompt(template, opts.issues, opts.diff);

  const res = await runOpencode({
    cwd: opts.cwd,
    model: opts.model,
    prompt,
    timeoutMs: opts.timeoutMs,
    runner: opts.runner,
    killOnPatterns: API_ERROR_PATTERNS,
  });

  const parsed = extractIssues(res.stdout);
  const apiError = detectApiError(res.stderr);

  return {
    issues: (parsed.issues as Issue[]).slice(0, 10),
    rawStdout: res.stdout,
    rawStderr: res.stderr,
    exitCode: res.exitCode,
    timedOut: res.timedOut,
    durationMs: res.durationMs,
    apiError,
  };
}
