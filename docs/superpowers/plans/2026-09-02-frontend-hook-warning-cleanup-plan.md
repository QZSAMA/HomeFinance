# Frontend Hook Warning Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Remove the 16 existing frontend lint warnings by stabilizing reusable data loaders and declaring complete `useEffect` dependencies, while preserving current UI/API behavior.

**Architecture:** Keep page-local loaders and service boundaries unchanged. Use `useCallback` only for loaders reused by effects and event handlers; pass report filter values explicitly so callbacks do not close over stale date state. Effects depend on the stable callback, while family or tab changes remain the explicit reload triggers.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, React Testing Library, oxlint, Vite.

## Global Constraints

- Do not change backend routes, API contracts, permission policy, financial calculations, or cache behavior.
- Do not suppress `react-hooks/exhaustive-deps` or `no-unused-vars` warnings.
- Preserve configured API services; do not add direct HTTP calls where a service already exists.
- Every behavior change starts with a focused failing test and keeps existing frontend tests green.
- Keep the bundle-size warning as a separate P1-G-06 item; this plan does not add route-level code splitting.
- Preserve the two existing untracked Graphify files and do not claim a semantic Graphify refresh.

## File Map

- Modify page/component files under `frontend/src/pages/` and `frontend/src/components/` to stabilize loaders.
- Create `frontend/src/pages/FinancialReportPages.test.tsx` for report filter/reset characterization tests.
- Create or extend focused component tests only where a loader is reused by a user action or family switch.
- Update `docs/delivery/phase-1/evidence/P1-G-06.md`, `docs/delivery/phase-1/phase-1-tracker.md`, and `docs/project-memory.md` with the measured warning result after implementation.

### Task 1: Fix report filter callbacks and stale reset state

**Files:**
- Create: `frontend/src/pages/FinancialReportPages.test.tsx`
- Modify: `frontend/src/pages/IncomeStatementPage.tsx`
- Modify: `frontend/src/pages/CashFlowPage.tsx`

**Interfaces:**
- `IncomeStatementPage` keeps using its existing `fetch` request shape; its loader becomes `loadData(requestedStart?: string, requestedEnd?: string): Promise<void>`.
- `CashFlowPage` keeps using `getCashFlow(familyId, startDate?, endDate?)`; its loader gets the same explicit filter parameters.

- [ ] **Step 1: Write the failing tests**

Add a shared family fixture and service/fetch mocks. The reset assertions must fail against the current implementation because `setStartDate('')` and `setEndDate('')` are asynchronous while `loadData()` still reads the previous state.

```tsx
it('resets the income statement query without sending stale dates', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => incomeStatement });
  render(<IncomeStatementPage />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/families/family-1/reports/income-statement'));
  fetchMock.mockClear();

  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-08-01' } });
  fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-08-31' } });
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    '/api/families/family-1/reports/income-statement?startDate=2026-08-01&endDate=2026-08-31',
  ));

  fetchMock.mockClear();
  fireEvent.click(screen.getByRole('button', { name: '重置' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/families/family-1/reports/income-statement'));
});

it('resets the cash flow query without sending stale dates', async () => {
  getCashFlowMock.mockResolvedValue(cashFlowData);
  render(<CashFlowPage />);
  await waitFor(() => expect(getCashFlowMock).toHaveBeenCalledWith('family-1', undefined, undefined));
  getCashFlowMock.mockClear();

  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-08-01' } });
  fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-08-31' } });
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  await waitFor(() => expect(getCashFlowMock).toHaveBeenCalledWith('family-1', '2026-08-01', '2026-08-31'));

  getCashFlowMock.mockClear();
  fireEvent.click(screen.getByRole('button', { name: '重置' }));
  await waitFor(() => expect(getCashFlowMock).toHaveBeenCalledWith('family-1', undefined, undefined));
});
```

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `npm test -- --run src/pages/FinancialReportPages.test.tsx`

