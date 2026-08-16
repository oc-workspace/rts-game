import type { AudioEvent } from "./audio-events";

export const AUDIO_SETTINGS_STORAGE_KEY = "rts-audio-settings";

export interface AudioSettings {
  masterVolume: number;
  effectsVolume: number;
  muted: boolean;
  reducedAudio: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  masterVolume: 0.72,
  effectsVolume: 0.82,
  muted: false,
  reducedAudio: false,
};

export interface AudioSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type WebAudioState = "locked" | "ready" | "unavailable";

export interface WebAudioAdapter {
  getSettings(): AudioSettings;
  getState(): WebAudioState;
  setSettings(patch: Partial<AudioSettings>): AudioSettings;
  unlock(): Promise<boolean>;
  handleEvent(event: AudioEvent): void;
  getLoadedSampleCount(): number;
  dispose(): void;
}

export interface WebAudioAdapterOptions {
  storage?: AudioSettingsStorage | null;
  contextFactory?: () => AudioContext;
  fetchFn?: typeof fetch;
  manifestUrl?: string;
  loadSamples?: boolean;
}

export interface AudioAssetManifest {
  schemaVersion: number;
  sampleRate: number;
  channels: number;
  assets: Record<string, {
    url: string;
    format: string;
    channels: number;
    sampleRate: number;
    duration: number;
    source: string;
    fallback: string;
  }>;
}

interface CueProfile {
  frequencies: number[];
  duration: number;
  gap: number;
  waveform: OscillatorType;
  gain: number;
  sweep?: number;
}

const CUE_PROFILES: Record<string, CueProfile> = {
  "encounter-start": { frequencies: [196, 262, 330], duration: 0.11, gap: 0.04, waveform: "sine", gain: 0.32 },
  "incoming-fire": { frequencies: [440, 330], duration: 0.12, gap: 0.03, waveform: "triangle", gain: 0.34 },
  victory: { frequencies: [262, 330, 392, 523], duration: 0.1, gap: 0.04, waveform: "sine", gain: 0.34 },
  defeat: { frequencies: [330, 247, 196], duration: 0.16, gap: 0.06, waveform: "triangle", gain: 0.32 },
  "weapon-fire": { frequencies: [120, 76], duration: 0.08, gap: 0.01, waveform: "sawtooth", gain: 0.2, sweep: -0.45 },
  "weapon-hit": { frequencies: [540], duration: 0.07, gap: 0, waveform: "square", gain: 0.18, sweep: -0.2 },
  "unit-destroyed": { frequencies: [96, 64], duration: 0.2, gap: 0.03, waveform: "sawtooth", gain: 0.28, sweep: -0.5 },
  "ui-select": { frequencies: [480], duration: 0.06, gap: 0, waveform: "sine", gain: 0.14 },
  "ui-target-lock": { frequencies: [620, 780], duration: 0.06, gap: 0.02, waveform: "sine", gain: 0.16 },
  "ui-move-order": { frequencies: [350, 440], duration: 0.05, gap: 0.02, waveform: "triangle", gain: 0.14 },
  "ui-queue-move": { frequencies: [300, 380], duration: 0.05, gap: 0.02, waveform: "triangle", gain: 0.12 },
  "ui-attack-order": { frequencies: [300, 220], duration: 0.07, gap: 0.02, waveform: "square", gain: 0.14 },
  "ui-queue-attack": { frequencies: [280, 200], duration: 0.07, gap: 0.02, waveform: "square", gain: 0.12 },
  "ui-stop-order": { frequencies: [180], duration: 0.08, gap: 0, waveform: "triangle", gain: 0.14 },
  "ui-pause": { frequencies: [220, 160], duration: 0.1, gap: 0.03, waveform: "sine", gain: 0.16 },
  "ui-resume": { frequencies: [330, 440], duration: 0.08, gap: 0.03, waveform: "sine", gain: 0.16 },
  "ui-toggle-effects": { frequencies: [520], duration: 0.06, gap: 0, waveform: "sine", gain: 0.12 },
  "ui-audio-enabled": { frequencies: [440, 660], duration: 0.07, gap: 0.03, waveform: "sine", gain: 0.16 },
  "ui-audio-setting": { frequencies: [420], duration: 0.04, gap: 0, waveform: "sine", gain: 0.08 },
  "ui-error": { frequencies: [140], duration: 0.12, gap: 0, waveform: "square", gain: 0.18 },
};

