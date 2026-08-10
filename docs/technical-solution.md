# rts-game 技术开发方案

## 1. 方案目标

本方案把项目背景中的 3D 宇宙 RTS 愿景拆成可实现、可测量、可回退的技术系统。第一版优先建立一个稳定的单机随机遭遇 vertical slice，再逐步增加舰船数量、视觉复杂度和性能规模。

方案的核心原则：

1. 先完成可玩的闭环，再增加 AAA 风格表现。
2. 游戏模拟、输入、渲染和 UI 分层，避免把所有逻辑写在渲染循环中。
3. 所有大规模优化都以 profiling 数据为依据，不预先假设实例化或 Shader 一定能解决瓶颈。
4. 先使用少量可替换的程序化资产，等玩法和镜头稳定后再投入高细节模型。
5. 任何阶段都保持可启动、可构建、可回退。

## 2. 技术栈决策

| 层 | 第一阶段方案 | 选择理由 |
| --- | --- | --- |
| 语言 | TypeScript | 为单位数据、状态机、输入事件和渲染边界提供类型约束 |
| 构建 | Vite | 启动快、开发体验简单、适合 Three.js 浏览器原型 |
| 3D 战场 | Three.js | 直接控制场景、相机、材质、Shader、实例化和后处理 |
| UI/HUD | DOM/CSS | 文字、面板、按钮和可访问交互迭代快 |
| 2D 标记 | Canvas | 适合选框、连线、调试信息和少量 overlay |
| 2D 批量层 | 暂不强制引入 PixiJS | 只有当小地图或图标层成为性能瓶颈时再引入 |
| 游戏状态 | TypeScript 模块内的显式 store | 第一版减少依赖，保证模拟和 UI 的数据流清楚 |
| 测试 | 单元测试 + 浏览器 smoke test + 人工视觉检查 | 分别覆盖逻辑正确性、可运行性和视觉质量 |

具体包版本在初始化脚手架时读取官方当前稳定版本，并写入 lockfile；本方案不提前锁死未经验证的版本号。

## 3. 总体架构

~~~text
App Shell
  ├─ bootstrap / config / lifecycle
  ├─ input router
  └─ fixed-step game loop

Simulation
  ├─ world state
  ├─ unit registry
  ├─ movement / formation
  ├─ combat / damage
  └─ deterministic random encounter

Presentation
  ├─ Three.js scene / camera / lights
  ├─ ship renderers / materials / shaders
  ├─ effects / particles / postprocess
  └─ picking / world-screen projection

Interface
  ├─ selection panel
  ├─ command queue / unit card
  ├─ minimap and tactical markers
  └─ pause / settings / debug panel

Verification
  ├─ deterministic simulation tests
  ├─ build and startup checks
  ├─ performance counters
  └─ screenshot / visual regression notes
~~~

## 4. 模块边界

### 4.1 App Shell

负责初始化配置、创建 renderer、挂载 UI、启动和停止游戏循环。它不直接实现单位移动或战斗规则。

建议入口职责：

- 读取运行配置和随机种子；
- 初始化 Simulation、Renderer 和 UI；
- 处理暂停、恢复、重开和错误状态；
- 在开发环境暴露调试开关。

### 4.2 Simulation

Simulation 是游戏规则的唯一来源。它不依赖 Three.js 对象，能够在没有画面的情况下执行测试和回放。

第一版实体数据至少包含：

| 数据 | 示例字段 |
| --- | --- |
| Unit | id、owner、classId、position、rotation、velocity、health、state |
| ShipClass | speed、turnRate、maxHealth、weaponRange、damage、cooldown、scale |
| Order | type、sourceUnitIds、targetPosition、targetUnitId、createdAt |
| Formation | memberIds、anchor、spacing、facing、formationType |
| Encounter | seed、mapBounds、spawnGroups、neutralObjects、victoryState |

第一版不引入重量级 ECS 框架。先用显式 registry、纯函数规则和清晰的系统更新顺序；当实体数量和组件组合确实需要 ECS 时再迁移。

### 4.3 Renderer

Renderer 把 Simulation 的状态映射为 Three.js 表现对象：

- 单位数据变化时更新位置、朝向、可见状态和动画参数；
- 不在 Mesh 对象中保存决定胜负的逻辑；
- 复用 Mesh、材质和粒子对象，避免每帧创建和销毁；
- 为近景、战术距离、远景准备不同表现等级；
- 将屏幕拾取结果转换成 Simulation 可理解的 unit id。

### 4.4 Input and Selection

输入系统分为相机输入和指令输入：

- 相机：平移、缩放、旋转、聚焦和重置；
- 选择：单击、框选、加选、取消选择；
- 指令：右键移动、右键攻击、停止、编组和快捷键；
- UI：面板点击、暂停、重开和设置。

所有输入先转换为语义命令，再交给 Simulation；这样鼠标、键盘、触控和未来回放可以共享同一套指令路径。

### 4.5 UI/HUD

DOM/CSS 负责文本、按钮、状态卡片、面板和设置。Canvas 或 Three.js overlay 负责世界空间标记、选择框和目标线。

UI 不直接修改单位对象，而是：

1. 读取当前只读 view model；
2. 向 Input/Command 层发送用户意图；
3. 等待 Simulation 更新；
4. 根据新状态刷新显示。

