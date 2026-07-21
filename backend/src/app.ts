import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

const app = express();
const PORT = process.env.PORT || 8080;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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
import { ensureBucket } from './config/minio';

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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  ensureBucket().catch(console.error);
});

export default app;
