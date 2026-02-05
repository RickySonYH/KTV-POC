// [advice from AI] KTV 실시간 AI 자동자막 - 라이브 실시간 STT 연동

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Header from './components/Header';
import FileUpload from './components/FileUpload';
import VideoPlayer, { type VideoPlayerRef } from './components/VideoPlayer';
import SubtitleExport from './components/SubtitleExport';
import AdminPanel from './components/AdminPanel';
import { useVideoAudioSTT, type VideoAudioSubtitle, type BufferUpdate } from './hooks/useVideoAudioSTT';
import { loadDictionaries, postprocessText } from './utils/sttPostprocessing';
import type { VideoFile, SubtitleSegment } from './types/subtitle';
import './styles/App.css';

type ProcessStatus = 'idle' | 'processing' | 'completed' | 'error';

// [advice from AI] 자막 규칙 인터페이스 - 관리페이지에서 설정
interface SubtitleRules {
  max_lines: number;
  max_chars_per_line: number;
  fade_timeout_ms: number;      // [advice from AI] 묵음 후 자막 사라지는 시간 (기본 5초)
  postprocess_enabled: boolean; // [advice from AI] 후처리 ON/OFF 설정
}

// [advice from AI] 기본 자막 규칙 (API 로드 전 또는 실패 시)
const DEFAULT_SUBTITLE_RULES: SubtitleRules = {
  max_lines: 3,
  max_chars_per_line: 30,
  fade_timeout_ms: 5000,        // [advice from AI] 5초간 유지 (묵음 초기화)
  postprocess_enabled: true,
};

// [advice from AI] 백엔드 API URL
// [advice from AI] 동적 API URL - HTTPS/nginx 프록시 지원
const API_URL = import.meta.env.VITE_API_URL || (() => {
  // HTTPS로 접속 시 nginx 프록시 사용 (/api/ 경로)
  if (window.location.protocol === 'https:') {
    return '';  // 상대 경로 사용 → /api/...
  }
  // localhost 직접 접속
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:6431';
  }
  // HTTP 외부 접속 (포트 직접 지정)
  return `http://${window.location.hostname}:6431`;
})();

