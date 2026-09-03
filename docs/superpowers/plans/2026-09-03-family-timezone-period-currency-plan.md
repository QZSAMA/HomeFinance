# 家庭时区与财务期间语义实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个家庭在创建时固定 IANA 时区（默认 `Asia/Shanghai`），并让报表、预算、对比、目标和前端展示共享可验证的期间、币种与 reconciliation 语义。

**Architecture:** 先建立无副作用的 `timezoneService`、`periodWindowService`、`currencySummaryService` 和 `reconciliation` 纯边界，再由授权后的路由取得家庭上下文并调用这些服务。`Family.timezone` 通过 additive Prisma migration、非空约束和数据库触发器实现创建后不可变；目标进度只读取显式 `GoalContribution`，不再从家庭全局净值推导。

**Tech Stack:** TypeScript 5.6、Express 4、Prisma 5/PostgreSQL、Zod、Jest/ts-jest、React 19/Vite、Vitest、Playwright、现有 `familyAccess` policy、Decimal 数据库字段和 Redis cache version。

## Global Constraints

- `familyId` 是租户边界；每个 family-scoped read/write 必须在 cache、数据库、对象存储或 AI 之前验证 membership。
- `viewer` 对所有 mutation 只读；不可删除或降级最终 family administrator。
- 家庭创建时 `timezone` 默认 `Asia/Shanghai`，创建后不可修改；既有家庭迁移回填上海，不重新解释已保存时间戳。
- 所有期间以家庭 timezone 解释，内部和 API 查询使用半开区间 `[startUtc, endUtc)`，查询谓词只能使用 `gte(startUtc)` 与 `lt(endUtc)`。
- 混合币种没有完整可靠汇率时只能返回 `totalsByCurrency`，`totalInBaseCurrency` 必须为 `null`，不能直接相加或用零填充未知值。
- `netIncome = income - expense`；cash flow、balance sheet、dashboard 使用一致的估值与 as-of 规则。
- Goal progress 只按显式 `GoalContribution` 计算；同一来源事实不可归属多个目标。
- Transaction-generating operations 必须原子且幂等；拒绝路径必须证明无持久化、缓存或外部副作用。
- 每个行为变更先写聚焦 failing test，运行 RED 后写最小 GREEN，再做回归；不得削弱既有断言。
- Prisma migration 只做 additive expand/backfill/constraint；失败采用前向修复或恢复备份，不运行 destructive down migration。
- 当前 Graphify runner 仅 AST-only；本轮不运行它覆盖已审核语义图，代码/文档完成后记录 semantic refresh pending。

## 文件地图

| 单元 | 文件 | 职责 |
|---|---|---|
| 时区值对象 | `backend/src/services/timezoneService.ts` | 默认值、IANA 校验和规范化；不访问数据库 |
| 时区持久化 | `backend/prisma/schema.prisma`、`backend/prisma/migrations/20260903100000_add_family_timezone/migration.sql` | Family 字段、旧数据回填、数据库不可变触发器 |
| 家庭 API | `backend/src/routes/families.ts`、`backend/src/routes/families.test.ts`、`backend/src/tests/familyTimezone.integration.test.ts` | 创建时区、列表/详情返回、PUT 拒绝 |
| 期间窗口 | `backend/src/services/periodWindowService.ts` | 本地 date-only/月份/季度/年度转换到 UTC 半开区间 |
| 币种和对账 | `backend/src/services/currencySummaryService.ts`、`backend/src/utils/reconciliation.ts` | Decimal 汇总、缺失 FX 状态和三表恒等式 |
| 报表族 | `backend/src/routes/reports.ts`、`budgets.ts`、`compare.ts`、`goals.ts` | 授权后消费共享服务；不在路由内复制日期/币种算法 |
| 目标贡献 | `backend/prisma/schema.prisma`、`backend/src/services/goalContributionService.ts`、`backend/src/routes/goals.ts` | 显式来源、幂等、目标隔离和进度 |
| 前端契约 | `frontend/src/types/index.ts`、`frontend/src/services/familyService.ts`、`reportService.ts`、`budgetService.ts`、`compareService.ts`、`goalService.ts` | 类型、请求和响应状态 |
| 前端界面 | `frontend/src/pages/FamiliesPage.tsx`、`ReportsPage.tsx`、`IncomeStatementPage.tsx`、`CashFlowPage.tsx`、`BudgetPage.tsx`、`ComparePage.tsx`、`GoalsPage.tsx` | 时区选择、只读展示和 unavailable 状态 |
| 证据 | `docs/delivery/phase-1/phase-1-tracker.md`、`docs/delivery/phase-1/evidence/P1-F-01.md`、`P1-F-02.md`、`P1-F-03.md`、`P1-F-04.md`、`P1-F-05.md` | 状态、命令、结果、风险和回滚证据 |

---

### Task 1: 建立 IANA 时区值对象

**Files:**
- Create: `backend/src/services/timezoneService.test.ts`
- Create: `backend/src/services/timezoneService.ts`
- Modify: `backend/src/services/ledgerErrors.ts:1-18`

**Interfaces:**
- Produces `DEFAULT_FAMILY_TIMEZONE`, `normalizeFamilyTimezone(value: unknown): string`, `isSupportedFamilyTimezone(value: unknown): boolean`。
- `normalizeFamilyTimezone` 仅对字段省略（`undefined`）使用默认值；显式 `null` 或空字符串无效。对 `UTC` 和可被 `Intl.DateTimeFormat` 解析的 IANA 值返回规范标识；其他输入抛 `DomainError('INVALID_TIMEZONE', 'Invalid IANA timezone.', 400)`。

- [x] **Step 1: Write the failing test**

