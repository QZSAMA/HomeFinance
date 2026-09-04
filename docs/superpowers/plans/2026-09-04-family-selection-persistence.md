# 家庭选择跨刷新保持实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the authenticated user's selected family stable across client navigation and full browser refreshes without persisting family data or weakening server authorization.

**Architecture:** Add a tiny, defensive `localStorage` adapter inside `useFamilyStore` that stores only the selected family ID. `FamilySelector` remains responsible for fetching the authoritative family list and hydrates the persisted ID only when it appears in that list; otherwise it falls back to a valid first family or `null`. Logout clears the persisted ID through the same store boundary.

**Tech Stack:** React 19, Zustand 5, TypeScript, Vitest, Testing Library, Vite.

## Global Constraints

- `familyId` remains the tenant boundary; a local ID is only a UI preference and never an authorization boundary.
- Server membership data is authoritative; never persist family objects, roles, transactions, or financial values.
- Viewers and all existing mutation/financial contracts are unchanged.
- Write the failing regression before production code, then run focused tests, frontend lint, and frontend build.
- Keep the existing E2E assertion that creation of family B hides family A's transaction; do not weaken it to an explicit test-only switch.

### Task 1: Add a defensive persisted-family store boundary

**Files:**
- Modify: `frontend/src/store/useFamilyStore.ts`
- Create: `frontend/src/store/useFamilyStore.test.ts`

**Interfaces:**
- Produces `CURRENT_FAMILY_STORAGE_KEY` (module-local constant), `getPersistedCurrentFamilyId(): string | null`, `clearPersistedCurrentFamily(): void`, and the existing `useFamilyStore` actions.
- `setCurrentFamily(family)` persists only `family.id`; `setCurrentFamily(null)` removes the key.

- [ ] **Step 1: Write the failing tests**

Add a focused store test with real jsdom `localStorage`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { Family } from '../types';
import {
  clearPersistedCurrentFamily,
  getPersistedCurrentFamilyId,
  useFamilyStore,
} from './useFamilyStore';

const family = { id: 'family-1', name: '测试家庭' } as Family;

