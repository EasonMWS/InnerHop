import type { ProviderConfig, ReasoningEffort } from '../types';

export type ModelTier = '旗舰' | '主力' | '轻量';

export interface ReasoningEffortOption {
  value: ReasoningEffort;
  label: string;
  shortLabel: string;
}

export const REASONING_EFFORT_OPTIONS: ReasoningEffortOption[] = [
  { value: 'default', label: '默认（跟随模型出厂设定）', shortLabel: '默认（跟随官方）' },
  { value: 'low', label: '低（极速省 Token · 适合执行手）', shortLabel: '低（极速省费）' },
  { value: 'medium', label: '中（速度与深度均衡）', shortLabel: '中（均衡）' },
  { value: 'high', label: '高（深度推理 · 适合架构师）', shortLabel: '高（深度推理）' },
  { value: 'xhigh', label: '极高（极限算力 · 复杂架构排障）', shortLabel: '极高（极限思考）' },
];

export interface CatalogModel {
  id: string;
  tier: ModelTier;
  note: string;
  inPrice: number;
  outPrice: number;
  vendor?: string;
}

const ANTHROPIC_CATALOG: CatalogModel[] = [
  { id: 'claude-fable-5-2', tier: '旗舰', note: '顶级复杂架构与长程深度推理', inPrice: 8, outPrice: 40 },
  { id: 'claude-opus-5-5', tier: '旗舰', note: '重度编程与多步骤 Agent 主力旗舰', inPrice: 4, outPrice: 20 },
  { id: 'claude-sonnet-5-5', tier: '主力', note: '速度与代码质量兼顾，高性价比执行', inPrice: 2, outPrice: 10 },
  { id: 'claude-haiku-5-5', tier: '轻量', note: '极速低价，适合高频简单改动', inPrice: 0.1, outPrice: 0.5 },
  { id: 'claude-opus-4-1', tier: '旗舰', note: '上代旗舰（兼容旧接口）', inPrice: 15, outPrice: 75 },
  { id: 'claude-sonnet-4-5', tier: '主力', note: '上代主力（兼容旧接口）', inPrice: 3, outPrice: 15 },
];

const OPENAI_CATALOG: CatalogModel[] = [
  { id: 'gpt-6.2-astra', tier: '旗舰', note: '顶级复杂推理、深度编程与长程 Agent（1M 上下文）', inPrice: 8, outPrice: 40 },
  { id: 'gpt-6.2-sol', tier: '主力', note: '生产级均衡编程与复杂 Agent 主力（1M 上下文）', inPrice: 2, outPrice: 10 },
  { id: 'gpt-6.1-terra', tier: '主力', note: '视觉推理与精准通用任务均衡型', inPrice: 1.5, outPrice: 6 },
  { id: 'gpt-6-luna', tier: '轻量', note: '极速低成本，高频工具调用执行', inPrice: 0.25, outPrice: 1.0 },
  { id: 'gpt-6-astra', tier: '旗舰', note: 'GPT-6.0 旗舰兼容版本', inPrice: 10, outPrice: 30 },
  { id: 'gpt-6.1-sol', tier: '主力', note: 'GPT-6.1 主力兼容版本', inPrice: 3, outPrice: 12 },
  { id: 'gpt-5.6-sol', tier: '主力', note: 'GPT-5.6 主力兼容版本', inPrice: 2.5, outPrice: 10 },
  { id: 'gpt-5.4-mini', tier: '轻量', note: 'GPT-5.4 轻量兼容版本', inPrice: 0.3, outPrice: 1.2 },
];

