import { redact } from './process.mjs';

const API_BASE_URL = 'http://127.0.0.1:4180/api';
const PASSWORD = 'RehearsalPassw0rd!';
const REPORT_WINDOW = 'startDate=2026-09-01&endDate=2026-09-30';

const requireCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const requireObject = (value, label) => {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value;
};

const requireArray = (value, label) => {
  requireCondition(Array.isArray(value), `${label} must be an array`);
  return value;
};

const requireId = (value, label) => {
  requireCondition(typeof value === 'string' && value.length > 0, `${label} must be a nonblank ID`);
  return value;
};

export async function requestApi(path, {
  method = 'GET',
  token,
  json,
  form,
  headers = {},
  expectedStatus,
  fetchImpl = fetch,
} = {}) {
  requireCondition(typeof path === 'string' && path.startsWith('/'), 'API path must start with /');
  const requestHeaders = { ...headers };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (json !== undefined) requestHeaders['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetchImpl(`${API_BASE_URL}${path}`, {
      method,
      headers: requestHeaders,
      body: json === undefined ? form : JSON.stringify(json),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(redact(`${method} ${path} request failed: ${detail}`));
  }

  const raw = await response.text();
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(redact(`${method} ${path} expected ${expectedStatus}, received ${response.status}`));
  }
  return { status: response.status, headers: response.headers, body };
}

export function assertIncomeStatement(body, expected) {
  const statement = requireObject(body, 'income statement');
  for (const [field, value] of Object.entries({
    totalIncome: expected.income,
    totalExpense: expected.expense,
    netIncome: expected.net,
  })) {
    if (statement[field] !== value) {
      throw new Error(`${field} expected ${value}, received ${String(statement[field])}`);
    }
  }
  if (statement.reconciliationStatus !== 'passed') {
    throw new Error('reconciliationStatus expected passed');
  }
  if (statement.totalIncome - statement.totalExpense !== statement.netIncome) {
    throw new Error('income statement does not reconcile');
  }
}

async function register(email, name) {
  const response = await requestApi('/auth/register', {
    method: 'POST',
    json: { email, name, password: PASSWORD },
    expectedStatus: 201,
  });
  const body = requireObject(response.body, `registration for ${name}`);
  const user = requireObject(body.user, `registered user ${name}`);
  return {
    id: requireId(user.id, `registered user ${name}`),
    token: requireId(body.token, `registration token for ${name}`),
  };
}

async function createFamily(token, name) {
  const response = await requestApi('/families', {
    method: 'POST',
    token,
    json: { name, timezone: 'Asia/Shanghai' },
    expectedStatus: 201,
  });
  return requireObject(response.body, `family ${name}`);
}

async function listLedger(familyId, entity, token) {
  const response = await requestApi(`/families/${familyId}/${entity}`, {
    token,
    expectedStatus: 200,
  });
  return requireArray(response.body, `${entity} list`);
}

const matchingDescription = (records, description) => (
  records.filter((record) => record?.description === description)
);

function assertReplay(first, replay, label) {
  requireCondition(first.body?.id === replay.body?.id, `${label} replay returned a different ID`);
  requireCondition(
    replay.headers.get('idempotency-replayed') === 'true' || replay.body?.deduplicated === true,
    `${label} replay was not marked as deduplicated`,
  );
}

