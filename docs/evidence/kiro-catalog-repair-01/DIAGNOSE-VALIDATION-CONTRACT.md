# diagnose-validation-01
前case diagnose-400已耗尽并确认ValidationException，但狭窄谓词不能识别null、空串、字段约束、profile空格形式等原因。本case不改变请求，仅一次补齐该具体缺失证据；禁止再泛化重试。
最多1 management目录请求，0刷新/profile/模型，15s请求/20s硬停，16KiB响应，仅RAM正文。保存固定字段名/固定验证关键词的布尔匹配与白名单exception类型，不保存自由文本、值或hash。独立wx claim成功失败均耗尽。正常Axiom账号/direct、配置不改。离线分类器自测先行。若依旧未知，转静态证据定位，不连续实发。
