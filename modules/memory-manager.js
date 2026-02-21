/**
 * Memory Manager - 三层记忆系统
 * Working (Gemini 内部) / Episodic (每日日志) / Semantic (长期事实)
 * 存储：IndexedDB
 */

const DEFAULT_DB_NAME = 'fox-companion';
const DB_VERSION = 1;

class MemoryManager {
  constructor(dbName) {
    this.db = null;
    this.dbName = dbName || DEFAULT_DB_NAME;
  }

  /** 初始化 IndexedDB */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 用户画像
        if (!db.objectStoreNames.contains('user_profile')) {
          db.createObjectStore('user_profile', { keyPath: 'key' });
        }

        // 语义记忆（长期事实）
        if (!db.objectStoreNames.contains('semantic')) {
          const store = db.createObjectStore('semantic', { keyPath: 'id', autoIncrement: true });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('created', 'created', { unique: false });
        }

        // 情景记忆（每日互动日志）
        if (!db.objectStoreNames.contains('episodes')) {
          const store = db.createObjectStore('episodes', { keyPath: 'id', autoIncrement: true });
          store.createIndex('date', 'date', { unique: false });
        }

        // 学习进度
        if (!db.objectStoreNames.contains('learning_progress')) {
          const store = db.createObjectStore('learning_progress', { keyPath: 'id', autoIncrement: true });
          store.createIndex('subject', 'subject', { unique: false });
          store.createIndex('date', 'date', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve();
      };

      request.onerror = (event) => {
        reject(new Error('IndexedDB 初始化失败: ' + event.target.error));
      };
    });
  }

  // ========== 用户画像 ==========

  /** 获取用户画像 */
  async getUserProfile() {
    const tx = this.db.transaction('user_profile', 'readonly');
    const store = tx.objectStore('user_profile');
    return new Promise((resolve) => {
      const result = {};
      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          result[cursor.value.key] = cursor.value.value;
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      request.onerror = () => resolve({});
    });
  }

  /** 保存用户画像字段 */
  async saveUserProfile(key, value) {
    const tx = this.db.transaction('user_profile', 'readwrite');
    const store = tx.objectStore('user_profile');
    return new Promise((resolve, reject) => {
      const request = store.put({ key, value });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /** 检查是否首次使用 */
  async isFirstUse() {
    const profile = await this.getUserProfile();
    return !profile.name;
  }

  // ========== 语义记忆（长期事实 + 置信度系统） ==========

  // 置信度常量
  //
  // 设计哲学：
  //   初次提及的任何信息都应该被信任（confidence = 1.0）。
  //   置信度机制仅在后续出现矛盾时介入：
  //   - 事实矛盾 → 直接修正（update_memory）
  //   - 主观矛盾 → 渐进弱化（weaken_memory），需多次矛盾才会遗忘
  //   - 被弱化后再次提及 → 渐进恢复（reinforce）
  //
  static CONFIDENCE = {
    INIT: 1.0,              // 所有记忆初始置信度（首次提及即信任）
    REINFORCE_BOOST: 0.2,   // 被弱化后，每次一致提及恢复的置信度
    WEAKEN_DROP: 0.25,      // 每次矛盾信号降低的置信度（需4次矛盾才归零）
    CONFIRM_THRESHOLD: 0.6, // 高于此值 = "确认的记忆"
    SHOW_THRESHOLD: 0.3,    // 低于此值不注入 prompt（但保留在DB中）
    MAX: 1.0,
    MIN: 0.0
  };

  // 事实型分类（矛盾时应直接修正，而非渐进弱化）
  static FACTUAL_CATEGORIES = ['event', 'learning'];

  /**
   * 保存一条长期记忆（带置信度）
   *
   * 置信度模型：
   * - 所有首次提及的信息都被信任（confidence = 1.0）
   * - 找到相似记忆 → 强化（恢复被弱化的置信度）
   * - 矛盾处理不在此方法中，由 AI 调用 weaken_memory 渐进弱化
   *
   * @param {string} content - 记忆内容
   * @param {string} category - 分类: preference / learning / event / personality
   * @param {boolean} factual - 是否为客观事实（默认根据 category 自动判断）
   */
  async saveMemory(content, category = 'general', factual = null) {
    // 自动判断是否为事实型
    const isFactual = factual !== null
      ? factual
      : MemoryManager.FACTUAL_CATEGORIES.includes(category);

    // 先检查是否有相似记忆（同分类 + 关键词重叠）
    const existing = await this.getMemoriesByCategory(category);
    const similar = this._findSimilar(content, existing);

    if (similar) {
      // 已有相似记忆 → 强化（如果之前被弱化过，逐步恢复置信度）
      return this._reinforceMemory(similar.id, content, isFactual);
    }

    // 新记忆：首次提及即信任
    const C = MemoryManager.CONFIDENCE;

    const tx = this.db.transaction('semantic', 'readwrite');
    const store = tx.objectStore('semantic');
    return new Promise((resolve, reject) => {
      const request = store.add({
        content,
        category,
        confidence: C.INIT,   // 首次提及 = 完全信任
        factual: isFactual,
        mentions: 1,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        accessCount: 0
      });
      request.onsuccess = () => {
        console.log(`[Memory] 新记忆 [${category}] "${content}" (置信度: ${C.INIT})`);
        resolve({ id: request.result, confidence: C.INIT, status: '已确认' });
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 强化一条已有记忆（相似内容再次被提及）
   *
   * 两种情况：
   * - 记忆从未被弱化过（confidence = 1.0）→ 仅更新表述和时间
   * - 记忆曾被弱化（confidence < 1.0）→ 恢复置信度
   *   - 事实型：直接恢复到 1.0
   *   - 主观型：每次 +0.2 渐进恢复（曾经矛盾过，需要多次确认才能完全恢复）
   */
  async _reinforceMemory(id, newContent, isFactual) {
    const C = MemoryManager.CONFIDENCE;
    const tx = this.db.transaction('semantic', 'readwrite');
    const store = tx.objectStore('semantic');
    return new Promise((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) { resolve(null); return; }

        const oldConfidence = record.confidence ?? C.INIT;
        const wasWeakened = oldConfidence < C.INIT;

        if (wasWeakened) {
          // 曾被弱化：事实型直接恢复，主观型渐进恢复
          record.confidence = isFactual
            ? C.INIT
            : Math.min(C.MAX, oldConfidence + C.REINFORCE_BOOST);
        }
        // 未被弱化过的记忆：confidence 保持 1.0，只更新表述

        record.content = newContent;
        record.mentions = (record.mentions || 1) + 1;
        record.updated = new Date().toISOString();

        const putReq = store.put(record);
        putReq.onsuccess = () => {
          if (wasWeakened) {
            console.log(`[Memory] 恢复 "${newContent}" (${oldConfidence.toFixed(1)} → ${record.confidence.toFixed(1)}, 第${record.mentions}次提及)`);
          } else {
            console.log(`[Memory] 再次确认 "${newContent}" (第${record.mentions}次提及)`);
          }
          resolve({ id, confidence: record.confidence, mentions: record.mentions, status: record.confidence >= C.CONFIRM_THRESHOLD ? '已确认' : '待确认' });
        };
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * 弱化一条记忆（听到矛盾信息）
   * 不立即删除，而是降低置信度。置信度降到 0 才自动清除。
   *
   * @param {number} id - 记忆 ID
   * @param {string} reason - 弱化原因（记录下来便于追溯）
   * @returns {{ id, confidence, deleted }} 弱化结果
   */
  async weakenMemory(id, reason = '') {
    const C = MemoryManager.CONFIDENCE;
    const tx = this.db.transaction('semantic', 'readwrite');
    const store = tx.objectStore('semantic');
    return new Promise((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) { resolve({ id, deleted: false, error: '记忆不存在' }); return; }

        const oldConfidence = record.confidence || 1.0;
        record.confidence = Math.max(C.MIN, oldConfidence - C.WEAKEN_DROP);
        record.updated = new Date().toISOString();
        if (reason) {
          record.weakenReason = reason;
          record.weakenDate = new Date().toISOString();
        }

        if (record.confidence <= C.MIN) {
          // 置信度归零 → 自动清除
          const delReq = store.delete(id);
          delReq.onsuccess = () => {
            console.log(`[Memory] 遗忘 "${record.content}" (置信度归零，原因: ${reason})`);
            resolve({ id, confidence: 0, deleted: true, content: record.content });
          };
          delReq.onerror = () => reject(delReq.error);
        } else {
          const putReq = store.put(record);
          putReq.onsuccess = () => {
            console.log(`[Memory] 弱化 "${record.content}" (${oldConfidence.toFixed(1)} → ${record.confidence.toFixed(1)}, 原因: ${reason})`);
            resolve({ id, confidence: record.confidence, deleted: false, content: record.content });
          };
          putReq.onerror = () => reject(putReq.error);
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * 直接更新一条已有记忆（仅限事实型修正）
   * @param {number} id - 记忆 ID
   * @param {string} newContent - 新内容
   */
  async updateMemory(id, newContent) {
    const tx = this.db.transaction('semantic', 'readwrite');
    const store = tx.objectStore('semantic');
    return new Promise((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) { resolve(null); return; }
        record.content = newContent;
        record.updated = new Date().toISOString();
        record.confidence = MemoryManager.CONFIDENCE.INIT; // 事实修正，置信度拉满
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve(id);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * 删除一条记忆
   * @param {number} id - 记忆 ID
   */
  async deleteMemory(id) {
    const tx = this.db.transaction('semantic', 'readwrite');
    const store = tx.objectStore('semantic');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 在相同分类记忆中查找相似条目（关键词重叠度 >= 50%）
   * @param {string} content - 新内容
   * @param {object[]} candidates - 候选记忆列表
   * @returns {object|null} 相似记忆或 null
   */
  _findSimilar(content, candidates) {
    const newWords = this._extractKeywords(content);
    if (newWords.length === 0) return null;

    let bestMatch = null;
    let bestScore = 0;

    for (const mem of candidates) {
      const oldWords = this._extractKeywords(mem.content);
      if (oldWords.length === 0) continue;

      // 计算关键词重叠度
      const overlap = newWords.filter(w => oldWords.includes(w)).length;
      const score = overlap / Math.max(newWords.length, oldWords.length);

      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestMatch = mem;
      }
    }
    return bestMatch;
  }

  /** 提取中文/英文关键词 */
  _extractKeywords(text) {
    return text
      .toLowerCase()
      .replace(/[，。！？、；：""''（）\s]+/g, ' ')
      .split(' ')
      .filter(w => w.length >= 2);
  }

  /**
   * 记录记忆被访问（用于后续按访问频率排序）
   * @param {number} id - 记忆 ID
   */
  async touchMemory(id) {
    const tx = this.db.transaction('semantic', 'readwrite');
    const store = tx.objectStore('semantic');
    return new Promise((resolve) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) { resolve(); return; }
        record.accessCount = (record.accessCount || 0) + 1;
        record.lastAccessed = new Date().toISOString();
        store.put(record);
        resolve();
      };
      getReq.onerror = () => resolve();
    });
  }

  /** 获取所有长期记忆 */
  async getAllMemories() {
    const tx = this.db.transaction('semantic', 'readonly');
    const store = tx.objectStore('semantic');
    return new Promise((resolve) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  /** 按分类获取记忆 */
  async getMemoriesByCategory(category) {
    const tx = this.db.transaction('semantic', 'readonly');
    const store = tx.objectStore('semantic');
    const index = store.index('category');
    return new Promise((resolve) => {
      const request = index.getAll(category);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  /**
   * 搜索记忆（关键词匹配 + 自动记录访问）
   * @param {string} query - 搜索关键词
   */
  async searchMemory(query) {
    const all = await this.getAllMemories();
    const keywords = query.toLowerCase().split(/\s+/);
    const results = all.filter(m =>
      keywords.some(kw => m.content.toLowerCase().includes(kw))
    );
    // 记录访问以便按热度排序
    for (const m of results) {
      this.touchMemory(m.id).catch(() => {});
    }
    return results;
  }

  // ========== 记忆自更新 ==========

  /**
   * 清理过期情景记忆（保留最近 N 天）
   * @param {number} keepDays - 保留天数，默认 30
   */
  async pruneEpisodes(keepDays = 30) {
    const all = await this._getAllEpisodes();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const tx = this.db.transaction('episodes', 'readwrite');
    const store = tx.objectStore('episodes');
    let pruned = 0;

    for (const ep of all) {
      if (ep.date < cutoffStr) {
        store.delete(ep.id);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * 整理记忆：限制每个分类最多 N 条，淘汰旧的低访问记忆
   * @param {number} maxPerCategory - 每分类最大条数，默认 20
   */
  async compactMemories(maxPerCategory = 20) {
    const categories = ['preference', 'learning', 'event', 'personality', 'general'];
    let removed = 0;

    for (const cat of categories) {
      const memories = await this.getMemoriesByCategory(cat);
      if (memories.length <= maxPerCategory) continue;

      // 按综合优先级排序：置信度 + 访问 + 更新时间
      memories.sort((a, b) => {
        const scoreA = (a.confidence || 0) * 5
          + (a.accessCount || 0) * 2
          + (new Date(a.updated || a.created).getTime() / 1e12);
        const scoreB = (b.confidence || 0) * 5
          + (b.accessCount || 0) * 2
          + (new Date(b.updated || b.created).getTime() / 1e12);
        return scoreB - scoreA;
      });

      // 删除溢出的低优先级记忆
      const toRemove = memories.slice(maxPerCategory);
      for (const m of toRemove) {
        await this.deleteMemory(m.id);
        removed++;
      }
    }
    return removed;
  }

  /**
   * 执行一轮完整的记忆维护（建议每次对话开始时调用）
   * - 清理 30 天前的情景记忆
   * - 限制每分类最多 20 条语义记忆
   */
  async runMaintenance() {
    const prunedEpisodes = await this.pruneEpisodes(30);
    const compactedMemories = await this.compactMemories(20);
    if (prunedEpisodes > 0 || compactedMemories > 0) {
      console.log(`[Memory] 维护完成: 清理 ${prunedEpisodes} 条过期日志, ${compactedMemories} 条冷门记忆`);
    }
  }

  // ========== 情景记忆（每日日志） ==========

  /**
   * 保存今日互动记录
   * @param {string} summary - 互动摘要
   */
  async saveEpisode(summary) {
    const today = new Date().toISOString().split('T')[0];
    const tx = this.db.transaction('episodes', 'readwrite');
    const store = tx.objectStore('episodes');
    return new Promise((resolve, reject) => {
      const request = store.add({
        date: today,
        summary,
        created: new Date().toISOString()
      });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 获取最近 N 天的互动记录
   * @param {number} days - 天数
   */
  async getRecentEpisodes(days = 3) {
    const all = await this._getAllEpisodes();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return all.filter(e => e.date >= cutoffStr);
  }

  /** 获取今天的记录 */
  async getTodayEpisodes() {
    const today = new Date().toISOString().split('T')[0];
    const tx = this.db.transaction('episodes', 'readonly');
    const store = tx.objectStore('episodes');
    const index = store.index('date');
    return new Promise((resolve) => {
      const request = index.getAll(today);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  async _getAllEpisodes() {
    const tx = this.db.transaction('episodes', 'readonly');
    const store = tx.objectStore('episodes');
    return new Promise((resolve) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  // ========== 学习进度 ==========

  /**
   * 记录学习进度
   * @param {string} subject - 科目
   * @param {object} data - { topic, result, notes }
   */
  async saveLearningProgress(subject, data) {
    const tx = this.db.transaction('learning_progress', 'readwrite');
    const store = tx.objectStore('learning_progress');
    return new Promise((resolve, reject) => {
      const request = store.add({
        subject,
        ...data,
        date: new Date().toISOString().split('T')[0],
        created: new Date().toISOString()
      });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /** 获取某科目的学习进度 */
  async getLearningProgress(subject) {
    const tx = this.db.transaction('learning_progress', 'readonly');
    const store = tx.objectStore('learning_progress');
    const index = store.index('subject');
    return new Promise((resolve) => {
      const request = index.getAll(subject);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  // ========== 记忆格式化（用于注入 System Prompt） ==========

  /**
   * 生成记忆上下文摘要（用于 system prompt 注入）
   * @param {number} maxTokens - 最大字符数预算
   */
  async getMemoryContext(maxTokens = 2000) {
    const parts = [];
    let charCount = 0;

    // 1. 用户画像
    const profile = await this.getUserProfile();
    if (profile.name) {
      let profileStr = `## 主人信息\n`;

      // 基本身份
      profileStr += `- 名字：${profile.name}\n`;
      if (profile.nickname) profileStr += `- 小狸叫主人：${profile.nickname}\n`;
      if (profile.gender) profileStr += `- 性别：${profile.gender}\n`;
      if (profile.birthday) profileStr += `- 生日：${profile.birthday}\n`;
      if (profile.age) profileStr += `- 年龄：${profile.age}\n`;

      // 身份背景
      if (profile.role === 'student') {
        if (profile.grade) profileStr += `- 年级：${profile.grade}\n`;
        if (profile.school) profileStr += `- 学校：${profile.school}\n`;
      } else if (profile.role === 'adult') {
        if (profile.occupation) profileStr += `- 职业：${profile.occupation}\n`;
      } else {
        if (profile.grade) profileStr += `- 年级：${profile.grade}\n`;
        if (profile.school) profileStr += `- 学校：${profile.school}\n`;
        if (profile.occupation) profileStr += `- 职业：${profile.occupation}\n`;
      }

      // 家庭、性格、能力
      if (profile.family) profileStr += `- 家庭：${profile.family}\n`;
      if (profile.personality) profileStr += `- 性格：${profile.personality}\n`;
      if (profile.strengths) profileStr += `- 擅长：${profile.strengths}\n`;
      if (profile.weaknesses) profileStr += `- 薄弱：${profile.weaknesses}\n`;
      if (profile.communication_style) profileStr += `- 沟通偏好：${profile.communication_style}\n`;

      parts.push(profileStr);
      charCount += profileStr.length;
    }

    // 2. 最近互动
    const episodes = await this.getRecentEpisodes(3);
    if (episodes.length > 0) {
      let epStr = '\n## 最近互动\n';
      for (const ep of episodes.slice(-5)) { // 最多5条
        const line = `- [${ep.date}] ${ep.summary}\n`;
        if (charCount + line.length > maxTokens) break;
        epStr += line;
        charCount += line.length;
      }
      parts.push(epStr);
    }

    // 3. 长期记忆（按置信度分层显示）
    const C = MemoryManager.CONFIDENCE;
    const memories = await this.getAllMemories();
    if (memories.length > 0) {
      // 按置信度 + 访问频率综合排序
      memories.sort((a, b) => {
        const scoreA = (a.confidence || 0) * 5
          + (a.accessCount || 0) * 2
          + (new Date(a.updated || a.created).getTime() / 1e12);
        const scoreB = (b.confidence || 0) * 5
          + (b.accessCount || 0) * 2
          + (new Date(b.updated || b.created).getTime() / 1e12);
        return scoreB - scoreA;
      });

      // 分为已确认 / 印象中 / 隐藏
      const confirmed = memories.filter(m => (m.confidence || 1) >= C.CONFIRM_THRESHOLD);
      const tentative = memories.filter(m => {
        const c = m.confidence || 1;
        return c >= C.SHOW_THRESHOLD && c < C.CONFIRM_THRESHOLD;
      });
      // confidence < SHOW_THRESHOLD 的不注入 prompt

      if (confirmed.length > 0) {
        let memStr = '\n## 小狸记住的事\n';
        for (const m of confirmed.slice(0, 10)) {
          const line = `- [${m.category}] ${m.content}\n`;
          if (charCount + line.length > maxTokens) break;
          memStr += line;
          charCount += line.length;
        }
        parts.push(memStr);
      }

      if (tentative.length > 0) {
        let tentStr = '\n## 小狸不太确定的事（主人曾说过相反的话，可能已经变了）\n';
        for (const m of tentative.slice(0, 5)) {
          const line = `- [${m.category}] ${m.content}\n`;
          if (charCount + line.length > maxTokens) break;
          tentStr += line;
          charCount += line.length;
        }
        parts.push(tentStr);
      }
    }

    return parts.join('');
  }

  /**
   * 获取记忆统计信息（调试用）
   */
  async getStats() {
    const memories = await this.getAllMemories();
    const episodes = await this._getAllEpisodes();
    const profile = await this.getUserProfile();
    const categories = {};
    for (const m of memories) {
      categories[m.category] = (categories[m.category] || 0) + 1;
    }
    return {
      totalMemories: memories.length,
      totalEpisodes: episodes.length,
      hasProfile: !!profile.name,
      byCategory: categories
    };
  }
}

// 导出单例
window.MemoryManager = MemoryManager;
