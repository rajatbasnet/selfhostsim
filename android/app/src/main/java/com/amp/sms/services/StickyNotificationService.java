package com.amp.sms.services;

import android.app.*;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.IBinder;
import android.provider.Telephony;
import android.util.Log;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;

import com.amp.sms.R;
import com.amp.sms.activities.MainActivity;
import com.amp.sms.receivers.SMSBroadcastReceiver;
import com.amp.sms.AppConstants;
import com.amp.sms.helpers.SharedPreferenceHelper;

public class StickyNotificationService extends Service {

    /**
     * The gateway's pulse. This service is already the thing Android keeps
     * alive in the background, so the poll loop lives here rather than in
     * WorkManager, whose periodic floor is fifteen minutes.
     */
    private SmsPoller poller;

    private static final String TAG = "StickyNotificationService";

    @Override
    public IBinder onBind(Intent intent) {
        Log.i(TAG, "Service onBind " + intent.getAction());
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "Service Started");

        // Only show notification if enabled in preferences
        boolean stickyNotificationEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(
                getApplicationContext(),
                AppConstants.SHARED_PREFS_STICKY_NOTIFICATION_ENABLED_KEY,
                false
        );

        // startForeground is not optional. Android 8 and up kills a plain
        // background service within seconds, and this one has to stay alive
        // to keep polling, so the notification is the price of the service
        // existing at all. The user preference decides how loud it is, not
        // whether it appears.
        Notification notification = createNotification();
        startForeground(1, notification);
        Log.i(TAG, "Gateway service in the foreground (notification "
                + (stickyNotificationEnabled ? "prominent" : "minimal") + ")");

        poller = new SmsPoller(getApplicationContext());
        poller.start();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.i(TAG, "Received start id " + startId + ": " + intent);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (poller != null) {
            poller.stop();
            poller = null;
        }
        super.onDestroy();
        
        Log.i(TAG, "StickyNotificationService destroyed");
    }

    private Notification createNotification() {
        String notificationChannelId = "stickyNotificationChannel";

        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = null;
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            channel = new NotificationChannel(notificationChannelId, notificationChannelId, NotificationManager.IMPORTANCE_HIGH);
            channel.enableVibration(false);
            channel.setShowBadge(false);
            notificationManager.createNotificationChannel(channel);

            Intent notificationIntent = new Intent(this, MainActivity.class);
            PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

            Notification.Builder builder = new Notification.Builder(this, notificationChannelId);
            return builder.setContentTitle("selhostsim Active")
                    .setContentText("SMS gateway service is active")
                    .setContentIntent(pendingIntent)
                    .setOngoing(true)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .build();
        } else {
            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, notificationChannelId);
            return builder.setContentTitle("selhostsim Active")
                    .setContentText("SMS gateway service is active")
                    .setOngoing(true)
                    .setSmallIcon(R.mipmap.ic_launcher)
                    .build();
        }

    }
}