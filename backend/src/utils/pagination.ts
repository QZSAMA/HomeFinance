import { Request } from 'express';

export interface PaginationParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * 从请求 query 解析分页参数
 * @returns 分页参数，或 null（当请求未携带 page/pageSize 时，表示不分页，向后兼容）
 */
export function parsePagination(req: Request): PaginationParams | null {
  // 无任何分页参数时返回 null，调用方应返回全部数据（向后兼容）
  if (req.query.page === undefined && req.query.pageSize === undefined) {
    return null;
  }

  const parsedPage = parseInt(req.query.page as string, 10);
  const page = Number.isNaN(parsedPage) ? DEFAULT_PAGE : Math.max(1, parsedPage);

  const parsedPageSize = parseInt(req.query.pageSize as string, 10);
  const requestedPageSize = Number.isNaN(parsedPageSize) ? DEFAULT_PAGE_SIZE : parsedPageSize;
  const pageSize = Math.min(Math.max(1, requestedPageSize), MAX_PAGE_SIZE);

  const skip = (page - 1) * pageSize;

  return { page, pageSize, skip, take: pageSize };
}

/**
 * 构造分页响应对象
 */
export function paginateResponse<T>(data: T[], total: number, params: PaginationParams): PaginatedResponse<T> {
  return {
    data,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.ceil(total / params.pageSize),
  };
}
