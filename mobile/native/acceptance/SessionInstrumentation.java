package com.shotloom.acceptance;

import android.app.Instrumentation;
import android.os.Bundle;
import android.webkit.CookieManager;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Test APK only: seeds an isolated server session in the target WebView cookie jar. */
public final class SessionInstrumentation extends Instrumentation {
    private Bundle arguments;
    @Override public void onCreate(Bundle args) { arguments = args; start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            CountDownLatch saved = new CountDownLatch(1);
            String cookie = arguments.getString("cookie");
            if (cookie == null || cookie.isEmpty()) throw new IllegalArgumentException("Missing test session");
            boolean[] accepted = {false};
            runOnMainSync(() -> CookieManager.getInstance().setCookie(
                "https://shotloom.0xfiang.com", cookie + "; Path=/; Secure; HttpOnly; SameSite=Lax",
                ok -> { accepted[0] = ok; saved.countDown(); }));
            if (!saved.await(10, TimeUnit.SECONDS) || !accepted[0]) throw new IllegalStateException("Cookie setup failed");
            runOnMainSync(() -> CookieManager.getInstance().flush());
            result.putString("stream", "Test session installed\n");
            finish(-1, result);
        } catch (Exception error) {
            result.putString("stream", "Test session setup failed: " + error.getClass().getSimpleName() + "\n");
            finish(1, result);
        }
    }
}
