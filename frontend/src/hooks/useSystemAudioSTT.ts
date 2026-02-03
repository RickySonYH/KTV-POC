// [advice from AI] 시스템 오디오 캡처 + WhisperLiveKit 실시간 STT
// getDisplayMedia로 시스템 스테레오 출력을 캡처하여 실시간 자막 생성

import { useState, useRef, useCallback, useEffect } from 'react';

export interface SystemAudioSubtitle {
  id: number;
  text: string;
  speaker?: string;
  startTime: number;
  endTime: number;
  isFinal: boolean;
}

// [advice from AI] 실시간 버퍼 업데이트 (중간 결과)
export interface BufferUpdate {
  text: string;
  speaker?: string;
}

interface UseSystemAudioSTTProps {
  onSubtitle: (subtitle: SystemAudioSubtitle) => void;
  onBufferUpdate?: (buffer: BufferUpdate) => void;  // 실시간 중간 결과
  onStatusChange?: (status: 'idle' | 'connecting' | 'capturing' | 'error') => void;
  wsUrl?: string;
}

// [advice from AI] 동적 WebSocket URL 생성 - HTTPS/nginx 프록시 지원
const getWsUrl = () => {
  // HTTPS로 접속 시 wss:// + nginx 프록시 경로 사용
  if (window.location.protocol === 'https:') {
    return `wss://${window.location.host}/asr`;
  }
  // localhost 직접 접속
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'ws://localhost:6470/asr';
  }
  // HTTP 외부 접속
  return `ws://${window.location.hostname}:6470/asr`;
};

