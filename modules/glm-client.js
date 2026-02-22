/**
 * GLM-Realtime WebSocket 客户端
 * 接口与 GeminiLiveClient 兼容，可无缝切换
 */
class GLMLiveClient {
  constructor(apiKey, voice, systemPrompt, functionDeclarations, options = {}) {
    this.apiKey = apiKey;
    this.voice = voice || 'tongtong';
    this.systemPrompt = systemPrompt;
    this.functionDeclarations = functionDeclarations || [];
    this.endpoint = options.endpoint || 'wss://api.z.ai/api/paas/v4/realtime';
    this.ws = null;

    // 回调 — 与 GeminiLiveClient 相同接口
    this.onAudio = null;       // (base64PCM) => void
    this.onTurnComplete = null; // () => void
    this.onInterrupted = null;  // () => void
    this.onToolCall = null;     // (toolCall) => void  格式: { functionCalls: [{ name, args, id }] }
    this.onError = null;        // (error) => void
    this.onClose = null;        // () => void

    // 内部状态
    this._currentFnName = '';
    this._currentFnArgs = '';
    this._currentFnCallId = '';
    this._modelSpeaking = false;

    // 音频缓冲：累积 PCM 数据，定时打包成 WAV 发送
    this._pcmBuffer = [];
    this._pcmBufferSamples = 0;
    this._sendInterval = null;
    this._SEND_INTERVAL_MS = 250;  // 每 250ms 发送一次
  }

  _uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `${this.endpoint}?Authorization=${encodeURIComponent('Bearer ' + this.apiKey)}`;
      this.ws = new WebSocket(url);
      const timeout = setTimeout(() => reject(new Error('GLM 连接超时')), 15000);
      let resolved = false;

      this.ws.onopen = () => {
        console.log('[GLM] WebSocket 已连接，等待 session.created');
      };

      this.ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch(e) { return; }

        switch (msg.type) {
          case 'session.created':
            console.log('[GLM] session.created，发送 session.update');
            this._sendSessionUpdate();
            break;

          case 'session.updated':
            console.log('[GLM] session.updated，会话就绪');
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              this._startSendLoop();
              resolve();
            }
            break;

          case 'input_audio_buffer.speech_started':
            // 用户开始说话 — 如果 AI 正在说，触发打断
            if (this._modelSpeaking) {
              this._modelSpeaking = false;
              if (this.onInterrupted) this.onInterrupted();
            }
            break;

          case 'input_audio_buffer.speech_stopped':
            break;

          case 'response.audio.delta':
            if (msg.delta && this.onAudio) {
              this._modelSpeaking = true;
              this.onAudio(msg.delta);
            }
            break;

          case 'response.audio_transcript.delta':
          case 'response.audio_transcript.done':
            break;

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
            const errMsg = msg.error?.message || JSON.stringify(msg.error);
            console.error('[GLM] 错误:', errMsg);
            if (this.onError) this.onError(new Error(errMsg));
            break;

          case 'heartbeat':
            break;

          case 'response.created':
          case 'response.output_item.added':
          case 'response.content_part.added':
          case 'response.output_item.done':
          case 'response.content_part.done':
          case 'conversation.item.created':
          case 'input_audio_buffer.committed':
            break;

          default:
            console.log('[GLM] 未处理消息:', msg.type);
        }
      };

      this.ws.onerror = (err) => {
        if (!resolved) { clearTimeout(timeout); reject(err); }
        if (this.onError) this.onError(err);
      };

      this.ws.onclose = (ev) => {
        if (!resolved) { clearTimeout(timeout); reject(new Error(`GLM 连接关闭: ${ev.code}`)); }
        this._stopSendLoop();
        console.log(`[GLM] 连接关闭: code=${ev.code} reason=${ev.reason || ''}`);
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
      client_timestamp: Date.now(),
      session: {
        turn_detection: { type: 'server_vad' },
        instructions: this.systemPrompt,
        output_audio_format: 'pcm',
        input_audio_format: 'wav',
        tools: tools,
        beta_fields: {
          chat_mode: 'audio',
          tts_source: 'e2e'
        },
        voice: this.voice
      }
    };

    this.ws.send(JSON.stringify(update));
  }

  /**
   * 接收 raw PCM16 base64 数据（与 Gemini 相同格式）
   * 内部缓冲后定时打包成 WAV 发送给 GLM
   */
  sendAudio(base64PCMData) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // 解码 base64 → Int16Array
    const raw = atob(base64PCMData);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);

    this._pcmBuffer.push(int16);
    this._pcmBufferSamples += int16.length;
  }

  /** 定时将缓冲的 PCM 打包成 WAV 发送 */
  _startSendLoop() {
    this._sendInterval = setInterval(() => {
      if (this._pcmBufferSamples === 0) return;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      // 合并所有缓冲的 PCM 数据
      const merged = new Int16Array(this._pcmBufferSamples);
      let offset = 0;
      for (const chunk of this._pcmBuffer) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      this._pcmBuffer = [];
      this._pcmBufferSamples = 0;

      // 构造 WAV (16kHz mono 16bit)
      const sampleRate = 16000;
      const dataBytes = merged.buffer.byteLength;
      const wav = new ArrayBuffer(44 + dataBytes);
      const v = new DataView(wav);
      const ws = (s, o) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      ws('RIFF', 0); v.setUint32(4, 36 + dataBytes, true);
      ws('WAVE', 8); ws('fmt ', 12);
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
      v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      ws('data', 36); v.setUint32(40, dataBytes, true);
      new Int16Array(wav, 44).set(merged);

      // base64 编码（分块避免栈溢出）
      const wavBytes = new Uint8Array(wav);
      let binaryStr = '';
      for (let i = 0; i < wavBytes.length; i += 8192) {
        binaryStr += String.fromCharCode.apply(null, wavBytes.subarray(i, i + 8192));
      }
      const base64 = btoa(binaryStr);

      this.ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64,
        client_timestamp: Date.now()
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

  sendToolResponse(functionResponses) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const resp of functionResponses) {
      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        client_timestamp: Date.now(),
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
      client_timestamp: Date.now()
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

      console.log('[GLM] 工具调用:', this._currentFnName, args);
      if (this.onToolCall) this.onToolCall(toolCall);
    } catch (e) {
      console.error('[GLM] 解析工具调用参数失败:', e, this._currentFnArgs);
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
