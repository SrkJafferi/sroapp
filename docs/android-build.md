# Local Android internal builds

This workflow builds the existing Expo application without changing its features or connecting a backend. It produces a standalone APK with embedded JavaScript, fonts and assets. No Metro server, Expo account, EAS credentials or app-store configuration is required to run the resulting APK.

## Verified toolchain requirements

- Gradle Wrapper: **9.4.1**, supplied by the existing generated Expo project.
- Android Gradle Plugin: **9.2.1**, resolved from the installed React Native Gradle plugin.
- Android compile SDK: **37**; target SDK: **36**; minimum SDK: **24**.
- Android Build Tools: **37.0.0**, already installed alongside 36.0.0.
- NDK: **27.1.12297006**, required by the installed React Native/Expo version catalog.
- CMake: **3.22.1**, installed by Gradle/AGP with Ninja **1.10.2**.
- JDK: **17 is explicitly requested by React Native's settings-plugin `jvmToolchain(17)`**. Java 25 can run Gradle 9.4.1, but does not satisfy that exact compiler-toolchain request. The initial Java 25 build demonstrated this distinction.

The user approved the missing SDK components and a project-local side-by-side Temurin JDK 17. Java 25 and Android Studio are retained. The downloaded JDK archive is checksum-verified and extracted under ignored `artifacts/toolchains/`; its source URL and checksum are recorded there. No machine-wide Java/PATH change is required.

## Build

From the repository root in PowerShell:

```powershell
.\scripts\build-android-internal.ps1 `
  -JavaHome 'G:\xampp\htdocs\sroapp\sro-clinic\artifacts\toolchains\jdk-17.0.20.1+1' `
  -SdkRoot 'C:\Users\Shahrukh\AppData\Local\Android\Sdk'
```

The helper runs `:app:assembleRelease` in the existing generated Android project, uses the selected Java/SDK only within its process, disables automatic JDK provisioning, and restores environment variables afterwards. It does not run `clean` or destructive prebuild. It copies a successful APK to `artifacts/android/` and prints its SHA-256.

The build includes `scripts/android-short-paths.gradle`, which limits CMake object paths to 240 characters for libraries and 250 for the app, and stages the app's generated CMake files under ignored repository-root `.cxx/`. Builds reproduced a Reanimated directory-creation failure and a Gesture Handler autolinked filename exceeding 260 characters (the initial object-path limit was 1024). CMake's supported object-path hashing and shorter app staging directory avoid these without editing dependencies, relocating the repository, or changing Windows long-path policy. See [CMake object-path limits](https://cmake.org/cmake/help/latest/variable/CMAKE_OBJECT_PATH_MAX.html).

`ANDROID_HOME` is already set at Windows user level. If an older IDE/terminal session does not see a later environment change, reopen that session; the helper also accepts the SDK path explicitly.

Default architecture is **arm64-v8a**, matching the connected Infinix device. Additional architectures can be requested through `-Architectures` when needed; their native builds must also be validated.

The generated Expo release build currently uses its **test/debug signing key**. The variant is release, but the signing identity is for internal testing only. Keystores, APKs, SDK downloads, toolchains and build logs are ignored by Git. No production signing secret is stored in tracked source.

## Install and launch

With a compatible Android phone connected by USB and ADB authorized:

```powershell
$adbPath = 'C:\Users\Shahrukh\AppData\Local\Android\Sdk\platform-tools\adb.exe'
& $adbPath -d devices -l
& $adbPath -d install -r 'G:\xampp\htdocs\sroapp\sro-clinic\artifacts\android\sro-clinic-0.1.0-internal-arm64-v8a.apk'
& $adbPath -d shell am start -W -n 'org.sropakistan.clinic/.MainActivity'
```

Alternatively, copy the resulting APK to another compatible ARM64 Android 7+ phone and open it using the phone's installer. This is an internal demo application with fictional in-memory data; state resets when the process restarts.

If the generated native project is absent after a fresh checkout, review the Expo configuration and generate it with `pnpm --filter @sro/mobile exec expo prebuild --platform android --no-install`. Do not use a destructive `--clean` against native changes without assessing them first.

See [validation results](validation.md) for the actual build, signature, installation, launch and device-test results. A successful Metro bundle export alone is not native APK validation.

References: [Gradle Java compatibility](https://docs.gradle.org/current/userguide/compatibility.html), [Expo local release builds](https://docs.expo.dev/guides/local-app-production/), [Android native tool installation](https://developer.android.com/studio/projects/install-ndk).
