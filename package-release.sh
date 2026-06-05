#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$ROOT_DIR/dist"
IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-}"
IMAGE_VERSION="${IMAGE_VERSION:-}"
SERVER_SOURCE=""
STEAM_SERVICE_SOURCE=""
DISCORD_BOT_SOURCE=""
REQUIRE_SOURCE_BUILD_PACKAGE=0

usage() {
  cat <<'USAGE'
Usage: ./package-release.sh [options]

Create user-facing release archives.

Options:
  --namespace VALUE       Docker image namespace written to packaged .env.example.
  --version VALUE         Docker image tag written to packaged .env.example.
  --output-dir PATH       Output directory. Defaults to dist.
  --server-source PATH    Source directory containing server/Dockerfile.
  --steam-source PATH     Source directory containing steam-service/Dockerfile.
  --discord-source PATH   Source directory containing discord-bot/Dockerfile.
  --require-source-build  Fail if the source-build package cannot be created.
  -h, --help              Show this help.
USAGE
}

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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace)
      [[ $# -ge 2 ]] || die "--namespace requires a value."
      IMAGE_NAMESPACE="$2"
      shift 2
      ;;
    --version)
      [[ $# -ge 2 ]] || die "--version requires a value."
      IMAGE_VERSION="$2"
      shift 2
      ;;
    --output-dir)
      [[ $# -ge 2 ]] || die "--output-dir requires a value."
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --server-source)
      [[ $# -ge 2 ]] || die "--server-source requires a value."
      SERVER_SOURCE="$2"
      shift 2
      ;;
    --steam-source)
      [[ $# -ge 2 ]] || die "--steam-source requires a value."
      STEAM_SERVICE_SOURCE="$2"
      shift 2
      ;;
    --discord-source)
      [[ $# -ge 2 ]] || die "--discord-source requires a value."
      DISCORD_BOT_SOURCE="$2"
      shift 2
      ;;
    --require-source-build)
      REQUIRE_SOURCE_BUILD_PACKAGE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

get_env_value_from_file() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 0
  grep -E "^[[:space:]]*$key[[:space:]]*=" "$file" \
    | tail -n 1 \
    | sed -E 's/^[^=]+=//' \
    | sed -E 's/^["'\'']|["'\'']$//g'
}

IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-$(get_env_value_from_file "$ROOT_DIR/.env.example" IMAGE_NAMESPACE || true)}"
IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-sdvd}"
IMAGE_VERSION="${IMAGE_VERSION:-$(get_env_value_from_file "$ROOT_DIR/.env.example" IMAGE_VERSION || true)}"
IMAGE_VERSION="${IMAGE_VERSION:-preview}"

[[ "$OUTPUT_DIR" == /* ]] || OUTPUT_DIR="$ROOT_DIR/$OUTPUT_DIR"
[[ -n "$SERVER_SOURCE" ]] || SERVER_SOURCE="$ROOT_DIR/server"
[[ -n "$STEAM_SERVICE_SOURCE" ]] || STEAM_SERVICE_SOURCE="$ROOT_DIR/steam-service"
[[ -n "$DISCORD_BOT_SOURCE" ]] || DISCORD_BOT_SOURCE="$ROOT_DIR/discord-bot"
[[ "$SERVER_SOURCE" == /* ]] || SERVER_SOURCE="$ROOT_DIR/$SERVER_SOURCE"
[[ "$STEAM_SERVICE_SOURCE" == /* ]] || STEAM_SERVICE_SOURCE="$ROOT_DIR/$STEAM_SERVICE_SOURCE"
[[ "$DISCORD_BOT_SOURCE" == /* ]] || DISCORD_BOT_SOURCE="$ROOT_DIR/$DISCORD_BOT_SOURCE"

STAMP="$(date +%Y%m%d-%H%M%S)"
STAGING_ROOT="$OUTPUT_DIR/.stage/$STAMP"

mkdir -p "$OUTPUT_DIR"

copy_common_tree() {
  local destination="$1"
  mkdir -p "$destination"
  (
    cd "$ROOT_DIR"
    tar \
      --exclude='./.git' \
      --exclude='./.github' \
      --exclude='./.gitattributes' \
      --exclude='./.gitignore' \
      --exclude='./.ace-tool' \
      --exclude='./.claude' \
      --exclude='./.idea' \
      --exclude='./.vscode' \
      --exclude='./dist' \
      --exclude='./data' \
      --exclude='./backups' \
      --exclude='./logs' \
      --exclude='./.env' \
      --exclude='./.env.local' \
      --exclude='./docker-compose.build.yml' \
      --exclude='./CONTRIBUTING.md' \
      --exclude='./release-images.ps1' \
      --exclude='./release-images.sh' \
      --exclude='./package-release.ps1' \
      --exclude='./package-release.sh' \
      --exclude='*/bin' \
      --exclude='*/obj' \
      --exclude='*/node_modules' \
      -cf - .
  ) | (
    cd "$destination"
    tar -xf -
  )
}

copy_source_tree() {
  local source="$1"
  local destination="$2"
  mkdir -p "$destination"
  (
    cd "$source"
    tar \
      --exclude='./.git' \
      --exclude='*/bin' \
      --exclude='*/obj' \
      --exclude='*/node_modules' \
      -cf - .
  ) | (
    cd "$destination"
    tar -xf -
  )
}

set_package_env_defaults() {
  local package_root="$1"
  local env_path="$package_root/.env.example"
  [[ -f "$env_path" ]] || return

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$env_path" "$IMAGE_NAMESPACE" "$IMAGE_VERSION" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
namespace = sys.argv[2]
version = sys.argv[3]
text = path.read_text(encoding="utf-8")
lines = text.lstrip("\ufeff").splitlines()
next_lines = []
for line in lines:
    if line.lstrip().startswith("IMAGE_NAMESPACE="):
        next_lines.append(f"IMAGE_NAMESPACE={namespace}")
    elif line.lstrip().startswith("IMAGE_VERSION="):
        next_lines.append(f"IMAGE_VERSION={version}")
    else:
        next_lines.append(line)
path.write_text("\n".join(next_lines) + "\n", encoding="utf-8")
PY
  else
    warn "python3 not found; packaged .env.example keeps repository defaults."
  fi
}

remove_pull_package_build_entries() {
  local package_root="$1"
  rm -f \
    "$package_root/setup-build.ps1" \
    "$package_root/setup-build.sh" \
    "$package_root/setup-local-build.ps1" \
    "$package_root/docker-compose.build.yml.example" \
    "$package_root/scripts/sdv-server-local-build.sh"
}

write_quickstart() {
  local package_root="$1"
  local package_type="$2"
  local quickstart_path="$package_root/QUICKSTART.md"

  if [[ "$package_type" == "source-build" ]]; then
    cat > "$quickstart_path" <<EOF
# Stardew Valley Server Kit - Source Build Quickstart

This package is for maintainers or advanced users who want to build Docker images on the target server.

## Linux server

\`\`\`bash
mkdir -p stardew-valley-server-kit
cd stardew-valley-server-kit
# unzip the release archive here
chmod +x ./setup-build.sh
./setup-build.sh doctor
./setup-build.sh
\`\`\`

If Docker is missing, install Docker Engine with Compose v2 first. On Ubuntu/Debian, the short path is:

\`\`\`bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker \$USER
newgrp docker
\`\`\`

This package must contain these build inputs:

- server/Dockerfile
- steam-service/Dockerfile
- discord-bot/Dockerfile

## Useful commands

\`\`\`bash
./setup-build.sh status
./setup-build.sh logs
./setup-build.sh restart
./setup-build.sh update
./setup-build.sh join-info
./scripts/sdv-server.sh admin-service-install
./scripts/sdv-server.sh admin-service-install-public
\`\`\`
EOF
    return
  fi

  cat > "$quickstart_path" <<EOF
# Stardew Valley Server Kit - Server Quickstart

This package is for normal server owners. It pulls published Docker images and does not require source code.

Project mirror for China users:

- Gitee: https://gitee.com/wuxianggujun/StardewValleyServerKit

Images configured in this package:

- ${IMAGE_NAMESPACE}/server:${IMAGE_VERSION}
- ${IMAGE_NAMESPACE}/steam-service:${IMAGE_VERSION}
- ${IMAGE_NAMESPACE}/discord-bot:${IMAGE_VERSION}

## Linux server

\`\`\`bash
mkdir -p stardew-valley-server-kit
cd stardew-valley-server-kit
# unzip the release archive here
chmod +x ./setup.sh
./setup.sh doctor
./setup.sh
\`\`\`

\`./setup.sh\` without arguments opens an interactive menu. Use option 2 to
fill or update Steam username/password, then option 1 to run the one-click
setup/deploy/repair flow. Steam passwords are saved only in local \`.env\` and
are not printed.

If Docker is missing, install Docker Engine with Compose v2 first. On Ubuntu/Debian, the short path is:

\`\`\`bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker \$USER
newgrp docker
\`\`\`

If Docker Hub is slow or unreachable, \`./setup.sh\` first tries the normal pull path.
After a confirmed registry timeout, it can ask whether to temporarily configure Docker
registry mirrors and restart Docker. Type \`yes\` only if this server can tolerate a
brief interruption of other Docker containers. The script restores the original
\`/etc/docker/daemon.json\` after image downloads finish.

## Useful commands

\`\`\`bash
./setup.sh menu
./setup.sh doctor
./setup.sh steam-config
./setup.sh access-info
./setup.sh status
./setup.sh logs
./setup.sh restart
./setup.sh update
./setup.sh join-info
./setup.sh admin-token-show
./setup.sh admin-token-rotate
./scripts/sdv-server.sh admin-detect
./scripts/sdv-server.sh admin-service-install
./scripts/sdv-server.sh admin-service-install-public
\`\`\`

\`admin-service-install\` is for Nginx/1Panel reverse proxy mode on
\`127.0.0.1:8088\`. \`admin-service-install-public\` is for a bare public
server without reverse proxy; open TCP 8088 in the cloud security group and
visit \`http://<server-public-ip>:8088\`.

Interactive Linux setup detects common reverse proxy candidates and recommends a
mode, but still asks the user to choose because installed reverse proxy software
does not prove a site is configured for this project.

The web admin login uses ADMIN_TOKEN from local .env. To copy it without opening
.env manually, run \`./setup.sh admin-token-show\` from an interactive terminal
and type \`SHOW\`. The token is not printed during normal setup, status, or logs.

If the server has no Node.js 18+, the Linux script can download a project-local
Node.js runtime into \`.svsk-tools/\`. Interactive runs ask first; non-interactive
runs can set \`SVSK_AUTO_INSTALL_NODE=true\`.

Do not use setup-build in this package. Source-build packages are separate and include Dockerfile directories.
EOF
}

zip_stage() {
  local stage_dir="$1"
  local name="$2"
  local zip_path="$OUTPUT_DIR/$name.zip"
  if [[ -e "$zip_path" ]]; then
    zip_path="$OUTPUT_DIR/$name-$STAMP.zip"
  fi

  command -v python3 >/dev/null 2>&1 || die "python3 is required to create zip archives."
  python3 - "$stage_dir" "$zip_path" <<'PY'
import pathlib
import sys
import zipfile

root = pathlib.Path(sys.argv[1])
zip_path = pathlib.Path(sys.argv[2])
with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for path in root.rglob("*"):
        if path.is_file():
            zf.write(path, path.relative_to(root).as_posix())
print(zip_path)
PY
}

has_dockerfile() {
  [[ -d "$1" && -f "$1/Dockerfile" ]]
}

step "Creating pull-image package"
PULL_STAGE="$STAGING_ROOT/pull"
copy_common_tree "$PULL_STAGE"
remove_pull_package_build_entries "$PULL_STAGE"
set_package_env_defaults "$PULL_STAGE"
write_quickstart "$PULL_STAGE" "pull"
PULL_ZIP="$(zip_stage "$PULL_STAGE" "stardew-valley-server-kit-pull-$IMAGE_VERSION")"
ok "Created $PULL_ZIP"

missing=()
has_dockerfile "$SERVER_SOURCE" || missing+=("server: $SERVER_SOURCE")
has_dockerfile "$STEAM_SERVICE_SOURCE" || missing+=("steam-service: $STEAM_SERVICE_SOURCE")
has_dockerfile "$DISCORD_BOT_SOURCE" || missing+=("discord-bot: $DISCORD_BOT_SOURCE")

if [[ "${#missing[@]}" -gt 0 ]]; then
  warn "Skipping source-build package because Docker build contexts are incomplete:"
  for item in "${missing[@]}"; do
    warn "  $item"
  done
  if [[ "$REQUIRE_SOURCE_BUILD_PACKAGE" == "1" ]]; then
    die "Source-build package was required but one or more Dockerfile directories are missing."
  fi
  exit 0
fi

step "Creating source-build package"
SOURCE_STAGE="$STAGING_ROOT/source-build"
copy_common_tree "$SOURCE_STAGE"
copy_source_tree "$SERVER_SOURCE" "$SOURCE_STAGE/server"
copy_source_tree "$STEAM_SERVICE_SOURCE" "$SOURCE_STAGE/steam-service"
copy_source_tree "$DISCORD_BOT_SOURCE" "$SOURCE_STAGE/discord-bot"
cp "$SOURCE_STAGE/docker-compose.build.yml.example" "$SOURCE_STAGE/docker-compose.build.yml"
set_package_env_defaults "$SOURCE_STAGE"
write_quickstart "$SOURCE_STAGE" "source-build"
SOURCE_ZIP="$(zip_stage "$SOURCE_STAGE" "stardew-valley-server-kit-source-build-$IMAGE_VERSION")"
ok "Created $SOURCE_ZIP"