export function normalizeAudioSettings(
  value: Partial<AudioSettings> | null | undefined,
): AudioSettings {
  return {
    masterVolume: clampUnit(value?.masterVolume ?? DEFAULT_AUDIO_SETTINGS.masterVolume),
    effectsVolume: clampUnit(value?.effectsVolume ?? DEFAULT_AUDIO_SETTINGS.effectsVolume),
    muted: value?.muted ?? DEFAULT_AUDIO_SETTINGS.muted,
    reducedAudio: value?.reducedAudio ?? DEFAULT_AUDIO_SETTINGS.reducedAudio,
  };
}

export function loadAudioSettings(
  storage: AudioSettingsStorage | null | undefined,
): AudioSettings {
  if (!storage) {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
  try {
    const raw = storage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
    return raw ? normalizeAudioSettings(JSON.parse(raw) as Partial<AudioSettings>) : { ...DEFAULT_AUDIO_SETTINGS };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(
  settings: AudioSettings,
  storage: AudioSettingsStorage | null | undefined,
): void {
  try {
    storage?.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or a blocked storage backend must not block the game.
  }
}

export function getCueProfile(cue: string): CueProfile {
  return CUE_PROFILES[cue] ?? {
    frequencies: [260],
    duration: 0.06,
    gap: 0,
    waveform: "sine",
    gain: 0.1,
  };
}

export function createWebAudioAdapter(
  options: WebAudioAdapterOptions = {},
): WebAudioAdapter {
  const storage = options.storage === undefined
    ? getBrowserStorage()
    : options.storage;
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
  const manifestUrl = options.manifestUrl ?? "/assets/audio/v1/asset-manifest.json";
  const loadSamples = options.loadSamples ?? true;
  let settings = loadAudioSettings(storage);
  let state: WebAudioState = "locked";
  let context: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let compressor: DynamicsCompressorNode | null = null;
  const buses: Partial<Record<AudioEvent["channel"], GainNode>> = {};
  const buffers = new Map<string, AudioBuffer>();
  let loadingSamples = false;

  const syncGain = (): void => {
    if (masterGain) {
      masterGain.gain.value = settings.muted ? 0 : settings.masterVolume;
    }
    for (const [channel, gain] of Object.entries(buses)) {
      if (!gain) continue;
      gain.gain.value = channel === "warning"
        ? Math.min(1, settings.effectsVolume * 1.08)
        : settings.effectsVolume;
    }
  };

  const getContextFactory = options.contextFactory ?? defaultContextFactory;

  const unlock = async (): Promise<boolean> => {
    try {
      if (!context) {
        context = getContextFactory();
        masterGain = context.createGain();
        compressor = typeof context.createDynamicsCompressor === "function"
          ? context.createDynamicsCompressor()
          : null;
        if (compressor) {
          compressor.threshold.value = -18;
          compressor.knee.value = 12;
          compressor.ratio.value = 4;
          compressor.attack.value = 0.003;
          compressor.release.value = 0.18;
        }
        for (const channel of ["combat", "warning", "ui"] as const) {
          buses[channel] = context.createGain();
          buses[channel]?.connect(masterGain);
        }
        masterGain.connect(compressor ?? context.destination);
        compressor?.connect(context.destination);
        syncGain();
      }
      if (context.state === "suspended") {
        await context.resume();
      }
      state = "ready";
      if (loadSamples && !loadingSamples) {
        loadingSamples = true;
        void loadAudioSamples(context, fetchFn, manifestUrl, buffers).finally(() => {
          loadingSamples = false;
        });
      }
      return true;
    } catch {
      state = "unavailable";
      return false;
    }
  };

  const setSettings = (patch: Partial<AudioSettings>): AudioSettings => {
    settings = normalizeAudioSettings({ ...settings, ...patch });
    saveAudioSettings(settings, storage);
    syncGain();
    return { ...settings };
  };

  const handleEvent = (event: AudioEvent): void => {
    if (state !== "ready" || settings.muted || !context) {
      return;
    }
    if (settings.reducedAudio && shouldReduceEvent(event)) {
      return;
    }
    const destination = buses[event.channel] ?? buses.ui;
    if (!destination) return;
    const buffer = buffers.get(event.cue);
    if (buffer) {
      playSample(context, destination, buffer, event);
    } else {
      playCue(context, destination, event);
    }
  };

  const dispose = (): void => {
    if (context) {
      void context.close();
    }
    context = null;
    masterGain = null;
    compressor = null;
    for (const channel of Object.keys(buses)) {
      delete buses[channel as AudioEvent["channel"]];
    }
    buffers.clear();
    state = "locked";
  };

  return {
    getSettings: () => ({ ...settings }),
    getState: () => state,
    setSettings,
    unlock,
    handleEvent,
    getLoadedSampleCount: () => buffers.size,
    dispose,
  };
}

async function loadAudioSamples(
  context: AudioContext,
  fetchFn: typeof fetch | undefined,
  manifestUrl: string,
  buffers: Map<string, AudioBuffer>,
): Promise<void> {
  if (!fetchFn) return;
  try {
    const manifestResponse = await fetchFn(manifestUrl);
    if (!manifestResponse.ok) return;
    const manifest = await manifestResponse.json() as AudioAssetManifest;
    await Promise.all(Object.entries(manifest.assets).map(async ([cue, asset]) => {
      try {
        const response = await fetchFn(asset.url);
        if (!response.ok) return;
        const data = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(data.slice(0));
        buffers.set(cue, buffer);
      } catch {
        // Keep this cue on the deterministic procedural fallback.
      }
    }));
  } catch {
    // An unavailable manifest must never block the game or AudioContext unlock.
  }
}

function playSample(
  context: AudioContext,
  destination: GainNode,
  buffer: AudioBuffer,
  event: AudioEvent,
): void {
  const source = context.createBufferSource();
  source.buffer = buffer;
  const envelope = context.createGain();
  envelope.gain.value = event.intensity;
  const panner = typeof context.createStereoPanner === "function"
    ? context.createStereoPanner()
    : null;
  if (panner) {
    panner.pan.value = event.position
      ? Math.max(-1, Math.min(1, event.position.x / 220))
      : 0;
    panner.connect(destination);
    envelope.connect(panner);
  } else {
    envelope.connect(destination);
  }
  source.connect(envelope);
  source.start();
}

function playCue(
  context: AudioContext,
  destination: GainNode,
  event: AudioEvent,
): void {
  const profile = getCueProfile(event.cue);
  const start = context.currentTime + 0.005;
  const pan = event.position
    ? Math.max(-1, Math.min(1, event.position.x / 220))
    : 0;
  const panner = typeof context.createStereoPanner === "function"
    ? context.createStereoPanner()
    : null;
  if (panner) {
    panner.pan.value = pan;
    panner.connect(destination);
  }
  const output = panner ?? destination;

  profile.frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const onset = start + index * (profile.duration + profile.gap);
    const release = onset + profile.duration;
    const peak = profile.gain * event.intensity;
    oscillator.type = profile.waveform;
    oscillator.frequency.setValueAtTime(frequency, onset);
    if (profile.sweep) {
      oscillator.frequency.linearRampToValueAtTime(
        Math.max(40, frequency * (1 + profile.sweep)),
        release,
      );
    }
    envelope.gain.setValueAtTime(0.0001, onset);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), onset + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, release);
    oscillator.connect(envelope);
    envelope.connect(output);
    oscillator.start(onset);
    oscillator.stop(release + 0.02);
  });
}

function shouldReduceEvent(event: AudioEvent): boolean {
  return event.priority === "low" || event.type === "attack" || event.type === "hit";
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function getBrowserStorage(): AudioSettingsStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function defaultContextFactory(): AudioContext {
  const Constructor = window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) {
    throw new Error("WebAudio is unavailable");
  }
  return new Constructor();
}
