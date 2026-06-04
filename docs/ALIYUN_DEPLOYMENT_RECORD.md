# 阿里云部署记录

本文记录 StardewValleyServerKit 在阿里云服务器上的部署方式和验证步骤。
敏感信息只保存在服务器 `/opt/stardew-valley-server-kit/.env`，文档和日志不记录
Steam 账号、密码、验证码、API Key 或管理令牌。

## 服务器信息

- 目标服务器：`root@139.196.225.211`
- 部署目录：`/opt/stardew-valley-server-kit`
- 发布包目录：`/opt/stardew-valley-server-kit-releases`
- 部署入口：`./setup.sh`

## 当前部署策略

普通用户只需要运行一键脚本：

```bash
cd /opt/stardew-valley-server-kit
./setup.sh
```

脚本会先按正常流程让服务器自己下载 Docker 镜像。只有 Docker Hub 或镜像仓库访问失败时，
才会进入网络兜底流程：

1. 提示输入 Docker Hub 镜像加速地址。
2. 提示临时修改 `/etc/docker/daemon.json` 并重启 Docker 的风险。
3. 只有用户输入 `yes` 后才会临时配置镜像源并重启 Docker。
4. 镜像下载完成后，脚本恢复原来的 Docker daemon 配置并再次重启 Docker。

如果用户不输入 `yes`，脚本不会重启 Docker，也不会自动修改 Docker daemon 配置。

## Docker 重启影响

重启 Docker 会短暂影响同一台服务器上的其他 Docker 容器，例如 1Panel、数据库、
反向代理或其他业务服务。因此脚本默认不自动重启 Docker，必须由交互式终端确认。

非交互部署如确实需要预授权，可以在 `.env` 中设置：

```env
DOCKER_REGISTRY_MIRRORS="https://<your-mirror>"
DOCKER_TEMP_MIRROR_RESTART_DOCKER=true
```

普通用户部署不需要提前设置，脚本会在 Docker Hub 下载失败后现场询问。

## 非破坏性验证

同步脚本后，可以先执行以下检查。这些命令不会重启 Docker，也不会打印 `.env` 明文：

```bash
cd /opt/stardew-valley-server-kit
chmod +x setup.sh scripts/sdv-server.sh
./setup.sh doctor
docker compose --env-file .env config --quiet
```

如果需要检查 Steam 配置是否存在，只使用状态检查：

```bash
./setup.sh check-env
```

输出只显示 `set` 或 `missing`，不会显示账号密码内容。

## Steam 与 SteamCMD

首次部署仍然需要 Steam 账号拥有 Stardew Valley。账号密码放在 `.env` 中，由服务器上的
脚本传给 `steam-auth` 或 SteamCMD 容器使用。

如果 `steam-auth` 报：

```text
The SteamClient instance must be connected
```

这通常不是密码错误，而是 SteamClient 链路没有连接成功。脚本会回退到 SteamCMD。
SteamCMD 的镜像 `cm2network/steamcmd:latest` 也会走同一套 Docker Hub 失败兜底逻辑。

## 哔站文章二维码

文章可引用仓库里的赞赏二维码：

![微信赞赏码](assets/donation/weixin.png)

![支付宝收款码](assets/donation/zhifubao.jpg)
