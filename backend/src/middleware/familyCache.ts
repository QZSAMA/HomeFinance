export const FAMILY_REPORT_CACHE_EPOCH = 'v2';

export const familyReportCacheKey = (familyId: string, version: string, originalUrl: string) => (
  `cache:family:${FAMILY_REPORT_CACHE_EPOCH}:${familyId}:v${version}:${originalUrl}`
);
