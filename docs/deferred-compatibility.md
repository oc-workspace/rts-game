# 多环境兼容性验证备份

## 状态

暂缓执行。本文档保存 P7 多环境验证的现状、边界和恢复步骤，后续获得对应设备或浏览器后再继续，不把未执行的项目写成已通过。

## 已验证环境

| 环境 | GPU | 结果 |
| --- | --- | --- |
| Codex 内置 Chromium/WebGL | Apple M3 Max，40 核 GPU，Metal 支持 | 已通过固定 Seed、200 单位高/低特效、选舰、暂停/恢复、桌面和移动视口检查 |

当前候选版提交：`a92928a`。

## 暂未验证环境

- 独立 Chrome：当前工作环境没有可调用的独立 Chrome 二进制或控制会话。
- Firefox：当前工作环境没有可调用的 Firefox 二进制或控制会话。
- Safari：macOS 上存在 Safari 应用，但当前浏览器控制工具没有 Safari 会话。
- 其他 GPU：尚未获得 Windows/NVIDIA/AMD/Intel 或其他 Apple GPU 的可重复测试结果。

## 恢复条件

满足以下任一条件后可恢复：

1. 提供一台能运行 Firefox 或 Safari 的设备，并能访问 `https://rts-game-dev.rococo.dev`；
2. 提供独立 Chrome/Firefox 浏览器控制会话；
3. 提供 Windows/NVIDIA/AMD/Intel 或不同 Apple GPU 的可重复运行环境。

## 复测清单

每个新增环境使用相同固定条件：

- URL：`?seed=20260810` 和 `?seed=20260810&units=200`；
- 视口：`1280x720`、`390x844`；
- 等待首屏稳定后检查标题、HUD、舰队列表、小地图和 3D 场景；
- 选中一艘玩家舰船，验证单位卡同步；
- 使用 `P` 验证暂停/恢复；
- 在高/低特效之间切换，记录 FPS、draw calls、simulation/render 时间和长帧；
- 记录浏览器控制台 error/warning；
- 保存同 seed 的桌面、压力和移动截图，与 `docs/progress/assets/` 基线比较；
- 使用 `npm run smoke -- https://rts-game-dev.rococo.dev` 验证 HTTP 入口和主资源。

## 当前结论

P7 候选版当前只对 Chromium/WebGL + Apple M3 Max 做出实际兼容性结论。多环境验证不是当前开发阻塞项，暂不为了覆盖矩阵引入额外浏览器依赖或改变渲染实现。
