# ZXing core

`core-3.5.3.jar` is the unmodified `com.google.zxing:core:3.5.3` dependency from [Maven Central](https://repo.maven.apache.org/maven2/com/google/zxing/core/3.5.3/core-3.5.3.jar). It has no runtime dependencies.

SHA-256: `8d8064c1636fdaef7189dd9055c7d59950a8940a12f2293956446ec3c109fd82`

The PowerShell, Gradle and isolated instrumentation builds verify this hash before compilation and include the same JAR in D8 inputs. Builds do not download it. The upstream license and notices are retained in `../app/src/main/assets/ZXING-LICENSE.txt` and included in the APK. ZXing is used only by the Android application, not the WebView SDK AAR.
