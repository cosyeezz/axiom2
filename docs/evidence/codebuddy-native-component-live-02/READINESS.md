# SDK02 准备证据

准备检查已完成，随后本case唯一实发失败并关闭，见[REPORT](REPORT.md)。本case及全部旧claim已耗尽，不得重跑。

- HARNESS selftest-final-01：exit0；3合成model/1工具/1正常Pi合成refresh，坏终态/取消/late/多工具拒绝/刷新中caller取消/限额通过，外网0。
- VERIFY import-final-01：exit0；network/writes/children0，环境不变。
- observation-test-01：7/8，exit1。第5项错误地认为外层read/cancel Promise完成即内层pull finally已完成，实际activeCancels=1。原脚本完整保留为TEST-OBSERVATION-01.mjs，原结果不改为通过。
- observation-test-02：修正测试oracle，等待最多5个事件循环turn验证底层清理，**8/8，exit0**。本次实际外层settle后仍1，下一turn降0；首次exit始终error。HARNESS本来就有activeCancels清理等待，无需修改实现。包含并发cancel意图优先、EOF、error、DONE后cancel区分、无未知文本泄漏、冻结core安全legacy7允许/9拒绝、网络与auth/config访问0。

最终被测HARNESS SHA `096846157b928a3e235503a7ab5b54346dd2d7d4947aee920fda98853a99aa07`。观察测试02 SHA `ebdb30b983e3c84700cc783e0f3b2b6c60f6b2507ba28a99605f614020d79eb3`。

冻结全1089文件/62关键产物已核，manifest SHA `42389cfda8a470c93aa8c99d4f0a2768b8f7c2dbccdc27646093c32422880b1b`。正常只读preflight（OAuth/native/direct/系统代理/配置未变）及READY绑定全部proof均exit0，见[readiness.json](readiness.json)。离线成功不是SDK真实或生产部署成功。
