# rts-game

家园风格、宇宙规模的随机模式 3D RTS 实验项目。

当前已完成 P6 规模与性能阶段：固定 seed 随机遭遇、舰队控制、P5 舰船视觉、50/100/200 单位压力场景、性能仪表、远景 LOD、实例化批次和有上限的战斗特效对象池均可运行。当前舰船仍是程序化原型资产，下一阶段进入 P7 候选版验证。

## 预览

- <https://rts-game-dev.rococo.dev>
- 固定遭遇：<https://rts-game-dev.rococo.dev/?seed=20260810>
- 200 单位压力场景：<https://rts-game-dev.rococo.dev/?seed=20260810&units=200>

## 验证命令

```bash
npm install
npm test
npm run typecheck
npm run build
```

## 文档

- [项目背景与范围](docs/project-background.md)
- [渲染/游戏框架对比与选型](docs/engine-comparison.md)
- [技术开发方案](docs/technical-solution.md)
- [开发计划](docs/development-plan.md)
- [开发进度](docs/progress/README.md)

## 当前结论

核心战场采用 Three.js；UI/HUD 优先使用 DOM/CSS 与 Canvas 叠加。PixiJS、Phaser 3、Phaser 4 可用于不同类型的 2D 项目或局部原型，但不作为本项目的核心 3D 引擎。
