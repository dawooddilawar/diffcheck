import spawn from "cross-spawn";

export type RunCommandOptions = {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  /** Kill the process immediately if any of these patterns match in stdout or stderr. */
  killOnPatterns?: RegExp[];
};

export type RunCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
};

export type CommandRunner = (cmd: string, args: string[], opts: RunCommandOptions) => Promise<RunCommandResult>;

export const defaultRunner: CommandRunner = async (cmd, args, opts) => {
  const started = Date.now();

  return await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;

    const checkKillPatterns = (chunk: string) => {
      if (!opts.killOnPatterns || timedOut || finished) return;
      if (opts.killOnPatterns.some((p) => p.test(chunk))) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    };

    const timer =
      opts.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            try {
              child.kill("SIGKILL");
            } catch {
              // ignore
            }
          }, opts.timeoutMs)
        : null;

    if (!child.stdout || !child.stderr || !child.stdin) {
      throw new Error("Failed to open stdio streams for child process");
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      const chunk = String(d);
      stderr += chunk;
      checkKillPatterns(chunk);
    });

    if (opts.stdin) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();

    const done = (exitCode: number) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode,
        timedOut,
        durationMs: Date.now() - started,
      });
    };

    child.on("error", () => done(127));
    child.on("close", (code) => done(code ?? 1));
  });
};

export type RunOpencodeParams = {
  cwd: string;
  model: string;
  prompt: string;
  timeoutMs: number;
  runner?: CommandRunner;
  killOnPatterns?: RegExp[];
};

export async function runOpencode(params: RunOpencodeParams): Promise<RunCommandResult> {
  const runner = params.runner ?? defaultRunner;
  return await runner(
    "opencode",
    ["run", "--model", params.model, params.prompt],
    { cwd: params.cwd, timeoutMs: params.timeoutMs, killOnPatterns: params.killOnPatterns },
  );
}

export class OpencodeNotFoundError extends Error {
  constructor() {
    super("opencode CLI not found. Install it with: npm install -g opencode-ai");
    this.name = "OpencodeNotFoundError";
  }
}

export async function listOpencodeModels(runner?: CommandRunner): Promise<string[]> {
  const run = runner ?? defaultRunner;
  const res = await run("opencode", ["models"], { cwd: process.cwd(), timeoutMs: 30_000 });
  if (res.exitCode === 127) throw new OpencodeNotFoundError();
  const combined = `${res.stdout}\n${res.stderr}`;
  return combined
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.includes("/") && !l.startsWith("INFO") && !l.startsWith("WARN") && !l.startsWith("ERROR"));
}
