param(
    [Parameter(Mandatory)][string]$Compiler,
    [Parameter(Mandatory)][string]$FontDirectory,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [switch]$Baseline
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$sketchDirectory = Join-Path $repo 'bomb_defusal_final'
$source = Get-Content -LiteralPath (Join-Path $sketchDirectory 'bomb_defusal_final.ino') -Raw
$source = $source -replace '(?m)^#include (?:<Wire\.h>|<Keypad\.h>|<Adafruit_GFX\.h>|<Adafruit_SSD1306\.h>|"BridgeTransport\.h")\s*\r?\n', ''
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$out = (Resolve-Path -LiteralPath $OutputDirectory).Path
Set-Content -LiteralPath (Join-Path $out 'Sketch.h') -Value $source -Encoding utf8NoBOM
$binary = Join-Path $out 'firmware-test.exe'
& $Compiler -std=c++17 -Wall -Wextra -Wno-sign-compare -Wno-format-truncation -I $FontDirectory -I $sketchDirectory -I $out (Join-Path $PSScriptRoot 'firmware_test.cpp') -o $binary
if ($LASTEXITCODE -ne 0) { throw 'Host firmware compilation failed' }
& $binary $out $(if ($Baseline) { 'baseline' } else { 'after' })
if ($LASTEXITCODE -ne 0) { throw 'Host firmware checks failed' }
