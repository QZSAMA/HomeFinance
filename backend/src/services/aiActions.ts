import { prisma } from '../app';
import { toNumber } from '../utils/decimal';

// ===== 类型定义 =====

export type ActionType =
  | 'create_income' | 'create_expense'
  | 'create_asset'  | 'create_liability'
  | 'delete_income' | 'delete_expense'
  | 'delete_asset'  | 'delete_liability'
  | 'query_income'  | 'query_expense'
  | 'query_assets'  | 'query_liabilities';

export interface AIAction {
  type: ActionType;
  data: Record<string, any>;
}

export interface ActionResult {
  type: ActionType;
  status: 'success' | 'error';
  message: string;
  record?: any;
  records?: any[];
}

export interface ParsedAIResponse {
  reply: string;
  actions: AIAction[];
}

// ===== 动作执行器 =====

export async function executeActions(
  familyId: string,
  userId: string,
  actions: AIAction[]
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];

  for (const action of actions) {
    try {
      const result = await executeAction(familyId, userId, action);
      results.push(result);
    } catch (error) {
      results.push({
        type: action.type,
        status: 'error',
        message: `操作失败：${error instanceof Error ? error.message : '未知错误'}`,
      });
    }
  }

  return results;
}

async function executeAction(
  familyId: string,
  userId: string,
  action: AIAction
): Promise<ActionResult> {
  const { type, data } = action;

  switch (type) {
    // ===== 创建收入 =====
    case 'create_income': {
      const amount = Number(data.amount);
      if (!amount || amount <= 0) {
        return { type, status: 'error', message: '金额必须大于0' };
      }
      const record = await prisma.income.create({
        data: {
          amount,
          category: data.category || '其他收入',
          description: data.description || null,
          date: data.date ? new Date(data.date) : new Date(),
          source: data.source || null,
          familyId,
          createdBy: userId,
        },
      });
      return {
        type,
        status: 'success',
        message: `已创建收入：${data.category || '其他收入'} ¥${amount.toFixed(2)}`,
        record,
      };
    }

    // ===== 创建支出 =====
    case 'create_expense': {
      const amount = Number(data.amount);
      if (!amount || amount <= 0) {
        return { type, status: 'error', message: '金额必须大于0' };
      }
      const record = await prisma.expense.create({
        data: {
          amount,
          category: data.category || '其他支出',
          description: data.description || null,
          date: data.date ? new Date(data.date) : new Date(),
          paymentMethod: data.paymentMethod || null,
          familyId,
          createdBy: userId,
        },
      });
      return {
        type,
        status: 'success',
        message: `已创建支出：${data.category || '其他支出'} ¥${amount.toFixed(2)}`,
        record,
      };
    }

    // ===== 创建资产 =====
    case 'create_asset': {
      const value = Number(data.value);
      if (isNaN(value) || value < 0) {
        return { type, status: 'error', message: '资产价值无效' };
      }
      const record = await prisma.asset.create({
        data: {
          name: data.name || '未命名资产',
          type: data.type || 'OTHER',
          category: data.category || null,
          value,
          costBasis: data.costBasis ? Number(data.costBasis) : null,
          currency: data.currency || 'CNY',
          purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
          description: data.description || null,
          familyId,
        },
      });
      return {
        type,
        status: 'success',
        message: `已创建资产：${data.name || '未命名资产'} ¥${value.toFixed(2)}`,
        record,
      };
    }

    // ===== 创建负债 =====
    case 'create_liability': {
      const amount = Number(data.amount);
      if (isNaN(amount) || amount < 0) {
        return { type, status: 'error', message: '负债金额无效' };
      }
      const record = await prisma.liability.create({
        data: {
          name: data.name || '未命名负债',
          type: data.type || 'OTHER',
          amount,
          interestRate: data.interestRate ? Number(data.interestRate) : null,
          startDate: data.startDate ? new Date(data.startDate) : null,
          endDate: data.endDate ? new Date(data.endDate) : null,
          currency: data.currency || 'CNY',
          description: data.description || null,
          familyId,
        },
      });
      return {
        type,
        status: 'success',
        message: `已创建负债：${data.name || '未命名负债'} ¥${amount.toFixed(2)}`,
        record,
      };
    }

    // ===== 删除收入 =====
    case 'delete_income': {
      const record = await prisma.income.findUnique({ where: { id: data.id } });
      if (!record || record.familyId !== familyId) {
        return { type, status: 'error', message: '记录不存在' };
      }
      await prisma.income.delete({ where: { id: data.id } });
      return { type, status: 'success', message: '已删除收入记录' };
    }

    // ===== 删除支出 =====
    case 'delete_expense': {
      const record = await prisma.expense.findUnique({ where: { id: data.id } });
      if (!record || record.familyId !== familyId) {
        return { type, status: 'error', message: '记录不存在' };
      }
      await prisma.expense.delete({ where: { id: data.id } });
      return { type, status: 'success', message: '已删除支出记录' };
    }

    // ===== 删除资产 =====
    case 'delete_asset': {
      const record = await prisma.asset.findUnique({ where: { id: data.id } });
      if (!record || record.familyId !== familyId) {
        return { type, status: 'error', message: '记录不存在' };
      }
      await prisma.asset.delete({ where: { id: data.id } });
      return { type, status: 'success', message: '已删除资产记录' };
    }

    // ===== 删除负债 =====
    case 'delete_liability': {
      const record = await prisma.liability.findUnique({ where: { id: data.id } });
      if (!record || record.familyId !== familyId) {
        return { type, status: 'error', message: '记录不存在' };
      }
      await prisma.liability.delete({ where: { id: data.id } });
      return { type, status: 'success', message: '已删除负债记录' };
    }

    // ===== 查询收入 =====
    case 'query_income': {
      const records = await prisma.income.findMany({
        where: { familyId },
        orderBy: { date: 'desc' },
        take: data.limit || 10,
      });
      const total = records.reduce((s, r) => s + toNumber(r.amount), 0);
      return {
        type,
        status: 'success',
        message: `查询到 ${records.length} 条收入记录，合计 ¥${total.toFixed(2)}`,
        records,
      };
    }

    // ===== 查询支出 =====
    case 'query_expense': {
      const records = await prisma.expense.findMany({
        where: { familyId },
        orderBy: { date: 'desc' },
        take: data.limit || 10,
      });
      const total = records.reduce((s, r) => s + toNumber(r.amount), 0);
      return {
        type,
        status: 'success',
        message: `查询到 ${records.length} 条支出记录，合计 ¥${total.toFixed(2)}`,
        records,
      };
    }

    // ===== 查询资产 =====
    case 'query_assets': {
      const records = await prisma.asset.findMany({
        where: { familyId },
        orderBy: { value: 'desc' },
      });
      const total = records.reduce((s, r) => s + toNumber(r.value), 0);
      return {
        type,
        status: 'success',
        message: `查询到 ${records.length} 项资产，合计 ¥${total.toFixed(2)}`,
        records,
      };
    }

    // ===== 查询负债 =====
    case 'query_liabilities': {
      const records = await prisma.liability.findMany({
        where: { familyId },
        orderBy: { amount: 'desc' },
      });
      const total = records.reduce((s, r) => s + toNumber(r.amount), 0);
      return {
        type,
        status: 'success',
        message: `查询到 ${records.length} 项负债，合计 ¥${total.toFixed(2)}`,
        records,
      };
    }

    default:
      return { type, status: 'error', message: `未知操作类型：${type}` };
  }
}

