# rts-game

家园风格、宇宙规模的随机模式 3D RTS 实验项目。

当前已完成 P4.3 随机遭遇闭环：固定 seed 舰队生成、多选与控制组、移动/攻击队列、战斗结果、遭遇状态、战斗日志、链接复制/重开和小地图导航均可运行。当前舰船仍是程序化原型资产，下一阶段进入 P5 视觉表现。

## 预览

- <https://rts-game-dev.rococo.dev>
- 固定遭遇：<https://rts-game-dev.rococo.dev/?seed=20260810>

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
