# LibADB 3.1.1 的本地修正

来源：[MuntashirAkon/libadb-android 3.1.1](https://github.com/MuntashirAkon/libadb-android/tree/c849886ebc6d48e7b46d967e78a6bb65c90c3b74)，固定提交 `c849886ebc6d48e7b46d967e78a6bb65c90c3b74`。只包含库的 Java 源码、清单、测试及许可；不包含示例、二进制和上游构建环境。沿用 Apache-2.0 选项，保留各文件额外 BSD / MIT 声明与 LICENSES。

CI 39255053648 的 Scrcpy 测试在首次流开启后停住，20 秒内没有部署或服务器日志。上游 `AdbConnection.open()` 在发送 OPEN 后才无条件 `stream.wait()`，快速 OKAY 可以先于 wait 到达，使通知丢失，且虚假唤醒也没有条件保护。

本地修正只改变开启流的等待：`AdbStream.awaitOpen()` 按已确认 remoteId / 关闭状态循环等待，15 秒超时；异常 / 中断会移除并关闭未完成的流。上层继续使用相同公开 API、配对及传输。相应 JVM 测试覆盖预先到达的确认、虚假唤醒、超时和关闭。Gradle 编译和测试仅在 GitHub CI 执行。
