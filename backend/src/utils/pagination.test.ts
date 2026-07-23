import { parsePagination, paginateResponse } from './pagination';

function mockReq(query: any = {}) {
  return { query } as any;
}

describe('pagination utils', () => {
  describe('parsePagination', () => {
    test('无分页参数时返回 null（向后兼容）', () => {
      expect(parsePagination(mockReq())).toBeNull();
      expect(parsePagination(mockReq({}))).toBeNull();
    });

    test('仅 page 参数时使用默认 pageSize=20', () => {
      const result = parsePagination(mockReq({ page: '1' }));
      expect(result).not.toBeNull();
      expect(result!.page).toBe(1);
      expect(result!.pageSize).toBe(20);
      expect(result!.skip).toBe(0);
      expect(result!.take).toBe(20);
    });

    test('自定义 page 和 pageSize', () => {
      const result = parsePagination(mockReq({ page: '3', pageSize: '50' }));
      expect(result!.page).toBe(3);
      expect(result!.pageSize).toBe(50);
      expect(result!.skip).toBe(100); // (3-1)*50
      expect(result!.take).toBe(50);
    });

    test('pageSize 超过 MAX_PAGE_SIZE=100 时截断', () => {
      const result = parsePagination(mockReq({ page: '1', pageSize: '500' }));
      expect(result!.pageSize).toBe(100);
      expect(result!.take).toBe(100);
    });

    test('page < 1 时截断到 1', () => {
      const result = parsePagination(mockReq({ page: '-5', pageSize: '10' }));
      expect(result!.page).toBe(1);
      expect(result!.skip).toBe(0);
    });

    test('pageSize < 1 时截断到 1', () => {
      const result = parsePagination(mockReq({ page: '1', pageSize: '0' }));
      expect(result!.pageSize).toBe(1);
    });

    test('非数字 page 时用默认值 1', () => {
      const result = parsePagination(mockReq({ page: 'abc', pageSize: '10' }));
      expect(result!.page).toBe(1);
    });

    test('非数字 pageSize 时用默认值 20', () => {
      const result = parsePagination(mockReq({ page: '2', pageSize: 'xyz' }));
      expect(result!.pageSize).toBe(20);
    });

    test('仅 pageSize 参数时 page 默认为 1', () => {
      const result = parsePagination(mockReq({ pageSize: '15' }));
      expect(result).not.toBeNull();
      expect(result!.page).toBe(1);
      expect(result!.pageSize).toBe(15);
      expect(result!.skip).toBe(0);
    });
  });

  describe('paginateResponse', () => {
    test('构造分页响应对象', () => {
      const data = [{ id: 1 }, { id: 2 }];
      const params = { page: 2, pageSize: 10, skip: 10, take: 10 };
      const result = paginateResponse(data, 25, params);
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(25);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(3); // Math.ceil(25/10)
    });

    test('total=0 时 totalPages=0', () => {
      const result = paginateResponse([], 0, { page: 1, pageSize: 20, skip: 0, take: 20 });
      expect(result.totalPages).toBe(0);
    });

    test('total 刚好整除时 totalPages 精确', () => {
      const result = paginateResponse([], 40, { page: 1, pageSize: 20, skip: 0, take: 20 });
      expect(result.totalPages).toBe(2);
    });
  });
});
