# 开发与生产发布流程

本项目按 OpenClaw 开发与生产发布脚本说明执行。开发和生产发布是两条职责不同的链路：开发服务器创建并推送 oc-workspace/rts-game；生产桥接服务器在隔离目录中检出 dev，再按需创建、初始化、发布 oWinnieo/rts-game。

规范来源：[OpenClaw 开发与生产发布脚本说明](https://github.com/oc-workspace/openclaw-workspace/blob/main/openclaw-%E5%BC%80%E5%8F%91%E4%B8%8E%E7%94%9F%E4%BA%A7%E5%8F%91%E5%B8%83%E8%84%9A%E6%9C%AC%E8%AF%B4%E6%98%8E.md)。

## 1. 开发侧

服务器：rococo-oc-workplace，用户：openclaw，项目根目录：/work/oc-projects。

### 首次创建 dev 仓库

项目文件写入 /work/oc-projects/rts-game 后执行：

~~~bash
ssh rococo-oc-workplace
cd /work/oc-projects/rts-game
source ~/.profile
oc-create-repo
~~~

oc-create-repo 使用当前目录名创建 oc-workspace/rts-game private 仓库，初始化 Git，提交当前内容，设置 main 和 origin，并推送到 origin/main。

### 后续提交

~~~bash
ssh rococo-oc-workplace
cd /work/oc-projects/rts-game
source ~/.profile
oc-push "Update project"
~~~

不传提交信息时使用脚本默认提交信息。提交前建议检查：

~~~bash
git status --short --branch
git remote -v
~~~

## 2. 生产发布侧

服务器：rococo-root，用户：root，隔离发布根目录：/opt/docker/for-oc-dev2prod。

本次需求只要求建立开发项目，因此以下命令作为后续发布操作记录，不在本次初始化中自动执行。

### 第一次建立隔离检出

~~~bash
ssh rococo-root
cd /opt/docker/for-oc-dev2prod
source ~/.profile
oc-prod-clone rts-game
~~~

默认关系为：

~~~text
origin -> oc-workspace/rts-game
prod   -> oWinnieo/rts-game
~~~

### 创建并初始化 prod 仓库

如果 oWinnieo/rts-game 尚不存在：

~~~bash
cd /opt/docker/for-oc-dev2prod/rts-game
source ~/.profile
oc-prod-create-repo
oc-prod-init
~~~

如果 prod 已经存在且有 main，不要重复执行 oc-prod-init，应使用后续发布命令。

### 后续正式发布

~~~bash
ssh rococo-root
cd /opt/docker/for-oc-dev2prod/rts-game
source ~/.profile
oc-prod-release "Release YYYY-MM-DD"
~~~

该命令会创建发布分支并推送到 prod，随后需要在 GitHub 检查差异并合并 PR。

## 3. 安全约束

- 不在聊天、Markdown、日志或代码仓库中保存 GitHub token 明文。
- 生产 token 文件按规范保持在 /root/.config/oc-prod/github-token，权限应为 600 且所有者为 root。
- 执行 oc-prod-init 或 oc-prod-release 前，确认隔离目录、工作区状态和 origin/prod remote 都正确。
- 任何发布操作先做只读检查，再执行写入或推送。