export async function runApplicationSmoke(suffix) {
  requireCondition(
    typeof suffix === 'string' && /^[a-z0-9-]+$/i.test(suffix),
    'smoke suffix must contain only letters, digits, and hyphens',
  );
  const descriptions = {
    income: `P1-H-03 income ${suffix}`,
    viewerDenied: `P1-H-03 viewer denied ${suffix}`,
    imported: 'P1-H-03 CSV',
    recurring: `P1-H-03 recurring ${suffix}`,
    ai: 'E2E mock AI proposal',
  };
  const emails = {
    adminA: `rehearsal-admin-a-${suffix}@example.test`,
    viewer: `rehearsal-viewer-${suffix}@example.test`,
    adminB: `rehearsal-admin-b-${suffix}@example.test`,
  };

  const adminA = await register(emails.adminA, `Rehearsal Admin A ${suffix}`);
  const viewer = await register(emails.viewer, `Rehearsal Viewer ${suffix}`);
  const adminB = await register(emails.adminB, `Rehearsal Admin B ${suffix}`);
  const familyA = await createFamily(adminA.token, `Rehearsal Family A ${suffix}`);
  const familyB = await createFamily(adminB.token, `Rehearsal Family B ${suffix}`);
  const familyAId = requireId(familyA.id, 'family A');
  const familyBId = requireId(familyB.id, 'family B');

  const invited = await requestApi(`/families/${familyAId}/invite`, {
    method: 'POST',
    token: adminA.token,
    json: { email: emails.viewer, role: 'viewer' },
    expectedStatus: 201,
  });
  const invitedFamily = requireObject(invited.body, 'invited family');
  const viewerMembership = requireArray(invitedFamily.members, 'invited family members')
    .find((member) => member?.userId === viewer.id);
  requireCondition(viewerMembership?.role === 'viewer', 'viewer membership was not created as read-only');

  const reportPath = `/families/${familyAId}/reports/income-statement?${REPORT_WINDOW}`;
  await requestApi(reportPath, { expectedStatus: 401 });
  await requestApi(reportPath, { token: adminB.token, expectedStatus: 403 });
  await requestApi(`/families/${familyAId}/expenses`, {
    method: 'POST',
    token: viewer.token,
    json: {
      amount: 9,
      category: '餐饮',
      description: descriptions.viewerDenied,
      currency: 'CNY',
      date: '2026-09-01T10:00:00.000Z',
    },
    expectedStatus: 403,
  });
  const afterViewerDenial = await listLedger(familyAId, 'expenses', adminA.token);
  requireCondition(
    matchingDescription(afterViewerDenial, descriptions.viewerDenied).length === 0,
    'viewer denial left an expense behind',
  );

  const incomePayload = {
    amount: 120,
    category: '工资',
    description: descriptions.income,
    currency: 'CNY',
    date: '2026-09-01T09:00:00.000Z',
  };
  const incomeHeaders = { 'Idempotency-Key': `p1-h03-income-${suffix}` };
  const incomeFirst = await requestApi(`/families/${familyAId}/incomes`, {
    method: 'POST', token: adminA.token, headers: incomeHeaders, json: incomePayload, expectedStatus: 201,
  });
  const incomeReplay = await requestApi(`/families/${familyAId}/incomes`, {
    method: 'POST', token: adminA.token, headers: incomeHeaders, json: incomePayload, expectedStatus: 201,
  });
  assertReplay(incomeFirst, incomeReplay, 'income');
  const incomeRows = matchingDescription(
    await listLedger(familyAId, 'incomes', adminA.token),
    descriptions.income,
  );
  requireCondition(incomeRows.length === 1, 'income idempotency produced a duplicate row');
  const incomeId = requireId(incomeRows[0].id, 'income');

  const csv = [
    '交易时间,收/支,金额,交易分类,商品名称',
    '2026-09-01 12:00:00,支出,35.00,餐饮,P1-H-03 CSV',
    '',
  ].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'p1-h03-alipay.csv');
  form.append('format', 'alipay');
  const preview = await requestApi(`/families/${familyAId}/import/csv`, {
    method: 'POST', token: adminA.token, form, expectedStatus: 200,
  });
  const previewRows = requireArray(preview.body, 'import preview');
  requireCondition(previewRows.length === 1 && previewRows[0]?.amount === 35, 'import preview was not the expected single 35 CNY row');
  const importBatchId = requireId(preview.headers.get('x-import-batch-id'), 'import batch');
  const previewHash = preview.headers.get('x-import-preview-hash');
  requireCondition(typeof previewHash === 'string' && /^[0-9a-f]{64}$/.test(previewHash), 'import preview hash is invalid');
  const importConfirmation = await requestApi(`/families/${familyAId}/import/confirm`, {
    method: 'POST',
    token: adminA.token,
    headers: { 'Idempotency-Key': `p1-h03-import-${suffix}` },
    json: { batchId: importBatchId, expectedPreviewHash: previewHash, categoryPatch: {} },
    expectedStatus: 200,
  });
  requireCondition(importConfirmation.body?.id === importBatchId, 'import confirmation returned a different batch');
  requireCondition(importConfirmation.body?.successCount === 1, 'import confirmation did not commit exactly one row');
  const importedRows = matchingDescription(
    await listLedger(familyAId, 'expenses', adminA.token),
    descriptions.imported,
  );
  requireCondition(importedRows.length === 1, 'import did not create exactly one expense');
  const importedExpenseId = requireId(importedRows[0].id, 'imported expense');

  const recurringResponse = await requestApi(`/families/${familyAId}/recurring`, {
    method: 'POST',
    token: adminA.token,
    json: {
      type: 'EXPENSE',
      category: '餐饮',
      amount: 12,
      description: descriptions.recurring,
      frequency: 'DAILY',
      interval: 1,
      nextDate: '2026-09-01T00:00:00.000Z',
    },
    expectedStatus: 201,
  });
  const recurringId = requireId(recurringResponse.body?.id, 'recurring rule');
  const recurringExecutionResponse = await requestApi(`/families/${familyAId}/recurring/${recurringId}/execute`, {
    method: 'POST',
    token: adminA.token,
    headers: { 'Idempotency-Key': `p1-h03-recurring-${suffix}` },
    json: { scheduledFor: '2026-09-01T00:00:00.000Z' },
    expectedStatus: 200,
  });
  const recurringExecutionId = requireId(recurringExecutionResponse.body?.executionId, 'recurring execution');
  const recurringEntryId = requireId(recurringExecutionResponse.body?.entryId, 'recurring ledger entry');
  const recurringRows = matchingDescription(
    await listLedger(familyAId, 'expenses', adminA.token),
    descriptions.recurring,
  );
  requireCondition(recurringRows.length === 1 && recurringRows[0]?.id === recurringEntryId, 'recurring execution ledger result is inconsistent');

  const chat = await requestApi(`/families/${familyAId}/ai/chat`, {
    method: 'POST',
    token: adminA.token,
    json: { content: `P1-H-03 deterministic proposal ${suffix}` },
    expectedStatus: 200,
  });
  const chatBody = requireObject(chat.body, 'AI chat');
  requireCondition(Array.isArray(chatBody.actions) && chatBody.actions.length === 0, 'AI chat executed an immediate action');
  requireCondition(Array.isArray(chatBody.proposedActions) && chatBody.proposedActions.length === 1, 'AI chat did not return one proposal');
  const aiProposalId = requireId(chatBody.proposalId, 'AI proposal');
  requireCondition(Number.isInteger(chatBody.proposalVersion) && chatBody.proposalVersion > 0, 'AI proposal version is invalid');
  requireCondition(typeof chatBody.proposalHash === 'string' && /^[0-9a-f]{64}$/.test(chatBody.proposalHash), 'AI proposal hash is invalid');
  const aiProposalItems = requireArray(chatBody.proposalItems, 'AI proposal items');
  requireCondition(aiProposalItems.length === 1, 'AI proposal must contain one server-owned item');
  requireId(aiProposalItems[0]?.proposalItemId, 'AI proposal item');
  requireCondition(
    matchingDescription(await listLedger(familyAId, 'expenses', adminA.token), descriptions.ai).length === 0,
    'AI proposal mutated the ledger before confirmation',
  );
  const aiConfirmation = await requestApi(`/families/${familyAId}/ai/proposals/${aiProposalId}/confirm`, {
    method: 'POST',
    token: adminA.token,
    headers: { 'Idempotency-Key': `p1-h03-ai-${suffix}` },
    json: {
      expectedVersion: chatBody.proposalVersion,
      expectedHash: chatBody.proposalHash,
      actions: aiProposalItems,
    },
    expectedStatus: 200,
  });
  const confirmedActions = requireArray(aiConfirmation.body?.record?.actions, 'confirmed AI actions');
  requireCondition(confirmedActions.length === 1, 'AI confirmation did not commit exactly one result');
  const aiExpenseId = requireId(confirmedActions[0]?.resourceId, 'AI expense');
  const aiRows = matchingDescription(
    await listLedger(familyAId, 'expenses', adminA.token),
    descriptions.ai,
  );
  requireCondition(aiRows.length === 1 && aiRows[0]?.id === aiExpenseId, 'AI confirmation ledger result is inconsistent');

  const goalResponse = await requestApi(`/families/${familyAId}/goals`, {
    method: 'POST',
    token: adminA.token,
    json: { title: `P1-H-03 goal ${suffix}`, type: 'SAVING', targetAmount: 200, currency: 'CNY' },
    expectedStatus: 201,
  });
  const goalId = requireId(goalResponse.body?.id, 'goal');
  const contributionPayload = {
    sourceType: 'MANUAL',
    amount: 40,
    currency: 'CNY',
    contributionDate: '2026-09-01T13:00:00.000Z',
    allocationKey: `p1-h03-allocation-${suffix}`,
  };
  const contributionHeaders = { 'Idempotency-Key': `p1-h03-goal-${suffix}` };
  const contribution = await requestApi(`/families/${familyAId}/goals/${goalId}/contributions`, {
    method: 'POST', token: adminA.token, headers: contributionHeaders, json: contributionPayload, expectedStatus: 201,
  });
  const contributionReplay = await requestApi(`/families/${familyAId}/goals/${goalId}/contributions`, {
    method: 'POST', token: adminA.token, headers: contributionHeaders, json: contributionPayload, expectedStatus: 200,
  });
  assertReplay(contribution, contributionReplay, 'goal contribution');
  const goalContributionId = requireId(contribution.body?.id, 'goal contribution');

  const expectedTotals = { income: 120, expense: 113, net: 7 };
  const statement = await requestApi(reportPath, { token: adminA.token, expectedStatus: 200 });
  assertIncomeStatement(statement.body, expectedTotals);

  const familyBIncomes = await listLedger(familyBId, 'incomes', adminB.token);
  const familyBExpenses = await listLedger(familyBId, 'expenses', adminB.token);
  const forbiddenFamilyAValues = [
    familyAId,
    incomeId,
    importedExpenseId,
    recurringEntryId,
    aiExpenseId,
    ...Object.values(descriptions),
  ];
  const serializedFamilyB = JSON.stringify({ familyBIncomes, familyBExpenses });
  for (const value of forbiddenFamilyAValues) {
    requireCondition(!serializedFamilyB.includes(value), `family B leaked family A value: ${value}`);
  }

  return {
    familyAId,
    familyBId,
    users: { adminA: adminA.id, viewer: viewer.id, adminB: adminB.id },
    families: { familyA: familyAId, familyB: familyBId },
    income: { id: incomeId, operationId: incomeFirst.body?.operationId },
    importBatch: { id: importBatchId, previewHash, expenseId: importedExpenseId },
    recurring: { id: recurringId },
    recurringExecution: {
      id: recurringExecutionId,
      entryId: recurringEntryId,
      operationId: recurringExecutionResponse.body?.operationId,
    },
    aiProposal: {
      id: aiProposalId,
      version: chatBody.proposalVersion,
      hash: chatBody.proposalHash,
      expenseId: aiExpenseId,
      operationId: aiConfirmation.body?.operationId,
    },
    aiProposalItems: aiProposalItems.map((item) => ({
      id: item.proposalItemId,
      type: item.type,
    })),
    goal: { id: goalId },
    goalContribution: { id: goalContributionId },
    expectedTotals,
  };
}
