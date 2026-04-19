# 라운드 5: 비용 분석 정확성 평가

> 평가자: AI/LLM 전문가
> 점수: **6/10**

---

## 검토 대상 파일

- `packages/storage/src/queries/request.ts` - 비용 계산 로직
- `packages/server/src/api.ts` - API 엔드포인트

---

## 비용 계산 로직 분석

```typescript
// request.ts
const MODEL_PRICING: Array<{ prefix: string; pricing: ModelPricing }> = [
  {
    prefix: 'claude-opus-4-',
    pricing: { input: 15, output: 75, cache_create: 18.75, cache_read: 1.50 },
  },
  {
    prefix: 'claude-sonnet-4-',
    pricing: { input: 3, output: 15, cache_create: 3.75, cache_read: 0.30 },
  },
  {
    prefix: 'claude-haiku-4-',
    pricing: { input: 0.80, output: 4, cache_create: 1, cache_read: 0.08 },
  },
];

// 비용 계산
const tokensInput = row.tokens_input;
const tokensOutput = row.tokens_output;
const cacheCreation = row.cache_creation_tokens ?? 0;
const cacheRead = row.cache_read_tokens ?? 0;

cost_usd += (tokensInput * p.input + 
             tokensOutput * p.output + 
             cacheCreation * p.cache_create + 
             cacheRead * p.cache_read) / 1_000_000;

// 캐시 절약 계산
cache_savings_usd += (cacheRead * (p.input - p.cache_read)) / 1_000_000;
```

---

## 강점

### 1. 모델별 단가 반영
- Claude Opus/Sonnet/Haiku별 다른 단가 적용
- input/output/cache 구분

### 2. 캐시 절약 계산
```typescript
cache_savings_usd += (cacheRead * (p.input - p.cache_read)) / 1_000_000;
```
- prompt caching 효과를 금액으로 환산
- "얼마나 절약했는가" 가시화

### 3. P95 지표
```typescript
const p95DurationMs = getP95DurationMs(db, fromTs, toTs);
```
- 응답 시간 P95 백분위 측정
- 성능 모니터링에 유용

---

## 약점/문제점

### 1. 가격 하드코딩 (치명적) 🔴

```typescript
const MODEL_PRICING = [
  { prefix: 'claude-opus-4-', pricing: { input: 15, output: 75, ... } },
  // Anthropic이 가격을 바꾸면?
]
```

**문제:**
- Anthropic 가격 변경 시 코드 수정 및 재배포 필요
- 2024년 가격 기준으로 고정됨
- 지역별 가격 차이 반영 불가

**실제 가격 변경 사례:**
- 2024년 3월: Claude 3 Opus 출시
- 2024년 6월: Claude 3.5 Sonnet 출시 (가격 변동)
- 미래: 가격 인하/인상 가능성

### 2. 접두사 매칭 방식의 위험성

```typescript
function getPricingForModel(model: string | null): ModelPricing {
  if (!model) return DEFAULT_PRICING;
  for (const { prefix, pricing } of MODEL_PRICING) {
    if (model.startsWith(prefix)) return pricing;
  }
  return DEFAULT_PRICING;
}
```

**문제:**
```typescript
// 'claude-opus-4-7-20251001-v2' 같은 신규 모델은?
// 'claude-opus-5'가 나오면?
// 매칭 실패 시 DEFAULT_PRICING 사용 (부정확)
```

### 3. DEFAULT_PRICING fallback

```typescript
function getPricingForModel(model: string | null): ModelPricing {
  if (!model) return DEFAULT_PRICING; // 모르는 모델은 기본값?
  // ...
  return DEFAULT_PRICING; // 매칭 실패 시 기본값
}

const DEFAULT_PRICING: ModelPricing = {
  input: 3,      // Sonnet 가격?
  output: 15,    // Sonnet 가격?
  cache_create: 3.75,
  cache_read: 0.30,
};
```

**문제:**
- 알 수 없는 모델에 대해 잘못된 가격 적용
- 사용자에게 잘못된 비용 정보 제공

### 4. 세금/할인 미고려

```typescript
// 현재: 순수 토큰 비용만 계산
// 미고려 항목:
// - 세금 (VAT 등)
// - 기업 할인
// - 묶음 구매 할인
// - 크레딧/프로모션
```

### 5. 환율 변동 미고려

```typescript
// USD 고정
// 사용자는 KRW, EUR 등으로 결제 가능
// 환율 변동 시 실제 청구액과 차이 발생
```

