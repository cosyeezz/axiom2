import java.io.File;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;

/** Decode screenshots of the real browser SVG/CSS with an independent Java decoder. */
public final class QrImageCheck {
    public static void main(String[] args) throws Exception {
        BufferedImage image = ImageIO.read(new File(args[0]));
        int width = image.getWidth(), height = image.getHeight();
        int[] pixels = image.getRGB(0,0,width,height,null,0,width);
        String decoded = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(width,height,pixels)))).getText();
        if (!args[1].equals(decoded)) throw new AssertionError("Rendered QR payload differs: " + decoded);
        System.out.println("PASS rendered QR " + args[0] + " -> " + decoded);
    }
}
