import { Router } from 'express';
import ExcelJS from 'exceljs';
import { prisma } from '../app';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router({ mergeParams: true });

const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const checkFamilyAccess = async (familyId: string, userId: string) => {
  const membership = await prisma.familyMember.findUnique({
    where: {
      familyId_userId: {
        familyId,
        userId,
      },
    },
  });
  return membership;
};

const buildDateFilter = (startDate?: string, endDate?: string) => {
  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);
  return Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {};
};

const sendWorkbook = async (
  res: any,
  workbook: ExcelJS.Workbook,
  filename: string
) => {
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', EXCEL_MIME);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(filename)}"`
  );
  res.send(Buffer.from(buffer));
};

router.get('/incomes', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const { startDate, endDate } = req.query as {
      startDate?: string;
      endDate?: string;
    };

    const incomes = await prisma.income.findMany({
      where: {
        familyId,
        ...buildDateFilter(startDate, endDate),
      },
      orderBy: { date: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('收入');
    sheet.columns = [
      { header: '日期', key: 'date', width: 14 },
      { header: '类别', key: 'category', width: 16 },
      { header: '金额', key: 'amount', width: 14 },
      { header: '描述', key: 'description', width: 30 },
      { header: '来源', key: 'source', width: 16 },
    ];

    incomes.forEach((inc) => {
      sheet.addRow({
        date: inc.date,
        category: inc.category,
        amount: Number(inc.amount),
        description: inc.description || '',
        source: inc.source || '',
      });
    });

    sheet.getRow(1).font = { bold: true };

    await sendWorkbook(res, workbook, 'incomes.xlsx');
  } catch (error) {
    console.error('导出收入 Excel 错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/expenses', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const { startDate, endDate } = req.query as {
      startDate?: string;
      endDate?: string;
    };

    const expenses = await prisma.expense.findMany({
      where: {
        familyId,
        ...buildDateFilter(startDate, endDate),
      },
      orderBy: { date: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('支出');
    sheet.columns = [
      { header: '日期', key: 'date', width: 14 },
      { header: '类别', key: 'category', width: 16 },
      { header: '金额', key: 'amount', width: 14 },
      { header: '描述', key: 'description', width: 30 },
      { header: '支付方式', key: 'paymentMethod', width: 14 },
    ];

    expenses.forEach((exp) => {
      sheet.addRow({
        date: exp.date,
        category: exp.category,
        amount: Number(exp.amount),
        description: exp.description || '',
        paymentMethod: exp.paymentMethod || '',
      });
    });

    sheet.getRow(1).font = { bold: true };

    await sendWorkbook(res, workbook, 'expenses.xlsx');
  } catch (error) {
    console.error('导出支出 Excel 错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.get('/balance-sheet', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const familyId = req.params.familyId as string;
    const membership = await checkFamilyAccess(familyId, req.userId!);
    if (!membership) {
      return res.status(403).json({ error: '无权访问该家庭' });
    }

    const [assets, liabilities] = await Promise.all([
      prisma.asset.findMany({ where: { familyId } }),
      prisma.liability.findMany({ where: { familyId } }),
    ]);

    const workbook = new ExcelJS.Workbook();

    const assetSheet = workbook.addWorksheet('资产');
    assetSheet.columns = [
      { header: '名称', key: 'name', width: 20 },
      { header: '类型', key: 'type', width: 16 },
      { header: '类别', key: 'category', width: 16 },
      { header: '价值', key: 'value', width: 14 },
      { header: '描述', key: 'description', width: 30 },
    ];
    assets.forEach((a) => {
      assetSheet.addRow({
        name: a.name,
        type: a.type,
        category: a.category || '',
        value: Number(a.value),
        description: a.description || '',
      });
    });
    assetSheet.getRow(1).font = { bold: true };

    const totalAssets = assets.reduce((sum, a) => sum + Number(a.value), 0);
    assetSheet.addRow({});
    assetSheet.addRow({ name: '总资产', value: totalAssets });

    const liabilitySheet = workbook.addWorksheet('负债');
    liabilitySheet.columns = [
      { header: '名称', key: 'name', width: 20 },
      { header: '类型', key: 'type', width: 16 },
      { header: '金额', key: 'amount', width: 14 },
      { header: '利率', key: 'interestRate', width: 10 },
      { header: '描述', key: 'description', width: 30 },
    ];
    liabilities.forEach((l) => {
      liabilitySheet.addRow({
        name: l.name,
        type: l.type,
        amount: Number(l.amount),
        interestRate: l.interestRate ? Number(l.interestRate) : '',
        description: l.description || '',
      });
    });
    liabilitySheet.getRow(1).font = { bold: true };

    const totalLiabilities = liabilities.reduce(
      (sum, l) => sum + Number(l.amount),
      0
    );
    liabilitySheet.addRow({});
    liabilitySheet.addRow({ name: '总负债', amount: totalLiabilities });

    const summarySheet = workbook.addWorksheet('汇总');
    summarySheet.columns = [{ header: '项目', key: 'item', width: 20 }, { header: '金额', key: 'value', width: 16 }];
    summarySheet.addRow({ item: '总资产', value: totalAssets });
    summarySheet.addRow({ item: '总负债', value: totalLiabilities });
    summarySheet.addRow({ item: '净资产', value: totalAssets - totalLiabilities });
    summarySheet.getRow(1).font = { bold: true };

    await sendWorkbook(res, workbook, 'balance-sheet.xlsx');
  } catch (error) {
    console.error('导出资产负债表 Excel 错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
