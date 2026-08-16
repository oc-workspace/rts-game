import { describe, expect, it, vi } from "vitest";
import {
  AUDIO_DESIGN_CONTRACT,
  createAudioEventBus,
} from "./audio-events";

describe("P8 audio event contract", () => {
  it("normalizes immutable unit references, position and intensity", () => {
    const bus = createAudioEventBus();
    const event = bus.emit({
      type: "hit",
      cue: "weapon-hit",
      time: 12.5,
      channel: "combat",
      priority: "normal",
      intensity: 1.8,
      source: { id: "p-scout-01", owner: "player", classId: "scout" },
      position: { x: 1, y: 2, z: 3 },
    });

    expect(event.schemaVersion).toBe(1);
    expect(event.eventId).toBe("hit-0001");
    expect(event.intensity).toBe(1);
    expect(event.source).toEqual({
      id: "p-scout-01",
      owner: "player",
      classId: "scout",
    });
    expect(event.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("notifies listeners and keeps only the bounded QA history", () => {
    const listener = vi.fn();
    const bus = createAudioEventBus();
    const unsubscribe = bus.subscribe(listener);

    for (let index = 0; index < AUDIO_DESIGN_CONTRACT.budgets.maxHistory + 4; index += 1) {
      bus.emit({
        type: "ui",
        cue: "ui-command",
        time: index,
        channel: "ui",
        priority: "low",
      });
    }

    expect(listener).toHaveBeenCalledTimes(
      AUDIO_DESIGN_CONTRACT.budgets.maxHistory + 4,
    );
    expect(bus.history()).toHaveLength(AUDIO_DESIGN_CONTRACT.budgets.maxHistory);
    expect(bus.history()[0]?.eventId).toBe("ui-0005");
    unsubscribe();
    bus.emit({
      type: "ui",
      cue: "ui-command",
      time: 100,
      channel: "ui",
      priority: "low",
    });
    expect(listener).toHaveBeenCalledTimes(
      AUDIO_DESIGN_CONTRACT.budgets.maxHistory + 4,
    );
  });

  it("clamps invalid intensity to a safe default", () => {
    const bus = createAudioEventBus();
    expect(
      bus.emit({
        type: "alert",
        cue: "incoming-fire",
        time: 0,
        channel: "warning",
        priority: "high",
        intensity: Number.NaN,
      }).intensity,
    ).toBe(1);
    expect(
      bus.emit({
        type: "alert",
        cue: "incoming-fire",
        time: 0,
        channel: "warning",
        priority: "high",
        intensity: -1,
      }).intensity,
    ).toBe(0);
  });
});
