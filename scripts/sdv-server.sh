#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-setup}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE_FILE="$ROOT_DIR/.env.example"
BUILD_COMPOSE_FILE="${SVSK_BUILD_COMPOSE_FILE:-$ROOT_DIR/docker-compose.build.yml}"
BUILD_COMPOSE_EXAMPLE_FILE="$ROOT_DIR/docker-compose.build.yml.example"
BACKUP_DIR="$ROOT_DIR/backups"
SYSTEMD_SERVICE_NAME="sdv-admin.service"
STABLE_VNC_PARAMS='-AcceptPointerEvents=1 -AcceptKeyEvents=1 -AcceptSetDesktopSize=1 -AlwaysShared=1 -DisconnectClients=0'

step() {
  printf '\n==> %s\n' "$1"
}

ok() {
  printf 'OK  %s\n' "$1"
}

warn() {
  printf 'WARN %s\n' "$1"
}

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

docker_output_suggests_daemon_unavailable() {
  local output="$1"
  printf '%s' "$output" | grep -Eiq 'cannot connect to the docker daemon|is the docker daemon running|dockerDesktopLinuxEngine|docker_engine|error during connect|failed to connect to .*docker|open (//|\.\./|\\\\\.)?/?\.?/pipe/docker|The system cannot find the file specified|no such file or directory.*docker\.sock|permission denied.*docker\.sock'
}

docker_output_suggests_registry_unreachable() {
  local output="$1"
  printf '%s' "$output" | grep -Eiq 'registry-1\.docker\.io|auth\.docker\.io|docker\.io|request canceled|Client\.Timeout exceeded|context deadline exceeded|i/o timeout|TLS handshake timeout|connection timed out|timed out after|network is unreachable|no route to host|temporary failure in name resolution|could not resolve|proxyconnect tcp|connection refused|connection reset by peer|failed to fetch anonymous token|failed to authorize'
}

docker_output_suggests_image_unavailable() {
  local output="$1"
  printf '%s' "$output" | grep -Eiq 'manifest unknown|manifest for .* not found|not found: manifest unknown|pull access denied|repository does not exist|insufficient_scope|denied: requested access|no matching manifest|not found'
}

docker_daemon_available() {
  docker info >/dev/null 2>&1
}

require_docker_cli() {
  command -v docker >/dev/null 2>&1 || die "未找到 docker 命令。请先安装 Docker Desktop/Docker Engine，并确认 docker 已加入 PATH。"
}

require_docker_compose() {
  local output
  if ! output="$(docker compose version 2>&1)"; then
    warn "Docker Compose 不可用，脚本无法解析或启动服务。"
    warn "请安装包含 Compose v2 的 Docker Desktop，或安装 Docker Compose plugin。"
    print_docker_debug_hint "$output"
    die "Docker Compose 检查失败。"
  fi
  printf '%s\n' "$output"
}

print_docker_debug_hint() {
  local output="$1"
  if [[ "${SVSK_DEBUG_DOCKER:-0}" == "1" ]]; then
    printf '%s\n' "$output" >&2
  else
    warn "如需查看 Docker 原始输出，请设置 SVSK_DEBUG_DOCKER=1 后重试。"
  fi
}

print_docker_daemon_help() {
  warn "Docker Engine/daemon 未运行，或当前终端无法连接到 Docker。"
  warn "Windows/macOS：启动 Docker Desktop，等待 Engine 显示 Running 后再重试。"
  warn "Windows：请确认 Docker Desktop 使用 Linux containers。"
  warn "PowerShell 可验证：Test-Path \\\\.\\pipe\\dockerDesktopLinuxEngine"
  warn "Linux：可尝试 sudo systemctl start docker；若是权限问题，将当前用户加入 docker 组后重新登录。"
  warn "WSL：在 Docker Desktop Settings -> Resources -> WSL integration 中启用当前发行版。"
}

configured_image_namespace() {
  local image_namespace="sdvd"
  local configured_namespace
  if [[ -f "$ENV_FILE" ]]; then
    configured_namespace="$(get_env_value IMAGE_NAMESPACE || true)"
    [[ -z "$configured_namespace" ]] || image_namespace="$configured_namespace"
  fi
  printf '%s' "$image_namespace"
}

configured_image_version() {
  local image_version="preview"
  local configured_version
  if [[ -f "$ENV_FILE" ]]; then
    configured_version="$(get_env_value IMAGE_VERSION || true)"
    [[ -z "$configured_version" ]] || image_version="$configured_version"
  fi
  printf '%s' "$image_version"
}

configured_image_refs() {
  local image_namespace
  local image_version
  image_namespace="$(configured_image_namespace)"
  image_version="$(configured_image_version)"
  printf '%s\n' \
    "$image_namespace/server:$image_version" \
    "$image_namespace/steam-service:$image_version" \
    "$image_namespace/discord-bot:$image_version"
}

first_configured_image_ref() {
  configured_image_refs | head -n 1
}

print_configured_image_help() {
  local image_namespace
  local image_version
  local image
  image_namespace="$(configured_image_namespace)"
  image_version="$(configured_image_version)"

  warn "当前镜像配置：IMAGE_NAMESPACE=$image_namespace，IMAGE_VERSION=$image_version。"
  warn "脚本会使用以下镜像标签："
  while IFS= read -r image; do
    printf '     - %s\n' "$image" >&2
  done < <(configured_image_refs)
}

explain_docker_failure() {
  local description="$1"
  local output="$2"
  local fatal="${3:-1}"
  local reason="Docker 命令失败"

  if docker_output_suggests_daemon_unavailable "$output" || ! docker_daemon_available; then
    reason="Docker daemon 不可用"
    print_docker_daemon_help
  elif docker_output_suggests_registry_unreachable "$output"; then
    reason="镜像仓库不可达"
    warn "Docker 无法访问 Docker Hub/镜像仓库，镜像拉取或远端标签检查没有完成。"
    print_configured_image_help
    warn "请检查网络、DNS、代理、防火墙，以及 Docker Desktop/daemon 的代理或镜像加速器配置。"
    warn "需要能访问 registry-1.docker.io 和 auth.docker.io；使用私有仓库时请确认对应 registry 可达。"
    warn "网络恢复后重试当前命令；如果本地已有镜像，可先运行 start，或使用 build-start 从本地构建。"
  elif docker_output_suggests_image_unavailable "$output"; then
    reason="镜像标签不可拉取"
    warn "当前镜像标签无法拉取。常见原因是默认 preview 标签尚未发布、.env 中 IMAGE_VERSION/IMAGE_NAMESPACE 写错，或仓库不可访问。"
    print_configured_image_help
    warn "请检查 .env 中的 IMAGE_NAMESPACE 和 IMAGE_VERSION，并以发布说明中的镜像标签为准。"
    warn "可手动验证：docker manifest inspect $(first_configured_image_ref)"
    warn "如果本地包包含源码和 Dockerfile，也可以改用 build-setup/build-start 从本地构建。"
  else
    warn "$description 失败，但脚本未识别出明确原因。"
    warn "请先运行 ./scripts/sdv-server.sh doctor 获取 Docker、Compose 和镜像状态。"
  fi

  print_docker_debug_hint "$output"
  [[ "$fatal" == "1" ]] && die "$description 失败：$reason。"
  return 1
}

require_docker_daemon() {
  local output
  if ! output="$(docker info 2>&1)"; then
    explain_docker_failure "Docker 检查" "$output" 1
  fi
}

require_docker() {
  require_docker_cli
  require_docker_daemon
}

run_docker_command_or_die() {
  local description="$1"
  shift
  local output
  local status

  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e

  if (( status == 0 )); then
    [[ -z "$output" ]] || printf '%s\n' "$output"
    return 0
  fi

  explain_docker_failure "$description" "$output" 1
}

run_with_optional_timeout() {
  local seconds="$1"
  shift

  if command -v timeout >/dev/null 2>&1 && timeout --version >/dev/null 2>&1; then
    timeout "$seconds" "$@"
  else
    "$@"
  fi
}

docker_pull_timeout_seconds() {
  local seconds="${DOCKER_PULL_TIMEOUT_SECONDS:-}"
  if [[ -z "$seconds" ]]; then
    seconds="$(get_env_value DOCKER_PULL_TIMEOUT_SECONDS || true)"
  fi

  if [[ "$seconds" =~ ^[0-9]+$ ]]; then
    printf '%s' "$seconds"
  else
    printf '0'
  fi
}

docker_registry_mirrors_raw() {
  local mirrors="${SVSK_RUNTIME_DOCKER_REGISTRY_MIRRORS:-${DOCKER_REGISTRY_MIRRORS:-}}"
  if [[ -z "$mirrors" ]]; then
    mirrors="$(get_env_value DOCKER_REGISTRY_MIRRORS || true)"
  fi
  printf '%s' "$mirrors"
}

docker_registry_mirrors_json() {
  local raw
  raw="$(docker_registry_mirrors_raw)"
  [[ -n "$raw" ]] || return 1
  command -v python3 >/dev/null 2>&1 || return 1

  SVSK_DOCKER_REGISTRY_MIRRORS_RAW="$raw" python3 - <<'PY'
import json
import os
import re
import sys

raw = os.environ.get("SVSK_DOCKER_REGISTRY_MIRRORS_RAW", "")
mirrors = []
for item in re.split(r"[\s,;]+", raw):
    item = item.strip().rstrip("/")
    if not item:
        continue
    if not re.match(r"^https?://", item):
        continue
    if item not in mirrors:
        mirrors.append(item)

if not mirrors:
    sys.exit(1)

print(json.dumps(mirrors, ensure_ascii=False))
PY
}

docker_registry_mirrors_configured() {
  docker_registry_mirrors_json >/dev/null 2>&1
}

