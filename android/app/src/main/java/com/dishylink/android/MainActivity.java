package com.dishylink.android;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import java.lang.ref.WeakReference;

public class MainActivity extends BridgeActivity {

    private static WeakReference<MainActivity> current = new WeakReference<>(null);

    /** The recording notification's "Stop and close" action. */
    static void closeIfOpen() {
        MainActivity activity = current.get();
        if (activity != null) activity.finishAndRemoveTask();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StarlinkNativePlugin.class);
        super.onCreate(savedInstanceState);
        current = new WeakReference<>(this);

        // The status and navigation bar areas (kept clear of the page by
        // adjustMarginsForEdgeToEdge) match the dashboard's dark page, with light icons.
        getWindow().getDecorView().setBackgroundColor(0xFF0A0A0A);
        WindowInsetsControllerCompat bars =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(false);
        bars.setAppearanceLightNavigationBars(false);

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        // The page lays out at the phone's own width (mobile/index.html), so no
        // page zoom: a pinch inside a chart would otherwise scale the whole app.
        settings.setSupportZoom(false);

        // Back on the dashboard sends the app to the background instead of closing
        // it, so the recorder keeps running. "Stop and close" on the recording
        // notification is how to end it.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack();
                else moveTaskToBack(true);
            }
        });
    }

    @Override
    public void onDestroy() {
        if (isFinishing()) RecorderService.stop(this);
        super.onDestroy();
    }
}