export function useSystemAudioSTT({ onSubtitle, onBufferUpdate, onStatusChange, wsUrl }: UseSystemAudioSTTProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'capturing' | 'error'>('idle');
  
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const segmentIdRef = useRef(0);
  const lastLinesCountRef = useRef(0);
  const captureStartTimeRef = useRef(0);
  const lastSpeakerRef = useRef<number | undefined>(undefined);

  const updateStatus = useCallback((newStatus: 'idle' | 'connecting' | 'capturing' | 'error') => {
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  }, [onStatusChange]);

  // [advice from AI] 시스템 오디오 캡처 시작
  const startCapture = useCallback(async () => {
    try {
      updateStatus('connecting');
      console.log('[SYSTEM-AUDIO] 🎤 시스템 오디오 캡처 시작...');

      // [advice from AI] HTTPS 또는 localhost 환경 체크
      const isSecure = window.location.protocol === 'https:' || 
                       window.location.hostname === 'localhost' ||
                       window.location.hostname === '127.0.0.1';
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error(
          isSecure 
            ? '이 브라우저는 시스템 오디오 캡처를 지원하지 않습니다. Chrome 또는 Edge를 사용해주세요.'
            : `시스템 오디오 캡처는 HTTPS 또는 localhost에서만 가능합니다.\n\n현재 접속: ${window.location.protocol}//${window.location.host}\n\n해결 방법:\n1. localhost:6430으로 접속\n2. 또는 HTTPS 설정 필요`
        );
      }

      // 1. getDisplayMedia로 시스템 오디오 캡처 (화면 공유 + 오디오)
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,  // 화면은 필수 (하지만 사용 안 함)
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 16000
        }
      });

      // 비디오 트랙 중지 (오디오만 필요)
      stream.getVideoTracks().forEach(track => track.stop());
      
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('시스템 오디오 캡처 실패: 오디오 트랙 없음. "시스템 오디오 공유"를 선택했는지 확인하세요.');
      }

      console.log('[SYSTEM-AUDIO] ✅ 오디오 트랙:', audioTracks[0].label);
      streamRef.current = stream;

      // 2. WebSocket 연결
      const url = wsUrl || getWsUrl();
      console.log('[SYSTEM-AUDIO] 🔌 WebSocket 연결:', url);
      
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = async () => {
        console.log('[SYSTEM-AUDIO] ✅ WebSocket 연결 성공');
        
        // [advice from AI] PCM 직접 전송 (--pcm-input 모드 - FFmpeg 불필요)
        // 브라우저 기본 샘플 레이트 사용 후 16kHz로 다운샘플링
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        
        const actualSampleRate = audioContext.sampleRate;
        const targetSampleRate = 16000;
        const resampleRatio = actualSampleRate / targetSampleRate;
        
        console.log(`[SYSTEM-AUDIO] 📼 AudioContext: ${actualSampleRate}Hz → ${targetSampleRate}Hz (ratio: ${resampleRatio.toFixed(2)})`);
        
        const source = audioContext.createMediaStreamSource(stream);
        
        // [advice from AI] ScriptProcessorNode로 PCM 데이터 추출
        const bufferSize = 4096;
        const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
        
        let chunkCount = 0;
        
        // [advice from AI] 간단한 다운샘플링 함수
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
          
          const inputData = e.inputBuffer.getChannelData(0);
          
          // [advice from AI] 다운샘플링 (48kHz → 16kHz 등)
          const resampledData = downsample(inputData, resampleRatio);
          
          // [advice from AI] Float32 → Int16 변환
          const pcmData = new Int16Array(resampledData.length);
          for (let i = 0; i < resampledData.length; i++) {
            const s = Math.max(-1, Math.min(1, resampledData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          
          chunkCount++;
          // 10개마다 로그 (디버깅)
          if (chunkCount % 10 === 0) {
            console.log(`[SYSTEM-AUDIO] 📤 PCM 청크 전송: #${chunkCount}, 크기: ${pcmData.byteLength}bytes`);
          }
          
          ws.send(pcmData.buffer);
        };
        
        // [advice from AI] 무음 출력 노드 생성 (스피커로 소리 안 나가게)
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0;
        
        source.connect(processor);
        processor.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // [advice from AI] processor를 ref에 저장 (정리용)
        (audioContext as any)._processor = processor;
        (audioContext as any)._source = source;
        (audioContext as any)._gain = gainNode;

        captureStartTimeRef.current = Date.now();
        lastLinesCountRef.current = 0;
        setIsCapturing(true);
        updateStatus('capturing');
        console.log('[SYSTEM-AUDIO] 🎙️ 캡처 중... (PCM 직접 전송)');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // [advice from AI] 디버깅: 서버 응답 형식 확인
          // console.log('[SYSTEM-AUDIO] 📥 수신 데이터:', JSON.stringify(data).substring(0, 200));
          
          // config 메시지 무시
          if (data.type === 'config') {
            console.log('[SYSTEM-AUDIO] ⚙️ 서버 설정 수신');
            return;
          }

          // ready_to_stop 처리
          if (data.type === 'ready_to_stop') {
            console.log('[SYSTEM-AUDIO] 🏁 처리 완료');
            return;
          }

          // [advice from AI] WhisperLiveKit 응답 형식 처리
          const lines = data.lines || [];
          const bufferText = data.buffer_transcription || data.buffer || '';
          const currentTime = (Date.now() - captureStartTimeRef.current) / 1000;

          // 새로운 lines만 처리 (최종 결과)
          for (let i = lastLinesCountRef.current; i < lines.length; i++) {
            const line = lines[i];
            if (!line.text || line.speaker === -2) continue;  // 무음 무시
            
            segmentIdRef.current += 1;
            const speaker = line.speaker > 0 ? `화자${line.speaker}` : undefined;
            
            // [advice from AI] 화자 변경 감지
            lastSpeakerRef.current = line.speaker;
            
            // [advice from AI] startTime/endTime을 숫자로 변환 (안전하게)
            const startTime = typeof line.start === 'number' ? line.start : currentTime;
            const endTime = typeof line.end === 'number' ? line.end : (currentTime + 3);
            
            const subtitle: SystemAudioSubtitle = {
              id: segmentIdRef.current,
              text: line.text.trim(),
              speaker: speaker,
              startTime: startTime,
              endTime: endTime,
              isFinal: true
            };

            console.log(`[SYSTEM-AUDIO] ✅ 최종: [${startTime.toFixed(1)}s] ${subtitle.text.substring(0, 40)}...`);
            onSubtitle(subtitle);
          }
          lastLinesCountRef.current = lines.length;

          // [advice from AI] 버퍼 텍스트 (실시간 중간 결과) - 즉시 표시
          if (bufferText && bufferText.trim() && onBufferUpdate) {
            console.log(`[SYSTEM-AUDIO] 💬 버퍼: ${bufferText.substring(0, 40)}...`);
            const currentSpeaker = lastSpeakerRef.current;
            onBufferUpdate({
              text: bufferText.trim(),
              speaker: currentSpeaker && currentSpeaker > 0 ? `화자${currentSpeaker}` : undefined
            });
          }

        } catch (e) {
          // [advice from AI] 상세 오류 로깅
          console.error('[SYSTEM-AUDIO] 메시지 파싱 오류:', e, '\n원본:', event.data.substring(0, 200));
        }
      };

      ws.onerror = (error) => {
        console.error('[SYSTEM-AUDIO] ❌ WebSocket 오류:', error);
        updateStatus('error');
      };

      ws.onclose = () => {
        console.log('[SYSTEM-AUDIO] 🔌 WebSocket 연결 종료');
        setIsCapturing(false);
        if (status === 'capturing') {
          updateStatus('idle');
        }
      };

    } catch (error) {
      console.error('[SYSTEM-AUDIO] ❌ 캡처 시작 오류:', error);
      updateStatus('error');
      
      // 사용자 친화적 오류 메시지
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          alert('화면 공유 권한이 필요합니다. 시스템 오디오를 공유해주세요.');
        } else {
          alert(`오류: ${error.message}`);
        }
      }
    }
  }, [onSubtitle, onBufferUpdate, updateStatus, wsUrl, status]);

  // [advice from AI] 캡처 중지 - ref로 관리하여 불필요한 재생성 방지
  const stopCaptureRef = useRef<() => void>(() => {});
  
  stopCaptureRef.current = () => {
    // 이미 중지된 상태면 무시
    if (!wsRef.current && !streamRef.current && !audioContextRef.current) {
      return;
    }
    
    console.log('[SYSTEM-AUDIO] 🛑 캡처 중지');

    // WebSocket 종료 (빈 데이터 전송하여 서버에 종료 알림)
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(new Blob([]));
      wsRef.current.close();
    }
    wsRef.current = null;

    // 오디오 컨텍스트 종료
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    audioContextRef.current = null;

    // 스트림 종료
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    streamRef.current = null;

    setIsCapturing(false);
    updateStatus('idle');
  };
  
  const stopCapture = useCallback(() => {
    stopCaptureRef.current();
  }, []);

  // 컴포넌트 언마운트 시 정리 (의존성 없음)
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
