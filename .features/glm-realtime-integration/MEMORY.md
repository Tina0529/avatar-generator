# GLM-Realtime Integration

> 负责范围：智谱 GLM-Realtime API 作为第二语音引擎集成到数字伙伴平台
> 最后更新：2026-02-22

## 当前状态
GLM-Realtime 已作为 Gemini Live API 的备选引擎完成集成。支持 server_vad 自动语音检测、function calling 工具调用、7 种语音音色。两套引擎共享相同的回调接口（onAudio/onTurnComplete/onInterrupted/onToolCall），可在设置面板一键切换。

## 核心文件
- `modules/glm-client.js` - GLM WebSocket 客户端（与 GeminiLiveClient 接口兼容）
- `glm-test.html` - 独立测试页面（调试用）
- `index.html` - 主页面（引擎选择器、语音列表切换、播放速度控制）

## 最近重要事项
- 2026-02-22: 完成 GLM-Realtime 集成，提交 commit `197bb44`
- 2026-02-22: 添加播放速度控制（0.8x-1.5x），解决部分语音偏慢问题
- 2026-02-22: 修复 server_vad 模式下 ScriptProcessor 回放导致的"滴滴"声

## Gotchas（开发必读）
- ⚠️ `session.update` 必须包含 `event_id`(UUID)、`client_timestamp`(ms)、`beta_fields: { chat_mode: 'audio', tts_source: 'e2e' }`，缺少任何一个都会导致连接断开（code 1000）
- ⚠️ 所有发送给 GLM 的消息都需要 `client_timestamp: Date.now()`
- ⚠️ GLM 输入格式是 WAV（16kHz mono 16bit），输出是 raw PCM（24kHz mono 16bit）—— 与 Gemini 的纯 PCM I/O 不同
- ⚠️ GLM 只有 7 种固定语音（tongtong/female-tianmei/female-shaonv/lovely_girl/xiaochen/male-qn-daxuesheng/male-qn-jingying），不适合所有角色
- ⚠️ PCM 缓冲策略：GLMLiveClient 每 250ms 将累积的 PCM 打包成 WAV 发送，避免频繁小包
- ⚠️ ScriptProcessor 的 output buffer 必须清零，否则会把麦克风输入回放出去

## 安全事项（产品化前必须解决）
- 🔴 **API Key 暴露在 WebSocket URL 查询参数中** — `glm-client.js:44` 和 `index.html:1486`（Gemini），URL 可能出现在浏览器历史、代理日志、CDN 日志中。产品化时需改为后端代理转发
- 🔴 **API Key 明文 localStorage** — `index.html:1013/1016`，同源的任何 JS 都能读取。产品化时应由后端管理 Key，前端只持有 session token
- 🟡 **纯前端无后端代理** — 部署到公网后用户的 Key 完全暴露在客户端。产品化时需 Node.js 后端做 WebSocket 代理
- 🟡 **console.log 泄露工具调用参数** — `glm-client.js:290`，生产环境应移除或降级为 debug 级别

## 索引
- 设计决策：`decisions/`
- 变更历史：`changelog/`
- 相关文档：`docs/`