```ts
import { DomainError } from './ledgerErrors';
import {
  DEFAULT_FAMILY_TIMEZONE,
  isSupportedFamilyTimezone,
  normalizeFamilyTimezone,
} from './timezoneService';

test('defaults an omitted timezone to Asia/Shanghai', () => {
  expect(normalizeFamilyTimezone(undefined)).toBe(DEFAULT_FAMILY_TIMEZONE);
});

test('canonicalizes UTC and accepts a non-default IANA zone', () => {
  expect(normalizeFamilyTimezone(' UTC ')).toBe('UTC');
  expect(normalizeFamilyTimezone('America/New_York')).toBe('America/New_York');
  expect(isSupportedFamilyTimezone('America/New_York')).toBe(true);
});

test('rejects abbreviations, offsets and unknown zones', () => {
  for (const value of ['CST', '+08:00', 'not/a-zone', '', null]) {
    expect(() => normalizeFamilyTimezone(value)).toThrow(DomainError);
  }
});

test('does not depend on the process local timezone', () => {
  expect(normalizeFamilyTimezone('Asia/Shanghai')).toBe('Asia/Shanghai');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend; npm test -- --runInBand src/services/timezoneService.test.ts`

Expected: FAIL because `timezoneService.ts` and the new error codes do not exist.

- [x] **Step 3: Write minimal implementation**

Add the new codes to `DomainErrorCode`, then implement the value object without a third-party date dependency:

```ts
export const DEFAULT_FAMILY_TIMEZONE = 'Asia/Shanghai';

export const normalizeFamilyTimezone = (value: unknown): string => {
  if (value === undefined) return DEFAULT_FAMILY_TIMEZONE;
  if (typeof value !== 'string') throw new DomainError('INVALID_TIMEZONE', 'Invalid IANA timezone.', 400);
  const candidate = value.trim();
  if (candidate === 'UTC') return 'UTC';
  if (!candidate.includes('/')) throw new DomainError('INVALID_TIMEZONE', 'Invalid IANA timezone.', 400);
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: candidate })
      .resolvedOptions().timeZone;
    if (!resolved) throw new Error('missing canonical timezone');
    return resolved;
  } catch {
    throw new DomainError('INVALID_TIMEZONE', 'Invalid IANA timezone.', 400);
  }
};

export const isSupportedFamilyTimezone = (value: unknown): boolean => {
  try { normalizeFamilyTimezone(value); return true; } catch { return false; }
};
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd backend; npm test -- --runInBand src/services/timezoneService.test.ts`

Expected: PASS with all timezone cases green.

- [x] **Step 5: Commit**

```bash
git add backend/src/services/timezoneService.ts backend/src/services/timezoneService.test.ts backend/src/services/ledgerErrors.ts
git commit -m "feat: add family timezone value object"
```

### Task 2: Persist Family timezone and enforce immutable creation-time API

**Files:**
- Modify: `backend/prisma/schema.prisma:30-53`
- Create: `backend/prisma/migrations/20260903100000_add_family_timezone/migration.sql`
- Modify: `backend/src/routes/families.ts:12-181`
- Modify: `backend/src/routes/families.test.ts`
- Create: `backend/src/tests/familyTimezone.integration.test.ts`

**Interfaces:**
- POST accepts `{ name: string, description?: string, timezone?: string }` and persists `normalizeFamilyTimezone`.
- GET list/detail return scalar `timezone`.
- PUT returns HTTP 409 `{ error, code: 'FAMILY_TIMEZONE_IMMUTABLE' }` whenever the request owns a `timezone` property, before any update call.

- [x] **Step 1: Write the failing test**

Add characterization tests before production changes:

```ts
test('creates Shanghai by default and returns an explicit timezone', async () => {
  mockedPrisma.family.create.mockResolvedValue({
    id: 'fam_1', name: 'New Family', timezone: 'Asia/Shanghai', members: [],
  });
  const response = await request(app).post('/api/families')
    .set('Authorization', `Bearer ${createToken()}`).send({ name: 'New Family' });
  expect(response.status).toBe(201);
  expect(mockedPrisma.family.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ timezone: 'Asia/Shanghai' }),
  }));
});

test('rejects an attempted timezone update with zero side effects', async () => {
  mockedPrisma.familyMember.findUnique.mockResolvedValue({ familyId: 'fam_1', userId: 'user_1', role: 'admin' });
  const response = await request(app).put('/api/families/fam_1')
    .set('Authorization', `Bearer ${createToken()}`)
    .send({ name: 'Renamed', description: 'x', timezone: 'UTC' });
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('FAMILY_TIMEZONE_IMMUTABLE');
  expect(mockedPrisma.family.update).not.toHaveBeenCalled();
});
```

The integration test creates a disposable family, confirms the migration default, executes `UPDATE "Family" SET timezone = 'UTC'`, and asserts PostgreSQL rejects it without changing the row.

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend; npm test -- --runInBand src/routes/families.test.ts src/tests/familyTimezone.integration.test.ts`

Expected: mocked POST does not pass `timezone`, PUT silently strips the field, and the integration test cannot find the column/trigger.

- [x] **Step 3: Write minimal implementation**

Add the Prisma field and an additive migration:

```sql
ALTER TABLE "Family" ADD COLUMN "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE "Family" ADD CONSTRAINT "Family_timezone_nonblank" CHECK (length(trim("timezone")) > 0);
CREATE OR REPLACE FUNCTION prevent_family_timezone_update() RETURNS trigger AS $$
BEGIN
  IF NEW."timezone" IS DISTINCT FROM OLD."timezone" THEN
    RAISE EXCEPTION 'FAMILY_TIMEZONE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Family_timezone_immutable"
  BEFORE UPDATE OF "timezone" ON "Family"
  FOR EACH ROW EXECUTE FUNCTION prevent_family_timezone_update();
