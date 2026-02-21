/**
 * Tool Handler - 工具路由和执行
 * 处理 Gemini Function Calling 的工具调用
 */

class ToolHandler {
  constructor(memoryManager) {
    this.memoryManager = memoryManager;
    this.tools = {};
    this._registerBuiltinTools();
  }

  /** 注册所有内置工具 */
  _registerBuiltinTools() {
    // ===== 记忆工具 =====

    // 保存记忆（带事实/主观区分）
    this.register('save_memory', async (args) => {
      const { content, category, is_factual } = args;
      const result = await this.memoryManager.saveMemory(
        content,
        category || 'general',
        is_factual === true ? true : (is_factual === false ? false : null)
      );
      return {
        success: true,
        confidence: result.confidence,
        status: result.status,
        message: result.status === '已确认' ? '已确认记住' : '先记下了，再提到会更确信'
      };
    });

    // 回忆（返回置信度信息）
    this.register('recall_memory', async (args) => {
      const { query } = args;
      const results = await this.memoryManager.searchMemory(query);
      if (results.length === 0) {
        return { found: false, message: '没有找到相关记忆' };
      }
      return {
        found: true,
        memories: results.map(m => ({
          content: m.content,
          category: m.category,
          confidence: m.confidence || 1.0,
          status: (m.confidence || 1) >= 0.6 ? '已确认' : '待确认',
          mentions: m.mentions || 1,
          date: m.updated?.split('T')[0] || m.created?.split('T')[0]
        }))
      };
    });

    // 更新事实型记忆（仅用于客观事实的修正）
    this.register('update_memory', async (args) => {
      const { query, new_content } = args;
      const results = await this.memoryManager.searchMemory(query);
      if (results.length === 0) {
        await this.memoryManager.saveMemory(new_content, 'event', true);
        return { success: true, action: 'created', message: '没有找到旧记忆，已新建为事实记忆' };
      }
      await this.memoryManager.updateMemory(results[0].id, new_content);
      return { success: true, action: 'updated', old: results[0].content, new: new_content };
    });

    // 弱化记忆（听到矛盾的主观信息时使用，不立即删除）
    this.register('weaken_memory', async (args) => {
      const { query, reason } = args;
      const results = await this.memoryManager.searchMemory(query);
      if (results.length === 0) {
        return { success: false, message: '没有找到相关记忆' };
      }
      const result = await this.memoryManager.weakenMemory(results[0].id, reason || '');
      if (result.deleted) {
        return {
          success: true,
          action: 'forgotten',
          message: `"${result.content}" 的置信度已归零，已遗忘`
        };
      }
      return {
        success: true,
        action: 'weakened',
        content: result.content,
        confidence: result.confidence,
        message: `"${result.content}" 的确信程度降低了 (${result.confidence.toFixed(1)})`
      };
    });

    // 强制遗忘（确认要彻底删除时使用）
    this.register('forget_memory', async (args) => {
      const { query } = args;
      const results = await this.memoryManager.searchMemory(query);
      if (results.length === 0) {
        return { success: false, message: '没有找到要遗忘的记忆' };
      }
      await this.memoryManager.deleteMemory(results[0].id);
      return { success: true, forgotten: results[0].content };
    });

    // ===== 用户画像工具 =====
    this.register('save_user_profile', async (args) => {
      for (const [key, value] of Object.entries(args)) {
        await this.memoryManager.saveUserProfile(key, value);
      }
      return { success: true };
    });

    // ===== 互动日志工具 =====
    this.register('save_episode', async (args) => {
      const { summary } = args;
      await this.memoryManager.saveEpisode(summary);
      return { success: true };
    });

    // ===== 数学计算工具 =====
    this.register('calculate', async (args) => {
      const { expression } = args;
      try {
        const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');
        if (!sanitized || sanitized !== expression.replace(/\s/g, '').replace(/[^0-9+\-*/().%]/g, '')) {
          return { error: '表达式包含不支持的字符' };
        }
        const result = Function('"use strict"; return (' + sanitized + ')')();
        return { expression, result, success: true };
      } catch (e) {
        return { expression, error: '计算失败: ' + e.message, success: false };
      }
    });
  }

  /**
   * 注册新工具
   * @param {string} name - 工具名
   * @param {function} handler - 执行函数 (args) => result
   */
  register(name, handler) {
    this.tools[name] = handler;
  }

  /**
   * 执行工具调用
   * @param {string} name - 工具名
   * @param {object} args - 参数
   * @returns {object} 执行结果
   */
  async execute(name, args) {
    const handler = this.tools[name];
    if (!handler) {
      return { error: `未知工具: ${name}` };
    }
    try {
      return await handler(args);
    } catch (e) {
      console.error(`工具执行失败 [${name}]:`, e);
      return { error: e.message };
    }
  }