Expected: FAIL on the reset assertions with the previous date values still present.

- [ ] **Step 3: Implement the minimal callback contract**

In both pages, derive `familyId` from `currentFamily?.id`, import `useCallback`, and make the loader accept explicit dates:

```tsx
const familyId = currentFamily?.id;
const loadData = useCallback(async (requestedStart = '', requestedEnd = '') => {
  if (!familyId) return;
  setLoading(true);
  try {
    const result = await getCashFlow(
      familyId,
      requestedStart || undefined,
      requestedEnd || undefined,
    );
    setData(result);
  } finally {
    setLoading(false);
  }
}, [familyId]);

useEffect(() => {
  void loadData();
}, [loadData]);

const handleFilter = () => { void loadData(startDate, endDate); };
const handleReset = () => {
  setStartDate('');
  setEndDate('');
  void loadData('', '');
};
```

Keep each page's existing catch/logging behavior around the service call. For `IncomeStatementPage`, build the URL from `requestedStart` and `requestedEnd` instead of component state.

- [ ] **Step 4: Run the focused tests to verify GREEN**

Run: `npm test -- --run src/pages/FinancialReportPages.test.tsx`

Expected: PASS, including unfiltered reset calls.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/FinancialReportPages.test.tsx frontend/src/pages/IncomeStatementPage.tsx frontend/src/pages/CashFlowPage.tsx
git commit -m "fix: stabilize financial report loaders"
```

### Task 2: Stabilize family-scoped read loaders

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/pages/InvestmentPage.tsx`
- Modify: `frontend/src/pages/BalanceSheetPage.tsx`
- Modify: `frontend/src/pages/AIPage.tsx`
- Modify: `frontend/src/pages/FilesPage.tsx`
- Test: `frontend/src/pages/ReportsPage.test.tsx` (existing family-switch characterization)

**Interfaces:**
- Keep each existing loader name and service call shape. `DashboardPage.loadSummary`, `InvestmentPage.loadData`, `BalanceSheetPage.loadData`, `AIPage.loadHistory`, and `FilesPage.loadData` become stable callbacks with dependencies limited to `familyId` and stable setters.

- [ ] **Step 1: Run the warning gate to verify RED**

Run: `npx oxlint --deny-warnings src/pages/DashboardPage.tsx src/pages/InvestmentPage.tsx src/pages/BalanceSheetPage.tsx src/pages/AIPage.tsx src/pages/FilesPage.tsx`

Expected: FAIL with the current `react-hooks/exhaustive-deps` warnings.

- [ ] **Step 2: Add a representative family-switch assertion**

Extend the existing report test style for one family-scoped loader, asserting an initial request for family 1 and exactly one new request after switching to family 2. Keep service mocks at the API boundary; do not assert implementation details.

- [ ] **Step 3: Apply stable callback dependencies**

Use this pattern for a loader reused by a retry button:

```tsx
const familyId = currentFamily?.id;
const loadSummary = useCallback(async () => {
  if (!familyId) return;
  setLoading(true);
  setError('');
  try {
    const data = await getSummary(familyId);
    setSummary(data);
  } catch (err) {
    setError('加载数据失败');
    console.error(err);
  } finally {
    setLoading(false);
  }
}, [familyId]);

useEffect(() => {
  void loadSummary();
}, [loadSummary]);
```

Apply the same dependency rule to `loadHistory` and file/report loaders. For loaders that are only used by the effect, inline the async body inside the effect instead of creating a callback solely to satisfy lint.

- [ ] **Step 4: Run focused tests and lint**

Run: `npm test -- --run src/pages/ReportsPage.test.tsx src/pages/AIPage.test.tsx`

Expected: PASS.

Run: `npx oxlint --deny-warnings src/pages/DashboardPage.tsx src/pages/InvestmentPage.tsx src/pages/BalanceSheetPage.tsx src/pages/AIPage.tsx src/pages/FilesPage.tsx`

