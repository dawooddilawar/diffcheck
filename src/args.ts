export type OutputFormat = "terminal" | "json" | "markdown";
export type ReviewMode = "shallow" | "deep";

export const DEFAULT_MODEL = "opencode/big-pickle";
export const DEFAULT_BASE_BRANCH = "main";
export const DEFAULT_CONFIDENCE_THRESHOLD = 80;

export type ParsedArgs = {
  model: string;
  baseBranch: string;
  confidenceThreshold: number;
  verbose: boolean;
  debug: boolean;
  format: OutputFormat;
  reviewMode: ReviewMode;
  localOnly: boolean;
  failOnIssues: boolean;
  setModel: boolean;
  saveDefaults: boolean;
  help: boolean;
  explicitModel: boolean;
  explicitBaseBranch: boolean;
  explicitConfidence: boolean;
};

const DEFAULTS: ParsedArgs = {
  model: DEFAULT_MODEL,
  baseBranch: DEFAULT_BASE_BRANCH,
  confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
  verbose: false,
  debug: false,
  format: "terminal",
  reviewMode: "shallow",
  localOnly: false,
  failOnIssues: false,
  setModel: false,
  saveDefaults: false,
  help: false,
  explicitModel: false,
  explicitBaseBranch: false,
  explicitConfidence: false,
};

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { ...DEFAULTS };

  const takeValue = (i: number, name: string): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`Missing value for ${name}`);
      return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;

    switch (a) {
      case "-m":
      case "--model": {
        out.model = takeValue(i, a);
        out.explicitModel = true;
        i++;
        break;
      }
      case "-b":
      case "--base": {
        out.baseBranch = takeValue(i, a);
        out.explicitBaseBranch = true;
        i++;
        break;
      }
      case "-c":
      case "--confidence": {
        const v = takeValue(i, a);
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error(`Invalid --confidence: ${v}`);
        out.confidenceThreshold = Math.trunc(n);
        out.explicitConfidence = true;
        i++;
        break;
      }
      case "-v":
      case "--verbose": {
        out.verbose = true;
        break;
      }
      case "--debug": {
        out.debug = true;
        break;
      }
      case "--format": {
        const v = takeValue(i, a);
        if (v !== "terminal" && v !== "json" && v !== "markdown") {
          throw new Error(`Invalid --format: ${v} (expected terminal|json|markdown)`);
        }
        out.format = v;
        i++;
        break;
      }
      case "--deep": {
        out.reviewMode = "deep";
        break;
      }
      case "-l":
      case "--local-only": {
        out.localOnly = true;
        break;
      }
      case "--fail-on-issues": {
        out.failOnIssues = true;
        break;
      }
      case "--set-model": {
        out.setModel = true;
        break;
      }
      case "--save-defaults": {
        out.saveDefaults = true;
        break;
      }
      case "-h":
      case "--help": {
        out.help = true;
        break;
      }
      default:
        throw new Error(`Unknown option: ${a}`);
    }
  }
  return out;
}
