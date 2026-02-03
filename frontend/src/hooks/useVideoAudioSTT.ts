// [advice from AI] 비디오 요소에서 직접 오디오 추출 + WhisperLiveKit 실시간 STT
// getDisplayMedia 불필요 - video.captureStream() 사용

import { useState, useRef, useCallback, useEffect } from 'react';
// [advice from AI] 후처리는 App.tsx에서 문장별로 적용 (여기서는 원본 전달)

export interface VideoAudioSubtitle {
  id: number;
  text: string;
  speaker?: string;
  startTime: number;
  endTime: number;
  isFinal: boolean;
}

export interface BufferUpdate {
  text: string;
  speaker?: string;
  isNoAudio?: boolean;  // [advice from AI] 오디오 없음/음악 감지용
}

interface UseVideoAudioSTTProps {
  getVideoElement: () => HTMLVideoElement | null;  // [advice from AI] 함수로 받아서 유연하게
  onSubtitle: (subtitle: VideoAudioSubtitle) => void;
  onBufferUpdate?: (buffer: BufferUpdate) => void;
  onStatusChange?: (status: 'idle' | 'connecting' | 'capturing' | 'error') => void;
  wsUrl?: string;
}

// [advice from AI] 동적 WebSocket URL 생성
const getWsUrl = () => {
  if (window.location.protocol === 'https:') {
    return `wss://${window.location.host}/asr`;
  }
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'ws://localhost:6470/asr';
  }
  return `ws://${window.location.hostname}:6470/asr`;
};

// [advice from AI] WhisperLiveKit 시간 문자열 파싱 ("0:00:05" → 5.0)
const parseTimeString = (timeStr: string | number | undefined): number | null => {
  if (typeof timeStr === 'number') return timeStr;
  if (!timeStr || typeof timeStr !== 'string') return null;
  
  // "H:MM:SS" 또는 "HH:MM:SS" 형식
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    const [h, m, s] = parts.map(Number);
    return h * 3600 + m * 60 + s;
  }
  // "MM:SS" 형식
  if (parts.length === 2) {
    const [m, s] = parts.map(Number);
    return m * 60 + s;
  }
  return null;
};

