# 网络访问调研实验

日期：2026-10-27。配套[方案](../../axiom-web-access-research.md)。这里只是调研脚本和证据，不是Axiom业务工具，也没有将依赖装入Axiom。

## 有效实验口径

- Node v22.23.2，macOS arm64；依赖：`defuddle@0.19.6`、`@mozilla/readability@0.6.0`、`linkedom@0.18.14`、`turndown@7.2.4`、`turndown-plugin-gfm@1.0.2`。
- Defuddle使用真实`defuddle/node`入口，`markdown:true,useAsync:false`，读取返回的`content`。不是在核心HTML API上寻找`contentMarkdown`。
- 对照链：Readability→Turndown+GFM；linkedom不模拟完整浏览器，脚本设置文档URL/必要DOM兼容，并对Readability输入的相对href/src按base URL规范化。这是两条具体链的比较，不是只比较文章识别算法。
- 网络取样与提取计时分离，两链使用同一份HTML。耗时含DOM解析和Markdown转换，每样本只跑一次；样本少、有执行顺序和暖机影响，不能推导统计显著的性能倍数。
- 实验全局fetch替换为失败函数，Defuddle关闭async；记录尝试数0。它不是OS级网络隔离，不能证明任意依赖永不使用其他网络API。

## 可复跑受控fixture

从项目根目录执行（只写新临时目录；npm安装本身需要联网，不需要服务API key）：

```bash
BENCH_DIR="$(mktemp -d /tmp/axiom-web-extraction.XXXXXX)"
cp docs/evidence/web-access/extraction.mjs "$BENCH_DIR/"
cd "$BENCH_DIR"
npm init -y
npm install --save-exact --no-audit --no-fund \
  defuddle@0.19.6 @mozilla/readability@0.6.0 linkedom@0.18.14 \
  turndown@7.2.4 turndown-plugin-gfm@1.0.2
node extraction.mjs
```

预期退出0。`results/summary.json`包含两条链各5个检查：代码文本/fence、GFM表格、`../`链接、根相对链接、导航/页脚剔除，共10项；失败时assert抛错。自身fixture由脚本生成，已存一份[HTML](fixture.html)及[Defuddle输出](fixture-defuddle.md)、[Readability输出](fixture-readability.md)。fixture输出hash可与[结果JSON](extraction-results.json)比较。

这几个顶层依赖锁定版本，但首次安装仍可能解析到不同的传递依赖；严密复现实验还应保存运行时生成的package-lock并使用npm ci。本报告不声称字节级可复现整个未来npm生态。

## 公开网页样本

取样URL：

- `https://example.com`
- `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise`
- `https://www.typescriptlang.org/docs/handbook/2/narrowing.html`
- `https://docs.python.org/zh-cn/3/library/asyncio.html`
- `https://react.dev/reference/react/useEffect`

取样时均HTTP200；第三方整页HTML和Markdown未提交仓库。输入/输出UTF-8字节数、SHA256和单次耗时保存在[extraction-results.json](extraction-results.json)。如已有获准保存的样本，使用文件名`encodeURIComponent(originalURL) + '.html'`放在单独目录，再运行：

```bash
WEB_BENCH_HTML_DIR=/absolute/path/to/saved-html \
WEB_BENCH_OUTPUT_DIR=/absolute/path/to/new-results \
node extraction.mjs
```

未来重新下载会发生内容变化，不能预期与本次hash一致。该脚本有意不提供任意URL下载器，避免把研究脚本误当安全抓取实现。

人工抽查发现技术文档代码仍需改进，尤其TypeScript页面有交互诊断、语言标签和按钮混入；fixture通过不等于网站代码全部保真。早期不正确Defuddle入口及无GFM的实验已被此口径替代，未纳入最终结果。

## 无key搜索样本

[exa-mcp-sample.json](exa-mcp-sample.json)记录单次公开查询的请求元数据。未用任何现有凭据：向`https://mcp.exa.ai/mcp?tools=web_search_exa`发送JSON-RPC `tools/call`，参数query为`Mozilla Readability official GitHub repository`、numResults为2；HTTP200、JSON-RPC返回两条来源（Mozilla Readability与其tags页）。只验证本次无key路径可用，没有测长期额度、中文相关性或服务SLA，也未调用收费Search API。
