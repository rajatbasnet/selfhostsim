package com.amp.sms;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.amp.sms.services.StickyNotificationService;
import com.amp.sms.helpers.SharedPreferenceHelper;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class selhostsimUtils {
    private static final String TAG = "selhostsimUtils";
    
    public static boolean isPermissionGranted(Context context, String permission) {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED;
    }

    public static List<SubscriptionInfo> getAvailableSimSlots(Context context) {

        if (ActivityCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
            return new ArrayList<>();
        }

        SubscriptionManager subscriptionManager = SubscriptionManager.from(context);
        return subscriptionManager.getActiveSubscriptionInfoList();

    }

    public static void startStickyNotificationService(Context context) {
        if(!isPermissionGranted(context, Manifest.permission.RECEIVE_SMS)){
            return;
        }
        
        // This service carries the poll loop, so it runs whenever the gateway
        // is on. It used to be gated on the sticky-notification preference,
        // which meant a gateway switched on with notifications off looked
        // enabled and silently never collected a message.
        boolean gatewayEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(
                context,
                AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY,
                false
        );

        if (!gatewayEnabled) {
            Log.i(TAG, "Gateway is off, not starting the service");
            return;
        }

        Intent notificationIntent = new Intent(context, StickyNotificationService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(notificationIntent);
        } else {
            context.startService(notificationIntent);
        }
        Log.i(TAG, "Starting gateway service");
    }

    public static void stopStickyNotificationService(Context context) {
        Intent notificationIntent = new Intent(context, StickyNotificationService.class);
        context.stopService(notificationIntent);
        Log.i(TAG, "Stopping sticky notification service");
    }
    
    /**
     * Log a non-fatal exception locally, with any extra context flattened into
     * the message.
     *
     * Deliberately local-only. This handset holds a contact list and sends on a
     * real SIM, so crash and usage telemetry to a third party has no place on it.
     *
     * @param throwable The exception to log
     * @param message A message describing what happened
     * @param customData Optional map of custom key-value pairs to add as context
     */
    public static void logException(Throwable throwable, String message, Map<String, Object> customData) {
        try {
            StringBuilder context = new StringBuilder(message == null ? "" : message);
            if (customData != null) {
                for (Map.Entry<String, Object> entry : customData.entrySet()) {
                    context.append(" | ").append(entry.getKey()).append('=')
                           .append(String.valueOf(entry.getValue()));
                }
            }
            Log.e(TAG, context.toString(), throwable);
        } catch (Exception e) {
            Log.e(TAG, "Error logging exception", e);
        }
    }
    
    /**
     * Simplified method to log a non-fatal exception with just a message
     */
    public static void logException(Throwable throwable, String message) {
        logException(throwable, message, null);
    }
}