// ===== 本地正则解析器（AI 未配置时使用）=====

const expenseCategoryMap: Record<string, string> = {
  '吃饭|午饭|晚饭|早餐|餐|饭|外卖|美食|吃': '餐饮',
  '打车|地铁|公交|停车|油费|过路|高铁|机票|火车|交通': '交通',
  '超市|日用|纸巾|洗衣|生活用品': '日用',
  '电影|游戏|旅游|出去玩|娱乐|ktv': '娱乐',
  '医院|药|看病|挂号|体检': '医疗',
  '学费|书|课程|培训|教育': '教育',
  '话费|网费|水电|物业|燃气': '水电通讯',
  '衣服|鞋|包|购物|京东|淘宝|拼多多': '购物',
  '房贷|房租|物业费': '居住',
};

const incomeCategoryMap: Record<string, string> = {
  '工资|薪水|薪资|月薪|发工资': '工资',
  '奖金|年终奖|绩效': '奖金',
  '利息|理财收益|分红': '投资收益',
  '兼职|外快|稿费': '兼职收入',
  '租金|收租': '租金收入',
};

const assetTypeMap: Record<string, string> = {
  '现金|存款|活期|余额': 'CASH',
  '股票|a股|美股|港股': 'STOCK',
  '基金|etf|指数': 'FUND',
  '国债|债券|固收': 'BOND',
  '黄金|金条|金饰': 'GOLD',
  '房产|房子|公寓': 'REAL_ESTATE',
};

const liabilityTypeMap: Record<string, string> = {
  '房贷|按揭': 'MORTGAGE',
  '车贷': 'CAR_LOAN',
  '助学贷|学贷': 'STUDENT_LOAN',
  '信用卡|卡账': 'CREDIT_CARD',
  '个人贷|消费贷|信用贷': 'PERSONAL_LOAN',
};

function parseAmount(text: string): number | null {
  // 匹配 "50块" "50元" "15000" "1.5万" "10万" "5000.5"
  const wanMatch = text.match(/([\d.]+)\s*万/);
  if (wanMatch) {
    return parseFloat(wanMatch[1]) * 10000;
  }

  const yuanMatch = text.match(/([\d.]+)\s*(?:元|块|人民币|rmb|￥|¥)/i);
  if (yuanMatch) {
    return parseFloat(yuanMatch[1]);
  }

  const plainMatch = text.match(/(?:花了|花|消费|支出|收入|收到|赚了|工资|发|金额| value)\s*[:：]?\s*([\d.]+)/);
  if (plainMatch) {
    return parseFloat(plainMatch[1]);
  }

  return null;
}

