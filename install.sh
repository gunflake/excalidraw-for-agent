#!/usr/bin/env bash
set -euo pipefail

REPO="gunflake/excalidraw-for-agent"
DOWNLOAD_BASE="${EXCALI_DOWNLOAD_BASE:-https://github.com/$REPO/releases/latest/download}"
INSTALL_DIR="${EXCALI_INSTALL_DIR:-$HOME/.excali/app}"
BIN_DIR="${EXCALI_BIN_DIR:-$HOME/.local/bin}"
SKILL_NAME="excalidraw-diagram"
EXCALI_DIR="$(dirname "$INSTALL_DIR")"
INSTALL_STATE="$EXCALI_DIR/install.json"
SHIPPED_SKILL="$EXCALI_DIR/skill-shipped"
BACKUP_ROOT="$EXCALI_DIR/backups/$(date +%Y%m%d-%H%M%S)"
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

usage() {
  cat <<EOF
사용법: install.sh [--skill global | --skill project [--project-dir <폴더>] | --no-skill]
  --skill global         모든 프로젝트에서 쓰도록 스킬 연결 (~/.claude/skills, ~/.agents/skills)
  --skill project        한 프로젝트에서만 쓰도록 스킬 복사 (<폴더>/.claude/skills, <폴더>/.agents/skills)
  --project-dir <폴더>   --skill project의 대상 폴더 (기본: 현재 폴더)
  --no-skill             스킬 없이 excali 명령만 설치
  --update               묻지 않고 새 버전으로 바꾸고, 설치 때 넣은 스킬 위치를 모두 갱신 (excali update가 씀)
옵션이 없으면 스킬을 어디에 설치할지 묻고, 물을 수 없으면 모든 프로젝트용으로 설치합니다.
스킬은 ~/.claude가 있으면 Claude Code용, ~/.codex가 있으면 Codex용으로 넣습니다.

Node.js가 들어 있는 배포본을 받아 $INSTALL_DIR 에 설치합니다.
저장소를 clone한 폴더에서 실행하면 그 소스를 빌드해 연결합니다 (Node.js 20 이상 필요).
EOF
}

skill_scope=""
project_dir="$PWD"
update=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skill)
      case "${2:-}" in
        global | project) skill_scope="$2"; shift ;;
        *) skill_scope="global" ;;
      esac
      ;;
    --project-dir) project_dir="${2:?--project-dir 뒤에 폴더를 적으세요}"; shift ;;
    --no-skill) skill_scope="none" ;;
    --update) update=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
  shift
done

ask_skill_scope() {
  local choice dir
  printf '\nexcali 스킬을 어디에 설치할까요? 스킬이 있으면 다이어그램을 요청할 때 에이전트가 이 스킬을 참고해 그립니다.\n' >/dev/tty
  printf '  1) 모든 프로젝트에서 쓰기 (추천)\n  2) 특정 프로젝트 폴더에서만 쓰기\n  3) 설치하지 않기\n' >/dev/tty
  read -r -p "번호 [1]: " choice </dev/tty
  case "${choice:-1}" in
    2)
      read -r -p "프로젝트 폴더 [$PWD]: " dir </dev/tty
      skill_scope="project"
      project_dir="${dir:-$PWD}"
      ;;
    3) confirm_no_skill ;;
    *) skill_scope="global" ;;
  esac
}

confirm_no_skill() {
  local choice
  printf '\n스킬이 없으면 에이전트가 excali 쓰는 법을 모릅니다. 그림을 부탁할 때마다 사용법 문서를 읽으라고 직접 알려 줘야 하고,\n' >/dev/tty
  printf '"그림으로 설명해줘"라고만 하면 excali 대신 Mermaid나 글로 답합니다. 그래도 설치하지 않을까요?\n' >/dev/tty
  printf '  1) 모든 프로젝트에서 쓰기 (추천)\n  2) 그래도 설치하지 않기\n' >/dev/tty
  read -r -p "번호 [1]: " choice </dev/tty
  case "${choice:-1}" in
    2) skill_scope="none" ;;
    *) skill_scope="global" ;;
  esac
}

if [ "$update" = 1 ]; then
  skill_scope="recorded"
elif [ -z "$skill_scope" ]; then
  if { : </dev/tty; } 2>/dev/null; then
    ask_skill_scope
  else
    echo "입력을 받을 수 없어 스킬을 모든 프로젝트용으로 설치합니다. 원하지 않으면 --no-skill 을 붙여 다시 실행하세요."
    skill_scope="global"
  fi
fi
if [ "$skill_scope" = "project" ]; then
  project_dir="${project_dir/#\~/$HOME}"
  if [ ! -d "$project_dir" ]; then
    echo "프로젝트 폴더가 없습니다: $project_dir" >&2
    exit 1
  fi
  project_dir="$(cd "$project_dir" && pwd)"
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

