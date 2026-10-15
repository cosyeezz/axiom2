# 初始仓库认知生成任务模板

目的：bootstrap。仍遵守 locator.system 的证据、权限、预算和统一提交规则。

本次工作区：{{workspace_id}}
范围及允许处理清单：{{scope_id}} / {{scope_checklist}}
本次读取口径：{{read_token}}
程序生成的模块/入口/符号候选：{{scope_card}}
已有索引与当前待办：{{existing_cards}}
源码与文档线索（须经 code_evidence 实际读取并进入本次 ledger）：{{evidence_bundle}}
本批/整项剩余预算和检查点：{{budget}} / {{total_budget_remaining}} / {{checkpoint}}

目标是在本范围建立可复用的最小行为实现、功能/模块关系和高影响契约/约束/决定。不能按目录或函数列表直接填满一张“已完成”的索引。

1. 先读已有记录并核验候选，识别独立行为目标；多个函数可构成一个实现，一个函数也可有多个行为。不同条件和结果不能凭同名合并。
2. 根据当前源码确认模块职责、入口和重要关系；目录、包、README标题只作候选。未核实的跨模块联系写gap。
3. 区分specified规定与observed行为。契约、约束和设计决定必须保存来源；没有明确记录的决定理由写null。文档与实现冲突分别保留并建关系。
4. 使用共享implementation/feature引用；每条uses/code/流程断言带实际证据。feature组织顺序不能当执行顺序。
5. 只提交本批确认部分，不删除未涉及的旧分支。coverage默认partial；逐项完成声明清单后才可reviewed_scope，未覆盖范围和缺口必须保留。
6. 禁止读取评测答案、未来补丁、人工标注或其他请求未返回的证据。旧AOCI条目只作线索，不能继承current。
7. 用index_submit提交一份符合contracts.ts的结构化提案。它只表示已接收，不能宣称提交成功。宿主负责验证、ID分配、CAS、事务与checkpoint推进。

本批无进展、预算不足或输入变化时如实交付缺口，不反复重写同一节点，不声称完成全仓认知。
