# Build Teen Wallet as an Android APK

This project is **TanStack Start (SSR + server functions)** — it cannot be exported as static `dist/` files. Instead, the Capacitor wrapper loads the published Lovable site (`https://teen-wallet.lovable.app`) inside a native WebView. This is the same approach used by many production fintech apps and keeps backend/auth/payments working with zero changes.

> ⚠️ The APK itself **cannot be built inside Lovable** — Android SDK + JDK + Gradle are required. Run the steps below on your local machine.

---

## One-time setup (on your computer)

1. Install **Android Studio** (Hedgehog or newer) — <https://developer.android.com/studio>
2. Install **JDK 17** and **Node.js 20+**.
3. Make sure `JAVA_HOME` points at JDK 17.

---

## Clone & install

```bash
git clone <your-repo-url>
cd <repo>
npm install
```

---

## Capacitor sync (no `npm run build` needed!)

Because we wrap the live URL, you do **not** run `vite build` for the Android app.
The `capacitor-shell/` folder contains a tiny `index.html` that exists only so the Capacitor CLI passes its sanity check — the real app loads from `server.url` in `capacitor.config.ts`.

```bash
npx cap add android     # creates the /android native project (run ONCE)
npx cap sync android    # copies capacitor-shell/ + plugins into android/
```

If you previously hit:

> `[error] The web assets directory (./dist) must contain an index.html file.`

…that error is now fixed because `webDir` points at `capacitor-shell/` (which does contain `index.html`).

---

## Open in Android Studio & build APK

```bash
npx cap open android
```

Inside Android Studio:

- **Build → Build Bundle(s) / APK(s) → Build APK(s)**
- Output: `android/app/build/outputs/apk/debug/app-debug.apk`

For a **release / Play Store** build:

1. **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)**
2. Create or pick a keystore (keep it safe — losing it = losing app ownership).
3. Choose **release** variant.
4. Upload the `.aab` to Google Play Console.

---

## Iterating

Because the app loads live from `https://teen-wallet.lovable.app`, **every web change you publish in Lovable instantly reaches users** with no rebuild. Re-run `npx cap sync android` only when:

- You change `capacitor.config.ts`
- You add/update Capacitor plugins
- You change native Android resources (icons, splash, AndroidManifest)

---

## App identity

| Field | Value |
| --- | --- |
| App ID (package) | `com.teenwallet.app` |
| Display name | Teen Wallet |
| Live URL | `https://teen-wallet.lovable.app` |
| Min Android | 6.0 (API 23) |
| Target Android | API 34+ |

---

## Play Store checklist

- [ ] Replace launcher icons in `android/app/src/main/res/mipmap-*` (Android Studio → **Image Asset**).
- [ ] Replace splash drawable `android/app/src/main/res/drawable/splash.png`.
- [ ] Bump `versionCode` and `versionName` in `android/app/build.gradle` for every release.
- [ ] Generate signed `.aab` for upload.
- [ ] Fill Play Console listing: screenshots, privacy policy, content rating, data safety.
- [ ] Confirm `https://teen-wallet.lovable.app` is reachable and HTTPS-only (it is by default).
