# Build and exercise the production NSIS macros in an isolated per-user registry tree.
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testId = [guid]::NewGuid().ToString()
$testRoot = Join-Path $workspace ".local\installer-smoke\$testId"
$packedPath = Join-Path $workspace 'release\win-unpacked'
$installDirectory = Join-Path $testRoot '安装目录 with spaces'
$registryRoot = "Software\OpenTyporaInstallerSmoke\$testId"
$classesPath = "HKCU:\$registryRoot\Classes"
$uninstallPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$testId"

function Assert-Check($condition, [string]$message) { if (-not $condition) { throw $message } }
function File-Hash([string]$path) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { [BitConverter]::ToString($hash.ComputeHash([IO.File]::ReadAllBytes($path))) } finally { $hash.Dispose() }
}
function Registry-Default([string]$path) { if (Test-Path -LiteralPath $path) { (Get-Item -LiteralPath $path).GetValue('') } }
function Wait-Removed {
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while ((Test-Path -LiteralPath $uninstallPath) -or (Test-Path -LiteralPath (Join-Path $installDirectory 'OpenTypora.exe'))) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Uninstaller did not finish within 45 seconds' }
        Start-Sleep -Milliseconds 200
    }
}
function Uninstall-TestApp {
    $uninstaller = Join-Path $installDirectory 'Uninstall OpenTypora.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
        Assert-Check ($process.ExitCode -eq 0) "Uninstaller exit code: $($process.ExitCode)"
        Wait-Removed
    }
}

