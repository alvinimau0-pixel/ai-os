import { describe, expect, it } from "vitest";

import {
  EMPTY_ONBOARDING_STATE,
  ONBOARDING_STEPS,
  completeOnboardingStep,
  detectCompletedSteps,
  dismissOnboarding,
  isOnboardingComplete,
  normalizeOnboardingState,
  onboardingProgress,
  resumeOnboarding,
  type OnboardingState,
} from "./types";

const DISMISSED_AT = "2026-11-15T12:34:56.789Z";
const COMPLETED_AT = "2026-11-16T08:00:00.000Z";
const FIRST_STEP = "brain";
const LAST_STEP = "first-chat" as const;

const ALL_STEPS = [...ONBOARDING_STEPS];

function state(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return { ...EMPTY_ONBOARDING_STATE, ...overrides };
}

type DetectInput = Parameters<typeof detectCompletedSteps>[0];

function settings(overrides: Partial<DetectInput> = {}): DetectInput {
  return {
    cloudAvailable: false,
    assistantName: "",
    userName: "",
    voiceName: "",
    autoSpeak: true,
    hasConversation: false,
    ...overrides,
  };
}

describe("normalizeOnboardingState", () => {
  it("returns an empty state for null, undefined, and primitives", () => {
    const expected = { completedSteps: [], dismissedAt: null, completedAt: null };

    expect(normalizeOnboardingState(null)).toEqual(expected);
    expect(normalizeOnboardingState(undefined)).toEqual(expected);
    expect(normalizeOnboardingState(42)).toEqual(expected);
    expect(normalizeOnboardingState("brain")).toEqual(expected);
    expect(normalizeOnboardingState(true)).toEqual(expected);
  });

  it("drops unknown step ids and non-string entries", () => {
    const normalized = normalizeOnboardingState({
      completedSteps: [FIRST_STEP, "not-a-step", "voice", 7, null],
    });

    expect(normalized.completedSteps).toEqual(["brain", "voice"]);
  });

  it("removes duplicates while preserving first occurrence order", () => {
    const normalized = normalizeOnboardingState({
      completedSteps: ["voice", "brain", "voice", "first-chat", "brain"],
    });

    expect(normalized.completedSteps).toEqual(["voice", "brain", "first-chat"]);
  });

  it("keeps valid ISO timestamps", () => {
    const normalized = normalizeOnboardingState({
      completedSteps: [],
      dismissedAt: DISMISSED_AT,
      completedAt: COMPLETED_AT,
    });

    expect(normalized.dismissedAt).toBe(DISMISSED_AT);
    expect(normalized.completedAt).toBe(COMPLETED_AT);
  });

  it("turns invalid or partial dates into null", () => {
    const normalized = normalizeOnboardingState({
      completedSteps: [],
      dismissedAt: "2026-11-15",
      completedAt: "not-a-date",
    });
    const other = normalizeOnboardingState({
      completedSteps: [],
      dismissedAt: "",
      completedAt: 12345,
    });

    expect(normalized).toEqual({ completedSteps: [], dismissedAt: null, completedAt: null });
    expect(other).toEqual({ completedSteps: [], dismissedAt: null, completedAt: null });
  });
});

describe("completeOnboardingStep", () => {
  it("appends the step and leaves completedAt null until the final step", () => {
    const result = completeOnboardingStep(
      state(),
      FIRST_STEP,
      new Date(DISMISSED_AT),
    );

    expect(result.completedSteps).toEqual([FIRST_STEP]);
    expect(result.completedAt).toBeNull();
  });

  it("is idempotent per step", () => {
    const once = completeOnboardingStep(state(), FIRST_STEP, new Date(DISMISSED_AT));
    const twice = completeOnboardingStep(once, FIRST_STEP, new Date(COMPLETED_AT));

    expect(twice.completedSteps).toEqual([FIRST_STEP]);
    expect(twice).toEqual(once);
  });

  it("never mutates the input state", () => {
    const input = state({ completedSteps: ["brain"], completedAt: COMPLETED_AT });
    const snapshot = { ...input, completedSteps: [...input.completedSteps] };

    const result = completeOnboardingStep(input, "voice", new Date(DISMISSED_AT));

    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
    expect(result.completedSteps).not.toBe(input.completedSteps);
  });

  it("sets completedAt when the fourth step completes", () => {
    const threeSteps = state({ completedSteps: ["brain", "identity", "voice"] });

    const result = completeOnboardingStep(
      threeSteps,
      LAST_STEP,
      new Date(COMPLETED_AT),
    );

    expect(result.completedSteps).toEqual(ALL_STEPS);
    expect(result.completedAt).toBe(COMPLETED_AT);
    expect(threeSteps.completedAt).toBeNull();
  });

  it("does not overwrite an existing completedAt", () => {
    const finished = state({
      completedSteps: ALL_STEPS,
      completedAt: COMPLETED_AT,
    });

    const result = completeOnboardingStep(
      finished,
      FIRST_STEP,
      new Date(DISMISSED_AT),
    );

    expect(result.completedAt).toBe(COMPLETED_AT);
  });
});

