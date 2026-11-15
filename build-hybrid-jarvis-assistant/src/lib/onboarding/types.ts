// Onboarding setup state: which setup steps the user has completed, whether the
// checklist was dismissed, and when onboarding was fully completed.

export const ONBOARDING_STEPS = ["brain", "identity", "voice", "first-chat"] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingState {
  completedSteps: OnboardingStepId[];
  dismissedAt: string | null;
  completedAt: string | null;
}

export const EMPTY_ONBOARDING_STATE: OnboardingState = {
  completedSteps: [],
  dismissedAt: null,
  completedAt: null,
};

function isKnownStep(value: unknown): value is OnboardingStepId {
  return typeof value === "string" && (ONBOARDING_STEPS as readonly string[]).includes(value);
}

export function isOnboardingStepId(value: unknown): value is OnboardingStepId {
  return isKnownStep(value);
}

/** ISO 8601 date string check (e.g. "2026-11-15T12:34:56.789Z"). */
function isIsoDateString(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.toISOString() === value;
}

/** Never throws: accepts anything and returns a valid OnboardingState. */
export function normalizeOnboardingState(value: unknown): OnboardingState {
  const source = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;

  const completedSteps: OnboardingStepId[] = [];
  const rawSteps = source?.completedSteps;
  if (Array.isArray(rawSteps)) {
    for (const step of rawSteps) {
      if (isKnownStep(step) && !completedSteps.includes(step)) completedSteps.push(step);
    }
  }

  return {
    completedSteps,
    dismissedAt: source && isIsoDateString(source.dismissedAt) ? source.dismissedAt : null,
    completedAt: source && isIsoDateString(source.completedAt) ? source.completedAt : null,
  };
}

/** Returns a new state with the step completed; idempotent per step. */
export function completeOnboardingStep(state: OnboardingState, step: OnboardingStepId, at?: Date): OnboardingState {
  const completedSteps = state.completedSteps.includes(step) ? [...state.completedSteps] : [...state.completedSteps, step];
  const isLast = ONBOARDING_STEPS.every((s) => completedSteps.includes(s));
  return {
    ...state,
    completedSteps,
    completedAt: isLast && !state.completedAt ? (at ?? new Date()).toISOString() : state.completedAt,
  };
}

/** Returns a new state with the checklist dismissed (does not clear completedAt). */
export function dismissOnboarding(state: OnboardingState, at?: Date): OnboardingState {
  return { ...state, dismissedAt: (at ?? new Date()).toISOString() };
}

/** Returns a new state with the checklist resumed (dismissedAt cleared). */
export function resumeOnboarding(state: OnboardingState): OnboardingState {
  return { ...state, dismissedAt: null };
}

export function onboardingProgress(state: OnboardingState): { done: number; total: number; percent: number } {
  const total = ONBOARDING_STEPS.length;
  const done = state.completedSteps.filter((step, i) => isKnownStep(step) && state.completedSteps.indexOf(step) === i).length;
  const percent = Math.round((done / total) * 100);
  return { done, total, percent };
}

export function isOnboardingComplete(state: OnboardingState): boolean {
  return ONBOARDING_STEPS.every((step) => state.completedSteps.includes(step));
}

/** Pure: derive which steps are already satisfied from the current settings. */
export function detectCompletedSteps(input: {
  cloudAvailable: boolean;
  assistantName: string;
  userName: string;
  voiceName: string;
  autoSpeak: boolean;
  hasConversation: boolean;
}): OnboardingStepId[] {
  const done: OnboardingStepId[] = [];
  if (input.cloudAvailable) done.push("brain");
  if (input.assistantName.trim() || input.userName.trim()) done.push("identity");
  if (input.voiceName.trim() || !input.autoSpeak) done.push("voice");
  if (input.hasConversation) done.push("first-chat");
  return done;
}
