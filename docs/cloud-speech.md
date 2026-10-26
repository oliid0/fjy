# 云端语音、识别等待和安装体积

本轮以用户实机反馈和 `ss/豆包语音_API参考_1792817873.pdf` 为依据，尚未完成真机联调，不将前端单测当作麦克风、云端鉴权或合成质量验收。用户最新指令为完成目标后才提交 / 推送，当前未执行 Git 写操作。

## 豆包实时转写

已读取 PDF 第 98–109 页实时识别章节，以及其中附带的[官方 Java 示例](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_8843472602d2cda778c08e968e44dc7e.zip)。实现遵守其二进制帧、gzip、正负序号和最终分句规则。

| 项目 | 当前实现 |
| --- | --- |
| 连接 | 原生 OkHttp 4.12.0 WebSocket，`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async` |
| 鉴权 | `X-Api-Key`、`X-Api-Resource-Id`、随机请求 / 连接 ID；密钥来自独立语音设置，不复用方舟模型 Key |
| 默认资源 | `volc.seedasr.sauc.duration`；设置支持已开通的 2.0 / 1.0 小时 / 并发资源 |
| 音频 | WebAudio 同一麦克风、16 kHz 单声道 PCM16、100 ms 音频片段，音频处理运行于 AudioWorklet |
| 识别 | `bigmodel`、二遍识别、ITN、完整分句、800 ms 服务端 VAD 判停 |
| 指令 | 仅 definite 最终分句形成命令；中间结果延后 3 秒等待，不能执行不稳定文本；累计结果按时间段去重，相同命令在下一时段仍可执行 |
| 打断 | 新一句稳定转写取消上一回合及播报；普通句子仍等三秒停顿，明确“停止 / stop / cancel”与暂停 / 结束讲解立即走原命令。保留已写内容和监听，不执行不稳定文本 |
| 播报 | 助手与 voice.speak 等真实 finished，水波球保持 speaking；取消后的音频回调和原生上一分段迟到事件不能结束新播放 |
| 生命周期 | 监听跨指令持续；停止丢弃旧轮次 / 迟到文本，连接 / 协议 / 队列错误真实失败；正常录制停止发送最终音频帧并等待文稿收尾 |
| 录制 | 云端和本地都复用录制音轨，不再另开麦克风；课件语音仍走可见透明批注层 |
| 平台 | Android 新默认优先云端，保留明确选用的离线 / 系统 / 自定义配置；浏览器没有请求头直连能力，云端选项禁用，浏览器中转尚缺 |

参考 LiveKit 的 [SpeechEventType / STTCapabilities](https://github.com/livekit/agents/blob/d4de5784e699f54f3217bd56c6407ccd04894d61/livekit-agents/livekit/agents/stt/stt.py) 区分中间转写、最终文本和说话活动，并沿用已核对的 `voice/turn.py` 终点检测与取消原则。没有引入独立聊天页，也没有把转写模型的回复当作白板操作成功。

2026-10-25 续修核对 LiveKit 固定 `1f514fdec6dadd47c50a028b9d2c0f6fc432707a` 的 [agent_activity.py](https://github.com/livekit/agents/blob/1f514fdec6dadd47c50a028b9d2c0f6fc432707a/livekit-agents/livekit/agents/voice/agent_activity.py#L2362)（SHA `18578f80570a2b87fc4313ab9118c2e382211175`）：区分说话活动、文本证据和当前播报 / 生成的中断，不能只把新请求排在旧音频后面。本项目沿用稳定最终转写作为中断证据，中间活动只延后分句，不据此执行动作；没有虚构原生音频 VAD 或等同 LiveKit 声学处理。

新话语在旧模型尚未返回时就取消旧 AbortSignal 和队列归属，后续分句继续合并；`voice.interrupt` 暂停教师并取消助手，保留原板书和麦克风。下一句能执行本地手写，旧模型迟到结果不能落板。播放使用各次捕获的 finished 和序号，旧播放 finally 不覆盖新状态，旧 ended / error 不影响下一次或下一分段。组件回归使用真实路由 / 白板对象和 HTMLAudio 事件，供应商边界提供受控转写 / 响应。真实设备回声、误打断、ASR 终点延迟与播报音质尚待验收。

前端回归覆盖持续多轮、暂停 / 停止、同页更新 / 真正翻页、共享采集、独立密钥。新增 Java 协议测试覆盖 gzip 帧、最终帧、稳定分句去重、错误 / 截断拒绝；这些原生测试须待后续 CI 执行。当前 `adb devices -l` 无设备；尚无配置密钥的真实云服务验收结果。

## 数学与文字插入

原函数 / 算式笔在停笔 700 ms 后才启动识别。现在 350 ms 启动原轨迹识别与本地解析，同时保持原 700 ms 完整输入窗口；续写会取消旧识别及待提交结果，避免为了响应快而提前画出半个函数。识别快时可以与停笔等待重叠，冷启动、复杂公式、低端设备和兜底链路仍不能承诺统一一秒内完成。

中文回答回退字体时不再套用单线笔迹字形的缩放比例；文字按源字高布局，问题下方无空间时先按同字号搜索附近空位，再缩小。主板、课件继续共用可见视口边界和换行测量。

`ss/ss.md` 明确提供图生图 `image` 参数。魔法笔直接提交原手绘图片到 `/api/v3/images/generations`，默认 `doubao-seedream-5-0-flash-260915`、`1.5K`、PNG / Base64；保留原位替换、源变化 / 翻页取消，不再先用语言模型把图简化为描述。自定义旧模型保留原尺寸选项。

## 体积与资源校验

原安装包把多个 ABI 原生库放入同一个 APK；仅 sherpa AAR 解压后就有 arm64 23.0 MiB、armv7 15.7 MiB、x86 30.5 MiB、x86_64 26.1 MiB。按 [Android 官方 APK splits](https://developer.android.com/build/configure-apk-splits) 改为四个单独下载，保持架构覆盖；CI 新增压缩 / 解压体积明细，不能把 APK 大小等同于系统安装统计。

原 Melo 中英文权重 `model.onnx` 为 170,429,550 字节。同一发布者、同一模型的[固定版本量化权重](https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/blob/a0d5c6a264c0ef92d70d8661d8cc502d79627cd6/model.int8.onnx) 为 53,517,430 字节，SHA-256：`f085f5079e05f039b800aeb542f5253c26a303211b0c6465d0d9387977855a63`。已实际下载核对；词表、规则、license 与原清单一致，逐文件固定版本 / SHA 验证后才清理明确匹配的旧权重。未知文件保留并阻止打包，失败下载不覆盖旧资源。

本地仅执行资源准备，无编译；TTS 资源目录从约 169 MiB 降到 58 MiB，手写模型保留。量化语音尚未通过本轮原生 JNI / 中英文音频验收；既有 OfflineTtsTest 将验证新权重、非静音合成和取消，并拒绝同时打包旧大模型。APK 上传移到生产页面及原生仪器测试通过之后，避免在失败构建中提供未经验证的包。安装后实际占用和量化音质需后续 CI / 实机确认。
