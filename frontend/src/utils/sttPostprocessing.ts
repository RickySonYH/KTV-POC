// [advice from AI] STT 후처리 유틸리티
// 백엔드 AdminPanel에서 설정한 데이터를 가져와서 적용

const API_BASE = '/api/v1/admin';

// [advice from AI] 캐시된 사전 데이터
let cachedProfanity: string[] = [];
let cachedProperNouns: Record<string, string> = {};
let cachedGovernmentTerms: Record<string, string> = {};
let cachedAbbreviations: Record<string, string> = {};
let cachedHallucinationPatterns: string[] = [];
let cachedSensitivePatterns: string[] = [];
let isLoaded = false;
let isLoading = false;

/**
 * 백엔드 DictionaryResponse 형식을 파싱
 * { dictionary_type, items: [...], total }
 */
interface DictResponse {
  dictionary_type: string;
  items: unknown[];
  total: number;
}

interface KeyValueItem {
  key: string;
  value: string;
}

/**
 * 배열 형식 응답 파싱 (profanity, hallucination)
 */
function parseArrayResponse(res: DictResponse): string[] {
  return (res?.items || []) as string[];
}

/**
 * [advice from AI] 민감정보 패턴 응답 파싱 (sensitive)
 * - 형식: { pattern: string, replacement: string }[]
 * - pattern만 추출하여 반환
 */
function parseSensitiveResponse(res: DictResponse): string[] {
  const items = (res?.items || []) as Array<{ pattern: string; replacement: string }>;
  return items.map(item => item.pattern).filter(p => p && typeof p === 'string');
}

/**
 * key-value 형식 응답 파싱 (proper-nouns, government-dict, abbreviations)
 */
function parseKeyValueResponse(res: DictResponse): Record<string, string> {
  const items = (res?.items || []) as KeyValueItem[];
  const result: Record<string, string> = {};
  for (const item of items) {
    if (item.key && item.value) {
      result[item.key] = item.value;
    }
  }
  return result;
}

/**
 * 백엔드에서 사전 데이터 로드
 */
export async function loadDictionaries(): Promise<void> {
  if (isLoaded || isLoading) return;
  
  isLoading = true;
  console.log('[STT-Postprocess] 📚 사전 데이터 로딩 중...');
  
  try {
    // [advice from AI] 백엔드 엔드포인트 (hallucination-patterns가 아닌 hallucination)
    const [profanityRes, properNounsRes, govTermsRes, abbreviationsRes, hallucinationRes, sensitiveRes] = await Promise.all([
      fetch(`${API_BASE}/profanity`).then(r => r.ok ? r.json() : { items: [] }),
      fetch(`${API_BASE}/proper-nouns`).then(r => r.ok ? r.json() : { items: [] }),
      fetch(`${API_BASE}/government-dict`).then(r => r.ok ? r.json() : { items: [] }),
      fetch(`${API_BASE}/abbreviations`).then(r => r.ok ? r.json() : { items: [] }),
      fetch(`${API_BASE}/hallucination`).then(r => r.ok ? r.json() : { items: [] }),
      fetch(`${API_BASE}/sensitive-patterns`).then(r => r.ok ? r.json() : { items: [] }),
    ]);
    
    // [advice from AI] 응답 형식에 맞게 파싱
    cachedProfanity = parseArrayResponse(profanityRes);
    cachedProperNouns = parseKeyValueResponse(properNounsRes);
    cachedGovernmentTerms = parseKeyValueResponse(govTermsRes);
    cachedAbbreviations = parseKeyValueResponse(abbreviationsRes);
    cachedHallucinationPatterns = parseArrayResponse(hallucinationRes);
    // [advice from AI] sensitive는 { pattern, replacement } 형태이므로 별도 파싱
    cachedSensitivePatterns = parseSensitiveResponse(sensitiveRes);
    
    isLoaded = true;
    console.log('[STT-Postprocess] ✅ 사전 데이터 로드 완료:', {
      profanity: cachedProfanity.length,
      properNouns: Object.keys(cachedProperNouns).length,
      governmentTerms: Object.keys(cachedGovernmentTerms).length,
      abbreviations: Object.keys(cachedAbbreviations).length,
      hallucination: cachedHallucinationPatterns.length,
      sensitive: cachedSensitivePatterns.length,
    });
    
    // [advice from AI] 디버깅용 상세 로그
    if (cachedProfanity.length > 0) {
      console.log('[STT-Postprocess] 📋 비속어 샘플:', cachedProfanity.slice(0, 3));
    }
    if (Object.keys(cachedAbbreviations).length > 0) {
      console.log('[STT-Postprocess] 📋 약어 샘플:', Object.entries(cachedAbbreviations).slice(0, 3));
    }
    if (cachedHallucinationPatterns.length > 0) {
      console.log('[STT-Postprocess] 📋 할루시네이션 샘플:', cachedHallucinationPatterns.slice(0, 3));
    }
  } catch (error) {
    console.error('[STT-Postprocess] ❌ 사전 로드 실패:', error);
    // 실패해도 기본값으로 계속 진행
    isLoaded = true;
  } finally {
    isLoading = false;
  }
}

