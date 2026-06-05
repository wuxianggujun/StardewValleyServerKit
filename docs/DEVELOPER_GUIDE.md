# 开发者指南

这份文档面向维护者、高级用户和需要改代码的人。普通服主部署服务器，请优先看 [新手使用指南](BEGINNER_GUIDE.md)。

## 适用范围

适合阅读这份文档的人：

- 需要本地构建镜像。
- 需要发布 Docker Hub / GHCR / 私有仓库镜像。
- 需要生成用户发布包。
- 需要修改脚本、Web 管理面板或 Docker Compose。
- 需要执行自动化测试和长稳验证。

普通用户不需要执行：

- `setup-build`
- `release-images`
- `package-release`
- `docker build`
- `docker push`

## 代码结构

```text
StardewValleyServerKit/
├── docker-compose.yml
├── docker-compose.build.yml.example
├── .env.example
├── setup.sh
├── setup.ps1
├── setup-build.sh
├── setup-build.ps1
├── release-images.sh
├── release-images.ps1
├── package-release.sh
├── package-release.ps1
├── scripts/
│   ├── sdv-server.sh
│   ├── sdv-server.ps1
│   ├── admin-panel.js
│   ├── vnc-proxy.js
│   └── admin-panel/
├── docs/
├── data/
├── backups/
└── logs/
```

关键入口：

- `setup.sh` / `setup.ps1`：普通用户入口，默认打开菜单。
- `scripts/sdv-server.sh` / `scripts/sdv-server.ps1`：实际运维逻辑。
- `scripts/admin-panel.js`：Web 管理面板服务入口。
- `scripts/admin-panel/`：Web 管理面板路由、页面、i18n、Mod 和存档逻辑。
- `docker-compose.yml`：普通拉镜像部署。
- `docker-compose.build.yml.example`：本地源码构建部署模板。

## 镜像命名

普通部署使用：

```text
<IMAGE_NAMESPACE>/server:<IMAGE_VERSION>
<IMAGE_NAMESPACE>/steam-service:<IMAGE_VERSION>
<IMAGE_NAMESPACE>/discord-bot:<IMAGE_VERSION>
```

默认：

```env
IMAGE_NAMESPACE=sdvd
IMAGE_VERSION=preview
```

如果发布到 GHCR，可以设置：

```env
IMAGE_NAMESPACE=ghcr.io/your-name
IMAGE_VERSION=preview
```

## 本地构建部署

本地构建用于开发者或源码发布包，不是普通用户路径。

Windows：

```powershell
.\setup-build.ps1
```

Linux / macOS：

```bash
chmod +x ./setup-build.sh
./setup-build.sh
```

脚本会在缺少 `docker-compose.build.yml` 时，从 `docker-compose.build.yml.example` 生成一份。

本地构建需要这些源码目录存在：

```text
server/Dockerfile
steam-service/Dockerfile
discord-bot/Dockerfile
```

如果源码目录不在默认位置，可以通过参数或环境变量指定：

```powershell
.\setup-build.ps1 -ServerSource C:\path\server -SteamServiceSource C:\path\steam-service -DiscordBotSource C:\path\discord-bot
```

Linux / macOS：

```bash
SVSK_BUILD_COMPOSE_FILE=docker-compose.build.yml ./setup-build.sh
```

## 发布镜像

发布镜像前先登录目标镜像仓库：

```bash
docker login
```

Windows：

```powershell
.\release-images.ps1 -ImageNamespace your-name -ImageVersion preview
```

Linux / macOS：

```bash
chmod +x ./release-images.sh
./release-images.sh --namespace your-name --version preview
```

只验证构建，不推送：

```powershell
.\release-images.ps1 -NoPush
```

Linux / macOS：

```bash
./release-images.sh --no-push
```

发布 GHCR 示例：

```bash
./release-images.sh --namespace ghcr.io/your-name --version preview
```

## 生成发布包

生成普通用户拉镜像部署包：

```powershell
.\package-release.ps1 -ImageNamespace sdvd -ImageVersion preview
```

Linux / macOS：

```bash
chmod +x ./package-release.sh
./package-release.sh --namespace sdvd --version preview
```

输出示例：

```text
dist/stardew-valley-server-kit-pull-preview.zip
```

如果源码构建目录存在，还会生成：

```text
dist/stardew-valley-server-kit-source-build-preview.zip
```

普通用户应该拿 `pull` 包。`source-build` 包只给高级用户和维护者。

## 发布包边界

普通用户发布包应该包含：

- `setup.sh`
- `setup.ps1`
- `scripts/sdv-server.sh`
- `scripts/sdv-server.ps1`
- `docker-compose.yml`
- `.env.example`
- `docs/`
- `QUICKSTART.md`

普通用户发布包不应该包含：

