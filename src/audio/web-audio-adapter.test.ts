import { describe, expect, it } from "vitest";
import {
  AUDIO_SETTINGS_STORAGE_KEY,
  DEFAULT_AUDIO_SETTINGS,
  createWebAudioAdapter,
  getCueProfile,
  loadAudioSettings,
  normalizeAudioSettings,
  saveAudioSettings,
} from "./web-audio-adapter";

function createFakeContext(): { context: AudioContext; started: number } {
  const state = { value: "suspended" as AudioContextState, started: 0 };
  const gain = () => ({
    gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    connect() {},
  });
  const context = {
    state: state.value,
    currentTime: 0,
    destination: {},
    createGain: gain,
    createDynamicsCompressor: () => ({
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect() {},
    }),
    createStereoPanner: () => ({ pan: { value: 0 }, connect() {} }),
    createOscillator: () => ({
      type: "sine" as OscillatorType,
      frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect() {},
      start() { state.started += 1; },
      stop() {},
    }),
    resume: async () => { state.value = "running"; },
    close: async () => {},
  } as unknown as AudioContext;
  Object.defineProperty(context, "state", { get: () => state.value });
  return { context, get started() { return state.started; } };
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe("P8 WebAudio adapter settings", () => {
  it("clamps volume values and preserves accessibility flags", () => {
    expect(normalizeAudioSettings({
      masterVolume: 2,
      effectsVolume: -1,
      muted: true,
      reducedAudio: true,
    })).toEqual({
      masterVolume: 1,
      effectsVolume: 0,
      muted: true,
      reducedAudio: true,
    });
  });

  it("round-trips settings through the namespaced storage key", () => {
    const storage = createMemoryStorage();
    saveAudioSettings({
      masterVolume: 0.4,
      effectsVolume: 0.7,
      muted: false,
      reducedAudio: true,
    }, storage);
    expect(storage.getItem(AUDIO_SETTINGS_STORAGE_KEY)).toContain("reducedAudio");
    expect(loadAudioSettings(storage)).toEqual({
      masterVolume: 0.4,
      effectsVolume: 0.7,
      muted: false,
      reducedAudio: true,
    });
  });

  it("falls back safely for corrupt storage and unknown cues", () => {
    const storage = createMemoryStorage();
    storage.setItem(AUDIO_SETTINGS_STORAGE_KEY, "not-json");
    expect(loadAudioSettings(storage)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(getCueProfile("future-cue").frequencies).toEqual([260]);
  });

  it("unlocks only through the adapter, plays cues, and respects reduced audio", async () => {
    const fake = createFakeContext();
    const adapter = createWebAudioAdapter({
      storage: createMemoryStorage(),
      contextFactory: () => fake.context,
      loadSamples: false,
    });
    const event = {
      schemaVersion: 1 as const,
      eventId: "attack-0001",
      type: "attack" as const,
      cue: "weapon-fire",
      time: 1,
      channel: "combat" as const,
      priority: "normal" as const,
      intensity: 1,
    };

    expect(adapter.getState()).toBe("locked");
    adapter.handleEvent(event);
    expect(fake.started).toBe(0);
    await expect(adapter.unlock()).resolves.toBe(true);
    expect(adapter.getState()).toBe("ready");
    adapter.handleEvent(event);
    expect(fake.started).toBeGreaterThan(0);
    const beforeReduced = fake.started;
    adapter.setSettings({ reducedAudio: true });
    adapter.handleEvent(event);
    expect(fake.started).toBe(beforeReduced);
    adapter.dispose();
  });
});
