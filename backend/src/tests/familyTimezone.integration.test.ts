import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();
const runId = randomUUID();
const userId = `timezone-user-${runId}`;
const defaultFamilyId = `timezone-default-family-${runId}`;
const explicitFamilyId = `timezone-explicit-family-${runId}`;

describe('Family timezone persistence on PostgreSQL', () => {
  let connected = false;

  beforeAll(async () => {
    await prisma.$connect();
    connected = true;
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: 'test',
        name: 'Timezone integration',
      },
    });
  });

  afterAll(async () => {
    if (!connected) return;
    await prisma.family.deleteMany({ where: { id: { in: [defaultFamilyId, explicitFamilyId] } } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('stores the default and an explicit IANA timezone', async () => {
    const defaultFamily = await prisma.family.create({
      data: {
        id: defaultFamilyId,
        name: 'Default timezone family',
        members: { create: { userId, role: 'admin' } },
      },
    });
    const explicitFamily = await prisma.family.create({
      data: {
        id: explicitFamilyId,
        name: 'Explicit timezone family',
        timezone: 'America/New_York',
        members: { create: { userId, role: 'admin' } },
      },
    });

    expect(defaultFamily.timezone).toBe('Asia/Shanghai');
    expect(explicitFamily.timezone).toBe('America/New_York');
  });

  test('rejects changing an existing family timezone and preserves the original value', async () => {
    await expect(
      prisma.$executeRaw`UPDATE "Family" SET "timezone" = 'UTC' WHERE "id" = ${explicitFamilyId}`,
    ).rejects.toThrow(/FAMILY_TIMEZONE_IMMUTABLE/);

    const family = await prisma.family.findUniqueOrThrow({
      where: { id: explicitFamilyId },
      select: { timezone: true },
    });
    expect(family.timezone).toBe('America/New_York');
  });
});
