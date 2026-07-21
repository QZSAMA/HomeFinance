import { AI_CONFIG, isAIConfigured } from '../config/ai';
import { parseLocalActions, type AIAction, type ParsedAIResponse } from './aiActions';

interface ChatMessage {
  role: string;
  content: string;
}

export class AIError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.name = 'AIError';
    this.statusCode = statusCode;
  }
}

async function callChatAPI(messages: ChatMessage[]): Promise<string> {
  if (!isAIConfigured()) {
    return generateFallbackResponse(messages);
  }

  try {
    const response = await fetch(`${AI_CONFIG.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages,
        max_tokens: AI_CONFIG.maxTokens,
        temperature: AI_CONFIG.temperature,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new AIError(
        `AI 服务调用失败 (${response.status})：${errorText || '请检查 API Key 和网络'}`,
        response.status === 401 || response.status === 403 ? 503 : 500
      );
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          role: string;
          content: string;
        };
      }>;
    };

    return data.choices[0]?.message?.content || '';
  } catch (error) {
    if (error instanceof AIError) throw error;

    if (error instanceof TypeError) {
      throw new AIError('AI 服务连接失败，请检查网络或 API 地址配置', 503);
    }

    throw new AIError(
      `AI 服务异常：${error instanceof Error ? error.message : '未知错误'}`,
      500
    );
  }
}

function generateFallbackResponse(messages: ChatMessage[]): string {
  const userMessage = messages[messages.length - 1]?.content || '';
  const lower = userMessage.toLowerCase();

  const fallbackResponses: { keywords: string[]; reply: string }[] = [
    {
      keywords: ['你好', '您好', 'hi', 'hello', '在吗'],
      reply: '你好！我是你的家庭财务助手。当前 AI 服务未配置（需要设置 AI_API_KEY 环境变量），所以暂时只能提供基础回复。\n\n你可以：\n1. 在交易记录页录入收入和支出\n2. 在资产管理页添加家庭资产\n3. 在负债管理页记录负债\n4. 在报表页查看家庭财务分析',
    },
    {
      keywords: ['收入', '工资', '薪水', '薪资'],
      reply: '关于收入管理：\n- 你可以在"交易记录"页面的"收入"标签页中录入\n- 收入类别包括：工资、奖金、投资收益、兼职收入、租金收入、其他收入\n- 系统会自动生成利润表分析\n\n💡 提示：当前 AI 服务未配置，无法提供个性化分析。',
    },
    {
      keywords: ['支出', '花费', '消费', '开销'],
      reply: '关于支出管理：\n- 你可以在"交易记录"页面的"支出"标签页中录入\n- 系统支持重复检测，避免误录\n- 支出会按类别自动汇总到利润表\n\n💡 提示：当前 AI 服务未配置，无法提供智能消费建议。',
    },
    {
      keywords: ['资产', '理财', '投资'],
      reply: '关于资产管理：\n- 在"资产管理"页面可以添加家庭资产\n- 支持的类型：现金、股票、基金、长期国债、黄金、房产、其他\n- 投资配置页面会显示各类资产占比饼图\n\n💡 提示：当前 AI 服务未配置，无法提供投资建议。',
    },
    {
      keywords: ['负债', '贷款', '欠款', '房贷', '车贷'],
      reply: '关于负债管理：\n- 在"负债管理"页面可以记录各类负债\n- 支持记录利率、起止日期等信息\n- 资产负债表会显示总负债和净资产\n\n💡 提示：当前 AI 服务未配置，无法提供负债优化建议。',
    },
    {
      keywords: ['报表', '分析', '报告'],
      reply: '系统提供以下报表：\n1. 资产负债表 - 展示家庭资产负债状况\n2. 利润表 - 展示收支情况\n3. 现金流量表 - 展示现金流动\n4. 投资配置 - 展示资产配置\n\n💡 提示：当前 AI 服务未配置，AI 分析功能暂不可用。',
    },
  ];

  for (const item of fallbackResponses) {
    if (item.keywords.some((k) => lower.includes(k))) {
      return item.reply;
    }
  }

  return `收到你的消息："${userMessage}"\n\n当前 AI 服务未配置，无法提供智能回复。请在 backend/.env 中设置有效的 AI_API_KEY 后重启服务。\n\n你也可以：\n- 使用侧边栏导航查看财务报表\n- 在交易记录页面录入数据\n- 在资产管理页面添加资产`;
}

export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  return callChatAPI(messages);
}

// ===== AI 带动作的对话 =====

const ACTION_SYSTEM_PROMPT = `你是一位家庭财务助手。你可以帮用户记录收入、支出、资产、负债，也可以查询已有记录。

当用户想要进行财务操作时，你需要返回 JSON 格式的响应（只返回 JSON，不要包含 markdown 代码块标记），格式如下：
{
  "reply": "给用户的自然语言回复，说明你做了什么",
  "actions": [
    {
      "type": "操作类型",
      "data": { ... }
    }
  ]
}

如果用户只是聊天或提问，不涉及财务操作，返回：
{
  "reply": "回复内容",
  "actions": []
}

支持的操作类型和 data 格式：

1. create_income - 创建收入
   data: { "amount": 数字, "category": "类别", "description": "可选", "date": "YYYY-MM-DD 可选默认今天", "source": "可选" }
   收入类别：工资、奖金、投资收益、兼职收入、租金收入、其他收入

2. create_expense - 创建支出
   data: { "amount": 数字, "category": "类别", "description": "可选", "date": "YYYY-MM-DD 可选默认今天", "paymentMethod": "可选" }
   支出类别：餐饮、交通、日用、娱乐、医疗、教育、水电通讯、购物、居住、其他支出

3. create_asset - 创建资产
   data: { "name": "名称", "type": "类型", "value": 数字, "description": "可选" }
   资产类型：CASH(现金)、STOCK(股票)、FUND(基金)、BOND(债券)、GOLD(黄金)、REAL_ESTATE(房产)、OTHER(其他)

4. create_liability - 创建负债
   data: { "name": "名称", "type": "类型", "amount": 数字, "interestRate": "可选利率", "description": "可选" }
   负债类型：MORTGAGE(房贷)、CAR_LOAN(车贷)、STUDENT_LOAN(助学贷款)、CREDIT_CARD(信用卡)、PERSONAL_LOAN(个人贷款)、OTHER(其他)

5. query_income - 查询收入记录
6. query_expense - 查询支出记录
7. query_assets - 查询资产记录
8. query_liabilities - 查询负债记录

规则：
- 金额必须是正数
- 如果用户没有指定日期，使用今天
- 如果用户说的类别不在预设列表中，归为"其他收入"或"其他支出"
- 如果用户说"花了50吃饭"→ create_expense, amount=50, category=餐饮
- 如果用户说"工资15000"→ create_income, amount=15000, category=工资
- 如果用户说"我有10万股票"→ create_asset, type=STOCK, value=100000, name=股票
- 如果用户说"还有50万房贷"→ create_liability, type=MORTGAGE, amount=500000, name=房贷
- 如果用户说"查看支出"→ query_expense`;

export async function chatWithActions(
  userMessage: string,
  familyContext?: {
    recentIncomes?: Array<{ category: string; amount: number; date: Date }>;
    recentExpenses?: Array<{ category: string; amount: number; date: Date }>;
    assets?: Array<{ name: string; type: string; value: number }>;
    liabilities?: Array<{ name: string; type: string; amount: number }>;
  }
): Promise<ParsedAIResponse> {
  if (!isAIConfigured()) {
    return parseLocalActions(userMessage);
  }

  let contextPrompt = '';
  if (familyContext) {
    const parts: string[] = [];
    if (familyContext.recentIncomes?.length) {
      parts.push(`近期收入：${familyContext.recentIncomes.map(i => `${i.category} ¥${i.amount}(${i.date.toISOString().split('T')[0]})`).join('、')}`);
    }
    if (familyContext.recentExpenses?.length) {
      parts.push(`近期支出：${familyContext.recentExpenses.map(e => `${e.category} ¥${e.amount}(${e.date.toISOString().split('T')[0]})`).join('、')}`);
    }
    if (familyContext.assets?.length) {
      parts.push(`资产：${familyContext.assets.map(a => `${a.name}(${a.type}) ¥${a.value}`).join('、')}`);
    }
    if (familyContext.liabilities?.length) {
      parts.push(`负债：${familyContext.liabilities.map(l => `${l.name}(${l.type}) ¥${l.amount}`).join('、')}`);
    }
    if (parts.length > 0) {
      contextPrompt = `\n\n当前家庭财务概况：\n${parts.join('\n')}`;
    }
  }

  try {
    const content = await callChatAPI([
      { role: 'system', content: ACTION_SYSTEM_PROMPT + contextPrompt },
      { role: 'user', content: userMessage },
    ]);

    // 尝试解析 JSON 响应
    const cleaned = content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned) as ParsedAIResponse;

    // 验证格式
    if (!parsed.reply || typeof parsed.reply !== 'string') {
      // AI 返回了非标准格式，降级到本地解析器
      const local = parseLocalActions(userMessage);
      return { reply: local.reply || content, actions: local.actions };
    }
    if (!Array.isArray(parsed.actions)) {
      return { reply: parsed.reply, actions: [] };
    }

    // 如果 AI 没有返回 actions，也尝试本地解析
    if (parsed.actions.length === 0) {
      const local = parseLocalActions(userMessage);
      if (local.actions.length > 0) {
        return { reply: parsed.reply, actions: local.actions };
      }
    }

    return {
      reply: parsed.reply,
      actions: parsed.actions.filter(a => a.type && a.data),
    };
  } catch (error) {
    // JSON 解析失败，降级到本地解析器
    if (error instanceof AIError) throw error;
    const local = parseLocalActions(userMessage);
    return { reply: local.reply || userMessage, actions: local.actions };
  }
}

export async function analyzeFinance(familyData: {
  totalAssets: number;
  totalLiabilities: number;
  monthlyIncome: number;
  monthlyExpense: number;
  investmentAllocation?: Array<{ category: string; value: number; percentage: number }>;
}): Promise<string> {
  if (!isAIConfigured()) {
    return generateFallbackAnalysis(familyData);
  }

  const systemPrompt = `你是一位专业的家庭财务顾问。请根据用户提供的家庭财务数据，生成一份简洁、实用的财务分析报告。

报告应包含以下内容：
1. 财务健康度评估（优秀/良好/一般/需改善）
2. 收支分析（收入结构、支出合理性）
3. 资产负债分析
4. 投资建议（如有投资配置数据）
5. 具体的改进建议

请用中文回复，语气专业但易懂。控制在 800 字以内。`;

  const userPrompt = `请分析以下家庭财务数据：
总资产：${familyData.totalAssets} 元
总负债：${familyData.totalLiabilities} 元
净资产：${familyData.totalAssets - familyData.totalLiabilities} 元
月收入：${familyData.monthlyIncome} 元
月支出：${familyData.monthlyExpense} 元
月结余：${familyData.monthlyIncome - familyData.monthlyExpense} 元
${familyData.investmentAllocation ? `投资配置：\n${familyData.investmentAllocation.map(a => `- ${a.category}: ${a.value} 元 (${a.percentage}%)`).join('\n')}` : ''}`;

  return callChatAPI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
}

function generateFallbackAnalysis(familyData: {
  totalAssets: number;
  totalLiabilities: number;
  monthlyIncome: number;
  monthlyExpense: number;
  investmentAllocation?: Array<{ category: string; value: number; percentage: number }>;
}): string {
  const { totalAssets, totalLiabilities, monthlyIncome, monthlyExpense } = familyData;
  const netWorth = totalAssets - totalLiabilities;
  const monthlySavings = monthlyIncome - monthlyExpense;
  const savingsRate = monthlyIncome > 0 ? (monthlySavings / monthlyIncome * 100).toFixed(1) : '0';
  const debtRatio = totalAssets > 0 ? (totalLiabilities / totalAssets * 100).toFixed(1) : '0';

  let healthLevel = '一般';
  let healthAdvice = '';
  if (netWorth > 0 && Number(savingsRate) >= 30 && Number(debtRatio) < 30) {
    healthLevel = '优秀';
    healthAdvice = '财务状况非常好，建议保持当前的储蓄和投资习惯。';
  } else if (netWorth > 0 && Number(savingsRate) >= 20) {
    healthLevel = '良好';
    healthAdvice = '财务状况良好，可以考虑增加投资以提高资产收益。';
  } else if (netWorth > 0) {
    healthLevel = '一般';
    healthAdvice = '建议提高储蓄率，控制不必要的支出。';
  } else {
    healthLevel = '需改善';
    healthAdvice = '净资产为负，建议优先偿还高息负债，控制新增负债。';
  }

  return `# 家庭财务分析报告

## 1. 财务健康度评估
**等级：${healthLevel}**

${healthAdvice}

## 2. 收支分析
- 月收入：${monthlyIncome.toFixed(2)} 元
- 月支出：${monthlyExpense.toFixed(2)} 元
- 月结余：${monthlySavings.toFixed(2)} 元
- 储蓄率：${savingsRate}%

${Number(savingsRate) >= 30 ? '✅ 储蓄率优秀' : Number(savingsRate) >= 20 ? '⚠️ 储蓄率良好' : '❌ 储蓄率偏低，建议控制在 20% 以上'}

## 3. 资产负债分析
- 总资产：${totalAssets.toFixed(2)} 元
- 总负债：${totalLiabilities.toFixed(2)} 元
- 净资产：${netWorth.toFixed(2)} 元
- 负债率：${debtRatio}%

${Number(debtRatio) < 30 ? '✅ 负债率健康' : Number(debtRatio) < 50 ? '⚠️ 负债率偏高' : '❌ 负债率过高，建议优先偿还负债'}

## 4. 改进建议
1. 保持或提高储蓄率，目标 20%-30%
2. 控制负债率在 30% 以下
3. 适当配置权益类资产以对抗通胀
4. 定期检视家庭财务状况

---
💡 提示：当前 AI 服务未配置，本报告由本地规则生成。如需更智能的个性化分析，请在 backend/.env 中配置 AI_API_KEY。`;
}

export async function parseReceiptOCR(imageBase64: string): Promise<{
  amount?: number;
  date?: string;
  category?: string;
  description?: string;
  raw?: string;
}> {
  if (!isAIConfigured()) {
    return {
      amount: undefined,
      date: undefined,
      category: undefined,
      description: undefined,
      raw: 'AI 服务未配置，无法识别图片内容。请在 backend/.env 中配置 AI_API_KEY 后重试。',
    };
  }

  const systemPrompt = `你是一位票据识别助手。用户会提供一张收据或发票的图片（base64 编码）。
请识别图片中的关键信息，并以 JSON 格式返回，字段包括：
- amount: 金额（数字）
- date: 日期（YYYY-MM-DD 格式）
- category: 消费类别（如 餐饮、交通、购物、娱乐、医疗、教育、日用、其他）
- description: 简短描述

只返回 JSON，不要包含其他文字。如果无法识别，返回 {"error": "无法识别"}。`;

  try {
    const content = await callChatAPI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `请识别以下票据图片：\n${imageBase64}` },
    ]);

    try {
      return JSON.parse(content);
    } catch {
      return { raw: content };
    }
  } catch (error) {
    if (error instanceof AIError) throw error;
    return {
      raw: `OCR 识别失败：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}
