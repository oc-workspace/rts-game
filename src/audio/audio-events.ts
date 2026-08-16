import type { Faction, ShipClassId, Vec3 } from "../game/types";

export const AUDIO_EVENT_SCHEMA_VERSION = 1 as const;

export type AudioEventType =
  | "alert"
  | "attack"
  | "hit"
  | "destroyed"
  | "ui";
export type AudioChannel = "combat" | "warning" | "ui";
export type AudioPriority = "critical" | "high" | "normal" | "low";

export const AUDIO_DESIGN_CONTRACT = {
  schemaVersion: AUDIO_EVENT_SCHEMA_VERSION,
  channels: {
    combat: { maxVoices: 8, cooldownMs: 50 },
    warning: { maxVoices: 2, cooldownMs: 500 },
    ui: { maxVoices: 4, cooldownMs: 80 },
  },
  budgets: {
    maxEventsPerFrame: 8,
    maxHistory: 96,
    maxSpatialDistance: 220,
  },
  fallback: {
    muted: "drop-event",
    missingCue: "keep-event-for-adapter",
    unsupportedSpatialAudio: "use-2d-pan",
  },
} as const;

export interface AudioUnitRef {
  id: string;
  owner: Faction;
  classId: ShipClassId;
}

export interface AudioEventInput {
  type: AudioEventType;
  cue: string;
  time: number;
  channel: AudioChannel;
  priority: AudioPriority;
  intensity?: number;
  source?: AudioUnitRef;
  target?: AudioUnitRef;
  position?: Vec3;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface AudioEvent extends AudioEventInput {
  schemaVersion: typeof AUDIO_EVENT_SCHEMA_VERSION;
  eventId: string;
  intensity: number;
}

export type AudioEventListener = (event: AudioEvent) => void;

export interface AudioEventBus {
  emit(input: AudioEventInput): AudioEvent;
  subscribe(listener: AudioEventListener): () => void;
  history(): readonly AudioEvent[];
  clear(): void;
}

export function createAudioUnitRef(unit: AudioUnitRef): AudioUnitRef {
  return {
    id: unit.id,
    owner: unit.owner,
    classId: unit.classId,
  };
}

export function createAudioEventBus(
  onEmit?: AudioEventListener,
): AudioEventBus {
  let sequence = 0;
  const listeners = new Set<AudioEventListener>();
  const events: AudioEvent[] = [];

  const emit = (input: AudioEventInput): AudioEvent => {
    const event: AudioEvent = {
      ...input,
      schemaVersion: AUDIO_EVENT_SCHEMA_VERSION,
      eventId: input.type + "-" + String(++sequence).padStart(4, "0"),
      intensity: clampIntensity(input.intensity ?? 1),
      source: input.source ? createAudioUnitRef(input.source) : undefined,
      target: input.target ? createAudioUnitRef(input.target) : undefined,
      position: input.position ? { ...input.position } : undefined,
      metadata: input.metadata ? { ...input.metadata } : undefined,
    };

    events.push(event);
    if (events.length > AUDIO_DESIGN_CONTRACT.budgets.maxHistory) {
      events.splice(0, events.length - AUDIO_DESIGN_CONTRACT.budgets.maxHistory);
    }
    onEmit?.(event);
    listeners.forEach((listener) => listener(event));
    return event;
  };

  return {
    emit,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    history() {
      return events;
    },
    clear() {
      events.length = 0;
    },
  };
}

function clampIntensity(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}
