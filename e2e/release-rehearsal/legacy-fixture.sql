BEGIN;

INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES
('legacy-admin-a','legacy-admin-a@example.test','not-used-by-rehearsal','Legacy Admin A','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-viewer-a','legacy-viewer-a@example.test','not-used-by-rehearsal','Legacy Viewer A','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-admin-b','legacy-admin-b@example.test','not-used-by-rehearsal','Legacy Admin B','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');

INSERT INTO "Family" ("id","name","description","createdAt","updatedAt") VALUES
('legacy-family-a','Legacy Family A','P1-H-03 family A','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-family-b','Legacy Family B','P1-H-03 family B','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');

INSERT INTO "FamilyMember" ("id","familyId","userId","role","createdAt") VALUES
('legacy-member-a-admin','legacy-family-a','legacy-admin-a','admin','2026-01-01T00:00:00Z'),
('legacy-member-a-viewer','legacy-family-a','legacy-viewer-a','viewer','2026-01-01T00:00:00Z'),
('legacy-member-b-admin','legacy-family-b','legacy-admin-b','admin','2026-01-01T00:00:00Z');

INSERT INTO "Income" ("id","familyId","createdBy","category","amount","description","source","date","createdAt","updatedAt") VALUES
('legacy-income-a','legacy-family-a','legacy-admin-a','Salary',1000.00,'legacy-a-income','fixture','2026-01-15T00:00:00Z','2026-01-15T00:00:00Z','2026-01-15T00:00:00Z'),
('legacy-income-b','legacy-family-b','legacy-admin-b','Salary',700.00,'legacy-b-income','fixture','2026-01-15T00:00:00Z','2026-01-15T00:00:00Z','2026-01-15T00:00:00Z');

INSERT INTO "Expense" ("id","familyId","createdBy","category","amount","description","paymentMethod","date","createdAt","updatedAt") VALUES
('legacy-expense-a','legacy-family-a','legacy-admin-a','Food',250.00,'legacy-a-expense','cash','2026-01-16T00:00:00Z','2026-01-16T00:00:00Z','2026-01-16T00:00:00Z'),
('legacy-expense-b','legacy-family-b','legacy-admin-b','Food',125.00,'legacy-b-expense','cash','2026-01-16T00:00:00Z','2026-01-16T00:00:00Z','2026-01-16T00:00:00Z');

INSERT INTO "Asset" ("id","familyId","name","type","category","value","costBasis","currency","purchaseDate","description","createdAt","updatedAt") VALUES
('legacy-asset-a','legacy-family-a','A Cash','CASH','cash',5000.00,5000.00,'CNY','2026-01-01T00:00:00Z','legacy-a-asset','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-asset-b','legacy-family-b','B Cash','CASH','cash',3000.00,3000.00,'CNY','2026-01-01T00:00:00Z','legacy-b-asset','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');

INSERT INTO "Liability" ("id","familyId","name","type","amount","interestRate","startDate","endDate","currency","description","createdAt","updatedAt") VALUES
('legacy-liability-a','legacy-family-a','A Loan','LOAN',1000.00,0.0350,'2026-01-01T00:00:00Z','2027-01-01T00:00:00Z','CNY','legacy-a-liability','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-liability-b','legacy-family-b','B Loan','LOAN',500.00,0.0250,'2026-01-01T00:00:00Z','2027-01-01T00:00:00Z','CNY','legacy-b-liability','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');

INSERT INTO "Budget" ("id","familyId","category","amount","period","startDate","endDate","createdBy","createdAt","updatedAt") VALUES
('legacy-budget-a','legacy-family-a','Food',600.00,'MONTHLY','2026-01-01T00:00:00Z',NULL,'legacy-admin-a','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-budget-b','legacy-family-b','Food',400.00,'MONTHLY','2026-01-01T00:00:00Z',NULL,'legacy-admin-b','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');

INSERT INTO "RecurringTransaction" ("id","familyId","type","category","amount","description","frequency","interval","nextDate","endDate","isActive","lastExecutedAt","createdBy","createdAt","updatedAt") VALUES
('legacy-recurring-a','legacy-family-a','EXPENSE','Food',50.00,'legacy-a-recurring','MONTHLY',1,'2026-02-01T00:00:00Z',NULL,true,NULL,'legacy-admin-a','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-recurring-b','legacy-family-b','INCOME','Salary',75.00,'legacy-b-recurring','MONTHLY',1,'2026-02-01T00:00:00Z',NULL,true,NULL,'legacy-admin-b','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');

INSERT INTO "Goal" ("id","familyId","title","type","targetAmount","deadline","isCompleted","createdBy","createdAt","updatedAt") VALUES
('legacy-goal-a','legacy-family-a','Legacy Goal A','SAVING',2000.00,'2027-01-01T00:00:00Z',false,'legacy-admin-a','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('legacy-goal-b','legacy-family-b','Legacy Goal B','DEBT_PAYOFF',1000.00,'2027-01-01T00:00:00Z',false,'legacy-admin-b','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');

INSERT INTO "AiConversation" ("id","familyId","userId","content","response","type","fileId","createdAt") VALUES
('legacy-ai-a','legacy-family-a','legacy-admin-a','legacy-a-question','legacy-a-answer','chat',NULL,'2026-01-20T00:00:00Z'),
('legacy-ai-b','legacy-family-b','legacy-admin-b','legacy-b-question','legacy-b-answer','chat',NULL,'2026-01-20T00:00:00Z');

COMMIT;