- `.env`
- `.git/`
- `data/`
- `logs/`
- `backups/`
- `release-images.*`
- `package-release.*`
- 维护者本地构建源码目录，除非是 `source-build` 包

## Web 管理面板开发

入口：

```text
scripts/admin-panel.js
```

核心目录：

```text
scripts/admin-panel/
├── api-routes.js
├── i18n.js
├── mods.js
├── page.js
└── *.self-test.js
```

开发注意：

- `ADMIN_TOKEN` 是 Web 管理面板登录令牌。
- 普通日志不能打印 `ADMIN_TOKEN`、`API_KEY`、Steam 密码或验证码。
- 前端文案集中在 `scripts/admin-panel/i18n.js`。
- 修改页面文案时要保持简体中文和 English key 对齐。
- 保存运行配置、存档配置、Mod 配置后，通常需要重启游戏服务端，不是只重启 `sdv-admin.service`。

## 存档和备份逻辑

Web 管理面板管理的是 Docker saves volume。

重要边界：

- 删除单个存档前，面板应先备份整个 saves volume。
- 删除单个存档只删除选中的存档目录。
- 恢复备份会覆盖整个 saves volume。
- 创建新地图不会删除旧存档。
- 农场地图、农场名、初始小屋和利润比例只影响新建农场。

这些边界必须在 UI 文案和文档里保持一致。

## Steam 下载链路

默认链路：

```text
steam-auth -> 下载游戏文件
```

备用链路：

```text
SteamCMD -> 下载 Stardew Valley 本体和 Steamworks SDK
```

常见情况：

- `The SteamClient instance must be connected` 不一定是账号密码错误，可能是 SteamClient 通道不可用。
- Docker Hub 镜像源只影响 `docker pull`，不能修复 Steam Directory API 或 Steam CM 连接。
- `steam-network` 只做无账号公共链路诊断，不读取 Steam 账号密码，不触发 Guard。
- SteamCMD 触发 Guard 时，脚本应通过交互终端隐藏读取验证码，并只通过 stdin 传给 SteamCMD。

详细说明见 [Steam 下载备用流程](STEAM_DOWNLOAD_FALLBACK.md)。

## 测试

脚本语法：

```bash
bash -n scripts/sdv-server.sh setup.sh package-release.sh release-images.sh setup-build.sh
```

PowerShell 解析：

```powershell
$files = @(
  'scripts/sdv-server.ps1',
  'setup.ps1',
  'package-release.ps1',
  'release-images.ps1',
  'setup-build.ps1'
)

foreach ($file in $files) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $file), [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Host $_.Message }
    exit 1
  }
  Write-Host "OK $file"
}
```

Compose 静态检查：

```bash
docker compose --env-file .env.example config --quiet
```

管理面板自测：

```bash
node scripts/admin-panel/auth.self-test.js
node scripts/admin-panel/config.self-test.js
node scripts/admin-panel/mods.self-test.js
node scripts/admin-panel/players.self-test.js
node scripts/admin-panel/i18n.self-test.js
node scripts/admin-panel/save-repair.self-test.js
```

空白检查：

```bash
git diff --check
```

## 手动验证清单

改动发布前至少验证：

- `./setup.sh` 无参数能打开菜单。
- `.\setup.ps1` 无参数能打开菜单。
- `admin-token-show` 不输入 `SHOW` 时不会打印令牌。
- `check-env` 只显示 `set` / `missing`。
- `docker compose --env-file .env.example config --quiet` 通过。
- Web 管理面板首页能返回 200。
- `sdv-server` 和 `sdv-steam-auth` 容器 healthy。

涉及 UI / 存档 / Mod 的改动，还需要看 [测试计划](TEST_PLAN.md)。

## 文档维护规则

文档分层：

- `README.md`：项目入口和新手导航。
- `docs/BEGINNER_GUIDE.md`：普通用户详细流程。
- `docs/OPERATIONS.md`：日常维护。
- `docs/TROUBLESHOOTING.md`：问题排查。
- `docs/DEVELOPER_GUIDE.md`：开发者和高级用户。
- `docs/BILIBILI_ARTICLE_DRAFT.md`：发布文章草稿。

修改部署流程时，至少同步检查：

- `README.md`
- `docs/BEGINNER_GUIDE.md`
- `docs/OPERATIONS.md`
- `docs/BILIBILI_ARTICLE_DRAFT.md`
- `package-release.sh`
- `package-release.ps1`

## 安全要求

不要提交或打印：

- `.env`
- Steam 密码
- Steam Guard 验证码
- `ADMIN_TOKEN`
- `API_KEY`
- `VNC_PASSWORD`
- 账号密码形式的代理 URL

服务器排查时，只能输出：

- 用户名字段值，且确认用户需要查看时。
- 敏感字段 `set` / `missing`。
- 文件路径和服务状态。

不要把真实 `.env` 放进发布包、文档、Issue、截图或聊天记录。
