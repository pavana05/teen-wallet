# Release-Ready Android Build & Signing Guide

End-to-end checklist to produce a signed `.aab` you can upload to Google Play Console.

> Prerequisites: you've already followed `BUILD_ANDROID.md` and successfully built a debug APK locally.

---

## 1. Create a release keystore (ONCE — keep it forever)

⚠️ **If you lose this file or its password, you can never update the app on Play Store again.** Back it up to two places (e.g., 1Password + an encrypted USB).

```bash
keytool -genkey -v \
  -keystore ~/teenwallet-release.jks \
  -alias teenwallet \
  -keyalg RSA -keysize 2048 -validity 10000
```

Answer the prompts:
- Keystore password → choose a strong one, save it
- Key password → use the **same** as keystore password (simpler)
- Name / Org / City / Country → real values

You now have `~/teenwallet-release.jks`.

---

## 2. Tell Gradle about the keystore

Create `android/key.properties` (do NOT commit this file — add to `.gitignore`):

```properties
storeFile=/absolute/path/to/teenwallet-release.jks
storePassword=YOUR_KEYSTORE_PASSWORD
keyAlias=teenwallet
keyPassword=YOUR_KEYSTORE_PASSWORD
```

Edit `android/app/build.gradle` — add this **above** the `android {}` block:

```gradle
def keystorePropertiesFile = rootProject.file("key.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

Inside `android {}`, add `signingConfigs` and update `buildTypes.release`:

```gradle
android {
    signingConfigs {
        release {
            if (keystoreProperties['storeFile']) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }

    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
            signingConfig signingConfigs.release
        }
    }
}
```

Add `android/key.properties` to `.gitignore` immediately:

```bash
echo "android/key.properties" >> .gitignore
echo "android/app/release/" >> .gitignore
```

---

## 3. Bump version for every release

Open `android/app/build.gradle` and increment **both**:

```gradle
defaultConfig {
    applicationId "com.teenwallet.app"
    minSdkVersion 23
    targetSdkVersion 34
    versionCode 2          // <-- integer, MUST increase every upload
    versionName "1.0.1"    // <-- semver shown to users
}
```

`versionCode` is what Google Play uses to detect "is this newer". Forgetting to bump it = upload rejected.

---

## 4. Build the AAB (App Bundle — what Play Store wants)

```bash
# 1. Rebuild web bundle
npm run build

# 2. Sync into android/
npx cap sync android

# 3. Build signed release AAB
cd android
./gradlew bundleRelease
cd ..
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

---

## 5. Local smoke test (CRITICAL — do BEFORE uploading)

You can't install an `.aab` directly. Use Google's `bundletool` to extract a real APK and test it:

```bash
# Install bundletool (one-time)
brew install bundletool   # macOS
# or download jar: https://github.com/google/bundletool/releases

# Extract universal APK
bundletool build-apks \
  --bundle=android/app/build/outputs/bundle/release/app-release.aab \
  --output=teenwallet-release.apks \
  --mode=universal \
  --ks=~/teenwallet-release.jks \
  --ks-key-alias=teenwallet

unzip -p teenwallet-release.apks universal.apk > teenwallet-release.apk

# Install on connected device
adb install -r teenwallet-release.apk
```

**Test this checklist on the installed APK:**
- [ ] App launches without crashing
- [ ] Splash screen → onboarding (fresh install) shows correctly
- [ ] OTP screen accepts dev OTP `123456`
- [ ] **Kill app, relaunch** — onboarding resumes at the exact same stage
- [ ] KYC flow completes
- [ ] Scan & Pay opens camera (grant permission when prompted)
- [ ] Payment success screen shows reference ID
- [ ] Status bar is dark, no white flash on launch

If any of these fail, fix in code → repeat steps 4 + 5. Do **not** upload a broken AAB.

---

## 6. Upload to Google Play Console

1. https://play.google.com/console → Create app
2. Fill required policy items:
   - Privacy policy URL (mandatory for finance apps)
   - Data safety (declare what you collect — KYC docs, phone, transactions)
   - Content rating questionnaire
   - Target audience (declare 13+ for teen wallet)
3. **Production → Create new release**
4. Upload `app-release.aab`
5. Release notes (e.g., "Initial release — Aadhaar KYC, UPI Scan & Pay")
6. Save → **Send for review**

Initial review typically takes 2–7 days. Finance apps often get extra scrutiny — expect them to ask for your RBI/payment-aggregator licensing documentation.

---

## 7. Subsequent releases

```bash
# 1. Bump versionCode + versionName in android/app/build.gradle
# 2. Rebuild
npm run build
npx cap sync android
cd android && ./gradlew bundleRelease && cd ..
# 3. Smoke test (step 5)
# 4. Upload new .aab to Play Console
```

## Common errors & fixes

| Error | Fix |
|---|---|
| `Keystore was tampered with, or password was incorrect` | Wrong password in `key.properties` |
| `Version code X has already been used` | Bump `versionCode` to a higher integer |
| `App not installed` (on device) | Uninstall the debug build first: `adb uninstall com.teenwallet.app` |
| White flash on launch | Splash drawable not configured — see `BUILD_ANDROID.md` |
| Camera/Storage permission denied | Check `android/app/src/main/AndroidManifest.xml` includes the right `<uses-permission>` — Capacitor adds these automatically when you `cap sync` after the plugin is installed |
| `INSTALL_PARSE_FAILED_NO_CERTIFICATES` | You tried to install an unsigned `.apks` — use `--mode=universal` + signing flags as in step 5 |

---

## Play Store metadata cheat sheet

You'll need these assets uploaded in Console:

- **App icon**: 512×512 PNG, no transparency
- **Feature graphic**: 1024×500 PNG/JPG
- **Phone screenshots**: at least 2, max 8 (1080×1920 ideal)
- **Short description**: ≤80 chars
- **Full description**: ≤4000 chars
- **Privacy policy URL**: must be a real, reachable page

Generate icons with Android Studio → **File → New → Image Asset** (uses your source PNG to produce all densities at once).
