// Minimal typings for the Web Speech API's recognition half (not in lib.dom).

export interface STTAlternative {
  transcript: string;
  confidence: number;
}

export interface STTResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: STTAlternative;
}

export interface STTResultList {
  readonly length: number;
  [index: number]: STTResult;
}

export interface STTResultEvent {
  resultIndex: number;
  results: STTResultList;
}

export interface STTErrorEvent {
  error: string;
  message?: string;
}

export interface STTRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: STTErrorEvent) => void) | null;
  onresult: ((e: STTResultEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type STTConstructor = new () => STTRecognition;

export function getRecognitionCtor(): STTConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: STTConstructor; webkitSpeechRecognition?: STTConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
