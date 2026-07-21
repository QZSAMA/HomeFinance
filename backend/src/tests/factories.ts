import bcrypt from 'bcryptjs';

export const createTestUserData = (overrides: Partial<{
  id: string;
  email: string;
  passwordHash: string;
  name: string;
}> = {}) => ({
  id: 'user_test_1',
  email: 'test@example.com',
  passwordHash: bcrypt.hashSync('password123', 10),
  name: 'Test User',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createTestFamilyData = (overrides: Partial<{
  id: string;
  name: string;
  description: string;
}> = {}) => ({
  id: 'family_test_1',
  name: 'Test Family',
  description: 'A test family',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createTestFamilyMemberData = (overrides: Partial<{
  id: string;
  familyId: string;
  userId: string;
  role: string;
}> = {}) => ({
  id: 'member_test_1',
  familyId: 'family_test_1',
  userId: 'user_test_1',
  role: 'admin',
  createdAt: new Date(),
  ...overrides,
});

export const createTestIncomeData = (overrides: Partial<{
  id: string;
  familyId: string;
  createdBy: string;
  category: string;
  amount: number;
  description: string;
  date: Date;
}> = {}) => ({
  id: 'income_test_1',
  familyId: 'family_test_1',
  createdBy: 'user_test_1',
  category: '工资',
  amount: 5000,
  description: 'Monthly salary',
  date: new Date('2026-07-01'),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createTestExpenseData = (overrides: Partial<{
  id: string;
  familyId: string;
  createdBy: string;
  category: string;
  amount: number;
  description: string;
  date: Date;
}> = {}) => ({
  id: 'expense_test_1',
  familyId: 'family_test_1',
  createdBy: 'user_test_1',
  category: '餐饮',
  amount: 100,
  description: 'Lunch',
  date: new Date('2026-07-01'),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createTestFileData = (overrides: Partial<{
  id: string;
  familyId: string;
  userId: string;
  name: string;
  path: string;
  type: string;
  size: number;
  mimeType: string;
  phash: string | null;
}> = {}) => ({
  id: 'file_test_1',
  familyId: 'family_test_1',
  userId: 'user_test_1',
  name: 'receipt.jpg',
  path: 'family_test_1/receipt.jpg',
  type: 'image/jpeg',
  size: 1024,
  mimeType: 'image/jpeg',
  phash: null,
  uploadedAt: new Date(),
  ...overrides,
});

export const createTestBudgetData = (overrides: Partial<{
  id: string;
  familyId: string;
  createdBy: string;
  category: string;
  amount: number;
  period: string;
  startDate: Date;
  endDate: Date | null;
}> = {}) => ({
  id: 'budget_test_1',
  familyId: 'family_test_1',
  createdBy: 'user_test_1',
  category: '餐饮',
  amount: 5000,
  period: 'MONTHLY',
  startDate: new Date('2026-07-01'),
  endDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

export const createTestRecurringData = (overrides: Partial<{
  id: string;
  familyId: string;
  createdBy: string;
  type: string;
  category: string;
  amount: number;
  description: string | null;
  frequency: string;
  interval: number;
  nextDate: Date;
  endDate: Date | null;
  isActive: boolean;
  lastExecutedAt: Date | null;
}> = {}) => ({
  id: 'recurring_test_1',
  familyId: 'family_test_1',
  createdBy: 'user_test_1',
  type: 'INCOME',
  category: '工资',
  amount: 15000,
  description: '月度工资',
  frequency: 'MONTHLY',
  interval: 1,
  nextDate: new Date('2026-08-01'),
  endDate: null,
  isActive: true,
  lastExecutedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});
