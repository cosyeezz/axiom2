/**
 * SpaceEngine 上传（View API）业务错误码。
 *
 * 与 `@genie/agent-provider` 的同名常量保持一致（这里本地声明而非跨包 value import，
 * 避免 CLI 打包引入 agent-provider 运行时依赖）。
 */
/** 知识空间上传业务错误码：文件大小超限（ErrFileTooLarge）。 */
export declare const KNOWLEDGE_UPLOAD_FILE_TOO_LARGE_CODE = 56040;
/** 知识空间上传业务错误码：标题命中内容审核（Code_ERR_NODE_BLOCKED）。 */
export declare const KNOWLEDGE_UPLOAD_MODERATION_BLOCKED_CODE = 619610;
/** 资料库容量不足（SpaceEngine 业务码），映射为工具的 CAPACITY_EXCEEDED。 */
export declare const SPACE_CAPACITY_EXCEEDED_CODE = 20010;
/** 异步解析阶段发现格式不支持（Code_ERR_ZIP_UNSUPPORTED_FILE_TYPE），映射为 UNSUPPORTED_FILE_TYPE。 */
export declare const SPACE_UNSUPPORTED_FILE_TYPE_CODE = 56042;
