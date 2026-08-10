# rts-game

家园风格、宇宙规模的随机模式 3D RTS 实验项目。

当前阶段先完成项目背景、技术路线和开发/发布约定；核心玩法与美术资产将在后续迭代中实现。

## 文档

- [项目背景与范围](docs/project-background.md)
- [渲染/游戏框架对比与选型](docs/engine-comparison.md)
- [开发与生产发布流程](docs/development-and-release.md)

## 当前结论

核心战场采用 Three.js；UI/HUD 优先使用 DOM/CSS 与 Canvas 叠加。PixiJS、Phaser 3、Phaser 4 可用于不同类型的 2D 项目或局部原型，但不作为本项目的核心 3D 引擎。

