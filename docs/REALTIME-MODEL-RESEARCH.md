# 国内实时语音对话 AI 模型调研报告（2025-2026）

## 背景

当前项目使用 Gemini Live API (`gemini-2.5-flash-native-audio-latest`) 通过 WebSocket 实现实时语音对话，支持 Function Calling，面向儿童中文 AI 伙伴场景。以下调研国内主流替代方案。

---

## 对比总览

| 维度 | **Qwen-Omni-Realtime** | **豆包端到端语音** | **MiniMax Realtime** | **GLM-Realtime** | **讯飞超拟人交互** | **百度文心** |
|------|----------------------|------------------|---------------------|-----------------|-------------------|------------|
| **端到端语音** | 原生端到端 | 端到端 | 端到端 | 端到端 | 端到端 | 需组合 ASR+LLM+TTS |
| **Function Calling** | 支持 | 部分支持 | 支持(M2/M2.5) | **完整支持** | 支持(Max/Ultra) | 支持 |
| **接入协议** | WebSocket | WebSocket + RTC | HTTP + WebSocket | **WebSocket + SDK(TS/Python/Go)** | WebSocket | HTTP |
| **前端直调** | 可行(Bearer Token) | 较难(AK/SK签名) | 可行(API Key) | **可行(TS SDK)** | 可行(需注意安全) | 需后端 |
| **价格(音频)** | 免费额度1亿token/90天 | 输入80/输出300元/百万token | $5/月起(订阅) | **0.18元/分钟(Flash)** | **0.1元/分钟** | 免费(无Realtime) |
| **中文语音质量** | 优秀(49种音色) | **顶级**(情感表达) | 优秀(个性化) | 优秀(情感+方言) | **顶级**(98.7%识别率) | 中等 |
| **延迟** | ~234ms | 超低(RTC) | <250ms | 低 | <800ms(60秒音频) | 高(三次往返) |
| **方言支持** | 10种语言 | 中英为主 | 多语言 | 中英+粤语等方言 | **37语言+202方言** | 中英 |
| **会话时长** | **120分钟** | - | - | 8K token(~20轮) | - | - |
| **开发者友好度** | 高(文档完善) | 中(SDK导向) | 高 | **高(多语言SDK)** | 中 | 低(无Realtime) |

---

## 各模型详细分析

### 1. 阿里 Qwen-Omni-Realtime（通义千问）

Qwen3-Omni 是阿里云原生端到端全模态大模型，能理解文本/音频/图像/视频并实时生成语音，理论端到端延迟可低至 234ms。

- **实时语音对话**：支持，端到端模型，非 ASR+LLM+TTS 拼接
- **Function Calling**：支持（需 stream=True，获取工具信息时建议设 modalities=["text"]）
- **API 接入方式**：WebSocket (`wss://dashscope.aliyuncs.com/api-ws/v1/realtime`)
- **前端直接调用**：WebSocket 连接，Bearer Token 认证，理论可前端直调
- **音频格式**：输入 PCM16 (16kHz)；输出 PCM24 (Flash) / PCM16 (Turbo)
- **价格**：每秒音频=25 tokens。免费额度：输入输出各 1 亿 tokens（90 天）
- **中文语音质量**：端到端模型，49 种音色，支持 10 种语言
- **延迟**：理论 234ms 端到端延迟
- **会话时长**：单次 WebSocket 最长 120 分钟
- **推荐版本**：`qwen3-omni-flash-realtime-2025-12-01`

