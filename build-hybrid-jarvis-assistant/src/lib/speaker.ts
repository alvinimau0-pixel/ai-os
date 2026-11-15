// Streaming text-to-speech: feed it text deltas and it speaks sentence by sentence,
// so Jarvis starts talking before a long cloud answer has finished generating.

export function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/^[\s>*•–—#-]+(?=\S)/gm, "")
    .replace(/[*_~#]+/g, "")
    .replace(/(\d)\s*°\s*C\b/g, "$1 degrees Celsius")
    .replace(/(\d)\s*°\s*F\b/g, "$1 degrees Fahrenheit")
    .replace(/°/g, " degrees")
    .replace(/km\/h/gi, "kilometers per hour")
    .replace(/\bmph\b/gi, "miles per hour")
    .replace(/%/g, " percent")
    .replace(/[❗⏱⏰✓✔→…]/g, " ")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/([.!?])\s*\./g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function pickVoice(voices: SpeechSynthesisVoice[], preferred: string): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  if (preferred) {
    const exact = voices.find((v) => v.name === preferred);
    if (exact) return exact;
  }
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = english.length ? english : voices;
  const favourites = [/daniel/i, /google uk english male/i, /microsoft (?:george|ryan|thomas)/i, /arthur/i, /oliver/i, /\bmale\b/i];
  for (const re of favourites) {
    const v = pool.find((x) => re.test(x.name));
    if (v) return v;
  }
  return pool.find((v) => v.lang.toLowerCase().replace("_", "-") === "en-gb") ?? pool[0];
}

export interface SpeakerConfig {
  voiceName: string;
  rate: number;
  pitch: number;
}

export class Speaker {
  config: SpeakerConfig = { voiceName: "", rate: 1, pitch: 0.9 };
  voices: SpeechSynthesisVoice[] = [];
  onSpeakingChange: ((speaking: boolean) => void) | null = null;
  onBoundary: (() => void) | null = null;

  private queue: string[] = [];
  private buffer = "";
  private active = false;
  private open = false;
  private started = false;
  private gen = 0;
  private lastSpeaking = false;

  static supported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  }

  /** Call when a streamed reply starts so "speaking" doesn't flicker between sentences. */
  begin(): void {
    this.open = true;
  }

  feed(delta: string): void {
    if (!Speaker.supported()) return;
    this.buffer += delta;
    this.drain(false);
  }

  /** Call when the stream is complete: flushes whatever is left in the buffer. */
  end(): void {
    this.open = false;
    this.drain(true);
    this.pump();
    this.emit();
  }

  say(text: string): void {
    this.begin();
    this.feed(text);
    this.end();
  }

  cancel(): void {
    this.gen++;
    this.queue = [];
    this.buffer = "";
    this.active = false;
    this.open = false;
    this.started = false;
    if (Speaker.supported()) window.speechSynthesis.cancel();
    this.emit();
  }

  private drain(final: boolean): void {
    for (;;) {
      const m = /[.!?]["')\]]*\s|\n/.exec(this.buffer);
      if (m) {
        const end = m.index + m[0].length;
        const sentence = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end);
        this.enqueue(sentence);
        continue;
      }
      if (this.buffer.length > 240) {
        const cut = this.buffer.lastIndexOf(" ", 200);
        const at = cut > 40 ? cut : 200;
        this.enqueue(this.buffer.slice(0, at));
        this.buffer = this.buffer.slice(at);
        continue;
      }
      break;
    }
    if (final) {
      if (this.buffer.trim()) this.enqueue(this.buffer);
      this.buffer = "";
    }
  }

  private enqueue(raw: string): void {
    const clean = stripForSpeech(raw);
    if (!clean || !/[a-z0-9]/i.test(clean)) return;
    this.queue.push(clean);
    this.started = true;
    this.pump();
  }

  private pump(): void {
    if (this.active || !Speaker.supported()) return;
    const next = this.queue.shift();
    if (!next) {
      if (!this.open) this.started = false;
      this.emit();
      return;
    }
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(next);
    const voice = pickVoice(this.voices.length ? this.voices : synth.getVoices(), this.config.voiceName);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = this.config.rate;
    u.pitch = this.config.pitch;
    u.volume = 1;
    const gen = this.gen;
    this.active = true;
    u.onboundary = () => this.onBoundary?.();
    const done = () => {
      if (gen !== this.gen) return;
      this.active = false;
      this.pump();
    };
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
    this.emit();
  }

  private isSpeaking(): boolean {
    return this.active || this.queue.length > 0 || (this.open && this.started);
  }

  private emit(): void {
    const s = this.isSpeaking();
    if (s !== this.lastSpeaking) {
      this.lastSpeaking = s;
      this.onSpeakingChange?.(s);
    }
  }
}
