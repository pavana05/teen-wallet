package com.teenwallet.app.plugins;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentSender;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.GetPhoneNumberHintIntentRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.tasks.Task;

/**
 * Wraps Google Identity's GetPhoneNumberHintIntentRequest so the app can pre-fill
 * the user's SIM number with a single OS-level tap (no Contact Picker, no SMS).
 *
 * Returns: { phoneNumber: string } in E.164 form (e.g. "+919876543210").
 * Rejects with code "cancelled" if the user dismisses the sheet, "unavailable"
 * if no SIM/eligible number, or "error" with the underlying message otherwise.
 */
@CapacitorPlugin(name = "PhoneNumberHint")
public class PhoneNumberHintPlugin extends Plugin {

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        // Play-Services-backed; treat as available on any modern Android device
        // and let request() surface the real outcome.
        ret.put("available", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void request(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("error", "no_activity");
            return;
        }

        GetPhoneNumberHintIntentRequest request =
                GetPhoneNumberHintIntentRequest.builder().build();

        Task<PendingIntent> task =
                Identity.getSignInClient(activity).getPhoneNumberHintIntent(request);

        task.addOnSuccessListener(pendingIntent -> {
            try {
                IntentSender sender = pendingIntent.getIntentSender();
                Intent intent = new Intent();
                // Capacitor's startActivityForResult helper expects an Intent;
                // wrap by launching the IntentSender directly.
                activity.startIntentSenderForResult(
                        sender, 0xC0FE, intent, 0, 0, 0
                );
                // Save the call so the activity-result bridge can resolve it.
                bridge.saveCall(call);
                pendingCallId = call.getCallbackId();
            } catch (IntentSender.SendIntentException e) {
                call.reject("error", e.getMessage());
            }
        });

        task.addOnFailureListener(e -> call.reject("unavailable", e.getMessage()));
    }

    private String pendingCallId;

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (requestCode != 0xC0FE || pendingCallId == null) return;
        PluginCall call = bridge.getSavedCall(pendingCallId);
        pendingCallId = null;
        if (call == null) return;

        if (resultCode != Activity.RESULT_OK || data == null) {
            call.reject("cancelled", "user_cancelled");
            bridge.releaseCall(call);
            return;
        }

        try {
            Activity activity = getActivity();
            String phoneNumber = Identity.getSignInClient(activity)
                    .getPhoneNumberFromIntent(data);
            JSObject ret = new JSObject();
            ret.put("phoneNumber", phoneNumber);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("error", e.getMessage());
        } finally {
            bridge.releaseCall(call);
        }
    }
}
