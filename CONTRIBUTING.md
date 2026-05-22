# 贡献指南

欢迎提交 Issue 和 Pull Request。

## 提交问题前

请先确认：

- 已阅读 `README.md`。
- 已查看 `docs/TROUBLESHOOTING.md`。
- 已执行基础冒烟测试。
- 日志中第一条异常已记录。

## Issue 信息建议

请提供：

- 操作系统。
- Docker 版本。
- `IMAGE_VERSION`。
- Stardew Valley 版本。
- SMAPI 版本。
- Mod 列表。
- 游戏日期。
- 触发事件，例如地震、节日、过夜、玩家断线。
- 相关日志摘要。

## 代码规范

- 文档使用简体中文。
- 脚本保持跨平台思路，Windows 用 PowerShell，Linux/macOS 用 Bash。
- 不提交 `.env`、Steam 凭据、真实存档和私密日志。
- 修改 Compose 或脚本后，需要至少执行配置校验。

## 推荐验证

```powershell
.\setup.ps1 doctor
docker compose --env-file .env.example config
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\sdv-server.ps1 status
```

第二条命令需要 Docker 正常运行；如果只是语法检查，可使用：

```powershell
$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content .\scripts\sdv-server.ps1 -Raw), [ref]$null)
```