## 5. 游戏循环与时间模型

采用固定步长模拟与可变帧率渲染：

~~~text
accumulator += frameDelta
while accumulator >= fixedStep:
  input.consume()
  simulation.update(fixedStep)
  accumulator -= fixedStep

render(interpolation)
ui.render(viewModel)
~~~

建议第一版固定步长从 1/60 秒开始，并将最大补偿步数设上限，避免浏览器切后台后出现 spiral of death。渲染可以使用插值，让单位视觉位置平滑但不改变模拟结果。

## 6. 渲染与视觉方案

### 6.1 太空场景

- 星空背景使用分层点云或实例化 billboard，避免把背景当作大量独立 Mesh。
- 战术空间使用稀疏的辅助网格、边界标记和深度提示，帮助玩家理解距离。
- 远景使用低成本发光体和雾化层，近景再启用细节材质。

### 6.2 舰船

第一版每类舰船使用一个可辨识的低中模基础模型，区别来自轮廓、尺度、推进布局和材质颜色，而不是先堆积细节。

表现等级：

1. 远景：简化几何、基础材质、少量灯光；
2. 战术距离：完整轮廓、推进焰、武器挂点和阵营色；
3. 近景：细节材质、局部 emissive、伤害状态和粒子效果。

### 6.3 Shader 与特效

着色器先用于可控、可诊断的效果：

- 舰体边缘光和阵营色；
- 推进焰强度；
- 武器轨迹和命中闪光；
- 护盾/受损状态；
- 选择高亮和目标指示。

特效必须有生命周期、对象池和数量上限。禁止在每个粒子或每帧路径中无界创建 GPU/CPU 对象。

## 7. 性能策略

性能目标按阶段验证，不把目标当成完成结论：

| 阶段 | 初始压力场景 | 关注点 |
| --- | --- | --- |
| M1 | 1 至 20 艘舰船 | 输入、拾取、相机和基础渲染 |
| M2 | 50 艘舰船 | 状态更新、碰撞近似和 HUD 刷新 |
| M3 | 100 至 200 艘舰船 | 批量更新、实例化、空间查询和粒子 |
| M4+ | 以实际 profiling 结果扩展 | LOD、可见性裁剪、材质合批和对象池 |

每次性能优化都记录：

- 浏览器和 GPU；
- 视口尺寸；
- 活跃单位、可见单位和特效数量；
- 平均帧率、长帧比例、Simulation 时间和 Render 时间；
- 优化前后的差异。

优先顺序：

1. 避免无效工作和每帧分配；
2. 限制不可见对象更新；
3. 复用对象并合并批次；
4. 使用实例化和 LOD；
5. 最后再增加 Shader 和后处理复杂度。

## 8. 随机模式方案

随机模式必须可复现。每局保存一个 seed，并由 seed 决定：

- 地图范围和背景层；
- 初始双方阵容；
- 中立物或资源点；
- 初始位置和编队；
- 随机遭遇事件。

随机生成器不能直接调用不可控的全局随机函数。所有生成结果通过 Encounter 配置输出，便于测试、分享和复盘。

## 9. 验证方案

### 逻辑验证

- 单位移动、转向、攻击、伤害和死亡的纯逻辑测试；
- 相同 seed 产生相同初始状态；
- 指令队列顺序和暂停/恢复行为稳定；
- 随机生成不产生越界位置或空阵容。

### 浏览器验证

- 开发启动成功；
- 生产构建成功；
- 首屏 renderer 创建成功；
- 鼠标和键盘主路径可用；
- 重新开始后状态清零；
- 不支持 WebGL/WebGPU 时显示可理解的错误。

### 视觉验证

- 固定 seed 和固定视角截图；
- 检查舰船轮廓、阵营色、选中反馈和 HUD 对齐；
- 检查不同距离下的可读性；
- 检查特效关闭/低画质模式是否正确降级；
- 记录问题、复现步骤和修复提交。

## 10. 风险与降级策略

| 风险 | 影响 | 降级策略 |
| --- | --- | --- |
| 3D 资产生产速度不足 | 视觉迭代被资产阻塞 | 先用程序化/占位模型锁定镜头和玩法 |
| 大量单位导致长帧 | 规模感和操作流畅度下降 | 限制模拟频率、视距、特效数，启用对象池和 LOD |
| 浏览器 GPU 差异 | 某些设备黑屏或效果异常 | WebGL 基线、能力检测、效果降级和错误提示 |
| UI 与世界坐标不同步 | 信息误导玩家 | 统一 projection service，并加入固定视角截图检查 |
| 规则和渲染耦合 | 难以测试和扩展 | Simulation 不引用 Three.js 对象 |
| 生产发布漂移 | dev/prod 内容不一致 | 仅通过 oc-prod-release 和 PR 发布后续变更 |

## 11. 技术方案的完成标准

当一个技术阶段满足以下条件，才算完成：

- 模块边界清楚，关键规则不藏在渲染代码中；
- 有最小可运行路径和可复现启动命令；
- 有对应的逻辑测试或 smoke test；
- 有至少一个固定 seed 的视觉验证结果；
- 有性能数据或明确说明为什么当前阶段暂不测量；
- 已记录已知限制和下一步。

