# 模型默认参考价格

查询并设置日期：2026-10-22。单位：**美元 / 百万 Token**。这些是标准模型的参考价格，用作预计费用的默认值；自定义渠道实际扣款以渠道账单为准。价格保存在本机模型配置中，仍可在模型编辑器手动修改，从下一次执行生效，历史费用不重算。

| 配置模型 ID | 输入 | 输出 | 缓存读取 | 缓存写入 |
| --- | ---: | ---: | ---: | ---: |
| `deepseek-v4.1-flash-1017` | 0.30 | 1.20 | 0.006 | 0 |
| `glm-5.3` | 1.40 | 4.40 | 0.26 | 0 |
| `qwen3.8-max` | 2.00 | 6.00 | 0.25 | 2.50 |
| `claude-opus-5.5` | 4.00 | 20.00 | 0.20 | 5.00 |
| `claude-sonnet-5.5` | 2.00 | 10.00 | 0.10 | 2.50 |
| `gpt-6-astra` | 10.00 | 50.00 | 1.00 | 12.50 |
| `gpt-6.1-sol` | 2.00 | 10.00 | 0.10 | 2.50 |

## 来源和采用口径

- **DeepSeek**：[官方中文定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)确认 `deepseek-flash` 对应 DeepSeek-V4.1-Flash-1017，高峰人民币价格为输入 2、输出 8、缓存命中 0.04，空闲减半。美元默认值采用 [models.dev 精确型号目录](https://raw.githubusercontent.com/anomalyco/models.dev/dev/providers/deepseek/models/deepseek-flash.toml)记录的美元价，并应用其高峰两倍系数；本次未在官方英文页面正文中直接核实美元数值。高峰为北京时间工作日 09:00–12:00、14:00–18:00（中国法定节假日除外）；本应用当前使用静态高峰默认值，不按时段自动切价。缓存自动启用，无独立缓存创建收费。
- **GLM**：[Z.AI 官方国际定价](https://docs.z.ai/guides/overview/pricing)，采用美元标准价，不将智谱中国人民币价格直接填入美元字段。缓存存储目前限时免费，未单列每 Token 创建费用，因此缓存写入设为 0。
- **Qwen**：[QwenCloud 官方型号页](https://www.qwencloud.com/models/qwen3.8-max)，采用国际美元价。缓存读取默认采用隐式缓存 0.25；若渠道使用显式缓存，可手动改为 0.17，显式缓存创建为 2.50。一个缓存读取字段无法同时表达两种命中价格。
- **Claude Opus**：[官方型号页](https://platform.claude.com/docs/en/models/opus-5-5/overview)。配置 ID `claude-opus-5.5` 按其名称采用官方 `claude-opus-5-5` 的标准参考价；未验证渠道别名的实际模型映射。默认缓存写入为 5 分钟价格 5，1 小时价格为 8。
- **Claude Sonnet**：[官方型号页](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)。配置 ID `claude-sonnet-5.5` 按其名称采用官方 `claude-sonnet-5-5` 的标准参考价；未验证渠道别名的实际模型映射。默认缓存写入为 5 分钟价格 2.50，1 小时价格为 4。
- **GPT-6 Astra**：[官方型号页](https://developers.openai.com/api/docs/models/gpt-6-astra)，缓存写入采用 30 分钟标准价。
- **GPT-6.1 Sol**：[官方型号页](https://developers.openai.com/api/docs/models/gpt-6.1-sol)，缓存写入采用 30 分钟标准价。

## 长上下文阶梯

两个 GPT 模型总输入（含缓存）**超过 272,000 Token** 时，整次请求应用以下价格；这些阶梯一并写入模型配置的 `cost.tiers`，由运行时选择。

| 模型 | 输入 | 输出 | 缓存读取 | 缓存写入 |
| --- | ---: | ---: | ---: | ---: |
| `gpt-6-astra` | 20 | 75 | 2 | 25 |
| `gpt-6.1-sol` | 4 | 15 | 0.2 | 5 |

以上默认值不包含 Batch、Flex、Priority、Ultrafast、区域限定或渠道折扣等条件。GPT 的 12 小时显式缓存、Claude 的其他缓存时长亦需按实际请求及接口返回数据核算。
