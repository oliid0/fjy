# 内置离线播报

安卓版未填写自定义播报接口时，默认使用随 APK 打包的 sherpa-onnx 1.13.8 与 MeloTTS 中英文模型。无需另外安装声音引擎、启动电脑服务或首次联网下载。浏览器继续使用系统声音；设置中的兼容 HTTP 播报接口可以覆盖默认引擎，IndexTTS 仅是其中一种可选服务。

- Android 接口依据固定版本 [Tts.kt](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/kotlin-api/Tts.kt)，并检查过发布 AAR 中实际类的方法签名。使用静态链接 ONNX Runtime 的 [官方 AAR](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.8)，避免 ARM64 / x86_64 与 Moonshine 的运行库冲突。
- 模型来源、词典、文本规范化规则与示例依据[官方 MeloTTS 文档](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/vits.html)。模型为 170,429,550 字节的真实 ONNX 权重；上游压缩包内的 `model.int8.onnx` 是 133 字节 LFS 指针，不能冒充量化模型打包。英文发音受词典覆盖范围限制。
- [tts-models.json](../scripts/tts-models.json) 固定运行库、模型压缩包及各个打包文件的大小 / SHA-256。[资源准备脚本](../scripts/fetch-tts-models.py) 校验后仅提取指定普通文件；损坏或不完整资源会令 CI 失败。权重和 AAR 被 Git 忽略；模型 MIT 许可与引擎 Apache-2.0 许可随资源打包。
- 原生单线程任务队列执行推理，模型使用两个 CPU 线程。讲解按至多 80 个 Unicode 字符分段，保留原文和字幕偏移；合成后交给现有播放器。暂停保留播放位置，追问暂停原课，恢复继续原音；停止 / 目标变化取消当前任务并删除缓存音频，迟到结果不会播放。实际合成或播放失败会进入已有的有节奏字幕流程。

本地只执行资源准备、类型检查、lint 与测试，不启动构建或开发服务。前端测试验证默认引擎、取消、分段、暂停 / 恢复与失败；`OfflineTtsTest` 将在 CI 模拟器上用真实 JNI / 权重生成中文与英文 WAV，检查采样率、PCM 能量与取消。资源完整性已本地验证，Android 编译 / 仪器测试结果仍须以本次 CI 为准；声音自然度、首段延迟和大屏扬声器需要真机验收。
