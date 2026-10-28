param(
  [ValidateSet("global", "project")][string]$Skill,
  [string]$ProjectDir = (Get-Location).Path,
  [switch]$NoSkill
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Repo = "gunflake/excalidraw-for-agent"
$DownloadBase = if ($env:EXCALI_DOWNLOAD_BASE) { $env:EXCALI_DOWNLOAD_BASE } else { "https://github.com/$Repo/releases/latest/download" }
$ExcaliHome = Join-Path $HOME ".excali"
$InstallDir = Join-Path $ExcaliHome "app"
$BinDir = Join-Path $ExcaliHome "bin"
$SkillName = "excalidraw-diagram"
$SourceDir = if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "src\app.jsx"))) { $PSScriptRoot } else { $null }

function Invoke-Npm {
  npm @args | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "npm $($args -join ' ') 실패" }
}

function Get-ReleaseTarget {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  if ($arch -eq "Arm64") { return "win-arm64" }
  return "win-x64"
}

function Install-Release {
  $target = Get-ReleaseTarget
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("excali-" + [Guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    Write-Host "==> 배포본 내려받기: excali-$target.zip"
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $archive = Join-Path $tmp "excali.zip"
    Invoke-WebRequest -UseBasicParsing -Uri "$DownloadBase/excali-$target.zip" -OutFile $archive
    Expand-Archive -Path $archive -DestinationPath $tmp -Force

    $newApp = Join-Path $tmp "excali"
    Write-Host "==> 실행 중인 뷰어 끄기"
    & (Join-Path $newApp "runtime\node.exe") (Join-Path $newApp "bin\excali.mjs") stop | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "실행 중인 뷰어를 끄지 못해 설치를 멈춥니다." }
    Write-Host "==> 설치: $InstallDir"
    New-Item -ItemType Directory -Force -Path $ExcaliHome | Out-Null
    if (Test-Path $InstallDir) { Remove-Item -Recurse -Force $InstallDir }
    Move-Item $newApp $InstallDir
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  Set-Content -Path (Join-Path $BinDir "excali.cmd") -Encoding Ascii -Value '@"%~dp0..\app\runtime\node.exe" "%~dp0..\app\bin\excali.mjs" %*'
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $entries = if ($userPath) { $userPath -split ";" } else { @() }
  if ($entries -notcontains $BinDir) {
    [Environment]::SetEnvironmentVariable("Path", (@($entries | Where-Object { $_ }) + $BinDir) -join ";", "User")
    Write-Host "==> 사용자 PATH에 추가: $BinDir"
  }
  if (($env:Path -split ";") -notcontains $BinDir) { $env:Path = "$BinDir;$env:Path" }
  return @{ AppDir = $InstallDir; Node = Join-Path $InstallDir "runtime\node.exe" }
}

function Install-Source {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "소스 설치에는 Node.js 20 이상이 필요합니다. Node 없이 쓰려면 README의 한 줄 설치 명령을 쓰세요."
  }
  Write-Host "==> 의존성 설치와 빌드"
  Push-Location $SourceDir
  try {
    Invoke-Npm install --no-fund --no-audit
    Invoke-Npm run build
    Write-Host "==> excali 명령 연결 (npm link)"
    Invoke-Npm link --no-fund --no-audit
  } finally {
    Pop-Location
  }
  return @{ AppDir = $SourceDir; Node = (Get-Command node).Source }
}

function Get-SkillDirs($base) {
  $dirs = @()
  if (Test-Path (Join-Path $HOME ".claude")) { $dirs += Join-Path $base ".claude\skills" }
  if (Test-Path (Join-Path $HOME ".codex")) { $dirs += Join-Path $base ".agents\skills" }
  return $dirs
}