```

In `families.ts`, normalize the POST value and check `Object.prototype.hasOwnProperty.call(req.body, 'timezone')` before PUT schema parsing. Preserve the existing `{ error }` field and add `code`; map `INVALID_TIMEZONE` to 400 and immutable attempts to 409. Keep creation open to any authenticated user, with the creator as the first admin.

- [x] **Step 4: Run test to verify it passes**

Run: `cd backend; npx prisma validate; npx prisma format --check; npm test -- --runInBand src/routes/families.test.ts src/tests/familyTimezone.integration.test.ts`

Expected: focused mocks PASS; integration PASS when `RUN_INTEGRATION=1` and PostgreSQL is available, otherwise record BLOCKED without claiming real evidence.

- [x] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/routes/families.ts backend/src/routes/families.test.ts backend/src/tests/familyTimezone.integration.test.ts
git commit -m "feat: persist immutable family timezone"
```

### Task 3: Implement the shared PeriodWindow service

**Files:**
- Create: `backend/src/services/periodWindowService.ts`
- Create: `backend/src/services/periodWindowService.test.ts`
- Modify: `backend/src/services/ledgerErrors.ts:1-18`

**Interfaces:**

```ts
export type PeriodKind = 'CUSTOM' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
type PlainDate = { year: number; month: number; day: number };
export interface PeriodWindowInput {
  timezone: string;
  kind: PeriodKind;
  referenceInstant?: Date;
  localStart?: string;          // YYYY-MM-DD, inclusive
  localEndExclusive?: string;   // YYYY-MM-DD, exclusive
}
export interface PeriodWindow {
  timezone: string;
  startUtc: Date;
  endUtc: Date;
  startLocal: string;
  endLocalExclusive: string;
}
export const resolvePeriodWindow: (input: PeriodWindowInput) => PeriodWindow;
```

- [x] **Step 1: Write the failing test**

```ts
test('resolves a Shanghai month to a UTC half-open window', () => {
  const window = resolvePeriodWindow({ timezone: 'Asia/Shanghai', kind: 'MONTHLY', referenceInstant: new Date('2026-09-15T00:00:00Z') });
  expect(window.startLocal).toBe('2026-09-01');
  expect(window.endLocalExclusive).toBe('2026-10-01');
  expect(window.startUtc.toISOString()).toBe('2026-08-31T16:00:00.000Z');
  expect(window.endUtc.toISOString()).toBe('2026-09-30T16:00:00.000Z');
});

test.each([
  ['America/New_York', '2026-03-08', '2026-03-09', 23],
  ['America/New_York', '2026-11-01', '2026-11-02', 25],
])('handles DST without assuming 24 hours', (timezone, localStart, localEndExclusive, hours) => {
  const window = resolvePeriodWindow({ timezone, kind: 'CUSTOM', localStart, localEndExclusive });
  expect((window.endUtc.getTime() - window.startUtc.getTime()) / 3_600_000).toBe(hours);
});

test('rejects an invalid date and keeps end exclusive', () => {
  expect(() => resolvePeriodWindow({ timezone: 'Asia/Shanghai', kind: 'CUSTOM', localStart: '2026-02-30', localEndExclusive: '2026-03-01' })).toThrow('INVALID_PERIOD_WINDOW');
  const window = resolvePeriodWindow({ timezone: 'Asia/Shanghai', kind: 'CUSTOM', localStart: '2026-08-01', localEndExclusive: '2026-08-31' });
  expect(window.endLocalExclusive).toBe('2026-08-31');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend; npm test -- --runInBand src/services/periodWindowService.test.ts`

Expected: FAIL because the service and `INVALID_PERIOD_WINDOW` do not exist.

- [x] **Step 3: Write minimal implementation**

Implement strict `YYYY-MM-DD` parsing, local calendar arithmetic for month/quarter/year, and a single `Intl.DateTimeFormat` adapter for local-midnight → UTC conversion. The adapter must choose the earlier valid instant for an ambiguous midnight and the first valid instant after a DST gap; it must never read `process.env.TZ` or call `new Date('YYYY-MM-DD')`:

```ts
const localMidnightToUtc = (localDate: PlainDate, timezone: string): Date => {
  let candidate = Date.UTC(localDate.year, localDate.month - 1, localDate.day);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const parts = formatter(timezone).formatToParts(new Date(candidate));
    const observed = partsToPlainDateTime(parts);
    const offset = candidate - plainDateTimeAsUtc(observed);
    const next = plainDateTimeAsUtc(localDate) + offset;
    if (sameLocalMidnight(formatter(timezone), next, localDate)) return new Date(next);
    candidate = next;
  }
  return firstValidInstantAfterGap(localDate, timezone, candidate);
};

if (endLocalExclusive <= startLocal) {
  throw new DomainError('INVALID_PERIOD_WINDOW', 'Invalid period window.', 400);
}
```

`formatter`, `partsToPlainDateTime`, `plainDateTimeAsUtc`, `sameLocalMidnight` and `firstValidInstantAfterGap` are private helpers in this file; all exported results use the `PeriodWindow` interface above.

- [x] **Step 4: Run test to verify it passes**

Run: `cd backend; npm test -- --runInBand src/services/periodWindowService.test.ts`

Expected: PASS for month, quarter, year, leap-year, Shanghai and DST cases.

- [x] **Step 5: Commit**

```bash
git add backend/src/services/periodWindowService.ts backend/src/services/periodWindowService.test.ts backend/src/services/ledgerErrors.ts
git commit -m "feat: centralize family period windows"
```

