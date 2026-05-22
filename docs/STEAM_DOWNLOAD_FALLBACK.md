# Steam 下载备用流程

> 适用场景：`.\setup.ps1 login` 已经成功，但 `.\setup.ps1 download`
> 在下载 manifest 时失败，例如出现 `403 (Forbidden)`；或者 SteamCMD
> 下载中途出现 `state is 0x402 after update job`。

## 背景

本项目默认使用 `steam-auth` 服务下载 Stardew Valley 正版游戏文件。
少数网络、CDN 或 SteamKit 状态下，登录和 license 校验都能通过，
但 manifest 下载会返回 403。

这种情况不代表账号没有游戏，也不代表 Steam Guard 失败。可以改用
SteamCMD 把 Linux 版游戏文件下载到同一个 Docker volume：

```text
stardew-valley-server-kit_game-data
```

下载完成后，仍然使用本项目的 `server` 容器启动游戏。

## 重要安全规则

- 不要把 Steam 密码、Steam Guard 验证码、refresh token 发到聊天、Issue 或截图里。
- 验证码只能输入到本机正在运行的终端。
- 不要把 `.env` 提交到公开仓库。
- SteamCMD 备用流程仍然要求账号拥有正版 Stardew Valley。

## 推荐命令

Windows：

```powershell
.\setup.ps1 steamcmd-download -Retries 5
```

Linux / macOS：

```bash
RETRIES=5 ./scripts/sdv-server.sh steamcmd-download
```

这个命令会自动重试。SteamCMD 已经写入 `game-data` volume 的部分文件会被复用，
所以网络中断或 `0x402` 后不需要从零开始。

脚本还会额外下载 Steamworks SDK Redistributable（AppID `1007`）到：

```text
stardew-valley-server-kit_game-data:/data/game/.steam-sdk
```

JunimoServer 的 Steam SDR / GameServer 模式需要其中的 `steamclient.so`。
如果只下载了 Stardew Valley 本体而缺少 SDK，服务可能启动但日志会出现
`Steam GameServer`、`Callback dispatcher is not initialized` 或 SDR 初始化异常。

## 手动 Windows PowerShell 备用下载

在项目目录执行：

```powershell
cd C:\Users\wuxianggujun\CodeSpace\StardewValleyServerKit
```

正常情况下优先使用 `.\setup.ps1 steamcmd-download -Retries 5`。
如果需要手动排查，再执行：

```powershell
$ErrorActionPreference = 'Stop'
function Get-EnvValue {
    param([string]$Key)
    $pattern = "^\s*$([regex]::Escape($Key))\s*=\s*(.*)\s*$"
    foreach ($line in Get-Content -LiteralPath .env) {
        if ($line -match $pattern) {
            $value = $Matches[1].Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                return $value.Substring(1, $value.Length - 2)
            }
            return $value
        }
    }
    return ''
}

$steamUser = Get-EnvValue 'STEAM_USERNAME'
$steamPass = Get-EnvValue 'STEAM_PASSWORD'
if (-not $steamUser -or -not $steamPass) {
    throw 'Steam credentials are missing in .env'
}

docker run --rm -it `
  -v stardew-valley-server-kit_game-data:/data/game `
  -v stardew-valley-server-kit_steamcmd:/home/steam/Steam `
  -e STEAM_USERNAME=$steamUser `
  -e STEAM_PASSWORD=$steamPass `
  cm2network/steamcmd:latest `
  bash -lc '/home/steam/steamcmd/steamcmd.sh +@sSteamCmdForcePlatformType linux +force_install_dir /data/game +login "$STEAM_USERNAME" "$STEAM_PASSWORD" +app_update 413150 validate +quit'
```

## Steam Guard 验证码怎么输入

如果终端显示：

```text
Steam Guard code:
```

就在同一个 PowerShell 窗口直接输入邮箱或 Steam Mobile 中看到的验证码，
然后按回车。

不要把验证码复制到聊天、Issue 或文档里。

## 如果终端断开但容器还在等验证码

先查正在运行的 SteamCMD 容器：

```powershell
docker ps --filter ancestor=cm2network/steamcmd:latest
```

输出里会有容器 ID。假设容器 ID 是 `abc123`，重新接回它：

```powershell
docker attach abc123
```

接回后即使屏幕没有新提示，也可以直接输入 Steam Guard 验证码并回车。

如果下载已经开始，想离开观察但不停止容器，按：

```text
Ctrl+P
Ctrl+Q
```

不要按 `Ctrl+C`，那会中断下载。

## 验证是否下载成功

执行：

```powershell
docker run --rm `
  -v stardew-valley-server-kit_game-data:/data/game `
  --entrypoint bash cm2network/steamcmd:latest `
  -lc 'find /data/game -maxdepth 2 -type f | sed -n "1,80p"; printf "COUNT="; find /data/game -type f | wc -l'
```

如果 `COUNT` 大于 0，并能看到 Stardew Valley 相关文件，就可以继续：

```powershell
.\setup.ps1 smoke
```

同时建议确认 Steamworks SDK 已存在：

```powershell
docker run --rm `
  -v stardew-valley-server-kit_game-data:/data/game:ro `
  alpine:3.20 sh -c 'test -f /data/game/.steam-sdk/linux64/steamclient.so -o -f /data/game/.steam-sdk/steamclient.so; echo SDK_OK=$?'
```

`SDK_OK=0` 表示 SDK 可用。

## 常见问题

### `steamcmd: command not found`

`cm2network/steamcmd` 镜像中的入口不是裸 `steamcmd`，应使用：

```text
/home/steam/steamcmd/steamcmd.sh
```

### `download` 报 403

如果 `.\setup.ps1 download` 已经显示 license 校验通过，但 manifest 下载返回
`403 (Forbidden)`，优先执行：

```powershell
.\setup.ps1 steamcmd-download -Retries 5
```

### SteamCMD 报 0x402

如果 SteamCMD 日志中出现：

```text
state is 0x402 after update job
```

通常是下载任务中途失败。重新执行：

```powershell
.\setup.ps1 steamcmd-download -Retries 5
```

脚本会自动重试，并复用已经下载到 `game-data` volume 的部分文件。

### 不确定是否还在等待验证码

查看日志：

```powershell
docker logs --tail 80 <container-id>
```

如果看到 `Steam Guard code:` 或 `set_steam_guard_code`，说明仍在等待验证码。
