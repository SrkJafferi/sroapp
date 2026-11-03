[CmdletBinding()]
param(
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$SdkRoot = $env:ANDROID_HOME,
    [ValidatePattern('^(arm64-v8a|armeabi-v7a|x86|x86_64)(,(arm64-v8a|armeabi-v7a|x86|x86_64))*$')]
    [string]$Architectures = 'arm64-v8a'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $projectRoot 'apps\mobile\android'
$artifactRoot = Join-Path $projectRoot 'artifacts\android'

if (-not $SdkRoot) {
    $SdkRoot = [Environment]::GetEnvironmentVariable('ANDROID_HOME', 'User')
}
if (-not $JavaHome) {
    throw 'Pass -JavaHome with an existing compatible JDK directory. This script never installs a JDK.'
}
if (-not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))) {
    throw "Java executable not found under $JavaHome"
}
if (-not $SdkRoot -or -not (Test-Path -LiteralPath (Join-Path $SdkRoot 'platform-tools\adb.exe'))) {
    throw 'Pass -SdkRoot with the existing Android SDK directory.'
}
if (-not (Test-Path -LiteralPath (Join-Path $androidRoot 'gradlew.bat'))) {
    throw 'Generated Android project is missing. Review and run Expo prebuild before using this script.'
}

$previousJavaHome = $env:JAVA_HOME
$previousAndroidHome = $env:ANDROID_HOME
$previousPath = $env:Path
New-Item -ItemType Directory -Path (Join-Path $artifactRoot 'logs') -Force | Out-Null
$buildLog = Join-Path $artifactRoot 'logs\assemble-release.log'

try {
    # Process-local only; no user or machine environment variables are changed.
    $env:JAVA_HOME = $JavaHome
    $env:ANDROID_HOME = $SdkRoot
    $env:Path = "$(Join-Path $JavaHome 'bin');$(Join-Path $SdkRoot 'platform-tools');$previousPath"

    Push-Location -LiteralPath $androidRoot
    try {
        # Expo's generated release configuration embeds the JS bundle and assets.
        # It currently uses the generated Android debug signing key for internal tests.
        # SDK component installation requires prior user approval; JDK auto-download is disabled.
        $shortPathsInit = Join-Path $PSScriptRoot 'android-short-paths.gradle'
        & .\gradlew.bat ':app:assembleRelease' "-PreactNativeArchitectures=$Architectures" '-Porg.gradle.java.installations.auto-download=false' '--init-script' $shortPathsInit '--max-workers=4' '--console=plain' '--stacktrace' 2>&1 | Tee-Object -FilePath $buildLog
        if ($LASTEXITCODE -ne 0) { throw "Native build failed. See $buildLog" }
    }
    finally { Pop-Location }

    $sourceApk = Join-Path $androidRoot 'app\build\outputs\apk\release\app-release.apk'
    if (-not (Test-Path -LiteralPath $sourceApk)) { throw 'Gradle did not produce the expected APK.' }
    $appManifest = Get-Content -LiteralPath (Join-Path $projectRoot 'apps\mobile\app.json') -Raw | ConvertFrom-Json
    $abiLabel = $Architectures.Replace(',', '-')
    $targetApk = Join-Path $artifactRoot "sro-clinic-$($appManifest.expo.version)-internal-$abiLabel.apk"
    Copy-Item -LiteralPath $sourceApk -Destination $targetApk -Force
    Get-FileHash -LiteralPath $targetApk -Algorithm SHA256 | Format-List
    Write-Output "Standalone internal-test release APK: $targetApk"
    Write-Output 'Test signing only. Not a Play Store release. Installation is a separate explicit step.'
}
finally {
    $env:JAVA_HOME = $previousJavaHome
    $env:ANDROID_HOME = $previousAndroidHome
    $env:Path = $previousPath
}