---

## 검증 테스트 (가상)

| 시나리오 | 예상 결과 | 실제 동작 | 문제 여부 |
|---------|----------|----------|----------|
| Claude Opus 4 사용 | Opus 가격 적용 | ✅ | - |
| Claude Sonnet 4 사용 | Sonnet 가격 적용 | ✅ | - |
| 신규 모델 (claude-opus-5) | 알 수 없음 또는 추정 | DEFAULT_PRICING | ⚠️ 부정확 |
| 모델명 null | DEFAULT_PRICING | DEFAULT_PRICING | ⚠️ 부정확 |
| 캐시 토큰 많음 | 절약액 증가 | ✅ | - |

---

## 개선 제안

### 1. 외부 설정 파일

```json
// ~/.spyglass/pricing.json
{
  "version": "2024-06-01",
  "models": [
    {
      "id": "claude-opus-4",
      "input_price": 15.00,
      "output_price": 75.00,
      "cache_create_price": 18.75,
      "cache_read_price": 1.50,
      "effective_date": "2024-03-01"
    }
  ],
  "update_url": "https://api.spyglass.dev/pricing"
}
```

### 2. 가격 정보 캐싱 및 갱신

```typescript
// pricing.ts
class PricingManager {
  private cache: Map<string, ModelPricing> = new Map();
  private lastUpdate: number = 0;
  
  async getPricing(model: string): Promise<ModelPricing | null> {
    // 캐시 확인
    if (this.cache.has(model)) {
      return this.cache.get(model)!;
    }
    
    // 원격 갱신 (24시간마다)
    if (Date.now() - this.lastUpdate > 24 * 60 * 60 * 1000) {
      await this.refreshPricing();
    }
    
    return this.cache.get(model) || null;
  }
  
  private async refreshPricing(): Promise<void> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/pricing');
      const pricing = await response.json();
      this.cache = new Map(pricing.models.map(m => [m.id, m.pricing]));
      this.lastUpdate = Date.now();
    } catch {
      // 갱신 실패 시 캐시 유지
    }
  }
}
```

### 3. 신규 모델 경고

```typescript
function getPricingForModel(model: string | null): ModelPricing | null {
  if (!model) {
    console.warn('[Pricing] Model name is null');
    return null;
  }
  
  for (const { prefix, pricing } of MODEL_PRICING) {
    if (model.startsWith(prefix)) return pricing;
  }
  
  // 알 수 없는 모델 경고
  console.warn(`[Pricing] Unknown model: ${model}. Please update pricing config.`);
  
  // null 반환 (추정하지 않음)
  return null;
}

// UI에 표시
// Cost: $12.45 (estimated)
// ⚠️ Unknown model: claude-opus-5
```

### 4. 환율 지원

```typescript
// 비용 계산 시 환율 적용
interface CostBreakdown {
  usd: number;
  local: {
    amount: number;
    currency: string;
    exchangeRate: number;
  } | null;
}

function calculateCost(tokens: TokenUsage, model: string, userCurrency: string = 'USD'): CostBreakdown {
  const usdCost = calculateUsdCost(tokens, model);
  
  if (userCurrency === 'USD') {
    return { usd: usdCost, local: null };
  }
  
  const rate = getExchangeRate('USD', userCurrency);
  return {
    usd: usdCost,
    local: {
      amount: usdCost * rate,
      currency: userCurrency,
      exchangeRate: rate
    }
  };
}
```

---

## 실용성 점수: 6/10

**근거:**
- ✅ 모델별 단가 반영은 올바른 접근
- ✅ 캐시 절약 계산은 prompt caching 분석에 유용
- ⚠️ 하드코딩된 가격은 Anthropic 가격 변경 시 대응 늦음
- ⚠️ 신규 모델 매칭 실패 시 DEFAULT_PRICING 사용은 위험
- ❌ 세금/할인/환율 미고려는 실제 청구액과 차이 발생
- ❌ 'claude-opus-5'가 나오면 코드 수정이 필요함

**AI/LLM 전문가 의견:**
> "가격을 하드코딩하면 Anthropic이 가격을 바꿨을 때 대응이 늦습니다. API로 실시간 가격을 받아오거나, 최소한 설정 파일로 분리해야 합니다. 'claude-opus-5'가 나오면 코드 수정이 필요합니다."
>
> **권장:** 외부 JSON 설정 파일로 분리하고, 신규 모델 감지 시 경고를 표시하세요.