truthy_value() {
  case "${1,,}" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

docker_temp_mirror_restart_allowed() {
  local value="${SVSK_ALLOW_TEMP_DOCKER_MIRROR_RESTART:-${DOCKER_TEMP_MIRROR_RESTART_DOCKER:-}}"
  if [[ -z "$value" ]]; then
    value="$(get_env_value DOCKER_TEMP_MIRROR_RESTART_DOCKER || true)"
  fi
  truthy_value "$value"
}

interactive_terminal() {
  [[ -t 0 && -t 1 ]]
}

compose_run_login() {
  if interactive_terminal; then
    compose run --rm -it steam-auth login
  else
    warn "No interactive terminal detected; steam-auth login will run without TTY."
    warn "Automatically selecting username/password authentication for non-interactive runs."
    warn "If Steam Guard is requested, rerun this command from an SSH session with a TTY."
    printf '1\n' | compose run --rm -T steam-auth login
  fi
}

prompt_for_docker_registry_mirrors_if_missing() {
  local mirrors

  docker_registry_mirrors_configured && return 0
  interactive_terminal || return 1

  warn "Docker Hub 当前不可达，且 .env 里还没有配置 DOCKER_REGISTRY_MIRRORS。"
  warn "可以现在输入 Docker Hub 镜像加速地址；多个地址用英文逗号或空格分隔。"
  warn "直接回车表示跳过自动配置，脚本会保留原来的 Docker 配置。"
  printf 'Docker Hub 镜像加速地址：'
  IFS= read -r mirrors || return 1
  mirrors="${mirrors#"${mirrors%%[![:space:]]*}"}"
  mirrors="${mirrors%"${mirrors##*[![:space:]]}"}"
  [[ -n "$mirrors" ]] || return 1

  SVSK_RUNTIME_DOCKER_REGISTRY_MIRRORS="$mirrors"
  export SVSK_RUNTIME_DOCKER_REGISTRY_MIRRORS
  docker_registry_mirrors_json >/dev/null 2>&1 || {
    warn "没有识别到有效的 http/https 镜像加速地址。"
    return 1
  }
}

prompt_for_temporary_docker_restart_if_needed() {
  local answer

  docker_temp_mirror_restart_allowed && return 0
  interactive_terminal || return 1

  warn "脚本可以临时修改 /etc/docker/daemon.json，配置镜像加速地址后重启 Docker。"
  warn "重试下载前会重启一次 Docker，下载完成恢复原配置时还会再重启一次。"
  warn "这会短暂影响同一台服务器上的其他 Docker 容器。"
  printf '如果允许临时重启 Docker，请输入 yes：'
  IFS= read -r answer || return 1
  case "$answer" in
    yes|YES|Yes)
      SVSK_ALLOW_TEMP_DOCKER_MIRROR_RESTART=true
      export SVSK_ALLOW_TEMP_DOCKER_MIRROR_RESTART
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

prepare_temporary_docker_mirror_retry() {
  prompt_for_docker_registry_mirrors_if_missing || true
  docker_registry_mirrors_configured || {
    warn "没有可用的 Docker Hub 镜像加速地址，跳过自动重试。"
    return 1
  }

  prompt_for_temporary_docker_restart_if_needed || {
    warn "用户没有允许临时重启 Docker，跳过镜像源自动重试。"
    return 1
  }

  return 0
}

SVSK_TEMP_DOCKER_MIRROR_ACTIVE=0
SVSK_TEMP_DOCKER_DAEMON_JSON=""
SVSK_TEMP_DOCKER_DAEMON_BACKUP=""
SVSK_TEMP_DOCKER_DAEMON_HAD_CONFIG=0

wait_for_docker_daemon_after_restart() {
  local attempt
  for attempt in $(seq 1 30); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

restart_docker_daemon_for_mirror_change() {
  systemctl restart docker || return 1
  wait_for_docker_daemon_after_restart
}

restore_temporary_docker_registry_mirrors() {
  if [[ "$SVSK_TEMP_DOCKER_MIRROR_ACTIVE" != "1" ]]; then
    return 0
  fi

  step "恢复 Docker 镜像源配置"
  if [[ "$SVSK_TEMP_DOCKER_DAEMON_HAD_CONFIG" == "1" ]]; then
    cp "$SVSK_TEMP_DOCKER_DAEMON_BACKUP" "$SVSK_TEMP_DOCKER_DAEMON_JSON"
  else
    rm -f "$SVSK_TEMP_DOCKER_DAEMON_JSON"
  fi

  if restart_docker_daemon_for_mirror_change; then
    ok "Docker 镜像源配置已恢复"
  else
    warn "恢复镜像源配置后重启 Docker 失败，请检查：systemctl status docker"
  fi

  rm -f "$SVSK_TEMP_DOCKER_DAEMON_BACKUP"
  SVSK_TEMP_DOCKER_MIRROR_ACTIVE=0
}

enable_temporary_docker_registry_mirrors() {
  local mirrors_json
  local daemon_json="/etc/docker/daemon.json"
  local backup_file

  docker_registry_mirrors_configured || return 1
  if ! docker_temp_mirror_restart_allowed; then
    warn "已配置 DOCKER_REGISTRY_MIRRORS，但未允许脚本临时重启 Docker。"
    warn "非交互部署如需预授权，可设置 DOCKER_TEMP_MIRROR_RESTART_DOCKER=true。"
    warn "同机有其他 Docker 服务且不能短暂停顿时，请保持 false。"
    return 1
  fi

  mirrors_json="$(docker_registry_mirrors_json)" || {
    warn "DOCKER_REGISTRY_MIRRORS 已设置，但没有有效的 http/https 镜像加速地址。"
    return 1
  }

  if [[ "$(uname -s)" != "Linux" ]]; then
    warn "临时配置 Docker 镜像源只支持 Linux。"
    return 1
  fi

  if ! command -v systemctl >/dev/null 2>&1 || [[ ! -d /run/systemd/system ]]; then
    warn "临时配置 Docker 镜像源需要 systemd。"
    return 1
  fi

  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    warn "临时配置 Docker 镜像源需要 root 权限，因为要修改 Docker daemon 配置。"
    return 1
  fi

  command -v python3 >/dev/null 2>&1 || {
    warn "需要 python3 才能安全修改 /etc/docker/daemon.json。"
    return 1
  }

  backup_file="$(mktemp /tmp/svsk-docker-daemon.XXXXXX.json)"
  mkdir -p "$(dirname "$daemon_json")"
  if [[ -f "$daemon_json" ]]; then
    cp "$daemon_json" "$backup_file"
    SVSK_TEMP_DOCKER_DAEMON_HAD_CONFIG=1
  else
    : > "$backup_file"
    SVSK_TEMP_DOCKER_DAEMON_HAD_CONFIG=0
  fi

  SVSK_TEMP_DOCKER_DAEMON_JSON="$daemon_json"
  SVSK_TEMP_DOCKER_DAEMON_BACKUP="$backup_file"

  python3 - "$daemon_json" "$mirrors_json" <<'PY' || {
import json
import os
import sys

path = sys.argv[1]
mirrors = json.loads(sys.argv[2])
data = {}

if os.path.exists(path):
    text = open(path, "r", encoding="utf-8").read().strip()
    if text:
        data = json.loads(text)

data["registry-mirrors"] = mirrors
tmp = path + ".svsk.tmp"
with open(tmp, "w", encoding="utf-8") as handle:
    json.dump(data, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
os.replace(tmp, path)
PY
    warn "写入临时 Docker 镜像源配置失败。"
    rm -f "$backup_file"
    return 1
  }

  SVSK_TEMP_DOCKER_MIRROR_ACTIVE=1
  trap restore_temporary_docker_registry_mirrors EXIT

  step "启用临时 Docker 镜像源"
  warn "Docker daemon 会先重启，镜像下载完成后脚本会恢复原配置。"
  warn "这会短暂影响同机其他 Docker 容器。"
  if restart_docker_daemon_for_mirror_change; then
    ok "临时 Docker 镜像源已启用"
    return 0
  fi

  warn "启用临时镜像源后重启 Docker 失败。"
  restore_temporary_docker_registry_mirrors
  return 1
}

capture_command_output() {
  local timeout_seconds="$1"
  shift
  local output
  local status

  set +e
  if [[ "$timeout_seconds" =~ ^[0-9]+$ ]] && (( timeout_seconds > 0 )) && command -v timeout >/dev/null 2>&1; then
    output="$(timeout "$timeout_seconds" "$@" 2>&1)"
    status=$?
    if (( status == 124 )); then
      output="Command timed out after ${timeout_seconds}s: $*"$'\n'"$output"
    fi
  else
    output="$("$@" 2>&1)"
    status=$?
  fi
  set -e

  SVSK_CAPTURED_OUTPUT="$output"
  return "$status"
}

run_docker_registry_command_or_die() {
  local description="$1"
  local timeout_seconds="$2"
  shift 2
  local output
  local retry_output

  if capture_command_output "$timeout_seconds" "$@"; then
    output="$SVSK_CAPTURED_OUTPUT"
    [[ -z "$output" ]] || printf '%s\n' "$output"
    return 0
  fi

  output="$SVSK_CAPTURED_OUTPUT"
  if docker_output_suggests_daemon_unavailable "$output" || ! docker_daemon_available; then
    explain_docker_failure "$description" "$output" 1
  fi

  if docker_output_suggests_registry_unreachable "$output"; then
    warn "$description 失败：Docker Hub/镜像仓库不可达。"
    if ! prepare_temporary_docker_mirror_retry; then
      explain_docker_failure "$description" "$output" 1
    fi

    warn "已确认允许临时配置镜像源，开始重试下载。"
    if enable_temporary_docker_registry_mirrors; then
      if capture_command_output "$timeout_seconds" "$@"; then
        retry_output="$SVSK_CAPTURED_OUTPUT"
        [[ -z "$retry_output" ]] || printf '%s\n' "$retry_output"
        restore_temporary_docker_registry_mirrors
        return 0
      fi

      retry_output="$SVSK_CAPTURED_OUTPUT"
      restore_temporary_docker_registry_mirrors
      explain_docker_failure "$description" "$retry_output" 1
    fi
  fi

  if docker_output_suggests_image_unavailable "$output"; then
    explain_docker_failure "$description" "$output" 1
  fi

  explain_docker_failure "$description" "$output" 1
}

compose() {
  (cd "$ROOT_DIR" && docker compose --env-file "$ENV_FILE" "$@")
}

compose_example() {
  (cd "$ROOT_DIR" && docker compose --env-file "$ENV_EXAMPLE_FILE" "$@")
}

compose_checked() {
  local description="$1"
  shift
  run_docker_command_or_die "$description" compose "$@"
}

compose_pull_checked() {
  local description="$1"
  local timeout_seconds
  timeout_seconds="$(docker_pull_timeout_seconds)"
  (cd "$ROOT_DIR" && run_docker_registry_command_or_die "$description" "$timeout_seconds" docker compose --env-file "$ENV_FILE" pull)
}

compose_example_checked() {
  local description="$1"
  shift
  run_docker_command_or_die "$description" compose_example "$@"
}

ensure_docker_image() {
  local image="$1"
  local timeout_seconds

  if docker image inspect "$image" >/dev/null 2>&1; then
    return 0
  fi

  timeout_seconds="$(docker_pull_timeout_seconds)"
  step "Pulling Docker helper image: $image"
  run_docker_registry_command_or_die "Pulling Docker helper image $image" "$timeout_seconds" docker pull "$image"
}

check_remote_image_manifest() {
  local image="$1"
  local output
  local status

  set +e
  output="$(run_with_optional_timeout 20 docker manifest inspect "$image" 2>&1)"
  status=$?
  set -e

  if (( status == 0 )); then
    ok "Remote image tag available: $image"
    return 0
  fi

  if (( status == 124 )); then
    output="Docker manifest inspect timed out after 20 seconds for $image. $output"
  fi

  explain_docker_failure "远端镜像检查 $image" "$output" 0
  return 1
}

check_configured_images() {
  local image
  local missing_local=0
  local remote_failed=0

  while IFS= read -r image; do
    if docker image inspect "$image" >/dev/null 2>&1; then
      ok "Image available locally: $image"
    else
      missing_local=1
      warn "本地未找到镜像：$image"
    fi
  done < <(configured_image_refs)

  if (( missing_local == 0 )); then
    return 0
  fi

  step "Checking remote image tags"
  warn "以下检查只访问镜像仓库元数据，不会触发 Steam 登录或下载游戏文件。"
  while IFS= read -r image; do
    if ! docker image inspect "$image" >/dev/null 2>&1; then
      check_remote_image_manifest "$image" || remote_failed=1
    fi
  done < <(configured_image_refs)

  if (( remote_failed != 0 )); then
    warn "至少有一个远端镜像标签检查失败。setup/update 可能无法拉取镜像。"
    return 1
  fi

  warn "远端镜像标签存在，但本地还没有镜像。运行 setup 或 update 会执行拉取。"
  return 0
}

ensure_build_compose_file() {
  if [[ -f "$BUILD_COMPOSE_FILE" ]]; then
    return
  fi

  [[ -f "$BUILD_COMPOSE_EXAMPLE_FILE" ]] || die "Local build compose file not found: ${BUILD_COMPOSE_FILE#$ROOT_DIR/}. Add docker-compose.build.yml with build.context paths for local builds."
  cp "$BUILD_COMPOSE_EXAMPLE_FILE" "$BUILD_COMPOSE_FILE"
  warn "Created docker-compose.build.yml from docker-compose.build.yml.example."
  warn "If this package does not include ./server and ./steam-service Dockerfiles, edit docker-compose.build.yml before retrying."
}

compose_build() {
  ensure_build_compose_file
  (cd "$ROOT_DIR" && docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" -f "$BUILD_COMPOSE_FILE" "$@")
}

build_compose_config_json() {
  ensure_build_compose_file
  if [[ "${ENABLE_DISCORD:-0}" == "1" ]]; then
    (cd "$ROOT_DIR" && docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" -f "$BUILD_COMPOSE_FILE" --profile discord config --format json)
  else
    (cd "$ROOT_DIR" && docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" -f "$BUILD_COMPOSE_FILE" config --format json)
  fi
}

validate_build_contexts() {
  local config_json
  config_json="$(build_compose_config_json)"

  if command -v python3 >/dev/null 2>&1; then
    local validation_output
    if ! validation_output="$(printf '%s' "$config_json" | python3 -c '
import json
import os
import sys

data = json.load(sys.stdin)
missing = []
for name, service in sorted(data.get("services", {}).items()):
    build = service.get("build")
    if not build:
        continue
    context = build.get("context")
    if not context:
        missing.append(f"{name}: build.context is missing")
        continue
    dockerfile = build.get("dockerfile") or "Dockerfile"
    dockerfile_path = dockerfile if os.path.isabs(dockerfile) else os.path.join(context, dockerfile)
    if not os.path.isdir(context):
        missing.append(f"{name}: build context not found: {context}")
    elif not os.path.isfile(dockerfile_path):
        missing.append(f"{name}: Dockerfile not found: {dockerfile_path}")

if missing:
    print("Missing local Docker build inputs:")
    for item in missing:
        print(f" - {item}")
    print("Fix docker-compose.build.yml or copy the source/Dockerfile directories into this package.")
    sys.exit(1)
')"; then
      printf '%s\n' "$validation_output" >&2
      die "Local build inputs are incomplete."
    fi
    return
  fi

  warn "python3 not found; skipping local Dockerfile preflight check."
}

show_steamcmd_fallback_hint() {
  warn "steam-auth uses the SteamClient/SteamKit login path; SteamCMD uses Valve's official console client path."
  warn "Docker registry mirrors only fix Docker image pulls; they do not fix SteamClient or SteamCMD connectivity."
  warn "If SteamCMD asks for a Steam Guard code, type the newest code into this terminal and press Enter."
  warn "Do not paste Steam passwords, Steam Guard codes, or tokens into chat, issues, or screenshots."
}

steam_network_probe_url() {
  printf '%s' 'https://api.steampowered.com/ISteamDirectory/GetCMList/v1/?cellid=0&format=json'
}

steam_proxy_value() {
  local key="$1"
  local fallback_key="${2:-}"
  local value=""

  value="${!key:-}"
  [[ -n "$value" ]] || value="$(get_env_value "$key" || true)"
  if [[ -z "$value" && -n "$fallback_key" ]]; then
    value="${!fallback_key:-}"
    [[ -n "$value" ]] || value="$(get_env_value "$fallback_key" || true)"
  fi

  printf '%s' "$value"
}

steam_proxy_configured() {
  local key
  for key in HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy; do
    [[ -n "$(steam_proxy_value "$key")" ]] && return 0
  done
  return 1
}

STEAM_PROXY_DOCKER_ARGS=()

load_steam_proxy_docker_args() {
  local key value

  STEAM_PROXY_DOCKER_ARGS=()

  for key in HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY; do
    value="$(steam_proxy_value "$key")"
    [[ -z "$value" ]] || STEAM_PROXY_DOCKER_ARGS+=(-e "$key=$value")
  done

  value="$(steam_proxy_value http_proxy HTTP_PROXY)"
  [[ -z "$value" ]] || STEAM_PROXY_DOCKER_ARGS+=(-e "http_proxy=$value")
  value="$(steam_proxy_value https_proxy HTTPS_PROXY)"
  [[ -z "$value" ]] || STEAM_PROXY_DOCKER_ARGS+=(-e "https_proxy=$value")
  value="$(steam_proxy_value all_proxy ALL_PROXY)"
  [[ -z "$value" ]] || STEAM_PROXY_DOCKER_ARGS+=(-e "all_proxy=$value")
  value="$(steam_proxy_value no_proxy NO_PROXY)"
  [[ -z "$value" ]] || STEAM_PROXY_DOCKER_ARGS+=(-e "no_proxy=$value")
}

show_steam_network_help() {
  warn "Steam Directory API is not reachable from this host. SteamClient may fail before Steam Guard."
  warn "This is a Steam network path issue, not a Steam username spelling issue."
  warn "Docker Hub mirror settings do not affect api.steampowered.com or Steam CM servers."
  warn "If this server cannot reach Steam directly, set HTTP_PROXY/HTTPS_PROXY/ALL_PROXY in .env and retry."
}

steam_network_check_retries() {
  local retries="${STEAM_NETWORK_CHECK_RETRIES:-}"
  if [[ -z "$retries" ]]; then
    retries="$(get_env_value STEAM_NETWORK_CHECK_RETRIES || true)"
  fi

  if [[ "$retries" =~ ^[0-9]+$ ]] && (( retries > 0 )); then
    printf '%s' "$retries"
  else
    printf '3'
  fi
}

check_steam_network_connectivity() {
  local url output status attempt retries
  url="$(steam_network_probe_url)"
  retries="$(steam_network_check_retries)"

  step "Checking Steam Directory API"
  for attempt in $(seq 1 "$retries"); do
    if command -v curl >/dev/null 2>&1; then
      set +e
      output="$(curl -fsSL --connect-timeout 5 --max-time 15 "$url" -o /dev/null 2>&1)"
      status=$?
      set -e
      if (( status == 0 )); then
        ok "Steam Directory API reachable"
        return 0
      fi
      warn "Steam Directory API probe failed on attempt $attempt/$retries: ${output:-curl exit $status}"
    elif command -v python3 >/dev/null 2>&1; then
      set +e
      output="$(SVSK_STEAM_PROBE_URL="$url" python3 - <<'PY' 2>&1
import os
import urllib.request

url = os.environ["SVSK_STEAM_PROBE_URL"]
with urllib.request.urlopen(url, timeout=15) as response:
    response.read(1)
PY
)"
      status=$?
      set -e
      if (( status == 0 )); then
        ok "Steam Directory API reachable"
        return 0
      fi
      warn "Steam Directory API probe failed on attempt $attempt/$retries: ${output:-python3 exit $status}"
    else
      warn "curl/python3 not found; skipping Steam Directory API probe."
      return 0
    fi

    if (( attempt < retries )); then
      sleep 3
    fi
  done

  show_steam_network_help
  return 1
}

steam_network_probe_http_url() {
  local url="$1"
  local label="$2"
  local output status

  printf -- '-- %s\n' "$label"
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl not found; skipping HTTPS probe for $label."
    return 0
  fi

  set +e
  output="$(curl -4 -L -o /dev/null -sS -w 'http=%{http_code} connect=%{time_connect} tls=%{time_appconnect} total=%{time_total} remote=%{remote_ip} err=%{errormsg}\n' --connect-timeout 5 --max-time 15 "$url" 2>&1)"
  status=$?
  set -e

  printf '%s\n' "$output"
  if (( status == 0 )); then
    ok "$label reachable over HTTPS"
    return 0
  fi

  warn "$label HTTPS probe failed"
  return 1
}

steam_network_probe_tcp() {
  local host="$1"
  local port="$2"

  printf '%s:%s ' "$host" "$port"
  if run_with_optional_timeout 6 bash -lc "cat < /dev/null > /dev/tcp/$host/$port" >/dev/null 2>&1; then
    printf 'ok\n'
    return 0
  fi

  printf 'fail\n'
  return 1
}

steam_network_probe_steamcmd_anonymous() {
  local image="cm2network/steamcmd:latest"
  local steamcmd_probe_volume="stardew-valley-server-kit_steamcmd-net-test"
  local timeout_seconds="${SVSK_STEAMCMD_NETWORK_TEST_TIMEOUT:-240}"
  local output_file status

  step "Checking SteamCMD anonymous login"
  warn "This uses anonymous login only. It does not read Steam credentials from .env."
  load_steam_proxy_docker_args
  if steam_proxy_configured; then
    ok "Steam proxy variables are configured; values are not printed"
  fi

  ensure_docker_image "$image"
  docker run --rm --user 0:0 \
    -v "$steamcmd_probe_volume:/home/steam/Steam" \
    --entrypoint bash \
    "$image" -lc 'mkdir -p /home/steam/Steam && chown -R steam:steam /home/steam/Steam' >/dev/null

  output_file="$(mktemp "${TMPDIR:-/tmp}/svsk-steamcmd-network.XXXXXX.log")"
  set +e
  run_with_optional_timeout "$timeout_seconds" docker run --rm \
    "${STEAM_PROXY_DOCKER_ARGS[@]}" \
    -v "$steamcmd_probe_volume:/home/steam/Steam" \
    "$image" \
    bash -lc '/home/steam/steamcmd/steamcmd.sh +login anonymous +quit' 2>&1 | tee "$output_file"
  status="${PIPESTATUS[0]}"
  set -e

  if (( status == 0 )) && grep -Eiq 'Connecting anonymously to Steam Public|Waiting for user info' "$output_file"; then
    rm -f "$output_file"
    ok "SteamCMD anonymous login reached Steam Public"
    return 0
  fi

  if (( status == 124 )); then
    warn "SteamCMD anonymous login timed out after ${timeout_seconds}s"
  else
    warn "SteamCMD anonymous login failed with exit code $status"
  fi
  warn "If this fails while Docker image pulls work, the server needs a Steam-capable network path or proxy."
  rm -f "$output_file"
  return 1
}

steam_network_diagnostics() {
  local host port
  local failed=0

  step "Checking Steam DNS"
  for host in api.steampowered.com store.steampowered.com steamcommunity.com cm0.steampowered.com cm1.steampowered.com steamcdn-a.akamaihd.net; do
    printf -- '-- %s\n' "$host"
    if command -v getent >/dev/null 2>&1; then
      getent ahostsv4 "$host" | awk '{print $1}' | sort -u | head -n 8 || true
    elif command -v nslookup >/dev/null 2>&1; then
      nslookup "$host" | sed -n '1,12p' || true
    else
      warn "No getent/nslookup available for DNS probe."
      break
    fi
  done

  step "Checking Steam HTTPS endpoints"
  steam_network_probe_http_url "https://store.steampowered.com/" "Steam Store" || failed=1
  steam_network_probe_http_url "https://steamcommunity.com/" "Steam Community" || failed=1
  steam_network_probe_http_url "$(steam_network_probe_url)" "Steam Directory API" || failed=1

  step "Checking Steam CM TCP endpoints"
  for host in cm0.steampowered.com cm1.steampowered.com 162.254.193.6 162.254.195.44; do
    for port in 443 27017 27018 27019 27020; do
      steam_network_probe_tcp "$host" "$port" || failed=1
    done
  done

  steam_network_probe_steamcmd_anonymous || failed=1

  if (( failed == 0 )); then
    ok "Steam public network diagnostics passed"
    return 0
  fi

  warn "Steam public network diagnostics found at least one blocked or unstable endpoint."
  warn "If SteamCMD anonymous login succeeds but steam-auth still fails, use steamcmd-download from an SSH TTY for Steam Guard."
  return 1
}

steamcmd_output_requires_interactive_guard() {
  local output_file="$1"
  grep -Eiq 'Steam Guard code|This computer has not been authenticated|set_steam_guard_code' "$output_file"
}

steamcmd_redact_line() {
  local line="$1"
  shift || true

  local secret
  for secret in "$@"; do
    [[ -z "$secret" ]] && continue
    line="${line//"$secret"/<redacted>}"
  done

  printf '%s\n' "$line"
}

steamcmd_stream_to_log() {
  local log_file="$1"
  shift || true

  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    steamcmd_redact_line "$line" "$@"
  done | tee "$log_file"
}

prompt_steam_guard_code() {
  local guard_code

  interactive_terminal || return 1
  printf '\nWARN SteamCMD requested Steam Guard verification.\n' >&2
  printf 'WARN Enter the newest code from email or Steam Mobile. Input is hidden and will not be saved or printed.\n' >&2
  printf 'Steam Guard code: ' >&2
  IFS= read -r -s guard_code || return 1
  printf '\n' >&2

  guard_code="${guard_code//$'\r'/}"
  guard_code="${guard_code#"${guard_code%%[![:space:]]*}"}"
  guard_code="${guard_code%"${guard_code##*[![:space:]]}"}"
  [[ -n "$guard_code" ]] || return 1

  printf '%s' "$guard_code"
}

new_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
  else
    date +%s%N | sha256sum | awk '{print $1}'
  fi
}

require_linux_systemd() {
  [[ "$(uname -s)" == "Linux" ]] || die "systemd admin service is only supported on Linux."
  command -v systemctl >/dev/null 2>&1 || die "Command not found: systemctl. Use './scripts/sdv-server.sh admin' for a foreground admin panel."
  [[ -d /run/systemd/system ]] || die "systemd is not running. Use './scripts/sdv-server.sh admin' for a foreground admin panel."
}

require_linux_systemd_root() {
  require_linux_systemd
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Run this command as root, for example: sudo ./scripts/sdv-server.sh admin-service-install"
}

get_env_value() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  grep -E "^[[:space:]]*$key[[:space:]]*=" "$ENV_FILE" \
    | tr -d '\r' \
    | tail -n 1 \
    | sed -E 's/^[^=]+=//' \
    | sed -E 's/^["'\'']|["'\'']$//g'
}

set_env_value() {
  local key="$1"
  local value="$2"
  local escaped="${value//\\/\\\\}"
  escaped="${escaped//\"/\\\"}"

  if grep -Eq "^[[:space:]]*#?[[:space:]]*$key[[:space:]]*=" "$ENV_FILE"; then
    sed -i.bak -E "s|^[[:space:]]*#?[[:space:]]*$key[[:space:]]*=.*|$key=\"$escaped\"|" "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
  else
    printf '%s="%s"\n' "$key" "$escaped" >> "$ENV_FILE"
  fi
}

initialize_server_settings() {
  local settings_path="$ROOT_DIR/data/settings/server-settings.json"
  [[ -f "$settings_path" ]] && return 0

  cat >"$settings_path" <<'JSON'
{
  "Game": {
    "FarmName": "Junimo",
    "FarmType": 0,
    "ProfitMargin": 1.0,
    "StartingCabins": 1,
    "SpawnMonstersAtNight": "auto"
  },
  "Server": {
    "MaxPlayers": 10,
    "CabinStrategy": "CabinStack",
    "SeparateWallets": false,
    "ExistingCabinBehavior": "KeepExisting",
    "VerboseLogging": false,
    "AllowIpConnections": true,
    "LobbyMode": "Shared",
    "ActiveLobbyLayout": "default",
    "AdminSteamIds": []
  }
}
JSON
  ok "Created data/settings/server-settings.json with IP connections enabled"
}

ensure_env_file() {
  ensure_admin_env_file

  if [[ -z "$(get_env_value STEAM_USERNAME)" ]]; then
    read -r -p "Steam username (must own Stardew Valley; leave blank to edit .env later): " steam_username
    [[ -z "$steam_username" ]] || set_env_value STEAM_USERNAME "$steam_username"
  fi

  if [[ -z "$(get_env_value STEAM_PASSWORD)" ]]; then
    printf 'Steam password will be written to local .env. Leave blank if you prefer manual steam-auth setup.\n'
    read -r -s -p "Steam password (hidden input; optional): " steam_password
    printf '\n'
    [[ -z "$steam_password" ]] || set_env_value STEAM_PASSWORD "$steam_password"
  fi
}

ensure_admin_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
    ok "Created .env from .env.example"
  fi

  [[ -n "$(get_env_value VNC_PASSWORD)" ]] || set_env_value VNC_PASSWORD "$(new_secret)"
  [[ -n "$(get_env_value API_KEY)" ]] || set_env_value API_KEY "$(new_secret)"
  [[ -n "$(get_env_value ADMIN_TOKEN)" ]] || set_env_value ADMIN_TOKEN "$(new_secret)"

  mkdir -p "$ROOT_DIR/data/settings" "$ROOT_DIR/data/mods"
  initialize_server_settings
}

env_or_default() {
  local key="$1"
  local default_value="$2"
  local value
  value="$(get_env_value "$key" || true)"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
  else
    printf '%s' "$default_value"
  fi
}

show_access_info() {
  if [[ ! -f "$ENV_FILE" ]]; then
    warn ".env does not exist. Showing default local access URLs."
  fi

  local admin_host admin_port admin_url_host vnc_port api_port game_port query_port
  admin_host="$(env_or_default ADMIN_HOST 127.0.0.1)"
  admin_port="$(env_or_default ADMIN_PORT 8088)"
  admin_url_host="$admin_host"
  vnc_port="$(env_or_default VNC_PORT 5800)"
  api_port="$(env_or_default API_PORT 8080)"
  game_port="$(env_or_default GAME_PORT 24642)"
  query_port="$(env_or_default QUERY_PORT 27015)"

  step "Access URLs"
  if [[ "$admin_host" == "0.0.0.0" ]]; then
    printf 'Admin panel (local): http://127.0.0.1:%s\n' "$admin_port"
    printf 'Admin panel (public): http://<server-public-ip>:%s\n' "$admin_port"
  else
    printf 'Admin panel: http://%s:%s\n' "$admin_url_host" "$admin_port"
  fi
  printf 'noVNC:       http://127.0.0.1:%s\n' "$vnc_port"
  printf 'HTTP API:    http://127.0.0.1:%s\n' "$api_port"
  printf 'Game IP:     127.0.0.1\n'
  printf 'Game UDP:    %s\n' "$game_port"
  printf 'Query UDP:   %s\n' "$query_port"
  printf 'Admin command: ./scripts/sdv-server.sh admin\n'

  step "LAN IPv4 candidates"
  if ! list_lan_ipv4_addresses; then
    warn "No LAN IPv4 address found from local network adapters."
  fi
  warn "Players on another LAN device should use the real Ethernet/Wi-Fi IPv4 address."

  if [[ "$admin_host" == "0.0.0.0" ]]; then
    warn "ADMIN_HOST=0.0.0.0 listens on all interfaces and requires ADMIN_ALLOW_PUBLIC_HTTP=true."
    warn "Prefer ADMIN_HOST=127.0.0.1 behind a HTTPS reverse proxy."
  fi
  warn "VNC passwords, API keys, and admin tokens are stored in .env and are not printed here."
}

prompt_admin_panel_after_setup() {
  if ! command -v node >/dev/null 2>&1; then
    warn "Node.js was not found. Install Node.js, then run ./scripts/sdv-server.sh admin to start the web admin panel."
    return 0
  fi

  if [[ ! -t 0 || ! -t 1 ]]; then
    warn "Run ./scripts/sdv-server.sh admin later if you want to open the local web admin panel."
    return 0
  fi

  local answer
  step "Optional web admin panel"
  read -r -p "Start the local web admin panel now? This keeps this terminal open. [y/N]: " answer
  case "$answer" in
    y|Y|yes|YES)
      admin_panel
      ;;
    *)
      ok "Skipped admin panel. Run ./scripts/sdv-server.sh admin later when needed."
      ;;
  esac
}

test_tcp_port() {
  local host="$1"
  local port="$2"
  if command -v nc >/dev/null 2>&1; then
    nc -z "$host" "$port" >/dev/null 2>&1
  elif command -v timeout >/dev/null 2>&1; then
    timeout 3 bash -c "cat < /dev/null > /dev/tcp/$host/$port" >/dev/null 2>&1
  else
    bash -c "cat < /dev/null > /dev/tcp/$host/$port" >/dev/null 2>&1
  fi
}

test_udp_send() {
  local host="$1"
  local port="$2"
  if command -v nc >/dev/null 2>&1; then
    printf 'sdv-port-probe' | nc -u -w1 "$host" "$port" >/dev/null 2>&1
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$host" "$port" <<'PY'
import socket
import sys

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.sendto(b"sdv-port-probe", (sys.argv[1], int(sys.argv[2])))
sock.close()
PY
  else
    return 1
  fi
}

list_lan_ipv4_addresses() {
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show scope global up \
      | awk '{ split($4, a, "/"); if (a[1] != "127.0.0.1") print a[1] "  (" $2 ")" }'
  elif command -v ifconfig >/dev/null 2>&1; then
    ifconfig \
      | awk '
        /^[^[:space:]]/ { iface=$1; sub(":", "", iface) }
        /inet / && $2 != "127.0.0.1" { print $2 "  (" iface ")" }
      '
  fi
}

join_info() {
  if [[ ! -f "$ENV_FILE" ]]; then
    warn ".env does not exist. Showing default ports; run setup before starting the real server."
  fi

  local game_port query_port
  game_port="$(env_or_default GAME_PORT 24642)"
  query_port="$(env_or_default QUERY_PORT 27015)"

  step "Player join targets"
  printf 'Same machine: 127.0.0.1\n'
  printf 'Game UDP port: %s\n' "$game_port"
  printf 'Query UDP port: %s\n' "$query_port"
  printf '%s\n' 'In Stardew Valley, use Co-op -> Join LAN Game / Enter IP. Do not paste an invite code into the IP field.'

  step "LAN IPv4 candidates"
  if ! list_lan_ipv4_addresses; then
    warn "No LAN IPv4 address found from local network adapters."
  fi
  warn "For another device on the same LAN, use the real Ethernet/Wi-Fi adapter IP."
  warn "Do not use VM, WSL, Docker, or bridge adapter addresses for normal players."

  step "Docker published ports"
  docker port sdv-server 2>/dev/null || warn "sdv-server container was not found. Start the server before checking published ports."

  step "Local UDP probe"
  if test_udp_send 127.0.0.1 "$game_port"; then
    ok "Sent UDP probe to 127.0.0.1:$game_port"
  else
    warn "Could not send UDP probe to 127.0.0.1:$game_port; install nc or python3 for this probe."
  fi
  warn "UDP is connectionless; this proves the packet can be sent, not that Stardew accepted the game protocol."

  if [[ "$(docker inspect -f '{{.State.Running}}' sdv-server 2>/dev/null || true)" == "true" ]]; then
    step "Runtime server signals"
    docker exec sdv-server sh -lc "printf 'invite_code='; cat /tmp/invite-code.txt 2>/dev/null || printf 'n/a'; printf '\n'; ss -lunp 2>/dev/null | grep -E '(:24642|:27015)' || true; tail -n 120 /tmp/server-output.log 2>/dev/null | grep -E 'IP connections enabled|Invite code|Connected to game session|Network:|Healthcheck' | tail -n 20 || true" \
      | sed -E 's/\x1B\[[0-9;?]*[ -/]*[@-~]//g' \
      | grep -Ev "Connected to the docker container shell|Exit and run 'make cli'" || true
  else
    warn "sdv-server is not running. Start it before reading invite code and runtime logs."
  fi

  step "What to try next"
  printf '%s\n' '1. If the game client runs on this same machine, enter 127.0.0.1.'
  printf '%s\n' '2. If the game client runs on another LAN device, enter the Ethernet/Wi-Fi IPv4 shown above.'
  printf '%s\n' '3. If LAN IP still fails, run ./scripts/sdv-server.sh logs while joining and check whether a connection attempt appears.'
  printf '%s\n' '4. Invite codes use Steam/Galaxy P2P and can fail independently from IP direct connect.'
}

admin_panel() {
  local public_mode="${1:-0}"
  command -v node >/dev/null 2>&1 || die "Command not found: node. Please install Node.js first."

  local admin_host admin_port
  if [[ "$public_mode" == "1" ]]; then
    set_env_value ADMIN_HOST "0.0.0.0"
    set_env_value ADMIN_ALLOW_PUBLIC_HTTP "true"
    warn "ADMIN_HOST has been set to 0.0.0.0 for server access."
    warn "ADMIN_ALLOW_PUBLIC_HTTP=true was enabled for direct private-network access."
  fi

  admin_host="$(env_or_default ADMIN_HOST 127.0.0.1)"
  admin_port="$(env_or_default ADMIN_PORT 8088)"

  step "Starting admin panel"
  if [[ "$admin_host" == "0.0.0.0" ]]; then
    printf 'Open (local): http://127.0.0.1:%s\n' "$admin_port"
    printf 'Open (public): http://<server-public-ip>:%s\n' "$admin_port"
    warn "Allow TCP $admin_port in both 1Panel firewall and cloud security group."
    warn "Restrict TCP $admin_port to your own public IP whenever possible."
    warn "Prefer HTTPS reverse proxy with ADMIN_HOST=127.0.0.1 for public access."
  else
    printf 'Open: http://%s:%s\n' "$admin_host" "$admin_port"
  fi
  warn "Keep this terminal open while using the admin panel."
  warn "ADMIN_TOKEN is stored in .env and is not printed to logs."
  node "$ROOT_DIR/scripts/admin-panel.js"
}

admin_token_rotate() {
  ensure_admin_env_file

  local token
  token="$(new_secret)"
  set_env_value ADMIN_TOKEN "$token"

  step "Rotated admin token"
  ok "ADMIN_TOKEN has been updated in .env and is not printed to logs."
  warn "Existing browser sessions must log in again."

  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "$SYSTEMD_SERVICE_NAME" >/dev/null 2>&1; then
    warn "If the admin panel is running as a systemd service, restart it with: systemctl restart $SYSTEMD_SERVICE_NAME"
  fi
}

admin_service_file() {
  cat <<EOF
[Unit]
Description=Stardew Valley Server Kit Admin Panel
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
WorkingDirectory=$ROOT_DIR
Environment=SDV_ADMIN_ROOT=$ROOT_DIR
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/usr/bin/env node $ROOT_DIR/scripts/admin-panel.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
}

admin_service_install() {
  require_linux_systemd_root
  ensure_admin_env_file
  command -v node >/dev/null 2>&1 || die "Command not found: node. Please install Node.js first."

  set_env_value ADMIN_HOST "127.0.0.1"
  set_env_value ADMIN_PORT "$(env_or_default ADMIN_PORT 8088)"

  step "Installing systemd admin service"
  admin_service_file >"/etc/systemd/system/$SYSTEMD_SERVICE_NAME"
  systemctl daemon-reload
  systemctl enable "$SYSTEMD_SERVICE_NAME"
  systemctl restart "$SYSTEMD_SERVICE_NAME"

  sleep 2
  admin_service_status
}

admin_service_start() {
  require_linux_systemd_root
  ensure_admin_env_file
  systemctl start "$SYSTEMD_SERVICE_NAME"
  sleep 1
  admin_service_status
}

admin_service_stop() {
  require_linux_systemd_root
  systemctl stop "$SYSTEMD_SERVICE_NAME"
  ok "Stopped $SYSTEMD_SERVICE_NAME"
}

admin_service_restart() {
  require_linux_systemd_root
  ensure_admin_env_file
  systemctl restart "$SYSTEMD_SERVICE_NAME"
  sleep 1
  admin_service_status
}

admin_service_status() {
  require_linux_systemd
  local admin_port
  admin_port="$(env_or_default ADMIN_PORT 8088)"

  step "Admin service status"
  systemctl status "$SYSTEMD_SERVICE_NAME" --no-pager || true

  step "Local admin probe"
  if test_tcp_port 127.0.0.1 "$admin_port"; then
    ok "Admin panel is listening on 127.0.0.1:$admin_port"
    if command -v curl >/dev/null 2>&1; then
      curl -fsS "http://127.0.0.1:$admin_port/" | head -5 || true
    fi
  else
    warn "Admin panel is not reachable on 127.0.0.1:$admin_port"
    warn "Read logs with: journalctl -u $SYSTEMD_SERVICE_NAME -n 100 --no-pager"
  fi

  warn "For 1Panel reverse proxy, proxy to http://127.0.0.1:$admin_port"
}

admin_service_logs() {
  require_linux_systemd
  journalctl -u "$SYSTEMD_SERVICE_NAME" -n 120 --no-pager
}

smoke_test() {
  ensure_env_file
  step "Starting server stack"
  compose_checked "启动服务栈" up --detach
  step "Waiting for containers"
  sleep 15
  compose_checked "查看服务状态" ps

  vnc_port="$(env_or_default VNC_PORT 5800)"
  api_port="$(env_or_default API_PORT 8080)"
  step "Checking local TCP ports"
  if test_tcp_port 127.0.0.1 "$vnc_port"; then
    ok "VNC port reachable: $vnc_port"
  else
    printf 'WARN VNC port not reachable yet: %s\n' "$vnc_port"
  fi
  if test_tcp_port 127.0.0.1 "$api_port"; then
    ok "API port reachable: $api_port"
  else
    printf 'WARN API port not reachable yet: %s\n' "$api_port"
  fi

  step "Recent logs"
  compose logs --tail 120 --no-color server steam-auth || true
  show_access_info
}

vnc_input_check() {
  step "Checking VNC input configuration"

  local disable_rendering vnc_params
  disable_rendering="$(env_or_default DISABLE_RENDERING false)"
  vnc_params="$(env_or_default XVNC_SERVER_CUSTOM_PARAMS "$STABLE_VNC_PARAMS")"

  if [[ ! -f "$ENV_FILE" ]]; then
    warn ".env does not exist. Showing default VNC settings; run setup or vnc-fix to write local configuration."
  fi

  printf 'DISABLE_RENDERING=%s\n' "$disable_rendering"
  printf 'XVNC_SERVER_CUSTOM_PARAMS=%s\n' "$vnc_params"

  if [[ "$disable_rendering" == "true" ]]; then
    warn "DISABLE_RENDERING=true is not recommended when you need interactive VNC controls."
  fi

  if [[ "$vnc_params" == *"-RawKeyboard=1"* ]]; then
    warn "RawKeyboard is enabled. Some VNC clients can mis-handle keyboard input in this mode."
  fi

  if [[ "$vnc_params" != *"-AcceptSetDesktopSize=1"* ]]; then
    warn "AcceptSetDesktopSize is not explicit. Run vnc-fix so VNC clients that support remote resize can request desktop-size changes."
  fi

  if [[ "$(docker inspect -f '{{.State.Running}}' sdv-server 2>/dev/null || true)" != "true" ]]; then
    warn "sdv-server is not running. Start it before testing live VNC input."
    return 0
  fi

  step "Runtime Xvnc process"
  docker exec sdv-server sh -lc "ps -ef | grep '[X]vnc' | sed -E 's/-rfbauth=[^ ]+/-rfbauth=<path>/'"

  step "Active X11 window"
  docker exec sdv-server sh -lc "DISPLAY=:0 xprop -root _NET_ACTIVE_WINDOW 2>/dev/null; DISPLAY=:0 wmctrl -l -p -G 2>/dev/null || true"

  step "VNC desktop size"
  docker exec sdv-server sh -lc 'printf "target=%sx%s\n" "$DISPLAY_WIDTH" "$DISPLAY_HEIGHT"; DISPLAY=:0 xrandr 2>/dev/null | sed -n "1,4p" || true'

  step "Manual mouse/keyboard probe"
  printf '%s\n' 'Use a temporary xev window to test the VNC input path:'
  printf '%s\n' 'docker exec -it sdv-server sh -lc "DISPLAY=:0 timeout 30 xev -geometry 260x160+40+40 -event mouse -event keyboard"'
  printf '%s\n' 'Then click inside the small xev window in noVNC and press F9/F10.'
  printf '%s\n' 'Expected output contains ButtonPress/ButtonRelease and KeyPress/KeyRelease.'
  printf '%s\n' 'Do not use the JunimoServer overlay labels as a click test; they are status/hotkey hints.'
}

update_stardew_vnc_resolution() {
  ensure_env_file

  local display_width display_height volume_name
  display_width="$(env_or_default DISPLAY_WIDTH 1920)"
  display_height="$(env_or_default DISPLAY_HEIGHT 1080)"
  volume_name="stardew-valley-server-kit_saves"

  step "Aligning Stardew Valley resolution with VNC desktop"
  warn "This updates the game's saved startup preferences inside the game volume. Saves are preserved."

  if ! docker volume inspect "$volume_name" >/dev/null 2>&1; then
    warn "Save/config volume not found: $volume_name. Start the server once, then run vnc-fix again."
    return 0
  fi

  docker run --rm \
    -e "DISPLAY_WIDTH=$display_width" \
    -e "DISPLAY_HEIGHT=$display_height" \
    -v "$volume_name:/config" \
    alpine:3.20 sh -lc '
set -eu
stamp="$(date +%Y%m%d-%H%M%S)"
for file in /config/startup_preferences /config/default_options; do
  if [ ! -f "$file" ]; then
    echo "WARN missing $file"
    continue
  fi
  cp "$file" "$file.bak-$stamp"
  sed -i -E \
    -e "s|<fullscreenResolutionX>[^<]*</fullscreenResolutionX>|<fullscreenResolutionX>${DISPLAY_WIDTH}</fullscreenResolutionX>|g" \
    -e "s|<fullscreenResolutionY>[^<]*</fullscreenResolutionY>|<fullscreenResolutionY>${DISPLAY_HEIGHT}</fullscreenResolutionY>|g" \
    -e "s|<preferredResolutionX>[^<]*</preferredResolutionX>|<preferredResolutionX>${DISPLAY_WIDTH}</preferredResolutionX>|g" \
    -e "s|<preferredResolutionY>[^<]*</preferredResolutionY>|<preferredResolutionY>${DISPLAY_HEIGHT}</preferredResolutionY>|g" \
    -e "s|<uiScale>[^<]*</uiScale>|<uiScale>1</uiScale>|g" \
    "$file"
  echo "OK updated $file"
done
'
}

vnc_runtime_resize() {
  if [[ "$(docker inspect -f '{{.State.Running}}' sdv-server 2>/dev/null || true)" != "true" ]]; then
    warn "sdv-server is not running. Skipping live X11 resize."
    return 0
  fi

  step "Forcing live VNC desktop size"
  warn "If noVNC is open with resize=remote, it can shrink the remote desktop again. Use resize=scale for a fixed .env size."
  docker exec sdv-server sh -lc '
set -eu
width="${DISPLAY_WIDTH:-1920}"
height="${DISPLAY_HEIGHT:-1080}"
mode="${width}x${height}"
if DISPLAY=:0 xrandr | awk "{print \$1}" | grep -Fxq "$mode"; then
  DISPLAY=:0 xrandr --output VNC-0 --mode "$mode" || DISPLAY=:0 xrandr -s "$mode" || true
else
  DISPLAY=:0 xrandr --fb "$mode" || true
fi
win="$(DISPLAY=:0 wmctrl -l | awk '\''/Stardew Valley/ {print $1; exit}'\'')"
if [ -n "$win" ]; then
  DISPLAY=:0 wmctrl -ir "$win" -b remove,maximized_vert,maximized_horz || true
  DISPLAY=:0 wmctrl -ir "$win" -e "0,0,0,$width,$height" || true
  DISPLAY=:0 wmctrl -ir "$win" -b add,maximized_vert,maximized_horz || true
fi
DISPLAY=:0 xrandr | sed -n "1,4p"
DISPLAY=:0 wmctrl -lG | grep -i "Stardew" || true
'
}

vnc_input_fix() {
  ensure_env_file
  step "Applying VNC interactive settings"
  set_env_value DISABLE_RENDERING false
  set_env_value XVNC_SERVER_CUSTOM_PARAMS "$STABLE_VNC_PARAMS"
  ok "Set DISABLE_RENDERING=false"
  ok "Enabled pointer, keyboard, and remote desktop resize events"
  ok "Removed RawKeyboard from XVNC_SERVER_CUSTOM_PARAMS"

  step "Stopping server before updating game resolution"
  warn "Only the server container is stopped. Docker volumes containing game files and saves are preserved."
  compose stop server

  update_stardew_vnc_resolution

  step "Starting server container"
  compose up -d --force-recreate server

  step "Waiting for VNC to come back"
  sleep 12
  vnc_runtime_resize
  vnc_input_check
}

smapi_command() {
  local command="$1"
  local description="$2"

  if [[ "$(docker inspect -f '{{.State.Running}}' sdv-server 2>/dev/null || true)" != "true" ]]; then
    die "sdv-server is not running. Start it before sending JunimoServer commands."
  fi

  step "$description"
  warn "This sends a SMAPI console command to the running server. It does not restart the container or edit saves."

  docker exec sdv-server sh -lc "
set -eu
test -p /tmp/smapi-input || { echo 'SMAPI input pipe not found'; exit 1; }
printf '%s\n' '$command' > /tmp/smapi-input
sleep 1
tail -n 40 /tmp/server-output.log | grep -E 'Host automation|Host visibility|host-auto|host-visibility' | tail -n 10 || true
"
}

backup_saves() {
  ensure_env_file
  local volume_name="stardew-valley-server-kit_saves"
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"
  local archive_name="saves-$timestamp.tar.gz"
  local metadata_name="saves-$timestamp.meta.txt"

  step "Backing up saves volume"
  printf 'WARN Best practice: run backup after an overnight save, or while the server is stopped.\n'

  docker volume inspect "$volume_name" >/dev/null 2>&1 \
    || die "Save volume not found: $volume_name. Start the server once before backing up."

  if [[ "$(docker inspect -f '{{.State.Running}}' sdv-server 2>/dev/null || true)" == "true" ]]; then
    printf 'WARN sdv-server is running. Avoid backing up during the overnight save animation.\n'
  fi

  mkdir -p "$BACKUP_DIR"
  docker run --rm \
    -v "$volume_name:/saves:ro" \
    -v "$BACKUP_DIR:/backup" \
    alpine:3.20 sh -c "tar -czf /backup/$archive_name -C /saves ."

  {
    printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'volume=%s\n' "$volume_name"
    printf 'archive=%s\n' "$archive_name"
    printf 'note=%s\n' 'This file intentionally contains no Steam credentials, API keys, or VNC passwords.'
    printf 'restore_hint=%s\n' 'Stop the server, then restore this archive into the saves Docker volume.'
  } > "$BACKUP_DIR/$metadata_name"

  ok "Backup written: backups/$archive_name"
  ok "Metadata written: backups/$metadata_name"
}

prepare_steamcmd_volumes() {
  local image="$1"
  local game_volume="$2"
  local steamcmd_volume="$3"

  step "Preparing SteamCMD volumes"
  docker run --rm --user 0:0 \
    -v "$game_volume:/data/game" \
    -v "$steamcmd_volume:/home/steam/Steam" \
    --entrypoint bash \
    "$image" -lc 'mkdir -p /data/game /home/steam/Steam && chown -R steam:steam /data/game /home/steam/Steam'
}

game_data_installed() {
  local game_volume="$1"
  docker run --rm \
    -v "$game_volume:/data/game:ro" \
    alpine:3.20 sh -c 'test -f /data/game/StardewValley -o -f /data/game/StardewValley.exe' \
    >/dev/null 2>&1
}

copy_steamcmd_cache_to_game_data() {
  local game_volume="$1"
  local steamcmd_volume="$2"

  step "Checking SteamCMD cache fallback"
  docker run --rm --user 0:0 \
    -v "$steamcmd_volume:/home/steam/Steam:ro" \
    -v "$game_volume:/data/game" \
    alpine:3.20 sh -c '
set -eu
if [ ! -f "/home/steam/Steam/steamapps/common/Stardew Valley/StardewValley" ] && [ ! -f "/home/steam/Steam/steamapps/common/Stardew Valley/StardewValley.exe" ]; then
  echo "SteamCMD cache does not contain Stardew Valley game files."
  exit 1
fi
rm -rf /data/game/.steam_tmp_copy
mkdir -p /data/game/.steam_tmp_copy
cp -a "/home/steam/Steam/steamapps/common/Stardew Valley/." /data/game/.steam_tmp_copy/
find /data/game -mindepth 1 -maxdepth 1 ! -name ".steam_tmp_copy" -exec rm -rf {} +
cp -a /data/game/.steam_tmp_copy/. /data/game/
rm -rf /data/game/.steam_tmp_copy
chown -R 1000:1000 /data/game
'
}

assert_game_data_installed() {
  local game_volume="$1"
  local steamcmd_volume="$2"

  if ! game_data_installed "$game_volume"; then
    copy_steamcmd_cache_to_game_data "$game_volume" "$steamcmd_volume" \
      || die "SteamCMD reported success, but game files were not found in game-data or cache volumes."
  fi

  game_data_installed "$game_volume" \
    || die "Game files are still missing from the game-data volume after fallback copy."

  docker run --rm \
    -v "$game_volume:/data/game:ro" \
    alpine:3.20 sh -c 'printf "game-data files="; find /data/game -type f | wc -l; du -sh /data/game | awk "{print \$1}"'

  ok "Game files are available in the game-data volume"
}

prepare_steamworks_sdk_dir() {
  local game_volume="$1"

  docker run --rm --user 0:0 \
    -v "$game_volume:/data/game" \
    alpine:3.20 sh -c 'mkdir -p /data/game/.steam-sdk && chown -R 0:0 /data/game/.steam-sdk && chmod -R 777 /data/game/.steam-sdk'
}

install_steamworks_sdk() {
  local image="$1"
  local game_volume="$2"
  local steamcmd_volume="$3"

  step "Installing Steamworks SDK redistributable"
  prepare_steamworks_sdk_dir "$game_volume"
  load_steam_proxy_docker_args

  docker run --rm \
    "${STEAM_PROXY_DOCKER_ARGS[@]}" \
    -v "$game_volume:/data/game" \
    -v "$steamcmd_volume:/home/steam/Steam" \
    "$image" \
    bash -lc '/home/steam/steamcmd/steamcmd.sh +force_install_dir /data/game/.steam-sdk +login anonymous +app_update 1007 validate +quit'

  docker run --rm \
    -v "$game_volume:/data/game:ro" \
    alpine:3.20 sh -c 'test -f /data/game/.steam-sdk/linux64/steamclient.so -o -f /data/game/.steam-sdk/steamclient.so' \
    || die "Steamworks SDK download finished, but steamclient.so was not found."

  docker run --rm --user 0:0 \
    -v "$game_volume:/data/game" \
    alpine:3.20 sh -c 'chown -R 1000:1000 /data/game/.steam-sdk'

  ok "Steamworks SDK is available in game-data"
}

steamcmd_download() {
  ensure_env_file

  local steam_user
  local steam_pass
  steam_user="$(get_env_value STEAM_USERNAME || true)"
  steam_pass="$(get_env_value STEAM_PASSWORD || true)"
  [[ -n "$steam_user" && -n "$steam_pass" ]] || die "STEAM_USERNAME or STEAM_PASSWORD is missing in .env."

  local max_attempts="${RETRIES:-5}"
  local attempt=1
  local delay
  local image="cm2network/steamcmd:latest"
  local game_volume="stardew-valley-server-kit_game-data"
  local steamcmd_volume="stardew-valley-server-kit_steamcmd"
  local download_command='/home/steam/steamcmd/steamcmd.sh +@sSteamCmdForcePlatformType linux +force_install_dir /data/game +login "$STEAM_USERNAME" "$STEAM_PASSWORD" +app_update 413150 validate +quit'
  local steamcmd_redactions=("$steam_user" "$steam_pass")
  local redaction_value

  step "Downloading game files with SteamCMD"
  check_steam_network_connectivity || true
  load_steam_proxy_docker_args
  for redaction_value in \
    "$(steam_proxy_value HTTP_PROXY)" \
    "$(steam_proxy_value HTTPS_PROXY)" \
    "$(steam_proxy_value ALL_PROXY)" \
    "$(steam_proxy_value NO_PROXY)" \
    "$(steam_proxy_value http_proxy HTTP_PROXY)" \
    "$(steam_proxy_value https_proxy HTTPS_PROXY)" \
    "$(steam_proxy_value all_proxy ALL_PROXY)" \
    "$(steam_proxy_value no_proxy NO_PROXY)"; do
    [[ -z "$redaction_value" ]] || steamcmd_redactions+=("$redaction_value")
  done
  if steam_proxy_configured; then
    ok "Steam proxy variables are configured; values are not printed"
  fi
  printf 'WARN If Steam Guard is requested, the script will ask for the code with hidden input.\n'
  printf 'WARN Do not paste Steam passwords, Steam Guard codes, or tokens into chat, issues, or screenshots.\n'
  if ! interactive_terminal; then
    warn "No interactive terminal detected; SteamCMD will run without TTY."
    warn "If Steam Guard is requested, rerun this command from an SSH session with a TTY."
  fi
  ensure_docker_image "$image"
  ensure_docker_image "alpine:3.20"
  prepare_steamcmd_volumes "$image" "$game_volume" "$steamcmd_volume"

  while (( attempt <= max_attempts )); do
    local attempt_log docker_status
    attempt_log="$(mktemp "${TMPDIR:-/tmp}/svsk-steamcmd.XXXXXX.log")"

    step "SteamCMD attempt $attempt of $max_attempts"
    set +e
    STEAM_USERNAME="$steam_user" STEAM_PASSWORD="$steam_pass" \
      docker run --rm \
      "${STEAM_PROXY_DOCKER_ARGS[@]}" \
      -v "$game_volume:/data/game" \
      -v "$steamcmd_volume:/home/steam/Steam" \
      -e STEAM_USERNAME \
      -e STEAM_PASSWORD \
      "$image" \
      bash -lc "$download_command" 2>&1 | steamcmd_stream_to_log "$attempt_log" "${steamcmd_redactions[@]}"
    docker_status="${PIPESTATUS[0]}"
    set -e

    if (( docker_status == 0 )); then
      rm -f "$attempt_log"
      assert_game_data_installed "$game_volume" "$steamcmd_volume"
      install_steamworks_sdk "$image" "$game_volume" "$steamcmd_volume"
      ok "SteamCMD download completed"
      return 0
    fi

    if steamcmd_output_requires_interactive_guard "$attempt_log"; then
      if ! interactive_terminal; then
        rm -f "$attempt_log"
        die "SteamCMD requires Steam Guard, but this terminal is non-interactive. Rerun from an SSH session with TTY, for example: ssh -t root@server 'cd /opt/stardew-valley-server-kit && ./setup.sh steamcmd-download'"
      fi

      local guard_code guard_log
      guard_code="$(prompt_steam_guard_code)" || {
        rm -f "$attempt_log"
        die "Steam Guard code was not entered."
      }
      guard_log="$(mktemp "${TMPDIR:-/tmp}/svsk-steamcmd-guard.XXXXXX.log")"

      step "SteamCMD Steam Guard retry"
      set +e
      { printf '%s\n' "$guard_code"; } | STEAM_USERNAME="$steam_user" STEAM_PASSWORD="$steam_pass" \
        docker run --rm -i \
        "${STEAM_PROXY_DOCKER_ARGS[@]}" \
        -v "$game_volume:/data/game" \
        -v "$steamcmd_volume:/home/steam/Steam" \
        -e STEAM_USERNAME \
        -e STEAM_PASSWORD \
        "$image" \
        bash -lc "$download_command" 2>&1 | steamcmd_stream_to_log "$guard_log" "${steamcmd_redactions[@]}" "$guard_code"
      docker_status="${PIPESTATUS[1]}"
      set -e
      guard_code=""
      unset guard_code

      if (( docker_status == 0 )); then
        rm -f "$attempt_log" "$guard_log"
        assert_game_data_installed "$game_volume" "$steamcmd_volume"
        install_steamworks_sdk "$image" "$game_volume" "$steamcmd_volume"
        ok "SteamCMD download completed"
        return 0
      fi

      rm -f "$attempt_log"
      attempt_log="$guard_log"
      if steamcmd_output_requires_interactive_guard "$attempt_log"; then
        warn "Steam Guard verification did not complete. The code may be expired or incorrect."
      fi
    fi
    rm -f "$attempt_log"

    printf 'WARN SteamCMD failed on attempt %s\n' "$attempt"
    if (( attempt < max_attempts )); then
      delay=$(( attempt * 10 ))
      (( delay > 60 )) && delay=60
      printf 'WARN Retrying in %s seconds. Partial files in the game volume will be reused.\n' "$delay"
      sleep "$delay"
    fi
    attempt=$(( attempt + 1 ))
  done

  die "SteamCMD download failed after $max_attempts attempts. See docs/STEAM_DOWNLOAD_FALLBACK.md."
}

run_steam_auth_login() {
  check_steam_network_connectivity || true
  if compose_run_login; then
    return 0
  fi

  warn "steam-auth login failed. If the log says \"The SteamClient instance must be connected\", this is usually not a password error."
  show_steamcmd_fallback_hint
  return 1
}

run_steam_auth_download_or_fallback() {
  check_steam_network_connectivity || true
  if compose run --rm steam-auth download; then
    return 0
  fi

  warn "steam-auth download failed. Falling back to SteamCMD."
  show_steamcmd_fallback_hint
  steamcmd_download
}

start_server() {
  if [[ "${ENABLE_DISCORD:-0}" == "1" ]]; then
    compose_checked "启动服务" --profile discord up -d
  else
    compose_checked "启动服务" up -d
  fi
}

start_server_from_local_build() {
  if [[ "${ENABLE_DISCORD:-0}" == "1" ]]; then
    compose_build --profile discord up -d
  else
    compose_build up -d
  fi
}

build_local_images() {
  validate_build_contexts
  if [[ "${ENABLE_DISCORD:-0}" == "1" ]]; then
    compose_build build server steam-auth discord-bot
  else
    compose_build build server steam-auth
  fi
}

case "$ACTION" in
  admin|admin-public|admin-token-rotate|admin-service-install|admin-service-start|admin-service-stop|admin-service-restart|admin-service-status|admin-service-logs)
    ;;
  doctor)
    step "Checking Docker"
    require_docker_cli
    ;;
  *)
    step "Checking Docker"
    require_docker
    ;;
