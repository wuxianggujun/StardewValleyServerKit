#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SVSK_RELEASE_ENV_FILE:-}"
BUILD_COMPOSE_FILE="${SVSK_BUILD_COMPOSE_FILE:-$ROOT_DIR/docker-compose.build.yml}"
BUILD_COMPOSE_EXAMPLE_FILE="$ROOT_DIR/docker-compose.build.yml.example"
NO_PUSH=0

usage() {
  cat <<'USAGE'
Usage: ./release-images.sh [options]

Build and publish Docker images declared by docker-compose.yml.

Options:
  --namespace VALUE  Docker image namespace, for example sdvd or ghcr.io/user.
  --version VALUE    Docker image tag. Defaults to IMAGE_VERSION or preview.
  --build-file PATH  Local build compose override. Defaults to docker-compose.build.yml.
  --env-file PATH    Compose env file. Defaults to .env, then .env.example.
  --no-push          Build only; do not push images.
  -h, --help         Show this help.
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

get_env_value_from_file() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 0
  grep -E "^[[:space:]]*$key[[:space:]]*=" "$file" \
    | tail -n 1 \
    | sed -E 's/^[^=]+=//' \
    | sed -E 's/^["'\'']|["'\'']$//g'
}

IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-}"
IMAGE_VERSION="${IMAGE_VERSION:-}"

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
    --build-file)
      [[ $# -ge 2 ]] || die "--build-file requires a value."
      BUILD_COMPOSE_FILE="$2"
      shift 2
      ;;
    --env-file)
      [[ $# -ge 2 ]] || die "--env-file requires a value."
      ENV_FILE="$2"
      shift 2
      ;;
    --no-push)
      NO_PUSH=1
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

if [[ -z "$ENV_FILE" ]]; then
  if [[ -f "$ROOT_DIR/.env" ]]; then
    ENV_FILE="$ROOT_DIR/.env"
  else
    ENV_FILE="$ROOT_DIR/.env.example"
  fi
fi

[[ -f "$ENV_FILE" ]] || die "Env file not found: $ENV_FILE"

if [[ -z "$IMAGE_NAMESPACE" ]]; then
  IMAGE_NAMESPACE="$(get_env_value_from_file "$ENV_FILE" IMAGE_NAMESPACE || true)"
fi
IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-sdvd}"

if [[ -z "$IMAGE_VERSION" ]]; then
  IMAGE_VERSION="$(get_env_value_from_file "$ENV_FILE" IMAGE_VERSION || true)"
fi
IMAGE_VERSION="${IMAGE_VERSION:-preview}"

if [[ "$BUILD_COMPOSE_FILE" != /* ]]; then
  BUILD_COMPOSE_FILE="$ROOT_DIR/$BUILD_COMPOSE_FILE"
fi

ensure_build_compose_file() {
  if [[ -f "$BUILD_COMPOSE_FILE" ]]; then
    return
  fi

  [[ -f "$BUILD_COMPOSE_EXAMPLE_FILE" ]] || die "Local build compose file not found: $BUILD_COMPOSE_FILE"
  cp "$BUILD_COMPOSE_EXAMPLE_FILE" "$BUILD_COMPOSE_FILE"
  warn "Created docker-compose.build.yml from docker-compose.build.yml.example."
  warn "Edit docker-compose.build.yml if your Dockerfile directories are different."
}

compose_release() {
  (
    cd "$ROOT_DIR"
    IMAGE_NAMESPACE="$IMAGE_NAMESPACE" IMAGE_VERSION="$IMAGE_VERSION" \
      docker compose --env-file "$ENV_FILE" \
        -f "$ROOT_DIR/docker-compose.yml" \
        -f "$BUILD_COMPOSE_FILE" \
        --profile discord "$@"
  )
}

validate_build_contexts() {
  ensure_build_compose_file
  local config_json
  config_json="$(compose_release config --format json)"

  if ! command -v python3 >/dev/null 2>&1; then
    warn "python3 not found; skipping Dockerfile preflight check."
    return
  fi

  local validation_output
  if ! validation_output="$(printf '%s' "$config_json" | python3 -c '
import json
import os
import sys

data = json.load(sys.stdin)
missing = []
for name, service in sorted(data.get("services", {}).items()):
    if name not in {"server", "steam-auth", "discord-bot"}:
        continue
    build = service.get("build")
    if not build:
        missing.append(f"{name}: build is missing")
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
}

command -v docker >/dev/null 2>&1 || die "Command not found: docker."
docker version >/dev/null 2>&1 || die "Docker is not running."

step "Release configuration"
printf 'Namespace: %s\n' "$IMAGE_NAMESPACE"
printf 'Version:   %s\n' "$IMAGE_VERSION"
printf 'Env file:  %s\n' "$ENV_FILE"
printf 'Build:     %s\n' "$BUILD_COMPOSE_FILE"

step "Checking local Docker build inputs"
validate_build_contexts
ok "Build inputs ready"

step "Building Docker images"
compose_release build server steam-auth discord-bot
ok "Images built"

if [[ "$NO_PUSH" == "1" ]]; then
  warn "Skipping docker push because --no-push was used."
  exit 0
fi

step "Pushing Docker images"
if ! compose_release push server steam-auth discord-bot; then
  die "docker push failed. Run docker login and check IMAGE_NAMESPACE/Image permissions."
fi
ok "Images pushed"
