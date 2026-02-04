// [advice from AI] 세그먼트 잠금 시스템
// WhisperLiveKit의 상태 기반 스트림에서 중복/유사 자막 출력 방지
// lines[i]의 인덱스 i = 세그먼트 ID, 한번 확정된 세그먼트는 LOCKED

import { useRef, useCallback } from 'react';

// 세그먼트 상태
type SegmentState = 'ACTIVE' | 'LOCKED';

// 세그먼트 정보
interface SegmentInfo {
  index: number;
  text: string;
  state: SegmentState;
  firstSeen: number;      // 최초 등장 시간
  lastModified: number;   // 마지막 수정 시간
  lockedAt?: number;      // 잠금 시간
  lockedText?: string;    // 잠금 시점 텍스트
}

// 처리 결과
export interface SegmentResult {
  index: number;
  text: string;
  isNew: boolean;           // 새 세그먼트
  isUpdated: boolean;       // ACTIVE에서 수정됨
  isLocked: boolean;        // 잠김 상태
  shouldProcess: boolean;   // 처리 필요 여부
  lockReason?: string;      // 잠금 이유 (디버깅용)
}

// 잠금 트리거 설정
interface LockTriggerConfig {
  stabilityMs: number;     // 텍스트 불변 시간 (기본 500ms)
  forceLockMs: number;     // 강제 잠금 시간 (기본 2000ms)
  minLength: number;       // 최소 길이 (기본 5자)
}

const DEFAULT_CONFIG: LockTriggerConfig = {
  stabilityMs: 500,
  forceLockMs: 2000,
  minLength: 5
};

