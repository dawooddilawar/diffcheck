import { expect, test } from "vitest";

import { DEFAULT_MODEL, parseArgs } from "../src/args";

test("parseArgs: defaults", () => {
  const args = parseArgs([]);
  expect(args.model).toBe(DEFAULT_MODEL);
  expect(args.baseBranch).toBe("main");
  expect(args.confidenceThreshold).toBe(80);
  expect(args.verbose).toBe(false);
  expect(args.format).toBe("terminal");
  expect(args.localOnly).toBe(false);
  expect(args.saveDefaults).toBe(false);
  expect(args.help).toBe(false);
  expect(args.explicitModel).toBe(false);
  expect(args.explicitBaseBranch).toBe(false);
  expect(args.explicitConfidence).toBe(false);
});

test("parseArgs: parses short flags", () => {
  const args = parseArgs(["-m", "ollama/qwen3:8b", "-b", "develop", "-c", "70", "-v"]);
  expect(args.model).toBe("ollama/qwen3:8b");
  expect(args.baseBranch).toBe("develop");
  expect(args.confidenceThreshold).toBe(70);
  expect(args.verbose).toBe(true);
  expect(args.explicitModel).toBe(true);
  expect(args.explicitBaseBranch).toBe(true);
  expect(args.explicitConfidence).toBe(true);
});

test("parseArgs: parses --format and --save-defaults", () => {
  const args = parseArgs(["--format", "markdown", "--save-defaults"]);
  expect(args.format).toBe("markdown");
  expect(args.saveDefaults).toBe(true);
});

test("parseArgs: rejects invalid format", () => {
  expect(() => parseArgs(["--format", "xml"])).toThrow(/Invalid --format/);
});

test("parseArgs: parses --local-only", () => {
  const args = parseArgs(["--local-only"]);
  expect(args.localOnly).toBe(true);
});

test("parseArgs: rejects unknown option", () => {
  expect(() => parseArgs(["--nope"])).toThrow(/Unknown option/);
});
