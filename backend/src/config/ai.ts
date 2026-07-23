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

// 视觉多模态模型配置（可选）
// 未配置时 OCR 仅使用 Tesseract.js 本地识别
// 配置后与 Tesseract 并行运行，结果合并（视觉优先）
export const AI_VISION_CONFIG = {
  baseURL: process.env.AI_VISION_BASE_URL || AI_CONFIG.baseURL,
  apiKey: process.env.AI_VISION_API_KEY || AI_CONFIG.apiKey,
  model: process.env.AI_VISION_MODEL || '',
  maxTokens: 4096,
  temperature: 0.3, // 视觉识别用更低温度，提高确定性
};

export const isVisionConfigured = (): boolean => {
  const key = AI_VISION_CONFIG.apiKey.trim();
  const model = AI_VISION_CONFIG.model.trim();
  return (
    key.length > 0 &&
    model.length > 0 &&
    key !== 'your-ark-api-key' &&
    key !== 'your-openai-api-key'
  );
};
