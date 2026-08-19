import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import reportRoutes from './reports';

jest.mock('../app', () => ({
  prisma: {
    familyMember: {
      findUnique: jest.fn(),
    },
    asset: {
      findMany: jest.fn(),
    },
    liability: {
      findMany: jest.fn(),
    },
    income: {
      findMany: jest.fn(),
    },
    expense: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../middleware/cache', () => ({
  cacheMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

import { prisma } from '../app';

const mockedPrisma = prisma as any;

const app = express();
app.use(express.json());
app.use('/api/families/:familyId/reports', reportRoutes);

function createToken(userId: string = 'user_1') {
  return jwt.sign(
    { userId, email: 'test@example.com', name: 'Test User' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
}

describe('Report Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.familyMember.findUnique.mockResolvedValue({
      familyId: 'fam_1',
      userId: 'user_1',
      role: 'admin',
    });
    mockedPrisma.asset.findMany.mockResolvedValue([]);
    mockedPrisma.liability.findMany.mockResolvedValue([]);
    mockedPrisma.income.findMany.mockResolvedValue([]);
    mockedPrisma.expense.findMany.mockResolvedValue([]);
  });

  describe('GET /api/families/:familyId/reports/balance-sheet', () => {
    test('returns balance sheet with assets and liabilities', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', type: '现金', value: 10000, description: 'Cash', createdAt: new Date() },
        { id: 'a2', type: '股票', value: 50000, description: 'Stocks', createdAt: new Date() },
      ]);
      mockedPrisma.liability.findMany.mockResolvedValue([
        { id: 'l1', type: '信用卡', amount: 3000, description: 'CC', createdAt: new Date() },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/balance-sheet')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.totalAssets).toBe(60000);
      expect(res.body.totalLiabilities).toBe(3000);
      expect(res.body.netWorth).toBe(57000);
      expect(Object.keys(res.body.assets).length).toBe(2);
      expect(res.body.assetList).toHaveLength(2);
    });
  });

  describe('GET /api/families/:familyId/reports/income-statement', () => {
    test('returns income statement for current month', async () => {
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '工资', amount: 10000, description: 'Salary', date: new Date(), createdAt: new Date() },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([
        { id: 'e1', category: '餐饮', amount: 2000, description: 'Food', date: new Date(), createdAt: new Date() },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/income-statement')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.totalIncome).toBe(10000);
      expect(res.body.totalExpense).toBe(2000);
      expect(res.body.netIncome).toBe(8000);
      expect(Object.keys(res.body.incomeByCategory).length).toBe(1);
      expect(Object.keys(res.body.expenseByCategory).length).toBe(1);
      expect(res.body.incomes).toHaveLength(1);
    });
  });

  describe('GET /api/families/:familyId/reports/cash-flow', () => {
    test('returns cash flow data', async () => {
      const today = new Date();
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '工资', amount: 5000, date: today, createdAt: today },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([
        { id: 'e1', category: '餐饮', amount: 1000, date: today, createdAt: today },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/cash-flow')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.operating.income).toBe(5000);
      expect(res.body.operating.expense).toBe(1000);
      expect(res.body.operating.net).toBe(4000);
      expect(res.body.netCashFlow).toBe(4000);
    });
  });

  describe('GET /api/families/:familyId/reports/summary', () => {
    test('returns financial summary', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', type: '现金', value: 10000, createdAt: new Date() },
      ]);
      mockedPrisma.liability.findMany.mockResolvedValue([]);
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '工资', amount: 8000, date: new Date(), createdAt: new Date() },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([
        { id: 'e1', category: '餐饮', amount: 3000, date: new Date(), createdAt: new Date() },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/summary')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.balanceSheet.totalAssets).toBe(10000);
      expect(res.body.balanceSheet.totalLiabilities).toBe(0);
      expect(res.body.incomeStatement.thisMonthIncome).toBe(8000);
      expect(res.body.incomeStatement.thisMonthExpense).toBe(3000);
    });

    test('investmentAllocation is array of {category, value, percentage} for chart contract', async () => {
      // 资产包含 STOCK 和 CASH 两类，验证 investmentAllocation 结构满足 AssetAllocationChart 契约
      mockedPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', type: 'STOCK', value: 60000, createdAt: new Date() },
        { id: 'a2', type: 'CASH', value: 40000, createdAt: new Date() },
      ]);
      mockedPrisma.liability.findMany.mockResolvedValue([]);
      mockedPrisma.income.findMany.mockResolvedValue([]);
      mockedPrisma.expense.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/summary')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      const allocation = res.body.investmentAllocation;
      expect(Array.isArray(allocation)).toBe(true);
      expect(allocation.length).toBe(5); // STOCK, BOND, GOLD, CASH, OTHER
      allocation.forEach((item: any) => {
        expect(typeof item.category).toBe('string');
        expect(typeof item.value).toBe('number');
        expect(typeof item.percentage).toBe('number');
      });
      const stock = allocation.find((a: any) => a.category === 'STOCK');
      expect(stock.value).toBe(60000);
      expect(stock.percentage).toBe(60);
      const cash = allocation.find((a: any) => a.category === 'CASH');
      expect(cash.value).toBe(40000);
      expect(cash.percentage).toBe(40);
    });

    test('incomeStatement contains thisMonth and lastMonth numbers for IncomeExpenseChart', async () => {
      // 验证 summary.incomeStatement 包含本月与上月收支对比数据
      mockedPrisma.asset.findMany.mockResolvedValue([]);
      mockedPrisma.liability.findMany.mockResolvedValue([]);
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '工资', amount: 8000, date: new Date(), createdAt: new Date() },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([
        { id: 'e1', category: '餐饮', amount: 3000, date: new Date(), createdAt: new Date() },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/summary')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      const is = res.body.incomeStatement;
      ['thisMonthIncome', 'lastMonthIncome', 'thisMonthExpense', 'lastMonthExpense', 'incomeChange', 'expenseChange', 'netIncome'].forEach((key) => {
        expect(typeof is[key]).toBe('number');
      });
    });
  });

  describe('Chart contract: GET /api/families/:familyId/reports/balance-sheet', () => {
    test('assets and liabilities are Record<string, number> for chart consumption', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', type: 'STOCK', value: 50000, createdAt: new Date() },
        { id: 'a2', type: 'CASH', value: 30000, createdAt: new Date() },
      ]);
      mockedPrisma.liability.findMany.mockResolvedValue([
        { id: 'l1', type: 'MORTGAGE', amount: 200000, createdAt: new Date() },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/balance-sheet')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.totalAssets).toBe('number');
      expect(typeof res.body.totalLiabilities).toBe('number');
      expect(typeof res.body.netWorth).toBe('number');
      Object.entries(res.body.assets).forEach(([, v]) => {
        expect(typeof v).toBe('number');
      });
      Object.entries(res.body.liabilities).forEach(([, v]) => {
        expect(typeof v).toBe('number');
      });
    });

    test('有 marketPrice 的资产用市价 * 数量计算价值', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        {
          id: 'a1',
          type: 'STOCK',
          value: 1000, // 旧 value，应被忽略
          symbol: 'sh600519',
          quantity: 100,
          marketPrice: 50,
          marketPriceDate: new Date('2026-08-19T10:00:00Z'),
        },
        {
          id: 'a2',
          type: 'CASH',
          value: 5000,
          symbol: null,
          quantity: null,
          marketPrice: null,
          marketPriceDate: null,
        },
      ]);
      mockedPrisma.liability.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/balance-sheet')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      // STOCK: marketPrice(50) * quantity(100) = 5000
      // CASH: value 5000
      expect(res.body.totalAssets).toBe(10000);
      expect(res.body.assets.STOCK).toBe(5000);
      expect(res.body.assets.CASH).toBe(5000);
    });

    test('marketPrice 为 null 时回退用 value', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        {
          id: 'a1',
          type: 'STOCK',
          value: 3000,
          symbol: 'sh600519',
          quantity: 100,
          marketPrice: null,
          marketPriceDate: null,
        },
      ]);
      mockedPrisma.liability.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/balance-sheet')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.totalAssets).toBe(3000);
    });

    test('响应包含 valuationDate 字段（取最新 marketPriceDate）', async () => {
      const latestDate = new Date('2026-08-19T10:00:00Z');
      mockedPrisma.asset.findMany.mockResolvedValue([
        {
          id: 'a1',
          type: 'STOCK',
          value: 0,
          symbol: 'sh600519',
          quantity: 100,
          marketPrice: 50,
          marketPriceDate: latestDate,
        },
        {
          id: 'a2',
          type: 'STOCK',
          value: 0,
          symbol: 'sh000001',
          quantity: 200,
          marketPrice: 30,
          marketPriceDate: new Date('2026-08-18T10:00:00Z'),
        },
      ]);
      mockedPrisma.liability.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/balance-sheet')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.valuationDate).toBeDefined();
      expect(new Date(res.body.valuationDate).toISOString()).toBe(latestDate.toISOString());
    });

    test('无 marketPrice 资产时 valuationDate 为 null（向下兼容）', async () => {
      mockedPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', type: 'CASH', value: 5000, symbol: null, quantity: null, marketPrice: null, marketPriceDate: null },
      ]);
      mockedPrisma.liability.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/balance-sheet')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.valuationDate).toBeNull();
    });
  });

  describe('Chart contract: GET /api/families/:familyId/reports/income-statement', () => {
    test('incomeByCategory and expenseByCategory are Record<string, number>', async () => {
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '工资', amount: 10000, date: new Date(), createdAt: new Date() },
        { id: 'i2', category: '奖金', amount: 5000, date: new Date(), createdAt: new Date() },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([
        { id: 'e1', category: '餐饮', amount: 2000, date: new Date(), createdAt: new Date() },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/income-statement')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.incomeByCategory['工资']).toBe(10000);
      expect(res.body.incomeByCategory['奖金']).toBe(5000);
      expect(res.body.expenseByCategory['餐饮']).toBe(2000);
      Object.entries(res.body.incomeByCategory).forEach(([, v]) => {
        expect(typeof v).toBe('number');
      });
    });
  });

  describe('Chart contract: GET /api/families/:familyId/reports/cash-flow', () => {
    test('operating, investing, financing each have income/expense/net numbers', async () => {
      const today = new Date();
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '工资', amount: 5000, date: today, createdAt: today },
        { id: 'i2', category: '投资', amount: 1000, date: today, createdAt: today },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([
        { id: 'e1', category: '餐饮', amount: 1000, date: today, createdAt: today },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/cash-flow')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      ['operating', 'investing', 'financing'].forEach((key) => {
        expect(res.body[key]).toBeDefined();
        expect(typeof res.body[key].income).toBe('number');
        expect(typeof res.body[key].expense).toBe('number');
        expect(typeof res.body[key].net).toBe('number');
      });
      expect(typeof res.body.netCashFlow).toBe('number');
    });
  });

  describe('V3.3.3 cash-flow 使用 incomeType 字段分类投资收益', () => {
    test('incomeType=DIVIDEND 的收入计入投资现金流（即使 category 非"投资"）', async () => {
      const today = new Date();
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '工资', amount: 5000, incomeType: 'SALARY', date: today, createdAt: today },
        // category="其他" 但 incomeType=DIVIDEND → 应计入投资
        { id: 'i2', category: '其他', amount: 100, incomeType: 'DIVIDEND', date: today, createdAt: today },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/cash-flow')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.operating.income).toBe(5000);
      expect(res.body.investing.income).toBe(100);
    });

    test('incomeType=INTEREST/RENT/INVESTMENT 也计入投资现金流', async () => {
      const today = new Date();
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '其他', amount: 50, incomeType: 'INTEREST', date: today, createdAt: today },
        { id: 'i2', category: '其他', amount: 200, incomeType: 'RENT', date: today, createdAt: today },
        { id: 'i3', category: '其他', amount: 80, incomeType: 'INVESTMENT', date: today, createdAt: today },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/cash-flow')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.investing.income).toBe(330); // 50 + 200 + 80
    });

    test('向下兼容：无 incomeType 时仍按 category 字符串匹配识别投资收益', async () => {
      const today = new Date();
      mockedPrisma.income.findMany.mockResolvedValue([
        // 无 incomeType，按 category="投资" 字符串匹配
        { id: 'i1', category: '投资', amount: 1000, incomeType: null, date: today, createdAt: today },
        { id: 'i2', category: '股息', amount: 500, incomeType: null, date: today, createdAt: today },
        { id: 'i3', category: '利息', amount: 200, incomeType: null, date: today, createdAt: today },
        { id: 'i4', category: '理财收益', amount: 300, incomeType: null, date: today, createdAt: today },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/cash-flow')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.investing.income).toBe(2000); // 1000 + 500 + 200 + 300
    });

    test('incomeType=SALARY 不计入投资现金流', async () => {
      const today = new Date();
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '其他', amount: 300, incomeType: 'SALARY', date: today, createdAt: today },
      ]);
      mockedPrisma.expense.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/cash-flow')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.investing.income).toBe(0);
    });
  });

  describe('V3.3.3 GET /api/families/:familyId/reports/investment-income', () => {
    test('按 incomeType 分组返回投资收益', async () => {
      const today = new Date();
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '股息', amount: 100, incomeType: 'DIVIDEND', assetId: 'a1', date: today, createdAt: today },
        { id: 'i2', category: '利息', amount: 50, incomeType: 'INTEREST', assetId: 'a2', date: today, createdAt: today },
        { id: 'i3', category: '工资', amount: 5000, incomeType: 'SALARY', assetId: null, date: today, createdAt: today },
        // 无 incomeType 但 category 含"投资"，向下兼容计入
        { id: 'i4', category: '投资', amount: 200, incomeType: null, assetId: null, date: today, createdAt: today },
      ]);
      mockedPrisma.asset.findMany.mockResolvedValue([
        { id: 'a1', name: '贵州茅台' },
        { id: 'a2', name: '国债' },
      ]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/investment-income')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(350); // 100 + 50 + 200 (排除 SALARY 5000)
      expect(res.body.byType.DIVIDEND).toBe(100);
      expect(res.body.byType.INTEREST).toBe(50);
      expect(res.body.byType.INVESTMENT).toBe(200); // 向下兼容的归类
      expect(res.body.byType.SALARY).toBeUndefined();
      expect(Array.isArray(res.body.byAsset)).toBe(true);
      expect(res.body.byAsset).toHaveLength(2);
      const a1 = res.body.byAsset.find((x: any) => x.assetId === 'a1');
      expect(a1.name).toBe('贵州茅台');
      expect(a1.total).toBe(100);
      const a2 = res.body.byAsset.find((x: any) => x.assetId === 'a2');
      expect(a2.name).toBe('国债');
      expect(a2.total).toBe(50);
    });

    test('无关联资产的收益不出现在 byAsset 中', async () => {
      const today = new Date();
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '股息', amount: 100, incomeType: 'DIVIDEND', assetId: null, date: today, createdAt: today },
      ]);
      mockedPrisma.asset.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/investment-income')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(100);
      expect(res.body.byType.DIVIDEND).toBe(100);
      expect(res.body.byAsset).toHaveLength(0);
    });

    test('无投资收益时返回空结构', async () => {
      mockedPrisma.income.findMany.mockResolvedValue([
        { id: 'i1', category: '工资', amount: 5000, incomeType: 'SALARY', assetId: null, date: new Date(), createdAt: new Date() },
      ]);
      mockedPrisma.asset.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/families/fam_1/reports/investment-income')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.byType).toEqual({});
      expect(res.body.byAsset).toEqual([]);
    });

    test('未认证返回 401', async () => {
      const res = await request(app)
        .get('/api/families/fam_1/reports/investment-income');

      expect(res.status).toBe(401);
    });

    test('非家庭成员返回 403', async () => {
      mockedPrisma.familyMember.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/families/fam_1/reports/investment-income')
        .set('Authorization', `Bearer ${createToken()}`);

      expect(res.status).toBe(403);
    });
  });
});
