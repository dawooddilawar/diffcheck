import { expect, test } from "vitest";

import { extractIssues } from "../src/extractIssues";

test("extractIssues: extracts from ```json fenced block", () => {
  const raw = [
    "Some preface text",
    "```json",
    '{ "issues": [ { "type": "LOGIC", "confidence": 85, "line": 12 } ] }',
    "```",
    "Some trailing text",
  ].join("\n");

  const result = extractIssues(raw);
  expect(result.issues.length).toBe(1);
  expect(result.issues[0]?.type).toBe("LOGIC");
  expect(result.issues[0]?.confidence).toBe(85);
  expect(result.issues[0]?.line).toBe(12);
});

test("extractIssues: extracts embedded JSON object without fences", () => {
  const raw = [
    "LLM says:",
    '{ "foo": 1 }',
    "then later:",
    '{ "issues": [ { "type": "SECURITY", "confidence": "90", "line": "7" } ] }',
    "done",
  ].join("\n");

  const result = extractIssues(raw);
  expect(result.issues.length).toBe(1);
  expect(result.issues[0]?.type).toBe("SECURITY");
  expect(result.issues[0]?.confidence).toBe(90);
  expect(result.issues[0]?.line).toBe(7);
});

test("extractIssues: returns empty when no issues payload exists", () => {
  const raw = "no json here";
  const result = extractIssues(raw);
  expect(result).toEqual({ issues: [] });
});

