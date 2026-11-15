// Framework-free voice controller: push-to-talk, hands-free wake-word listening,
// microphone level metering and streaming speech output. React talks to it through
// the small event interface below (see hooks/useVoice.ts).

import { chime } from "./audio";
import { Speaker } from "./speaker";
import { getRecognitionCtor, type STTErrorEvent, type STTRecognition, type STTResultEvent } from "./stt";

export interface VoiceState {
  listening: boolean;
  handsFree: boolean;
  attentive: boolean;
  interim: string;
  speaking: boolean;
}

export interface VoiceEngineEvents {
  onState: (patch: Partial<VoiceState>) => void;
  onTranscript: (text: string) => void;
  onNotice: (message: string) => void;
  onVoices: (voices: SpeechSynthesisVoice[]) => void;
}

type Mode = "off" | "ptt" | "wake";

const ATTENTIVE_MS = 8000;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class VoiceEngine {
  readonly speaker = new Speaker();

  private wakeWord = "jarvis";
  private mode: Mode = "off";
  private rec: STTRecognition | null = null;
  private paused = false;
  private listening = false;
  private speakingNow = false;
  private attentiveUntil = 0;
  private attentiveTimer: number | null = null;
  private restartTimer: number | null = null;
  private pttGrace: number | null = null;
  private meter: { stream: MediaStream; ctx: AudioContext; id: number } | null = null;
  private meterStarting = false;
  private micLevel = 0;
  private speechPulse = 0;
  private voicesHandler: (() => void) | null = null;

  constructor(private ev: VoiceEngineEvents) {
    this.speaker.onBoundary = () => {
      this.speechPulse = 1;
    };
    this.speaker.onSpeakingChange = (s) => {
      this.speakingNow = s;
      this.ev.onState({ speaking: s });
      if (s) this.pauseRecognition();
      else this.resumeRecognition();
    };
    if (Speaker.supported()) {
      const load = () => {
        const v = window.speechSynthesis.getVoices();
        this.speaker.voices = v;
        this.ev.onVoices(v);
      };
      this.voicesHandler = load;
      load();
      window.speechSynthesis.addEventListener("voiceschanged", load);
    }
  }

  configure(cfg: { wakeWord: string; voiceName: string; rate: number; pitch: number }): void {
    this.wakeWord = cfg.wakeWord.trim().toLowerCase() || "jarvis";
    this.speaker.config = { voiceName: cfg.voiceName, rate: cfg.rate, pitch: cfg.pitch };
  }

  /** 0..1 level used to drive the orb. Cheap enough to call every animation frame. */
  getLevel(): number {
    const now = Date.now();
    if (this.speakingNow) {
      this.speechPulse *= 0.92;
      return Math.min(1, 0.28 + 0.3 * Math.abs(Math.sin(now / 130)) + this.speechPulse * 0.4);
    }
    if (this.listening) {
      return this.meter ? this.micLevel : 0.12 + 0.16 * Math.abs(Math.sin(now / 170));
    }
    return 0;
  }

  // ---------------------------------------------------------------- listening

  startPushToTalk(): void {
    if (!getRecognitionCtor()) {
      this.ev.onNotice("Speech recognition isn't supported in this browser. Try Chrome, Edge or Safari.");
      return;
    }
    if (this.mode === "wake") {
      this.speaker.cancel();
      this.enterAttentive();
      return;
    }
    if (this.mode === "ptt") {
      try {
        this.rec?.stop();
      } catch {
        /* ignore */
      }
      return;
    }
    this.speaker.cancel();
    this.mode = "ptt";
    chime("wake");
    if (!this.startRecognition(false)) this.mode = "off";
  }

  setHandsFree(on: boolean): void {
    if (on) {
      if (!getRecognitionCtor()) {
        this.ev.onNotice("Hands-free mode needs speech recognition, which this browser doesn't support. Try Chrome, Edge or Safari.");
        return;
      }
      this.mode = "wake";
      this.paused = this.speakingNow;
      this.ev.onState({ handsFree: true });
      if (!this.paused && !this.startRecognition(true)) {
        this.mode = "off";
        this.ev.onState({ handsFree: false });
      }
    } else {
      this.mode = "off";
      this.killRecognition();
      this.stopMeter();
      this.ev.onState({ handsFree: false, listening: false, attentive: false, interim: "" });
    }
  }

  stopAll(): void {
    this.setHandsFree(false);
    this.speaker.cancel();
  }

  dispose(): void {
    this.mode = "off";
    this.killRecognition();
    this.stopMeter();
    this.speaker.onSpeakingChange = null;
    this.speaker.cancel();
    if (this.voicesHandler && Speaker.supported()) window.speechSynthesis.removeEventListener("voiceschanged", this.voicesHandler);
    if (this.attentiveTimer) window.clearTimeout(this.attentiveTimer);
  }

  // ------------------------------------------------------------- recognition

  private startRecognition(continuous: boolean): boolean {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return false;
    this.killRecognition();
    const rec = new Ctor();
    rec.lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
    rec.continuous = continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => {
      this.listening = true;
      this.ev.onState({ listening: true });
      void this.startMeter();
    };
    rec.onresult = (e) => this.handleResult(e);
    rec.onerror = (e) => this.handleError(e);
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      this.listening = false;
      this.ev.onState({ listening: false, interim: "" });
      if (this.mode === "wake" && !this.paused) {
        this.restartTimer = window.setTimeout(() => {
          if (this.mode === "wake" && !this.paused && !this.rec) this.startRecognition(true);
        }, 300);
      } else if (this.mode === "ptt") {
        // Safari/WebKit can fire onend before the final onresult; hold a short
        // grace window so the dictated text isn't dropped.
        this.pttGrace = window.setTimeout(() => {
          this.pttGrace = null;
          if (this.mode === "ptt") {
            this.mode = "off";
            this.stopMeter();
          }
        }, 750);
      }
    };
    this.rec = rec;
    try {
      rec.start();
      return true;
    } catch {
      this.rec = null;
      return false;
    }
  }

  private killRecognition(): void {
    if (this.restartTimer) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.pttGrace) {
      window.clearTimeout(this.pttGrace);
      this.pttGrace = null;
    }
    const r = this.rec;
    this.rec = null;
    if (r) {
      r.onstart = null;
      r.onend = null;
      r.onerror = null;
      r.onresult = null;
      try {
        r.abort();
      } catch {
        /* ignore */
      }
    }
    if (this.listening) {
      this.listening = false;
      this.ev.onState({ listening: false });
    }
  }

  private pauseRecognition(): void {
    if (this.mode !== "wake") return;
    this.paused = true;
    this.killRecognition();
  }

  private resumeRecognition(): void {
    if (this.mode === "wake" && this.paused) {
      this.paused = false;
      this.restartTimer = window.setTimeout(() => {
        if (this.mode === "wake" && !this.paused && !this.rec) this.startRecognition(true);
      }, 450);
    }
  }

  private handleResult(e: STTResultEvent): void {
    let finalText = "";
    let interimText = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interimText += r[0].transcript;
    }

    if (this.mode === "ptt") {
      if (this.pttGrace) {
        window.clearTimeout(this.pttGrace);
        this.pttGrace = null;
      }
      this.ev.onState({ interim: (finalText || interimText).trim() });
      const text = finalText.trim();
      if (text) {
        this.mode = "off";
        const r = this.rec;
        this.rec = null;
        if (r) {
          r.onresult = null;
          r.onend = null;
          r.onerror = null;
          r.onstart = null;
          try {
            r.stop();
          } catch {
            /* ignore */
          }
        }
        this.listening = false;
        this.stopMeter();
        this.ev.onState({ listening: false, interim: "" });
        this.ev.onTranscript(text);
      }
      return;
    }

    if (this.mode === "wake") {
      const heard = (interimText || finalText).trim();
      if (heard && (this.isAttentive() || this.containsWake(heard))) {
        this.ev.onState({ attentive: true, interim: heard });
      }
      if (finalText.trim()) this.processWake(finalText.trim());
    }
  }

  private handleError(e: STTErrorEvent): void {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      this.failVoice("Microphone access is blocked. Allow it in your browser's site settings to use voice.");
    } else if (e.error === "audio-capture") {
      this.failVoice("No microphone was found on this device.");
    } else if (e.error === "network") {
      this.failVoice("Speech recognition needs a network connection — the browser's speech service is unreachable.");
    }
    // "no-speech" / "aborted": harmless; onend handles restarts.
  }

  private failVoice(message: string): void {
    this.mode = "off";
    this.killRecognition();
    this.stopMeter();
    this.ev.onState({ handsFree: false, listening: false, attentive: false, interim: "" });
    this.ev.onNotice(message);
  }

  // --------------------------------------------------------------- wake word

  private containsWake(text: string): boolean {
    return new RegExp(`\\b${escapeRe(this.wakeWord)}\\b`, "i").test(text);
  }

  private isAttentive(): boolean {
    return Date.now() < this.attentiveUntil;
  }

  private enterAttentive(): void {
    this.attentiveUntil = Date.now() + ATTENTIVE_MS;
    this.ev.onState({ attentive: true });
    chime("wake");
    if (this.attentiveTimer) window.clearTimeout(this.attentiveTimer);
    this.attentiveTimer = window.setTimeout(() => {
      if (!this.isAttentive()) this.ev.onState({ attentive: false, interim: "" });
    }, ATTENTIVE_MS + 150);
  }

  private dispatchWake(command: string): void {
    this.attentiveUntil = 0;
    this.ev.onState({ attentive: false, interim: "" });
    this.ev.onTranscript(command);
  }

  private processWake(text: string): void {
    const m = new RegExp(`\\b${escapeRe(this.wakeWord)}\\b[\\s,.:!?-]*([\\s\\S]*)$`, "i").exec(text);
    if (m) {
      let before = text.slice(0, m.index).trim();
      if (/^(?:hey|hi|hello|ok|okay|yo)$/i.test(before)) before = "";
      const command = `${before} ${m[1]}`.trim();
      if (command) this.dispatchWake(command);
      else this.enterAttentive();
      return;
    }
    if (this.isAttentive()) {
      this.dispatchWake(text);
      return;
    }
    this.ev.onState({ attentive: false, interim: "" });
  }

  // ------------------------------------------------------------------- meter

  private async startMeter(): Promise<void> {
    if (this.meter || this.meterStarting) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    this.meterStarting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      try {
        if (this.mode === "off") {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const ctx = new AC();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const id = window.setInterval(() => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          this.micLevel = Math.min(1, Math.sqrt(sum / data.length) * 4.5);
        }, 40);
        this.meter = { stream, ctx, id };
      } catch {
        stream.getTracks().forEach((t) => t.stop()); // never leak the mic capture
        /* metering is cosmetic — recognition still works without it */
      }
    } catch {
      /* metering is cosmetic — recognition still works without it */
    } finally {
      this.meterStarting = false;
    }
  }

  private stopMeter(): void {
    const m = this.meter;
    this.meter = null;
    this.micLevel = 0;
    if (!m) return;
    window.clearInterval(m.id);
    m.stream.getTracks().forEach((t) => t.stop());
    void m.ctx.close().catch(() => undefined);
  }
}