const GEMINI_CATALOG: CatalogModel[] = [
  { id: 'gemini-4-carbon', tier: '旗舰', note: '顶级多模态理解与复杂系统推理', inPrice: 5, outPrice: 20 },
  { id: 'gemini-4-neon', tier: '旗舰', note: '专精复杂编程、分析与自动化编排', inPrice: 3, outPrice: 15 },
  { id: 'gemini-4-argon', tier: '主力', note: '更精简快速的旗舰级均衡模型', inPrice: 1.5, outPrice: 8 },
  { id: 'gemini-4-hydrogen', tier: '轻量', note: '专为 Agent 高速落地执行优化', inPrice: 0.35, outPrice: 1.8 },
  { id: 'gemini-3.8-flash', tier: '轻量', note: '高速低价日常编码执行主力', inPrice: 0.3, outPrice: 2.5 },
  { id: 'gemini-3.5-flash-lite', tier: '轻量', note: '超低延迟高吞吐极速版', inPrice: 0.1, outPrice: 0.4 },
  { id: 'gemini-2.5-pro', tier: '旗舰', note: '上代旗舰（兼容旧接口）', inPrice: 1.25, outPrice: 10 },
  { id: 'gemini-2.5-flash', tier: '轻量', note: '上代快模（兼容旧接口）', inPrice: 0.3, outPrice: 2.5 },
];

const DEEPSEEK_CATALOG: CatalogModel[] = [
  { id: 'deepseek-pro', tier: '旗舰', note: 'DeepSeek-V4-Pro 深度推理与强代码', inPrice: 0.55, outPrice: 2.19 },
  { id: 'deepseek-flash', tier: '主力', note: 'DeepSeek-V4.1-Flash 高速低价主力', inPrice: 0.27, outPrice: 1.1 },
  { id: 'deepseek-reasoner', tier: '旗舰', note: '深度思考兼容模型 ID', inPrice: 0.55, outPrice: 2.19 },
  { id: 'deepseek-chat', tier: '轻量', note: '通用高性价比兼容模型 ID', inPrice: 0.27, outPrice: 1.1 },
];

const OPENROUTER_CATALOG: CatalogModel[] = [
  { id: 'anthropic/claude-fable-5-2', tier: '旗舰', vendor: 'Anthropic', note: '顶级架构与长程推理', inPrice: 8, outPrice: 40 },
  { id: 'anthropic/claude-opus-5-5', tier: '旗舰', vendor: 'Anthropic', note: '重度编程旗舰', inPrice: 4, outPrice: 20 },
  { id: 'openai/gpt-6.2-astra', tier: '旗舰', vendor: 'OpenAI', note: '最强复杂工程推理', inPrice: 8, outPrice: 40 },
  { id: 'openai/gpt-6.2-sol', tier: '主力', vendor: 'OpenAI', note: '生产级主力编程', inPrice: 2, outPrice: 10 },
  { id: 'google/gemini-4-carbon', tier: '旗舰', vendor: 'Google', note: '顶级多模态与复杂推理', inPrice: 5, outPrice: 20 },
  { id: 'google/gemini-4-neon', tier: '旗舰', vendor: 'Google', note: '编程与系统分析专精', inPrice: 3, outPrice: 15 },
  { id: 'deepseek/deepseek-pro', tier: '旗舰', vendor: 'DeepSeek', note: '高性价比强推理', inPrice: 0.55, outPrice: 2.19 },
  { id: 'anthropic/claude-sonnet-5-5', tier: '主力', vendor: 'Anthropic', note: '速度与编码质量兼顾', inPrice: 2, outPrice: 10 },
  { id: 'google/gemini-4-hydrogen', tier: '轻量', vendor: 'Google', note: '专为高速执行优化', inPrice: 0.35, outPrice: 1.8 },
  { id: 'openai/gpt-6-luna', tier: '轻量', vendor: 'OpenAI', note: '极速低价执行', inPrice: 0.25, outPrice: 1.0 },
  { id: 'deepseek/deepseek-flash', tier: '轻量', vendor: 'DeepSeek', note: '极低成本高速执行', inPrice: 0.27, outPrice: 1.1 },
  { id: 'qwen/qwen3-coder', tier: '轻量', vendor: 'Qwen', note: '高性价比开源代码模型', inPrice: 0.3, outPrice: 1.2 },
];

