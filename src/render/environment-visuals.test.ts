import { describe, expect, it } from "vitest";
import {
  ENVIRONMENT_RENDER_ORDER,
  ENVIRONMENT_VISUAL_BASELINE,
  getCombatEffectActiveBudget,
} from "./environment-visuals";

describe("P8 environment visual baseline", () => {
  it("keeps background, battlefield and overlays in deterministic depth layers", () => {
    expect(ENVIRONMENT_RENDER_ORDER.starfield).toBeLessThan(
      ENVIRONMENT_RENDER_ORDER.rangeGrid,
    );
    expect(ENVIRONMENT_RENDER_ORDER.rangeGrid).toBeLessThan(
      ENVIRONMENT_RENDER_ORDER.asteroid,
    );
    expect(ENVIRONMENT_RENDER_ORDER.asteroid).toBeLessThan(
      ENVIRONMENT_RENDER_ORDER.targetMarker,
    );
    expect(ENVIRONMENT_RENDER_ORDER.targetMarker).toBeLessThan(
      ENVIRONMENT_RENDER_ORDER.combatFeedback,
    );
  });

  it("keeps environment materials and additive layers inside the P8 budget", () => {
    const { background, asteroid, targetMarker, postProcess } =
      ENVIRONMENT_VISUAL_BASELINE;
    expect(background.starCount).toBe(1700);
    expect(background.dustCount).toBe(260);
    expect(asteroid.maxCount).toBe(10);
    expect(asteroid.bodyRoughness).toBeGreaterThanOrEqual(0.72);
    expect(asteroid.bodyMetalness).toBeLessThanOrEqual(0.6);
    expect(targetMarker.maxDrawCalls).toBe(3);
    expect(postProcess.maxExtraPasses).toBe(0);
    expect(postProcess.additiveLayers).toBeLessThanOrEqual(3);
  });

  it("keeps high/low feedback caps explicit and bounded by the shared pool", () => {
    expect(getCombatEffectActiveBudget("high")).toBe(96);
    expect(getCombatEffectActiveBudget("low")).toBe(48);
    expect(getCombatEffectActiveBudget("high")).toBeLessThanOrEqual(
      ENVIRONMENT_VISUAL_BASELINE.combatFeedback.objectPoolLimit,
    );
  });
});
