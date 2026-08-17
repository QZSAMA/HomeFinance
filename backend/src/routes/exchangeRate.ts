import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  getRate,
  getSupportedCurrencies,
  setManualRate,
} from '../services/exchangeRateService';

const router = Router();

// GET / - 获取支持的货币列表
router.get('/', (req, res) => {
  try {
    const currencies = getSupportedCurrencies();
    res.json({ currencies });
  } catch (error) {
    console.error('获取货币列表错误:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// GET /rate?from=USD&to=CNY - 获取汇率（优先缓存，否则请求 API）
router.get('/rate', async (req, res) => {
  try {
    const from = req.query.from as string;
    const to = req.query.to as string;

    if (!from || !from.trim()) {
      return res.status(400).json({ error: 'from 参数不能为空' });
    }
    if (!to || !to.trim()) {
      return res.status(400).json({ error: 'to 参数不能为空' });
    }

    const dateParam = req.query.date as string | undefined;
    const date = dateParam ? new Date(dateParam) : undefined;

    const rate = await getRate(from.toUpperCase(), to.toUpperCase(), date);
    return res.json({ from: from.toUpperCase(), to: to.toUpperCase(), rate });
  } catch (error) {
    console.error('获取汇率错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

// POST /manual - 手动录入汇率（需要认证）
router.post('/manual', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { from, to, rate } = req.body || {};

    if (!from || typeof from !== 'string' || !from.trim()) {
      return res.status(400).json({ error: 'from 参数不能为空' });
    }
    if (!to || typeof to !== 'string' || !to.trim()) {
      return res.status(400).json({ error: 'to 参数不能为空' });
    }
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      return res.status(400).json({ error: 'rate 必须为正数' });
    }

    await setManualRate(from.toUpperCase(), to.toUpperCase(), rate);
    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('手动录入汇率错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
});

export default router;
