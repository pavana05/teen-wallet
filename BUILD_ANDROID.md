# Build Teen Wallet as an Android APK

This project is wired up with **Capacitor** so the same web app can ship to the Play Store as a native Android app.

> ⚠️ The APK itself **cannot be built inside Lovable** — Android SDK + Java/JDK + Gradle are required. Follow the steps below on your local machine.

---

## One-time setup (on your computer)

1. Install **Android Studio** (Hedgehog or newer) — <https://developer.android.com/studio>
2. During first launch, let it install:
   - Android SDK Platform 34 (or latest)
   - Android SDK Build-Tools
   - Android SDK Command-line Tools
3. Install **JDK 17** (Android Studio bundles one — make sure `JAVA_HOME` points at it).
4. Install **Node.js 20+** and **git**.

---

## Export & clone

1. In Lovable, click **GitHub → Connect to GitHub** (top-right) and push the repo.
2. On your machine:
   ```bash
   git clone <your-repo-url>
   cd <repo>
   npm install
   ```

---

## First-time Capacitor sync

```bash
npm run build           # produces /dist
npx cap add android     # creates the /android native project (run ONCE)
npx cap sync android    # copies web build + plugins into android/
```

After this, an `android/` folder exists. Commit it.

---

## Open in Android Studio & build APK

```bash
npx cap open android
```

Inside Android Studio:

- **Build → Build Bundle(s) / APK(s) → Build APK(s)**
- The signed-debug APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`

For a **release / Play Store** build:

1. **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)**
2. Create or pick a keystore (keep it safe — losing it = losing app ownership).
3. Choose **release** build variant.
4. Upload the resulting `.aab` to Google Play Console.

---

## Iterating after web changes

Whenever you update the web code:

```bash
npm run build
npx cap sync android
```

Then re-run / re-build inside Android Studio.

---

## App identity

| Field | Value |
| --- | --- |
| App ID (package) | `com.teenwallet.app` |
| Display name | Teen Wallet |
| Min Android | 6.0 (API 23) — Capacitor default |
| Target Android | Latest stable (API 34+) |

To change either, edit `capacitor.config.ts` and re-run `npx cap sync`.

---

## Optional: dev hot-reload on a real device

In `capacitor.config.ts`, uncomment the `server` block:

```ts
server: {
  url: "https://teen-wallet.lovable.app",
  cleartext: false,
},
```

Run `npx cap sync android` and install the resulting build on your phone — it will live-load from Lovable. **Re-comment before doing a Play Store build.**

---

## Play Store checklist

- [ ] Replace launcher icons in `android/app/src/main/res/mipmap-*` (use Android Studio → **Image Asset**).
- [ ] Replace splash drawable `android/app/src/main/res/drawable/splash.png`.
- [ ] Bump `versionCode` and `versionName` in `android/app/build.gradle` for every release.
- [ ] Generate signed `.aab` (not APK) for upload.
- [ ] Fill Play Console listing: screenshots, privacy policy URL, content rating, data safety.
