# Opt-in isolated native-window test. No user tray clicks or backend startup.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
Push-Location $taskRoot
try {
    $artifacts = cargo test --release --manifest-path src-tauri/Cargo.toml --lib --features custom-protocol,native-smoke --no-run --message-format=json
    if ($LASTEXITCODE -ne 0) { throw 'Native test build failed' }
    $testExe = $artifacts | ForEach-Object { if ($_.StartsWith('{')) { $_ | ConvertFrom-Json } } | Where-Object { $_.reason -eq 'compiler-artifact' -and $_.profile.test -and $_.executable } | Select-Object -Last 1 -ExpandProperty executable
    if (!$testExe) { throw 'Missing native test executable' }
    $mt = Get-Command mt.exe -ErrorAction SilentlyContinue
    $mtPath = if ($mt) { $mt.Source } else { rg --files "${env:ProgramFiles(x86)}/Windows Kits/10/bin" -g mt.exe | Where-Object { $_ -match '[\\/]x64[\\/]mt.exe$' } | Sort-Object | Select-Object -Last 1 }
    if (!$mtPath) { throw 'Windows SDK mt.exe is required for the GUI test manifest' }
    $manifest = Join-Path $env:TEMP ('dsh-tray-test-' + [Guid]::NewGuid().ToString() + '.manifest')
    [IO.File]::WriteAllText($manifest, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" /></dependentAssembly></dependency></assembly>', [Text.UTF8Encoding]::new($false))
    & $mtPath -nologo -manifest $manifest "-outputresource:$testExe;#1"
    if ($LASTEXITCODE -ne 0) { throw 'Test manifest embedding failed' }
    & $testExe --ignored native_window_restore --test-threads=1 --nocapture
    if ($LASTEXITCODE -ne 0) { throw 'Native restore test failed' }
} finally { Pop-Location }