esac

case "$ACTION" in
  doctor)
    step "Checking Docker Compose"
    require_docker_compose
    ok "Docker Compose available"
    step "Validating docker-compose.yml"
    compose_example_checked "校验 docker-compose.yml" config --quiet
    ok "Compose config OK"
    step "Checking Docker daemon"
    require_docker_daemon
    ok "Docker daemon available"
    step "Checking Docker images"
    check_configured_images || true
    check_steam_network_connectivity || true
    step "Checking local directories"
    mkdir -p "$ROOT_DIR/data/settings" "$ROOT_DIR/data/mods"
    ok "data/settings and data/mods ready"
    if [[ -f "$ENV_FILE" ]]; then
      ok ".env exists; sensitive values are not printed"
    else
      printf 'WARN .env does not exist yet; run setup or copy .env.example before real Steam auth\n'
    fi
    ;;
  check-env)
    step "Checking Steam credential visibility"
    printf 'environment STEAM_USERNAME: %s\n' "$([[ -n "${STEAM_USERNAME:-${STEAM_USER:-${STEAM_ACCOUNT:-${STEAM_LOGIN:-}}}}" ]] && printf set || printf missing)"
    printf 'environment STEAM_PASSWORD: %s\n' "$([[ -n "${STEAM_PASSWORD:-${STEAM_PASS:-}}" ]] && printf set || printf missing)"
    printf 'environment STEAM_REFRESH_TOKEN: %s\n' "$([[ -n "${STEAM_REFRESH_TOKEN:-}" ]] && printf set || printf missing)"
    if [[ -f "$ENV_FILE" ]]; then
      printf '.env STEAM_USERNAME: %s\n' "$([[ -n "$(get_env_value STEAM_USERNAME)" ]] && printf set || printf missing)"
      printf '.env STEAM_PASSWORD: %s\n' "$([[ -n "$(get_env_value STEAM_PASSWORD)" ]] && printf set || printf missing)"
      printf '.env STEAM_REFRESH_TOKEN: %s\n' "$([[ -n "$(get_env_value STEAM_REFRESH_TOKEN)" ]] && printf set || printf missing)"
    else
      printf 'WARN .env does not exist\n'
    fi
    ;;
  setup)
    step "Preparing .env"
    ensure_env_file
    step "Pulling Docker images"
    compose_pull_checked "Pulling Docker images"
    step "Running Steam login"
    run_steam_auth_login || true
    step "Downloading or updating game files"
    run_steam_auth_download_or_fallback
    smoke_test
    prompt_admin_panel_after_setup
    ;;
  build)
    ensure_env_file
    step "Building local Docker images"
    build_local_images
    ;;
  build-setup)
    step "Preparing .env"
    ensure_env_file
    step "Building local Docker images"
    build_local_images
    step "Running Steam login"
    run_steam_auth_login || true
    step "Downloading or updating game files"
    run_steam_auth_download_or_fallback
    smoke_test
    prompt_admin_panel_after_setup
    ;;
  login)
    ensure_env_file
    step "Running Steam login"
    run_steam_auth_login
    ;;
  download)
    ensure_env_file
    step "Downloading or updating game files"
    run_steam_auth_download_or_fallback
    ;;
  steamcmd-download)
    steamcmd_download
    ;;
  steam-network)
    steam_network_diagnostics
    ;;
  smoke)
    smoke_test
    ;;
  start)
    ensure_env_file
    step "Starting server"
    start_server
    show_access_info
    ;;
  build-start)
    ensure_env_file
    step "Building local Docker images"
    build_local_images
    step "Starting server from local images"
    start_server_from_local_build
    show_access_info
    ;;
  stop)
    step "Stopping server"
    compose_checked "停止服务" down
    ;;
  restart)
    ensure_env_file
    step "Restarting server"
    compose_checked "停止旧服务" down
    start_server
    show_access_info
    ;;
  logs)
    ensure_env_file
    step "Following logs; press Ctrl+C to exit"
    compose logs -f
    ;;
  status)
    ensure_env_file
    step "Showing container status"
    compose_checked "查看服务状态" ps
    ;;
  update)
    ensure_env_file
    step "Updating images and restarting"
    compose_pull_checked "Pulling Docker images"
    compose_checked "停止旧服务" down
    start_server
    show_access_info
    ;;
  build-update)
    ensure_env_file
    step "Rebuilding local images and restarting"
    build_local_images
    compose_build down
    start_server_from_local_build
    show_access_info
    ;;
  vnc-check)
    vnc_input_check
    ;;
  vnc-fix)
    vnc_input_fix
    ;;
  vnc-resize)
    vnc_runtime_resize
    ;;
  host-auto)
    smapi_command "host-auto" "Toggling JunimoServer host auto mode"
    ;;
  host-visibility)
    smapi_command "host-visibility" "Toggling JunimoServer host visibility"
    ;;
  backup)
    backup_saves
    ;;
  join-info)
    join_info
    ;;
  admin)
    admin_panel
    ;;
  admin-public)
    admin_panel 1
    ;;
  admin-token-rotate)
    admin_token_rotate
    ;;
  admin-service-install)
    admin_service_install
    ;;
  admin-service-start)
    admin_service_start
    ;;
  admin-service-stop)
    admin_service_stop
    ;;
  admin-service-restart)
    admin_service_restart
    ;;
  admin-service-status)
    admin_service_status
    ;;
  admin-service-logs)
    admin_service_logs
    ;;
  *)
    die "Unknown command: $ACTION. Available: doctor/check-env/login/download/steamcmd-download/steam-network/smoke/setup/build/build-setup/start/build-start/stop/restart/logs/status/update/build-update/backup/join-info/admin/admin-public/admin-token-rotate/admin-service-install/admin-service-start/admin-service-stop/admin-service-restart/admin-service-status/admin-service-logs/vnc-check/vnc-fix/vnc-resize/host-auto/host-visibility"
    ;;
esac
