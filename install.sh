#!/usr/bin/env bash
set -euo pipefail

REPO="gunflake/excalidraw-for-agent"
DOWNLOAD_BASE="${EXCALI_DOWNLOAD_BASE:-https://github.com/$REPO/releases/latest/download}"
INSTALL_DIR="${EXCALI_INSTALL_DIR:-$HOME/.excali/app}"
BIN_DIR="${EXCALI_BIN_DIR:-$HOME/.local/bin}"
AGENT_HOMES=("$HOME/.claude" "$HOME/.codex")
SKILL_NAME="excalidraw-diagram"
SKILL_PROMPT="스킬도 설치할까요? 스킬을 설치하면 다이어그램이나 플로차트를 요청할 때 에이전트가 이 스킬을 참고해 그립니다."
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

usage() {
  cat <<EOF
사용법: install.sh [--skill | --no-skill]
  --skill     묻지 않고 에이전트 스킬까지 설치
  --no-skill  스킬 없이 excali 명령만 설치
옵션이 없으면 스킬 설치 여부를 묻습니다.

Node.js가 들어 있는 배포본을 받아 $INSTALL_DIR 에 설치합니다.
저장소를 clone한 폴더에서 실행하면 그 소스를 빌드해 연결합니다 (Node.js 20 이상 필요).
EOF
}

skill_choice=""
for arg in "$@"; do
  case "$arg" in
    --skill) skill_choice="yes" ;;
    --no-skill) skill_choice="no" ;;
    -h | --help) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

if [ -z "$skill_choice" ]; then
  if { : </dev/tty; } 2>/dev/null; then
    read -r -p "$SKILL_PROMPT [Y/n] " answer </dev/tty
    case "$answer" in [nN]*) skill_choice="no" ;; *) skill_choice="yes" ;; esac
  else
    echo "입력을 받을 수 없어 스킬은 건너뜁니다. 스킬까지 설치하려면 --skill 을 붙여 다시 실행하세요."
    skill_choice="no"
  fi
fi

release_target() {
  local os arch
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) echo "지원하지 않는 운영체제입니다: $(uname -s). Windows는 install.ps1을 쓰세요." >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch="arm64" ;;
    x86_64 | amd64) arch="x64" ;;
    *) echo "지원하지 않는 CPU입니다: $(uname -m)" >&2; exit 1 ;;
  esac
  if [ "$os" = "darwin" ] && [ "$arch" = "x64" ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null)" = "1" ]; then
    arch="arm64"
  fi
  echo "$os-$arch"
}

install_release() {
  local target
  target="$(release_target)"
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  echo "==> 배포본 내려받기: excali-$target.tar.gz"
  curl -fL --progress-bar "$DOWNLOAD_BASE/excali-$target.tar.gz" -o "$TMP_DIR/excali.tar.gz"
  tar -xzf "$TMP_DIR/excali.tar.gz" -C "$TMP_DIR"
  echo "==> 설치: $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  rm -rf "$INSTALL_DIR.old"
  if [ -e "$INSTALL_DIR" ]; then mv "$INSTALL_DIR" "$INSTALL_DIR.old"; fi
  mv "$TMP_DIR/excali" "$INSTALL_DIR"
  rm -rf "$INSTALL_DIR.old"

  APP_DIR="$INSTALL_DIR"
  NODE_BIN="$INSTALL_DIR/runtime/node"
  mkdir -p "$BIN_DIR"
  rm -f "$BIN_DIR/excali"
  printf '#!/bin/sh\nexec "%s" "%s/bin/excali.mjs" "$@"\n' "$NODE_BIN" "$APP_DIR" >"$BIN_DIR/excali"
  chmod +x "$BIN_DIR/excali"
}

install_source() {
  if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
    echo "소스 설치에는 Node.js 20 이상이 필요합니다. Node 없이 쓰려면 README의 한 줄 설치 명령을 쓰세요." >&2
    exit 1
  fi
  echo "==> 의존성 설치와 빌드"
  (cd "$SCRIPT_DIR" && npm install --no-fund --no-audit && npm run build)
  APP_DIR="$SCRIPT_DIR"
  NODE_BIN="$(command -v node)"
  mkdir -p "$BIN_DIR"
  chmod +x "$APP_DIR/bin/excali.mjs"
  ln -sfn "$APP_DIR/bin/excali.mjs" "$BIN_DIR/excali"
}

link_skill() {
  local linked=0 agent_home
  echo "==> 에이전트 스킬 연결"
  for agent_home in "${AGENT_HOMES[@]}"; do
    [ -d "$agent_home" ] || continue
    mkdir -p "$agent_home/skills"
    ln -sfn "$APP_DIR/skill/$SKILL_NAME" "$agent_home/skills/$SKILL_NAME"
    linked=$((linked + 1))
    echo "    $agent_home/skills/$SKILL_NAME"
  done
  [ "$linked" -gt 0 ] || echo "    ~/.claude 나 ~/.codex 가 없어 건너뜁니다. 에이전트를 먼저 설치한 뒤 --skill 로 다시 실행하세요."
}

add_to_path() {
  local rc
  case ":$PATH:" in *":$BIN_DIR:"*) return ;; esac
  case "$(basename "${SHELL:-}")" in
    zsh) rc="$HOME/.zshrc" ;;
    bash) [ "$(uname -s)" = "Darwin" ] && rc="$HOME/.bash_profile" || rc="$HOME/.bashrc" ;;
    *) rc="$HOME/.profile" ;;
  esac
  if ! grep -qs "$BIN_DIR" "$rc"; then
    printf '\n# excali\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >>"$rc"
    echo "==> $rc 에 PATH 추가: $BIN_DIR"
  fi
  echo "    새 터미널부터 'excali'로 실행됩니다. 지금 창에서는 $BIN_DIR/excali 로 실행하세요."
}

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/src/app.jsx" ]; then
  install_source
else
  install_release
fi
echo "==> excali 명령 연결: $BIN_DIR/excali"
echo "==> 실행 중인 뷰어 끄기 (새 화면과 맞지 않는 예전 서버가 남지 않게)"
"$NODE_BIN" "$APP_DIR/bin/excali.mjs" stop

if [ "$skill_choice" = "yes" ]; then link_skill; fi

echo "==> PNG용 브라우저 확인"
"$NODE_BIN" "$APP_DIR/bin/excali.mjs" setup-browser

add_to_path
echo "완료. 'excali --help'로 확인하세요."
