package com.axiom2.android;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.net.URI;

/** Local QR decoding only; no image upload, URL fetching, or external intent dispatch. */
final class ConnectionQr {
    static String address(String value) {
        try {
            if (value == null || value.length() > 256 || !value.matches("http://(?:[0-9.]+|\\[[0-9a-fA-F:]+\\]):[1-9][0-9]{0,4}/?")) throw new Exception();
            URI uri = new URI(value);
            String host = uri.getHost();
            if (host == null) throw new Exception();
            if (host.startsWith("[")) host = host.substring(1, host.length() - 1);
            if (!TailnetApi.isTailnetIp(host) || uri.getPort() < 1 || uri.getPort() > 65535) throw new Exception();
            return "http://" + (host.contains(":") ? "[" + host.toLowerCase(java.util.Locale.ROOT) + "]" : host) + ":" + uri.getPort();
        } catch (Exception e) { throw new IllegalArgumentException("请扫描电脑 Axiom「手机连接」中的二维码。"); }
    }
    static String decode(byte[] frame, int width, int height) {
        if (width <= 0 || height <= 0 || (long) width * height > 16000000 || frame == null || frame.length < (long) width * height) return null;
        QRCodeReader reader = new QRCodeReader();
        try {
            return reader.decode(new BinaryBitmap(new HybridBinarizer(new PlanarYUVLuminanceSource(frame, width, height, 0, 0, width, height, false)))).getText();
        } catch (com.google.zxing.ReaderException e) { return null; }
        finally { reader.reset(); }
    }
}
