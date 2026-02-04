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

// [advice from AI] lines 항목 인터페이스
export interface LineItem {
  text: string;
  speaker: number;
  start: string;
  end: string;
}

export interface BufferUpdate {
  text: string;
  speaker?: string;
  isNoAudio?: boolean;
  linesCount?: number;
  // [advice from AI] ★ 확정 인덱스 기반 졸업을 위해 lines 전체 전달
  lines?: LineItem[];
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
  // [advice from AI] ★ 이미 처리한 lines 텍스트 추적 (중복 방지) - 리셋 시에도 같은 텍스트 다시 처리 안 함
  const processedLinesSetRef = useRef<Set<string>>(new Set());
  // [advice from AI] 캡처 시작 시점의 비디오 시간 (타임스탬프 계산용)
  const captureStartVideoTimeRef = useRef(0);
  const lastSpeakerRef = useRef<number | undefined>(undefined);
  
  // [advice from AI] ★★★ WhisperLiveKit 상태 모니터링 ★★★
  const lastMessageTimeRef = useRef<number>(0);        // 마지막 메시지 수신 시간
  const healthCheckIntervalRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const MAX_RECONNECT_ATTEMPTS = 3;
  const MESSAGE_TIMEOUT_MS = 30000;  // 30초 동안 메시지 없으면 문제로 판단

  const updateStatus = useCallback((newStatus: 'idle' | 'connecting' | 'capturing' | 'error') => {
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  }, [onStatusChange]);

  // [advice from AI] ★ startCaptureRef를 위한 forward declaration
  const startCaptureRef = useRef<(() => Promise<void>) | null>(null);
  
  // [advice from AI] ★★★ 자동 재연결 함수 ★★★
  const attemptReconnect = useCallback(async () => {
    const video = videoElementRef.current;
    if (!video) {
      console.error('[HEALTH] ❌ 비디오 요소 없음 → 재연결 불가');
      return;
    }
    
    console.log('[HEALTH] 🔄 WhisperLiveKit 재연결 시도...');
    
    // 기존 WebSocket 정리
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {
        // ignore
      }
      wsRef.current = null;
    }
    
    // 기존 AudioContext 정리
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {
        // ignore
      }
      audioContextRef.current = null;
    }
    
