export const AI_CONFIG = {
  baseURL: process.env.AI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/coding/v3',
  apiKey: process.env.AI_API_KEY || '',
  model: process.env.AI_MODEL || 'ark-code-latest',
  maxTokens: 4096,
  temperature: 0.7,
};

export const isAIConfigured = (): boolean => {
  const key = AI_CONFIG.apiKey.trim();
  return key.length > 0 && key !== 'your-ark-api-key' && key !== 'your-openai-api-key';
};