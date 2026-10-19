package com.axiom2.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** App-private ciphertext only; the encryption key never leaves AndroidKeyStore. */
final class TailnetCredentialStore {
    // All Activity instances enqueue durable operations here, so an old save cannot overtake a new removal.
    static final java.util.concurrent.ExecutorService SERIAL = java.util.concurrent.Executors.newSingleThreadExecutor();
    private static final String ALIAS = "axiom.tailnet.credentials.v1";
    private final SharedPreferences preferences;
    TailnetCredentialStore(Context context) { preferences = context.getSharedPreferences("tailnet-credentials", Context.MODE_PRIVATE); }
    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        if (!create) throw new IOException("missing key");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    synchronized TailnetApi.Credentials load() throws IOException {
        String value = preferences.getString("encrypted", null);
        if (value == null) return null;
        byte[] plain = null;
        try {
            if (value.length() > 32768) throw new IOException();
            String[] pieces = value.split(":"); if (pieces.length != 3 || !pieces[0].equals("1")) throw new IOException();
            byte[] iv = Base64.decode(pieces[1], Base64.NO_WRAP);
            if (iv.length != 12) throw new IOException();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, iv));
            cipher.updateAAD(ALIAS.getBytes(StandardCharsets.UTF_8));
            plain = cipher.doFinal(Base64.decode(pieces[2], Base64.NO_WRAP));
            JSONObject json = new JSONObject(new String(plain, StandardCharsets.UTF_8));
            return new TailnetApi.Credentials(json.getString("tailnet"), json.getString("clientId"), json.getString("secret"), json.getInt("port"));
        } catch (Exception e) { throw new IOException("无法读取已保存的设备凭据，请重新配置或移除配置。原连接历史仍可使用。"); }
        finally { if (plain != null) Arrays.fill(plain, (byte) 0); }
    }
    synchronized void save(TailnetApi.Credentials credentials) throws IOException {
        byte[] plain = null;
        try {
            JSONObject json = new JSONObject().put("tailnet", credentials.tailnet).put("clientId", credentials.clientId)
                    .put("secret", credentials.secret).put("port", credentials.port);
            plain = json.toString().getBytes(StandardCharsets.UTF_8);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(true));
            cipher.updateAAD(ALIAS.getBytes(StandardCharsets.UTF_8));
            String value = "1:" + Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(plain), Base64.NO_WRAP);
            if (!preferences.edit().putString("encrypted", value).commit()) throw new IOException();
        } catch (Exception e) { throw new IOException("凭据未能加密保存，请重试。没有保存明文凭据。"); }
        finally { if (plain != null) Arrays.fill(plain, (byte) 0); }
    }
    synchronized void clear() throws IOException {
        if (!preferences.edit().clear().commit()) throw new IOException("移除配置失败，请重试。");
        try { KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); store.deleteEntry(ALIAS); }
        catch (Exception e) { throw new IOException("凭据已移除，但加密密钥清理失败，请再次移除配置后重试。"); }
    }
}
