export type OnboardingStepKey = "brain" | "identity" | "voice" | "first-chat";

export interface OnboardingStepCopy {
  /** Row heading, 2-5 words. */
  title: string;
  /** One or two sentences, max ~140 characters. */
  description: string;
  /** Button label shown while the step is incomplete, max 3 words. */
  actionLabel: string;
  /** Short status label shown once complete, max 3 words. */
  doneLabel: string;
}

export interface OnboardingCopy {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** e.g. (2, 4) => "2 of 4 complete" */
  progressLabel: (done: number, total: number) => string;
  steps: Record<OnboardingStepKey, OnboardingStepCopy>;
  dismissLabel: string;
  resumeLabel: string;
  completedTitle: string;
  completedBody: string;
  footerHint: string;
}

export const ONBOARDING_COPY: OnboardingCopy = {
  eyebrow: "First run",
  title: "Welcome to JARVIS",
  subtitle: "It takes a few small steps to settle in.",
  progressLabel: (done, total) => `${done} of ${total} complete`,
  steps: {
    brain: {
      title: "Link your brain",
      description: "Connect the local engine or add a cloud API key so JARVIS has somewhere to think.",
      actionLabel: "Link brain",
      doneLabel: "Brain linked",
    },
    identity: {
      title: "Name your assistant",
      description: "Choose the name JARVIS answers to and decide how it should address you.",
      actionLabel: "Set identity",
      doneLabel: "Identity set",
    },
    voice: {
      title: "Set your voice",
      description: "Pick a voice and speed, then choose whether replies are spoken aloud.",
      actionLabel: "Set voice",
      doneLabel: "Voice ready",
    },
    "first-chat": {
      title: "Send your first message",
      description: "Ask for a briefing, add a task, or simply say hello to start your first conversation.",
      actionLabel: "Say hello",
      doneLabel: "Chat started",
    },
  },
  dismissLabel: "Maybe later",
  resumeLabel: "Resume setup",
  completedTitle: "You're all set",
  completedBody:
    "JARVIS can handle briefings, tasks, notes, and more. Reopen this checklist any time from Configuration.",
  footerHint: "Progress is saved locally in your own database.",
};