describe("dismissOnboarding / resumeOnboarding", () => {
  it("dismiss sets dismissedAt without clearing completedAt", () => {
    const input = state({ completedAt: COMPLETED_AT });

    const dismissed = dismissOnboarding(input, new Date(DISMISSED_AT));

    expect(dismissed.dismissedAt).toBe(DISMISSED_AT);
    expect(dismissed.completedAt).toBe(COMPLETED_AT);
    expect(input.dismissedAt).toBeNull();
  });

  it("resume clears dismissedAt without clearing completedAt", () => {
    const dismissed = state({
      dismissedAt: DISMISSED_AT,
      completedAt: COMPLETED_AT,
    });

    const resumed = resumeOnboarding(dismissed);

    expect(resumed.dismissedAt).toBeNull();
    expect(resumed.completedAt).toBe(COMPLETED_AT);
  });
});

describe("onboardingProgress", () => {
  it("reports 0% for an empty state", () => {
    expect(onboardingProgress(state())).toEqual({ done: 0, total: 4, percent: 0 });
  });

  it("reports 50% for two completed steps", () => {
    const input = state({ completedSteps: ["brain", "voice"] });

    expect(onboardingProgress(input)).toEqual({ done: 2, total: 4, percent: 50 });
  });

  it("reports 100% when every step is complete", () => {
    const input = state({ completedSteps: ALL_STEPS });

    expect(onboardingProgress(input)).toEqual({ done: 4, total: 4, percent: 100 });
  });

  it("does not let duplicate steps inflate the count", () => {
    const input = state({
      completedSteps: ["brain", "brain", "identity", "identity", "brain"],
    });

    expect(onboardingProgress(input)).toEqual({ done: 2, total: 4, percent: 50 });
  });
});

describe("isOnboardingComplete", () => {
  it("is false with three steps", () => {
    const input = state({ completedSteps: ["brain", "identity", "voice"] });

    expect(isOnboardingComplete(input)).toBe(false);
  });

  it("is true with all four steps", () => {
    const input = state({ completedSteps: ALL_STEPS });

    expect(isOnboardingComplete(input)).toBe(true);
  });
});

describe("detectCompletedSteps", () => {
  it("detects brain from cloud availability", () => {
    expect(detectCompletedSteps(settings({ cloudAvailable: true }))).toEqual(["brain"]);
    expect(detectCompletedSteps(settings())).toEqual([]);
  });

  it("detects identity from a non-blank assistant or user name", () => {
    expect(detectCompletedSteps(settings({ assistantName: "JARVIS" }))).toEqual(["identity"]);
    expect(detectCompletedSteps(settings({ userName: "Ada" }))).toEqual(["identity"]);
    expect(detectCompletedSteps(settings({ assistantName: "   ", userName: "\t" }))).toEqual([]);
  });

  it("detects voice from a selected voice or spoken replies being disabled", () => {
    expect(detectCompletedSteps(settings({ voiceName: "Aria" }))).toEqual(["voice"]);
    expect(detectCompletedSteps(settings({ autoSpeak: false }))).toEqual(["voice"]);
    expect(detectCompletedSteps(settings({ voiceName: "  ", autoSpeak: true }))).toEqual([]);
  });

  it("detects first-chat from conversation history", () => {
    expect(detectCompletedSteps(settings({ hasConversation: true }))).toEqual(["first-chat"]);
  });

  it("returns steps in ONBOARDING_STEPS order", () => {
    expect(
      detectCompletedSteps(
        settings({ cloudAvailable: true, voiceName: "Aria", hasConversation: true }),
      ),
    ).toEqual(["brain", "voice", "first-chat"]);

    expect(
      detectCompletedSteps(
        settings({
          cloudAvailable: true,
          assistantName: "JARVIS",
          userName: "Ada",
          voiceName: "Aria",
          autoSpeak: true,
          hasConversation: true,
        }),
      ),
    ).toEqual([...ONBOARDING_STEPS]);
  });

  it("returns [] for empty settings", () => {
    expect(detectCompletedSteps(settings())).toEqual([]);
  });
});