### Task 4: Add currency summaries and reconciliation formulas

**Files:**
- Create: `backend/src/services/currencySummaryService.ts`
- Create: `backend/src/services/currencySummaryService.test.ts`
- Create: `backend/src/utils/reconciliation.ts`
- Create: `backend/src/utils/reconciliation.test.ts`

**Interfaces:**

```ts
export type ConversionStatus = 'exact' | 'unavailable' | 'partial';
import { Decimal } from '@prisma/client/runtime/library';
export interface CurrencySummary {
  baseCurrency: string;
  totalsByCurrency: Record<string, number>;
  totalInBaseCurrency: number | null;
  conversionStatus: ConversionStatus;
}
export const summarizeByCurrency: (
  rows: ReadonlyArray<{ amount: number | string | Decimal; currency: string }>,
  baseCurrency: string,
  rates?: Readonly<Record<string, number>>,
) => CurrencySummary;
export const reconcileIncome = (income: number, expense: number, netIncome: number): boolean;
export const reconcileCashFlow = (classes: ReadonlyArray<{ net: number }>, netCashFlow: number): boolean;
export const reconcileBalanceSheet = (assets: number, liabilities: number, netWorth: number): boolean;
export const reconcilePerCurrency: (income: CurrencySummary, expense: CurrencySummary) => Record<string, number>;
```

- [x] **Step 1: Write the failing test**

```ts
test('groups mixed currencies and refuses a fake base total', () => {
  expect(summarizeByCurrency([{ amount: '10.00', currency: 'CNY' }, { amount: '2.00', currency: 'USD' }], 'CNY')).toEqual({
    baseCurrency: 'CNY', totalsByCurrency: { CNY: 10, USD: 2 }, totalInBaseCurrency: null, conversionStatus: 'unavailable',
  });
});

test('returns an exact base total for base-only rows', () => {
  expect(summarizeByCurrency([{ amount: '10.10', currency: 'CNY' }], 'CNY').totalInBaseCurrency).toBe(10.1);
});

test('keeps all reconciliation identities explicit', () => {
  expect(reconcileIncome(100, 40, 60)).toBe(true);
  expect(reconcileCashFlow([{ net: 10 }, { net: -3 }, { net: 2 }], 9)).toBe(true);
  expect(reconcileBalanceSheet(150, 90, 60)).toBe(true);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd backend; npm test -- --runInBand src/services/currencySummaryService.test.ts src/utils/reconciliation.test.ts`

Expected: FAIL because no summaries/formulas exist.

- [x] **Step 3: Write minimal implementation**

Normalize currencies to uppercase three-letter codes, sum with Decimal-safe decimal arithmetic, round only at response serialization, and return `null` whenever any non-base currency lacks a complete rate:

```ts
const totalsByCurrency: Record<string, Decimal> = {};
for (const row of rows) {
  const currency = normalizeCurrency(row.currency);
  totalsByCurrency[currency] = (totalsByCurrency[currency] ?? new Decimal(0)).plus(row.amount);
}
const currencies = Object.keys(totalsByCurrency);
const complete = currencies.every((currency) => currency === baseCurrency || rates?.[currency] !== undefined);
return {
  baseCurrency,
  totalsByCurrency: serializeCents(totalsByCurrency),
  totalInBaseCurrency: complete ? convertAll(totalsByCurrency, baseCurrency, rates) : null,
  conversionStatus: complete ? 'exact' : (currencies.some((currency) => rates?.[currency] !== undefined) ? 'partial' : 'unavailable'),
};
```

Do not expose a “known subtotal” as `totalInBaseCurrency`. Reconciliation helpers compare rounded cents and return booleans; route code maps false to `RECONCILIATION_FAILED` rather than zero.

`normalizeCurrency`, `serializeCents` and `convertAll` remain private helpers in `currencySummaryService.ts`; `convertAll` is called only when every non-base currency has a positive, finite rate for the same valuation instant.

- [x] **Step 4: Run test to verify it passes**

Run: `cd backend; npm test -- --runInBand src/services/currencySummaryService.test.ts src/utils/reconciliation.test.ts`

Expected: PASS for empty, zero, negative net, mixed, partial-rate and invalid-currency cases.

- [x] **Step 5: Commit**

```bash
git add backend/src/services/currencySummaryService.ts backend/src/services/currencySummaryService.test.ts backend/src/utils/reconciliation.ts backend/src/utils/reconciliation.test.ts backend/src/services/ledgerErrors.ts
git commit -m "feat: add conservative currency and reconciliation services"
```

### Task 5: Migrate reports to family windows, currency summaries and reconciliation

**Files:**
- Modify: `backend/src/routes/reports.ts`
- Modify: `backend/src/routes/reports.test.ts`
- Create: `backend/src/tests/reports.periodCurrency.integration.test.ts`

**Interfaces:**
- Every report route loads membership first, then selects `{ timezone, baseCurrency }` and calls the shared services.
- `GET /reports/income-statement` and `/cash-flow` accept date-only `startDate` and `endDate`; the UI’s selected end day is converted to the next local date before request, so backend `endDate` is exclusive.
- Balance sheet and dashboard include current `valuationAsOf`, `valuationRuleVersion`, currency summary and reconciliation status.

- [ ] **Step 1: Write the failing test**

Add a route fixture with a transaction exactly at the next local midnight and assert it is excluded; add CNY + USD assets and assert `totalAssets`/`netWorth` are `null` with `conversionStatus=unavailable`; add a cash-flow fixture covering all four classes and assert reconciliation.

