# 双引擎架构设计

**日期**: 2026-02-22
**状态**: 已实施

## 背景
Gemini Live API 中文语音支持不稳定，需要国内替代方案。调研了 GLM-Realtime、Qwen-Omni-Realtime、MiniMax 等，选择 GLM-Realtime 作为第一个备选引擎。

## 决策
采用**接口兼容**的双引擎架构：GLMLiveClient 与 GeminiLiveClient 共享完全相同的回调接口。

### 共享接口
```
onAudio(base64PCM)        - 收到 AI 音频
onTurnComplete()          - AI 说完一轮
onInterrupted()           - AI 被打断
onToolCall({functionCalls}) - 工具调用
onError(error)            - 错误
onClose()                 - 连接关闭

sendAudio(base64PCM)      - 发送音频
sendToolResponse([...])   - 返回工具结果
connect()                 - 连接
disconnect()              - 断开
```

### 差异处理
| 差异点 | Gemini | GLM | 处理方式 |
|--------|--------|-----|---------|
| 音频输入 | raw PCM | WAV | GLMClient 内部 PCM→WAV 转换 |
| 音频输出 | PCM 16kHz | PCM 24kHz | AudioStreamer 自动适配采样率 |
| VAD | 手动 commit | server_vad 自动 | 各自处理 |
| 语音选项 | 6 种 | 7 种 | UI 动态切换列表 |

## 替代方案
- 方案 B: 统一 adapter 层 → 过度抽象，增加复杂度
- 方案 C: 每个引擎独立页面 → 代码重复太多

## 后续
- 考虑接入 Qwen-Omni-Realtime 作为第三引擎（49 种语音，适合更多角色）
