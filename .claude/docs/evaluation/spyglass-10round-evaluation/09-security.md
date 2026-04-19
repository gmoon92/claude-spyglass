# 라운드 8: 보안 및 개인정보 평가

> 평가자: 데이터 엔지니어링 전문가
> 점수: **5.5/10**

---

## 검토 대상 파일

- `hooks/spyglass-collect.sh` - 훅 스크립트
- `packages/server/src/collect.ts` - 데이터 수집
- `packages/storage/src/schema.ts` - 데이터 저장

---

## 강점

### 1. 로컬 데이터 저장
```bash
~/.spyglass/spyglass.db  # 로컬 SQLite만 사용
```
- 수집된 데이터가 클라우드로 나가지 않음
- 데이터 주권 확보

### 2. 외부 전송 없음
```bash
# spyglass-collect.sh
SPYGLASS_COLLECT_ENDPOINT="http://${SPYGLASS_HOST}:${SPYGLASS_PORT}/collect"
# 로컬 서버로만 전송
```

### 3. 훅 타임아웃
```bash
SPYGLASS_TIMEOUT="${SPYGLASS_TIMEOUT:-1}"  # 1초 타임아웃
# 무한 대기 방지
```

---

## 약점/문제점

### 1. 원본 payload에 민감 정보 포함 (치명적) 🔴

```bash
# hooks/spyglass-collect.sh
echo "$payload" >> "$SPYGLASS_RAW_LOG"  # 원본 저장
```

**payload에 포함될 수 있는 정보:**
| 정보 유형 | 예시 | 위험도 |
|----------|------|--------|
| API 키 | `anthropic_api_key` | 🔴 높음 |
| 비밀번호 | `database_password` | 🔴 높음 |
| 개인정보 | 주민번호, 전화번호 | 🔴 높음 |
| 프로젝트 내부 파일 경로 | `/company/secret/project` | 🟡 중간 |
| 코드 내용 | 내부 비즈니스 로직 | 🟡 중간 |

### 2. 로그 파일 접근 권한 미확인

```bash
# hooks/spyglass-collect.sh
ensure_log_dir() {
    if [[ ! -d "$SPYGLASS_LOG_DIR" ]]; then
        mkdir -p "$SPYGLASS_LOG_DIR"  # 권한 설정 없음
    fi
}
```

**문제:**
- `~/.spyglass/logs/hook-raw.jsonl` 파일 권한 확인 없음
- 다른 사용자가 읽을 수 있는 권한으로 생성될 수 있음

### 3. payload를 그대로 저장

```typescript
// collect.ts
payload: JSON.stringify(raw),  // 원본 그대로

// tool_input에 비밀번호 등 포함될 수 있음
// 예: Bash 도구로 DB 비밀번호 전달
// {
//   "tool_name": "Bash",
//   "tool_input": {
//     "command": "psql -U admin -p secret_password123"
//   }
// }
```

### 4. 민감 정보 필터링 없음

```typescript
// collect.ts - extractToolDetail
function extractToolDetail(toolName: string, toolInput: Record<string, unknown>): string | null {
  // 민감 정보 마스킹 없음
  case 'Bash': {
    const cmd = toolInput.command as string | undefined;
    return cmd ? cmd.slice(0, 80) : null;  // 그대로 저장
  }
}
```

### 5. 데이터 보관 정책 부재

```typescript
// schema.ts - 보관 기간 설정 없음
// 30일 이후 자동 삭제? 없음
// 사용자 데이터 삭제 기능? 없음
```

---

## 보안 사고 시나리오

### 시나리오 1: 노트북 분실
```
1. 개발자가 회사 노트북 분실
2. ~/.spyglass/spyglass.db에 API 키 저장됨
3. 누군가 DB 파일 열면 API 키 노출
```

### 시나리오 2: 팀 공유 서버
```
1. 여러 개발자가 같은 서버 사용
2. ~/.spyglass/ 디렉토리 권한이 755
3. 다른 개발자가 로그 파일 읽기 가능
4. 동료의 프롬프트와 파일 경로 열람
```

### 시나리오 3: 백업 유출
```
1. 개발자가 ~ 디렉토리 백업
2. 백업 파일에 spyglass.db 포함
3. 백업을 안전하지 않은 위치에 저장
4. 민감 데이터 유출
```