```ts
expect(response.body.window).toMatchObject({ startLocal: '2026-08-01', endLocalExclusive: '2026-09-01', timezone: 'Asia/Shanghai' });
expect(response.body.totalIncome).toBeNull();
expect(response.body.totalsByCurrency).toEqual({ CNY: 100, USD: 20 });
expect(response.body.reconciliationStatus).toBe('passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend; npm test -- --runInBand src/routes/reports.test.ts src/tests/reports.periodCurrency.integration.test.ts`

Expected: FAIL because current code uses server-local dates, `lte`, and direct cross-currency reduction.

- [ ] **Step 3: Write minimal implementation**

Replace route-local date construction with `resolvePeriodWindow`; use `gte/lt`; aggregate each entity by currency; compute category/net values per currency; attach `window`, `timezone`, `baseCurrency`, summaries and `reconciliationStatus`:

```ts
const family = await prisma.family.findUniqueOrThrow({
  where: { id: familyId }, select: { timezone: true, baseCurrency: true },
});
const window = resolvePeriodWindow({
  timezone: family.timezone, kind: 'CUSTOM',
  localStart: query.startDate, localEndExclusive: query.endDate,
});
const [incomes, expenses] = await prisma.$transaction([
  prisma.income.findMany({ where: { familyId, date: { gte: window.startUtc, lt: window.endUtc } } }),
  prisma.expense.findMany({ where: { familyId, date: { gte: window.startUtc, lt: window.endUtc } } }),
]);
const incomeSummary = summarizeByCurrency(incomes.map((row) => ({ amount: row.amount, currency: row.currency })), family.baseCurrency);
const expenseSummary = summarizeByCurrency(expenses.map((row) => ({ amount: row.amount, currency: row.currency })), family.baseCurrency);
const netIncome = reconcilePerCurrency(incomeSummary, expenseSummary);
return { ...serializeReport(netIncome), window, timezone: family.timezone, baseCurrency: family.baseCurrency, reconciliationStatus: 'passed' };
```

Preserve raw transaction lists and legacy scalar fields only when exact; otherwise set the scalar to `null`. Keep cache middleware after family authorization and include window/base-currency dimensions in the cache key.

`serializeReport` and `reconcilePerCurrency` are the private response adapters in `reports.ts`; `reconcilePerCurrency` is the pure helper exported by Task 4 and `serializeReport` maps its per-currency result to the existing endpoint field names without summing currencies.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend; npm test -- --runInBand src/routes/reports.test.ts src/tests/reports.periodCurrency.integration.test.ts`

Expected: focused route tests PASS; run `npm run build` before commit.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/reports.ts backend/src/routes/reports.test.ts backend/src/tests/reports.periodCurrency.integration.test.ts
git commit -m "feat: use family timezone and currency-safe reports"
```

### Task 6: Migrate budgets and compare to shared period/currency contracts

**Files:**
- Modify: `backend/src/routes/budgets.ts`
- Modify: `backend/src/routes/budgets.test.ts`
- Modify: `backend/src/routes/compare.ts`
- Modify: `backend/src/routes/compare.test.ts`
- Create: `backend/src/tests/budgetCompare.periodCurrency.integration.test.ts`
- Modify: `backend/prisma/schema.prisma:195-211`
- Create: `backend/prisma/migrations/20260903100100_add_budget_currency/migration.sql`

**Interfaces:**
- Budget create/update accepts optional `currency`, defaults to the family base currency; progress only compares expenses in the budget currency and exposes all matched `totalsByCurrency`.
- Budget progress resolves `MONTHLY/QUARTERLY/YEARLY` with `resolvePeriodWindow`, bounded by explicit start/end, and uses `lt(endUtc)`.
- Compare accepts `month=YYYY-MM` (required by the new contract); every family uses that local month in its own timezone and returns its own `window`, currency summary and nullable scalar totals.

- [ ] **Step 1: Write the failing test**

```ts
test('counts only the current family-local budget window', async () => {
  // create expenses on 2026-08-31T16:00Z and 2026-09-30T16:00Z for an Asia/Shanghai family
  const result = await request(app).get(`/api/families/${familyId}/budgets/progress`)
    .set('Authorization', `Bearer ${token}`);
  expect(result.body[0].spent).toBe(100); // end-midnight row is excluded
  expect(result.body[0].window.endLocalExclusive).toBe('2026-10-01');
});

test('does not mix family currencies in compare', async () => {
  const result = await request(compareApp).get('/api/compare/summary?month=2026-09')
    .set('Authorization', `Bearer ${token}`);
  expect(result.body[0].conversionStatus).toBe('unavailable');
  expect(result.body[0].netWorth).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend; npm test -- --runInBand src/routes/budgets.test.ts src/routes/compare.test.ts src/tests/budgetCompare.periodCurrency.integration.test.ts`

Expected: FAIL because period currently does not constrain progress consistently and compare adds all currencies.

- [ ] **Step 3: Write minimal implementation**

Load family context through centralized `requireFamilyAccess` (remove route-local copies only where this slice touches them), resolve each period once, use bounded aggregate/groupBy queries rather than N+1 full-table loads, and pass rows to `summarizeByCurrency`:

```ts
const family = await prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { timezone: true, baseCurrency: true } });
const window = resolvePeriodWindow({ timezone: family.timezone, kind: budget.period as PeriodKind, referenceInstant: now, localStart: toLocalDate(budget.startDate), localEndExclusive: budget.endDate ? toLocalDate(budget.endDate) : undefined });
const grouped = await prisma.expense.groupBy({ by: ['currency'], where: { familyId, category: budget.category, date: { gte: window.startUtc, lt: window.endUtc } }, _sum: { amount: true } });
const spent = summarizeByCurrency(grouped.map((row) => ({ amount: row._sum.amount ?? 0, currency: row.currency })), family.baseCurrency);
return { budget, spent: spent.totalInBaseCurrency, totalsByCurrency: spent.totalsByCurrency, window, conversionStatus: spent.conversionStatus };
```

