import { Capacitor } from "@capacitor/core";
import {
  PushNotifications,
  type Token,
  type PushNotificationSchema,
} from "@capacitor/push-notifications";
import { supabase } from "@/integrations/supabase/client";

let registered = false;

/**
 * Register the device with FCM and store the token in `device_tokens`.
 * Safe no-op on web. Call after the user is authenticated.
 */
export async function registerPushNotifications() {
  if (registered) return;
  if (!Capacitor.isNativePlatform()) return;
  if (Capacitor.getPlatform() !== "android") return;

  registered = true;

  try {
    const perm = await PushNotifications.checkPermissions();
    let status = perm.receive;
    if (status === "prompt" || status === "prompt-with-rationale") {
      const req = await PushNotifications.requestPermissions();
      status = req.receive;
    }
    if (status !== "granted") {
      registered = false;
      return;
    }

    PushNotifications.addListener("registration", async (token: Token) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      try {
        await supabase
          .from("device_tokens")
          .upsert(
            {
              user_id: user.id,
              token: token.value,
              platform: "android",
              last_seen_at: new Date().toISOString(),
            },
            { onConflict: "user_id,token" }
          );
      } catch (e) {
        console.error("Failed to store push token", e);
      }
    });

    PushNotifications.addListener("registrationError", (err) => {
      console.error("Push registration error", err);
      registered = false;
    });

    PushNotifications.addListener(
      "pushNotificationReceived",
      (_n: PushNotificationSchema) => {
        // App is in foreground — notification row already exists in DB,
        // so the in-app NotificationsPanel will reflect it via realtime/refetch.
      }
    );

    await PushNotifications.register();
  } catch (e) {
    console.error("registerPushNotifications failed", e);
    registered = false;
  }
}
