# Avatar Generator — AI 数字伙伴平台

支持多角色的 AI 数字伙伴系统，通过 Gemini Live API 实现语音对话，配合视频 Avatar 动画和自适应记忆系统。

## 项目进度

- **Phase 0: Avatar 基础** — 完成。视频动画 + idle 循环 + 交叉淡化
- **Phase 1: Soul + Memory 核心** — 完成。四大子系统 + 多角色架构
- **Phase 2: 数学辅导技能** — 未开始
- **Phase 3-6: 工具扩展/多宠物/安全/后端** — 未开始

## 目录结构

```
avatar-generator/
├── index.html              ← 主入口（?c=角色ID 切换角色）
├── audio-processor.js      ← AudioWorklet 麦克风采集
├── modules/                ← 共享核心模块
│   ├── memory-manager.js   ← 三层记忆 + 自适应置信度系统
│   ├── prompt-composer.js  ← Boot 序列动态 System Prompt
│   └── tool-handler.js     ← Gemini Function Calling 工具
├── characters/             ← 角色目录（每个角色一个子目录）
│   └── fox-xiaoli/         ← 狐小狸
│       ├── config.json     ← 角色配置（名称、动作、主题色）
│       ├── SOUL.md         ← 灵魂文件（性格、说话风格）
│       ├── assets/         ← 视频/图片素材
│       ├── skills/         ← 角色专属技能
│       └── memory/         ← 记忆模板
├── tools/                  ← 工具脚本
│   └── generate_videos_veo.py
└── docs/                   ← 设计文档
    └── MEMORY-SYSTEM.md
```

## 添加新角色

1. 创建目录 `characters/新角色ID/`
2. 创建 `config.json`（参考 fox-xiaoli 的格式）
3. 创建 `SOUL.md`（角色性格和说话风格）
4. 准备 `assets/` 视频素材（idle.mp4 + 动作视频）
5. 访问 `index.html?c=新角色ID`

## 核心设计

### 自适应置信度记忆（核心创新）
- 详细文档：`docs/MEMORY-SYSTEM.md`
- 首次提及即信任（confidence=1.0）
- 矛盾时渐进弱化，需 4 次矛盾才遗忘
- 事实 vs 主观分开处理

### 用户画像维度
name, nickname, birthday, age, gender, role(student/adult), grade, school, occupation, family, personality, strengths, weaknesses, communication_style

### Dynamic System Prompt
Soul → 日期 → 用户画像 → 互动日志 → 记忆(按置信度分层) → 技能 → 工具指南

### IndexedDB 存储
每个角色独立数据库（`companion-{角色ID}`），互不干扰。

## 本地开发

```bash
python3 -m http.server 8080
# 打开 http://localhost:8080         → 默认加载狐小狸
# 打开 http://localhost:8080?c=xxx   → 加载其他角色
```

## 技术栈
- 纯 HTML/JS，无框架
- Gemini Live API (WebSocket, gemini-2.5-flash-native-audio-latest)
- IndexedDB（纯前端存储）
- Veo API 生成视频素材
