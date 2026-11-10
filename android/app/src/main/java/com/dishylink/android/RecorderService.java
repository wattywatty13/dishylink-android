package com.dishylink.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps the app's process — and with it the dashboard page that runs the history
 * recorder — alive while the app is in the background, shown to the user as an
 * ongoing "Recording your Starlink" notification.
 *
 * It does no polling of its own. Every 30 seconds it ticks the page
 * (StarlinkNativePlugin.emitTick), which runs the recorder's due alarms if
 * Android has throttled the page's own timers. The dish keeps about 15 minutes of
 * history, so a tick Android delays (Doze, screen off) is caught up on the next
 * one rather than lost.
 */
public class RecorderService extends Service {

    static final String ACTION_STOP = "com.dishylink.android.STOP_RECORDING";
    private static final String EXTRA_STATUS = "status";
    private static final String CHANNEL = "recording";
    private static final int NOTIFICATION_ID = 1;
    private static final long TICK_MS = 30_000;

    private static volatile boolean running = false;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            StarlinkNativePlugin.emitTick();
            handler.postDelayed(this, TICK_MS);
        }
    };

    static void startOrUpdate(Context context, String status) {
        if (running) {
            // Already in the foreground: just refresh the text. Starting it again
            // from the background is something Android 12+ refuses.
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            manager.notify(NOTIFICATION_ID, buildNotification(context, status));
            return;
        }
        Intent intent = new Intent(context, RecorderService.class).putExtra(EXTRA_STATUS, status);
        try {
            ContextCompat.startForegroundService(context, intent);
        } catch (RuntimeException refused) {
            // Asked while backgrounded (ForegroundServiceStartNotAllowedException);
            // the next start from the open app succeeds.
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, RecorderService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            MainActivity.closeIfOpen();
            return START_NOT_STICKY;
        }
        String status = intent != null && intent.getStringExtra(EXTRA_STATUS) != null
            ? intent.getStringExtra(EXTRA_STATUS) : "Recording your Starlink";
        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(this, status), type);
        if (!running) {
            running = true;
            handler.postDelayed(tick, TICK_MS);
        }
        // Without the page there is nothing to record, so a killed process is not
        // restarted on its own; opening the app starts recording again.
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiped away from recents: the page is gone, so recording stops honestly
        // rather than leaving a notification that claims otherwise.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacks(tick);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static Notification buildNotification(Context context, String status) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL, "Background recording", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown while the app records your Starlink's history");
            channel.setShowBadge(false);
            context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        Intent open = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(
            context, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(
            context, 2, new Intent(context, RecorderService.class).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_dish)
            .setContentTitle("Dishylink")
            .setContentText(status)
            .setContentIntent(tap)
            .addAction(0, "Stop and close", stop)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }
}