Assert-Check (Test-Path -LiteralPath (Join-Path $packedPath 'OpenTypora.exe')) 'Run npm run package before testing the installer'
Assert-Check ($testRoot.StartsWith((Join-Path $workspace '.local\installer-smoke\'), [StringComparison]::OrdinalIgnoreCase)) 'Unsafe test directory'
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
try {
    $package = Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json
    $config = $package.build
    $config.appId = "org.opentypora.installer-smoke.$testId"
    $config.directories.output = Join-Path $testRoot 'output'
    $config.nsis | Add-Member -NotePropertyName guid -NotePropertyValue $testId
    $config.nsis.uninstallDisplayName = "OpenTypora Installer Smoke $testId"
    $config.nsis.createDesktopShortcut = $false
    $config.nsis.createStartMenuShortcut = $false
    $config.nsis.artifactName = 'InstallerSmoke.exe'
    $config.nsis.include = Join-Path $testRoot 'installer.nsh'
    @"
!define OPENTYPORA_CLASSES_ROOT "$registryRoot\Classes"
!include "`$`{PROJECT_DIR`}\build\installer.nsh"
"@ | Set-Content -LiteralPath $config.nsis.include -Encoding UTF8
    $configPath = Join-Path $testRoot 'builder.json'
    $config | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $configPath -Encoding UTF8
    Push-Location $workspace
    try {
        & npx.cmd electron-builder --config $configPath --prepackaged $packedPath --win nsis --x64 --publish never
        Assert-Check ($LASTEXITCODE -eq 0) 'Isolated installer build failed'
    } finally { Pop-Location }

    # Unrelated associations must survive both install and uninstall.
    New-Item -Path "$classesPath\.md\OpenWithProgids" -Force | Out-Null
    Set-Item -LiteralPath "$classesPath\.md" -Value 'OtherEditor.Markdown'
    New-ItemProperty -LiteralPath "$classesPath\.md\OpenWithProgids" -Name 'OtherEditor.Markdown' -Value '' -PropertyType String | Out-Null
    $documentPath = Join-Path $testRoot '用户文档 unchanged.md'
    '# User document: must survive uninstall' | Set-Content -LiteralPath $documentPath -Encoding UTF8
    $beforeHash = (File-Hash $documentPath)
    $setup = Join-Path $testRoot 'output\InstallerSmoke.exe'
    $process = Start-Process -FilePath $setup -ArgumentList @('/S', "/D=$installDirectory") -WindowStyle Hidden -Wait -PassThru
    Assert-Check ($process.ExitCode -eq 0) "Installer exit code: $($process.ExitCode)"
    $executable = Join-Path $installDirectory 'OpenTypora.exe'
    $command = '"' + $executable + '" "%1"'
    $verb = "$classesPath\SystemFileAssociations\.md\shell\OpenTypora"
    $application = "$classesPath\Applications\OpenTypora.exe"
    $progid = "$classesPath\OpenTypora.Markdown"
    Assert-Check (Test-Path -LiteralPath $executable) 'Application was not installed'
    Assert-Check (Test-Path -LiteralPath (Join-Path $installDirectory 'Uninstall OpenTypora.exe')) 'Uninstaller was not created'
    Assert-Check (Test-Path -LiteralPath $uninstallPath) 'Windows Apps uninstall entry is missing'
    Assert-Check ((Get-ItemProperty -LiteralPath $uninstallPath).UninstallString.Contains('Uninstall OpenTypora.exe')) 'Uninstall entry points to the wrong executable'
    Assert-Check ((Registry-Default "$verb\command") -eq $command) 'Context-menu command did not quote the executable and file argument'
    Assert-Check ((Registry-Default "$application\shell\open\command") -eq $command) 'Open with command is missing'
    Assert-Check ((Registry-Default "$progid\shell\open\command") -eq $command) 'Markdown ProgID is missing'
    Assert-Check ((Get-Item -LiteralPath "$classesPath\.md\OpenWithProgids").GetValueNames().Contains('OpenTypora.Markdown')) 'Open with candidate is missing'
    Assert-Check ((Registry-Default "$classesPath\.md") -eq 'OtherEditor.Markdown') 'Installer changed the default editor'
    # The installed binary uses hidden windows and isolated user data for its own smoke run.
    $stdout = Join-Path $testRoot 'desktop.stdout.log'
    $stderr = Join-Path $testRoot 'desktop.stderr.log'
    $process = Start-Process -FilePath $executable -ArgumentList '--smoke-test' -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    if ($process.ExitCode -ne 0) {
        Get-Content -LiteralPath $stdout -Raw | Write-Output
        Get-Content -LiteralPath $stderr -Raw | Write-Output
    }
    Assert-Check ($process.ExitCode -eq 0) "Installed application smoke test failed: exit $($process.ExitCode)"
    Assert-Check ((Get-Content -LiteralPath $stdout -Raw).Contains('"desktopSmoke":true')) 'Installed application did not report a successful smoke run'
    Uninstall-TestApp
    Assert-Check (-not (Test-Path -LiteralPath $verb)) 'Context-menu entry survived uninstall'
    Assert-Check (-not (Test-Path -LiteralPath $application)) 'Application registration survived uninstall'
    Assert-Check (-not (Test-Path -LiteralPath $progid)) 'ProgID survived uninstall'
    Assert-Check ((Registry-Default "$classesPath\.md") -eq 'OtherEditor.Markdown') 'Uninstaller removed the existing default editor'
    Assert-Check ((Get-Item -LiteralPath "$classesPath\.md\OpenWithProgids").GetValueNames().Contains('OtherEditor.Markdown')) 'Uninstaller removed another editor'
    Assert-Check ((File-Hash $documentPath) -eq $beforeHash) 'Uninstaller changed user documents'
    # A newer installation owns its own command; this older uninstaller must leave it intact.
    $process = Start-Process -FilePath $setup -ArgumentList @('/S', "/D=$installDirectory") -WindowStyle Hidden -Wait -PassThru
    Assert-Check ($process.ExitCode -eq 0) 'Second install failed'
    $newerCommand = '"C:\Newer OpenTypora\OpenTypora.exe" "%1"'
    Set-Item -LiteralPath "$verb\command" -Value $newerCommand
    Set-Item -LiteralPath "$application\shell\open\command" -Value $newerCommand
    Set-Item -LiteralPath "$progid\shell\open\command" -Value $newerCommand
    Uninstall-TestApp
    Assert-Check ((Registry-Default "$verb\command") -eq $newerCommand) 'Older uninstaller removed a newer context-menu command'
    Assert-Check ((Registry-Default "$application\shell\open\command") -eq $newerCommand) 'Older uninstaller removed a newer application registration'
    Assert-Check ((Registry-Default "$progid\shell\open\command") -eq $newerCommand) 'Older uninstaller removed a newer ProgID'
    @{ installerSmoke=$true; contextMenu=$true; openWith=$true; uninstaller=$true; defaultEditorPreserved=$true; userDocumentsPreserved=$true; installedAppSmoke=$true; newerRegistrationPreserved=$true } | ConvertTo-Json -Compress
} finally {
    Uninstall-TestApp
    if (Test-Path -LiteralPath "HKCU:\$registryRoot") { Remove-Item -LiteralPath "HKCU:\$registryRoot" -Recurse -Force }
    # Only this generated test directory is removed, after validating its workspace boundary above.
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
