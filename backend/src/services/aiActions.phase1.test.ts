import * as aiActions from './aiActions';

describe('AI action execution boundary', () => {
  test('does not expose a direct financial mutation executor', () => {
    expect('executeActions' in aiActions).toBe(false);
  });
});
