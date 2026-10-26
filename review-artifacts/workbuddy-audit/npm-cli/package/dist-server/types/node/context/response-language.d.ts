/** 用户显式设置的语言优先；未设置时回落到系统 locale。返回 false 时由用户消息的语言决定。 */
export declare function isChineseResponseEnvironment(language: unknown): boolean;
/** 旁路模型的自然语言字段使用宿主下发给主模型的同一语言设置，不再根据输入内容二次判断。 */
export declare function resolveSideModelLanguage(language: unknown): 'zh-CN' | 'en';