  /**
   * 获取所有工具的 Gemini Function Declaration 格式
   */
  getFunctionDeclarations() {
    return [
      {
        name: 'save_memory',
        description: '记住一条关于主人的信息。首次提及即被信任。如果已有相似记忆会自动去重。如果记忆之前被弱化过，再次提及会恢复置信度。',
        parameters: {
          type: 'OBJECT',
          properties: {
            content: { type: 'STRING', description: '要记住的内容' },
            category: {
              type: 'STRING',
              description: '分类',
              enum: ['preference', 'learning', 'event', 'personality']
            },
            is_factual: {
              type: 'BOOLEAN',
              description: '是否为客观事实（升年级、考试成绩、生日等）。影响矛盾时的处理方式：事实型矛盾用update_memory直接修正，主观型矛盾用weaken_memory渐进弱化。不传则根据分类自动判断。'
            }
          },
          required: ['content']
        }
      },
      {
        name: 'recall_memory',
        description: '回忆之前记住的关于主人的信息，返回内容和置信度',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: '想回忆什么内容' }
          },
          required: ['query']
        }
      },
      {
        name: 'update_memory',
        description: '直接修正一条事实性记忆（仅用于客观事实变更，如升年级了、转学了）。对于主观偏好变化，应该用 weaken_memory 而不是直接覆盖。',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: '要更新的旧记忆关键词' },
            new_content: { type: 'STRING', description: '新的正确内容' }
          },
          required: ['query', 'new_content']
        }
      },
      {
        name: 'weaken_memory',
        description: '当听到与已有记忆矛盾的话时，降低旧记忆的确信度。不会立即删除，而是让记忆慢慢淡化。多次弱化后才会真正遗忘。适用于主人说"我不喜欢XX了"之类的主观变化。',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: '要弱化的记忆关键词' },
            reason: { type: 'STRING', description: '弱化原因（主人说了什么矛盾的话）' }
          },
          required: ['query']
        }
      },
      {
        name: 'forget_memory',
        description: '彻底删除一条记忆。仅在非常确定这条记忆完全错误时使用。大多数情况下应该用 weaken_memory 让记忆自然淡化。',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: '要彻底遗忘的记忆关键词' }
          },
          required: ['query']
        }
      },
      {
        name: 'save_user_profile',
        description: '保存或更新主人的基本画像信息。每个字段独立存储，可以一次传多个字段，也可以只传一个。每次获取到新信息就调用，新值会覆盖旧值。',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: '主人的名字' },
            nickname: { type: 'STRING', description: '小狸对主人的称呼（如"小丹"、"姐姐"、"哥哥"）' },
            birthday: { type: 'STRING', description: '主人的生日（如"3月15日"、"2015-03-15"）' },
            age: { type: 'STRING', description: '主人的年龄（如"10岁"、"28岁"）' },
            gender: { type: 'STRING', description: '主人的性别' },
            role: { type: 'STRING', description: '主人的身份：student（学生）或 adult（成人/职场人）' },
            grade: { type: 'STRING', description: '年级（学生适用，如"五年级"、"初二"）' },
            school: { type: 'STRING', description: '学校名称（学生适用）' },
            occupation: { type: 'STRING', description: '职业（成人适用，如"产品经理"、"老师"）' },
            family: { type: 'STRING', description: '家庭情况（如"有个弟弟叫小宇"、"养了一只猫叫咪咪"）' },
            personality: { type: 'STRING', description: '性格特点（如"有点内向"、"活泼开朗"）' },
            strengths: { type: 'STRING', description: '擅长的科目或能力' },
            weaknesses: { type: 'STRING', description: '薄弱的科目或需要帮助的方面' },
            communication_style: { type: 'STRING', description: '沟通偏好（如"喜欢被夸奖"、"不喜欢被催促"、"喜欢简短回答"）' }
          }
        }
      },
      {
        name: 'save_episode',
        description: '保存今天的互动记录摘要',
        parameters: {
          type: 'OBJECT',
          properties: {
            summary: { type: 'STRING', description: '今天互动的简短摘要' }
          },
          required: ['summary']
        }
      },
      {
        name: 'calculate',
        description: '计算数学表达式',
        parameters: {
          type: 'OBJECT',
          properties: {
            expression: { type: 'STRING', description: '数学表达式，如 24/6 或 3.14*5*5' }
          },
          required: ['expression']
        }
      }
    ];
  }
}

window.ToolHandler = ToolHandler;