function Test-Link($path) {
  return (Get-Item $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint
}

function Install-Skill($appDir, $scope, $projectDir) {
  $source = Join-Path $appDir "skill\$SkillName"
  if ($scope -eq "global") {
    Write-Host "==> 에이전트 스킬 연결 (모든 프로젝트)"
    $base = $HOME
    $oldLink = Join-Path $HOME ".codex\skills\$SkillName"
    if ((Test-Path $oldLink) -and (Test-Link $oldLink)) { cmd /c rmdir "$oldLink" | Out-Null }
  } else {
    Write-Host "==> 에이전트 스킬 복사 (프로젝트: $projectDir)"
    $base = $projectDir
  }
  $dirs = @(Get-SkillDirs $base)
  if ($dirs.Count -eq 0) {
    Write-Host "    ~/.claude 나 ~/.codex 가 없어 건너뜁니다. 에이전트를 먼저 설치한 뒤 다시 실행하세요."
    return
  }
  foreach ($dir in $dirs) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $target = Join-Path $dir $SkillName
    if ((Test-Path $target) -and (Test-Link $target)) { cmd /c rmdir "$target" | Out-Null }
    if ($scope -eq "global") {
      if (Test-Path $target) { throw "$target 에 링크가 아닌 폴더가 있습니다. 직접 지운 뒤 다시 실행하세요." }
      New-Item -ItemType Junction -Path $target -Target $source | Out-Null
    } else {
      New-Item -ItemType Directory -Force -Path $target | Out-Null
      Copy-Item -Recurse -Force (Join-Path $source "*") $target
    }
    Write-Host "    $target"
  }
}

function Read-SkillScope {
  Write-Host ""
  Write-Host "excali 스킬을 어디에 설치할까요? 스킬이 있으면 다이어그램을 요청할 때 에이전트가 이 스킬을 참고해 그립니다."
  Write-Host "  1) 모든 프로젝트에서 쓰기 (추천)"
  Write-Host "  2) 특정 프로젝트 폴더에서만 쓰기"
  Write-Host "  3) 설치하지 않기"
  $choice = Read-Host "번호 [1]"
  if ($choice -eq "2") {
    $dir = Read-Host "프로젝트 폴더 [$ProjectDir]"
    if ($dir) { $script:ProjectDir = $dir }
    return "project"
  }
  if ($choice -ne "3") { return "global" }
  Write-Host ""
  Write-Host "스킬이 없으면 에이전트가 excali 쓰는 법을 모릅니다. 그림을 부탁할 때마다 사용법 문서를 읽으라고 직접 알려 줘야 하고,"
  Write-Host """그림으로 설명해줘""라고만 하면 excali 대신 Mermaid나 글로 답합니다. 그래도 설치하지 않을까요?"
  Write-Host "  1) 모든 프로젝트에서 쓰기 (추천)"
  Write-Host "  2) 그래도 설치하지 않기"
  if ((Read-Host "번호 [1]") -eq "2") { return "none" }
  return "global"
}

if ($Skill -and $NoSkill) { throw "-Skill 과 -NoSkill 은 함께 쓸 수 없습니다." }
if ($Skill) {
  $skillScope = $Skill
} elseif ($NoSkill) {
  $skillScope = "none"
} elseif ([Console]::IsInputRedirected) {
  Write-Host "입력을 받을 수 없어 스킬을 모든 프로젝트용으로 설치합니다. 원하지 않으면 -NoSkill 을 붙여 다시 실행하세요."
  $skillScope = "global"
} else {
  $skillScope = Read-SkillScope
}
if ($skillScope -eq "project") {
  if (-not (Test-Path $ProjectDir -PathType Container)) { throw "프로젝트 폴더가 없습니다: $ProjectDir" }
  $ProjectDir = (Resolve-Path $ProjectDir).Path
}

$installed = if ($SourceDir) { Install-Source } else { Install-Release }
if ($skillScope -ne "none") { Install-Skill $installed.AppDir $skillScope $ProjectDir }

Write-Host "==> PNG용 브라우저 확인"
& $installed.Node (Join-Path $installed.AppDir "bin\excali.mjs") setup-browser
if ($LASTEXITCODE -ne 0) { throw "PNG용 브라우저 준비 실패" }

if ($skillScope -eq "none") {
  Write-Host "    스킬 없이 설치했습니다. 그림을 부탁할 때 에이전트에게 이렇게 알려 주세요:"
  Write-Host "    ""$(Join-Path $installed.AppDir "skill\$SkillName\SKILL.md") 를 읽고 그대로 그려줘"""
  Write-Host "    나중에 스킬을 넣으려면 설치 명령을 다시 실행하세요."
}
Write-Host "완료. 새 터미널에서 'excali --help'로 확인하세요."