For compare, validate `month` as `YYYY-MM`, capture one reference instant, and return per-family windows; never use browser/server local month construction.

`toLocalDate` is a private helper that formats a stored instant with the family timezone as `YYYY-MM-DD`; `now` is one `new Date()` captured at the start of the progress request and passed to every budget window.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend; npm test -- --runInBand src/routes/budgets.test.ts src/routes/compare.test.ts src/tests/budgetCompare.periodCurrency.integration.test.ts; npm run build`

Expected: focused regression and backend build PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/budgets.ts backend/src/routes/budgets.test.ts backend/src/routes/compare.ts backend/src/routes/compare.test.ts backend/src/tests/budgetCompare.periodCurrency.integration.test.ts backend/prisma
git commit -m "feat: align budget and compare periods"
```

### Task 7: Add explicit GoalContribution persistence and isolated progress

**Files:**
- Modify: `backend/prisma/schema.prisma:298-313`
- Create: `backend/prisma/migrations/20260903100200_add_goal_contributions/migration.sql`
- Create: `backend/src/services/goalContributionService.ts`
- Create: `backend/src/services/goalContributionService.test.ts`
- Modify: `backend/src/routes/goals.ts`
- Modify: `backend/src/routes/goals.test.ts`
- Create: `backend/src/tests/goalContribution.integration.test.ts`

**Interfaces:**

```ts
export type GoalSourceType = 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY' | 'MANUAL';
export interface CreateGoalContributionCommand {
  familyId: string; actorUserId: string; goalId: string;
  sourceType: GoalSourceType; sourceId?: string;
  amount: number; currency: string; contributionDate: Date;
  allocationKey: string; idempotencyKey: string;
}
export interface GoalContributionResult {
  id: string; goalId: string; amount: number; currency: string;
  contributionDate: Date; sourceType: GoalSourceType; sourceId: string | null;
  deduplicated: boolean;
}
export const createGoalContribution: (command: CreateGoalContributionCommand) => Promise<GoalContributionResult>;
```

`GoalContribution` stores `familyId`, `goalId`, `sourceType`, nullable `sourceId` for `MANUAL`, `amount`, `currency`, `contributionDate`, `allocationKey`, `sourceKey`, `createdBy`, timestamps; unique `(familyId, allocationKey)` and `(familyId, sourceKey)` prevent replay and double attribution. Polymorphic source ownership is validated in the transaction because Prisma cannot express a cross-table foreign key.

The private helpers used below are defined in `goalContributionService.ts`: `assertWritableMembership`, `assertSourceBelongsToFamily`, `claimIdempotency`, `recordMutationAuditAndResult` and `toResult`; each receives the transaction client and never performs work outside that transaction.

- [ ] **Step 1: Write the failing test**

```ts
test('keeps two goals isolated and rejects the same source twice', async () => {
  const first = await createGoalContribution({ ...baseCommand, goalId: 'goal-a', sourceType: 'INCOME', sourceId: 'income-1' });
  expect(first.amount).toBe(100);
  await expect(createGoalContribution({ ...baseCommand, goalId: 'goal-b' })).rejects.toMatchObject({ code: 'GOAL_CONTRIBUTION_CONFLICT' });
});

test('viewer, cross-family source and invalid currency have zero writes', async () => {
  // route-level assertions spy on goalContribution.create and source lookups
  expect(response.status).toBe(403);
  expect(mockedPrisma.goalContribution.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend; npm test -- --runInBand src/services/goalContributionService.test.ts src/routes/goals.test.ts src/tests/goalContribution.integration.test.ts`

Expected: FAIL because progress currently reads global assets/liabilities and no contribution table/service exists.

- [ ] **Step 3: Write minimal implementation**

Add `Goal.currency` with a CNY/family-base backfill and the additive contribution table/checks. Implement a transaction that authorizes membership before idempotency/source lookup, validates same-family goal/source, claims the scoped idempotency key, inserts one contribution, writes audit/replay metadata, and maps a source-key race to `GOAL_CONTRIBUTION_CONFLICT` (409):

```ts
const sourceKey = command.sourceType === 'MANUAL'
  ? `MANUAL:${command.allocationKey}`
  : `${command.sourceType}:${command.sourceId}`;
return prisma.$transaction(async (tx) => {
  await assertWritableMembership(tx, command.familyId, command.actorUserId);
  const goal = await tx.goal.findFirst({ where: { id: command.goalId, familyId: command.familyId } });
  await assertSourceBelongsToFamily(tx, command.familyId, command.sourceType, command.sourceId);
  const replay = await claimIdempotency(tx, command.familyId, command.actorUserId, command.idempotencyKey, command);
  if (replay) return { ...replay, deduplicated: true };
  const contribution = await tx.goalContribution.create({ data: { ...command, sourceKey } });
  await recordMutationAuditAndResult(tx, command, contribution.id);
  return { ...toResult(contribution), deduplicated: false };
});
```

Add `POST /:goalId/contributions` and update `/progress` to aggregate only that goal’s contributions; no contribution means `currentAmount: null`, `percentage: null`, `progressStatus: 'unavailable'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend; npm test -- --runInBand src/services/goalContributionService.test.ts src/routes/goals.test.ts src/tests/goalContribution.integration.test.ts; npm run build`

