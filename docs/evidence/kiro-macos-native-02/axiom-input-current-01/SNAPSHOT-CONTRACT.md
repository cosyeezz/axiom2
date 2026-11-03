# 公开源码实物保全

只保全已fresh阅读的11个公开源码文件，具体清单在capture_sources.py；不执行这些模块，不读账号/配置数据。每文件≤128KiB、合计≤384KiB，同FD nofollow/regular/stamp前后不变；原字节新建0400副本并逐byte SHA readback。CreateNew SOURCE-CAPTURE.lock一次，CPU3/4、alarm6、工具10秒；失败保留不覆盖或增cap重跑，报告≤32KiB。运行前已明确：这是阅读后的源码快照，不是证明早前tool read与此刻字节全同，不是跨文件原子快照、编译产物或实际加载证明。后续正式运行前要核使用的当前实现，不拿source SHA当loaded-image证明。
