# 预览环境部署

## 1. 预览地址

- URL：<https://rts-game-dev.rococo.dev>
- 用途：验证 dev 分支当前构建结果、首屏加载和浏览器运行状态。
- 当前部署目标：`netcup1`（使用 `ssh rococo-root` 登录）。

## 2. 部署结构

```text
/opt/docker/oc-projects/rts-game
  ├─ docker-compose.yml       # 项目级 Compose
  ├─ Dockerfile               # Vite 构建 + Nginx 静态服务
  └─ deploy/nginx.conf        # 容器内静态资源与 SPA fallback

项目容器 :3109
    ↓
共享 nginx :443
    ↓
rts-game-dev.rococo.dev
```

共享 Nginx 配置位于服务器的 `/opt/docker/rococo/data/nginx/conf.d/rts-game-dev.rococo.dev.conf`，上游使用 Docker 网桥网关 `172.18.0.1:3109`。域名使用现有的 `rococo.dev` 通配证书。

## 3. 服务器更新与启动

在 `netcup1` 上执行：

```bash
ssh rococo-root
cd /opt/docker/oc-projects/rts-game
git pull --ff-only origin main
cp -n .env.example .env
docker compose --env-file .env up -d --build
```

首次部署需要把项目级 Nginx 配置写入共享代理目录，然后检查并重新加载共享 Nginx：

```bash
docker exec nginx nginx -t
docker exec nginx nginx -s reload
```

只重建项目容器不会影响其他站点；修改共享 Nginx 配置前后都必须执行配置检查。

## 4. 验收

```bash
curl -I https://rts-game-dev.rococo.dev/
curl -sS https://rts-game-dev.rococo.dev/ | head
```

浏览器验收至少检查：

- 页面通过 HTTPS 打开且没有证书错误；
- 星空、网格、导航 beacon 和 HUD 正常显示；
- 浏览器控制台没有阻断性异常；
- `R` 可以重置相机，`P` 可以暂停/恢复；
- 刷新页面后仍能正常加载构建产物。

## 5. 变更边界

- dev 源码仍以 `ssh rococo-oc-workplace` 后的 `/work/oc-projects/rts-game` 为准。
- `netcup1` 的 `/opt/docker/oc-projects/rts-game` 是预览部署检出，不作为日常开发目录。
- 生产仓库和生产发布仍遵循现有 `oc-prod-release` 与 PR 流程；本预览部署不等于生产发布。
- 文档不保存 SSH 私钥、GitHub token、DNS 凭据或其他敏感信息。
