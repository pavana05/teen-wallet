# Native Android plugin: `PhoneNumberHint`

This folder contains a custom Capacitor plugin that wraps Google Identity's
`GetPhoneNumberHintIntentRequest`. It gives Teen Wallet a true **one-tap**
phone-number pre-fill on Android — the OS shows a system sheet listing the
device's SIM number(s); the user taps one and we get it back as `+91XXXXXXXXXX`.

It is invoked from `src/lib/phoneHint.ts` via `registerPlugin("PhoneNumberHint")`.
If the plugin isn't installed in the native build, the JS code automatically
falls back to the Web Contact Picker.

## One-time install (run locally on your dev machine)

You only need to do this once per fresh `android/` folder.

### 1. Generate the Android project (skip if you already have `android/`)

```bash
npx cap add android
```

### 2. Copy the Java file into the Android app

```bash
mkdir -p android/app/src/main/java/com/teenwallet/app/plugins
cp android-plugin/PhoneNumberHintPlugin.java \
   android/app/src/main/java/com/teenwallet/app/plugins/
```

### 3. Add the Google Identity dependency

Open `android/app/build.gradle` and add inside the `dependencies { … }` block:

```gradle
implementation 'com.google.android.gms:play-services-auth:21.2.0'
```

### 4. Register the plugin with Capacitor

Open `android/app/src/main/java/com/teenwallet/app/MainActivity.java`
(create it if missing — Capacitor scaffolds one) and make it look like:

```java
package com.teenwallet.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.teenwallet.app.plugins.PhoneNumberHintPlugin;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(PhoneNumberHintPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
```

### 5. Sync and build

```bash
npx cap sync android
npx cap open android   # then Run ▶ in Android Studio
```

## Verifying it works

1. Install the new APK on a real Android device with a SIM card.
2. Open Teen Wallet → "What's your number?" screen.
3. Tap **Use my number**.
4. The Android system sheet should appear with your SIM number(s). Tap one.
5. The phone field auto-fills with your 10-digit number, ready to send OTP.

If nothing appears or the button stays in fallback (contact picker) mode:
- Make sure Google Play Services is up to date on the device.
- The device must have an active SIM (emulators without SIM won't show numbers).
- Check `adb logcat | grep PhoneNumberHint` for the underlying error.

## Why we still need OTP

This API only **pre-fills** the number — it does not prove ownership. We still
send an SMS OTP to verify the number actually belongs to the device. The win is
purely UX: the user types 0 digits instead of 10.
