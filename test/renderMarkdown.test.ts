import { expect, test } from "vitest";

import { renderMarkdown } from "../src/renderMarkdown";
import type { AggregatedReview } from "../src/types";

test("renderMarkdown: returns empty string when there are no issues (default policy)", () => {
  const data: AggregatedReview = {
    issues: [],
    stats: {
      total_candidates: 0,
      filtered_count: 0,
      confidence_threshold: 80,
      duplicates_removed: 0,
      by_type: { correctness: 0, design: 0, security: 0, reliability: 0, readability: 0, tests: 0 },
      by_severity: { high: 0, medium: 0, low: 0 },
    },
  };

  expect(renderMarkdown(data)).toBe("");
});

test("renderMarkdown: renders issues with impact/recommendation/evidence", () => {
  const data: AggregatedReview = {
    issues: [
      {
        type: "SECURITY",
        severity: "HIGH",
        title: "SQL injection risk",
        file: "src/a.ts",
        line: 12,
        confidence: 92,
        impact: "Attacker can read data",
        recommendation: "Use parameterized queries",
        evidence: "User input concatenated into SQL string",
      },
    ],
    stats: {
      total_candidates: 1,
      filtered_count: 1,
      confidence_threshold: 80,
      duplicates_removed: 0,
      by_type: { correctness: 0, design: 0, security: 1, reliability: 0, readability: 0, tests: 0 },
      by_severity: { high: 1, medium: 0, low: 0 },
    },
  };

  const md = renderMarkdown(data);
  expect(md).toMatch(/### AI code review/);
  expect(md).toMatch(/Found \*\*1\*\* issue/);
  expect(md).toMatch(/\*\*\[SECURITY\]\[HIGH\] SQL injection risk\*\*/);
  expect(md).toMatch(/`src\/a\.ts:12`/);
  expect(md).toMatch(/Impact: Attacker can read data/);
  expect(md).toMatch(/Recommendation: Use parameterized queries/);
  expect(md).toMatch(/Evidence: User input concatenated/);
});

test("renderMarkdown: can render a short 'no issues' comment when enabled", () => {
  const data: AggregatedReview = {
    issues: [],
    stats: {
      total_candidates: 2,
      filtered_count: 0,
      confidence_threshold: 80,
      duplicates_removed: 0,
      by_type: { correctness: 0, design: 0, security: 0, reliability: 0, readability: 0, tests: 0 },
      by_severity: { high: 0, medium: 0, low: 0 },
    },
  };

  const md = renderMarkdown(data, { renderEmpty: true });
  expect(md).toMatch(/No issues found/);
  expect(md).toMatch(/threshold: 80%/);
});