export function useSegmentLock(config: Partial<LockTriggerConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  // 세그먼트 저장소
  const segmentsRef = useRef<Map<number, SegmentInfo>>(new Map());
  // 이전 buffer (buffer→lines 전환 감지용)
  const prevBufferRef = useRef<string>('');
  
  // 세그먼트 잠금
  const lockSegment = useCallback((idx: number, reason: string) => {
    const seg = segmentsRef.current.get(idx);
    if (seg && seg.state !== 'LOCKED') {
      seg.state = 'LOCKED';
      seg.lockedAt = Date.now();
      seg.lockedText = seg.text;
      console.log(`[SEGMENT] 🔒 idx=${idx} LOCKED (${reason}): "${seg.text.substring(0, 30)}..."`);
    }
  }, []);
  
  // 잠금 여부 판단
  const shouldLock = useCallback((seg: SegmentInfo, bufferCleared: boolean): string | null => {
    const now = Date.now();
    
    // 최소 길이 미달
    if (seg.text.length < cfg.minLength) {
      return null;
    }
    
    // 조건 1: buffer→lines 전환
    if (bufferCleared) {
      return 'buffer_cleared';
    }
    
    // 조건 2: 텍스트 500ms 안정화
    if (now - seg.lastModified >= cfg.stabilityMs) {
      return `stability_${cfg.stabilityMs}ms`;
    }
    
    // 조건 3: 2초 강제 잠금
    if (now - seg.firstSeen >= cfg.forceLockMs) {
      return `force_${cfg.forceLockMs}ms`;
    }
    
    return null;
  }, [cfg]);
  
  // lines 처리 (메인 함수)
  const processLines = useCallback((lines: Array<{ text: string }>, buffer: string): SegmentResult[] => {
    const now = Date.now();
    const results: SegmentResult[] = [];
    
    // buffer→lines 전환 감지
    const bufferCleared = prevBufferRef.current.length > 0 && buffer.length === 0;
    prevBufferRef.current = buffer;
    
    if (bufferCleared) {
      console.log('[SEGMENT] 📤 buffer→lines 전환 감지');
    }
    
    for (let idx = 0; idx < lines.length; idx++) {
      const text = lines[idx]?.text?.trim() || '';
      if (!text) continue;
      
      const existing = segmentsRef.current.get(idx);
      
      if (!existing) {
        // 새 세그먼트 등장
        const newSeg: SegmentInfo = {
          index: idx,
          text,
          state: 'ACTIVE',
          firstSeen: now,
          lastModified: now
        };
        segmentsRef.current.set(idx, newSeg);
        
        console.log(`[SEGMENT] ✨ idx=${idx} NEW: "${text.substring(0, 30)}..."`);
        
        // 새 세그먼트도 즉시 잠금 체크
        const lockReason = shouldLock(newSeg, bufferCleared);
        if (lockReason) {
          lockSegment(idx, lockReason);
          results.push({
            index: idx,
            text,
            isNew: true,
            isUpdated: false,
            isLocked: true,
            shouldProcess: true,  // 새 세그먼트 + 잠금 = 확정 출력
            lockReason
          });
        } else {
          results.push({
            index: idx,
            text,
            isNew: true,
            isUpdated: false,
            isLocked: false,
            shouldProcess: true  // 새 세그먼트 = 아랫줄에 표시
          });
        }
      } else if (existing.state === 'LOCKED') {
        // 이미 잠김
        // [advice from AI] ★ SimulStreaming 대응: 완전히 다른 텍스트면 새 세그먼트로 처리
        const lockedText = existing.lockedText || existing.text;
        const isSimilar = text.startsWith(lockedText.substring(0, 10)) || 
                          lockedText.startsWith(text.substring(0, 10));
        
        if (!isSimilar && text !== lockedText) {
          // 완전히 다른 텍스트 → 세그먼트 리셋하고 새로 시작
          console.log(`[SEGMENT] 🔄 idx=${idx} 리셋 (다른 텍스트): "${text.substring(0, 20)}..."`);
          const newSeg: SegmentInfo = {
            index: idx,
            text,
            state: 'ACTIVE',
            firstSeen: now,
            lastModified: now
          };
          segmentsRef.current.set(idx, newSeg);
          
          results.push({
            index: idx,
            text,
            isNew: true,
            isUpdated: false,
            isLocked: false,
            shouldProcess: true  // 새 세그먼트로 처리
          });
        } else {
          // 유사한 텍스트 → 무시 (기존 로직)
          if (existing.text !== text) {
            console.log(`[SEGMENT] ⏭️ idx=${idx} IGNORED (locked): "${text.substring(0, 20)}..."`);
          }
          results.push({
            index: idx,
            text,
            isNew: false,
            isUpdated: false,
            isLocked: true,
            shouldProcess: false  // 잠김 = 무시
          });
        }
      } else if (existing.text !== text) {
        // ACTIVE + 텍스트 변경 → 업데이트
        existing.text = text;
        existing.lastModified = now;
        
        console.log(`[SEGMENT] 📝 idx=${idx} UPDATED: "${text.substring(0, 30)}..."`);
        
        // 잠금 체크
        const lockReason = shouldLock(existing, bufferCleared);
        if (lockReason) {
          lockSegment(idx, lockReason);
          results.push({
            index: idx,
            text,
            isNew: false,
            isUpdated: true,
            isLocked: true,
            shouldProcess: true,  // 업데이트 + 잠금 = 확정 출력
            lockReason
          });
        } else {
          results.push({
            index: idx,
            text,
            isNew: false,
            isUpdated: true,
            isLocked: false,
            shouldProcess: true  // 업데이트 = 아랫줄 갱신
          });
        }
      } else {
        // ACTIVE + 텍스트 동일 → 잠금만 체크
        const lockReason = shouldLock(existing, bufferCleared);
        if (lockReason) {
          lockSegment(idx, lockReason);
          results.push({
            index: idx,
            text,
            isNew: false,
            isUpdated: false,
            isLocked: true,
            shouldProcess: true,  // 잠금됨 = 확정 출력
            lockReason
          });
        } else {
          results.push({
            index: idx,
            text,
            isNew: false,
            isUpdated: false,
            isLocked: false,
            shouldProcess: false  // 변경 없음
          });
        }
      }
    }
    
    return results;
  }, [shouldLock, lockSegment]);
  
  // 리셋 (새 영상 등)
  const reset = useCallback(() => {
    segmentsRef.current.clear();
    prevBufferRef.current = '';
    console.log('[SEGMENT] 🔄 리셋');
  }, []);
  
  // 특정 세그먼트 강제 잠금
  const forceLock = useCallback((idx: number) => {
    lockSegment(idx, 'manual');
  }, [lockSegment]);
  
  // 통계
  const getStats = useCallback(() => {
    const all = Array.from(segmentsRef.current.values());
    return {
      total: all.length,
      active: all.filter(s => s.state === 'ACTIVE').length,
      locked: all.filter(s => s.state === 'LOCKED').length
    };
  }, []);
  
  return {
    processLines,
    reset,
    forceLock,
    getStats
  };
}
