# 已定位KAS bundle为zstd→tar前缀

独立`t11001/r11077`结果已精确读取；当前资源全fileoff290729622/ASM长22001675B，**不是**前两个native runtime frame。libzstd1.5.7按已核API `getFrameHeader/createDStream/initDStream/DCtx_setParameter(100,24)/decompressStream/free`，一次Python exit0/约0.002s。压缩读32768B/消耗17404B，解压65536B/2calls，最后返回3，EOF=false；header6B/window8MiB/FCSunknown/dict0/checksum1/blockmax128KiB，window cap16MiB。未到帧末、未核完整checksum/压缩size。

压缩已读prefix SHA256 `0338fa980d58a859198ca36304ef18d8cdf48d8c626455257534652489ec2540`；解压prefix `c831f01fe330d7cd0bc5dd6ced75c74386f901fa47a256f6eddc19d08a44924e`。

前12 tarheader全部ustar且checksum有效（偏移为解压流）：0 PAX28B；1024 node_modules目录；1536 PAX28；2560 @cedar-policy目录；3072 PAX28；4096 cedar-wasm目录；4608 PAX28；5632其README.md4812B；11264 PAX28；12288其esm目录；12800 PAX27；13824其esm/README.md4812B。**因主动12-header cap停止，不是损坏。**未输出文件正文/写资产/执行/联网/读HOME或凭据。尚未到@kiro/agent，不能称取得sender。

后续仅对这个已定址slice另设流式PAX/byte/file/time预算，定向提取主侧已证相对路径node_modules/@kiro/agent/dist/server/acp-server.js及必要public源码；不执行归档成员，不把tar局部校验当完整frame验证。
