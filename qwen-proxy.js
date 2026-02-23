/**
 * Qwen Realtime 本地 WebSocket 代理
 *
 * 原因：浏览器 WebSocket 无法设置 Authorization Header，
 * 此代理在本地接收浏览器连接，加上 Header 后转发给 DashScope。
 *
 * 用法：
 *   node qwen-proxy.js
 *
 * 浏览器在 URL 参数中传入 API Key：
 *   ws://localhost:3001?model=qwen3-omni-flash-realtime&key=sk-xxx
 *
 * 也可以设置环境变量作为默认 Key（浏览器不传 key 时使用）：
 *   DASHSCOPE_KEY=sk-xxx node qwen-proxy.js
 */

const WebSocket = require('ws');

const PORT = 3001;
const DASHSCOPE_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';

// 可选：环境变量提供默认 Key（浏览器不传时使用）
const DEFAULT_KEY = process.env.DASHSCOPE_KEY || process.argv[2] || '';

const wss = new WebSocket.Server({ port: PORT });
console.log(`[QwenProxy] 代理启动在 ws://localhost:${PORT}`);
console.log(`[QwenProxy] → 转发到 ${DASHSCOPE_URL}`);
if (DEFAULT_KEY) {
  console.log(`[QwenProxy] 已设置默认 API Key: ${DEFAULT_KEY.slice(0, 8)}...`);
} else {
  console.log(`[QwenProxy] 模式：Key 由浏览器在连接 URL 中传入（?key=sk-xxx）`);
}

wss.on('connection', (browserWs, req) => {
  const urlParams = new URL(req.url, 'http://localhost');
  const model = urlParams.searchParams.get('model') || 'qwen3-omni-flash-realtime';
  // 优先使用浏览器传来的 key，否则用默认 key
  const apiKey = urlParams.searchParams.get('key') || DEFAULT_KEY;

  if (!apiKey) {
    console.error('[QwenProxy] ❌ 未提供 API Key，拒绝连接');
    browserWs.close(1008, 'API Key is required');
    return;
  }

  const dashscopeUrl = `${DASHSCOPE_URL}?model=${model}`;
  console.log(`[QwenProxy] 浏览器连接 → 代理到 ${dashscopeUrl}`);

  // 连接到 DashScope（加上 Authorization Header）
  const dashWs = new WebSocket(dashscopeUrl, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  });

  // DashScope → 浏览器
  dashWs.on('message', (data) => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(data);
    }
  });

  // 浏览器 → DashScope
  browserWs.on('message', (data) => {
    if (dashWs.readyState === WebSocket.OPEN) {
      dashWs.send(data);
    }
  });

  dashWs.on('open', () => {
    console.log('[QwenProxy] ✅ DashScope 已连接');
  });

  dashWs.on('error', (err) => {
    console.error('[QwenProxy] DashScope 错误:', err.message);
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.close(1011, `DashScope error: ${err.message}`);
    }
  });

  dashWs.on('close', (code, reason) => {
    console.log(`[QwenProxy] DashScope 关闭: ${code} ${reason || ''}`);
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.close(code);
    }
  });

  browserWs.on('error', (err) => {
    console.error('[QwenProxy] 浏览器连接错误:', err.message);
    if (dashWs.readyState === WebSocket.OPEN) {
      dashWs.close();
    }
  });

  browserWs.on('close', (code) => {
    console.log(`[QwenProxy] 浏览器断开: ${code}`);
    if (dashWs.readyState === WebSocket.OPEN) {
      dashWs.close();
    }
  });
});

wss.on('error', (err) => {
  console.error('[QwenProxy] 服务器错误:', err);
});
