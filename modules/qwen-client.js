/**
 * Qwen3-Omni-Flash-Realtime WebSocket 客户端
 * 接口与 GeminiLiveClient / GLMLiveClient 兼容，可无缝切换
 */
class QwenLiveClient {
  constructor(apiKey, voice, systemPrompt, functionDeclarations, options = {}) {
    this.apiKey = apiKey;
    this.voice = voice || 'Cherry';
    this.systemPrompt = systemPrompt;
    this.functionDeclarations = functionDeclarations || [];
    this.model = options.model || 'qwen3-omni-flash-realtime';
    // 本地代理模式：浏览器连本地代理，代理加 Header 转发给 DashScope
    // 启动方式：node qwen-proxy.js YOUR_API_KEY
    this.endpoint = options.endpoint || 'ws://localhost:3001';
    this.ws = null;

    // 回调 — 与 GeminiLiveClient / GLMLiveClient 相同接口
    this.onAudio = null;       // (base64PCM16) => void
    this.onTurnComplete = null; // () => void
    this.onInterrupted = null;  // () => void
    this.onToolCall = null;     // (toolCall) => void  格式: { functionCalls: [{ name, args, id }] }
    this.onError = null;        // (error) => void
    this.onClose = null;        // () => void

    // Function calling 状态
    this._currentFnName = '';
    this._currentFnArgs = '';
    this._currentFnCallId = '';
    this._modelSpeaking = false;

    // 音频缓冲：累积 PCM 数据，定时发送（避免太频繁的小包）
    this._pcmBuffer = [];
    this._pcmBufferSamples = 0;
    this._sendInterval = null;
    this._SEND_INTERVAL_MS = 200;  // 每 200ms 发送一次
  }

  _uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      // 通过本地代理连接（代理负责加 Authorization Header 转发给 DashScope）
      // 启动代理：node qwen-proxy.js（无需命令行传 Key，Key 在这里通过 URL 参数传入）
      const url = `${this.endpoint}?model=${this.model}&key=${encodeURIComponent(this.apiKey)}`;
      this.ws = new WebSocket(url);
      const timeout = setTimeout(() => reject(new Error('Qwen 连接超时（15s）')), 15000);
      let resolved = false;

      this.ws.onopen = () => {
        console.log('[Qwen] WebSocket 已连接，等待 session.created');
      };

      this.ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch(e) { return; }

        switch (msg.type) {
          case 'session.created':
            console.log('[Qwen] session.created，发送 session.update');
            this._sendSessionUpdate();
            break;

          case 'session.updated':
            console.log('[Qwen] session.updated，会话就绪');
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              this._startSendLoop();
              resolve();
            }
            break;

          case 'input_audio_buffer.speech_started':
            if (this._modelSpeaking) {
              this._modelSpeaking = false;
              if (this.onInterrupted) this.onInterrupted();
            }
            break;

          case 'input_audio_buffer.speech_stopped':
          case 'input_audio_buffer.committed':
            break;

          case 'response.audio.delta':
            if (msg.delta && this.onAudio) {
              this._modelSpeaking = true;
              // Qwen Flash 输出 PCM24，需要转为 PCM16
              const pcm16Base64 = this._convertPCM24toPCM16(msg.delta);
              this.onAudio(pcm16Base64);
            }
            break;

          case 'response.audio.done':
            break;

          case 'response.audio_transcript.delta':
          case 'response.audio_transcript.done':
          case 'response.text.delta':
          case 'response.text.done':
          case 'conversation.item.input_audio_transcription.completed':
            break;

          // Function Calling（OpenAI 兼容格式）
          case 'response.function_call_arguments.delta':
            this._currentFnArgs += (msg.delta || '');
            if (msg.name) this._currentFnName = msg.name;
            if (msg.call_id) this._currentFnCallId = msg.call_id;
            break;

          case 'response.function_call_arguments.done':
            if (msg.name) this._currentFnName = msg.name;
            if (msg.call_id) this._currentFnCallId = msg.call_id;
            this._handleToolCall();
            break;

          case 'response.done':
            this._modelSpeaking = false;
            if (this.onTurnComplete) this.onTurnComplete();
            break;

          case 'error':
            const errMsg = msg.error?.message || JSON.stringify(msg.error || msg);
            console.error('[Qwen] 错误:', errMsg);
            if (this.onError) this.onError(new Error(errMsg));
            break;

          case 'response.created':
          case 'response.output_item.added':
          case 'response.content_part.added':
          case 'response.output_item.done':
          case 'response.content_part.done':
          case 'conversation.item.created':
            break;