Expected: focused service/route tests and build PASS. With PostgreSQL available, run the integration suite and verify concurrent same-source submissions leave one contribution.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma backend/src/services/goalContributionService.ts backend/src/services/goalContributionService.test.ts backend/src/routes/goals.ts backend/src/routes/goals.test.ts backend/src/tests/goalContribution.integration.test.ts
git commit -m "feat: isolate goal progress by contribution"
```

### Task 8: Add frontend family timezone creation and read-only display

**Files:**
- Modify: `frontend/src/types/index.ts:17-24`
- Modify: `frontend/src/services/familyService.ts:14-22`
- Modify: `frontend/src/pages/FamiliesPage.tsx`
- Create/modify: `frontend/src/pages/FamiliesPage.test.tsx`

**Interfaces:**

```ts
export interface Family { /* existing fields */ timezone: string; baseCurrency?: string; }
export const createFamily = (name: string, description?: string, timezone?: string): Promise<Family>;
```

- [ ] **Step 1: Write the failing test**

```tsx
test('defaults the create form to Shanghai and submits a selected IANA timezone', async () => {
  render(<FamiliesPage />);
  fireEvent.click(screen.getByRole('button', { name: /创建家庭/ }));
  expect(screen.getByLabelText(/时区/)).toHaveValue('Asia/Shanghai');
  fireEvent.change(screen.getByLabelText(/时区/), { target: { value: 'America/New_York' } });
  fireEvent.change(screen.getByLabelText(/家庭名称/), { target: { value: 'Test' } });
  fireEvent.click(screen.getByRole('button', { name: /^创建$/ }));
  await waitFor(() => expect(createFamily).toHaveBeenCalledWith('Test', '', 'America/New_York'));
});

