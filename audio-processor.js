/**
 * AudioWorklet Processor - 麦克风音频采集
 * 将 Float32 音频转换为 Int16 PCM 并分块发送
 */
class AudioRecorderWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._chunkSize = 2048; // ~128ms at 16kHz
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0];
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      this._buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff);
    }

    while (this._buffer.length >= this._chunkSize) {
      const chunk = new Int16Array(this._buffer.splice(0, this._chunkSize));
      this.port.postMessage(
        { event: 'chunk', data: chunk.buffer },
        [chunk.buffer]
      );
    }

    return true;
  }
}

registerProcessor('audio-recorder-worklet', AudioRecorderWorklet);
