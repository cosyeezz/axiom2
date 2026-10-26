export declare function shouldDetectWeixinPayFromBuiltinTool(toolName: string | undefined): boolean;
/**
 * Extract the paymentCode carried by a `WeixinPay-Required` field/header, if any.
 *
 * 熵护栏：凭证必含大写字母 / 数字 / 下划线 / 连字符。纯小写散文词（如
 * "set the WeixinPay-Required: header to your code" 捕获到的 "header"）不构成
 * 凭证，借此消除文档/提示语的误命中（否则会拿无效 code 发起一次无意义的 pay）。
 * 不锚定 `PAYCODE_` 前缀，以免后端凭证前缀变化时漏检真凭证。
 */
export declare function extractPaymentCode(text: string | undefined): string | undefined;