test('shows an existing family timezone without an edit control', async () => {
  render(<FamiliesPage />);
  expect(await screen.findByText('Asia/Shanghai')).toBeVisible();
  expect(screen.queryByRole('button', { name: /修改时区/ })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm test -- --runInBand src/pages/FamiliesPage.test.tsx`

Expected: FAIL because Family has no timezone type, service does not send it, and the form has no field.

- [ ] **Step 3: Write minimal implementation**

Use a controlled `<input list>` or searchable select built from `Intl.supportedValuesOf('timeZone')` plus `UTC`/`Asia/Shanghai`; keep a fallback list and allow a typed IANA candidate for browsers without the API:

```tsx
const timezoneOptions = typeof Intl.supportedValuesOf === 'function'
  ? Array.from(new Set(['Asia/Shanghai', 'UTC', ...Intl.supportedValuesOf('timeZone')])).sort()
  : ['Asia/Shanghai', 'UTC', 'America/New_York', 'Europe/London'];
<label htmlFor="family-timezone">时区</label>
<input id="family-timezone" list="family-timezones" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
<datalist id="family-timezones">{timezoneOptions.map((zone) => <option key={zone} value={zone} />)}</datalist>
```

Reset the field to Shanghai after successful creation. Render the returned family timezone as read-only text in cards/details. Surface `INVALID_TIMEZONE` from the configured API client; do not add a PUT control.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend; npm test -- --runInBand src/pages/FamiliesPage.test.tsx; npm run lint; npm run build`

Expected: focused test, lint with zero warning lines, and build PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/familyService.ts frontend/src/pages/FamiliesPage.tsx frontend/src/pages/FamiliesPage.test.tsx
git commit -m "feat: configure family timezone at creation"
```

### Task 9: Update report, budget, compare and goal UI contracts

**Files:**
- Modify: `frontend/src/services/reportService.ts`
- Modify: `frontend/src/services/budgetService.ts`
- Modify: `frontend/src/services/compareService.ts`
- Modify: `frontend/src/services/goalService.ts`
- Modify: `frontend/src/pages/ReportsPage.tsx`, `IncomeStatementPage.tsx`, `CashFlowPage.tsx`, `BudgetPage.tsx`, `ComparePage.tsx`, `GoalsPage.tsx`
- Modify: `frontend/src/pages/ReportsPage.test.tsx`
- Modify: `frontend/src/pages/FinancialReportPages.test.tsx`
- Create: `frontend/src/pages/GoalsPage.test.tsx`
- Create: `frontend/src/pages/BudgetPage.test.tsx`
- Create: `frontend/src/pages/ComparePage.test.tsx`

**Interfaces:**
- Add shared frontend `MoneySummary`, `PeriodWindow`, `ConversionStatus` and `ReconciliationStatus` types.
- Date inputs remain date-only; when the user selects an inclusive end day, client date arithmetic sends the next local calendar date as exclusive `endDate` without `Date.parse`/UTC subtraction.
- `null` scalar totals render `—` plus the reason from `conversionStatus`; no `|| 0` fallback for financial values.

- [ ] **Step 1: Write the failing test**

```tsx
test('renders unavailable mixed-currency totals instead of zero', async () => {
  vi.mocked(reportService.getIncomeStatement).mockResolvedValueOnce({
    totalIncome: null, totalExpense: null, netIncome: null,
    totalsByCurrency: { CNY: 100, USD: 20 }, conversionStatus: 'unavailable',
    incomeByCategory: {}, expenseByCategory: {}, incomes: [], expenses: [], startDate: null, endDate: null,
  });
  render(<IncomeStatementPage />);
  expect(await screen.findByText(/暂无法合计/)).toBeVisible();
  expect(screen.queryByText('¥0.00')).toBeNull();
});

test('sends the next local date for an inclusive end-date control', async () => {
  vi.mocked(reportService.getCashFlow).mockResolvedValueOnce({
    operating: { income: 0, expense: 0, net: 0 }, investing: { income: 0, expense: 0, net: 0 },
    financing: { income: 0, expense: 0, net: 0 }, other: { income: 0, expense: 0, net: 0 },
    netCashFlow: 0, startDate: null, endDate: null,
  });
  render(<CashFlowPage />);
  fireEvent.change(screen.getByLabelText(/结束日期/), { target: { value: '2026-08-31' } });
  fireEvent.click(screen.getByRole('button', { name: /查询/ }));
  await waitFor(() => expect(reportService.getCashFlow).toHaveBeenCalledWith('family-1', undefined, '2026-09-01'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm test -- --runInBand src/pages/ReportsPage.test.tsx src/pages/FinancialReportPages.test.tsx src/pages/GoalsPage.test.tsx src/pages/BudgetPage.test.tsx src/pages/ComparePage.test.tsx`

Expected: FAIL because existing pages format null as CNY zero and pass the selected end date directly.

- [ ] **Step 3: Write minimal implementation**

Update service interfaces, use the configured Axios API client consistently, and centralize safe formatting:

```ts
const formatAggregate = (amount: number | null, currency: string, status: ConversionStatus) =>
  amount === null
    ? `暂无法合计（${status === 'partial' ? '部分汇率缺失' : '缺少可靠汇率'}）`
    : new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(amount);
const formatWindow = (window: PeriodWindow) => `${window.startLocal} – ${window.endLocalExclusive}（${window.timezone}）`;
```

Add period/timezone labels, render grouped currency rows, suppress mixed-currency aggregate charts, and show reconciliation failure as an alert/status region. Goal cards show contribution-based progress or “尚未建立贡献关联”; budget cards show their currency and bounded window; compare cards show each family’s local month/window.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend; npm test -- --runInBand src/pages/ReportsPage.test.tsx src/pages/FinancialReportPages.test.tsx src/pages/GoalsPage.test.tsx src/pages/BudgetPage.test.tsx src/pages/ComparePage.test.tsx; npm run lint; npm run build`

Expected: focused tests, lint and build PASS; existing assertions remain intact.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services frontend/src/pages
git commit -m "feat: show timezone and safe financial totals"
```

### Task 10: Full regression, PostgreSQL evidence and project records

**Files:**
- Create: `backend/src/tests/reports.periodCurrency.integration.test.ts`
- Create: `backend/src/tests/budgetCompare.periodCurrency.integration.test.ts`
- Create: `backend/src/tests/goalContribution.integration.test.ts`
- Create: `backend/src/tests/familyTimezone.integration.test.ts`
- Modify: `docs/delivery/phase-1/phase-1-tracker.md`
- Create/modify: `docs/delivery/phase-1/evidence/P1-F-01.md` through `P1-F-05.md`
- Modify: `docs/project-memory.md`
- Modify: `docs/audit/2026-08-27-homefinance-integrated-remediation-plan.md` only for evidence links/status

- [ ] **Step 1: Write the failing quality-gate checklist**

Record the expected commands and current baseline before rerunning:

```text
backend: npm run build
backend: npm test -- --runInBand --coverage
backend: npm run test:integration       # only when PostgreSQL is available
backend: npx prisma validate
backend: npx prisma format --check
frontend: npm run lint
frontend: npm test
frontend: npm run build
frontend: npm run test:e2e               # Docker-capable host only
```

The RED evidence must name the first failing assertion for each P1-F task; an unavailable Docker/PostgreSQL environment is recorded as BLOCKED, never converted to PASS.

- [ ] **Step 2: Run focused and full gates**

Run the commands above from their respective directories. For PostgreSQL, apply the new migrations to both an existing test schema and a disposable fresh schema; verify the immutable trigger, goal contribution unique keys, DST fixtures, viewer/non-member denial, replay/concurrency and rollback. For frontend E2E, reuse the existing Compose harness and record Docker absence if still unavailable.

- [ ] **Step 3: Refactor only after green**

Use database `aggregate/groupBy` for bounded report/budget/compare reads, remove duplicate route-local date/currency helpers touched by this work, verify cache keys include family/window/base currency, and run all focused suites again. Do not change the approved response semantics to make a test pass.

- [ ] **Step 4: Update evidence and memory**

For each P1-F evidence card, record commit, exact command, suite/test counts, PASS-MOCK/PASS-REAL/BLOCKED status, migration name, authorization negative cases, rollback path and unresolved external gates. Update the phase tracker from `BACKLOG` to the observed lifecycle state; update `docs/project-memory.md` with implementation facts only after tests run. Do not claim Graphify semantic refresh while the AST-only runner remains the only available tool.

- [ ] **Step 5: Commit the evidence bundle**

```bash
git add docs/delivery/phase-1 docs/project-memory.md docs/audit/2026-08-27-homefinance-integrated-remediation-plan.md
git commit -m "test: record family timezone and financial semantics evidence"
```

## Self-review checklist

- Spec coverage: Tasks 1–2 cover default/explicit/invalid/immutable timezone and migration; Task 3 covers family-local half-open windows and DST; Task 4 covers currency and identities; Tasks 5–7 cover reports, budgets, compare and goal isolation; Tasks 8–9 cover API/UI contracts; Task 10 covers required quality gates, evidence, rollback and memory.
- Placeholder scan: no unresolved placeholders or unspecified error-handling steps are present; every task names concrete files, commands, expected outcomes and commit messages.
- Type consistency: `normalizeFamilyTimezone`, `resolvePeriodWindow`, `summarizeByCurrency`, `MoneySummary`, `PeriodWindow`, `GoalSourceType` and all response status names are reused consistently by later tasks.
- Scope: all changes are within the approved P1-F design. FX providers, mutable timezone migration, allocation groups, recurring multi-timezone catch-up, offline conflict resolution and infrastructure release observation remain explicitly out of scope.
