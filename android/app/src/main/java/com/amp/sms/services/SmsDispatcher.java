package com.amp.sms.services;

import android.content.Context;
import android.util.Log;

import com.amp.sms.AppConstants;
import com.amp.sms.helpers.SMSHelper;
import com.amp.sms.helpers.SharedPreferenceHelper;
import com.amp.sms.models.SMSPayload;

/**
 * Puts one job on the air.
 *
 * This logic used to live inside FCMService, which meant the only way to send
 * a text was to be pushed one by Google. It is the same code; it just no
 * longer cares who handed it the job.
 */
public class SmsDispatcher {

    private static final String TAG = "SmsDispatcher";

    /** @return how many recipients were accepted by the radio. */
    public static int send(Context context, SMSPayload payload) {
        if (payload == null) {
            Log.e(TAG, "Null payload");
            return 0;
        }

        String[] recipients = payload.getRecipients();
        if (recipients == null || recipients.length == 0) {
            Log.e(TAG, "No recipients in payload " + payload.getSmsId());
            return 0;
        }

        int preferredSim = SharedPreferenceHelper.getSharedPreferenceInt(
                context, AppConstants.SHARED_PREFS_PREFERRED_SIM_KEY, -1);

        int sent = 0;
        for (String recipient : recipients) {
            boolean ok;
            if (preferredSim == -1) {
                ok = SMSHelper.sendSMS(
                        recipient,
                        payload.getMessage(),
                        payload.getSmsId(),
                        payload.getSmsBatchId(),
                        context);
            } else {
                try {
                    ok = SMSHelper.sendSMSFromSpecificSim(
                            recipient,
                            payload.getMessage(),
                            preferredSim,
                            payload.getSmsId(),
                            payload.getSmsBatchId(),
                            context);
                } catch (Exception e) {
                    Log.e(TAG, "Specific SIM send failed: " + e.getMessage());
                    ok = false;
                }
            }
            if (ok) {
                sent++;
            }
        }

        Log.d(TAG, "Batch " + payload.getSmsBatchId()
                + " sent " + sent + " of " + recipients.length);
        return sent;
    }
}
