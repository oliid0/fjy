# 可选 IndexTTS 局域网播报

此适配器使用官方 `indextts.infer_v2.IndexTTS2.infer`。它运行在已安装官方 IndexTTS、Python 3.10/3.11、PyTorch 和模型文件的电脑上；不是安卓内置模型，不参与离线识别。

1. 按 [IndexTTS 官方文档](https://github.com/index-tts/index-tts) 安装环境和模型；准备有权使用的参考声音 WAV。
2. 在该环境设置 `FCDRAW_TTS_MODELS` 为模型目录、`FCDRAW_TTS_REFERENCE` 为参考 WAV 路径、`FCDRAW_TTS_TOKEN` 为至少 16 位的服务密钥。
3. 在该环境运行 `python /path/to/fjy/services/index-tts/server.py`。默认监听 `0.0.0.0:8766`；可通过 `FCDRAW_TTS_HOST`、`FCDRAW_TTS_PORT` 修改。
4. 安卓白板的“AI 与语音设置 → 语音播报”填写 `http://电脑局域网IP:8766/v1/audio/speech` 和上述密钥。此后可以朗读 AI 回答或录制总结，点击停止或关闭浮层中断播放。

浏览器访问需将其实际 origin 加入逗号分隔的 `FCDRAW_TTS_ORIGINS`；默认允许 Capacitor 的 `https://localhost,http://localhost`。浏览器自身仍受 HTTPS/混合内容限制。

适配器只接受文本，不接受远程文件路径或声音克隆上传。单次最多 4000 字，音频以 WAV 返回；并发请求返回 429。参考音频和模型均由电脑上的管理员配置。项目没有携带 IndexTTS 模型权重，其许可证及运行资源要求以官方项目为准。

无模型依赖的 HTTP 协议验证：`python -m unittest discover -s services/index-tts -p 'test_*.py'`。测试覆盖授权、来源、输入验证和音频响应；真实音色效果需要配置模型后验收。