Expected: PASS with no warning output.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx frontend/src/pages/InvestmentPage.tsx frontend/src/pages/BalanceSheetPage.tsx frontend/src/pages/AIPage.tsx frontend/src/pages/FilesPage.tsx frontend/src/pages/ReportsPage.test.tsx
git commit -m "fix: stabilize family-scoped page loaders"
```

### Task 3: Stabilize CRUD and recurring loaders

**Files:**
- Modify: `frontend/src/pages/TransactionsPage.tsx`
- Modify: `frontend/src/pages/AssetsPage.tsx`
- Modify: `frontend/src/pages/LiabilitiesPage.tsx`
- Modify: `frontend/src/pages/RecurringPage.tsx`
- Modify: `frontend/src/pages/BudgetPage.tsx`
- Modify: `frontend/src/pages/GoalsPage.tsx`
- Test: existing `frontend/src/pages/RecurringPage.test.tsx` plus focused service mocks already used by these pages

**Interfaces:**
- Keep `loadData`, `loadAssets`, `loadLiabilities`, `loadProgress`, and `load` callable from existing submit/delete/retry handlers.
- Preserve active-tab reload behavior in `TransactionsPage` by depending on both `familyId` and `activeTab`.

- [ ] **Step 1: Run the warning gate to verify RED**

Run: `npx oxlint --deny-warnings src/pages/TransactionsPage.tsx src/pages/AssetsPage.tsx src/pages/LiabilitiesPage.tsx src/pages/RecurringPage.tsx src/pages/BudgetPage.tsx src/pages/GoalsPage.tsx`

Expected: FAIL with the current missing-dependency warnings.

- [ ] **Step 2: Apply the callback pattern**

For a loader that depends on a tab, use explicit primitive dependencies:

```tsx
const familyId = currentFamily?.id;
const loadData = useCallback(async () => {
  if (!familyId) return;
  setLoading(true);
  try {
    if (activeTab === 'income') {
      setIncomes(await getIncomes(familyId));
    } else {
      setExpenses(await getExpenses(familyId));
    }
  } catch (err) {
    setError('加载数据失败');
    console.error(err);
  } finally {
    setLoading(false);
  }
}, [familyId, activeTab]);

useEffect(() => {
  void loadData();
}, [loadData]);
```

For pages without a tab, depend on `familyId` only. Use functional state updates where a loader is called after mutations and the current list may otherwise be captured unnecessarily.

- [ ] **Step 3: Remove the unused catch binding**

In `TransactionsPage.tsx`, change the silent category-suggestion catch from `catch (err)` to `catch` while keeping the existing comment and no-op behavior.

- [ ] **Step 4: Run focused tests and lint**

Run: `npm test -- --run src/pages/RecurringPage.test.tsx src/pages/ImportPage.test.tsx src/pages/AIPage.test.tsx`

Expected: PASS.

Run the same `npx oxlint --deny-warnings` command from Step 1.

Expected: PASS with no warning output.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/TransactionsPage.tsx frontend/src/pages/AssetsPage.tsx frontend/src/pages/LiabilitiesPage.tsx frontend/src/pages/RecurringPage.tsx frontend/src/pages/BudgetPage.tsx frontend/src/pages/GoalsPage.tsx frontend/src/pages/RecurringPage.test.tsx
git commit -m "fix: stabilize CRUD page loaders"
```

### Task 4: Stabilize family list loaders

**Files:**
- Modify: `frontend/src/components/FamilySelector.tsx`
- Modify: `frontend/src/pages/FamiliesPage.tsx`
- Test: `frontend/src/components/FamilySelector.test.tsx` (create if absent)

**Interfaces:**
- `FamilySelector` still loads families on mount and selects the first family only when no current family exists.
- `FamiliesPage.loadFamilies` remains reusable after member removal and updates both local and shared family stores.

