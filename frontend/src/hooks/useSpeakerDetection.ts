// [advice from AI] 화자 변경 감지 훅
// Backend WebSocket으로 오디오 전송 → 화자 변경 감지

import { useRef, useCallback, useState } from 'react';

// [advice from AI] 동적 URL 생성 - 원격지 접속 지원
const getSpeakerWsUrl = () => {
  if (window.location.protocol === 'https:') {
    return `wss://${window.location.host}/api/speaker/ws`;
  }
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'ws://localhost:6450/api/speaker/ws';
  }
  return `ws://${window.location.hostname}:6450/api/speaker/ws`;
};

const getSpeakerApiUrl = () => {
  if (window.location.protocol === 'https:') {
    return '';  // 상대 경로 사용
  }
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:6450';
  }
  return `http://${window.location.hostname}:6450`;
};

interface SpeakerDetectionOptions {
  onSpeakerChange?: (speaker: number) => void;
  analyzeInterval?: number;  // 분석 간격 (ms)
}

export function useSpeakerDetection(options: SpeakerDetectionOptions = {}) {
  const { 
    onSpeakerChange, 
    analyzeInterval = 2000  // 2초마다 분석
  } = options;
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioBufferRef = useRef<Float32Array[]>([]);  // [advice from AI] Float32Array로 변경
  const lastAnalyzeTimeRef = useRef<number>(0);
  const [currentSpeaker, setCurrentSpeaker] = useState<number>(0);
  const [isConnected, setIsConnected] = useState(false);
  
  // WebSocket 연결
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    const wsUrl = getSpeakerWsUrl();
    console.log('[SPEAKER-WS] 연결 시도:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('[SPEAKER-WS] 연결 성공');
      setIsConnected(true);
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // { speaker_changed: boolean, speaker: 0|1 }
        
        if (data.speaker_changed) {
          console.log(`[SPEAKER] 화자 변경! → ${data.speaker === 0 ? '흰색' : '노란색'}`);
          setCurrentSpeaker(data.speaker);
          onSpeakerChange?.(data.speaker);
        }
      } catch (e) {
        console.error('[SPEAKER-WS] 응답 파싱 오류:', e);
      }
    };
    
    ws.onerror = (error) => {
      console.error('[SPEAKER-WS] 오류:', error);
    };
    
    ws.onclose = () => {
      console.log('[SPEAKER-WS] 연결 종료');
      setIsConnected(false);
      wsRef.current = null;
    };
    
    wsRef.current = ws;
  }, [onSpeakerChange]);
  
  // 연결 종료
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    audioBufferRef.current = [];
    setIsConnected(false);
  }, []);
  
  // 오디오 청크 추가 (useVideoAudioSTT에서 호출) - Float32Array 형식
  const addAudioChunk = useCallback((audioData: Float32Array) => {
    audioBufferRef.current.push(audioData);
    
    const now = Date.now();
    // 분석 간격마다 전송
    if (now - lastAnalyzeTimeRef.current >= analyzeInterval) {
      sendForAnalysis();
      lastAnalyzeTimeRef.current = now;
    }
  }, [analyzeInterval]);
  
  // 분석용 오디오 전송
  const sendForAnalysis = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    
    if (audioBufferRef.current.length === 0) return;
    
    // [advice from AI] Float32Array 버퍼 합치기
    const totalLength = audioBufferRef.current.reduce((acc, chunk) => acc + chunk.length, 0);
    const combinedFloat = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of audioBufferRef.current) {
      combinedFloat.set(chunk, offset);
      offset += chunk.length;
    }
    
    // [advice from AI] Float32 → Int16 변환 (Backend가 Int16 기대)
    const combined = new Int16Array(combinedFloat.length);
    for (let i = 0; i < combinedFloat.length; i++) {
      const s = Math.max(-1, Math.min(1, combinedFloat[i]));
      combined[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    // 버퍼 비우기
    audioBufferRef.current = [];
    
    // 최소 0.5초 이상의 오디오만 전송 (16000 * 0.5 = 8000 samples)
    if (combined.length < 8000) return;
    
    // ArrayBuffer로 변환해서 전송
    wsRef.current.send(combined.buffer);
    console.log(`[SPEAKER-WS] 오디오 전송: ${combined.length} samples (${(combined.length / 16000).toFixed(2)}s)`);
  }, []);
  
  // 상태 리셋
  const reset = useCallback(async () => {
    try {
      await fetch(`${getSpeakerApiUrl()}/api/speaker/reset`, { method: 'POST' });
      setCurrentSpeaker(0);
      audioBufferRef.current = [];
      console.log('[SPEAKER] 상태 리셋됨');
    } catch (e) {
      console.error('[SPEAKER] 리셋 오류:', e);
    }
  }, []);
  
  return {
    connect,
    disconnect,
    addAudioChunk,
    reset,
    currentSpeaker,
    isConnected
  };
}
