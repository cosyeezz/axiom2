import { errorMessage } from "./error-message.js";

export function compressionError(error: unknown, fallback = "压缩失败，未收到具体错误原因。") {
  return errorMessage(error, fallback);
}
