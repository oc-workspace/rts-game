# rts-game

家园风格、宇宙规模的随机模式 3D RTS 实验项目。

当前版本为 `v0.1.0-rc.1` 候选版。P0 至 P7 计划范围已经闭环：固定 seed 随机遭遇、舰队控制、三类舰船、战斗与胜负、战术 HUD、程序化视觉、50/100/200 单位压力场景、性能优化和候选版回归均已完成。

当前定位仍是可玩的程序化 vertical slice，不是最终商业资产质量；独立 Firefox、Safari 和其他 GPU 的兼容性验证已记录为后续工作，不阻塞本候选版。

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
npm run smoke -- https://rts-game-dev.rococo.dev
```

## 文档

- [项目背景与范围](docs/project-background.md)
- [渲染/游戏框架对比与选型](docs/engine-comparison.md)
- [技术开发方案](docs/technical-solution.md)
- [开发计划](docs/development-plan.md)
- [开发进度](docs/progress/README.md)
- [v0.1.0-rc.1 发布说明](docs/releases/v0.1.0-rc.1.md)

## 当前结论

核心战场采用 Three.js；UI/HUD 使用 DOM/CSS 与 Canvas 叠加。200 单位远景通过 LOD、实例化和有上限的特效对象池控制提交成本。PixiJS、Phaser 3、Phaser 4 不作为本项目的核心 3D 引擎。
