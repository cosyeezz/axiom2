export interface DiagramCase { id: string; title: string; source: string; fallback?: boolean; panel?: boolean }
const box = (rows: string[], width = 28) => `┌${"─".repeat(width)}┐\n${rows.map(row => `│${row}${" ".repeat(Math.max(0, width - displayWidth(row)))}│`).join("\n")}\n└${"─".repeat(width)}┘`;
// Deliberately independent of the parser, for the fixture's terminal grid.
const displayWidth = (s: string) => Array.from(s).reduce((n, c) => n + (/[^\u0000-\u00ff]/u.test(c) ? 2 : 1), 0);
// Exact diagram from the original assistant reply, including both indentation
// errors and the three standalone arrows. Never pre-align this regression input.
export const realAssistantDiagram = "未整理数量达到阈值 ─┐\n                  ├→ 尝试获取整理锁（不等待）\n定时检查未整理数据 ─┘       ├─ 失败：本次退出\n                          └─ 成功：读取本批数据\n                                    ↓\n                                  执行整理\n                                    ↓\n                              成功后标记已整理\n                                    ↓\n                                  释放锁";
export const diagramCases: DiagramCase[] = [
  { id: "merge", title: "中文汇合与不完整分支（真实输入）", source: "未整理数量达到阈值 ─┐\n                    ├→ 尝试获取同一把整理锁\n定时检查未整理数据 ─┘       ├─ 失败：本次退出\n                            └─ 成功：读取本批数据并整理" },
  { id: "assistant-original", title: "模型原回复：两处错位与独立箭头（精确原文）", source: realAssistantDiagram },
  { id: "offset-left", title: "汇合缩进向左偏一格", source: "A ─┐\n  ├→ B\nC ─┘" },
  { id: "offset-right", title: "汇合缩进向右偏两格", source: "A ─┐\n     ├→ B\nC ─┘" },
  { id: "offset-branch", title: "已有可识别汇合也对齐错位的下分支", source: "A ─┐\n   ├→ B\nC ─┘  ├─ failed\n     └─ success" },
  { id: "offset-ambiguous", title: "两个可能锚点不猜测归属", source: "A ─┐─┐\n    ├→ B\nC ─┘─┘", fallback: true },
  { id: "offset-far", title: "超过两格的错位不自动挪动", source: "A ─┐\n      ├→ B\nC ─┘", fallback: true },
  { id: "offset-multiple", title: "同一行有第二结构时不整行拖动", source: "A ─┐\n ├→ B    C ─┐\nC ─┘", fallback: true },
  { id: "mixed-box", title: "中英混排、词间空格和右边框", source: box([" API 请求 Request OK", " 状态 status: 200", " 中文 English 中文"]) },
  { id: "multiline", title: "多行框、上下相同字段对齐", source: box([" name: 张三", " role: admin", " time: 12:30", " 重试   3 次"]) },
  { id: "ascii-boxes", title: "纯 ASCII 连接两个框", source: "+-------+       +-------+\n| start |------>|  end  |\n+-------+       +-------+" },
  { id: "unicode-boxes", title: "中文两个框与箭头", source: "┌────────┐     ┌────────┐\n│  开始  │────→│  结束  │\n└────────┘     └────────┘" },
  { id: "vertical", title: "竖向箭头", source: "  Start\n    │\n    ↓\n  执行任务\n    │\n    ↓\n   Done" },
  { id: "bidirectional", title: "左右双向箭头与上箭头", source: "   ↑\n   │\nA ←┼→ B\n   │\n   ↓" },
  { id: "ascii-math", title: "框内多行数学符号不是连线", source: box([" a + b", " c + d", " x | y", " p | q", " a -- b", " C++ / a--b"]) },
  { id: "increments", title: "连续自增运算符不能误画成小方框", source: box([" ++ i", " ++ j"]) },
  { id: "nested-ascii", title: "真实嵌套ASCII框保留边线", source: box([" +-----+", " |child|", " +-----+"]) },
  { id: "arrow-chain", title: "连续v不能靠候选字符虚构箭头尾部", source: "┌─────────┐\n│ A       │\n│ v       │\n│ v       │\n│ │       │\n│ B       │\n└─────────┘" },
  { id: "words", title: "连续单词save/value与指数不是箭头", source: box([" save value", " save value", " x^2 > 0", "   |", " ^ v < >"]) },
  { id: "columns", title: "中英文单词中的同列字母对齐", source: box([" 中文AB，Ｃ", " 1234AB，Ｃ", " 中文12，３"]) },
  { id: "literal-arrows", title: "框内示例箭头与比较符", source: box([" x > 1", " y > 2", " v <test>", " a --> b"]) },
  { id: "double", title: "双线框不能变单线", source: "╔════════════╗\n║ 数据 / API ║\n╚════════════╝", fallback: true },
  { id: "rounded", title: "圆角框不能变方框", source: "╭────────────╮\n│ 圆角框 API │\n╰────────────╯" },
  { id: "dashed", title: "虚线与粗线不能变实细线", source: "┏━━━━━━━━━━━━┓\n┃   重要     ┃\n┗━━━━━━━━━━━━┛\n      │\n      ↓\n┌╌╌╌╌╌╌╌╌╌╌╌╌┐\n╎   可选     ╎\n└╌╌╌╌╌╌╌╌╌╌╌╌┘", fallback: true },
  { id: "diagonal", title: "斜线分支不可散落为文字", source: "    ┌────┐\n    │判断│\n    └────┘\n     /  \\\n    v    v\n   Yes   No", fallback: true },
  { id: "bracket", title: "方括号节点和左右分叉", source: "[入口]\n   │\n   ├──→ [成功]\n   └──→ [失败]" },
  { id: "emoji", title: "emoji/组合字素混排", source: "┌────────────────────┐\n│ 👩‍💻 开发 é API    │\n│ 🇨🇳 中文 ✅ done   │\n└────────────────────┘", fallback: true, panel: true },
  { id: "fullwidth", title: "全角标点、全角空格与缩进", source: box([" 状态：成功；待处理！", " A　B  C", " key = value"]) },
  { id: "tab", title: "Tab缩进（4列）", source: "A ──┐\n\t├→ B\nC ──┘" },
  { id: "misaligned", title: "错误缩进导致断线保留原文", source: "A ─┐\n\t├→ B\nC ─┘", fallback: true },
  { id: "emoji-aligned", title: "对齐的emoji/组合字素框", source: "┌──────────────────┐\n│ 👩‍💻 开发 é API    │\n│ 🇨🇳 中文 ✅ done  │\n└──────────────────┘" },
  { id: "empty-rows", title: "图中空行与不相接箭头", source: "┌──────┐\n│  A   │\n└──────┘\n\n   ↓\n\n┌──────┐\n│  B   │\n└──────┘" },
  { id: "sequence", title: "泳道时序和长标签", source: "客户端       API          数据库\n  │           │             │\n  │──请求────→│             │\n  │           │──查询──────→│\n  │           │←─结果───────│\n  │←─响应─────│             │" },
  { id: "tree", title: "目录树必须原文", source: "├── src\n│   ├── a.ts\n│   └── b.ts\n└── package.json", fallback: true },
  { id: "table", title: "ASCII表格必须原文", source: "+------+-------+\n| key  | value |\n+------+-------+\n| a    | b     |\n+------+-------+", fallback: true },
  { id: "paragraph", title: "框外说明与空格", source: "输入 input\n   │\n   ↓\n┌────────────────┐\n│ 中文 English   │\n└────────────────┘\n   │\n   ↓\n输出 output" },
];
