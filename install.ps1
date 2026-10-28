param(
  [switch]$Skill,
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
$AgentHomes = @((Join-Path $HOME ".claude"), (Join-Path $HOME ".codex"))
$SkillPrompt = "스킬도 설치할까요? 스킬을 설치하면 다이어그램이나 플로차트를 요청할 때 에이전트가 이 스킬을 참고해 그립니다."
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

function Install-Skill($appDir) {
  Write-Host "==> 에이전트 스킬 연결"
  $source = Join-Path $appDir "skill\$SkillName"
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

$installed = if ($SourceDir) { Install-Source } else { Install-Release }
if ($installSkill) { Install-Skill $installed.AppDir }

Write-Host "==> PNG용 브라우저 확인"
& $installed.Node (Join-Path $installed.AppDir "bin\excali.mjs") setup-browser
if ($LASTEXITCODE -ne 0) { throw "PNG용 브라우저 준비 실패" }

Write-Host "완료. 새 터미널에서 'excali --help'로 확인하세요."