- [ ] **Step 1: Run the warning gate to verify RED**

Run: `npx oxlint --deny-warnings src/components/FamilySelector.tsx src/pages/FamiliesPage.tsx`

Expected: FAIL with the two missing-dependency warnings.

- [ ] **Step 2: Add the mount characterization test**

Mock `getFamilies`, render `FamilySelector` with an empty family store, and assert one request plus first-family selection. Re-render without changing the store and assert no second request.

- [ ] **Step 3: Implement stable loading without reload-on-selection**

In `FamilySelector`, keep the load callback independent of the selected family by reading the latest store value only when the response resolves:

```tsx
const loadFamilies = useCallback(async () => {
  try {
    const data = await getFamilies();
    setFamilies(data);
    if (data.length > 0 && !useFamilyStore.getState().currentFamily) {
      setCurrentFamily(data[0]);
    }
  } catch (err) {
    console.error('加载家庭列表失败:', err);
  } finally {
    setLoading(false);
  }
}, [setCurrentFamily, setFamilies]);

useEffect(() => {
  void loadFamilies();
}, [loadFamilies]);
```

In `FamiliesPage`, use `useCallback` with `[setStoreFamilies]` and make the effect depend on `loadFamilies`; keep all member-management calls unchanged.

- [ ] **Step 4: Run focused test and lint**

Run: `npm test -- --run src/components/FamilySelector.test.tsx`

Expected: PASS.

Run: `npx oxlint --deny-warnings src/components/FamilySelector.tsx src/pages/FamiliesPage.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FamilySelector.tsx frontend/src/components/FamilySelector.test.tsx frontend/src/pages/FamiliesPage.tsx
git commit -m "fix: stabilize family list loaders"
```

### Task 5: Full regression and evidence update

**Files:**
- Modify: `docs/delivery/phase-1/evidence/P1-G-06.md`
- Modify: `docs/delivery/phase-1/phase-1-tracker.md`
- Modify: `docs/project-memory.md`

- [ ] **Step 1: Run the complete frontend gates**

```bash
cd frontend
npm test
npm run lint
npm run build
```

Expected: all frontend tests pass, lint exits 0 with no warning lines, and build succeeds. The existing >500 kB chunk warning may remain and must be recorded separately.

- [ ] **Step 2: Verify warning count and behavior**

Run: `npm run lint 2>&1 | Select-String 'warning'`

Expected: no output. Run `npm test -- --run src/pages/ReportsPage.test.tsx src/pages/AIPage.test.tsx src/pages/RecurringPage.test.tsx src/pages/ImportPage.test.tsx` once more after the full suite.

- [ ] **Step 3: Update evidence and memory**

Record the exact test count, lint result, build result, remaining bundle warning, and unchanged Docker/Redis/MinIO/E2E/release risks in P1-G-06. Update the tracker snapshot and project memory only for the warning-count change; do not mark P1-G-06 or Phase 1 released while external gates remain open.

- [ ] **Step 4: Run Graphify per repository policy**

Attempt the documented incremental semantic update. If only the AST-only runner is available, leave `graphify-out` unchanged and record the limitation, preserving the reviewed semantic graph.

- [ ] **Step 5: Commit the evidence update**

```bash
git add docs/delivery/phase-1/evidence/P1-G-06.md docs/delivery/phase-1/phase-1-tracker.md docs/project-memory.md
git commit -m "docs: record frontend warning cleanup evidence"
```

## Plan Self-Review

- Spec coverage: callback stability, complete dependencies, stale-date reset protection, no lint suppression, unchanged API/financial behavior, frontend test/lint/build gates, bundle warning separation, and Graphify limitation are covered by Tasks 1–5.
- Placeholder scan: all implementation steps contain concrete files, commands, and expected results.
- Type consistency: report loaders use explicit optional string parameters; page-local loaders keep existing names and return `Promise<void>`; all effect dependencies refer to the callback defined in the same component.
