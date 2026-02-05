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
 * [advice from AI] ★ 자연스럽게 반복될 수 있는 단어 (Python HallucinationDetector 포팅)
 * 반복 패턴 감지에서 제외
 */
const NATURAL_REPEAT_WORDS = new Set([
  '그', '이', '그런', '이런', '그거', '이거', '그게', '이게', '그냥', '이제',
  '다', '더', '또', '같은', '같이', '처럼', '하게', '하는', '되는', '있는',
  '것', '거', '게', '걸', '건', '겠', '고', '을', '를', '에', '의', '은', '는',
  '그래서', '그러니까', '그런데', '그러면', '그리고', '그런', '그러한',
  '저희', '저기', '여기', '거기', '이거', '그거', '저거', '이런', '그런', '저런',
  '뭐', '어', '음', '그', '네', '예', '응', '어음', '아음',
  '혹시라도', '혹시', '만약', '만약에', '아마', '아마도', '어쩌면',
  '일단', '일단은', '그냥', '그냥은', '그러면', '그러니까', '그런데',
  '안', '못', '마', '말', '좀', '조금', '잠깐', '잠시', '제발', '꼭',
]);

/**
 * [advice from AI] ★ 개선된 반복 패턴 감지 (Python HallucinationDetector._has_repetitive_pattern_improved 포팅)
 */
function hasRepetitivePattern(text: string): { isRepetitive: boolean; type: string; count: number } {
  const result = { isRepetitive: false, type: '', count: 0 };
  
  if (text.length < 4) return result;
  
  // 1. 같은 글자가 5번 이상 연속 반복
  const charRepeatThreshold = 5;
  for (let i = 0; i <= text.length - charRepeatThreshold; i++) {
    const char = text[i];
    // 공백과 숫자는 제외
    if (char !== ' ' && !/\d/.test(char)) {
      let repeatCount = 1;
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] === char) {
          repeatCount++;
        } else {
          break;
        }
      }
      if (repeatCount >= charRepeatThreshold) {
        return { isRepetitive: true, type: 'char', count: repeatCount };
      }
    }
  }
  
  // 2. 구문(phrase) 반복 패턴 감지
  const words = text.split(/\s+/);
  if (words.length >= 6) {
    for (let phraseLen = 2; phraseLen < Math.min(6, Math.floor(words.length / 2) + 1); phraseLen++) {
      const phraseCounts: Record<string, number> = {};
      for (let i = 0; i <= words.length - phraseLen; i++) {
        const phrase = words.slice(i, i + phraseLen).join(' ');
        const phraseKey = phrase.replace(/[.,!?]/g, '').toLowerCase();
        
        // 5글자 이상 구문만 카운트
        if (phraseKey.replace(/\s/g, '').length >= 5) {
          phraseCounts[phraseKey] = (phraseCounts[phraseKey] || 0) + 1;
        }
      }
      
      // 5번 이상 반복되면 할루시네이션
      for (const [phrase, count] of Object.entries(phraseCounts)) {
        if (count >= 5 && !['그런데', '그래서', '그러니까', '그리고', '하지만'].includes(phrase)) {
          return { isRepetitive: true, type: 'phrase', count };
        }
      }
    }
  }
  
  // 3. 같은 단어가 3번 이상 연속 반복 (자연스러운 단어 제외)
  if (words.length >= 3) {
    for (let i = 0; i < words.length - 2; i++) {
      const word = words[i].replace(/[.,!?]/g, '');
      if (word.length >= 3 && !NATURAL_REPEAT_WORDS.has(word)) {
        if (words[i + 1].replace(/[.,!?]/g, '') === word && 
            words[i + 2].replace(/[.,!?]/g, '') === word) {
          return { isRepetitive: true, type: 'word', count: 3 };
        }
      }
    }
  }
  
  // 4. 문장 반복 패턴 감지
  const sentences = text.split(/[.!?]/).filter(s => s.trim().length >= 10);
  if (sentences.length >= 2) {
    const sentenceCounts: Record<string, number> = {};
    for (const sentence of sentences) {
      const key = sentence.trim();
      sentenceCounts[key] = (sentenceCounts[key] || 0) + 1;
    }
    
    // 같은 문장이 3번 이상 반복
    for (const [, count] of Object.entries(sentenceCounts)) {
      if (count >= 3) {
        return { isRepetitive: true, type: 'sentence', count };
      }
    }
  }
  
  return result;
}

/**
 * 할루시네이션 여부 확인 (로그 최소화)
 * [advice from AI] Python HallucinationDetector 로직 통합
 */