/**
 * 사전 데이터 강제 리로드 (AdminPanel에서 설정 변경 시 호출)
 */
export async function reloadDictionaries(): Promise<void> {
  isLoaded = false;
  isLoading = false;
  await loadDictionaries();
}

/**
 * 기본 할루시네이션 패턴 (백엔드 데이터 로드 전/실패 시 사용)
 * [advice from AI] 더 포괄적인 패턴 - Whisper 모델의 일반적인 할루시네이션
 */
const DEFAULT_HALLUCINATION_PATTERNS: RegExp[] = [
  // 영어 할루시네이션 (YouTube/구독 관련)
  /thank\s*you/i,
  /thanks\s*for\s*watching/i,
  /please\s*subscribe/i,
  /like\s*and\s*subscribe/i,
  /see\s*you\s*(next|in\s*the)/i,
  /^(hello|hi|bye|goodbye)[.!]?$/i,
  
  // 한국어 할루시네이션 (YouTube/구독/방송 관련)
  /시청.*감사/,          // "시청해주셔서 감사합니다" 등
  /구독.*좋아요/,        // "구독과 좋아요" 등
  /좋아요.*구독/,
  /채널.*구독/,
  /^감사합니다\.?$/,
  /^고맙습니다\.?$/,
  /^안녕하세요\.?$/,
  /^안녕히\s*가세요\.?$/,
  /다음\s*(시간|영상|에)/,  // "다음 시간에 봬요" 등
  
  // 자막/번역 관련
  /^자막.*$/,
  /subtitle/i,
  /caption/i,
  /번역.*제공/,
  
  // 특수 문자/기호만
  /^[\s\.\,\!\?\-\~\♪\♫\*\#\@]+$/,
  /^\.{2,}$/,
  
  // 음악/배경음/효과음
  /^음성\s*없음$/,
  /^무음$/,
  /^음악/,
  /박수\s*소리/,
  /환호\s*소리/,
  /^\[.*\]$/,  // [음악], [박수] 등
  /^\(.*\)$/,  // (음악), (박수) 등
  
  // 반복 패턴 (Whisper 특유)
  /^(네|예|음|어|아)+$/,
  /^(네네|예예|음음|어어)+$/,
  /(.)\1{4,}/,  // 같은 문자 5번 이상 반복
];

/**
 * 할루시네이션 여부 확인 (로그 최소화)
 */
export function isHallucination(text: string): boolean {
  if (!text) return true;

  const trimmed = text.trim();

  // 1. 너무 짧은 텍스트 (1글자 이하만 필터)
  if (trimmed.length <= 1) return true;
  
  // 2. 의미 없는 짧은 반복 단어만 필터
  const meaninglessShortWords = ['네네', '예예', '음음', '어어', '아아', '네에', '예에'];
  if (meaninglessShortWords.includes(trimmed)) return true;

  // 3. 백엔드에서 가져온 할루시네이션 패턴 체크
  for (const patternStr of cachedHallucinationPatterns) {
    try {
      const pattern = new RegExp(patternStr, 'i');
      if (pattern.test(trimmed)) return true;
    } catch (e) {
      // 잘못된 정규식 무시
    }
  }

  // 4. 기본 할루시네이션 패턴 체크
  for (const pattern of DEFAULT_HALLUCINATION_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  // 5. 동일 단어 반복 (3회 이상)
  const words = trimmed.split(/\s+/);
  if (words.length >= 3) {
    for (let i = 0; i < words.length - 2; i++) {
      if (words[i] === words[i + 1] && words[i + 1] === words[i + 2]) {
        return true;
      }
    }
  }

  // 6. 모든 단어가 동일
  if (words.length >= 2) {
    const uniqueWords = new Set(words);
    if (uniqueWords.size === 1) return true;
  }

  return false;
}

/**
 * 텍스트 정리
 */
export function cleanText(text: string): string {
  if (!text) return '';

  let result = text.trim();

  // 연속 공백을 하나로
  result = result.replace(/\s+/g, ' ');

  // 음표 기호 정리
  result = result.replace(/[♪♫🎵🎶]+/g, '[♪]');

  // 앞뒤 마침표/쉼표 정리
  result = result.replace(/^[.,!?\s]+|[.,!?\s]+$/g, '');

  return result;
}

/**
 * 비속어 필터 적용
 */
export function filterProfanity(text: string): string {
  if (!text) return text;
  
  let result = text;
  for (const word of cachedProfanity) {
    if (word) {
      const pattern = new RegExp(word, 'gi');
      const replacement = '*'.repeat(word.length);
      result = result.replace(pattern, replacement);
    }
  }
  return result;
}

/**
 * 고유명사 사전 매칭
 */
export function applyProperNouns(text: string): string {
  if (!text) return text;
  
  let result = text;
  for (const [wrong, correct] of Object.entries(cachedProperNouns)) {
    if (wrong && text.includes(wrong)) {
      const pattern = new RegExp(wrong, 'gi');
      const before = result;
      result = result.replace(pattern, correct);
      if (before !== result) {
        console.log(`[후처리] 고유명사: "${wrong}" → "${correct}"`);
      }
    }
  }
  return result;
}

/**
 * 정부 용어 사전 매칭
 */
export function applyGovernmentTerms(text: string): string {
  if (!text) return text;
  
  let result = text;
  for (const [wrong, correct] of Object.entries(cachedGovernmentTerms)) {
    if (wrong && text.includes(wrong)) {
      const pattern = new RegExp(wrong, 'gi');
      const before = result;
      result = result.replace(pattern, correct);
      if (before !== result) {
        console.log(`[후처리] 정부용어: "${wrong}" → "${correct}"`);
      }
    }
  }
  return result;
}

/**
 * 약어 사전 매칭
 */
export function applyAbbreviations(text: string): string {
  if (!text) return text;
  
  let result = text;
  for (const [korean, english] of Object.entries(cachedAbbreviations)) {
    if (korean) {
      const pattern = new RegExp(korean, 'gi');
      result = result.replace(pattern, english);
    }
  }
  return result;
}

/**
 * 민감정보 마스킹
 */
export function maskSensitiveInfo(text: string): string {
  if (!text) return text;
  
  let result = text;
  for (const patternStr of cachedSensitivePatterns) {
    try {
      const pattern = new RegExp(patternStr, 'gi');
      result = result.replace(pattern, '[***]');
    } catch (e) {
      // 잘못된 정규식 무시
    }
  }
  return result;
}

/**
 * [advice from AI] 강력한 할루시네이션 패턴 - 길이와 관계없이 항상 필터
 * Whisper 모델이 자주 생성하는 명확한 오류
 */
const STRONG_HALLUCINATION_PATTERNS: RegExp[] = [
  /시청.*감사/i,       // "시청해주셔서 감사합니다" 등
  /구독.*좋아요/i,     // "구독과 좋아요" 등
  /좋아요.*구독/i,
  /채널.*구독/i,
  /다음\s*영상에서\s*만나/i,
  /thank\s*you\s*for\s*watching/i,
  /please\s*subscribe/i,
  /like\s*and\s*subscribe/i,
];

/**
 * 전체 후처리 파이프라인
 * @param text 입력 텍스트
 * @param forSubtitleList 자막 목록용 (true면 할루시네이션 필터 더 관대하게)
 */
export function postprocessText(text: string, forSubtitleList: boolean = false): string {
  if (!text) return '';

  // 0. 사전이 로드되지 않았으면 비동기 로드 시작 (첫 호출 시)
  if (!isLoaded && !isLoading) {
    loadDictionaries();
  }

  // 1. 텍스트 정리
  let result = cleanText(text);

  // [advice from AI] 2-1. 강력한 할루시네이션 패턴은 길이와 관계없이 항상 필터
  for (const pattern of STRONG_HALLUCINATION_PATTERNS) {
    if (pattern.test(result)) {
      console.log(`[POSTPROCESS] 🚫 강력 할루시네이션: "${result.substring(0, 30)}..."`);
      return '';
    }
  }

  // 2-2. 일반 할루시네이션 체크
  if (forSubtitleList) {
    // 자막 목록: 15자 이상이면 할루시네이션 체크 스킵 (더 관대하게)
    if (result.length < 15 && isHallucination(result)) {
      return '';
    }
  } else {
    // 실시간 화면: 기존 로직 유지
    if (isHallucination(result)) {
      return '';
    }
  }

  // 3. 비속어 필터
  result = filterProfanity(result);

  // 4. 고유명사 매칭
  result = applyProperNouns(result);

  // 5. 정부 용어 매칭
  result = applyGovernmentTerms(result);

  // 6. 약어 매칭
  result = applyAbbreviations(result);

  // [advice from AI] 민감정보 마스킹 비활성화 - 오탐이 많아서 제거
  // result = maskSensitiveInfo(result);

  return result;
}

/**
 * 사전 로드 상태 확인
 */
export function isDictionaryLoaded(): boolean {
  return isLoaded;
}

/**
 * 현재 캐시된 사전 데이터 반환 (디버깅용)
 */
export function getCachedDictionaries() {
  return {
    profanity: cachedProfanity,
    properNouns: cachedProperNouns,
    governmentTerms: cachedGovernmentTerms,
    abbreviations: cachedAbbreviations,
    hallucinationPatterns: cachedHallucinationPatterns,
    sensitivePatterns: cachedSensitivePatterns,
  };
}
