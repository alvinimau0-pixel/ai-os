"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SettingsDTO } from "@/lib/types";
import { Speaker } from "@/lib/speaker";
import { getRecognitionCtor } from "@/lib/stt";
import { VoiceEngine, type VoiceState } from "@/lib/voice-engine";

interface Options {
  settings: SettingsDTO;
  onTranscript: (text: string) => void;
  onNotice: (message: string) => void;
}

const INITIAL: VoiceState = { listening: false, handsFree: false, attentive: false, interim: "", speaking: false };

export function useVoice({ settings, onTranscript, onNotice }: Options) {
  const [state, setState] = useState<VoiceState>(INITIAL);
  const [caps, setCaps] = useState({ stt: false, tts: false });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const engineRef = useRef<VoiceEngine | null>(null);
  const callbacks = useRef({ onTranscript, onNotice });

  useEffect(() => {
    callbacks.current = { onTranscript, onNotice };
  });

  useEffect(() => {
    const engine = new VoiceEngine({
      onState: (patch) => setState((s) => ({ ...s, ...patch })),
      onTranscript: (t) => callbacks.current.onTranscript(t),
      onNotice: (m) => callbacks.current.onNotice(m),
      onVoices: (v) => setVoices(v),
    });
    engineRef.current = engine;
    const capsTimer = window.setTimeout(() => setCaps({ stt: !!getRecognitionCtor(), tts: Speaker.supported() }), 0);
    return () => {
      window.clearTimeout(capsTimer);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.configure({
      wakeWord: settings.wakeWord,
      voiceName: settings.voiceName,
      rate: settings.voiceRate,
      pitch: settings.voicePitch,
    });
  }, [settings.wakeWord, settings.voiceName, settings.voiceRate, settings.voicePitch]);

  const getLevel = useCallback(() => engineRef.current?.getLevel() ?? 0, []);
  const pushToTalk = useCallback(() => engineRef.current?.startPushToTalk(), []);
  const setHandsFree = useCallback((on: boolean) => engineRef.current?.setHandsFree(on), []);
  const begin = useCallback(() => engineRef.current?.speaker.begin(), []);
  const feed = useCallback((t: string) => engineRef.current?.speaker.feed(t), []);
  const end = useCallback(() => engineRef.current?.speaker.end(), []);
  const say = useCallback((t: string) => engineRef.current?.speaker.say(t), []);
  const cancelSpeech = useCallback(() => engineRef.current?.speaker.cancel(), []);

  return {
    ...state,
    sttSupported: caps.stt,
    ttsSupported: caps.tts,
    voices,
    getLevel,
    pushToTalk,
    setHandsFree,
    speech: { begin, feed, end, say, cancel: cancelSpeech },
  };
}
