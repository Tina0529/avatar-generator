# GLM-Realtime API 参考

## 连接
```
wss://api.z.ai/api/paas/v4/realtime?Authorization=Bearer%20{API_KEY}
```

## 连接流程
1. WebSocket 连接成功
2. 收到 `session.created`
3. 发送 `session.update`（包含完整配置）
4. 收到 `session.updated` → 会话就绪

## session.update 必填字段
```json
{
  "type": "session.update",
  "event_id": "uuid-v4",
  "client_timestamp": 1708617600000,
  "session": {
    "turn_detection": { "type": "server_vad" },
    "instructions": "system prompt",
    "output_audio_format": "pcm",
    "input_audio_format": "wav",
    "tools": [...],
    "beta_fields": {
      "chat_mode": "audio",
      "tts_source": "e2e"
    },
    "voice": "tongtong"
  }
}
```

## 音频格式
- **输入**: WAV, 16kHz, mono, 16bit PCM
- **输出**: raw PCM, 24kHz, mono, 16bit

## 可用语音
| ID | 描述 |
|----|------|
| tongtong | 童童（默认） |
| female-tianmei | 甜美女声 |
| female-shaonv | 少女（偏慢） |
| lovely_girl | 可爱女孩 |
| xiaochen | 小晨 |
| male-qn-daxuesheng | 大学生男声 |
| male-qn-jingying | 精英男声 |

## 关键消息类型
| 方向 | 类型 | 说明 |
|------|------|------|
| → | `input_audio_buffer.append` | 发送音频（base64 WAV） |
| ← | `input_audio_buffer.speech_started` | VAD 检测到说话 |
| ← | `input_audio_buffer.speech_stopped` | VAD 检测到停止 |
| ← | `response.audio.delta` | AI 音频片段（base64 PCM） |
| ← | `response.function_call_arguments.delta` | 工具调用参数（流式） |
| ← | `response.function_call_arguments.done` | 工具调用完成 |
| ← | `response.done` | 回复结束 |
| → | `conversation.item.create` | 发送工具结果 |
| → | `response.create` | 请求新回复 |
