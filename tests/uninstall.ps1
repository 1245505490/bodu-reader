param([switch]$KeepInstalled)

$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $workspace
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path $workspace '.local-fixtures\uninstall-validation'))
$installDirectory = [IO.Path]::GetFullPath((Join-Path $fixtureRoot '安装 验证目录'))
$qaOutput = Join-Path $fixtureRoot 'build'
$qaName = 'Bodu Uninstall QA'
$qaExecutable = 'BoduUninstallQA.exe'
$qaAppId = 'cn.bodu.reader.uninstall-qa'
$qaGuid = '793a63ac-43c9-4542-9ac0-a72140a7572c'
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$qaGuid"
$uninstaller = Join-Path $installDirectory "卸载$qaName.exe"
$programs = [Environment]::GetFolderPath('Programs')
$shortcut = Join-Path $programs "卸载$qaName.lnk"
$appShortcut = Join-Path $programs "$qaName.lnk"
$checks = [Collections.Generic.List[object]]::new()
$ownedMarkers = [Collections.Generic.List[string]]::new()
$ownedDirectories = [Collections.Generic.List[string]]::new()
$failure = $null

function Assert-InWorkspace([string]$target) {
  $absolute = [IO.Path]::GetFullPath($target)
  if (-not $absolute.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "测试目标超出工作区：$absolute" }
}
function Check([string]$name, [bool]$passed) {
  $checks.Add(@{ name = $name; pass = $passed })
  if (-not $passed) { throw "FAIL $name" }
  Write-Output "PASS $name"
}
function Run-Native([string]$file, [string[]]$nativeArguments) {
  $process = Start-Process -FilePath $file -ArgumentList $nativeArguments -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(45000)) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue; throw "测试程序超时：$file" }
  if ($process.ExitCode -ne 0) { throw "测试程序返回 $($process.ExitCode)：$file" }
}
function Registry-Snapshot([string]$subkey) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subkey)
  if ($null -eq $key) { return '<missing>' }
  try { $values = [ordered]@{}; foreach ($name in ($key.GetValueNames() | Sort-Object)) { $values[$name] = $key.GetValue($name) }; return ($values | ConvertTo-Json -Compress) }
  finally { $key.Dispose() }
}
function Assert-TestInstallation {
  Assert-InWorkspace $installDirectory
  $entry = Get-ItemProperty -LiteralPath $uninstallKey
  $installation = Get-ItemProperty -LiteralPath "HKCU:\Software\$qaGuid"
  if ([IO.Path]::GetFullPath($installation.InstallLocation).TrimEnd('\') -ne $installDirectory.TrimEnd('\')) { throw '拒绝卸载：注册的路径与独立测试目录不一致' }
  if (-not $entry.UninstallString.Contains($uninstaller)) { throw '拒绝卸载：卸载命令未指向独立测试程序' }
}

Assert-InWorkspace $fixtureRoot
Assert-InWorkspace $installDirectory
if (Test-Path -LiteralPath $uninstallKey) { throw '检测到同名测试安装，停止以避免覆盖既有安装' }
if ((Test-Path -LiteralPath $installDirectory) -or (Test-Path -LiteralPath $shortcut) -or (Test-Path -LiteralPath $appShortcut)) { throw '检测到既有测试目录或快捷方式，停止以避免覆盖' }
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
$productionApplicationBefore = Registry-Snapshot 'Software\Classes\Applications\Bodu.exe'
$productionAssociationBefore = Registry-Snapshot 'Software\Classes\cn.bodu.reader.Markdown'

try {
  $package = Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json -AsHashtable
  $config = $package.build
  $config.appId = $qaAppId
  $config.productName = $qaName
  $config.extraMetadata = @{ name = 'bodu-uninstall-qa'; productName = $qaName; version = $package.version }
  $config.artifactName = 'Bodu-Uninstall-QA-Setup.exe'
  $config.directories.output = $qaOutput
  $config.win.executableName = 'BoduUninstallQA'
  $config.nsis.guid = $qaGuid
  $config.nsis.shortcutName = $qaName
  $config.nsis.uninstallDisplayName = $qaName
  $config.nsis.createDesktopShortcut = $false
  $configFile = Join-Path $fixtureRoot 'build-config.json'
  $config | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath $configFile -Encoding utf8NoBOM
  $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  & npx electron-builder --config $configFile --win nsis --x64 --publish never *> (Join-Path $fixtureRoot 'build.log')
  if ($LASTEXITCODE -ne 0) { Get-Content -LiteralPath (Join-Path $fixtureRoot 'build.log') -Tail 35; throw '独立卸载测试安装包构建失败' }
  Check '独立测试安装包构建成功' $true

  $document = Join-Path $fixtureRoot '个人文档保留.md'
  Set-Content -LiteralPath $document -Value '# 卸载后保留的个人文档' -Encoding utf8NoBOM
  $documentHash = (Get-FileHash -LiteralPath $document).Hash
  foreach ($name in @('BoduUninstallQA', 'Bodu Uninstall QA', 'bodu-uninstall-qa')) {
    $directory = Join-Path $env:APPDATA $name
    if (Test-Path -LiteralPath $directory) { throw "测试专用数据目录已存在：$directory" }
    New-Item -ItemType Directory -Path $directory | Out-Null
    $ownedDirectories.Add($directory)
    $marker = Join-Path $directory '保留草稿与历史.json'
    Set-Content -LiteralPath $marker -Value '{"draft":"保留草稿","history":"保留历史"}' -Encoding utf8NoBOM
    $ownedMarkers.Add($marker)
  }

  Run-Native (Join-Path $qaOutput 'Bodu-Uninstall-QA-Setup.exe') @('/S', '/currentuser', "/D=$installDirectory")
  Check '安装生成可运行的中文卸载程序' (Test-Path -LiteralPath $uninstaller)
  Check '安装生成主程序' (Test-Path -LiteralPath (Join-Path $installDirectory $qaExecutable))
  Assert-TestInstallation
  Check 'Windows 应用列表登记了正确卸载命令' $true
  Check '开始菜单包含卸载入口' (Test-Path -LiteralPath $shortcut)
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($shortcut)
  Check '卸载快捷方式指向安装目录的真实卸载程序' ($link.TargetPath -eq $uninstaller)
  Check '应用启动快捷方式仍正常创建' (Test-Path -LiteralPath $appShortcut)

  if ($KeepInstalled) {
    Write-Output "独立测试程序保留用于界面验证：$uninstaller"
  } else {
    # The NSIS uninstaller recursively removes this installation. Validate the absolute destination first.
    Assert-TestInstallation
    Run-Native $uninstaller @('/S', '/currentuser')
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (((Test-Path -LiteralPath $installDirectory) -or (Test-Path -LiteralPath $uninstallKey) -or (Test-Path -LiteralPath $shortcut)) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
    Check '卸载程序正常移除测试安装目录' (-not (Test-Path -LiteralPath $installDirectory))
    Check '卸载移除开始菜单卸载入口' (-not (Test-Path -LiteralPath $shortcut))
    Check '卸载移除应用快捷方式' (-not (Test-Path -LiteralPath $appShortcut))
    Check '卸载移除 Windows 应用列表登记' (-not (Test-Path -LiteralPath $uninstallKey))
    Check '卸载移除自身文件打开方式注册' (-not (Test-Path -LiteralPath "HKCU:\Software\Classes\$qaAppId.Markdown"))
    Check '卸载移除安装程序缓存' (-not (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'bodu-uninstall-qa-updater\installer.exe')))
    Check '安装目录外的个人 Markdown 文档保持不变' ((Get-FileHash -LiteralPath $document).Hash -eq $documentHash)
    Check '默认保留设置、草稿和历史所在用户数据目录' (@($ownedMarkers | Where-Object { Test-Path -LiteralPath $_ }).Count -eq 3)
    Check '正式程序和文件打开方式注册未受影响' ((Registry-Snapshot 'Software\Classes\Applications\Bodu.exe') -eq $productionApplicationBefore -and (Registry-Snapshot 'Software\Classes\cn.bodu.reader.Markdown') -eq $productionAssociationBefore)
  }
} catch {
  $failure = $_.Exception.Message
  Write-Output "FAIL $failure"
} finally {
  if (-not $KeepInstalled) {
    if ((Test-Path -LiteralPath $uninstaller) -and (Test-Path -LiteralPath $uninstallKey)) {
      try { Assert-TestInstallation; Run-Native $uninstaller @('/S', '/currentuser') } catch { Write-Output "独立测试安装清理失败：$($_.Exception.Message)" }
    }
    # Remove only the exact marker files created above. Never recursively delete a user data folder.
    foreach ($marker in $ownedMarkers) { if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker } }
    foreach ($directory in $ownedDirectories) { if ((Test-Path -LiteralPath $directory) -and @(Get-ChildItem -LiteralPath $directory -Force).Count -eq 0) { Remove-Item -LiteralPath $directory } }
  }
  @{ date = [DateTime]::UtcNow.ToString('o'); checks = @($checks); failure = $failure; isolatedInstallDirectory = $installDirectory; keptForUi = [bool]$KeepInstalled } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $workspace 'test-results\uninstall-report.json') -Encoding utf8NoBOM
}
if ($failure) { throw $failure }
