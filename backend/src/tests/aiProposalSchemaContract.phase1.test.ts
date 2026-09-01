import fs from 'fs';
import path from 'path';

const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');
const migrationPath = path.resolve(
  __dirname,
  '../../prisma/migrations/20260828100400_phase1_add_ai_proposal/migration.sql',
);

describe('Phase 1 AI proposal persistence contract', () => {
  test('declares server-owned proposals with traceable payloads and ordered actions', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');

    expect(schema).toContain('model AiProposal');
    expect(schema).toMatch(/model AiProposal[\s\S]*familyId\s+String/);
    expect(schema).toMatch(/model AiProposal[\s\S]*actorUserId\s+String\?/);
    expect(schema).toMatch(/model AiProposal[\s\S]*actorSnapshot\s+Json/);
    expect(schema).toMatch(/model AiProposal[\s\S]*sourceType\s+String/);
    expect(schema).toMatch(/model AiProposal[\s\S]*sourceConversationId\s+String\?/);
    expect(schema).toMatch(/model AiProposal[\s\S]*sourceFileId\s+String\?/);
    expect(schema).toMatch(/model AiProposal[\s\S]*originalPayload\s+Json/);
    expect(schema).toMatch(/model AiProposal[\s\S]*originalHash\s+String\s+@db\.Char\(64\)/);
    expect(schema).toMatch(/model AiProposal[\s\S]*confirmedPayload\s+Json\?/);
    expect(schema).toMatch(/model AiProposal[\s\S]*confirmedHash\s+String\?\s+@db\.Char\(64\)/);
    expect(schema).toMatch(
      /model AiProposal[\s\S]*status\s+String\s+@default\("PROPOSED"\)/,
    );
    expect(schema).toMatch(/model AiProposal[\s\S]*version\s+Int\s+@default\(1\)/);
    expect(schema).toMatch(/model AiProposal[\s\S]*expiresAt\s+DateTime/);
    expect(schema).toMatch(/model AiProposal[\s\S]*resultJson\s+Json\?/);

    expect(schema).toContain('model AiProposalItem');
    expect(schema).toMatch(/model AiProposalItem[\s\S]*proposalId\s+String/);
    expect(schema).toMatch(/model AiProposalItem[\s\S]*ordinal\s+Int/);
    expect(schema).toMatch(/model AiProposalItem[\s\S]*typedAction\s+String/);
    expect(schema).toMatch(/model AiProposalItem[\s\S]*canonicalData\s+Json/);
    expect(schema).toMatch(/model AiProposalItem[\s\S]*resultJson\s+Json\?/);
    expect(schema).toMatch(/@@unique\(\[proposalId, ordinal\]\)/);

    expect(fs.existsSync(migrationPath)).toBe(true);
    if (!fs.existsSync(migrationPath)) return;

    const migration = fs.readFileSync(migrationPath, 'utf8');
    expect(migration).toContain('CREATE TABLE "AIProposal"');
    expect(migration).toContain('CREATE TABLE "AIProposalItem"');
    expect(migration).toContain('AIProposalItem_proposalId_ordinal_key');
    expect(migration).toContain('AIProposal_originalHash_format_check');
    expect(migration).toContain('AIProposal_confirmedHash_format_check');
    expect(migration).toContain('AIProposal_confirmed_payload_pair_check');
    expect(migration).toContain('AIProposal_version_check');
    expect(migration).toContain('AIProposal_status_check');
    expect(migration).toContain('AIProposal_source_type_check');
    expect(migration).toContain('AIProposalItem_ordinal_check');
    expect(migration).toContain('ON DELETE SET NULL');
  });
});
