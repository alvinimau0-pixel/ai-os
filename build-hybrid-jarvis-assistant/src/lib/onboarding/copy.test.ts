import { describe, expect, it } from "vitest";

import { ONBOARDING_COPY, type OnboardingStepKey } from "./copy";
import { ONBOARDING_STEPS } from "./types";

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) collectStrings(nested, out);
  }
  return out;
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

describe("onboarding copy", () => {
  it("defines every step in ONBOARDING_STEPS order", () => {
    expect(Object.keys(ONBOARDING_COPY.steps)).toEqual([...ONBOARDING_STEPS]);
  });

  it("keeps every string non-empty, trimmed, and under 200 characters", () => {
    const strings = collectStrings(ONBOARDING_COPY);

    expect(strings.length).toBeGreaterThan(0);
    for (const text of strings) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).toBe(text.trim());
      expect(text.length).toBeLessThan(200);
    }
  });

  it("uses short button labels and 2-5 word titles", () => {
    for (const key of Object.keys(ONBOARDING_COPY.steps) as OnboardingStepKey[]) {
      const step = ONBOARDING_COPY.steps[key];

      expect(wordCount(step.actionLabel)).toBeLessThanOrEqual(3);
      expect(wordCount(step.doneLabel)).toBeLessThanOrEqual(3);
      expect(wordCount(step.title)).toBeGreaterThanOrEqual(2);
      expect(wordCount(step.title)).toBeLessThanOrEqual(5);
    }
  });

  it("formats the progress label", () => {
    expect(ONBOARDING_COPY.progressLabel(2, 4)).toBe("2 of 4 complete");
    expect(ONBOARDING_COPY.progressLabel(0, 4)).toBe("0 of 4 complete");
    expect(ONBOARDING_COPY.progressLabel(4, 4)).toBe("4 of 4 complete");
  });

  it("avoids exclamation marks and TODO markers", () => {
    for (const step of Object.values(ONBOARDING_COPY.steps)) {
      expect(step.description).not.toContain("!");
    }

    for (const text of collectStrings(ONBOARDING_COPY)) {
      expect(text).not.toContain("TODO");
    }
  });
});
