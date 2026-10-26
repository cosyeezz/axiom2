/**
 * WeCom AI Bot Media Handler
 *
 * Handles media download for WeCom AI Bot WebSocket messages.
 *
 * WeCom AI Bot message media fields:
 *   - image: { url: string; aeskey: string }
 *   - voice: { url: string; aeskey: string }
 *   - file:  { url: string; aeskey: string; filename: string }
 *
 * Download flow: validate URL (SSRF allowlist) → fetch → detect/decrypt → save to temp file
 *
 * Decryption algorithm aligned with @wecom/aibot-node-sdk `decryptFile`:
 *   - Algorithm: AES-256-CBC
 *   - Key: Base64-decoded aeskey (32 bytes)
 *   - IV: first 16 bytes of the decoded key
 *   - Padding: PKCS#7 with 32-byte block size (manual removal)
 */
/**
 * Download a WeCom AI Bot media file to a local temp file.
 *
 * Strategy:
 *   1. Validate URL against SSRF allowlist (https + WeCom domains)
 *   2. Fetch the raw data from the URL
 *   3. If the raw data is already a valid image (magic bytes), save it directly
 *   4. Otherwise, attempt AES-256-CBC decryption with aeskey
 *   5. Auto-correct file extension based on detected format
 *   6. Fallback: save raw data as-is (when no aeskey or decryption produces empty result)
 *
 * @param url - Media download URL from the message callback
 * @param aeskey - AES key for decryption (base64 encoded, 32 bytes when decoded)
 * @param extension - File extension including dot (e.g. '.jpg', '.silk')
 * @returns Path to the saved local file
 */
export declare function downloadWecomBotMedia(url: string, aeskey: string | undefined, extension: string): Promise<string>;
