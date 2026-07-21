import api from './api';

export const suggestCategory = (
  familyId: string,
  type: 'INCOME' | 'EXPENSE',
  description: string
) =>
  api
    .get<{ category: string | null }>(`/families/${familyId}/category/suggest`, {
      params: { type, description },
    })
    .then((r) => r.data.category);