const OLLAMA_CATALOG: CatalogModel[] = [
  { id: 'qwen3-coder:32b', tier: '旗舰', note: '本地大参数代码旗舰（需较高显存）', inPrice: 0, outPrice: 0 },
  { id: 'deepseek-r1:32b', tier: '旗舰', note: '本地深度推理旗舰', inPrice: 0, outPrice: 0 },
  { id: 'qwen3-coder:14b', tier: '主力', note: '本地主流显卡均衡代码模型', inPrice: 0, outPrice: 0 },
  { id: 'gpt-oss:20b', tier: '主力', note: '本地开源通用主力模型', inPrice: 0, outPrice: 0 },
  { id: 'qwen3-coder:7b', tier: '轻量', note: '轻量极速本地代码执行', inPrice: 0, outPrice: 0 },
];

const CUSTOM_RELAY_CATALOG: CatalogModel[] = [
  { id: 'claude-fable-5-2', tier: '旗舰', vendor: 'Anthropic', note: '顶级复杂架构与推理', inPrice: 8, outPrice: 40 },
  { id: 'claude-opus-5-5', tier: '旗舰', vendor: 'Anthropic', note: '重度编程旗舰', inPrice: 4, outPrice: 20 },
  { id: 'gpt-6.2-astra', tier: '旗舰', vendor: 'OpenAI', note: '复杂工程最强推理', inPrice: 8, outPrice: 40 },
  { id: 'gpt-6.2-sol', tier: '主力', vendor: 'OpenAI', note: '生产级主力编程', inPrice: 2, outPrice: 10 },
  { id: 'gemini-4-carbon', tier: '旗舰', vendor: 'Google', note: '多模态推理旗舰', inPrice: 5, outPrice: 20 },
  { id: 'gemini-4-neon', tier: '旗舰', vendor: 'Google', note: '编程分析专精', inPrice: 3, outPrice: 15 },
  { id: 'deepseek-pro', tier: '旗舰', vendor: 'DeepSeek', note: '高性价比推理旗舰', inPrice: 0.55, outPrice: 2.19 },
  { id: 'claude-sonnet-5-5', tier: '主力', vendor: 'Anthropic', note: '均衡编程主力', inPrice: 2, outPrice: 10 },
  { id: 'gemini-4-hydrogen', tier: '轻量', vendor: 'Google', note: '高速 Agent 执行', inPrice: 0.35, outPrice: 1.8 },
  { id: 'gpt-6-luna', tier: '轻量', vendor: 'OpenAI', note: '极速低价执行', inPrice: 0.25, outPrice: 1.0 },
  { id: 'deepseek-flash', tier: '轻量', vendor: 'DeepSeek', note: '极低成本执行', inPrice: 0.27, outPrice: 1.1 },
];

export function getCatalogForProvider(provider?: ProviderConfig): CatalogModel[] {
  if (!provider) return CUSTOM_RELAY_CATALOG;
  if (
    provider.id === 'anthropic-api' ||
    provider.type === 'anthropic' ||
    provider.baseUrl.includes('anthropic.com')
  ) {
    return ANTHROPIC_CATALOG;
  }
  if (
    provider.id === 'openai-api' ||
    provider.type === 'openai-responses' ||
    provider.baseUrl.includes('openai.com')
  ) {
    return OPENAI_CATALOG;
  }
  if (
    provider.id === 'google-gemini' ||
    provider.type === 'google-gemini' ||
    provider.baseUrl.includes('generativelanguage.googleapis.com')
  ) {
    return GEMINI_CATALOG;
  }
  if (provider.id === 'deepseek-api' || provider.baseUrl.includes('deepseek.com')) {
    return DEEPSEEK_CATALOG;
  }
  if (provider.id === 'openrouter-api' || provider.baseUrl.includes('openrouter.ai')) {
    return OPENROUTER_CATALOG;
  }
  if (provider.id === 'ollama-local' || provider.baseUrl.includes('11434')) {
    return OLLAMA_CATALOG;
  }
  return CUSTOM_RELAY_CATALOG;
}

export function getDefaultModelForRole(
  provider: ProviderConfig | undefined,
  role: 'planner' | 'executor',
): CatalogModel {
  const catalog = getCatalogForProvider(provider);
  if (role === 'planner') {
    return catalog.find((m) => m.tier === '旗舰') ?? catalog[0];
  }
  return (
    catalog.find((m) => m.tier === '主力') ??
    catalog.find((m) => m.tier === '轻量') ??
    catalog[catalog.length - 1]
  );
}
