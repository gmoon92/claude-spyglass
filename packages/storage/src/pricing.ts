/**
 * 모델 가격 관리 (외부 설정 지원)
 *
 * @description ~/.spyglass/pricing.json에서 가격 정보를 로드하거나 기본값 사용
 */

import fs from 'fs';
import path from 'path';

// =============================================================================
// 타입 정의
// =============================================================================

/**
 * 모델별 가격 정보 (USD per 1M tokens)
 */
export interface ModelPricingEntry {
  model: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

/**
 * 내부 사용 가격 구조
 */
export interface ModelPricing {
  input: number;
  output: number;
  cache_create: number;
  cache_read: number;
}

// =============================================================================
// 기본값 (하드코딩 폴백)
// =============================================================================

const DEFAULT_PRICING: ModelPricingEntry[] = [
  {
    model: 'claude-opus-4-',
    input: 15,
    output: 75,
    cacheCreate: 18.75,
    cacheRead: 1.50,
  },
  {
    model: 'claude-haiku-4-',
    input: 0.80,
    output: 4,
    cacheCreate: 1.00,
    cacheRead: 0.08,
  },
  {
    model: 'claude-sonnet-4-',
    input: 3,
    output: 15,
    cacheCreate: 3.75,
    cacheRead: 0.30,
  },
];

const DEFAULT_FALLBACK_PRICING: ModelPricing = {
  input: 3,
  output: 15,
  cache_create: 3.75,
  cache_read: 0.30,
};

// =============================================================================
// 캐시 및 로드 함수
// =============================================================================

/** 캐시된 가격 정보 */
let cachedPricing: ModelPricingEntry[] | null = null;

/**
 * ~/.spyglass/pricing.json에서 가격 정보 로드
 * 파일이 없으면 기본값으로 초기화하고 반환
 */
export function loadPricing(): ModelPricingEntry[] {
  if (cachedPricing !== null) {
    return cachedPricing;
  }

  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    console.warn('[Pricing] HOME directory not found, using default pricing');
    cachedPricing = DEFAULT_PRICING;
    return cachedPricing;
  }

  const pricingPath = path.join(home, '.spyglass', 'pricing.json');

  try {
    if (fs.existsSync(pricingPath)) {
      const content = fs.readFileSync(pricingPath, 'utf-8');
      const parsed = JSON.parse(content) as ModelPricingEntry[];
      cachedPricing = parsed;
      return cachedPricing;
    }
  } catch (error) {
    console.warn(`[Pricing] Failed to load pricing from ${pricingPath}: ${error}`);
  }

  // 파일이 없거나 파싱 실패 시 기본값으로 초기화
  try {
    const spyglassDir = path.join(home, '.spyglass');
    if (!fs.existsSync(spyglassDir)) {
      fs.mkdirSync(spyglassDir, { recursive: true });
    }
    fs.writeFileSync(pricingPath, JSON.stringify(DEFAULT_PRICING, null, 2));
    console.log(`[Pricing] Created default pricing file: ${pricingPath}`);
  } catch (error) {
    console.warn(`[Pricing] Failed to create pricing file: ${error}`);
  }

  cachedPricing = DEFAULT_PRICING;
  return cachedPricing;
}

/**
 * 모델명 → 가격 정보 반환
 * @param model 모델명 (예: "claude-opus-4-7")
 * @returns 매칭되는 가격 정보, 없으면 기본값
 */
export function getPricingForModel(model: string | null): ModelPricing {
  if (!model) return DEFAULT_FALLBACK_PRICING;

  const pricing = loadPricing();
  for (const entry of pricing) {
    if (model.startsWith(entry.model)) {
      return {
        input: entry.input,
        output: entry.output,
        cache_create: entry.cacheCreate,
        cache_read: entry.cacheRead,
      };
    }
  }

  return DEFAULT_FALLBACK_PRICING;
}

/**
 * 캐시 초기화 (테스트용)
 */
export function resetPricingCache(): void {
  cachedPricing = null;
}
