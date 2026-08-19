import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { validateSecurityEnv } from './config/security';
import { requestIdMiddleware } from './middleware/requestId';
import { logger } from './utils/logger';

// 启动时校验安全配置（JWT_SECRET 未设置/弱默认值/长度不足时抛错退出）
validateSecurityEnv();

export const prisma = new PrismaClient();

const app = express();
const PORT = process.env.PORT || 8080;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id']
}));

// 请求追踪中间件：为每个请求分配 requestId，注入响应头
app.use(requestIdMiddleware);

// OCR 接口需要上传 base64 图片，默认 100kb 不够，提升到 10MB
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import familyRoutes from './routes/families';
import incomeRoutes from './routes/incomes';
import expenseRoutes from './routes/expenses';
import assetRoutes from './routes/assets';
import liabilityRoutes from './routes/liabilities';
import reportRoutes from './routes/reports';
import fileRoutes from './routes/files';
import aiRoutes from './routes/ai';
import budgetRoutes from './routes/budgets';
import exportRoutes from './routes/export';
import recurringRoutes from './routes/recurring';
import categoryRoutes from './routes/category';
import compareRoutes from './routes/compare';
import importRoutes from './routes/import';
import goalRoutes from './routes/goals';
import exchangeRateRoutes from './routes/exchangeRate';
import importSourceRoutes from './routes/importSources';
import marketDataRoutes from './routes/marketData';
import { ensureBucket } from './config/minio';
import { connectRedis } from './config/redis';
import { initScheduler } from './jobs/scheduler';

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/families', familyRoutes);
app.use('/api/families/:familyId/incomes', incomeRoutes);
app.use('/api/families/:familyId/expenses', expenseRoutes);
app.use('/api/families/:familyId/assets', assetRoutes);
app.use('/api/families/:familyId/liabilities', liabilityRoutes);
app.use('/api/families/:familyId/reports', reportRoutes);
app.use('/api/families/:familyId/files', fileRoutes);
app.use('/api/families/:familyId/ai', aiRoutes);
app.use('/api/families/:familyId/budgets', budgetRoutes);
app.use('/api/families/:familyId/export', exportRoutes);
app.use('/api/families/:familyId/recurring', recurringRoutes);
app.use('/api/families/:familyId/category', categoryRoutes);
app.use('/api/compare', compareRoutes);
app.use('/api/families/:familyId/import', importRoutes);
app.use('/api/families/:familyId/goals', goalRoutes);
app.use('/api/families/:familyId/import-sources', importSourceRoutes);
app.use('/api/families/:familyId/market-data', marketDataRoutes);
app.use('/api/exchange-rates', exchangeRateRoutes);

app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`, { module: 'app' });
  ensureBucket().catch((err) => logger.error('MinIO bucket 初始化失败', { module: 'app', meta: { error: String(err) } }));
  connectRedis().catch((err) => {
    logger.warn('Redis 连接失败，缓存和限流功能将降级运行', { module: 'app', meta: { error: err instanceof Error ? err.message : String(err) } });
  });
  // 初始化定时任务调度器（可通过 ENABLE_SCHEDULER=false 禁用）
  initScheduler();
});

export default app;
