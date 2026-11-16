# Maintainer-only Windows x64 pack builder. Run from the repository root:
#   pwsh runtime-build/build-windows.ps1 -Out "$env:RUNNER_TEMP\cg-py-pack" [-Pack all]
# Requires uv, node and npm. Package names/versions come from runtime/manifest.json.
param(
  [string]$Out = (Join-Path $env:RUNNER_TEMP 'cg-py-pack'),
  [ValidateSet('base', 'parquet', 'all')]
  [string]$Pack = 'all'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ManifestPath = Join-Path $Root 'runtime\manifest.json'
$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$PythonVersion = $Manifest.python
$Target = 'win32-x64'
$Version = $Manifest.packs.base.targets.PSObject.Properties[$Target].Value.version
$PackScript = Join-Path $Root 'runtime-build\pack.mjs'

Remove-Item $Out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $Out -Force | Out-Null
Write-Host "build-windows: $Target / CPython $PythonVersion / packs=$Pack"

$EmbedZip = Join-Path $Out 'python-embed.zip'
$EmbedUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
Invoke-WebRequest -Uri $EmbedUrl -OutFile $EmbedZip
Expand-Archive -Path $EmbedZip -DestinationPath (Join-Path $Out 'python') -Force
Remove-Item $EmbedZip -Force
# pythonw is not used; the console interpreter is the only entry point.
Remove-Item (Join-Path $Out 'python\pythonw.exe') -Force -ErrorAction SilentlyContinue

# Install wheels with uv's full CPython so the embeddable does not need pip/ensurepip. Native
# wheels are cp313-win_amd64, matching the embeddable interpreter.
uv python install $PythonVersion
$BuildPython = (& uv python find $PythonVersion).Trim()
if (-not (Test-Path $BuildPython)) { throw "uv python find 没有给出解释器：$BuildPython" }

$BaseDeps = @($Manifest.packs.base.packages.PSObject.Properties | ForEach-Object { "$($_.Name)==$($_.Value)" })
& uv pip install --python $BuildPython --target (Join-Path $Out 'site-packages') `
  --no-cache --only-binary=:all: --no-deps @BaseDeps
if ($LASTEXITCODE -ne 0) { throw 'uv pip install base 失败' }

# Embeddable archives have no test suites, but wheel tests and caches still get in the way.
Get-ChildItem -Path (Join-Path $Out 'site-packages') -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
  Remove-Item -Recurse -Force
Get-ChildItem -Path (Join-Path $Out 'site-packages') -Recurse -File -Filter '*.pyc' -ErrorAction SilentlyContinue |
  Remove-Item -Force
Remove-Item (Join-Path $Out 'site-packages\.lock') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Out 'site-packages\bin') -Recurse -Force -ErrorAction SilentlyContinue

if ($Pack -eq 'base' -or $Pack -eq 'all') {
  & node $PackScript --kind base --target $Target --out $Out --version $Version `
    --python-dir (Join-Path $Out 'python') --site-dir (Join-Path $Out 'site-packages') `
    --extra-license "CPython=$(Join-Path $Out 'python\LICENSE.txt')"
  if ($LASTEXITCODE -ne 0) { throw 'pack base 失败' }
}

if ($Pack -eq 'parquet' -or $Pack -eq 'all') {
  $ParquetSite = Join-Path $Out 'parquet-site-packages'
  Remove-Item $ParquetSite -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $ParquetSite -Force | Out-Null
  $Pyarrow = $Manifest.packs.parquet.packages.pyarrow
  & uv pip install --python $BuildPython --target $ParquetSite `
    --no-cache --only-binary=:all: --no-deps "pyarrow==$Pyarrow"
  if ($LASTEXITCODE -ne 0) { throw 'uv pip install parquet 失败' }
  Get-ChildItem -Path $ParquetSite -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force
  Get-ChildItem -Path $ParquetSite -Recurse -File -Filter '*.pyc' -ErrorAction SilentlyContinue |
    Remove-Item -Force
  Remove-Item (Join-Path $ParquetSite '.lock') -Force -ErrorAction SilentlyContinue
  & node $PackScript --kind parquet --target $Target --out $Out --version $Version `
    --site-dir $ParquetSite --extra-license "CPython=$(Join-Path $Out 'python\LICENSE.txt')"
  if ($LASTEXITCODE -ne 0) { throw 'pack parquet 失败' }
}

Write-Host "build-windows: done"
Get-ChildItem (Join-Path $Out '*.tgz') | ForEach-Object { Write-Host "  $($_.Name) $([math]::Round($_.Length / 1MB, 1)) MB" }