skill_dirs() {
  local base="$1"
  if [ -d "$HOME/.claude" ]; then echo "$base/.claude/skills"; fi
  if [ -d "$HOME/.codex" ]; then echo "$base/.agents/skills"; fi
}

backup_if_edited() {
  local dir="$1" dest="$BACKUP_ROOT/$2" reference="$SHIPPED_SKILL"
  [ -d "$dir" ] || return 0
  [ -d "$reference" ] || reference="$APP_DIR/skill/$SKILL_NAME"
  if diff -rq "$reference" "$dir" >/dev/null 2>&1; then return 0; fi
  mkdir -p "$(dirname "$dest")"
  cp -R "$dir" "$dest"
  echo "    직접 고친 스킬이 있어 보관했습니다: $dest"
}

record_install() {
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const [path, scope, dir] = process.argv.slice(1);
    const state = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : { global: false, projects: [] };
    if (scope === "global") state.global = true;
    if (scope === "project" && !state.projects.includes(dir)) state.projects.push(dir);
    fs.writeFileSync(path, JSON.stringify(state, null, 2));
  ' "$INSTALL_STATE" "$1" "${2:-}"
}

recorded_scopes() {
  if [ -f "$INSTALL_STATE" ]; then
    "$NODE_BIN" -e '
      const state = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
      if (state.global) console.log("global");
      state.projects.forEach((dir) => console.log(`project ${dir}`));
    ' "$INSTALL_STATE"
    return
  fi
  if [ -L "$HOME/.claude/skills/$SKILL_NAME" ] || [ -L "$HOME/.agents/skills/$SKILL_NAME" ]; then echo "global"; fi
}

update_skills() {
  local scope dir
  while IFS=' ' read -r scope dir; do
    [ -n "$scope" ] || continue
    if [ "$scope" = "project" ] && [ ! -d "$dir" ]; then
      echo "    프로젝트 폴더가 없어 건너뜁니다: $dir"
      continue
    fi
    skill_scope="$scope"
    project_dir="${dir:-$PWD}"
    install_skill
    record_install "$scope" "$dir"
  done <<<"$(recorded_scopes)"
}

install_skill() {
  local source="$APP_DIR/skill/$SKILL_NAME" base dirs dir target
  if [ "$skill_scope" = "global" ]; then
    echo "==> 에이전트 스킬 연결 (모든 프로젝트)"
    base="$HOME"
    if [ -L "$HOME/.codex/skills/$SKILL_NAME" ]; then unlink "$HOME/.codex/skills/$SKILL_NAME"; fi
    backup_if_edited "$INSTALL_DIR.old/skill/$SKILL_NAME" global
  else
    echo "==> 에이전트 스킬 복사 (프로젝트: $project_dir)"
    base="$project_dir"
  fi
  dirs="$(skill_dirs "$base")"
  if [ -z "$dirs" ]; then
    echo "    ~/.claude 나 ~/.codex 가 없어 건너뜁니다. 에이전트를 먼저 설치한 뒤 다시 실행하세요."
    return
  fi
  while IFS= read -r dir; do
    target="$dir/$SKILL_NAME"
    mkdir -p "$dir"
    if [ "$skill_scope" = "global" ]; then
      if [ -e "$target" ] && [ ! -L "$target" ]; then
        echo "$target 에 링크가 아닌 폴더가 있습니다. 직접 지운 뒤 다시 실행하세요." >&2
        exit 1
      fi
      ln -sfn "$source" "$target"
    else
      if [ -L "$target" ]; then unlink "$target"; fi
      backup_if_edited "$target" "projects$target"
      mkdir -p "$target"
      cp -R "$source/." "$target/"
    fi
    echo "    $target"
  done <<<"$dirs"
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

if [ "$update" = 1 ]; then
  update_skills
elif [ "$skill_scope" != "none" ]; then
  install_skill
  record_install "$skill_scope" "$project_dir"
fi
rm -rf "$SHIPPED_SKILL" "$INSTALL_DIR.old"
cp -R "$APP_DIR/skill/$SKILL_NAME" "$SHIPPED_SKILL"

echo "==> PNG용 브라우저 확인"
"$NODE_BIN" "$APP_DIR/bin/excali.mjs" setup-browser

add_to_path
if [ "$skill_scope" = "none" ]; then
  echo "    스킬 없이 설치했습니다. 그림을 부탁할 때 에이전트에게 이렇게 알려 주세요:"
  echo "    \"$APP_DIR/skill/$SKILL_NAME/SKILL.md 를 읽고 그대로 그려줘\""
  echo "    나중에 스킬을 넣으려면 설치 명령을 다시 실행하세요."
fi
echo "완료. 'excali --help'로 확인하세요."
