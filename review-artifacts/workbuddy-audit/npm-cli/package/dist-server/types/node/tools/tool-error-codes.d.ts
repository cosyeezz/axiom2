/**
 * WorkBuddy CLI 工具错误码枚举
 *
 * 纯数字字符串格式，与 agent-craft-core 的 ToolCallErrorCode 编号段对齐（相同工具相同编号），
 * 保证 ClickHouse chat_tool_action 聚合 SQL（REGEXP '^[0-9]+$'）能同时覆盖两条上报路径的数据。
 *
 * 编号段分配：
 *   1000-1099   read_file
 *   2000-2099   write_to_file
 *   4000-4099   replace_in_file
 *   7100-7199   search_content
 *   7200-7299   glob
 *   8000-8099   bash
 *   19200-19209 AskUserQuestion
 *   19910-19919 present_files
 *   19920-19929 Agent
 *   19930-19939 后台任务定位（TaskStop/TaskOutput）
 *   19940-19949 A2A（出站，issue #99451）
 *   90000-99999 通用
 */
export declare enum ToolErrorCode {
    Success = "0",
    ReadFileError = "1000",
    ReadFileNotFoundError = "1001",
    ReadFilePermissionError = "1002",
    ReadFilePathError = "1003",
    ReadFileEncodingError = "1004",
    ReadFileTokenLimitExceededError = "1005",
    ReadFileTooLargeError = "1006",
    ReadFileBinaryError = "1007",
    ReadFileOffsetBeyondEOFError = "1008",
    ReadFileInvalidParamsError = "1009",
    ReadFileModelNoImageSupportError = "1010",
    ReadFileImageTooLargeError = "1011",
    ReadFileInvalidNotebookError = "1012",
    ReadFileStreamReadError = "1013",
    WriteFileError = "2000",
    WriteFilePermissionError = "2001",
    WriteFilePathError = "2002",
    WriteFileLockError = "2003",
    WriteFileEncodingError = "2004",
    WriteFileContentError = "2005",
    WriteFileArtifactPathError = "2006",
    WriteFileDiskFullError = "2007",
    WriteFileSandboxError = "2008",
    WriteFileNotReadError = "2009",
    WriteFileModifiedSinceReadError = "2010",
    ReplaceInFileError = "4000",
    ReplaceExecuteError = "4001",
    ReplaceTimeoutError = "4002",
    ReplaceNoMatchesError = "4003",
    ReplaceNoContentChangedError = "4004",
    ReplaceUnKnownError = "4005",
    ReplaceCommitFileError = "4006",
    ReplaceVscodeError = "4007",
    ReplaceMultipleMatchesError = "4008",
    ReplaceArtifactPathError = "4009",
    ReplaceFileNotReadError = "4010",
    ReplaceFileModifiedSinceReadError = "4011",
    ReplaceFilePathError = "4012",
    ReplacePermissionError = "4013",
    ReplaceSandboxError = "4014",
    ReplaceInternalError = "4015",
    ReplaceDiskFullError = "4016",
    SearchContentError = "7100",
    SearchContentPathError = "7101",
    SearchContentPatternError = "7102",
    SearchContentParseError = "7103",
    SearchContentPermissionError = "7104",
    GlobError = "7200",
    GlobPathError = "7201",
    GlobPatternError = "7202",
    GlobInvalidParamsError = "7203",
    GlobPermissionError = "7204",
    ExecuteCommandError = "8000",
    ExecuteCommandTimeoutError = "8001",
    ExecuteCommandExitCodeError = "8002",
    ExecuteCommandMissingError = "8003",
    ExecuteCommandEnvError = "8004",
    ExecuteCommandKilledError = "8005",
    ExecuteCommandSandboxDeniedError = "8006",
    ExecuteCommandSandboxInfrastructureError = "8007",
    ExecuteCommandSecurityBlockedError = "8008",
    ExecuteCommandBackgroundUnsupportedError = "8009",
    ExecuteCommandEscalationDeniedError = "8010",
    ExecuteCommandSystemToolDisabledError = "8011",
    ExecuteCommandCancelledError = "8012",
    ExecuteCommandSignalTerminatedError = "8013",
    ExecuteCommandRootResolveError = "8014",
    AskFollowupQuestionError = "19200",
    AskFollowupMissingToolCallIdError = "19201",
    AskFollowupNoAnswersError = "19202",
    AskFollowupInvalidParamsError = "19203",
    AskFollowupUserDeclinedError = "19204",
    /** Tool 被 env / capability 门控关闭，理论上不应被模型选到；防御性回报。 */
    AskStructuredInputDisabledError = "19205",
    /** 缺少 toolCallId 或 requestedSchema 校验失败。 */
    AskStructuredInputInvalidParamsError = "19206",
    /** 未找到可用的 ACP / SDK elicitation 通道。 */
    AskStructuredInputNoChannelError = "19207",
    /** 用户 decline/cancel。 */
    AskStructuredInputUserDeclinedError = "19208",
    /** 客户端返回响应形状非法（非 accept/decline/cancel）。 */
    AskStructuredInputMalformedResponseError = "19209",
    PresentFilesError = "19910",
    PresentFilesInvalidParamsError = "19911",
    PresentFilesPermissionDeniedError = "19912",
    PresentFilesTimeoutError = "19913",
    AgentExecutionError = "19920",
    AgentSessionRequiredError = "19921",
    AgentInvalidParamsError = "19922",
    AgentMaxTurnsError = "19923",
    AgentNestingDepthLimitError = "19924",
    AgentSpawnLimitError = "19925",
    /** TaskStop：目标 task_id 不存在于 AgentTaskManager 与 ToolManager 后台任务表中。 */
    TaskStopNotFoundError = "19930",
    /** TaskOutput：目标 task_id 不存在于 AgentTaskManager 与 ToolManager 后台任务表中。 */
    TaskOutputNotFoundError = "19931",
    A2ADisabledError = "19940",
    A2AAgentNotFoundError = "19941",
    A2ASkillNotFoundError = "19942",
    A2ACallError = "19943",
    A2ATimeoutError = "19944",
    A2ANotAllowedInSubSessionError = "19945",
    A2ATaskNotFoundError = "19946",
    A2ATaskNotCancelableError = "19947",
    A2AAmbiguousAgentError = "19948",
    /** 远端 A2A 端点返回 HTTP 401，且宿主没有（或拒绝了）完成授权，重试后仍未通过。 */
    A2AAuthRequiredError = "19949",
    /** ViewImage：图片文件不存在或不可读。 */
    ViewImageFileNotFoundError = "19950",
    /** ViewImage：图片格式不在白名单（png/jpg/jpeg/webp/gif/bmp）。 */
    ViewImageUnsupportedFormatError = "19951",
    /** ViewImage：图片超过 20MB 且压缩后仍超限。 */
    ViewImageTooLargeError = "19952",
    /** ViewImage：识图模型不可用（超时或调用失败）。 */
    ViewImageVisionUnavailableError = "19953",
    /** ViewImage：参数无效（空路径 / 空 query）。 */
    ViewImageInvalidParamsError = "19954",
    /** ViewImage：本轮图片读取字节预算已用尽（防单轮海量大图 OOM）。 */
    ViewImageBudgetExceededError = "19955",
    InvalidParameterError = "90000",
    ExecuteError = "90001",
    ExecuteTimeoutError = "90002",
    ToolTimeoutError = "90003",
    ToolCancelledError = "90004",
    /** 写前 checkpoint 备份失败：拦下本次写入，避免文件在没有回退快照的情况下被改动 */
    CheckpointBackupFailedError = "90005",
    UnknownToolError = "99999"
}
/** 根据错误码获取枚举名（如 '1001' → 'ReadFileNotFoundError'） */
export declare function getToolErrorName(code: string): string;