---

## 개선 제안

### 1. PII 필터링

```typescript
// collect.ts - 민감 정보 마스킹
const SENSITIVE_PATTERNS = [
  { pattern: /api[_-]?key[:=]\s*['"]?([a-zA-Z0-9_-]+)['"]?/gi, replacement: 'api_key=***' },
  { pattern: /password[:=]\s*['"]?([^\s'"]+)['"]?/gi, replacement: 'password=***' },
  { pattern: /sk-[a-zA-Z0-9]{48}/g, replacement: 'sk-***' },  // OpenAI/Anthropic API 키
];

function maskSensitiveData(payload: string): string {
  let masked = payload;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  return masked;
}

// 저장 시 마스킹 적용
const maskedPayload = maskSensitiveData(JSON.stringify(raw));
```

### 2. 파일 권한 설정

```bash
# hooks/spyglass-collect.sh 개선
ensure_log_dir() {
    if [[ ! -d "$SPYGLASS_LOG_DIR" ]]; then
        mkdir -p "$SPYGLASS_LOG_DIR"
        chmod 700 "$SPYGLASS_LOG_DIR"  # 소유자만 접근 가능
    fi
}

# 로그 파일 생성 시
log() {
    ensure_log_dir
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$SPYGLASS_LOG_FILE"
    chmod 600 "$SPYGLASS_LOG_FILE"  # 소유자만 읽기/쓰기
}
```

### 3. 선택적 원본 저장

```typescript
// 설정으로 원본 저장 여부 선택
interface PrivacySettings {
  storeRawPayload: boolean;  // 기본값: false
  maskToolInput: boolean;    // 기본값: true
  retentionDays: number;     // 기본값: 30
}

// storeRawPayload=false일 때
const payloadToStore = settings.storeRawPayload 
  ? JSON.stringify(raw)
  : JSON.stringify({
      hook_event_name: raw.hook_event_name,
      session_id: raw.session_id,
      // tool_input, prompt 등 제외
    });
```

### 4. 데이터 보관 정책

```typescript
// data-retention.ts
export function cleanupOldData(db: Database, retentionDays: number = 30) {
  const cutoffDate = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  
  db.transaction(() => {
    // 오래된 requests 삭제
    db.run('DELETE FROM requests WHERE timestamp < ?', cutoffDate);
    
    // 오래된 claude_events 삭제
    db.run('DELETE FROM claude_events WHERE timestamp < ?', cutoffDate);
    
    // 연결된 sessions 정리
    db.run(`
      DELETE FROM sessions 
      WHERE ended_at IS NOT NULL 
      AND ended_at < ?
    `, cutoffDate);
  })();
  
  console.log(`Cleaned up data older than ${retentionDays} days`);
}

// 주기적 실행
setInterval(() => cleanupOldData(db), 24 * 60 * 60 * 1000);  // 매일
```

### 5. 암호화 옵션

```typescript
// encryption.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export class DataEncryption {
  private key: Buffer;
  
  constructor(password: string) {
    // 비밀번호에서 키 파생
    this.key = deriveKey(password);
  }
  
  encrypt(data: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted.toString('hex');
  }
  
  decrypt(encryptedData: string): string {
    const [ivHex, authTagHex, encryptedHex] = encryptedData.split(':');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return decipher.update(Buffer.from(encryptedHex, 'hex')) + decipher.final('utf8');
  }
}
```

---

## 실용성 점수: 5.5/10

**근거:**
- ✅ 로컬 저장은 데이터 유출 위험 감소
- ✅ 외부 전송 없음은 긍정적
- ⚠️ 로그 파일 권한 설정은 미흡
- ❌ 민감 정보 마스킹 없음은 심각한 문제
- ❌ 원본 payload 저장은 보안 사고 위험
- ❌ 데이터 보관 정책 부재

**데이터 전문가 의견:**
> "로컬 저장은 좋지만, 원본 payload를 그대로 저장하면 보안 문제가 있습니다. API 키나 비밀번호가 포함된 프롬프트가 로그에 남을 수 있습니다. PII 필터링이나 마스킹 기능이 필요합니다."
>
> **권장:** 민감 정보 자동 마스킹, 파일 권한 설정, 데이터 보관 정책을 필수로 구현하세요.
