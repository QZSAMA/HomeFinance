/**
 * 数据库集成测试 - 真实连接 PostgreSQL
 *
 * 验证 Prisma 模型与数据库 schema 的真实映射关系
 * 验证 CRUD 操作的真实数据库行为（事务、约束、级联删除等）
 *
 * 运行条件：Docker Compose 启动的 PostgreSQL 可访问
 * 测试数据库：family_finance_test（独立于开发库 family_finance）
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// 测试数据隔离：每个 test suite 使用唯一的 familyId 前缀
let testCounter = 0;
const uniqueId = () => `test_${Date.now()}_${testCounter++}`;

describe('Database Integration Tests', () => {
  let familyId: string;
  let userId: string;

  // 在所有测试前：应用 schema 到测试数据库（如果还没应用）
  beforeAll(async () => {
    // 确保连接可用
    await prisma.$connect();
  });

  // 每个测试套件前：创建独立的用户和家庭用于隔离
  beforeEach(async () => {
    const email = `${uniqueId()}@test.com`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: 'test-hash',
        name: 'TestUser',
      },
    });
    userId = user.id;

    const family = await prisma.family.create({
      data: {
        name: '测试家庭_' + uniqueId(),
        members: {
          create: { userId, role: 'admin' },
        },
      },
    });
    familyId = family.id;
  });

  // 每个测试后：级联清理（Family 删除会级联删除所有关联数据）
  afterEach(async () => {
    await prisma.family.deleteMany({ where: { id: familyId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('User & Family 基础模型', () => {
    test('应正确创建用户和家庭及成员关系', async () => {
      const member = await prisma.familyMember.findUnique({
        where: {
          familyId_userId: { familyId, userId },
        },
      });
      expect(member).toBeTruthy();
      expect(member!.role).toBe('admin');
    });

    test('familyId_userId 唯一约束应生效', async () => {
      await expect(
        prisma.familyMember.create({
          data: { familyId, userId, role: 'member' },
        })
      ).rejects.toThrow();
    });

    test('email 唯一约束应生效', async () => {
      const user = await prisma.user.findUnique({ where: { email: (await prisma.user.findUnique({ where: { id: userId } }))!.email } });
      await expect(
        prisma.user.create({
          data: { email: user!.email, passwordHash: 'x', name: 'dup' },
        })
      ).rejects.toThrow();
    });
  });

  describe('Income CRUD 真实数据库行为', () => {
    test('应成功创建收入记录并查询', async () => {
      const income = await prisma.income.create({
        data: {
          familyId,
          createdBy: userId,
          category: '工资',
          amount: 5000,
          description: '测试工资',
          date: new Date(),
        },
      });
      expect(income.id).toBeTruthy();

      const found = await prisma.income.findUnique({ where: { id: income.id } });
      expect(found!.category).toBe('工资');
      // Decimal 字段应该可以正确转换为数字
      expect(Number(found!.amount)).toBe(5000);
    });

    test('应按 familyId 过滤查询', async () => {
      await prisma.income.create({
        data: { familyId, createdBy: userId, category: '工资', amount: 1000, date: new Date() },
      });

      const list = await prisma.income.findMany({ where: { familyId } });
      expect(list.length).toBe(1);
      expect(list[0].category).toBe('工资');
    });

    test('家庭删除应级联删除收入', async () => {
      await prisma.income.create({
        data: { familyId, createdBy: userId, category: '奖金', amount: 500, date: new Date() },
      });

      await prisma.family.delete({ where: { id: familyId } });

      const remaining = await prisma.income.findMany({ where: { familyId } });
      expect(remaining.length).toBe(0);
      // 标记已清理，跳过 afterEach 的清理
      familyId = '';
    });
  });

  describe('Asset & Liability 模型', () => {
    test('应正确创建资产并按类型查询', async () => {
      await prisma.asset.create({
        data: { familyId, name: '银行存款', type: '现金', value: 100000 },
      });
      await prisma.asset.create({
        data: { familyId, name: '股票账户', type: '股票', value: 50000 },
      });

      const cashAssets = await prisma.asset.findMany({
        where: { familyId, type: '现金' },
      });
      expect(cashAssets.length).toBe(1);
      expect(Number(cashAssets[0].value)).toBe(100000);
    });

    test('应正确创建负债并计算总额', async () => {
      await prisma.liability.create({
        data: { familyId, name: '房贷', type: '房贷', amount: 500000 },
      });
      await prisma.liability.create({
        data: { familyId, name: '车贷', type: '车贷', amount: 100000 },
      });

      const liabilities = await prisma.liability.findMany({ where: { familyId } });
      const total = liabilities.reduce((s, l) => s + Number(l.amount), 0);
      expect(total).toBe(600000);
    });
  });

  describe('Budget 模型', () => {
    test('应正确创建预算记录', async () => {
      const budget = await prisma.budget.create({
        data: {
          familyId,
          category: '餐饮',
          amount: 2000,
          period: 'MONTHLY',
          startDate: new Date(),
          createdBy: userId,
        },
      });
      expect(budget.id).toBeTruthy();
      expect(budget.period).toBe('MONTHLY');
      expect(Number(budget.amount)).toBe(2000);
    });
  });

  describe('RecurringTransaction 模型', () => {
    test('应正确创建定期交易规则', async () => {
      const recurring = await prisma.recurringTransaction.create({
        data: {
          familyId,
          type: 'INCOME',
          category: '工资',
          amount: 8000,
          frequency: 'MONTHLY',
          interval: 1,
          nextDate: new Date(),
          isActive: true,
          createdBy: userId,
        },
      });
      expect(recurring.id).toBeTruthy();
      expect(recurring.frequency).toBe('MONTHLY');
      expect(recurring.isActive).toBe(true);
    });
  });

  describe('Goal 模型', () => {
    test('应正确创建财务目标', async () => {
      const goal = await prisma.goal.create({
        data: {
          familyId,
          title: '存10万',
          type: 'SAVING',
          targetAmount: 100000,
          isCompleted: false,
          createdBy: userId,
        },
      });
      expect(goal.id).toBeTruthy();
      expect(goal.type).toBe('SAVING');
      expect(Number(goal.targetAmount)).toBe(100000);
      expect(goal.isCompleted).toBe(false);
    });

    test('应支持三种目标类型', async () => {
      for (const type of ['SAVING', 'DEBT_PAYOFF', 'INVESTMENT']) {
        const goal = await prisma.goal.create({
          data: { familyId, title: `goal_${type}`, type, targetAmount: 50000, createdBy: userId },
        });
        expect(goal.type).toBe(type);
      }
      const goals = await prisma.goal.findMany({ where: { familyId } });
      expect(goals.length).toBe(3);
    });
  });

  describe('AiConversation 模型', () => {
    test('应正确创建 AI 对话记录', async () => {
      const conversation = await prisma.aiConversation.create({
        data: {
          familyId,
          userId,
          content: '帮我查看本月支出',
          response: '本月支出为 2000 元',
          type: 'CHAT',
        },
      });
      expect(conversation.id).toBeTruthy();
      expect(conversation.content).toBe('帮我查看本月支出');
    });
  });

  describe('事务与并发', () => {
    test('应支持事务回滚', async () => {
      const initialCount = await prisma.income.count({ where: { familyId } });

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.income.create({
            data: { familyId, createdBy: userId, category: '工资', amount: 1000, date: new Date() },
          });
          // 故意抛错触发回滚
          throw new Error('intentional rollback');
        })
      ).rejects.toThrow('intentional rollback');

      const finalCount = await prisma.income.count({ where: { familyId } });
      expect(finalCount).toBe(initialCount);
    });
  });

  describe('索引与查询性能', () => {
    test('应按日期范围查询收入', async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      await prisma.income.create({
        data: { familyId, createdBy: userId, category: '工资', amount: 5000, date: now },
      });

      const thisMonth = await prisma.income.findMany({
        where: {
          familyId,
          date: { gte: monthStart, lt: nextMonthStart },
        },
      });
      expect(thisMonth.length).toBe(1);
    });
  });
});