export function isHallucination(text: string): boolean {
  if (!text) return true;

  const trimmed = text.trim();

  // 1. 너무 짧은 텍스트 (1글자 이하만 필터)
  if (trimmed.length <= 1) return true;
  
  // 2. 의미 없는 짧은 반복 단어만 필터
  const meaninglessShortWords = ['네네', '예예', '음음', '어어', '아아', '네에', '예에'];
  if (meaninglessShortWords.includes(trimmed)) return true;

  // [advice from AI] ★ 3. 개선된 반복 패턴 감지 (Python 로직 포팅)
  const repetition = hasRepetitivePattern(trimmed);
  if (repetition.isRepetitive) {
    console.log(`[HALLUCINATION] 🔁 반복 패턴 감지 (${repetition.type} ×${repetition.count}): "${trimmed.substring(0, 40)}..."`);
    return true;
  }

  // 4. 백엔드에서 가져온 할루시네이션 패턴 체크
  for (const patternStr of cachedHallucinationPatterns) {
    try {
      const pattern = new RegExp(patternStr, 'i');
      if (pattern.test(trimmed)) return true;
    } catch (e) {
      // 잘못된 정규식 무시
    }
  }

  // 5. 기본 할루시네이션 패턴 체크
  for (const pattern of DEFAULT_HALLUCINATION_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  // 6. 동일 단어 반복 (3회 이상) - 기존 로직 유지
  const words = trimmed.split(/\s+/);
  if (words.length >= 3) {
    for (let i = 0; i < words.length - 2; i++) {
      if (words[i] === words[i + 1] && words[i + 1] === words[i + 2]) {
        return true;
      }
    }
  }

  // 7. 모든 단어가 동일
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
 * [advice from AI] 문맥 기반 오인식 수정
 * WhisperLiveKit이 "국민의례"를 "국민의힘"으로 잘못 인식하는 문제 해결
 */
const CONTEXT_CORRECTIONS: Array<{ pattern: RegExp; replacement: string; description: string }> = [
  // [advice from AI] ★ 국민의례 관련 오인식 수정 (우선순위 높음)
  // "먼저 국민의힘" → "먼저 국민의례" (국무회의 시작 발언)
  { pattern: /먼저\s*국민의힘/gi, replacement: '먼저 국민의례', description: '국민의례 오인식' },
  // "국민의힘의 의견을 전해" → 환각으로 간주 (삭제)
  { pattern: /국민의힘의\s*의견을?\s*전해드리겠습니다?/gi, replacement: '', description: '국민의례 환각' },
  // "국민의힘을 하겠습니다" → "국민의례를 하겠습니다"
  { pattern: /국민의힘을?\s*하겠습니다/gi, replacement: '국민의례를 하겠습니다', description: '국민의례 오인식' },
  // "국민을 국민의례를" → "국민의례를" (중복 수정)
  { pattern: /국민을\s*국민의례를/gi, replacement: '국민의례를', description: '국민의례 중복' },
  // "국민 국민의례를" → "국민의례를"
  { pattern: /국민\s+국민의례를/gi, replacement: '국민의례를', description: '국민의례 중복' },
  
  // [advice from AI] ★ 추가 오인식 패턴 (로그 분석 기반)
  // "먼저 국민들에게 전해드리겠습니다" → "먼저 국민의례를 하겠습니다"
  { pattern: /먼저\s*국민들에게\s*전해드리겠습니다/gi, replacement: '먼저 국민의례를 하겠습니다', description: '국민의례 오인식2' },
  // ★ "먼저 공략을 해보겠습니다" → "먼저 국민의례를 하겠습니다" (자주 발생!)
  { pattern: /먼저\s*공략을\s*해보겠습니다/gi, replacement: '먼저 국민의례를 하겠습니다', description: '국민의례 공략 오인식' },
  { pattern: /공략을\s*해보겠습니다/gi, replacement: '국민의례를 하겠습니다', description: '국민의례 공략 오인식2' },
  // [advice from AI] ★ "수피" → "코스피" (Whisper 오인식)
  { pattern: /수피\s*고스닥/gi, replacement: '코스피 코스닥', description: '코스피 오인식' },
  { pattern: /수피\s*코스닥/gi, replacement: '코스피 코스닥', description: '코스피 오인식2' },
  { pattern: /^수피$/gi, replacement: '코스피', description: '코스피 단독 오인식' },
  // ★ "국민의뢰를" → "국민의례를" (단독 패턴 추가!)
  // [advice from AI] 순서 중요: "국민의뢰를"을 먼저 처리 후 "국민의뢰" 처리
  { pattern: /국민의뢰를/gi, replacement: '국민의례를', description: '국민의뢰를 오인식' },
  { pattern: /국민\s*의뢰/gi, replacement: '국민의례', description: '국민 의뢰 오인식 (띄어쓰기 포함)' },
  { pattern: /국민의뢰/gi, replacement: '국민의례', description: '국민의뢰 오인식' },
  // "국민을 국민의뢰를" → "국민의례를" (의뢰 오인식)
  { pattern: /국민을?\s*국민의례를/gi, replacement: '국민의례를', description: '국민의례 중복' },
  // "이는 성장과 이는 성장의" → "이는 성장의" (반복)
  { pattern: /이는\s*성장과\s*이는\s*성장의/gi, replacement: '이는 성장의', description: '반복 제거' },
  // "전반 전반으로" → "전반으로" (반복)
  { pattern: /전반\s+전반으로/gi, replacement: '전반으로', description: '반복 제거' },
  // "홀떼받은 홀떼받던" → "홀대받던" (오타 + 반복)
  { pattern: /홀떼받은\s*홀떼받던/gi, replacement: '홀대받던', description: '오타 수정' },
  { pattern: /홀떼받/gi, replacement: '홀대받', description: '오타 수정' },
  
  // [advice from AI] ★ 로그 분석 기반 추가 오인식 패턴 (2026-02-04)
  // "공모회의" → "국무회의"
  { pattern: /공모회의/gi, replacement: '국무회의', description: '국무회의 오인식' },
  // "아멘" → "네" (국무회의에서 아멘은 오인식) - 단독 및 문장 시작
  { pattern: /^아멘$/gi, replacement: '네', description: '아멘 단독 오인식' },
  { pattern: /^아멘\s/gi, replacement: '네, ', description: '아멘 문장시작 오인식' },
  { pattern: /아멘\s*고생/gi, replacement: '네, 고생', description: '아멘 고생 오인식' },
  // "개선언" → "개회선언"
  { pattern: /개선언/gi, replacement: '개회선언', description: '개회선언 오인식' },
  // "국물을" → 문맥에 따라 "국민을" (국민의례 앞에서)
  { pattern: /국물을\s*국민/gi, replacement: '국민', description: '국물을 오인식' },
  // "공룡" → 삭제 (의미 없는 오인식)
  { pattern: /\s*공룡\s*/gi, replacement: ' ', description: '공룡 오인식 삭제' },
  // "부의 해당되는데" → "부에 해당되는데"
  { pattern: /부의\s*해당/gi, replacement: '부에 해당', description: '부의 오인식' },
  // "신년" → "새해" or 그대로 (신년이 맞으면 그대로)
  // "쳐도 회의를" → "저도 회의를" (저 → 쳐 오인식)
  { pattern: /쳐도\s*회의/gi, replacement: '저도 회의', description: '쳐도 오인식' },
];

function applyContextCorrections(text: string): string {
  if (!text) return text;
  
  let result = text;
  for (const { pattern, replacement, description } of CONTEXT_CORRECTIONS) {
    const before = result;
    result = result.replace(pattern, replacement);
    if (before !== result) {
      console.log(`[후처리] 문맥수정 (${description}): "${before.substring(0, 30)}..." → "${result.substring(0, 30)}..."`);
    }
  }
  return result.trim();
}

/**
 * [advice from AI] 반복 패턴 제거
 * "국기에 대하여 정책 국기에 대하여 경례" → "국기에 대하여 경례"
 * WhisperLiveKit이 중간 인식 수정하면서 발생하는 반복 제거
 */
export function removeRepetitions(text: string): string {
  if (!text || text.length < 15) return text;  // [advice from AI] 15자 미만은 반복 제거 안 함
  
  // [advice from AI] 7자 이상의 반복 패턴만 찾기 (너무 짧으면 오탐)
  const minPatternLength = 7;
  let result = text;
  
  for (let len = minPatternLength; len <= Math.floor(text.length / 2); len++) {
    for (let i = 0; i <= text.length - len * 2; i++) {
      const pattern = text.substring(i, i + len);
      const restOfText = text.substring(i + len);
      
      // 패턴이 뒤에서 다시 나타나면 (간격이 5자 이내)
      const repeatIndex = restOfText.indexOf(pattern);
      if (repeatIndex !== -1 && repeatIndex < 5) {
        // 두 번째 패턴부터 끝까지 유지 (수정된 인식일 가능성 높음)
        result = text.substring(0, i) + restOfText.substring(repeatIndex);
        console.log(`[후처리] 반복제거: "${pattern}" 반복 발견 → "${result.substring(0, 40)}..."`);
        return removeRepetitions(result); // 재귀적으로 다시 검사
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
  
  // [advice from AI] 반복 패턴 제거 먼저
  let result = removeRepetitions(text);
  
  // [advice from AI] 문맥 기반 수정
  result = applyContextCorrections(result);
  
  for (const [wrong, correct] of Object.entries(cachedGovernmentTerms)) {
    if (wrong && result.includes(wrong)) {
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
 * [advice from AI] ★ 침묵 구간 할루시네이션 패턴 (Python HallucinationDetector 포팅)
 * STT 엔진이 침묵에서 반복 생성하는 패턴
 */
const SILENCE_HALLUCINATION_PATTERNS: RegExp[] = [
  // 단어 반복 패턴
  /다진마늘\s*다진마늘/i,
  /롤러스\s*롤러스/i,
  /면을\s*잘게\s*잘라줍니다\.\s*면을\s*잘게\s*잘라줍니다\./i,
  // 단일 문자 반복 패턴
  /^(아\s*){3,}$/i,
  /^(어\s*){3,}$/i,
  /^(음\s*){3,}$/i,
  /^(그\s*){3,}$/i,
  // 구두점 반복 패턴
  /^\.\s*\.\s*\.$/i,
  /^,\s*,\s*,$/i,
  /^\?\s*\?\s*\?$/i,
  /^!\s*!\s*!$/i,
  // [advice from AI] ★★★ 새로 추가: "다.다.다." 반복 패턴 (WhisperLiveKit 버그)
  /다\.다\./i,                           // "다.다." 이상
  /(.)\.\1\.\1\./i,                      // 같은 글자.글자.글자. 패턴
  /(\S)\.\1\./i,                         // 같은 글자.글자. 패턴 (2회 이상)
  // [advice from AI] ★★★ 새로 추가: 연속 "음" 패턴 (문장 중간에 있어도 감지)
  /음{3,}/i,                             // "음음음" 이상 (연속)
  /음\s+음\s+음/i,                        // "음 음 음" (공백 포함)
  /(음\s*){4,}/i,                        // "음 음 음 음" 이상
];

/**
 * [advice from AI] ★ 방송 뉴스 할루시네이션 패턴 (Python HallucinationDetector 포팅)
 */
const BROADCAST_HALLUCINATION_PATTERNS: RegExp[] = [
  /MBC\s*뉴스/i,
  /KBS\s*뉴스/i,
  /SBS\s*뉴스/i,
  /JTBC\s*뉴스/i,
  /YTN\s*뉴스/i,
  /뉴스\s*(김성현|이덕영)입니다/i,
  /기상캐스터/i,
  /기자가\s*보도합니다/i,
  /에서\s*MBC\s*뉴스/i,
  /투데이\s*이슈톡이었습니다/i,
  /날씨였습니다/i,
  /뉴스\s*스토리/i,
  /지금까지\s*뉴스\s*스토리였습니다/i,
  /지금까지\s*뉴스/i,
  /뉴스\s*마무리/i,
  /오늘\s*뉴스/i,
  /뉴스\s*시간/i,
  /뉴스데스크/i,
  /촬영기자1호/i,
  /이\s*시각/i,
  /세계였습니다/i,
  /이\s*시각\s*세계였습니다/i,
  /이상\s*세계였습니다/i,
  /지금까지\s*세계였습니다/i,
  /세계\s*뉴스/i,
  /국제\s*뉴스/i,
  /해외\s*뉴스/i,
];

/**
 * [advice from AI] ★ 종교적 표현 할루시네이션 패턴 (Python HallucinationDetector 포팅)
 */
const RELIGIOUS_HALLUCINATION_PATTERNS: RegExp[] = [
  /^아멘\.?$/i,
  /^할렐루야\.?$/i,
  /하나님/i,  // [advice from AI] 더 포괄적으로 변경 - '하나님'이 포함된 모든 텍스트
  /^주님\.?$/i,
  /기도합니다\.?$/i,
  /축복합니다\.?$/i,
  /^은혜\.?$/i,
  /감사드립니다\.?$/i,
  /주\s*예수님/i,
  /하느님/i,
  /천주님/i,
];

/**
 * [advice from AI] ★ 방송인 이름 할루시네이션 패턴 (Python HallucinationDetector 포팅)
 */
const BROADCASTER_NAME_PATTERNS: RegExp[] = [
  /기상캐스터\s*배혜지/i,
  /배혜지/i,
  /김성현입니다/i,
  /이덕영입니다/i,
  /아나운서/i,
  /앵커/i,
  /리포터/i,
  /캐스터/i,
  /날씨\s*전문가/i,
  /기상\s*전문가/i,
  /일기예보/i,
  /날씨\s*예보/i,
  /뉴스\s*진행/i,
  /뉴스\s*앵커/i,
  /메인\s*앵커/i,
  /보도\s*앵커/i,
];

/**
 * [advice from AI] ★ 한국어 간투사/감탄사 할루시네이션 패턴 (Python HallucinationDetector 포팅)
 */
const KOREAN_INTERJECTION_PATTERNS: RegExp[] = [
  /^음\.?$/i,
  /^어어\.?$/i,
  /^음음\.?$/i,
  /^그그\.?$/i,
  /^음\s*음$/i,
  /^어\s*어$/i,
  /^그\s*그$/i,
  /^뭐\s*뭐$/i,
  /^아\s*아$/i,
  /^어음$/i,
  /^음어$/i,
  /^실례합니다\.?$/i,
  /^죄송해요\.?$/i,
];

/**
 * [advice from AI] 강력한 할루시네이션 패턴 - 길이와 관계없이 항상 필터
 * Whisper 모델이 자주 생성하는 명확한 오류 - 대규모 확장
 */
const STRONG_HALLUCINATION_PATTERNS: RegExp[] = [
  // ==========================================================================
  // ★★★ 한국어 YouTube/영상 관련 ★★★
  // ==========================================================================
  /시청.*감사/i,
  /구독.*좋아요/i,
  /좋아요.*구독/i,
  /채널.*구독/i,
  /다음\s*영상에서\s*만나/i,
  /다음\s*영상에서\s*만나요/i,
  /구독.*알림\s*설정/i,
  /좋아요.*눌러/i,
  /구독\s*버튼/i,
  /알림\s*버튼/i,
  /종\s*모양/i,
  /댓글.*남겨/i,
  /영상.*끝까지.*봐/i,
  /채널.*방문/i,
  /링크.*확인/i,
  /다음\s*시간에\s*만나/i,
  /다음\s*편에서/i,
  /영상\s*봐\s*주셔서/i,
  /시청\s*감사/i,
  /끝까지\s*시청/i,
  /오늘\s*영상은\s*여기까지/i,
  /오늘은\s*여기까지/i,
  /좋은\s*하루/i,
  /좋은\s*밤/i,
  /행복한\s*하루/i,
  /즐거운\s*(하루|시간)/i,
  
  // ==========================================================================
  // ★★★ 한국어 자막/편집 크레딧 (핵심 필터) ★★★
  // ==========================================================================
  /자막\s*(제작|편집|번역|감수)\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /자막\s*[:|\-]\s*[가-힣a-zA-Z]+/i,
  /편집\s*(자|자막|영상)?\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /편집자\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /영상\s*편집\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /번역\s*(자)?\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /번역자\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /감수\s*(자)?\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /제작\s*(자)?\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /촬영\s*(자)?\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /연출\s*(자)?\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /기획\s*(자)?\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /진행\s*(자)?\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /나레이션\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /성우\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /해설\s*(자)?\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /출연\s*(자)?\s*[:|\-]?\s*[가-힣a-zA-Z]+/i,
  /협찬\s*[:|\-]/i,
  /후원\s*[:|\-]/i,
  /스폰서\s*[:|\-]/i,
  /제공\s*[:|\-]/i,
  /자막\s*제공.*배달의민족/i,  // [advice from AI] 할루시네이션 추가
  /배달의민족/i,  // [advice from AI] 할루시네이션 추가
  /저작권/i,
  /무단\s*(복제|전재|배포)/i,
  /all\s*rights?\s*reserved/i,
  
  // ==========================================================================
  // ★★★ 영어 YouTube/영상 관련 ★★★
  // ==========================================================================
  /thank\s*you\s*for\s*watching/i,
  /thanks\s*for\s*watching/i,
  /please\s*subscribe/i,
  /like\s*and\s*subscribe/i,
  /don't\s*forget\s*to\s*(like|subscribe|comment)/i,
  /hit\s*the\s*(like|subscribe|notification|bell)/i,
  /smash\s*(the|that)\s*(like|subscribe)/i,
  /leave\s*a\s*(like|comment)/i,
  /click\s*the\s*(subscribe|bell|link)/i,
  /check\s*out\s*(my|our|the)\s*(channel|video|link)/i,
  /follow\s*(me|us)\s*on/i,
  /see\s*you\s*in\s*the\s*next/i,
  /see\s*you\s*next\s*time/i,
  /until\s*next\s*time/i,
  /stay\s*tuned/i,
  /watch\s*more\s*videos/i,
  /more\s*videos\s*coming\s*soon/i,
  /new\s*video\s*every/i,
  
  // ==========================================================================
  // ★★★ 영어 자막/편집 크레딧 (핵심 필터) ★★★
  // ==========================================================================
  /subtitl(e|ed|ing|es)?\s*(by|:)/i,
  /transcrib(e|ed|ing|es)?\s*(by|:)/i,
  /edit(ed|ing|or|s)?\s*(by|:)/i,
  /translat(e|ed|ing|ion|or|s)?\s*(by|:)/i,
  /caption(ed|s|ing)?\s*(by|:)/i,
  /creat(e|ed|ing|or|s)?\s*(by|:)/i,
  /produc(e|ed|ing|er|tion)?\s*(by|:)/i,
  /direct(ed|or|ing)?\s*(by|:)/i,
  /writt(en|ing)?\s*(by|:)/i,
  /narrat(e|ed|ing|or)?\s*(by|:)/i,
  /present(ed|ing|er)?\s*(by|:)/i,
  /host(ed|ing)?\s*(by|:)/i,
  /powered\s*by/i,
  /sponsored\s*by/i,
  /brought\s*to\s*you\s*by/i,
  /made\s*(possible\s*)?\s*by/i,
  /courtesy\s*of/i,
  /copyright/i,
  
  // ==========================================================================
  // ★★★ 중국어/일본어 할루시네이션 ★★★
  // ==========================================================================
  /感谢\s*收看/i,
  /感谢\s*观看/i,
  /请\s*订阅/i,
  /请\s*点赞/i,
  /字幕\s*[:：]/i,
  /翻译\s*[:：]/i,
  /编辑\s*[:：]/i,
  /制作\s*[:：]/i,
  /ご視聴.*ありがとう/i,
  /チャンネル登録/i,
  /高評価/i,
  
  // ==========================================================================
  // ★★★ 한국어 단독 문구 (의미없는 조각) ★★★
  // ==========================================================================
  /^감사합니다\.?$/i,
  /^많은$/i,
  /^3회$/i,
  /이\s*시각\s*세계였습니다/i,
  /^것처럼$/i,
  /^것\s*같습니다\.?$/i,
  /^있는\s*겁니다\.?$/i,
  /^되겠습니다\.?$/i,
  /^것입니다\.?$/i,
  /^합니다\.?$/i,
  /^입니다\.?$/i,
  /^습니다\.?$/i,
  /^니다\.?$/i,
  /^데요\.?$/i,
  /^거든요\.?$/i,
  /^잖아요\.?$/i,
  /^인데(요)?\.?$/i,
  /^라고(요)?\.?$/i,
  /^니까(요)?\.?$/i,
  /^지만(요)?\.?$/i,
  /^그래서(요)?\.?$/i,
  /^그런데(요)?\.?$/i,
  /^그리고(요)?\.?$/i,
  /^하지만(요)?\.?$/i,
  /^그러면(요)?\.?$/i,
  /^그러나(요)?\.?$/i,
  /^여기까지(입니다|예요)?\.?$/i,
  
  // ==========================================================================
  // ★★★ 한국어 짧은 응답/추임새 ★★★
  // ==========================================================================
  /^아\.?$/i,
  /^어\.?$/i,
  /^음\.?$/i,
  /^응\.?$/i,
  /^네\.?$/i,
  /^예\.?$/i,
  /^뭐\.?$/i,
  /^왜\.?$/i,
  /^그래(요)?\.?$/i,
  /^그렇죠\.?$/i,
  /^맞아(요)?\.?$/i,
  /^정말(요)?\??$/i,
  /^진짜(요)?\??$/i,
  /^아니(요)?\.?$/i,
  /^글쎄(요)?\.?$/i,
  
  // ==========================================================================
  // ★★★ 무음/배경음/효과음 ★★★
  // ==========================================================================
  /^음성\s*없음\.?$/i,
  /^무음\.?$/i,
  /^침묵\.?$/i,
  /^(박수|환호|음악|웃음|울음|탄성|한숨|기침)(\s*소리)?\.?$/i,
  /^박수\s*갈채\.?$/i,
  /^배경\s*음악\.?$/i,
  /^배경음\.?$/i,
  /^효과음\.?$/i,
  /^잡음\.?$/i,
  /^테스트(입니다)?\.?$/i,
  /^마이크\s*테스트\.?$/i,
  /^\[음악\]$/i,
  /^\[박수\]$/i,
  /^\[웃음\]$/i,
  /^\[침묵\]$/i,
  /^\(음악\)$/i,
  /^\(박수\)$/i,
  /^\(웃음\)$/i,
  /^\(침묵\)$/i,
  
  // ==========================================================================
  // ★★★ 반복 패턴 ★★★
  // ==========================================================================
  /^(네|예)(\s*(네|예)){2,}\.?$/i,
  /^(음|어|음음|어어)+$/i,
  /^(네네네|예예예|네네|예예)+$/i,
  /^(아아아|어어어|음음음)+$/i,
  /^(하하|히히|호호|허허|후후)+$/i,
  /^(ㅎㅎ|ㅋㅋ|ㅎㅎㅎ|ㅋㅋㅋ)+$/i,
  // [advice from AI] ★★★ 새로 추가: "다.다.다." 및 연속 "음" 패턴 ★★★
  /다\.다\./i,                             // "다.다." 이상 (어디서든)
  /음{4,}/i,                               // "음음음음" 이상 (연속)
  /음\s*음\s*음\s*음/i,                     // "음 음 음 음" (공백 포함)
  /(음\s*이제\s*딴\s*){2,}/i,              // "음 이제 딴음 이제 딴" 반복
  /(.{5,})\1/i,                            // 5자 이상 동일 문자열 반복
  
  // ==========================================================================
  // ★★★ 영어 기타 할루시네이션 ★★★
  // ==========================================================================
  /^(okay|ok|yes|no|um|uh|oh|ah|hmm|huh|well)\.?$/i,
  /^one\s*moment(\s*please)?\.?$/i,
  /^just\s*a\s*(moment|second|sec)\.?$/i,
  /^hold\s*on\.?$/i,
  /^wait\.?$/i,
  /^(sorry|excuse\s*me|pardon)\??$/i,
  /^(right|exactly|indeed|absolutely|definitely|of\s*course|sure)\.?$/i,
  /^(anyway|moving\s*on|next)\.?$/i,
  /^(and|but|so|now|then|here|there)\.{0,3}$/i,
  /^hello\.?$/i,
  /^hi\.?$/i,
  /^bye\.?$/i,
  /^goodbye\.?$/i,
  
  // ==========================================================================
  // ★★★ 뉴스/방송 관련 ★★★
  // ==========================================================================
  /지금까지\s*.+\s*기자였습니다/i,
  /.+\s*기자의\s*보도였습니다/i,
  /.+에서\s*전해드렸습니다/i,
  /^뉴스였습니다\.?$/i,
  /^보도였습니다\.?$/i,
  /^속보입니다\.?$/i,
  /.+\s*아나운서였습니다/i,
  /^앵커였습니다\.?$/i,
  /이상\s*.+\s*뉴스였습니다/i,
  /청취해\s*주셔서\s*감사/i,
  /들어주셔서\s*감사/i,
  /이\s*시간\s*마치겠습니다/i,
  /다음\s*시간에\s*뵙겠습니다/i,
  /다음\s*주에\s*(만나요|뵙겠습니다)/i,
  
  // ==========================================================================
  // ★★★ 스페인어/프랑스어/독일어 할루시네이션 ★★★
  // ==========================================================================
  /^(gracias|hola|adiós|por\s*favor|sí)\.?$/i,
  /^(merci|bonjour|au\s*revoir|s'il\s*vous\s*plaît|oui)\.?$/i,
  /^(danke|hallo|auf\s*wiedersehen|bitte|ja)\.?$/i,
  /subtítulos\s*por/i,
  /sous-titres\s*par/i,
  /untertitel\s*von/i,
  
  // ==========================================================================
  // ★★★ 특수 문자/기호 ★★★
  // ==========================================================================
  /^[\s\.\,\!\?\-\~\♪\♫\…\*\#\@\&\%\$\^\=\+\_\|\\\[\]\{\}\<\>\'\"\`]+$/i,
  /^\.{2,}$/i,
  /^[-_=+*#@!?.,;:]{2,}$/i,
  /^\(.*\)$/i,
  /^\[.*\]$/i,
  /^「.*」$/i,
  /^『.*』$/i,
  /^《.*》$/i,
  /^【.*】$/i,
  /^[ㄱ-ㅎㅏ-ㅣ]+$/i,  // 자음/모음만
  /^[a-zA-Z]$/i,  // 단일 알파벳
  /^[가-힣]$/i,   // 단일 한글
  /^\d+$/i,      // 숫자만
  /^\d+:\d+$/i,  // 시간 형식만
];

/**
 * [advice from AI] ★ 강력한 할루시네이션 체크 - 길이와 관계없이 항상 필터
 * handleBufferUpdate에서 사용
 * Python HallucinationDetector 패턴 통합
 */
export function isStrongHallucination(text: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  
  // [advice from AI] ★ 1. 기본 강력 패턴 체크
  for (const pattern of STRONG_HALLUCINATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  
  // [advice from AI] ★ 2. 침묵 구간 할루시네이션 패턴 체크
  for (const pattern of SILENCE_HALLUCINATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.log(`[HALLUCINATION] 🔇 침묵 구간 패턴: "${trimmed.substring(0, 30)}..."`);
      return true;
    }
  }
  
  // [advice from AI] ★ 3. 방송 뉴스 할루시네이션 패턴 체크
  for (const pattern of BROADCAST_HALLUCINATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.log(`[HALLUCINATION] 📺 방송 뉴스 패턴: "${trimmed.substring(0, 30)}..."`);
      return true;
    }
  }
  
  // [advice from AI] ★ 4. 종교적 표현 할루시네이션 패턴 체크
  for (const pattern of RELIGIOUS_HALLUCINATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.log(`[HALLUCINATION] ⛪ 종교적 표현 패턴: "${trimmed.substring(0, 30)}..."`);
      return true;
    }
  }
  
  // [advice from AI] ★ 5. 방송인 이름 할루시네이션 패턴 체크
  for (const pattern of BROADCASTER_NAME_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.log(`[HALLUCINATION] 🎙️ 방송인 이름 패턴: "${trimmed.substring(0, 30)}..."`);
      return true;
    }
  }
  
  // [advice from AI] ★ 6. 한국어 간투사/감탄사 할루시네이션 패턴 체크 (짧은 텍스트만)
  if (trimmed.length <= 10) {
    for (const pattern of KOREAN_INTERJECTION_PATTERNS) {
      if (pattern.test(trimmed)) {
        console.log(`[HALLUCINATION] 💬 간투사 패턴: "${trimmed}"`);
        return true;
      }
    }
  }
  
  return false;
}

/**
 * 전체 후처리 파이프라인
 * @param text 입력 텍스트
 * @param forSubtitleList 자막 목록용 (true면 할루시네이션 필터 더 관대하게)
 */
export function postprocessText(text: string, _forSubtitleList: boolean = false): string {
  if (!text) return '';

  // 0. 사전이 로드되지 않았으면 비동기 로드 시작 (첫 호출 시)
  if (!isLoaded && !isLoading) {
    loadDictionaries();
  }

  // 1. 텍스트 정리
  let result = cleanText(text);
  
  // [advice from AI] 1-1. ★ 반복 패턴 제거 먼저! (가장 중요)
  // "국기에 대하여 정책 국기에 대하여 경례" → "국기에 대하여 경례"
  result = removeRepetitions(result);

  // [advice from AI] 2-1. 강력한 할루시네이션 패턴은 길이와 관계없이 항상 필터
  for (const pattern of STRONG_HALLUCINATION_PATTERNS) {
    if (pattern.test(result)) {
      console.log(`[POSTPROCESS] 🚫 강력 할루시네이션: "${result.substring(0, 30)}..."`);
      return '';
    }
  }

  // 2-2. 일반 할루시네이션 체크
  // [advice from AI] ★ 10자 이상이면 할루시네이션 체크 건너뜀 (정상적인 문장일 가능성 높음)
  if (result.length < 10 && isHallucination(result)) {
    console.log(`[POSTPROCESS] 🚫 할루시네이션 스킵: "${result}" (${result.length}자)`);
    return '';
  }

  // 3. 비속어 필터
  result = filterProfanity(result);

  // 4. 고유명사 매칭
  result = applyProperNouns(result);

  // 5. 정부 용어 매칭
  result = applyGovernmentTerms(result);

  // [advice from AI] 5-1. ★ 문맥 기반 수정 (정부용어 적용 후!)
  // "국민을 국민의례를" → "국민의례를" 등
  result = applyContextCorrections(result);

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
