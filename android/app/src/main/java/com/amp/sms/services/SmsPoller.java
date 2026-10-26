package com.amp.sms.services;

import android.content.Context;
import android.util.Log;

import com.amp.sms.ApiManager;
import com.amp.sms.AppConstants;
import com.amp.sms.dtos.PendingSMSResponseDTO;
import com.amp.sms.helpers.SharedPreferenceHelper;
import com.amp.sms.models.SMSPayload;

import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import retrofit2.Response;

/**
 * Asks the server whether anything is waiting, and sends whatever comes back.
 *
 * The server is on the same tailnet as this phone, so a poll is a request
 * across the room rather than a round trip through a push network. At ten
 * messages a minute a few seconds of latency is invisible, and the thing we
 * buy for it is that nothing outside the tailnet is involved in sending.
 *
 * The server hands out each message exactly once -- it marks a row taken in
 * the same query that reads it -- so a poll that overlaps the previous one,
 * or a retry after the phone drops off Wi-Fi, cannot text anyone twice.
 */
public class SmsPoller {

    private static final String TAG = "SmsPoller";
    private static final long INTERVAL_SECONDS = 10;

    /** Backoff when the server cannot be reached, so a flat tailnet is not hammered. */
    private static final long MAX_BACKOFF_SECONDS = 120;

    private final Context context;
    private ScheduledExecutorService executor;
    private long backoffSeconds = 0;

    public SmsPoller(Context context) {
        this.context = context.getApplicationContext();
    }

    public synchronized void start() {
        if (executor != null && !executor.isShutdown()) {
            return;
        }
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(
                this::pollOnce, 0, INTERVAL_SECONDS, TimeUnit.SECONDS);
        Log.i(TAG, "Polling every " + INTERVAL_SECONDS + "s");
    }

    public synchronized void stop() {
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
            Log.i(TAG, "Polling stopped");
        }
    }

    private void pollOnce() {
        // scheduleWithFixedDelay cancels the whole schedule on an uncaught
        // throwable, which would leave the gateway silently dead, so nothing
        // is allowed out of here.
        try {
            if (backoffSeconds > 0) {
                Thread.sleep(backoffSeconds * 1000);
            }

            String deviceId = SharedPreferenceHelper.getSharedPreferenceString(
                    context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, "");
            String apiKey = SharedPreferenceHelper.getSharedPreferenceString(
                    context, AppConstants.SHARED_PREFS_API_KEY_KEY, "");

            if (deviceId.isEmpty() || apiKey.isEmpty()) {
                return;
            }

            boolean gatewayEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(
                    context, AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY, false);
            if (!gatewayEnabled) {
                return;
            }

            Response<PendingSMSResponseDTO> response =
                    ApiManager.getApiService().getPendingSMS(deviceId, apiKey).execute();

            if (!response.isSuccessful() || response.body() == null) {
                Log.w(TAG, "Poll returned " + response.code());
                bumpBackoff();
                return;
            }

            backoffSeconds = 0;

            List<SMSPayload> pending = response.body().getData();
            if (pending == null || pending.isEmpty()) {
                return;
            }

            Log.i(TAG, "Collected " + pending.size() + " message(s)");
            for (SMSPayload payload : pending) {
                SmsDispatcher.send(context, payload);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            Log.e(TAG, "Poll failed: " + e.getMessage());
            bumpBackoff();
        }
    }

    private void bumpBackoff() {
        backoffSeconds = backoffSeconds == 0
                ? INTERVAL_SECONDS
                : Math.min(backoffSeconds * 2, MAX_BACKOFF_SECONDS);
    }
}
