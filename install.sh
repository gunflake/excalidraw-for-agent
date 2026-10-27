#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${EXCALI_BIN_DIR:-$HOME/.local/bin}"
SKILL_DIRS=("$HOME/.claude/skills" "$HOME/.codex/skills")
SKILL_NAME="excalidraw-diagram"

echo "==> 의존성 설치와 빌드"
cd "$REPO_DIR"
npm install --no-fund --no-audit
npm run build

echo "==> excali 명령 연결: $BIN_DIR/excali"
mkdir -p "$BIN_DIR"
chmod +x "$REPO_DIR/bin/excali.mjs"
ln -sfn "$REPO_DIR/bin/excali.mjs" "$BIN_DIR/excali"

echo "==> 에이전트 스킬 연결"
linked=()
for dir in "${SKILL_DIRS[@]}"; do
  [ -d "$dir" ] || continue
  real_dir="$(cd "$dir" && pwd -P)"
  case " ${linked[*]-} " in *" $real_dir "*) continue ;; esac
  ln -sfn "$REPO_DIR/skill/$SKILL_NAME" "$dir/$SKILL_NAME"
  linked+=("$real_dir")
  echo "    $dir/$SKILL_NAME"
done
[ ${#linked[@]} -gt 0 ] || echo "    ~/.claude/skills 또는 ~/.codex/skills가 없어 건너뜁니다."

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "주의: $BIN_DIR 가 PATH에 없습니다. 셸 설정에 추가하세요." ;;
esac

echo "완료. 'excali --help'로 확인하세요."
