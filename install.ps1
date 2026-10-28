param(
  [switch]$Skill,
  [switch]$NoSkill
)

$ErrorActionPreference = "Stop"
$RepoDir = $PSScriptRoot
$SkillName = "excalidraw-diagram"
$AgentHomes = @((Join-Path $HOME ".claude"), (Join-Path $HOME ".codex"))
$SkillPrompt = "스킬도 설치할까요? 스킬을 설치하면 다이어그램이나 플로차트를 요청할 때 에이전트가 이 스킬을 참고해 그립니다."

function Invoke-Npm {
  npm @args
  if ($LASTEXITCODE -ne 0) { throw "npm $($args -join ' ') 실패" }
}

if ($Skill -and $NoSkill) { throw "-Skill 과 -NoSkill 은 함께 쓸 수 없습니다." }
if ($Skill) {
  $installSkill = $true
} elseif ($NoSkill) {
  $installSkill = $false
} elseif ([Console]::IsInputRedirected) {
  Write-Host "입력을 받을 수 없어 스킬은 건너뜁니다. 스킬까지 설치하려면 -Skill 을 붙여 다시 실행하세요."
  $installSkill = $false
} else {
  $answer = Read-Host "$SkillPrompt [Y/n]"
  $installSkill = -not ($answer -match "^[nN]")
}

Write-Host "==> 의존성 설치와 빌드"
Push-Location $RepoDir
try {
  Invoke-Npm install --no-fund --no-audit
  Invoke-Npm run build
  Write-Host "==> excali 명령 연결 (npm link)"
  Invoke-Npm link --no-fund --no-audit
} finally {
  Pop-Location
}

if ($installSkill) {
  Write-Host "==> 에이전트 스킬 연결"
  $source = Join-Path $RepoDir "skill\$SkillName"
  $linked = 0
  foreach ($agentHome in $AgentHomes) {
    if (-not (Test-Path $agentHome)) { continue }
    $skillsDir = Join-Path $agentHome "skills"
    New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null
    $target = Join-Path $skillsDir $SkillName
    if (Test-Path $target) {
      $existing = Get-Item $target -Force
      if (-not ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "$target 에 링크가 아닌 폴더가 있습니다. 직접 지운 뒤 다시 실행하세요."
      }
      cmd /c rmdir "$target" | Out-Null
    }
    New-Item -ItemType Junction -Path $target -Target $source | Out-Null
    $linked += 1
    Write-Host "    $target"
  }
  if ($linked -eq 0) {
    Write-Host "    ~/.claude 나 ~/.codex 가 없어 건너뜁니다. 에이전트를 먼저 설치한 뒤 -Skill 로 다시 실행하세요."
  }
}

if (-not (Get-Command excali -ErrorAction SilentlyContinue)) {
  Write-Host "주의: excali 명령을 찾지 못했습니다. 'npm prefix -g' 폴더가 PATH에 있는지 확인하세요."
}

Write-Host "완료. 'excali --help'로 확인하세요."
