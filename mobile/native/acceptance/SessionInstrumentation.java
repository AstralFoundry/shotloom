package com.shotloom.acceptance;

import android.app.Instrumentation;
import android.os.Bundle;
import android.content.Intent;
import android.webkit.WebView;
import android.webkit.CookieManager;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Test APK only: seeds an isolated session; shipped app has no test credential entry point. */
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
            String session = arguments.getString("sessionBase64");
            if (session != null && !session.isEmpty()) seedNativeSession(new String(Base64.decode(session, Base64.DEFAULT), StandardCharsets.UTF_8));
            if ("1".equals(arguments.getString("debug"))) {
                // Test APK only: inspect the release WebView without enabling debugging in the shipped app.
                runOnMainSync(() -> WebView.setWebContentsDebuggingEnabled(true));
                Intent launch = getTargetContext().getPackageManager().getLaunchIntentForPackage(getTargetContext().getPackageName());
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getTargetContext().startActivity(launch);
                for (int attempt = 0; attempt < 450; attempt++) {
                    Thread.sleep(2000);
                    runOnMainSync(() -> WebView.setWebContentsDebuggingEnabled(true));
                }
            }
            result.putString("stream", "Test session installed\n");
            finish(-1, result);
        } catch (Exception error) {
            result.putString("stream", "Test session setup failed: " + error.getClass().getSimpleName() + "\n");
            finish(1, result);
        }
    }

    // Matches the pinned expo-secure-store 57 AES format; exercise this again when upgrading Expo.
    private void seedNativeSession(String session) throws Exception {
        JSONObject value = new JSONObject(session);
        if (value.getString("token").isEmpty() || value.getString("userId").isEmpty()) throw new IllegalArgumentException("Invalid native session");
        String alias = "AES/GCM/NoPadding:key_v1:keystoreUnauthenticated";
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(alias)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, ((KeyStore.SecretKeyEntry) store.getEntry(alias, null)).getSecretKey());
        GCMParameterSpec spec = cipher.getParameters().getParameterSpec(GCMParameterSpec.class);
        JSONObject encrypted = new JSONObject().put("scheme", "aes").put("usesKeystoreSuffix", true).put("keystoreAlias", "key_v1").put("requireAuthentication", false)
            .put("ct", Base64.encodeToString(cipher.doFinal(session.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP))
            .put("iv", Base64.encodeToString(spec.getIV(), Base64.NO_WRAP)).put("tlen", spec.getTLen());
        StringBuilder hash = new StringBuilder();
        for (byte part : MessageDigest.getInstance("SHA-256").digest("https://shotloom.0xfiang.com".getBytes(StandardCharsets.UTF_8))) hash.append(String.format("%02x", part & 255));
        if (!getTargetContext().getSharedPreferences("SecureStore", Context.MODE_PRIVATE).edit()
            .putString("key_v1-shotloom.session." + hash, encrypted.toString()).commit()) throw new IllegalStateException("Secure storage setup failed");
    }
}