describe('useFamilyStore family preference', () => {
  beforeEach(() => {
    localStorage.clear();
    useFamilyStore.setState({ currentFamily: null, families: [] });
  });

  it('persists only the selected family id and removes it when cleared', () => {
    useFamilyStore.getState().setCurrentFamily(family);
    expect(getPersistedCurrentFamilyId()).toBe(family.id);
    expect(localStorage.length).toBe(1);

    useFamilyStore.getState().setCurrentFamily(null);
    expect(getPersistedCurrentFamilyId()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('clears a persisted id through the shared cleanup boundary', () => {
    useFamilyStore.getState().setCurrentFamily(family);
    clearPersistedCurrentFamily();
    expect(getPersistedCurrentFamilyId()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run from `frontend/`:

```powershell
npm test -- --run src/store/useFamilyStore.test.ts
```

Expected: FAIL because the current setter does not write `localStorage` and the cleanup helpers do not exist.

- [ ] **Step 3: Implement the minimal store adapter**

In `useFamilyStore.ts`, add a module-local key such as `homefinance.currentFamilyId`, wrap `getItem`, `setItem`, and `removeItem` in `try/catch`, export the two read/cleanup helpers, and update the existing setter:

```ts
const CURRENT_FAMILY_STORAGE_KEY = 'homefinance.currentFamilyId';

export const getPersistedCurrentFamilyId = (): string | null => {
  try {
    return localStorage.getItem(CURRENT_FAMILY_STORAGE_KEY);
  } catch {
    return null;
  }
};

const persistCurrentFamilyId = (id: string | null) => {
  try {
    if (id) localStorage.setItem(CURRENT_FAMILY_STORAGE_KEY, id);
    else localStorage.removeItem(CURRENT_FAMILY_STORAGE_KEY);
  } catch {
    // Storage can be disabled; the in-memory selection remains usable.
  }
};

export const clearPersistedCurrentFamily = () => persistCurrentFamilyId(null);

// inside create(...)
setCurrentFamily: (family) => {
  persistCurrentFamilyId(family?.id ?? null);
  set({ currentFamily: family });
},
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the same command. Expected: 1 suite / 2 tests PASS.

- [ ] **Step 5: Commit the store boundary**

```powershell
git add frontend/src/store/useFamilyStore.ts frontend/src/store/useFamilyStore.test.ts
git commit -m "feat: persist selected family id"
```

### Task 2: Hydrate the selector from the authoritative list and clear on logout

**Files:**
- Modify: `frontend/src/components/FamilySelector.tsx`
- Modify: `frontend/src/components/FamilySelector.test.tsx`
- Modify: `frontend/src/store/useAuthStore.ts`
- Create: `frontend/src/store/useAuthStore.test.ts`

**Interfaces:**
- `FamilySelector` consumes `getPersistedCurrentFamilyId` and `clearPersistedCurrentFamily`/`setCurrentFamily`; it still uses `getFamilies()` as the only family source.
- `useAuthStore.logout()` clears the persisted family preference in its existing `finally` block.

- [ ] **Step 1: Add the failing selector and logout regressions**

In `FamilySelector.test.tsx`, import `screen` from Testing Library, clear `localStorage` in setup, and add:

```tsx
it('restores the persisted family after a full store reset', async () => {
  getFamiliesMock.mockResolvedValue([family, secondFamily]);
  act(() => useFamilyStore.getState().setCurrentFamily(secondFamily));
  useFamilyStore.setState({ currentFamily: null, families: [] });

  render(<FamilySelector />);

  await waitFor(() => expect(useFamilyStore.getState().currentFamily?.id).toBe(secondFamily.id));
  expect(screen.getByRole('combobox')).toHaveValue(secondFamily.id);
});

it('falls back to the first authorized family when the persisted id is absent', async () => {
  getFamiliesMock.mockResolvedValue([family, secondFamily]);
  localStorage.setItem('homefinance.currentFamilyId', 'revoked-family');

  render(<FamilySelector />);

  await waitFor(() => expect(useFamilyStore.getState().currentFamily?.id).toBe(family.id));
  expect(localStorage.getItem('homefinance.currentFamilyId')).toBe(family.id);
});
```

Create `useAuthStore.test.ts` with mocked auth APIs and assert logout cleanup:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as authService from '../services/authService';
import { useFamilyStore } from './useFamilyStore';
import { useAuthStore } from './useAuthStore';

vi.mock('../services/authService', () => ({
  login: vi.fn(), register: vi.fn(), logout: vi.fn().mockResolvedValue(undefined),
}));

describe('useAuthStore logout', () => {
  beforeEach(() => {
    localStorage.clear();
    useFamilyStore.setState({ currentFamily: null, families: [] });
    useAuthStore.setState({ user: null, token: 'token', isAuthenticated: true, isLoading: false });
  });

  it('removes the selected family preference', async () => {
    useFamilyStore.getState().setCurrentFamily({ id: 'family-1', name: '测试家庭' } as any);
    await useAuthStore.getState().logout();
    expect(localStorage.getItem('homefinance.currentFamilyId')).toBeNull();
    expect(authService.logout).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run from `frontend/`:

```powershell
npm test -- --run src/components/FamilySelector.test.tsx src/store/useAuthStore.test.ts
```

Expected: the two new selector assertions fail because reload hydration is not implemented, and the logout assertion fails because logout does not clear the preference.

- [ ] **Step 3: Implement list hydration and logout cleanup**

Update `FamilySelector.loadFamilies` so the response is applied only while mounted, then resolve the selection from the live store and persisted ID. Use a `mountedRef` that is reset by the effect cleanup:

```ts
const mountedRef = useRef(true);

const loadFamilies = useCallback(async () => {
  try {
    const data = await getFamilies();
    if (!mountedRef.current) return;
    setFamilies(data);
    const live = useFamilyStore.getState().currentFamily;
    const persistedId = getPersistedCurrentFamilyId();
    const preferred = data.find((item) => item.id === persistedId)
      ?? (live ? data.find((item) => item.id === live.id) : undefined);

    if (preferred) {
      if (live?.id !== preferred.id || live !== preferred) setCurrentFamily(preferred);
    } else if (data.length > 0) {
      setCurrentFamily(data[0]);
    } else {
      setCurrentFamily(null);
    }
  } catch (err) {
    console.error('加载家庭列表失败:', err);
  } finally {
    setLoading(false);
  }
}, [setCurrentFamily, setFamilies]);

useEffect(() => {
  mountedRef.current = true;
  void loadFamilies();
  return () => {
    mountedRef.current = false;
  };
}, [loadFamilies]);
```

Keep the existing pending-selection protection by evaluating `useFamilyStore.getState()` after `await`. Import `useRef` alongside the existing React hooks. In `useAuthStore.ts`, import `clearPersistedCurrentFamily` and call it in `logout`'s `finally` block next to removing the token and user.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the selector, store, and auth tests:

```powershell
npm test -- --run src/components/FamilySelector.test.tsx src/store/useFamilyStore.test.ts src/store/useAuthStore.test.ts
```

Expected: all focused tests PASS, including the existing pending-selection regression.

- [ ] **Step 5: Commit selector hydration and logout behavior**

```powershell
git add frontend/src/components/FamilySelector.tsx frontend/src/components/FamilySelector.test.tsx frontend/src/store/useAuthStore.ts frontend/src/store/useAuthStore.test.ts
git commit -m "fix: restore selected family after reload"
```

### Task 3: Run regression gates and synchronize delivery evidence

**Files:**
- Modify: `docs/project-memory.md`
- Modify: `docs/delivery/phase-1/phase-1-tracker.md`
- Modify: `docs/delivery/phase-1/evidence/P1-G-04.md`

**Interfaces:**
- Documentation records the actual commit IDs and test results only; no PASS-E2E claim is made until GitHub executes all four journeys successfully.

- [ ] **Step 1: Run the full frontend gates**

From `frontend/`:

```powershell
npm test
npm run lint
npm run build
```

Expected: all frontend tests pass, lint exits 0, and build succeeds. The existing large-chunk warning may remain documented; no new warnings are acceptable.

- [ ] **Step 2: Verify the browser journey discovery and run when Docker is available**

Run:

```powershell
npx playwright test --list
npm run test:e2e
```

Expected locally: four journeys are discovered; if Docker is unavailable, retain the existing blocked result and do not claim PASS-E2E. Push the implementation commits so `.github/workflows/e2e.yml` runs on GitHub, then record the run URL/result. Only a green four-journey run can change P1-G-04 to `PASS-E2E`.

- [ ] **Step 3: Update project memory, tracker, and evidence**

Append a dated implementation fact to `docs/project-memory.md` describing the persisted-ID-only preference, server-list validation, logout cleanup, focused tests, and the exact E2E status. Update `phase-1-tracker.md` and `evidence/P1-G-04.md` with the same commit and command evidence; leave P1-G-05 Redis/MinIO recovery open.

- [ ] **Step 4: Remove only the known E2E artifact directory**

After extracting any needed evidence, verify and remove only `D:\Repo\Qz_Private\HomeFinance\.tmp-e2e-33742265426` so the working tree contains no generated artifacts:

```powershell
$artifact = (Resolve-Path '.tmp-e2e-33742265426').Path
if ($artifact -eq (Join-Path (Get-Location) '.tmp-e2e-33742265426')) { Remove-Item -LiteralPath $artifact -Recurse -Force }
```

- [ ] **Step 5: Commit documentation and push to `main`**

```powershell
git add docs/project-memory.md docs/delivery/phase-1/phase-1-tracker.md docs/delivery/phase-1/evidence/P1-G-04.md
git commit -m "docs: record family selection reload evidence"
git push origin main
```