          default:
            console.log('[Qwen] 未处理消息:', msg.type, msg);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[Qwen] WebSocket 错误，可能是认证问题或 CORS');
        if (!resolved) { clearTimeout(timeout); reject(err); }
        if (this.onError) this.onError(err);
      };

      this.ws.onclose = (ev) => {
        console.warn(`[Qwen] 连接关闭: code=${ev.code} reason="${ev.reason || ''}"`,
          ev.code === 1008 ? '→ 认证失败' :
          ev.code === 1006 ? '→ 网络异常或被拒绝' :
          ev.code === 1000 ? '→ 正常关闭' : '');
        if (!resolved) { clearTimeout(timeout); reject(new Error(`Qwen 连接关闭: code=${ev.code} ${ev.reason || ''}`)); }
        this._stopSendLoop();
        if (this.onClose) this.onClose();
      };
    });
  }

  _sendSessionUpdate() {
    let tools = null;
    if (this.functionDeclarations.length > 0) {
      tools = this.functionDeclarations.map(fd => ({
        type: 'function',
        function: {
          name: fd.name,
          description: fd.description,
          parameters: fd.parameters
        }
      }));
    }

    const update = {
      type: 'session.update',
      event_id: this._uuid(),
      session: {
        modalities: ['text', 'audio'],
        voice: this.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm24',
        instructions: this.systemPrompt,
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          silence_duration_ms: 800
        },
        tools: tools
      }
    };

    this.ws.send(JSON.stringify(update));
  }

  /**
   * 接收 raw PCM16 base64 数据（与 Gemini/GLM 相同格式）
   * 缓冲后定时发送给 Qwen（不需要 WAV 包装）
   */
  sendAudio(base64PCMData) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // 解码 base64 → Uint8Array，存入缓冲
    const raw = atob(base64PCMData);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    this._pcmBuffer.push(bytes);
    this._pcmBufferSamples += bytes.length;
  }

  /** 定时将缓冲的 PCM16 打包发送（不需要 WAV 封装） */
  _startSendLoop() {
    this._sendInterval = setInterval(() => {
      if (this._pcmBufferSamples === 0) return;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      // 合并所有缓冲数据
      const merged = new Uint8Array(this._pcmBufferSamples);
      let offset = 0;
      for (const chunk of this._pcmBuffer) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      this._pcmBuffer = [];
      this._pcmBufferSamples = 0;

      // base64 编码（分块避免栈溢出）
      let binaryStr = '';
      for (let i = 0; i < merged.length; i += 8192) {
        binaryStr += String.fromCharCode.apply(null, merged.subarray(i, i + 8192));
      }
      const base64 = btoa(binaryStr);

      this.ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        event_id: this._uuid(),
        audio: base64
      }));
    }, this._SEND_INTERVAL_MS);
  }

  _stopSendLoop() {
    if (this._sendInterval) {
      clearInterval(this._sendInterval);
      this._sendInterval = null;
    }
    this._pcmBuffer = [];
    this._pcmBufferSamples = 0;
  }

  /**
   * PCM24 (little-endian, 3 bytes/sample, 24kHz) → PCM16 (2 bytes/sample, 24kHz)
   * Qwen Flash 输出 pcm24 格式，AudioStreamer 期望 pcm16
   */
  _convertPCM24toPCM16(base64PCM24) {
    const raw = atob(base64PCM24);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const sampleCount = Math.floor(bytes.length / 3);
    const pcm16 = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      // PCM24 little-endian: byte0=LSB, byte1=mid, byte2=MSB
      // 取高 16 位（丢弃 LSB）得到 PCM16
      pcm16[i] = (bytes[i * 3 + 1]) | (bytes[i * 3 + 2] << 8);
    }

    // 转回 base64
    const pcm16Bytes = new Uint8Array(pcm16.buffer);
    let binaryStr = '';
    for (let i = 0; i < pcm16Bytes.length; i += 8192) {
      binaryStr += String.fromCharCode.apply(null, pcm16Bytes.subarray(i, i + 8192));
    }
    return btoa(binaryStr);
  }

  sendToolResponse(functionResponses) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const resp of functionResponses) {
      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        event_id: this._uuid(),
        item: {
          type: 'function_call_output',
          call_id: resp.id,
          output: JSON.stringify(resp.response)
        }
      }));
    }

    // 发送工具结果后请求新的回复
    this.ws.send(JSON.stringify({
      type: 'response.create',
      event_id: this._uuid()
    }));
  }

  _handleToolCall() {
    if (!this._currentFnName) return;

    try {
      const args = this._currentFnArgs ? JSON.parse(this._currentFnArgs) : {};
      const toolCall = {
        functionCalls: [{
          name: this._currentFnName,
          args: args,
          id: this._currentFnCallId
        }]
      };

      console.log('[Qwen] 工具调用:', this._currentFnName, args);
      if (this.onToolCall) this.onToolCall(toolCall);
    } catch (e) {
      console.error('[Qwen] 解析工具调用参数失败:', e, this._currentFnArgs);
    }

    this._currentFnName = '';
    this._currentFnArgs = '';
    this._currentFnCallId = '';
  }

  disconnect() {
    this._stopSendLoop();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
