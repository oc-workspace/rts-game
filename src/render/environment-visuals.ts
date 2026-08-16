/**
 * P8 环境视觉基线。
 *
 * 这里的数值是“预算契约”，不是鼓励继续堆叠效果的默认值：背景永远
 * 位于战场下层，标记/战斗反馈只在需要时以无深度写入的叠加层绘制。
 */
export const ENVIRONMENT_RENDER_ORDER = {
  starfield: -30,
  spaceDust: -20,
  distantPlanet: -10,
  rangeGrid: -2,
  asteroid: 10,
  targetMarker: 30,
  combatFeedback: 40,
} as const;

export const ENVIRONMENT_VISUAL_BASELINE = {
  background: {
    clearColor: 0x04090e,
    fogColor: 0x04090e,
    fogDensity: 0.00022,
    starCount: 1700,
    starOpacity: 0.72,
    dustCount: 260,
    dustOpacity: 0.075,
    distantPlanetOpacity: 0.09,
  },
  asteroid: {
    maxCount: 10,
    bodyRoughness: 0.82,
    bodyMetalness: 0.48,
    bodyEmissiveIntensity: 0.12,
    facetRoughness: 0.76,
    facetMetalness: 0.58,
  },
  targetMarker: {
    maxDrawCalls: 3,
    ringOpacity: 0.68,
    bracketOpacity: 0.7,
    groundOffset: 0.12,
  },
  combatFeedback: {
    objectPoolLimit: 256,
    highMaxActive: 96,
    lowMaxActive: 48,
    highLineOpacity: 0.86,
    lowLineOpacity: 0.62,
  },
  postProcess: {
    toneMappingExposure: 1.08,
    maxExtraPasses: 0,
    additiveLayers: 3,
  },
} as const;

export type EffectsQualityBudget = "high" | "low";

export function getCombatEffectActiveBudget(
  quality: EffectsQualityBudget,
): number {
  return quality === "high"
    ? ENVIRONMENT_VISUAL_BASELINE.combatFeedback.highMaxActive
    : ENVIRONMENT_VISUAL_BASELINE.combatFeedback.lowMaxActive;
}
