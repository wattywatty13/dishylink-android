package com.dishylink.android;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import android.webkit.CookieManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Everything the dashboard's WebView cannot do itself (see mobile/native.ts for
 * the JavaScript side): plain-HTTP and CORS-free requests to the dish, router and
 * starlink.com, the sign-in screen's cookies, notifications, and the
 * background-recording service.
 */
@CapacitorPlugin(
    name = "StarlinkNative",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class StarlinkNativePlugin extends Plugin {

    static final String ALERT_CHANNEL = "alerts";
    private static StarlinkNativePlugin instance;
    private final ExecutorService io = Executors.newCachedThreadPool();

    @Override
    public void load() {
        instance = this;
        createAlertChannel(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        io.shutdownNow();
    }

    /** Called by RecorderService on each background tick. */
    static void emitTick() {
        StarlinkNativePlugin plugin = instance;
        if (plugin != null) plugin.notifyListeners("tick", new JSObject());
    }

    // ---------- HTTP ----------

    @PluginMethod
    public void http(PluginCall call) {
        final String url = call.getString("url");
        final String method = call.getString("method", "GET");
        final JSObject headers = call.getObject("headers", new JSObject());
        final String body = call.getString("body");
        final int timeoutMs = call.getInt("timeoutMs", 30000);
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("Only http and https URLs are supported");
            return;
        }
        io.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod(method);
                connection.setConnectTimeout(Math.min(timeoutMs, 10000));
                connection.setReadTimeout(timeoutMs);
                connection.setInstanceFollowRedirects(true);
                connection.setUseCaches(false);
                Iterator<String> names = headers.keys();
                while (names.hasNext()) {
                    String name = names.next();
                    String lower = name.toLowerCase();
                    // Set by the connection itself, or (origin/referer) refused by the dish.
                    if (lower.equals("host") || lower.equals("content-length") || lower.equals("origin")
                            || lower.equals("referer") || lower.equals("connection")) continue;
                    connection.setRequestProperty(name, headers.getString(name));
                }
                if (body != null && !body.isEmpty()) {
                    byte[] bytes = Base64.decode(body, Base64.DEFAULT);
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream out = connection.getOutputStream()) {
                        out.write(bytes);
                    }
                }

                int status = connection.getResponseCode();
                JSObject responseHeaders = new JSObject();
                for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet()) {
                    if (header.getKey() == null) continue; // the status line
                    String lower = header.getKey().toLowerCase();
                    // The body handed back is already decoded and sized by us.
                    if (lower.equals("content-encoding") || lower.equals("content-length")
                            || lower.equals("transfer-encoding")) continue;
                    responseHeaders.put(lower, String.join(", ", header.getValue()));
                }
                InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                byte[] responseBody = stream == null ? new byte[0] : readAll(stream);

                JSObject result = new JSObject();
                result.put("status", status);
                result.put("headers", responseHeaders);
                result.put("body", Base64.encodeToString(responseBody, Base64.NO_WRAP));
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Network request failed: " + error.getMessage(), error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private static byte[] readAll(InputStream stream) throws java.io.IOException {
        try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return out.toByteArray();
        }
    }

    // ---------- starlink.com sign-in ----------

    @PluginMethod
    public void getCookies(PluginCall call) {
        JSArray urls = call.getArray("urls", new JSArray());
        CookieManager manager = CookieManager.getInstance();
        // name=value pairs, de-duplicated across the hosts asked about.
        Set<String> seen = new LinkedHashSet<>();
        Map<String, String> ordered = new LinkedHashMap<>();
        try {
            for (int i = 0; i < urls.length(); i++) {
                String header = manager.getCookie(urls.getString(i));
                if (header == null) continue;
                for (String part : header.split(";")) {
                    String pair = part.trim();
                    int eq = pair.indexOf('=');
                    if (eq <= 0 || !seen.add(pair)) continue;
                    ordered.put(pair, pair.substring(0, eq));
                }
            }
        } catch (Exception error) {
            call.reject("Could not read cookies", error);
            return;
        }
        JSONArray cookies = new JSONArray();
        for (Map.Entry<String, String> entry : ordered.entrySet()) {
            JSObject cookie = new JSObject();
            cookie.put("name", entry.getValue());
            cookie.put("value", entry.getKey().substring(entry.getValue().length() + 1));
            cookies.put(cookie);
        }
        JSObject result = new JSObject();
        result.put("cookies", cookies);
        call.resolve(result);
    }

    @PluginMethod
    public void openSignIn(PluginCall call) {
        String url = call.getString("url", SignInActivity.DEFAULT_URL);
        Intent intent = new Intent(getContext(), SignInActivity.class);
        intent.putExtra(SignInActivity.EXTRA_URL, url);
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("Only web links can be opened");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    // ---------- notifications ----------

    static void createAlertChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            ALERT_CHANNEL, "Starlink alerts", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Outages, obstructions, data limits and other alerts");
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private boolean notificationsAllowed() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(
                getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
    }

    @PluginMethod
    public void notify(PluginCall call) {
        if (!notificationsAllowed()) {
            call.reject("Notifications are turned off for this app in Android settings.");
            return;
        }
        String id = call.getString("id", "alert");
        Context context = getContext();
        Intent open = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(
            context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, ALERT_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_dish)
            .setContentTitle(call.getString("title", "Dishylink"))
            .setContentText(call.getString("body", ""))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(call.getString("body", "")))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(tap)
            .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(context).notify(id.hashCode(), builder.build());
            call.resolve();
        } catch (SecurityException error) {
            call.reject("Notifications are turned off for this app in Android settings.");
        }
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", notificationsAllowed());
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(result);
    }

    // ---------- background recording ----------

    @PluginMethod
    public void startRecorder(PluginCall call) {
        RecorderService.startOrUpdate(getContext(), call.getString("status", "Recording your Starlink"));
        call.resolve();
    }

    @PluginMethod
    public void stopRecorder(PluginCall call) {
        RecorderService.stop(getContext());
        call.resolve();
    }
}