function App() {
  // [advice from AI] 앱 시작 시 사전 데이터 로드
  useEffect(() => {
    console.log('[APP] 📚 후처리 사전 데이터 로드 시작...');
    loadDictionaries().then(() => {
      console.log('[APP] ✅ 후처리 사전 데이터 로드 완료');
    });
  }, []);

  // [advice from AI] 탭 상태 관리 - WhisperLiveKit 전용
  const [activeTab, setActiveTab] = useState<'subtitle' | 'whisper' | 'guide'>('subtitle');
  
  const [video, setVideo] = useState<VideoFile | null>(null);
  // [advice from AI] 자막 목록 - 기록 로직 제거됨, UI용으로만 유지
  const [displayedSubtitles, setDisplayedSubtitles] = useState<SubtitleSegment[]>([]);
  
  // [advice from AI] ★★★ 성능 최적화: 자막 목록 추가를 배치 큐로 처리 ★★★
  // 화면 표시는 즉시, 목록 기록은 1초마다 배치 처리 → 화면 렌더링 우선
  const pendingSubtitlesRef = useRef<SubtitleSegment[]>([]);
  
  // [advice from AI] 1초마다 대기 중인 자막을 목록에 추가 (낮은 우선순위)
  useEffect(() => {
    const flushInterval = setInterval(() => {
      if (pendingSubtitlesRef.current.length > 0) {
        const toAdd = [...pendingSubtitlesRef.current];
        pendingSubtitlesRef.current = [];
        setDisplayedSubtitles(prev => [...prev, ...toAdd]);
      }
    }, 1000);  // 1초마다 배치 처리
    
    return () => clearInterval(flushInterval);
  }, []);
  
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState<ProcessStatus>('idle');
  
  // [advice from AI] ★ 자막 수동 편집 기능
  const [editingSubtitleId, setEditingSubtitleId] = useState<number | null>(null);
  const [editText, setEditText] = useState<string>('');
  
  // [advice from AI] ★ 유사도 기반 중복 체크 함수 - 정확한 시작 비교
  const isSimilarText = useCallback((text1: string, text2: string, threshold = 0.8): boolean => {
    if (!text1 || !text2) return false;
    const t1 = text1.trim();
    const t2 = text2.trim();
    if (t1 === t2) return true;
    
    // [advice from AI] ★ 핵심: 하나가 다른 것으로 시작하면 중복 (확장된 버전)
    // "안녕하세요" → "안녕하세요 반갑습니다" = 확장 = 중복
    if (t1.startsWith(t2) || t2.startsWith(t1)) {
      console.log(`[중복체크] 확장 감지: "${t1.substring(0, 15)}..." ⊃ "${t2.substring(0, 15)}..."`);
      return true;
    }
    
    // [advice from AI] ★ 짧은 텍스트가 긴 텍스트에 완전히 포함되면 중복
    const shorter = t1.length <= t2.length ? t1 : t2;
    const longer = t1.length > t2.length ? t1 : t2;
    if (longer.includes(shorter) && shorter.length >= 5) {
      console.log(`[중복체크] 포함 감지: "${shorter.substring(0, 15)}..." ⊂ "${longer.substring(0, 15)}..."`);
      return true;
    }
    
    // [advice from AI] ★ 앞부분이 80% 이상 일치하면 중복
    const minLen = Math.min(t1.length, t2.length);
    let matchCount = 0;
    for (let i = 0; i < minLen; i++) {
      if (t1[i] === t2[i]) matchCount++;
      else break;  // 연속 일치만 체크
    }
    return (matchCount / minLen) >= threshold;
  }, []);
  
  // [advice from AI] ★ 최근 추가된 텍스트와 비교 (강화된 중복 방지)
  const isRecentlyAdded = useCallback((text: string): boolean => {
    if (!text) return false;
    const trimmed = text.trim();
    
    // 정확히 같은 텍스트
    if (recentAddedTextsRef.current.includes(trimmed)) return true;
    
    // 유사한 텍스트 (최근 5개와 비교)
    for (const recent of recentAddedTextsRef.current) {
      if (isSimilarText(trimmed, recent, 0.7)) {
        console.log(`[중복체크] ⏭️ 유사 중복 발견: "${trimmed.substring(0, 20)}..." ≈ "${recent.substring(0, 20)}..."`);
        return true;
      }
    }
    return false;
  }, [isSimilarText]);
  
  // [advice from AI] ★ 텍스트 추가 시 최근 목록에 기록 (최대 5개 유지)
  const addToRecentTexts = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    
    recentAddedTextsRef.current.push(trimmed);
    // 최대 5개 유지
    if (recentAddedTextsRef.current.length > 5) {
      recentAddedTextsRef.current.shift();
    }
    lastAddedTextRef.current = trimmed;
  }, []);
  
  // [advice from AI] 현재 화면에 표시할 캡션
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);
  const [latestSubtitleId, setLatestSubtitleId] = useState<number | null>(null);
  const displayedIdsRef = useRef<Set<number>>(new Set());  // 이미 목록에 추가된 자막 ID
  
  // [advice from AI] ★ 자막 규칙 - 관리페이지에서 설정 가능
  const [subtitleRules, setSubtitleRules] = useState<SubtitleRules>(DEFAULT_SUBTITLE_RULES);
  
  // [advice from AI] 자막 규칙 API에서 로드
  useEffect(() => {
    const loadSubtitleRules = async () => {
      try {
        console.log('[APP] 📋 자막 규칙 로드 시작...');
        const response = await fetch(`${API_URL}/api/v1/admin/subtitle-rules`);
        if (response.ok) {
          const data = await response.json();
          setSubtitleRules(data);
          console.log('[APP] ✅ 자막 규칙 로드 완료:', data);
        } else {
          console.warn('[APP] ⚠️ 자막 규칙 로드 실패, 기본값 사용');
        }
      } catch (error) {
        console.error('[APP] ❌ 자막 규칙 로드 오류:', error);
      }
    };
    loadSubtitleRules();
  }, []);
  
  // [advice from AI] 자막 규칙에서 값 추출 (동적 적용)
  // [advice from AI] 자막 규칙에서 값 추출
  const MAX_LINE_LENGTH = subtitleRules.max_chars_per_line;
  const SUBTITLE_FADE_TIMEOUT = subtitleRules.fade_timeout_ms;  // 묵음 후 자막 사라지는 시간
  
  // [advice from AI] 2줄 자막 시스템 - 아래서 추가(페이드인), 위에서 삭제(페이드아웃)
  const [subtitleLines, setSubtitleLines] = useState<{text: string; speaker?: string; id: number; fading?: boolean}[]>([]);
  const subtitleTimeoutRef = useRef<number | null>(null);
  const subtitleIdCounterRef = useRef<number>(0);  // [advice from AI] 고유 ID 생성을 위한 카운터
  
  // =============================================================================
  // [advice from AI] 자막 원칙 (★ 관리페이지에서 설정 가능!)
  // 1. 2줄 표시, 한 줄당 max_chars_per_line 자
  // 2. 아랫줄 먼저 쌓이고, 글자 초과 시 윗줄로 이동
  // 3. 30자 인근 단어 단위 줄바꿈 (띄어쓰기 기준)
  // 4. 묵음 fade_timeout_ms 지속 시 페이드아웃
  // 5. ★ 후처리 결과가 바뀌면 이미 표시된 자막도 교체 가능 (실시간 업데이트)
  // =============================================================================
  const [liveSubtitleLines, setLiveSubtitleLines] = useState<string[]>(['', '']);  // 2줄 고정 (이전확정, 최신확정) - 수집줄은 백그라운드
  const lastLiveSpeakerRef = useRef<string | undefined>(undefined);
  
  
  // [advice from AI] 새 자막 추가 함수 - 실시간 즉시 표시
  // ★ 자막 목록용 (subtitleLines) - liveSubtitleLines와 별개
  const addSubtitleLine = useCallback((text: string, speaker?: string) => {
    console.log(`[SUBTITLE] ✨ 즉시 표시: "${text.substring(0, 30)}..."`);
    
    // [advice from AI] 고유 ID를 위해 카운터 사용
      subtitleIdCounterRef.current += 1;
      const newLine = { text, speaker, id: subtitleIdCounterRef.current, fading: false };
      
      setSubtitleLines(prev => {
      // 최대 3줄: 아래에 새 자막 추가, 오래된 것 제거
      if (prev.length >= 3) {
        return [{ ...prev[1], fading: false }, { ...prev[2], fading: false }, newLine];
      } else if (prev.length >= 2) {
        return [{ ...prev[0], fading: false }, { ...prev[1], fading: false }, newLine];
        }
        return [...prev, newLine];
      });
      
    // [advice from AI] 타이머 리셋 - 묵음 4초 후 전체 페이드아웃
      if (subtitleTimeoutRef.current) {
        clearTimeout(subtitleTimeoutRef.current);
      }
      subtitleTimeoutRef.current = window.setTimeout(() => {
      // 전체 페이드아웃
            setSubtitleLines(prev => 
              prev.map(line => ({ ...line, fading: true }))
            );
      // 0.5초 후 완전 제거
            setTimeout(() => setSubtitleLines([]), 500);
          }, SUBTITLE_FADE_TIMEOUT);
  }, [SUBTITLE_FADE_TIMEOUT]);
  
  
  // [advice from AI] 스트리밍 상태
  const [, setIsPlaying] = useState(false);  // isPlaying은 VideoPlayer에서 관리
  const [isStreaming, setIsStreaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  // [advice from AI] 유니크 ID 생성 - timestamp 기반으로 key 중복 방지
  const segmentIdRef = useRef(Date.now());
  const currentTimeRef = useRef(0);  // 현재 비디오 시간 (자막 동기화용)
  
  // [advice from AI] VideoPlayer ref (라이브 STT용)
  const videoPlayerRef = useRef<VideoPlayerRef>(null);
  
  // [advice from AI] YouTube URL 입력 상태
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeVideoUrl, setYoutubeVideoUrl] = useState<string | null>(null);
  const [youtubeTitle, setYoutubeTitle] = useState<string | null>(null);
  const [isYoutubeMode, setIsYoutubeMode] = useState(false);
  
  // [advice from AI] STT 엔진 - WhisperLiveKit 전용
  const sttEngine = 'whisper' as const;
  
  // [advice from AI] STT 초기화 상태
  const [isResettingSTT, setIsResettingSTT] = useState(false);
  
  
  // [advice from AI] 실시간 스트리밍 모드 상태
  const [streamInfo, setStreamInfo] = useState<{
    type: string;
    description: string;
    isLive: boolean;
    title?: string;
  } | null>(null);
  const [isLiveStreamMode, setIsLiveStreamMode] = useState(false);
  const [bufferingCountdown, setBufferingCountdown] = useState<number | null>(null);
  const [liveStreamReady, setLiveStreamReady] = useState(false);
  const liveStreamRef = useRef<EventSource | null>(null);
  
  // [advice from AI] 자막 처리를 위한 ref들
  const lastBufferTextRef = useRef<string>('');  // 중복 버퍼 방지
  const lastSegmentLinesCountRef = useRef<number>(0);  // [advice from AI] ★ segment 기반 중복 방지 (lines.length 추적)
  const lastAddedTextRef = useRef<string>('');   // 마지막으로 목록에 추가된 텍스트 (중복 방지)
  const recentAddedTextsRef = useRef<string[]>([]);  // [advice from AI] ★ 최근 추가된 텍스트 5개 (강화된 중복 방지)
  const sentenceStartTimeRef = useRef<number>(0); // 현재 문장 시작 시간
  const currentSentenceRef = useRef<string>('');  // 현재 문장 누적
  
  // [advice from AI] 묵음 후 자막 페이드아웃을 위한 타이머 ref
  const silenceTimeoutRef = useRef<number | null>(null);
  
  // [advice from AI] ★ 디바운스 제거됨 - 직접 업데이트로 안정성 확보

  // [advice from AI] ★★★ 새 자막 규칙 - 수집창 기반 3줄 시스템 ★★★
  // - 하단(수집창): 실시간으로 변하면서 수집 중
  // - 가운데: 수집창에서 30자 차서 방금 졸업한 줄
  // - 최상단: 가장 오래된 졸업 줄
  // 동작: 수집창 30자 → 졸업 → 가운데로 이동 → 기존 가운데는 최상단으로 → 최상단은 화면에서 나감
  const topLineRef = useRef<string>('');       // 최상단 (가장 오래된 졸업 줄)
  const middleLineRef = useRef<string>('');    // 가운데 (방금 졸업한 줄)
  const collectorLineRef = useRef<string>(''); // 하단 (수집창 - 실시간 변경)
  
  // [advice from AI] ★★★ 수집창 누적 관리 ★★★
  // - WhisperLiveKit 구조: lines[]=확정 문장, buffer=인식 중인 짧은 텍스트
  // - segment 증가 시 (lines 추가됨) → 이전 버퍼를 누적에 추가
  // - 수집창 표시 = 누적 + 현재 버퍼
  // - 30자 초과 시: updateCollectorLine에서 졸업 처리
  const collectorAccumulatedRef = useRef<string>('');  // 확정된 텍스트 누적
  
  // [advice from AI] ★★★ 30자 블록 졸업 시스템 ★★★
  // - graduatedBlockRef: 상단에 올라간 30자 블록
  // - currentBlockRef: 현재 하단에서 채워지는 텍스트 (0~30자)
  // - 30자 차면 → 통째로 상단으로 졸업 → 하단 비우고 새로 시작
  const lastLinesRef = useRef<Array<{text: string; speaker: number; start: string; end: string}>>([]);
  const lastGraduatedSpeakerRef = useRef<number>(-1);
  const collectorStartTimeRef = useRef<number>(0);
  const addedToListIndexRef = useRef<number>(-1);
  // [advice from AI] ★★★ 30자 블록 관리 ★★★
  const graduatedBlockRef = useRef<string>('');      // 상단 = 올라간 30자 블록
  const currentBlockRef = useRef<string>('');        // 하단 = 현재 채우는 중 (0~30자)
  const lastProcessedTextRef = useRef<string>('');   // 마지막으로 처리한 전체 텍스트
  const CHARS_PER_LINE = 30;     // 한 줄당 글자 수
  
  // [advice from AI] ★★★ 30자 블록 JSON 시간 추적 ★★★
  // - blockJsonStartRef: 30자 블록 시작 시 첫 lines의 JSON start 시간
  // - blockJsonEndRef: 마지막 lines의 JSON end 시간 (계속 업데이트)
  const blockJsonStartRef = useRef<number>(0);       // 블록 시작 시간 (JSON)
  const blockJsonEndRef = useRef<number>(0);         // 블록 끝 시간 (JSON)
  const blockStartedRef = useRef<boolean>(false);    // 블록 시작 여부
  
  // [advice from AI] ★★★ 졸업된 텍스트 중복 방지 ★★★
  const graduatedTextsRef = useRef<Set<string>>(new Set());
  const graduatedTotalLengthRef = useRef<number>(0);  // 지금까지 졸업한 총 글자 수

  // [advice from AI] ★ 버퍼 타임아웃 기반 자막 확정
  // - WhisperLiveKit의 lines가 잘 안 오는 문제 대응
  // - 버퍼가 3초간 변경 없으면 자막 목록에 추가
  const bufferTimeoutRef = useRef<number | null>(null);
  const lastBufferForListRef = useRef<string>('');  // 자막 목록용 버퍼
  const bufferStartTimeRef = useRef<number>(0);     // 버퍼 시작 시간
  const BUFFER_CONFIRM_TIMEOUT = 5000;              // [advice from AI] 5초로 늘려서 WhisperLiveKit이 수정할 시간 확보

  // [advice from AI] 자막 목록 추가 함수 - 기록 로직 제거됨
  const _addSentenceToList = useCallback((_text: string, _speaker?: string) => {
    // 자막 목록 기록 로직 제거됨
  }, []);

  // [advice from AI] 화면용 연속 텍스트 ref (handleBufferUpdate보다 먼저 선언)
  const displayTextRef = useRef<string>('');
  const lastCompletedTextRef = useRef<string>('');
  
  // [advice from AI] ★★★ 새 자막 규칙 - 수집창 기반 3줄 시스템 ★★★
  // - 하단(수집창): 현재 버퍼 텍스트가 실시간으로 표시됨
  // - 30자 넘으면: 단어 단위로 끊어서 앞부분은 졸업, 나머지는 수집창에 유지
  // - 졸업 시: 가운데 → 최상단으로 이동, 새 졸업 줄 → 가운데로
  const updateCollectorLine = useCallback((bufferText: string) => {
    const maxLen = MAX_LINE_LENGTH;
    const text = bufferText.trim();
    
    // [advice from AI] ★ 디버깅 로그
    console.log(`[COLLECTOR] 📥 입력: "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}" (${text.length}자)`);
    
    // [advice from AI] 빈 텍스트일 때는 수집창만 비움 (졸업한 줄들은 유지!)
    if (text.length === 0) {
      collectorLineRef.current = '';
      setLiveSubtitleLines([topLineRef.current, middleLineRef.current]);
      console.log(`[COLLECTOR] ⚠️ 빈 입력 → 수집창만 비움`);
      return;
    }
    
    // [advice from AI] ★ 수집창이 30자 이하면 백그라운드에서만 처리
    if (text.length <= maxLen) {
      collectorLineRef.current = text;
      // 화면 업데이트 없음 (수집줄은 백그라운드)
      console.log(`[COLLECTOR] 📝 수집 중(백그라운드): "${text}" (${text.length}자)`);
      return;
    }
    
    // [advice from AI] ★★★ 30자 초과 → 졸업 처리! ★★★
    // 단어 단위로 끊어서 앞부분은 졸업, 나머지는 수집창에 유지
    let breakPoint = maxLen;
    
    // 띄어쓰기 찾기 (단어가 잘리지 않도록)
    for (let i = maxLen; i >= Math.floor(maxLen * 0.7); i--) {
      if (text[i] === ' ') {
        breakPoint = i;
        break;
      }
    }
    
    const graduatingText = text.slice(0, breakPoint).trim();  // 졸업할 텍스트
    const remainingText = text.slice(breakPoint).trim();      // 수집창에 남을 텍스트
    
    console.log(`[COLLECTOR] 🎓 졸업! "${graduatingText}" (${graduatingText.length}자)`);
    console.log(`[COLLECTOR] 📝 남은: "${remainingText}" (${remainingText.length}자)`);
    
    // [advice from AI] ★★★ 졸업 처리: 가운데 → 최상단, 졸업 텍스트 → 가운데 ★★★
    topLineRef.current = middleLineRef.current;  // 기존 가운데가 최상단으로
    middleLineRef.current = graduatingText;      // 졸업 텍스트가 가운데로
    collectorLineRef.current = remainingText;    // 나머지가 수집창으로
    
    // [advice from AI] ★★★ 핵심: 졸업하면 누적 텍스트 초기화! ★★★
    collectorAccumulatedRef.current = '';
    console.log(`[COLLECTOR] 🔄 누적 초기화 + 졸업 텍스트 저장 "${graduatingText.substring(0, 20)}..."`);
    
    // 화면 업데이트 - 2줄만 (수집줄은 백그라운드)
    setLiveSubtitleLines([topLineRef.current, middleLineRef.current]);
    
    console.log(`[COLLECTOR] 🖥️ 화면:`, {
      top: topLineRef.current ? `"${topLineRef.current.substring(0, 25)}..."` : '(empty)',
      mid: `"${middleLineRef.current.substring(0, 25)}..."`,
      collector: `"${remainingText}"`
    });
    
    // [advice from AI] ★ 남은 텍스트도 30자 초과면 재귀적으로 처리
    if (remainingText.length > maxLen) {
      console.log(`[COLLECTOR] 🔄 남은 텍스트도 초과 → 재처리`);
      updateCollectorLine(remainingText);
    }
  }, [MAX_LINE_LENGTH]);

  // [advice from AI] 비디오 오디오 캡처 - 최종 결과 (WhisperLiveKit에서 문장 완성 시)
  // ★ 자막 목록: 신뢰성 있는 후처리된 문장 + 정확한 타임스탬프 + 화자 구분
  const handleVideoAudioSubtitle = useCallback((subtitle: VideoAudioSubtitle) => {
    const rawText = subtitle.text.trim();
    if (!rawText) return;
    
    // [advice from AI] ★ lines가 오면 버퍼 타임아웃 취소! (중복 방지)
    if (bufferTimeoutRef.current) {
      clearTimeout(bufferTimeoutRef.current);
      bufferTimeoutRef.current = null;
    }
    // 버퍼도 리셋 (이미 lines로 처리됨)
    lastBufferForListRef.current = '';
    
    console.log(`[SUBTITLE-LIST] 📨 "${rawText.substring(0, 50)}..." [${subtitle.startTime.toFixed(1)}s~${subtitle.endTime.toFixed(1)}s]`);
    
    lastLiveSpeakerRef.current = subtitle.speaker;
    
    // 화면 표시용 텍스트 업데이트
    const preserveLength = MAX_LINE_LENGTH * 2;
    lastCompletedTextRef.current = rawText.slice(-preserveLength);
    displayTextRef.current = rawText.slice(-preserveLength);
    lastBufferTextRef.current = '';
    
    // [advice from AI] ★ 화면 표시는 handleBufferUpdate에서 수집창 기반으로 처리
    // lines 확정 시점에서는 별도 화면 업데이트 불필요 (버퍼가 계속 업데이트 중)
    
    // Step 1: 문장 분리
    const rawSentences = rawText
      .split(/(?<=[.?!。？！])\s*/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    if (rawSentences.length === 0) {
      rawSentences.push(rawText);
    }
    
    // Step 2: 후처리 (설정에 따라)
    const processedSentences: { original: string; processed: string }[] = [];
    
    for (const sentence of rawSentences) {
      // [advice from AI] ★ postprocess_enabled 설정에 따라 후처리 적용
      const processed = subtitleRules.postprocess_enabled 
        ? postprocessText(sentence, true)
        : sentence;
      if (processed && processed.length > 0) {
        processedSentences.push({ original: sentence, processed });
      }
    }
    
    if (processedSentences.length === 0) {
      processedSentences.push({ original: rawText, processed: rawText });
    }
    
    // Step 3: 타임스탬프 분배
    const totalDuration = Math.max(subtitle.endTime - subtitle.startTime, 1);
    const durationPerSentence = totalDuration / processedSentences.length;
    
    // Step 4: 자막 목록에 추가 (강화된 중복 체크)
    const newSubtitles: SubtitleSegment[] = [];
    
    processedSentences.forEach(({ processed }, index) => {
      // [advice from AI] ★ 최근 5개 텍스트와 비교 (강화된 중복 방지)
      if (isRecentlyAdded(processed)) {
        console.log(`[SUBTITLE-LIST] ⏭️ 중복 스킵: "${processed.substring(0, 30)}..."`);
        return;
      }
      
      const startTime = subtitle.startTime + (durationPerSentence * index);
      const endTime = subtitle.startTime + (durationPerSentence * (index + 1));
      
      segmentIdRef.current += 1;
      const newSubtitle: SubtitleSegment = {
        id: segmentIdRef.current,
        startTime: startTime,
        endTime: endTime,
        text: processed,
        speaker: subtitle.speaker
      };
      
      newSubtitles.push(newSubtitle);
      displayedIdsRef.current.add(segmentIdRef.current);
      addToRecentTexts(processed);  // [advice from AI] ★ 최근 목록에 추가
    });
    
    // [advice from AI] 자막 목록 기록 로직 제거됨
    
    currentSentenceRef.current = '';
  }, [isRecentlyAdded, addToRecentTexts]);

  // [advice from AI] ★★★ 확정 인덱스 기반 졸업 시스템 ★★★
  // 핵심 원칙:
  // 1. lines[confirmedIndex+1]이 생기면 → 졸업!
  // 2. buffer → 수집줄 (실시간 표시)
  // 3. 20자 넘으면 강제 졸업
  // 4. 화자 변경 시 '-' 추가
  // 5. 4초 묵음 → 자막창 초기화
  
  // [advice from AI] 시간 문자열 파싱 ("0:00:05" → 5.0)
  const parseTimeString = (timeStr: string | number | undefined): number => {
    if (typeof timeStr === 'number') return timeStr;
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const parts = timeStr.split(':');
    if (parts.length === 3) {
      const [h, m, s] = parts.map(Number);
      return h * 3600 + m * 60 + s;
    }
    if (parts.length === 2) {
      const [m, s] = parts.map(Number);
      return m * 60 + s;
    }
    return 0;
  };
  
  // [advice from AI] 졸업 처리 함수 - lines 항목을 졸업시킴
  const graduateLine = useCallback((lineText: string, lineSpeaker: number, startTimeStr: string, endTimeStr: string) => {
    const text = lineText.trim();
    if (!text) return;
    
    // 후처리
    const processed = subtitleRules.postprocess_enabled
      ? (postprocessText(text, true) || '').trim()
      : text;
    if (!processed) return;
    
    // 화자 변경 시 '-' 추가
    let finalText = processed;
    if (lastGraduatedSpeakerRef.current >= 0 && 
        lineSpeaker >= 0 && 
        lineSpeaker !== lastGraduatedSpeakerRef.current) {
      finalText = '- ' + processed;
      console.log(`[졸업] 🔄 화자 변경: ${lastGraduatedSpeakerRef.current} → ${lineSpeaker}`);
    }
    
    // 화자 업데이트
    if (lineSpeaker >= 0) {
      lastGraduatedSpeakerRef.current = lineSpeaker;
    }
    
    console.log(`[졸업] 🎓 "${finalText.substring(0, 30)}..." (${finalText.length}자)`);
    
    // 졸업 처리: 이전 졸업줄 → 최상단, 새 졸업줄 → 가운데
    topLineRef.current = middleLineRef.current;
    middleLineRef.current = finalText;
    collectorLineRef.current = '';  // 수집줄 클리어
    
    // 화면 업데이트
    setLiveSubtitleLines([topLineRef.current, middleLineRef.current]);
    
    // [advice from AI] 자막 목록/캐시 기록 로직 제거됨
    addToRecentTexts(finalText);
  }, [subtitleRules.postprocess_enabled, addToRecentTexts]);
  
  // [advice from AI] 강제 졸업 (버퍼가 20자 넘을 때)
  const forceGraduateFromBuffer = useCallback((text: string) => {
    if (!text || text.length < 5) return;
    
    const processed = subtitleRules.postprocess_enabled
      ? (postprocessText(text, true) || '').trim()
      : text;
    if (!processed) return;
    
    console.log(`[강제졸업] 🎓 "${processed.substring(0, 30)}..." (${processed.length}자)`);
    
    // 졸업 처리
    topLineRef.current = middleLineRef.current;
    middleLineRef.current = processed;
    
    // 화면 업데이트 (수집줄은 나중에 설정)
    setLiveSubtitleLines([topLineRef.current, middleLineRef.current]);
    
    // [advice from AI] 자막 목록/캐시 기록 로직 제거됨
    addToRecentTexts(processed);
    
    // 수집줄 시작 시간 갱신
    collectorStartTimeRef.current = currentTimeRef.current;
  }, [subtitleRules.postprocess_enabled, addToRecentTexts]);
  
  // [advice from AI] 묵음 타이머 리셋
  const resetSilenceTimer = useCallback(() => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    silenceTimeoutRef.current = window.setTimeout(() => {
      console.log(`[묵음] ⏰ 4초 묵음 → 자막창 초기화`);
      topLineRef.current = '';
      middleLineRef.current = '';
      collectorLineRef.current = '';
      graduatedBlockRef.current = '';    // 상단 블록 초기화
      currentBlockRef.current = '';      // 하단 블록 초기화
      lastProcessedTextRef.current = ''; // 처리 기록 초기화
      setLiveSubtitleLines(['', '']);
    }, 4000);  // 4초 묵음 → 초기화
  }, []);
  
  const handleBufferUpdate = useCallback((buffer: BufferUpdate) => {
    const lines = buffer.lines || [];
    const bufferText = (buffer.text || '').trim();
    
    // [advice from AI] 묵음 타이머 리셋 (텍스트가 있을 때만)
    if (bufferText || lines.length > 0) {
      resetSilenceTimer();
    }
    
    // ========== 1. lines 리셋 감지 ==========
    // [advice from AI] ★★★ 핵심: lines가 리셋되어도 graduatedTotalLengthRef와 graduatedBlockRef는 유지! ★★★
    if (lines.length < lastLinesRef.current.length) {
      console.log(`[lines] 🔄 리셋: ${lastLinesRef.current.length} → ${lines.length} (졸업 총길이: ${graduatedTotalLengthRef.current}자 유지)`);
      lastLinesRef.current = [];
      addedToListIndexRef.current = -1;
      // [advice from AI] graduatedBlockRef는 유지! (화면에 졸업 텍스트 계속 표시)
      // graduatedBlockRef.current = '';  // 유지!
      currentBlockRef.current = '';
      lastProcessedTextRef.current = '';
      collectorStartTimeRef.current = currentTimeRef.current;
      // JSON 시간 ref 초기화
      blockJsonStartRef.current = currentTimeRef.current;  // 현재 비디오 시간으로
      blockJsonEndRef.current = currentTimeRef.current;
      blockStartedRef.current = false;
    }
    
    // ========== 2. 후처리 함수 ==========
    const processLineText = (text: string): string => {
      if (!text) return '';
      const processed = subtitleRules.postprocess_enabled
        ? (postprocessText(text, true) || '').trim()
        : text.trim();
      return processed;
    };
    
    // ========== 3. 전체 lines 텍스트 수집 ==========
    // [advice from AI] ★★★ 화자 변경 감지: 이전 line과 직접 비교 (항상 동일한 결과 보장) ★★★
    let allConfirmedText = '';
    let prevLineSpeaker = -1;  // 이전 line의 speaker (lines 배열 내에서 비교)
    
    for (const line of lines) {
      if (line && line.text?.trim() && line.speaker !== -2) {
        const processed = processLineText(line.text);
        if (processed) {
          // [advice from AI] ★★★ 화자 변경 시 '-' 추가 (이전 line과 비교 - 항상 일관됨) ★★★
          const speakerChanged = prevLineSpeaker >= 0 && 
                                  line.speaker >= 0 && 
                                  line.speaker !== prevLineSpeaker;
          
          if (allConfirmedText) {
            allConfirmedText += speakerChanged ? ' - ' + processed : ' ' + processed;
          } else {
            allConfirmedText = processed;
          }
          
          // 현재 line의 speaker 기록 (다음 line과 비교용)
          if (line.speaker >= 0) {
            prevLineSpeaker = line.speaker;
            lastGraduatedSpeakerRef.current = line.speaker;
          }
        }
      }
    }
    
    // ========== 4. 30자 블록 졸업 시스템 ==========
    // [advice from AI] ★★★ 핵심: 졸업한 총 길이를 추적해서 중복 방지 ★★★
    
    // 전체 텍스트 길이와 이미 졸업한 길이 비교
    const totalTextLength = allConfirmedText.length;
    const alreadyGraduatedLength = graduatedTotalLengthRef.current;
    
    // 이미 졸업한 부분은 스킵하고, 새로운 부분만 처리
    if (totalTextLength <= alreadyGraduatedLength) {
      // 이미 다 처리한 텍스트 → 새 졸업 없음
      // 하지만 화면 표시용 블록은 업데이트 (graduatedBlockRef는 유지!)
      const displayOffset = alreadyGraduatedLength % CHARS_PER_LINE;
      currentBlockRef.current = allConfirmedText.slice(Math.max(0, totalTextLength - displayOffset));
      // graduatedBlockRef는 그대로 유지 (이미 졸업한 텍스트 표시)
    } else {
      // 새로운 텍스트가 있음
      // 현재 블록 위치 계산: (이미 졸업한 길이) % 30
      const blockOffset = alreadyGraduatedLength % CHARS_PER_LINE;
      
      // 새로 추가된 부분만 추출
      const newPartStart = Math.max(alreadyGraduatedLength, 0);
      const newText = allConfirmedText.slice(newPartStart);
      
      // 블록 시작 시간 기록 (첫 졸업 전)
      if (!blockStartedRef.current) {
        blockJsonStartRef.current = currentTimeRef.current;
        blockStartedRef.current = true;
      }
      
      // 현재 블록 = 이전 미완성 부분 + 새 텍스트
      currentBlockRef.current = allConfirmedText.slice(alreadyGraduatedLength - blockOffset);
      
      // [advice from AI] ★★★ 성능 개선: 한 번에 1개 블록만 졸업! ★★★
      // while → if 변경: 나머지는 다음 업데이트에서 자연스럽게 분산 처리
      // 이렇게 하면 한꺼번에 우르르 몰려나오는 현상 방지
      if (currentBlockRef.current.length >= CHARS_PER_LINE) {
        // 앞 30자 → 졸업
        const graduatingText = currentBlockRef.current.slice(0, CHARS_PER_LINE);
        graduatedBlockRef.current = graduatingText;
        // 나머지 → 다음 블록
        currentBlockRef.current = currentBlockRef.current.slice(CHARS_PER_LINE);
        
        // [advice from AI] ★★★ 중복 체크 - 앞 15자 기준 ★★★
        const checkKey = graduatingText.slice(0, 15);
        if (!graduatedTextsRef.current.has(checkKey)) {
          // 졸업 텍스트 기록 (앞 15자로)
          graduatedTextsRef.current.add(checkKey);
          graduatedTotalLengthRef.current += CHARS_PER_LINE;
          
          // [advice from AI] ★★★ 졸업 이벤트 → 자막 목록에 기록! ★★★
          // 시간은 현재 비디오 시간 기준
          const startTime = blockJsonStartRef.current;
          const endTime = currentTimeRef.current;
          
          segmentIdRef.current += 1;
          
          // [advice from AI] ★★★ 성능 최적화: 큐에 추가만 하고 즉시 반환 ★★★
          // 실제 목록 추가는 1초마다 배치 처리됨 → 화면 렌더링 우선!
          const subtitle: SubtitleSegment = {
            id: segmentIdRef.current,
            startTime: startTime,
            endTime: endTime,
            text: graduatingText,
            speaker: lastGraduatedSpeakerRef.current >= 0 ? `화자${lastGraduatedSpeakerRef.current + 1}` : undefined,
          };
          pendingSubtitlesRef.current.push(subtitle);  // 큐에 추가만! (setState 없음)
          
          // 다음 블록의 시작 시간 갱신
          blockJsonStartRef.current = endTime;
        } else {
          console.log(`[졸업] ⏭️ 중복 스킵: "${graduatingText.substring(0, 20)}..."`);
          graduatedTotalLengthRef.current += CHARS_PER_LINE;
        }
      }
    }
    
    lastProcessedTextRef.current = allConfirmedText;
    
    const topLine = graduatedBlockRef.current;
    const bottomLine = currentBlockRef.current;
    
    // 변경 감지
    if (topLine !== topLineRef.current || bottomLine !== middleLineRef.current) {
      console.log(`[졸업] 📝 상단: "${topLine}" (${topLine.length}자) | 하단: "${bottomLine}" (${bottomLine.length}자)`);
    }
    
    topLineRef.current = topLine;
    middleLineRef.current = bottomLine;
    
    // ========== 3. 새 lines가 자막 목록에 추가 ==========
    // 마지막 lines가 새로 추가됐으면 자막 목록에도 추가
    if (lines.length > 0 && lines.length - 1 > addedToListIndexRef.current) {
      const newIdx = lines.length - 1;
      const newLine = lines[newIdx];
      
      if (newLine && newLine.text?.trim() && newLine.speaker !== -2) {
        const finalText = processLineText(newLine.text, newLine.speaker);
        
        if (finalText) {
          // 자막 목록에 추가
          const videoStartTime = currentTimeRef.current - parseTimeString(newLine.end);
          const startTime = videoStartTime + parseTimeString(newLine.start);
          const endTime = videoStartTime + parseTimeString(newLine.end);
          
          // [advice from AI] 자막 목록/캐시 기록 로직 제거됨
          addToRecentTexts(finalText);
          
          console.log(`[자막] ✅ "${finalText.substring(0, 30)}..."`);
          segmentIdRef.current += 1;
        }
        
        addedToListIndexRef.current = newIdx;
      }
    }
    
    // ========== 4. buffer → 수집줄 ==========
    let collector = '';
    
    if (bufferText) {
          const processed = subtitleRules.postprocess_enabled 
        ? (postprocessText(bufferText, false) || '').trim()
        : bufferText;
      
      if (processed) {
        collector = processed;
        
        // 수집줄 시작 시간 기록
        if (!collectorStartTimeRef.current) {
          collectorStartTimeRef.current = currentTimeRef.current;
        }
      }
    }
    
    // 수집줄이 바뀌었을 때만 로그
    if (collector !== collectorLineRef.current) {
      console.log(`[수집줄] 📝 "${collector.substring(0, 30)}${collector.length > 30 ? '...' : ''}" (${collector.length}자)`);
    }
    
    collectorLineRef.current = collector;
    
    // ========== 5. 화면 업데이트 (2줄만 표시 - 수집줄은 백그라운드) ==========
    setLiveSubtitleLines([topLineRef.current, middleLineRef.current]);
    
    // 이전 lines 저장
    lastLinesRef.current = lines.map(l => ({...l}));
    lastSegmentLinesCountRef.current = lines.length;
  }, [subtitleRules.postprocess_enabled, resetSilenceTimer, addToRecentTexts]);

  // [advice from AI] 비디오 오디오 직접 캡처 → WhisperLiveKit 실시간 STT
  const { 
    isCapturing, 
    startCapture, 
    stopCapture 
  } = useVideoAudioSTT({
    getVideoElement: () => videoPlayerRef.current?.getVideoElement() || null,
    onSubtitle: handleVideoAudioSubtitle,
    onBufferUpdate: handleBufferUpdate,
    onStatusChange: (status) => {
      console.log(`[VIDEO-STT] 상태: ${status}`);
      if (status === 'capturing') {
        setStatus('processing');
        setIsStreaming(true);
        // [advice from AI] ★ 캡처 시작 시 자막 초기화 제거!
        // 기존에 쌓인 자막이 날아가는 문제 해결
        // 초기화는 오직 startCapture() 또는 handlePlay()에서만!
        lastLiveSpeakerRef.current = undefined;
      } else if (status === 'idle') {
        setIsStreaming(false);
      } else if (status === 'error') {
        setStatus('error');
      }
    }
  });

  // [advice from AI] 자막 관련 ref 초기화 함수
  const resetSubtitleRefs = useCallback(() => {
    lastBufferTextRef.current = '';
    lastAddedTextRef.current = '';
    lastSegmentLinesCountRef.current = 0;  // [advice from AI] ★ segment 카운트 초기화
    recentAddedTextsRef.current = [];  // [advice from AI] ★ 최근 텍스트 배열도 초기화
    sentenceStartTimeRef.current = 0;
    currentSentenceRef.current = '';
    displayTextRef.current = '';
    lastCompletedTextRef.current = '';
    setLiveSubtitleLines(['', '']);
    
    // [advice from AI] 자막 규칙 ref 초기화 (3줄)
    topLineRef.current = '';
    middleLineRef.current = '';
    collectorLineRef.current = '';  // 수집창
    collectorAccumulatedRef.current = '';  // 누적 텍스트
    
    // [advice from AI] 30자 블록 JSON 시간 ref 초기화
    blockJsonStartRef.current = 0;
    blockJsonEndRef.current = 0;
    blockStartedRef.current = false;
    graduatedBlockRef.current = '';
    currentBlockRef.current = '';
    lastProcessedTextRef.current = '';
    lastLinesRef.current = [];
    addedToListIndexRef.current = -1;
    graduatedTextsRef.current.clear();  // 졸업 텍스트 중복 체크 초기화
    graduatedTotalLengthRef.current = 0;  // 졸업 총 길이 초기화
    
    // [advice from AI] 버퍼 타임아웃 ref 초기화
    lastBufferForListRef.current = '';
    bufferStartTimeRef.current = 0;
    if (bufferTimeoutRef.current) {
      clearTimeout(bufferTimeoutRef.current);
      bufferTimeoutRef.current = null;
    }
    
    // [advice from AI] 묵음 타이머도 정리
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
  }, []);

  // [advice from AI] 파일 선택
  const handleFileSelect = useCallback((selectedVideo: VideoFile) => {
    setVideo(selectedVideo);
    // [advice from AI] 캐시/목록 초기화 로직 제거됨
    displayedIdsRef.current.clear();
    resetSubtitleRefs();  // 자막 ref 초기화
    setStatus('idle');
    setCurrentSpeaker(null);
    setLatestSubtitleId(null);
    setIsStreaming(false);
    segmentIdRef.current = Date.now();
    
    // 기존 스트림 종료
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, [resetSubtitleRefs]);


  // [advice from AI] 파일 업로드 시 - 실시간 WebSocket 방식으로 변경 (재생 시 캡처 시작)
  // 파일 업로드 시 자동 STT 비활성화 - 재생 버튼 클릭 시 WebSocket 캡처로 실시간 처리
  useEffect(() => {
    if (!video || isYoutubeMode) return;
    
    console.log('[APP] 📤 파일 업로드 감지 → 재생 시 실시간 STT 시작 대기');
    // 이제 재생 버튼 클릭 시 startCapture()로 실시간 WebSocket STT 시작
  }, [video, isYoutubeMode]);

  // [advice from AI] URL 타입 자동 감지
  const detectUrlType = useCallback(async (url: string) => {
    if (!url.trim()) {
      setStreamInfo(null);
      return;
    }
    
    try {
      const response = await fetch(`${API_URL}/api/realtime/stream/detect?url=${encodeURIComponent(url)}`);
      if (response.ok) {
        const data = await response.json();
        setStreamInfo({
          type: data.type,
          description: data.description,
          isLive: data.is_live || data.requires_buffer,
          title: data.title
        });
        console.log(`[STREAM] 🔍 URL 타입 감지: ${data.description}`);
      }
    } catch (error) {
      console.error('[STREAM] URL 감지 실패:', error);
      setStreamInfo(null);
    }
  }, []);

  // [advice from AI] URL 입력 시 자동 감지 (디바운스)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (youtubeUrl.trim()) {
        detectUrlType(youtubeUrl);
      } else {
        setStreamInfo(null);
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [youtubeUrl, detectUrlType]);

  // [advice from AI] 실시간 스트리밍 STT 시작 (3초 버퍼)
  const startLiveStreamSTT = useCallback(async () => {
    if (!youtubeUrl || isStreaming) return;
    
    setIsLiveStreamMode(true);
    setIsYoutubeMode(true);  // [advice from AI] 비디오 플레이어 표시를 위해 추가!
    setStatus('processing');
    // [advice from AI] 캐시/목록 초기화 로직 제거됨
    displayedIdsRef.current.clear();
    resetSubtitleRefs();  // 자막 ref 초기화
    segmentIdRef.current = Date.now();
    setLiveStreamReady(false);
    
    try {
      console.log('[STREAM] 🚀 실시간 스트리밍 STT 시작:', youtubeUrl);
      
      // SSE 연결
      const params = new URLSearchParams({
        url: youtubeUrl,
        stt_engine: sttEngine,
        enable_diarization: 'true',
        buffer_seconds: '3'
      });
      
      const eventSource = new EventSource(`${API_URL}/api/realtime/stream/live?${params}`);
      liveStreamRef.current = eventSource;
      setIsStreaming(true);
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          switch (data.type) {
            case 'init':
              console.log('[STREAM] 📡 초기화:', data.data);
              break;
              
            case 'video_url':
              // [advice from AI] 프록시 URL인 경우 백엔드 주소 붙이기
              let videoUrl = data.data.url;
              if (videoUrl.startsWith('/api/')) {
                videoUrl = `${API_URL}${videoUrl}`;
              }
              console.log('[STREAM] 📺 영상 URL 수신:', videoUrl.substring(0, 80));
              setYoutubeVideoUrl(videoUrl);
              break;
              
            case 'buffering':
              console.log('[STREAM] ⏳ 버퍼링 시작:', data.data.seconds, '초');
              setBufferingCountdown(data.data.seconds);
              
              // 카운트다운 시작
              let count = data.data.seconds;
              const countdownInterval = setInterval(() => {
                count -= 1;
                setBufferingCountdown(count);
                if (count <= 0) {
                  clearInterval(countdownInterval);
                }
              }, 1000);
              break;
              
            case 'ready':
              console.log('[STREAM] ✅ 버퍼링 완료! 재생 준비됨');
              setBufferingCountdown(null);
              setLiveStreamReady(true);
              setStatus('idle');
              break;
              
            case 'subtitle':
              // [advice from AI] 실시간 스트리밍: WebSocket STT가 활성화되어 있으면 SSE 자막 무시
              // WebSocket STT(isCapturing)가 프론트에서 직접 오디오를 캡처하므로 중복 방지
              if (isCapturing) {
                console.log('[STREAM] ⏭️ WebSocket STT 활성화 - SSE 자막 무시');
                break;
              }
              {
                const liveSubData = data.data;
                segmentIdRef.current += 1;
                const liveId = segmentIdRef.current;
                
                // 현재 재생 시간을 타임스탬프로 사용 (실시간이니까)
                const livePlayTime = currentTimeRef.current || 0;
                
                const liveSubtitle: SubtitleSegment = {
                  id: liveId,
                  startTime: livePlayTime,  // 현재 재생 시간!
                  endTime: livePlayTime + 3,
                  text: liveSubData.text,
                  speaker: liveSubData.speaker
                };
                
                // [advice from AI] 실시간 모드: 즉시 전체 텍스트 표시!
                setCurrentSpeaker(liveSubData.speaker || null);
                
                // [advice from AI] 자막 목록 추가 로직 제거됨
                setLatestSubtitleId(liveId);
                
                console.log(`[STREAM] 🎤 실시간 자막: [${livePlayTime.toFixed(1)}s] ${liveSubData.text.substring(0, 30)}...`);
              }
              break;
              
            case 'complete':
              console.log('[STREAM] ✅ 완료:', data.data);
              setStatus('completed');
              setIsStreaming(false);
              break;
              
            case 'error':
              console.error('[STREAM] ❌ 오류:', data.data.message);
              setStatus('error');
              setIsStreaming(false);
              break;
          }
        } catch (e) {
          console.error('[STREAM] 파싱 오류:', e);
        }
      };
      
      eventSource.onerror = (error) => {
        console.error('[STREAM] SSE 오류:', error);
        eventSource.close();
        setIsStreaming(false);
        setStatus('error');
      };
      
    } catch (error) {
      console.error('[STREAM] ❌ 오류:', error);
      setStatus('error');
      setIsLiveStreamMode(false);
    }
  }, [youtubeUrl, isStreaming, sttEngine]);

  // [advice from AI] 실시간 스트리밍 중지
  const stopLiveStream = useCallback(() => {
    if (liveStreamRef.current) {
      liveStreamRef.current.close();
      liveStreamRef.current = null;
    }
    setIsStreaming(false);
    setIsLiveStreamMode(false);
    setLiveStreamReady(false);
    setBufferingCountdown(null);
  }, []);

  // [advice from AI] Whisper STT 서비스 초기화 (향후 사용 예정)
  const _resetWhisperSTT = useCallback(async () => {
    if (isResettingSTT) return;
    
    setIsResettingSTT(true);
    console.log('[APP] 🔄 Whisper STT 초기화 시작...');
    
    try {
      const response = await fetch(`${API_URL}/api/realtime/reset-whisper`, {
        method: 'POST'
      });
      
      const result = await response.json();
      
      if (result.success) {
        console.log('[APP] ✅ Whisper STT 초기화 성공!');
        alert('Whisper STT 서비스가 재시작되었습니다.\n약 30초 후 사용 가능합니다.');
      } else {
        console.error('[APP] ❌ 초기화 실패:', result.message);
        alert(`초기화 실패: ${result.message}`);
      }
    } catch (error) {
      console.error('[APP] ❌ 초기화 오류:', error);
      alert('초기화 중 오류가 발생했습니다.');
    } finally {
      setIsResettingSTT(false);
    }
  }, [isResettingSTT]);

  // [advice from AI] YouTube URL로 라이브 STT 시작 (새 방식 - 빠른 로딩)
  const startYoutubeSTT = useCallback(async () => {
    if (!youtubeUrl || isStreaming) return;
    
    setIsYoutubeMode(true);
    setStatus('processing');
    // [advice from AI] 캐시/목록 초기화 로직 제거됨
    displayedIdsRef.current.clear();
    resetSubtitleRefs();  // 자막 ref 초기화
    segmentIdRef.current = Date.now();
    
    try {
      console.log('[YouTube] 🚀 라이브 STT 시작:', youtubeUrl);
      
      // [advice from AI] 1단계: 영상 정보만 빠르게 가져오기 (다운로드 없음!)
      const response = await fetch(`${API_URL}/api/realtime/youtube/info?youtube_url=${encodeURIComponent(youtubeUrl)}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(errorData.detail || `API Error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.success || !data.video_url) {
        throw new Error('영상 URL을 가져올 수 없습니다');
      }
      
      console.log('[YouTube] ✅ 영상 정보 수신:', data.title);
      console.log('[YouTube] 📺 영상 URL:', data.video_url?.substring(0, 100) + '...');
      
      // [advice from AI] 2단계: 영상 URL 설정 → 비디오 플레이어가 로드
      setYoutubeVideoUrl(data.video_url);
      setYoutubeTitle(data.title);
      setDuration(data.duration || 0);
      
      // [advice from AI] 3단계: 비디오 로드 후 재생 시작 시 라이브 STT 자동 시작
      // handlePlay에서 isYoutubeMode일 때도 라이브 STT 시작하도록 처리
      setStatus('idle');  // 준비 완료 (재생 버튼 누르면 시작)
      
    } catch (error) {
      console.error('[YouTube] ❌ Error:', error);
      setStatus('error');
      setIsYoutubeMode(false);
    }
  }, [youtubeUrl, isStreaming]);

  // [advice from AI] 영상 재생 시작 - 실시간 WebSocket STT 캡처 시작
  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    
    // [advice from AI] 파일 업로드 또는 HLS 스트리밍 모드: 재생과 동시에 WhisperLiveKit 실시간 WebSocket STT 시작
    const hasVideo = video || youtubeVideoUrl;
    
    if (hasVideo && !isCapturing) {
      // ★ WhisperLiveKit 모드: 재생 시 실시간 WebSocket 캡처
      console.log('[APP] ▶️ 재생 시작 → WhisperLiveKit 실시간 STT 캡처!');
      // [advice from AI] ★ 첫 캡처 시작 시에만 초기화 (일시정지 후 재개는 유지!)
      setLiveSubtitleLines(['', '']);
      topLineRef.current = '';
      middleLineRef.current = '';
      collectorLineRef.current = '';  // 수집창
      collectorAccumulatedRef.current = '';  // 누적 텍스트
      displayTextRef.current = '';
      lastCompletedTextRef.current = '';
      lastBufferTextRef.current = '';
      lastSegmentLinesCountRef.current = 0;  // [advice from AI] ★ segment 카운트 초기화
      startCapture();
    } else if (isCapturing) {
      // [advice from AI] ★ 이미 캡처 중이면 자막 유지! (초기화 안 함)
      console.log('[APP] ▶️ 재생 재개 (WhisperLiveKit 캡처 계속 중, 자막 유지)');
    }
  }, [video, youtubeVideoUrl, isCapturing, startCapture]);

  // [advice from AI] 영상 일시정지 - STT는 계속, 다시 재생 가능
  const handlePause = useCallback(() => {
    setIsPlaying(false);
    console.log('[APP] ⏸️ 일시정지');
  }, []);
  
  // [advice from AI] 종료 및 자막 저장 - STT 완전 중지 + 자막 파일 다운로드
  const handleFinishAndExport = useCallback(() => {
    setIsPlaying(false);
    
    // STT 처리 완전 중지
    // [advice from AI] useLiveSTT 제거됨 - WhisperLiveKit(useVideoAudioSTT)만 사용
    stopLiveStream();
    
    // [advice from AI] 실시간 WebSocket 캡처 중지
    if (isCapturing) {
      stopCapture();
    }
    
    // 진행 중인 SSE 연결 종료
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    // 상태 변경
    setStatus('completed');
    setIsStreaming(false);
    
    // 자막이 있으면 SRT 파일 다운로드
    if (displayedSubtitles.length > 0) {
      const formatTime = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        const ms = Math.floor((s % 1) * 1000);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
      };
      
      const srtContent = displayedSubtitles.map((sub, i) => {
        const speaker = sub.speaker ? `[${sub.speaker}] ` : '';
        return `${i + 1}\n${formatTime(sub.startTime)} --> ${formatTime(sub.endTime)}\n${speaker}${sub.text}\n`;
      }).join('\n');
      
      // 파일 다운로드
      const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fileName = video?.name?.replace(/\.[^/.]+$/, '') || youtubeTitle || 'subtitle';
      a.href = url;
      a.download = `${fileName}.srt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log(`[APP] 자막 저장 완료: ${displayedSubtitles.length}개 → ${fileName}.srt`);
    } else {
      console.log('[APP] 저장할 자막이 없습니다.');
    }
  }, [stopLiveStream, displayedSubtitles, video, youtubeTitle, isCapturing, stopCapture]);

  // [advice from AI] 캐시 기반 자막 표시 (스킵 기능 제거됨)
  const lastCaptionTimeRef = useRef<number>(0);
  const lastLogTimeRef = useRef<number>(0);  // 로그 출력용
  
  // [advice from AI] 캐시 기반 시간 매칭 로직 제거됨
  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
    currentTimeRef.current = time;
  }, []);

  const handleDurationChange = useCallback((videoDuration: number) => {
    setDuration(videoDuration);
  }, []);

  const handleRemoveVideo = useCallback(() => {
    // [advice from AI] 라이브 STT 중지
    // [advice from AI] useLiveSTT 제거됨 - WhisperLiveKit(useVideoAudioSTT)만 사용
    stopLiveStream();
    
    // 기존 스트림 종료
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    if (video?.url) {
      URL.revokeObjectURL(video.url);
    }
    setVideo(null);
    // [advice from AI] 캐시/목록 초기화 로직 제거됨
    displayedIdsRef.current.clear();
    resetSubtitleRefs();  // 자막 ref 초기화
    setCurrentTime(0);
    setDuration(0);
    setStatus('idle');
    setIsStreaming(false);  // [advice from AI] STT 상태도 초기화
    setIsPlaying(false);
    setCurrentSpeaker(null);
    setLatestSubtitleId(null);
    setIsPlaying(false);
    setIsStreaming(false);
    segmentIdRef.current = Date.now();
    
    // [advice from AI] YouTube 모드 초기화
    setYoutubeUrl('');
    setYoutubeVideoUrl(null);
    setYoutubeTitle(null);
    setIsYoutubeMode(false);
    
    // [advice from AI] 실시간 스트리밍 모드 초기화
    setStreamInfo(null);
    setIsLiveStreamMode(false);
    setBufferingCountdown(null);
    setLiveStreamReady(false);
  }, [video, stopLiveStream]);

  // [advice from AI] 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      // [advice from AI] useLiveSTT 제거됨 - WhisperLiveKit(useVideoAudioSTT)만 사용
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // [advice from AI] ★ 시간순 정렬된 자막 목록
  const sortedSubtitles = useMemo(() => {
    return [...displayedSubtitles].sort((a, b) => a.startTime - b.startTime);
  }, [displayedSubtitles]);

  // [advice from AI] SRT/VTT 생성 (시간순 정렬된 자막)
  const generateSrtContent = useCallback(() => {
    return sortedSubtitles.map((sub, i) => {
      const formatTime = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        const ms = Math.floor((s % 1) * 1000);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
      };
      const speaker = sub.speaker ? `[${sub.speaker}] ` : '';
      return `${i + 1}\n${formatTime(sub.startTime)} --> ${formatTime(sub.endTime)}\n${speaker}${sub.text}\n`;
    }).join('\n');
  }, [sortedSubtitles]);

  const generateVttContent = useCallback(() => {
    const formatTime = (s: number) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      const ms = Math.floor((s % 1) * 1000);
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    };
    const body = sortedSubtitles.map((sub, i) => {
      const speaker = sub.speaker ? `<v ${sub.speaker}>` : '';
      return `${i + 1}\n${formatTime(sub.startTime)} --> ${formatTime(sub.endTime)}\n${speaker}${sub.text}\n`;
    }).join('\n');
    return `WEBVTT\n\n${body}`;
  }, [displayedSubtitles]);

  return (
    <div className="app">
      <Header />
      
      <main className="main-content">
      
      {/* [advice from AI] WhisperLiveKit 설정 탭 - STT 사전/필터 관리 */}
      {activeTab === 'whisper' && (
        <div style={{ width: '100%', height: 'calc(100vh - 100px)', overflowY: 'auto' }}>
          <AdminPanel />
        </div>
      )}
      
      {/* [advice from AI] 사용 가이드 탭 - 충실하고 깔끔하게 */}
      {activeTab === 'guide' && (
        <div style={{ padding: '40px 20px', maxWidth: '960px', margin: '0 auto' }}>
          {/* 헤더 */}
          <div style={{ marginBottom: '40px', textAlign: 'center' }}>
            <h1 style={{ fontSize: '28px', fontWeight: '700', color: '#1a1a1a', marginBottom: '12px' }}>
              KTV 실시간 AI 자동자막 시스템
            </h1>
            <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6' }}>
              영상을 업로드하거나 URL을 입력하면 AI가 실시간으로 자막을 생성합니다.
        </p>
      </div>

          {/* 빠른 시작 */}
          <div className="card" style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: '600', color: '#0056b3', marginBottom: '20px', paddingBottom: '12px', borderBottom: '2px solid #e8f4fd' }}>
              빠른 시작
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
              <div style={{ padding: '20px', background: '#f8f9fa', borderRadius: '8px', borderLeft: '4px solid #0056b3' }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#0056b3', marginBottom: '8px' }}>STEP 1</div>
                <div style={{ fontSize: '15px', fontWeight: '500', color: '#333', marginBottom: '8px' }}>영상 불러오기</div>
                <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.6' }}>
                  파일을 업로드하거나 YouTube/스트리밍 URL을 입력합니다.
                </div>
              </div>
              <div style={{ padding: '20px', background: '#f8f9fa', borderRadius: '8px', borderLeft: '4px solid #28a745' }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#28a745', marginBottom: '8px' }}>STEP 2</div>
                <div style={{ fontSize: '15px', fontWeight: '500', color: '#333', marginBottom: '8px' }}>재생 버튼 클릭</div>
                <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.6' }}>
                  재생 버튼을 누르면 WhisperLiveKit이 실시간 STT를 시작합니다.
                </div>
              </div>
              <div style={{ padding: '20px', background: '#f8f9fa', borderRadius: '8px', borderLeft: '4px solid #dc3545' }}>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#dc3545', marginBottom: '8px' }}>STEP 3</div>
                <div style={{ fontSize: '15px', fontWeight: '500', color: '#333', marginBottom: '8px' }}>자막 확인 및 저장</div>
                <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.6' }}>
                  실시간으로 생성된 자막을 확인하고 SRT/VTT로 저장합니다.
                </div>
              </div>
            </div>
          </div>

          {/* WhisperLiveKit 특징 */}
          <div className="card" style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: '600', color: '#0056b3', marginBottom: '20px', paddingBottom: '12px', borderBottom: '2px solid #e8f4fd' }}>
              WhisperLiveKit 특징
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
              <div style={{ padding: '16px', background: '#e8f5e9', borderRadius: '8px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: '600', color: '#28a745', marginBottom: '8px' }}>Whisper Large-v3 모델</h3>
                <p style={{ fontSize: '13px', color: '#555', margin: 0, lineHeight: '1.6' }}>
                  OpenAI Whisper의 최신 대형 모델을 사용하여 높은 인식률을 제공합니다.
                </p>
              </div>
              <div style={{ padding: '16px', background: '#fff3cd', borderRadius: '8px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: '600', color: '#856404', marginBottom: '8px' }}>실시간 WebSocket 스트리밍</h3>
                <p style={{ fontSize: '13px', color: '#555', margin: 0, lineHeight: '1.6' }}>
                  영상 재생과 동시에 WebSocket으로 오디오를 전송하여 실시간 자막을 생성합니다.
                </p>
              </div>
              <div style={{ padding: '16px', background: '#e8f4fd', borderRadius: '8px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: '600', color: '#0056b3', marginBottom: '8px' }}>후처리 자동 적용</h3>
                <p style={{ fontSize: '13px', color: '#555', margin: 0, lineHeight: '1.6' }}>
                  비속어 필터, 할루시네이션 제거, 사전 매칭 등 후처리가 자동으로 적용됩니다.
                </p>
              </div>
              <div style={{ padding: '16px', background: '#f8d7da', borderRadius: '8px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: '600', color: '#721c24', marginBottom: '8px' }}>자막 규칙 설정</h3>
                <p style={{ fontSize: '13px', color: '#555', margin: 0, lineHeight: '1.6' }}>
                  WhisperLiveKit 탭에서 줄당 글자수, 페이드아웃 시간 등을 설정할 수 있습니다.
                </p>
              </div>
            </div>
          </div>

          {/* 영상 소스 */}
          <div className="card" style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: '600', color: '#0056b3', marginBottom: '20px', paddingBottom: '12px', borderBottom: '2px solid #e8f4fd' }}>
              지원 영상 소스
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#333', marginBottom: '12px' }}>파일 업로드</h3>
                <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '2', color: '#555', fontSize: '14px' }}>
                  <li>MP4, WebM, MOV, AVI, MKV 지원</li>
                  <li>최대 500MB까지 업로드 가능</li>
                  <li>드래그 앤 드롭 또는 클릭하여 선택</li>
                </ul>
              </div>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#333', marginBottom: '12px' }}>URL 입력</h3>
                <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '2', color: '#555', fontSize: '14px' }}>
                  <li>YouTube 영상 URL</li>
                  <li>HLS 스트리밍 (m3u8)</li>
                  <li>RTMP 라이브 스트림</li>
                  <li>KTV 국민방송 LIVE 프리셋 제공</li>
                </ul>
              </div>
            </div>
          </div>

          {/* 자막 저장 */}
          <div className="card" style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: '600', color: '#0056b3', marginBottom: '20px', paddingBottom: '12px', borderBottom: '2px solid #e8f4fd' }}>
              자막 저장
            </h2>
            <div style={{ lineHeight: '1.8', color: '#555', fontSize: '14px' }}>
              <p style={{ marginBottom: '16px' }}>
                <strong>자동 저장:</strong> 영상 재생을 멈추면(일시정지) 자막 목록에 표시된 내용을 기반으로 
                타임스탬프가 포함된 SRT 파일이 자동으로 다운로드됩니다.
              </p>
              <p style={{ marginBottom: '16px' }}>
                <strong>수동 저장:</strong> 하단의 "자막 내보내기" 영역에서 SRT 또는 VTT 형식을 선택하여 
                다운로드할 수 있습니다.
              </p>
              <div style={{ padding: '16px', background: '#f8f9fa', borderRadius: '8px', marginTop: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#333', marginBottom: '8px' }}>지원 형식</div>
                <div style={{ display: 'flex', gap: '24px' }}>
                  <div>
                    <strong style={{ color: '#0056b3' }}>SRT</strong>
                    <span style={{ color: '#666' }}> - 대부분의 영상 플레이어 호환</span>
                  </div>
                  <div>
                    <strong style={{ color: '#0056b3' }}>VTT</strong>
                    <span style={{ color: '#666' }}> - 웹 브라우저 및 HTML5 비디오 호환</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 주의사항 */}
          <div className="card">
            <h2 style={{ fontSize: '20px', fontWeight: '600', color: '#0056b3', marginBottom: '20px', paddingBottom: '12px', borderBottom: '2px solid #e8f4fd' }}>
              사용 시 참고사항
            </h2>
            <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '2.2', color: '#555', fontSize: '14px' }}>
              <li>음성이 명확할수록 인식률이 높아집니다.</li>
              <li>배경 소음이 많은 영상은 인식률이 떨어질 수 있습니다.</li>
              <li>라이브 스트리밍은 약 2~3초의 지연이 발생할 수 있습니다.</li>
              <li>긴 영상의 경우 처리에 시간이 소요될 수 있습니다.</li>
              <li>"STT 초기화" 버튼으로 WhisperLiveKit 서비스를 재시작할 수 있습니다.</li>
              <li>WhisperLiveKit 탭에서 자막 규칙과 후처리 설정을 관리할 수 있습니다.</li>
            </ul>
          </div>

          {/* 버전 정보 */}
          <div style={{ marginTop: '32px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
            <p>KTV 실시간 AI 자동자막 시스템 POC v1.0</p>
            <p style={{ marginTop: '4px' }}>© 2026 KTV 국민방송 | Powered by WhisperLiveKit</p>
          </div>
        </div>
      )}
      
      {/* [advice from AI] 자막 생성 탭 (기존 메인 컨텐츠) */}
      {activeTab === 'subtitle' && (<>
        <h1 className="page-title">실시간 AI 자동자막 생성</h1>
        <p className="page-subtitle">
          영상을 <strong>재생하면</strong> 백엔드 STT API가 <strong style={{ color: '#dc3545' }}>실시간으로</strong> 자막을 생성합니다.
        </p>

        {!video && !isYoutubeMode ? (
          <div className="card">
            <div className="card-title">영상 소스 선택</div>
            
            {/* [advice from AI] 탭 스타일 선택 UI - 아이콘 제거 */}
            <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>파일 업로드</h3>
                <FileUpload onFileSelect={handleFileSelect} />
              </div>
              
              <div style={{ 
                width: '1px', 
                background: 'linear-gradient(to bottom, transparent, #ddd, transparent)',
                margin: '0 10px'
              }} />
              
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>YouTube / 스트리밍 URL</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <input
                    type="text"
                    placeholder="YouTube URL, HLS(m3u8), RTMP 등..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    style={{
                      padding: '12px 16px',
                      border: '2px solid #e0e0e0',
                      borderRadius: '8px',
                      fontSize: '14px',
                      outline: 'none',
                      transition: 'border-color 0.2s',
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#0056b3'}
                    onBlur={(e) => e.target.style.borderColor = '#e0e0e0'}
                  />
                  
                  {/* [advice from AI] KTV KLIVE 프리셋 버튼 */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => setYoutubeUrl('https://hlive.ktv.go.kr/live/klive_h.stream/chunklist_w1920460308.m3u8')}
                      style={{
                        padding: '8px 14px',
                        background: 'linear-gradient(135deg, #0056b3, #003d82)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'transform 0.1s, box-shadow 0.1s',
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.transform = 'scale(1.02)';
                        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,86,179,0.3)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.transform = 'scale(1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <span>KTV 국민방송 LIVE</span>
                      <span style={{ 
                        background: '#dc3545', 
                        padding: '2px 6px', 
                        borderRadius: '8px', 
                        fontSize: '10px' 
                      }}>실시간</span>
                    </button>
                  </div>
                  
                  {/* [advice from AI] 스트리밍 타입 감지 결과 표시 - 아이콘 제거 */}
                  {streamInfo && (
                    <div style={{ 
                      padding: '10px 14px', 
                      background: streamInfo.isLive ? '#fff3cd' : '#e8f4fd', 
                      borderRadius: '6px',
                      border: `1px solid ${streamInfo.isLive ? '#ffc107' : '#0056b3'}`,
                      fontSize: '13px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 'bold', color: streamInfo.isLive ? '#856404' : '#0056b3' }}>
                          {streamInfo.description}
                        </span>
                        {streamInfo.isLive && (
                          <span style={{ 
                            background: '#dc3545', 
                            color: 'white', 
                            padding: '2px 8px', 
                            borderRadius: '10px', 
                            fontSize: '11px' 
                          }}>
                            LIVE
                          </span>
                        )}
                      </div>
                      {streamInfo.title && (
                        <div style={{ marginTop: '6px', color: '#666', fontSize: '12px' }}>
                          {streamInfo.title}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* [advice from AI] 버튼 영역 - 아이콘 제거 */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {/* 일반 모드 (파일 처리 방식) */}
                    <button
                      onClick={startYoutubeSTT}
                      disabled={!youtubeUrl || isStreaming || (streamInfo?.isLive ?? false)}
                      style={{
                        flex: 1,
                        padding: '12px 24px',
                        background: youtubeUrl && !isStreaming && !streamInfo?.isLive ? '#0056b3' : '#ccc',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        cursor: youtubeUrl && !isStreaming && !streamInfo?.isLive ? 'pointer' : 'not-allowed',
                        transition: 'background 0.2s',
                      }}
                    >
                      파일 처리
                    </button>
                    
                    {/* 실시간 모드 (스트리밍) */}
                    <button
                      onClick={startLiveStreamSTT}
                      disabled={!youtubeUrl || isStreaming}
                      style={{
                        flex: 1,
                        padding: '12px 24px',
                        background: youtubeUrl && !isStreaming ? '#dc3545' : '#ccc',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        cursor: youtubeUrl && !isStreaming ? 'pointer' : 'not-allowed',
                        transition: 'background 0.2s',
                      }}
                    >
                      실시간
                    </button>
                  </div>
                  
                  {/* [advice from AI] 버퍼링 카운트다운 */}
                  {bufferingCountdown !== null && (
                    <div style={{ 
                      padding: '20px', 
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
                      borderRadius: '12px',
                      textAlign: 'center',
                      color: 'white'
                    }}>
                      <div style={{ fontSize: '14px', marginBottom: '8px' }}>버퍼링 중...</div>
                      <div style={{ fontSize: '48px', fontWeight: 'bold' }}>{bufferingCountdown}</div>
                      <div style={{ fontSize: '12px', marginTop: '8px', opacity: 0.8 }}>
                        STT 처리를 위해 잠시 기다려주세요
                      </div>
                    </div>
                  )}
                  
                  {/* [advice from AI] 실시간 모드 준비 완료 */}
                  {liveStreamReady && (
                    <div style={{ 
                      padding: '16px', 
                      background: '#d4edda', 
                      borderRadius: '8px',
                      border: '1px solid #28a745',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#28a745' }}>
                        버퍼링 완료
                      </div>
                      <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
                        재생 버튼을 눌러 영상과 자막을 시작하세요
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* [advice from AI] 1. 동영상 플레이어 (전체 너비) - 라이브 STT 연동 */}
            {/* [advice from AI] liveCurrentBuffer 제거 - liveSubtitleLines만 사용 */}
            <VideoPlayer
              ref={videoPlayerRef}
              video={video}
              videoUrl={youtubeVideoUrl}
              currentSpeaker={currentSpeaker}
              subtitleLines={subtitleLines}
              liveSubtitleLines={isCapturing ? liveSubtitleLines : undefined}
              onTimeUpdate={handleTimeUpdate}
              onDurationChange={handleDurationChange}
              onPlay={handlePlay}
              onPause={handlePause}
              isProcessing={isStreaming || isCapturing}
            />

            {/* [advice from AI] 2. 파일 정보 + 시스템 모니터링 (가로 배치) */}
            <div style={{ display: 'flex', gap: '16px', alignItems: 'stretch' }}>
              {/* 파일 정보 */}
              <div className="card" style={{ flex: 1, margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '14px', color: '#666', marginBottom: '4px' }}>재생 중</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold' }}>
                      {video?.name || youtubeTitle || '영상'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {displayedSubtitles.length > 0 && (
                      <button 
                        className="btn btn-primary" 
                        onClick={handleFinishAndExport}
                        style={{ backgroundColor: '#28a745', borderColor: '#28a745' }}
                      >
                        종료 및 저장
                      </button>
                    )}
                    <button className="btn btn-secondary" onClick={handleRemoveVideo}>
                      다른 영상 선택
                    </button>
                  </div>
                </div>
              </div>

              {/* 시스템 모니터링 (가로 컴팩트) */}
              <div className="card" style={{ flex: 2, margin: 0 }}>
                <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', color: '#666' }}>상태</span>
                    <span style={{ 
                      fontSize: '13px', 
                      fontWeight: 'bold',
                      color: isStreaming ? '#dc3545' : status === 'completed' ? '#28a745' : '#666'
                    }}>
                      {isStreaming ? 'LIVE' : status === 'completed' ? '완료' : '대기'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', color: '#666' }}>재생</span>
                    <span style={{ fontSize: '13px', fontWeight: 'bold' }}>
                      {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', color: '#666' }}>길이</span>
                    <span style={{ fontSize: '13px', fontWeight: 'bold' }}>
                      {duration > 0 ? `${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}` : '-'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', color: '#666' }}>자막</span>
                    <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#0056b3' }}>
                      {displayedSubtitles.length}개
                    </span>
                  </div>
                  {currentSpeaker && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', color: '#666' }}>화자</span>
                      <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#0073cf' }}>
                        {currentSpeaker}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* [advice from AI] 3. 자막 리스트 (전체 너비, 하단) - SRT 다운로드 + 수동 편집 기능 */}
            <div className="card" style={{ margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div className="card-title" style={{ margin: 0 }}>자막 목록</div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  {isStreaming && (
                    <span style={{ 
                      fontSize: '12px', 
                      color: '#dc3545', 
                      fontWeight: 'bold',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <span style={{
                        width: '8px',
                        height: '8px',
                        background: '#dc3545',
                        borderRadius: '50%',
                        animation: 'pulse 1s infinite'
                      }}></span>
                      실시간
                    </span>
                  )}
                  <span style={{ fontSize: '13px', color: '#666' }}>
                    총 {displayedSubtitles.length}개
                  </span>
                  {/* [advice from AI] SRT 다운로드 버튼 */}
                  <button
                    onClick={() => {
                      if (displayedSubtitles.length === 0) return;
                      const srtContent = generateSrtContent();
                      const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      const baseName = (video?.name || youtubeTitle || 'subtitle').replace(/\.[^/.]+$/, '');
                      link.download = `${baseName}.srt`;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      URL.revokeObjectURL(url);
                      console.log(`[APP] 📥 SRT 다운로드: ${displayedSubtitles.length}개 자막`);
                    }}
                    disabled={displayedSubtitles.length === 0}
                    style={{
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: '600',
                      color: displayedSubtitles.length === 0 ? '#999' : '#fff',
                      background: displayedSubtitles.length === 0 ? '#e0e0e0' : '#0073cf',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: displayedSubtitles.length === 0 ? 'not-allowed' : 'pointer',
                      transition: 'background 0.2s'
                    }}
                  >
                    SRT 다운로드
                  </button>
                </div>
              </div>
              
              {displayedSubtitles.length === 0 ? (
                <div style={{ 
                  textAlign: 'center', 
                  padding: '40px 20px',
                  color: '#999',
                  fontSize: '14px'
                }}>
                  영상을 재생하면 자막이 여기에 표시됩니다
                </div>
              ) : (
                <>
                <div style={{ 
                  maxHeight: '200px', 
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                    {/* [advice from AI] ★ 시간순 정렬된 자막 목록 */}
                    {sortedSubtitles.map((sub) => {
                      const isEditing = editingSubtitleId === sub.id;
                      
                      return (
                    <div 
                      key={sub.id}
                          style={{
                            display: 'flex',
                            gap: '12px',
                            padding: '8px 12px',
                            background: isEditing ? '#fff8e1' : sub.id === latestSubtitleId ? '#e8f4fd' : '#f8f9fa',
                            borderRadius: '6px',
                            borderLeft: isEditing ? '3px solid #ffc107' : sub.id === latestSubtitleId ? '3px solid #0056b3' : '3px solid transparent',
                            transition: 'all 0.2s',
                            alignItems: 'center'
                          }}
                        >
                          {/* 시간 - 클릭 시 해당 시간으로 이동 */}
                          <span 
                      onClick={() => {
                        const videoElement = videoPlayerRef.current?.getVideoElement();
                        if (videoElement) {
                          videoElement.currentTime = sub.startTime;
                          videoElement.play();
                          console.log(`[APP] 🎯 자막 클릭 → ${sub.startTime.toFixed(1)}초로 이동`);
                        }
                      }}
                      style={{
                              fontSize: '12px', 
                              color: '#666',
                              minWidth: '50px',
                        cursor: 'pointer'
                      }}
                            title="클릭하여 해당 시간으로 이동"
                    >
                        {Math.floor(sub.startTime / 60).toString().padStart(2, '0')}:
                        {Math.floor(sub.startTime % 60).toString().padStart(2, '0')}
                      </span>
                          
                          {/* 화자 */}
                      {sub.speaker && (
                        <span style={{
                          fontSize: '11px',
                          background: '#0073cf',
                          color: '#fff',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          whiteSpace: 'nowrap'
                        }}>
                          {sub.speaker}
                        </span>
                      )}
                          
                          {/* 텍스트 - 편집 모드 */}
                          {isEditing ? (
                            <div style={{ flex: 1, display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <input
                                type="text"
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    // 저장
                                    setDisplayedSubtitles(prev => 
                                      prev.map(s => s.id === sub.id ? { ...s, text: editText } : s)
                                    );
                                    setEditingSubtitleId(null);
                                    setEditText('');
                                    console.log(`[APP] ✏️ 자막 편집 완료: "${editText.substring(0, 20)}..."`);
                                  } else if (e.key === 'Escape') {
                                    // 취소
                                    setEditingSubtitleId(null);
                                    setEditText('');
                                  }
                                }}
                                autoFocus
                                style={{
                                  flex: 1,
                                  padding: '4px 8px',
                                  fontSize: '14px',
                                  border: '2px solid #ffc107',
                                  borderRadius: '4px',
                                  outline: 'none'
                                }}
                              />
                              <button
                                onClick={() => {
                                  setDisplayedSubtitles(prev => 
                                    prev.map(s => s.id === sub.id ? { ...s, text: editText } : s)
                                  );
                                  setEditingSubtitleId(null);
                                  setEditText('');
                                }}
                                style={{
                                  padding: '4px 8px',
                                  fontSize: '11px',
                                  color: '#fff',
                                  background: '#28a745',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                저장
                              </button>
                              <button
                                onClick={() => {
                                  setEditingSubtitleId(null);
                                  setEditText('');
                                }}
                                style={{
                                  padding: '4px 8px',
                                  fontSize: '11px',
                                  color: '#666',
                                  background: '#e0e0e0',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                취소
                              </button>
                    </div>
                          ) : (
                            /* 텍스트 - 일반 모드 (더블클릭으로 편집) */
                            <span 
                              onDoubleClick={() => {
                                setEditingSubtitleId(sub.id);
                                setEditText(sub.text);
                              }}
                              style={{ 
                                fontSize: '14px', 
                                flex: 1,
                                cursor: 'text',
                                padding: '2px 4px',
                                borderRadius: '4px'
                              }}
                              title="더블클릭하여 편집"
                            >
                              {sub.text}
                            </span>
                          )}
                          
                          {/* NEW 표시 */}
                          {sub.id === latestSubtitleId && !isEditing && (
                            <span style={{
                              fontSize: '9px',
                              color: '#fff',
                              background: '#dc3545',
                              padding: '1px 6px',
                              borderRadius: '8px',
                              fontWeight: 'bold'
                            }}>
                              NEW
                            </span>
                          )}
                </div>
                      );
                    })}
                  </div>
                  {/* [advice from AI] 편집 안내 */}
                  <div style={{ 
                    marginTop: '8px', 
                    fontSize: '11px', 
                    color: '#888',
                    textAlign: 'right'
                  }}>
                    💡 자막을 더블클릭하면 직접 편집할 수 있습니다
                  </div>
                </>
              )}
            </div>

            {/* [advice from AI] 4. 자막 내보내기 */}
            <SubtitleExport 
              subtitles={displayedSubtitles} 
              videoName={video?.name || youtubeTitle || 'video'}
              disabled={displayedSubtitles.length === 0}
              srtContent={generateSrtContent()}
              vttContent={generateVttContent()}
            />
          </div>
        )}
      </>)}
      </main>

      <footer className="footer">
        <p>© 2026 KTV 국민방송 | 실시간 AI 자동자막 시스템 POC</p>
      </footer>
      </div>
  );
}

export default App;
