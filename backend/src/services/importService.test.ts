import { parseCSV } from './importService';

const ALIPAY_CSV =
  '交易号,交易时间,交易分类,金额,交易状态\n1,2026-07-01 10:00:00,餐饮,35,交易成功';
const WECHAT_CSV =
  '交易时间,交易类型,交易对方,金额\n2026-07-01 10:00:00,微信红包,张三,200';
const CMB_CSV =
  '交易日期,交易金额,交易摘要,交易类型\n2026-07-01,-50.00,超市购物,支\n2026-07-02,5000.00,工资,收';
const ICBC_CSV =
  '交易日期,交易额,摘要,对方账户,借贷\n2026-07-01,50.00,超市购物,沃尔玛,借\n2026-07-02,5000.00,工资,公司账户,贷';
const BOC_CSV =
  '交易日期,交易金额,记账币种,摘要\n2026-07-01,50.00,CNY,超市购物\n2026-07-02,-100.00,CNY,退款';

describe('importService.parseCSV', () => {
  describe('parseAlipay', () => {
    test('正确解析支付宝 CSV（现有行为保持通过）', async () => {
      const items = await parseCSV(Buffer.from(ALIPAY_CSV), 'alipay');
      expect(items).toHaveLength(1);
      expect(items[0].date).toBe('2026-07-01');
      expect(items[0].amount).toBe(35);
      expect(items[0].type).toBe('EXPENSE');
    });
  });

  describe('parseWechat', () => {
    test('正确解析微信 CSV，红包识别为收入（现有行为保持通过）', async () => {
      const items = await parseCSV(Buffer.from(WECHAT_CSV), 'wechat');
      expect(items).toHaveLength(1);
      expect(items[0].date).toBe('2026-07-01');
      expect(items[0].amount).toBe(200);
      expect(items[0].type).toBe('INCOME');
    });
  });

  describe('parseCMB', () => {
    test('正确解析 交易日期/交易金额/交易摘要/交易类型', async () => {
      const items = await parseCSV(Buffer.from(CMB_CSV), 'cmb');
      expect(items).toHaveLength(2);
      expect(items[0].date).toBe('2026-07-01');
      expect(items[0].amount).toBe(50);
      expect(items[0].description).toBe('超市购物');
      expect(items[0].type).toBe('EXPENSE');
      expect(items[1].date).toBe('2026-07-02');
      expect(items[1].amount).toBe(5000);
      expect(items[1].description).toBe('工资');
      expect(items[1].type).toBe('INCOME');
    });

    test('交易类型=支 → type=EXPENSE', async () => {
      const csv = '交易日期,交易金额,交易摘要,交易类型\n2026-07-01,50.00,购物,支';
      const items = await parseCSV(Buffer.from(csv), 'cmb');
      expect(items[0].type).toBe('EXPENSE');
    });

    test('交易类型=收 → type=INCOME', async () => {
      const csv = '交易日期,交易金额,交易摘要,交易类型\n2026-07-01,50.00,退款,收';
      const items = await parseCSV(Buffer.from(csv), 'cmb');
      expect(items[0].type).toBe('INCOME');
    });

    test('金额负数也正确识别（CMB 可能用负数表示支出）', async () => {
      const csv = '交易日期,交易金额,交易摘要,交易类型\n2026-07-01,-50.00,购物,支';
      const items = await parseCSV(Buffer.from(csv), 'cmb');
      expect(items[0].amount).toBe(50);
      expect(items[0].type).toBe('EXPENSE');
    });
  });

  describe('parseICBC', () => {
    test('正确解析 交易日期/交易额/摘要/借贷', async () => {
      const items = await parseCSV(Buffer.from(ICBC_CSV), 'icbc');
      expect(items).toHaveLength(2);
      expect(items[0].date).toBe('2026-07-01');
      expect(items[0].amount).toBe(50);
      expect(items[0].description).toBe('超市购物');
      expect(items[0].type).toBe('EXPENSE');
      expect(items[1].date).toBe('2026-07-02');
      expect(items[1].amount).toBe(5000);
      expect(items[1].description).toBe('工资');
      expect(items[1].type).toBe('INCOME');
    });

    test('借贷=借 → type=EXPENSE', async () => {
      const csv = '交易日期,交易额,摘要,对方账户,借贷\n2026-07-01,50.00,购物,沃尔玛,借';
      const items = await parseCSV(Buffer.from(csv), 'icbc');
      expect(items[0].type).toBe('EXPENSE');
    });

    test('借贷=贷 → type=INCOME', async () => {
      const csv = '交易日期,交易额,摘要,对方账户,借贷\n2026-07-01,5000.00,工资,公司,贷';
      const items = await parseCSV(Buffer.from(csv), 'icbc');
      expect(items[0].type).toBe('INCOME');
    });
  });

  describe('parseBOC', () => {
    test('正确解析 交易日期/交易金额/摘要', async () => {
      const items = await parseCSV(Buffer.from(BOC_CSV), 'boc');
      expect(items).toHaveLength(2);
      expect(items[0].date).toBe('2026-07-01');
      expect(items[0].amount).toBe(50);
      expect(items[0].description).toBe('超市购物');
      expect(items[0].type).toBe('EXPENSE');
      expect(items[1].date).toBe('2026-07-02');
      expect(items[1].amount).toBe(100);
      expect(items[1].description).toBe('退款');
      expect(items[1].type).toBe('INCOME');
    });

    test('金额正数 → EXPENSE（默认，消费）', async () => {
      const csv = '交易日期,交易金额,记账币种,摘要\n2026-07-01,50.00,CNY,购物';
      const items = await parseCSV(Buffer.from(csv), 'boc');
      expect(items[0].type).toBe('EXPENSE');
    });

    test('金额负数 → INCOME（退款/退货）', async () => {
      const csv = '交易日期,交易金额,记账币种,摘要\n2026-07-01,-100.00,CNY,退款';
      const items = await parseCSV(Buffer.from(csv), 'boc');
      expect(items[0].type).toBe('INCOME');
      expect(items[0].amount).toBe(100);
    });
  });

  describe('parseCSV 错误处理', () => {
    test('不支持格式时抛错', async () => {
      await expect(parseCSV(Buffer.from('a,b\n1,2'), 'unknown')).rejects.toThrow(/不支持的格式/);
    });
  });

  describe('日期格式兼容', () => {
    test('兼容 2026-07-01 和 2026/07/01', async () => {
      const csv =
        '交易日期,交易金额,交易摘要,交易类型\n2026/07/01,-50.00,购物,支\n2026-07-02,50.00,购物,支';
      const items = await parseCSV(Buffer.from(csv), 'cmb');
      expect(items[0].date).toBe('2026-07-01');
      expect(items[1].date).toBe('2026-07-02');
    });
  });
});