export function useVideoAudioSTT({ getVideoElement, onSubtitle, onBufferUpdate, onStatusChange, wsUrl }: UseVideoAudioSTTProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'capturing' | 'error'>('idle');
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);  // [advice from AI] 현재 비디오 요소 저장
  // [advice from AI] 유니크 ID 생성 - timestamp 기반 + 큰 오프셋으로 App.tsx와 충돌 방지
  const segmentIdRef = useRef(Date.now() + 1000000);
  const lastLinesCountRef = useRef(0);
  // [advice from AI] 캡처 시작 시점의 비디오 시간 (타임스탬프 계산용)
  const captureStartVideoTimeRef = useRef(0);
  const lastSpeakerRef = useRef<number | undefined>(undefined);

  const updateStatus = useCallback((newStatus: 'idle' | 'connecting' | 'capturing' | 'error') => {
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  }, [onStatusChange]);

  // [advice from AI] 비디오 오디오 캡처 시작
  const startCapture = useCallback(async () => {
    const video = getVideoElement();
    if (!video) {
      console.error('[VIDEO-STT] ❌ 비디오 요소가 없습니다');
      alert('먼저 비디오 파일을 선택해주세요.');
      return;
    }
    
    videoElementRef.current = video;  // 저장

    try {
      updateStatus('connecting');
      console.log('[VIDEO-STT] 🎤 비디오 오디오 캡처 시작...');
      console.log('[VIDEO-STT] 📺 비디오 소스:', video.src?.substring(0, 80) || video.currentSrc?.substring(0, 80));
      
      // [advice from AI] video.captureStream()으로 MediaStream 얻기
      let stream: MediaStream;
      try {
        // @ts-ignore - captureStream은 표준 API지만 타입 정의에 없음
        stream = video.captureStream ? video.captureStream() : video.mozCaptureStream?.();
      } catch (captureError) {
        console.error('[VIDEO-STT] ❌ captureStream 오류:', captureError);
        throw new Error('비디오 캡처 실패: 외부 URL은 CORS 정책으로 인해 캡처할 수 없습니다. 파일을 직접 업로드해주세요.');
      }
      
      if (!stream) {
        throw new Error('비디오 스트림 캡처를 지원하지 않는 브라우저입니다.');
      }

      const audioTracks = stream.getAudioTracks();
      console.log('[VIDEO-STT] 🔍 오디오 트랙 수:', audioTracks.length);
      
      if (audioTracks.length === 0) {
        // [advice from AI] CORS로 인해 오디오 트랙이 비어있을 수 있음
        console.warn('[VIDEO-STT] ⚠️ 오디오 트랙 없음 - CORS 또는 미디어 로드 대기 중');
        throw new Error('오디오 트랙이 없습니다. 비디오가 완전히 로드되지 않았거나 CORS 문제일 수 있습니다.');
      }

      console.log('[VIDEO-STT] ✅ 오디오 트랙:', audioTracks[0].label || 'default');

      // WebSocket 연결
      const url = wsUrl || getWsUrl();
      console.log('[VIDEO-STT] 🔌 WebSocket 연결:', url);
      
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = async () => {
        console.log('[VIDEO-STT] ✅ WebSocket 연결 성공');
        
        // [advice from AI] AudioContext 생성 - 비디오의 오디오를 처리
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        
        const actualSampleRate = audioContext.sampleRate;
        const targetSampleRate = 16000;
        const resampleRatio = actualSampleRate / targetSampleRate;
        
        console.log(`[VIDEO-STT] 📼 AudioContext: ${actualSampleRate}Hz → ${targetSampleRate}Hz`);
        
        // [advice from AI] MediaStreamSource 사용 - CORS 문제 회피 + 재사용 가능
        // captureStream()에서 얻은 스트림 직접 사용
        const source = audioContext.createMediaStreamSource(stream);
        
        // [advice from AI] 분석용 노드 - ScriptProcessor로 PCM 추출
        const bufferSize = 4096;
        const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
        
        let chunkCount = 0;
        
        // 다운샘플링 함수
        const downsample = (inputData: Float32Array, ratio: number): Float32Array => {
          if (ratio === 1) return inputData;
          const outputLength = Math.floor(inputData.length / ratio);
          const output = new Float32Array(outputLength);
          for (let i = 0; i < outputLength; i++) {
            output[i] = inputData[Math.floor(i * ratio)];
          }
          return output;
        };
        
        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          
          // [advice from AI] 비디오가 재생 중일 때만 전송
          if (video.paused || video.ended) return;
          
          const inputData = e.inputBuffer.getChannelData(0);
          const resampledData = downsample(inputData, resampleRatio);
          
          // Float32 → Int16 변환
          const pcmData = new Int16Array(resampledData.length);
          for (let i = 0; i < resampledData.length; i++) {
            const s = Math.max(-1, Math.min(1, resampledData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          
          chunkCount++;
          if (chunkCount % 10 === 0) {
            console.log(`[VIDEO-STT] 📤 PCM 청크 전송: #${chunkCount}, 시간: ${video.currentTime.toFixed(1)}s`);
          }
          
          ws.send(pcmData.buffer);
        };
        
        // [advice from AI] 분석기 노드 연결 (소리 출력에는 영향 없음)
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        // ref에 저장 (정리용)
        (audioContext as any)._processor = processor;
        (audioContext as any)._source = source;

        // [advice from AI] 캡처 시작 시점의 비디오 시간 저장 (타임스탬프 계산용)
        captureStartVideoTimeRef.current = video.currentTime || 0;
        lastLinesCountRef.current = 0;
        setIsCapturing(true);
        updateStatus('capturing');
        console.log(`[VIDEO-STT] 🎙️ 캡처 시작! 비디오 시간: ${captureStartVideoTimeRef.current.toFixed(1)}s`);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // [advice from AI] 설정/종료 메시지는 무시
          if (data.type === 'config' || data.type === 'ready_to_stop') {
            return;
          }

          const lines = data.lines || [];
          const bufferText = data.buffer_transcription || data.buffer || '';
          const currentVideoTime = videoElementRef.current?.currentTime || 0;

          // 새로운 lines 처리 (최종 결과)
          for (let i = lastLinesCountRef.current; i < lines.length; i++) {
            const line = lines[i];
            
            if (!line.text || line.speaker === -2) continue;
            
            const rawText = line.text.trim();
            if (!rawText) continue;
            
            segmentIdRef.current += 1;
            const speaker = line.speaker > 0 ? `화자${line.speaker}` : undefined;
            lastSpeakerRef.current = line.speaker;
            
            const parsedStart = parseTimeString(line.start);
            const parsedEnd = parseTimeString(line.end);
            const captureStartVideoTime = captureStartVideoTimeRef.current;
            
            const startTime = parsedStart !== null 
              ? captureStartVideoTime + parsedStart 
              : currentVideoTime;
            const endTime = parsedEnd !== null 
              ? captureStartVideoTime + parsedEnd 
              : startTime + 3;
            
            const subtitle: VideoAudioSubtitle = {
              id: segmentIdRef.current,
              text: rawText,
              speaker: speaker,
              startTime: startTime,
              endTime: endTime,
              isFinal: true
            };

            // [advice from AI] 최종 결과만 로그
            console.log(`[STT] 📝 "${rawText.substring(0, 40)}..." [${startTime.toFixed(1)}s~${endTime.toFixed(1)}s]`);
            onSubtitle(subtitle);
          }
          lastLinesCountRef.current = lines.length;

          // 버퍼 텍스트 (실시간 중간 결과) - 로그 없이 전달만
          const currentSpeaker = lastSpeakerRef.current;
          const speakerStr = currentSpeaker && currentSpeaker > 0 ? `화자${currentSpeaker}` : undefined;
          
          if (bufferText && bufferText.trim() && onBufferUpdate) {
            onBufferUpdate({
              text: bufferText.trim(),
              speaker: speakerStr
            });
          } else if (onBufferUpdate) {
            // 빈 버퍼 전달 (로그 없음)
            onBufferUpdate({
              text: '',
              speaker: speakerStr,
              isNoAudio: data.status === 'no_audio_detected'
            });
          }

        } catch (e) {
          console.error('[VIDEO-STT] 메시지 파싱 오류:', e);
        }
      };

      ws.onerror = (error) => {
        console.error('[VIDEO-STT] ❌ WebSocket 오류:', error);
        updateStatus('error');
      };

      ws.onclose = () => {
        console.log('[VIDEO-STT] 🔌 WebSocket 연결 종료');
        setIsCapturing(false);
        if (status === 'capturing') {
          updateStatus('idle');
        }
      };

    } catch (error) {
      console.error('[VIDEO-STT] ❌ 캡처 시작 오류:', error);
      updateStatus('error');
      
      if (error instanceof Error) {
        alert(`오류: ${error.message}`);
      }
    }
  }, [getVideoElement, onSubtitle, onBufferUpdate, updateStatus, wsUrl, status]);

  // 캡처 중지
  const stopCaptureRef = useRef<() => void>(() => {});
  
  stopCaptureRef.current = () => {
    if (!wsRef.current && !audioContextRef.current) {
      return;
    }
    
    console.log('[VIDEO-STT] 🛑 캡처 중지');

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(new Blob([]));
      wsRef.current.close();
    }
    wsRef.current = null;

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    audioContextRef.current = null;

    setIsCapturing(false);
    updateStatus('idle');
  };
  
  const stopCapture = useCallback(() => {
    stopCaptureRef.current();
  }, []);

  useEffect(() => {
    return () => {
      stopCaptureRef.current();
    };
  }, []);

  return {
    isCapturing,
    status,
    startCapture,
    stopCapture
  };
}
