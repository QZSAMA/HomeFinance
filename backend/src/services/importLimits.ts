export const IMPORT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxRows: 10_000,
  maxFieldLength: 512,
} as const;

export type ImportLimitKind = 'bytes' | 'rows' | 'field';

export class ImportLimitError extends Error {
  readonly code = 'IMPORT_LIMIT_EXCEEDED';

  constructor(readonly limit: ImportLimitKind) {
    super(`Import ${limit} limit exceeded`);
    this.name = 'ImportLimitError';
  }
}

export const assertImportBufferWithinLimit = (buffer: Uint8Array) => {
  if (buffer.byteLength > IMPORT_LIMITS.maxBytes) {
    throw new ImportLimitError('bytes');
  }
};

export const assertImportRowsWithinLimit = (rows: readonly unknown[]) => {
  if (rows.length > IMPORT_LIMITS.maxRows) {
    throw new ImportLimitError('rows');
  }

  const hasOversizedField = rows.some((row) => {
    if (!row || typeof row !== 'object') return false;
    return Object.values(row).some((value) => String(value ?? '').length > IMPORT_LIMITS.maxFieldLength);
  });

  if (hasOversizedField) {
    throw new ImportLimitError('field');
  }
};
