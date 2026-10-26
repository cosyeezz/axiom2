/**
 * 恶意网站命中后给模型的两句引导语，沙箱拦截与 WebFetch 拦截共用。
 *
 * 必须显式禁止换工具重试：否则模型会很自然地改用 Bash curl 再试一次，虽然沙箱侧
 * 会再拦一次，但那已经违背需求「命中后不得换命令或工具重试」。
 *
 * 两条路径的渲染格式不同（沙箱按行输出、WebFetch 拼成一句），所以只共用句子本身，
 * 不共用拼装逻辑。
 */
export declare const MALICIOUS_BLOCK_NO_RETRY_HINT = "Do NOT retry this request with another command, tool, protocol, or workaround.";
export declare const MALICIOUS_BLOCK_WHITELIST_HINT = "If access is required, ask the user to add the domain to the whitelist in Settings \u2192 Security Center \u2192 Network Security.";
