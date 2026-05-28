# 自动化测试流程

> 目标：把人工步骤压缩到一次 Steam Guard 授权。授权成功后，后续下载、启动、日志检查和长稳跟进都可以自动推进。

## 当前不可自动化的步骤

Steam Guard / Steam Mobile 二次验证不能绕过，也不要把验证码、二维码、账号密码发到聊天或 Issue。

第一次登录请在本机终端执行：

```powershell
.\setup.ps1 login
```

看到邮箱验证码提示后，在同一个终端窗口输入验证码并回车。登录成功后，Steam session 会保存在 Docker volume：

```text
stardew-valley-server-kit_steam-session
```

后续一般不需要重复输入验证码。

## 授权后的自动流程

登录成功后执行：

```powershell
.\setup.ps1 download
.\setup.ps1 steamcmd-download
.\setup.ps1 smoke
.\setup.ps1 backup
```

`download` 会下载或更新 Stardew Valley 游戏文件。

如果 `download` 在 manifest 下载阶段返回 `403 (Forbidden)`，不要反复重试。
这通常发生在 `steam-auth` 已登录且 license 校验通过之后。改用
[Steam 下载备用流程](STEAM_DOWNLOAD_FALLBACK.md)，通过 SteamCMD 下载到
`stardew-valley-server-kit_game-data` volume。

推荐命令：

```powershell
.\setup.ps1 steamcmd-download -Retries 5
```

如果 SteamCMD 出现 `state is 0x402 after update job`，脚本会自动重试。
已经下载到 `game-data` volume 的部分文件会被复用。

SteamCMD 备用流程可能再次要求 Steam Guard。验证码输入位置是运行
SteamCMD 的本机终端；如果终端断开但容器仍在等待，可用
`docker attach <container-id>` 接回后输入验证码。

`smoke` 会执行：

- 启动 `server` 和 `steam-auth`
- 等待容器进入运行状态
- 检查 Web VNC 端口
- 检查 HTTP API 端口
- 输出最近日志摘要

一次健康的基础冒烟至少应看到：

- `server` 和 `steam-auth` 均为 `healthy`
- `5800/tcp` 和 `8080/tcp` 可达
- 日志出现 `Steam GameServer initialized successfully`
- 日志出现 `SaveGame.Save() completed without exceptions`
- 日志出现 Steam SDR 或 Galaxy P2P invite code
- 没有持续刷出的 `Callback dispatcher is not initialized`
- 没有 save、XML、content、corrupt 相关红色异常

无头容器里可能出现 `Game.Initialize() caught exception initializing XACT`
或 OpenAL/ALSA 音频警告。官方上游测试也把 XACT 音频初始化失败列为
容器环境可忽略项；只要游戏继续进入存档、API 可用且保存完成，就不要把它
单独判定为冒烟失败。

`backup` 会把 `saves` Docker volume 导出到 `backups/`，用于特殊日期、
极端天气或 Mod 测试前的回滚点。

## 本地静态自检

不需要 Steam 登录、Docker 或真实 Nexus API Key 的检查：

```powershell
node --check scripts/admin-panel.js
node --check scripts/admin-panel/api-routes.js
node --check scripts/admin-panel/mods.js
node --check scripts/admin-panel/page.js
node scripts/admin-panel/mods.self-test.js
```

`mods.self-test.js` 会覆盖 Nexus 文件分组、推荐主文件、严格 ID 校验、未配置
`NEXUS_API_KEY` 时的错误提示，以及 Nexus 429 的短退避重试、长 `Retry-After`
冷却和成功文件列表缓存，不会访问真实 Nexus API。

## 推荐过夜长测顺序

1. 完成 `.\setup.ps1 login`
2. 优先执行 `.\setup.ps1 download`
3. 如果 `download` 报 403，执行 `.\setup.ps1 steamcmd-download -Retries 5`
4. 执行 `.\setup.ps1 smoke`
5. 打开 `http://localhost:5800`
6. 用游戏客户端加入测试农场
7. 完成一次睡觉过夜
8. 执行 `.\setup.ps1 backup`
9. 执行 `.\setup.ps1 logs`
10. 按 `TEST_PLAN.md` 继续推进春 5、夏 3 地震、节日、雷雨、绿色雨和重启测试

执行每个高风险场景前都先备份，尤其是：

- 第一次过夜保存前
- 夏 3 地震前
- 节日前一天晚上
- 雷雨、绿色雨、暴雪或天气 Mod 测试前
- 容器重启可读性测试前

## 自动化跟进建议

如果使用 Codex、CI 或其他外部自动化做长稳跟进，建议检查：

- Docker 容器状态
- `steam-auth` 状态
- `server` 状态
- VNC / API 端口可达性
- 最近日志中的异常摘要
- 是否需要在高风险测试前补充存档备份
- 过夜、地震、节日、极端天气后的卡死和存档损坏迹象

自动化输出不得包含 Steam 账号、密码、token、API Key 或 VNC 密码。

如果自动化只用于临时排查，问题处理完后应删除或暂停，避免持续唤醒和重复检查。

## 如果登录失败

常见原因：

- 邮箱验证码过期
- Steam Guard 输入到了错误终端
- Steam 临时返回 `TryAnotherCM`
- manifest 下载返回 `403 (Forbidden)`
- SteamCMD 返回 `state is 0x402 after update job`
- 账号触发风控，需要先在 Steam 客户端确认登录

建议：

1. 先在 Steam 客户端确认账号可正常登录。
2. 重新执行 `.\setup.ps1 login`。
3. 收到验证码后马上在同一终端输入。
4. 登录成功后再执行 `.\setup.ps1 download`。
5. 如果 `download` 报 403，执行 `.\setup.ps1 steamcmd-download -Retries 5`。