    // 잠시 대기 후 재연결
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // startCapture 재호출
    if (startCaptureRef.current) {
      startCaptureRef.current();
    }
  }, []);

  // [advice from AI] 비디오 오디오 캡처 시작
  const startCapture = useCallback(async () => {
    const video = getVideoElement();
    if (!video) {
      console.error('[VIDEO-STT] ❌ 비디오 요소가 없습니다');
      alert('먼저 비디오 파일을 선택해주세요.');
      return;
    }
    
    videoElementRef.current = video;  // 저장
    
    // [advice from AI] ★★★ 초반 텍스트 손실 방지 ★★★
    // 비디오를 일시 정지하고, WebSocket + AudioContext 준비 완료 후 재생
    const wasPlaying = !video.paused;
    const savedCurrentTime = video.currentTime;
    if (wasPlaying) {
      video.pause();
      console.log('[VIDEO-STT] ⏸️ 비디오 일시 정지 (캡처 준비 중...)');
    }

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
        
        console.log(`[VIDEO-STT] 📼 AudioContext: ${actualSampleRate}Hz → ${targetSampleRate}Hz (비율: ${resampleRatio.toFixed(2)})`);
        
        // [advice from AI] MediaStreamSource 사용 - CORS 문제 회피 + 재사용 가능
        // captureStream()에서 얻은 스트림 직접 사용
        const source = audioContext.createMediaStreamSource(stream);
        
        // [advice from AI] ★ Anti-aliasing 필터 추가 (할루시네이션 감소 핵심!)
        // 다운샘플링 전에 고주파를 제거해야 aliasing 방지
        // Nyquist 주파수 (16kHz / 2 = 8kHz) 이하로 필터링
        const lowpassFilter = audioContext.createBiquadFilter();
        lowpassFilter.type = 'lowpass';
        lowpassFilter.frequency.value = 7500;  // 8kHz보다 약간 낮게 설정 (안전 마진)
        lowpassFilter.Q.value = 0.7;  // Butterworth 특성
        
        // [advice from AI] ★ 2단계 필터 (더 급격한 rolloff)
        const lowpassFilter2 = audioContext.createBiquadFilter();
        lowpassFilter2.type = 'lowpass';
        lowpassFilter2.frequency.value = 7500;
        lowpassFilter2.Q.value = 0.7;
        
        // [advice from AI] ★ 노이즈 게이트 효과를 위한 컴프레서 (무음 구간 노이즈 감소)
        const compressor = audioContext.createDynamicsCompressor();
        compressor.threshold.value = -50;  // 조용한 소리 감쇄
        compressor.knee.value = 40;
        compressor.ratio.value = 12;
        compressor.attack.value = 0;
        compressor.release.value = 0.25;
        
        console.log('[VIDEO-STT] 🔧 Anti-aliasing 필터 적용: 7500Hz lowpass (2단계) + 컴프레서');
        
        // [advice from AI] 분석용 노드 - ScriptProcessor로 PCM 추출
        // 버퍼 크기 증가: 4096 → 8192 (더 안정적인 처리)
        const bufferSize = 8192;
        const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
        
        let chunkCount = 0;
        
        // [advice from AI] ★ 개선된 다운샘플링 함수 - 선형 보간법 (Linear Interpolation)
        // 단순 간격 선택 대신 인접 샘플 간 보간으로 부드러운 변환
        const downsampleWithInterpolation = (inputData: Float32Array, ratio: number): Float32Array => {
          if (ratio <= 1) return inputData;
          const outputLength = Math.floor(inputData.length / ratio);
          const output = new Float32Array(outputLength);
          
          for (let i = 0; i < outputLength; i++) {
            const srcIndex = i * ratio;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
            const fraction = srcIndex - srcIndexFloor;
            
            // 선형 보간: output = (1 - fraction) * floor + fraction * ceil
            output[i] = (1 - fraction) * inputData[srcIndexFloor] + fraction * inputData[srcIndexCeil];
          }
          return output;
        };
        
        // [advice from AI] ★ 무음 감지용 RMS 계산
        const calculateRMS = (data: Float32Array): number => {
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            sum += data[i] * data[i];
          }
          return Math.sqrt(sum / data.length);
        };
        
        // 무음 청크 카운터 (연속 무음 감지)
        let silentChunkCount = 0;
        const SILENCE_THRESHOLD = 0.005;  // RMS 임계값
        const MAX_SILENT_CHUNKS = 10;     // 연속 무음 허용 개수
        
        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          
          // [advice from AI] 비디오가 재생 중일 때만 전송
          if (video.paused || video.ended) return;
          
          const inputData = e.inputBuffer.getChannelData(0);
          
          // [advice from AI] ★ 무음 감지 - 완전 무음일 때는 전송 스킵 (할루시네이션 방지)
          const rms = calculateRMS(inputData);
          if (rms < SILENCE_THRESHOLD) {
            silentChunkCount++;
            if (silentChunkCount > MAX_SILENT_CHUNKS) {
              // 연속 무음이면 가끔만 전송 (연결 유지용)
              if (silentChunkCount % 20 !== 0) {
                return;  // 대부분의 무음 청크 스킵
              }
            }
          } else {
            silentChunkCount = 0;  // 소리 감지되면 리셋
          }
          
          // [advice from AI] ★ 개선된 다운샘플링 적용
          const resampledData = downsampleWithInterpolation(inputData, resampleRatio);
          
          // Float32 → Int16 변환 (클리핑 방지 포함)
          const pcmData = new Int16Array(resampledData.length);
          for (let i = 0; i < resampledData.length; i++) {
            const s = Math.max(-1, Math.min(1, resampledData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          
          chunkCount++;
          if (chunkCount % 10 === 0) {
            console.log(`[VIDEO-STT] 📤 PCM 청크 전송: #${chunkCount}, 시간: ${video.currentTime.toFixed(1)}s, RMS: ${rms.toFixed(4)}`);
          }
          
          ws.send(pcmData.buffer);
        };
        
        // [advice from AI] ★ 오디오 체인 연결: source → lowpass1 → lowpass2 → compressor → processor
        source.connect(lowpassFilter);
        lowpassFilter.connect(lowpassFilter2);
        lowpassFilter2.connect(compressor);
        compressor.connect(processor);
        processor.connect(audioContext.destination);
        
        // ref에 저장 (정리용)
        // ref에 저장 (정리용)
        (audioContext as any)._processor = processor;
        (audioContext as any)._source = source;
        (audioContext as any)._lowpassFilter = lowpassFilter;
        (audioContext as any)._lowpassFilter2 = lowpassFilter2;
        (audioContext as any)._compressor = compressor;

        // [advice from AI] 캡처 시작 시점의 비디오 시간 저장 (타임스탬프 계산용)
        captureStartVideoTimeRef.current = video.currentTime || 0;
        lastLinesCountRef.current = 0;
        processedLinesSetRef.current.clear();  // [advice from AI] ★ 처리된 lines 추적 초기화
        lastMessageTimeRef.current = Date.now();  // 초기 타임스탬프
        setIsCapturing(true);
        updateStatus('capturing');
        console.log(`[VIDEO-STT] 🎙️ 캡처 시작! 비디오 시간: ${captureStartVideoTimeRef.current.toFixed(1)}s`);
        
        // [advice from AI] ★★★ WhisperLiveKit 헬스체크 시작 ★★★
        if (healthCheckIntervalRef.current) {
          clearInterval(healthCheckIntervalRef.current);
        }
        healthCheckIntervalRef.current = window.setInterval(async () => {
          const now = Date.now();
          const timeSinceLastMessage = now - lastMessageTimeRef.current;
          
          // 비디오가 재생 중일 때만 체크
          if (videoElementRef.current && !videoElementRef.current.paused) {
            if (timeSinceLastMessage > MESSAGE_TIMEOUT_MS) {
              console.warn(`[HEALTH] ⚠️ ${(timeSinceLastMessage / 1000).toFixed(0)}초 동안 메시지 없음 → 재연결 시도`);
              
              if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttemptsRef.current++;
                console.log(`[HEALTH] 🔄 재연결 시도 ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS}`);
                
                // [advice from AI] ★ 자동 재연결 실행
                updateStatus('connecting');
                
                // 기존 WebSocket 정리
                if (wsRef.current) {
                  try { wsRef.current.close(); } catch (_e) { /* ignore */ }
                  wsRef.current = null;
                }
                
                // 잠시 대기 후 재연결
                await new Promise(resolve => setTimeout(resolve, 500));
                
                if (startCaptureRef.current) {
                  startCaptureRef.current();
                }
              } else {
                console.error(`[HEALTH] ❌ 재연결 ${MAX_RECONNECT_ATTEMPTS}회 실패 → 수동 재시작 필요`);
                updateStatus('error');
                // 헬스체크 중지
                if (healthCheckIntervalRef.current) {
                  clearInterval(healthCheckIntervalRef.current);
                  healthCheckIntervalRef.current = null;
                }
              }
            }
          }
        }, 10000);  // 10초마다 체크
        
        // [advice from AI] ★★★ 초반 텍스트 손실 방지 - 준비 완료 후 비디오 재생 ★★★
        if (wasPlaying) {
          // 비디오 현재 위치 복원 후 재생
          video.currentTime = savedCurrentTime;
          video.play().then(() => {
            console.log(`[VIDEO-STT] ▶️ 비디오 재생 시작 (${savedCurrentTime.toFixed(1)}s부터)`);
          }).catch(err => {
            console.error('[VIDEO-STT] ❌ 비디오 재생 실패:', err);
          });
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // [advice from AI] ★ 메시지 수신 시간 업데이트 (헬스체크용)
          lastMessageTimeRef.current = Date.now();
          reconnectAttemptsRef.current = 0;  // 성공적으로 메시지 받으면 재시도 카운트 리셋
          
          // [advice from AI] 설정/종료 메시지는 무시
          if (data.type === 'config' || data.type === 'ready_to_stop') {
            return;
          }

          const lines = data.lines || [];
          const bufferText = data.buffer_transcription || data.buffer || '';
          const currentVideoTime = videoElementRef.current?.currentTime || 0;
          
          // [advice from AI] ★ 원본 데이터 로깅 (디버깅용) - 화자 정보 포함
          // [advice from AI] ★ 원본 데이터 로깅 - 화자 정보 상세 확인
          if (lines.length > 0 || bufferText) {
            const lastLine = lines.length > 0 ? lines[lines.length - 1] : null;
            console.log(`[WHISPER-RAW] 📨 원본:`, {
              lines_count: lines.length,
              buffer: bufferText ? bufferText.substring(0, 50) + '...' : '(empty)',
              last_line: lastLine?.text?.substring(0, 50) || '(none)',
              // ★ speaker 원본값 확인 (타입 포함)
              speaker_raw: lastLine?.speaker,
              speaker_type: typeof lastLine?.speaker
            });
          }

          // [advice from AI] WhisperLiveKit이 lines를 리셋할 수 있으므로 체크
          // lines_count가 현재 저장된 값보다 작아지면 리셋된 것
          if (lines.length < lastLinesCountRef.current) {
            console.log(`[STT] 🔄 lines 리셋 감지: ${lastLinesCountRef.current} → ${lines.length}`);
            lastLinesCountRef.current = 0;
          }

          // 새로운 lines 처리 (최종 결과)
          for (let i = lastLinesCountRef.current; i < lines.length; i++) {
            const line = lines[i];
            
            if (!line.text || line.speaker === -2) continue;
            
            const rawText = line.text.trim();
            if (!rawText) continue;
            
            // [advice from AI] ★ 이미 처리한 텍스트인지 체크 (리셋 후 중복 방지)
            // startTime + rawText 조합으로 고유 키 생성
            const parsedStart = parseTimeString(line.start);
            const lineKey = `${parsedStart?.toFixed(1) || 'unknown'}_${rawText.substring(0, 30)}`;
            
            if (processedLinesSetRef.current.has(lineKey)) {
              console.log(`[STT] ⏭️ 이미 처리된 lines 스킵: "${rawText.substring(0, 30)}..."`);
              continue;
            }
            processedLinesSetRef.current.add(lineKey);
            
            segmentIdRef.current += 1;
            // [advice from AI] ★ speaker >= 0이면 유효 (0번 화자도 포함)
            const speaker = (line.speaker !== undefined && line.speaker !== null && line.speaker >= 0) 
              ? `화자${line.speaker + 1}` 
              : undefined;
            lastSpeakerRef.current = line.speaker;
            console.log(`[STT] 🎤 화자: ${speaker || '없음'} (raw: ${line.speaker})`);
            
            const captureStartVideoTime = captureStartVideoTimeRef.current;
            const parsedEnd = parseTimeString(line.end);
            
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

          // 버퍼 텍스트 (실시간 중간 결과)
          const currentSpeaker = lastSpeakerRef.current;
          // [advice from AI] ★ speaker >= 0이면 유효 (0번 화자도 포함)
          const speakerStr = (currentSpeaker !== undefined && currentSpeaker !== null && currentSpeaker >= 0) 
            ? `화자${currentSpeaker + 1}` 
            : undefined;
          
          // [advice from AI] ★ 화자 변경 감지를 위한 디버그 로그 (버퍼에 화자 정보 전달)
          if (bufferText && bufferText.trim()) {
            // 마지막 유효 화자와 현재 raw 화자 비교
            const lastLineRawSpeaker = lines.length > 0 ? lines[lines.length - 1]?.speaker : undefined;
            console.log(`[BUFFER-SPEAKER] 📤 lastSpeakerRef=${currentSpeaker}, lastLineRaw=${lastLineRawSpeaker}, speakerStr=${speakerStr || 'null'}`);
          }
          
          // [advice from AI] ★ 항상 lines 전체 전달 (확정 인덱스 기반 졸업용)
          if (onBufferUpdate) {
            onBufferUpdate({
              text: bufferText?.trim() || '',
              speaker: speakerStr,
              isNoAudio: data.status === 'no_audio_detected',
              linesCount: lines.length,
              lines: lines  // ★ 핵심: lines 전체 전달
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

  // [advice from AI] ★ startCaptureRef에 함수 저장 (자동 재연결에서 사용)
  startCaptureRef.current = startCapture;

  // 캡처 중지
  const stopCaptureRef = useRef<() => void>(() => {});
  
  stopCaptureRef.current = () => {
    if (!wsRef.current && !audioContextRef.current) {
      return;
    }
    
    console.log('[VIDEO-STT] 🛑 캡처 중지');

    // [advice from AI] 헬스체크 인터벌 정리
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current);
      healthCheckIntervalRef.current = null;
    }
    reconnectAttemptsRef.current = 0;

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