function matchCategory(text: string, categoryMap: Record<string, string>): string {
  for (const [pattern, category] of Object.entries(categoryMap)) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(text)) {
      return category;
    }
  }
  return '';
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

export function parseLocalActions(content: string): ParsedAIResponse {
  const actions: AIAction[] = [];
  const lower = content.toLowerCase();

  // 查询指令
  if (/查看|查询|看看|列出|显示|多少/.test(content) && !/花|赚|收|买|欠|贷|记|添加|创建|新增/.test(content)) {
    if (/收入/.test(content)) {
      actions.push({ type: 'query_income', data: {} });
    }
    if (/支出|花费|消费|开销/.test(content)) {
      actions.push({ type: 'query_expense', data: {} });
    }
    if (/资产/.test(content) && !/负债/.test(content)) {
      actions.push({ type: 'query_assets', data: {} });
    }
    if (/负债|欠款|贷款/.test(content)) {
      actions.push({ type: 'query_liabilities', data: {} });
    }
    if (actions.length > 0) {
      return {
        reply: '好的，为你查询相关记录：',
        actions,
      };
    }
  }

  // 支出指令：花了/消费/支出
  const isExpense = /花了|花|消费|支出|买了|买|付|充|交/.test(content) && !/收入|工资|赚|收到|卖/.test(content);
  if (isExpense) {
    const amount = parseAmount(content);
    if (amount && amount > 0) {
      const category = matchCategory(content, expenseCategoryMap) || '其他支出';
      // 提取描述
      const descMatch = content.match(/(?:买了|买了个|买了个|买了些|买了一些)\s*(.+?)(?:\s*[，。,.]|$)/);
      const description = descMatch ? descMatch[1] : content.slice(0, 50);
      actions.push({
        type: 'create_expense',
        data: { amount, category, description, date: todayStr() },
      });
    }
  }

  // 收入指令：工资/收到/赚了
  const isIncome = /工资|薪水|薪资|收到|赚了|收入|发了|奖金|租金/.test(content);
  if (isIncome && actions.length === 0) {
    const amount = parseAmount(content);
    if (amount && amount > 0) {
      const category = matchCategory(content, incomeCategoryMap) || '其他收入';
      actions.push({
        type: 'create_income',
        data: { amount, category, date: todayStr() },
      });
    }
  }

  // 资产指令：我有/持有/买了(投资类)
  const isAsset = /我有|持有|资产|存款|买了.*股|买了.*基|投资了|存了/.test(content);
  if (isAsset && actions.length === 0) {
    const amount = parseAmount(content);
    if (amount && amount > 0) {
      const assetType = matchCategory(content, assetTypeMap) || 'OTHER';
      const typeLabels: Record<string, string> = {
        CASH: '现金', STOCK: '股票', FUND: '基金', BOND: '债券',
        GOLD: '黄金', REAL_ESTATE: '房产', OTHER: '其他资产',
      };
      actions.push({
        type: 'create_asset',
        data: { name: typeLabels[assetType], type: assetType, value: amount },
      });
    }
  }

  // 负债指令：欠/房贷/车贷
  const isLiability = /欠|房贷|车贷|助学贷|信用卡.*欠|负债|贷款/.test(content);
  if (isLiability && actions.length === 0) {
    const amount = parseAmount(content);
    if (amount && amount > 0) {
      const liabilityType = matchCategory(content, liabilityTypeMap) || 'OTHER';
      const typeLabels: Record<string, string> = {
        MORTGAGE: '房贷', CAR_LOAN: '车贷', STUDENT_LOAN: '助学贷款',
        CREDIT_CARD: '信用卡', PERSONAL_LOAN: '个人贷款', OTHER: '其他负债',
      };
      actions.push({
        type: 'create_liability',
        data: { name: typeLabels[liabilityType], type: liabilityType, amount },
      });
    }
  }

  if (actions.length === 0) {
    return {
      reply: '我理解你想进行财务操作，但没能准确识别具体内容。\n\n你可以试试这样说：\n• "午饭花了50块"\n• "本月工资15000"\n• "收到租金3000元"\n• "我有10万股票"\n• "还有50万房贷"\n• "查看本月支出"',
      actions: [],
    };
  }

  const summary = actions.map(a => {
    switch (a.type) {
      case 'create_expense':
        return `创建支出：${a.data.category} ¥${a.data.amount}`;
      case 'create_income':
        return `创建收入：${a.data.category} ¥${a.data.amount}`;
      case 'create_asset':
        return `创建资产：${a.data.name} ¥${a.data.value}`;
      case 'create_liability':
        return `创建负债：${a.data.name} ¥${a.data.amount}`;
      case 'query_income':
        return '查询收入记录';
      case 'query_expense':
        return '查询支出记录';
      case 'query_assets':
        return '查询资产记录';
      case 'query_liabilities':
        return '查询负债记录';
      default:
        return a.type;
    }
  }).join('；');

  return {
    reply: `好的，我为你${summary}。`,
    actions,
  };
}