**文档**：
- [Qwen-Omni-Realtime 官方文档](https://help.aliyun.com/zh/model-studio/realtime)
- [Function Calling 文档](https://help.aliyun.com/zh/model-studio/qwen-function-calling)

### 2. 字节跳动 豆包端到端语音大模型（火山引擎）

豆包实时语音大模型 2025 年 1 月全量开放，采用端到端架构。2025 年发布 Doubao-Seed-TTS 2.0，实现"理解式情感表达"。

- **实时语音对话**：支持，端到端模型，可随时打断，多轮对话无需唤醒词
- **Function Calling**：豆包助手 API 支持，端到端语音模型中的支持情况需确认
- **API 接入方式**：WebSocket，需 AK/SK 签名认证
- **前端直接调用**：官方主推 Android/iOS SDK + RTC 方案；纯前端 WebSocket 需自行封装，认证复杂
- **价格**：输入音频 80 元/百万 token，输入文本 10 元/百万 token，输出音频 300 元/百万 token，输出文本 80 元/百万 token
- **中文语音质量**：业界领先，情感表达丰富
- **延迟**：超低延迟（通过 RTC 优化）
- **限流**：QPM 60，TPM 100,000

**文档**：
- [豆包语音产品文档](https://www.volcengine.com/docs/6561/109880)
- [计费说明](https://www.volcengine.com/docs/6561/1359370)

### 3. MiniMax Realtime API

国内首个端到端实时语音对话 API 产品（2024.11）。2025 年发布 Speech 2.6，端到端延迟低于 250ms。

- **实时语音对话**：支持，端到端实时多模态处理
- **Function Calling**：M2/M2.5 模型支持原生 tool calling
- **API 接入方式**：HTTP + WebSocket 双模式
- **前端直接调用**：支持 WebSocket 连接，API Key 认证
- **价格**：订阅制 $5/月起（Starter 100K credits）
- **中文语音质量**：丰富的个性化语音库，情感表达能力强
- **延迟**：Speech 2.6 Turbo 端到端延迟 <250ms

**文档**：
- [MiniMax Realtime API](https://www.minimax.io/news/realtime-api)
- [Speech 2.6](https://www.minimax.io/news/minimax-speech-26)

### 4. 智谱 GLM-Realtime（清华系）

GLM-Realtime 基于 GLM-4-Voice 端到端情感语音模型，支持实时音频+视频交互。

- **实时语音对话**：支持，端到端 speech-to-speech，支持实时打断
- **Function Calling**：**完整支持**，通过 tools 参数定义工具，支持单次多函数调用
- **API 接入方式**：WebSocket (`wss://open.bigmodel.cn/api/paas/v4/realtime`)，提供 Python/Go/TS SDK
- **前端直接调用**：提供 TypeScript SDK，WebSocket 连接，可前端集成
- **音频格式**：输入 WAV/PCM (16kHz)；输出 PCM (24kHz)
- **价格**：GLM-Realtime-Flash: 0.18 元/分钟音频，1.2 元/分钟视频
- **中文语音质量**：支持中英文+多种方言（粤语、重庆话、北京话等），情感控制能力强
- **延迟**：低延迟，Flow Matching 解码仅需 10 个 audio token 即可开始生成
- **会话限制**：音频上下文 8K tokens（约 20 轮），视频 32K tokens
- **并发限制**：V0: 5 并发，V1: 10，V2: 15，V3: 20

**文档**：
- [GLM-Realtime 官方文档](https://docs.bigmodel.cn/cn/guide/models/sound-and-video/glm-realtime)
- [GitHub SDK](https://github.com/MetaGLM/glm-realtime-sdk)
- [定价页面](https://bigmodel.cn/pricing)

### 5. 讯飞星火 超拟人交互 API

科大讯飞 2024 年 8 月发布，中文语音识别率达 98.7%（行业均值 95.2%）。

- **实时语音对话**：支持，端到端 speech-to-speech，可随时打断
- **Function Calling**：Spark Max 和 4.0 Ultra 版本支持
- **API 接入方式**：WebSocket
- **前端直接调用**：WebSocket 原生支持跨域，可前端直调（需注意 AppID/Secret 暴露问题）
- **价格**：超拟人交互低至 0.1 元/分钟；企业认证可获 10 小时/3 个月免费试用
- **中文语音质量**：**业界最强**，202 种方言支持
- **延迟**：60 秒音频转文字延迟 <0.8 秒

**文档**：
- [讯飞开放平台](https://www.xfyun.cn/doc/)
- [星火语音大模型](https://www.xfyun.cn/services/speech_big_model)

### 6. 百度文心（千帆平台）

- **不推荐**：无原生端到端 Realtime API，需自行组合 ASR+LLM+TTS，延迟高

---

## 推荐排名

### 第1名：智谱 GLM-Realtime
与 Gemini Live 架构最接近（WebSocket + Function Calling + TS SDK），迁移成本最低。

### 第2名：阿里 Qwen-Omni-Realtime
延迟极低(234ms)，免费额度最大(1亿token/90天)，文档完善。

### 第3名：讯飞超拟人交互 API
中文语音质量最强(98.7%识别率)，价格最低(0.1元/分钟)。

---

## 迁移建议

- **最佳迁移路径**：优先尝试 GLM-Realtime，WebSocket API + Function Calling + TypeScript SDK 与 Gemini Live 最接近
- **安全注意**：所有方案前端直调都有 API Key 暴露问题，生产环境建议用轻量后端代理
- **建议先申请免费试用**，重点验证儿童中文语音的识别准确率和回复自然度
