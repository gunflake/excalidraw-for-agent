#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${EXCALI_BIN_DIR:-$HOME/.local/bin}"
AGENT_HOMES=("$HOME/.claude" "$HOME/.codex")
SKILL_NAME="excalidraw-diagram"
SKILL_PROMPT="스킬도 설치할까요? 스킬을 설치하면 다이어그램이나 플로차트를 요청할 때 에이전트가 이 스킬을 참고해 그립니다."

usage() {
  cat <<EOF
사용법: ./install.sh [--skill | --no-skill]
  --skill     묻지 않고 에이전트 스킬까지 설치
  --no-skill  스킬 없이 excali 명령만 설치
옵션이 없으면 스킬 설치 여부를 묻습니다.
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
  if [ -t 0 ]; then
    read -r -p "$SKILL_PROMPT [Y/n] " answer
    case "$answer" in [nN]*) skill_choice="no" ;; *) skill_choice="yes" ;; esac
  else
    echo "입력을 받을 수 없어 스킬은 건너뜁니다. 스킬까지 설치하려면 --skill 을 붙여 다시 실행하세요."
    skill_choice="no"
  fi
fi

echo "==> 의존성 설치와 빌드"
cd "$REPO_DIR"
npm install --no-fund --no-audit
npm run build

echo "==> excali 명령 연결: $BIN_DIR/excali"
mkdir -p "$BIN_DIR"
chmod +x "$REPO_DIR/bin/excali.mjs"
ln -sfn "$REPO_DIR/bin/excali.mjs" "$BIN_DIR/excali"

if [ "$skill_choice" = "yes" ]; then
  echo "==> 에이전트 스킬 연결"
  linked=0
  for agent_home in "${AGENT_HOMES[@]}"; do
    [ -d "$agent_home" ] || continue
    mkdir -p "$agent_home/skills"
    ln -sfn "$REPO_DIR/skill/$SKILL_NAME" "$agent_home/skills/$SKILL_NAME"
    linked=$((linked + 1))
    echo "    $agent_home/skills/$SKILL_NAME"
  done
  [ "$linked" -gt 0 ] || echo "    ~/.claude 나 ~/.codex 가 없어 건너뜁니다. 에이전트를 먼저 설치한 뒤 --skill 로 다시 실행하세요."
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "주의: $BIN_DIR 가 PATH에 없습니다. 셸 설정에 추가하세요." ;;
esac

echo "완료. 'excali --help'로 확인하세요."
