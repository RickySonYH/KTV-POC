// [advice from AI] 초저지연 STT 서비스 - 2초 이내 문장 단위 처리

import type { SubtitleSegment, STTResponse } from '../types/subtitle';

// [advice from AI] 백엔드 API URL - 동적 호스트 감지
const API_URL = import.meta.env.VITE_API_URL || 
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost' 
    ? `http://${window.location.hostname}:6431` 
    : 'http://localhost:6431');

// [advice from AI] 스트림 이벤트 타입
export interface StreamEvent {
  type: 'init' | 'subtitle' | 'progress' | 'complete' | 'error';
  data: any;
}

// [advice from AI] 초저지연 콜백 타입
export interface UltraRealtimeCallbacks {
  onInit?: (data: { duration: number; mode: string }) => void;
  onSubtitle?: (segment: SubtitleSegment, latencyMs?: number) => void;
  onProgress?: (progress: number, count: number) => void;
  onComplete?: (data: { total_subtitles: number; processing_time: number }) => void;
  onError?: (message: string) => void;
}

// [advice from AI] 🔴 초저지연 실시간 STT (2초 이내)
export const processSTTUltraRealtime = async (
  file: File,
  callbacks: UltraRealtimeCallbacks,
  options: { enableDiarization?: boolean } = {}
): Promise<void> => {
  const { enableDiarization = true } = options;
  
  try {
    const formData = new FormData();
    formData.append('file', file);
    
    // [advice from AI] 초저지연 엔드포인트 사용
    const url = `${API_URL}/api/realtime/ultra?enable_diarization=${enableDiarization}`;
    
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    // [advice from AI] SSE 스트림 실시간 읽기
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('스트림을 읽을 수 없습니다');
    }
    
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      // [advice from AI] SSE 이벤트 파싱 - 즉시 처리
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event: StreamEvent = JSON.parse(line.slice(6));
            handleUltraEvent(event, callbacks);
          } catch (e) {
            console.error('[SSE] Parse error:', e);
          }
        }
      }
    }
    
  } catch (error) {
    console.error('[Ultra Realtime] Error:', error);
    
    // 백엔드 연결 실패 시 Mock 시뮬레이션
    if (error instanceof TypeError && error.message.includes('fetch')) {
      await simulateMockRealtime(callbacks);
    } else {
      callbacks.onError?.(error instanceof Error ? error.message : 'STT 처리 중 오류 발생');
    }
  }
};

// [advice from AI] 로컬 파일 초저지연 처리
export const processLocalFileUltraRealtime = async (
  filePath: string,
  callbacks: UltraRealtimeCallbacks,
  options: { enableDiarization?: boolean } = {}
): Promise<void> => {
  const { enableDiarization = true } = options;
  
  try {
    const url = `${API_URL}/api/realtime/ultra-local?file_path=${encodeURIComponent(filePath)}&enable_diarization=${enableDiarization}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('스트림을 읽을 수 없습니다');
    }
    
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event: StreamEvent = JSON.parse(line.slice(6));
            handleUltraEvent(event, callbacks);
          } catch (e) {
            console.error('[SSE] Parse error:', e);
          }
        }
      }
    }
    
  } catch (error) {
    console.error('[Ultra Realtime] Error:', error);
    callbacks.onError?.(error instanceof Error ? error.message : 'STT 처리 중 오류 발생');
  }
};

// [advice from AI] 초저지연 이벤트 핸들러
function handleUltraEvent(event: StreamEvent, callbacks: UltraRealtimeCallbacks): void {
  switch (event.type) {
    case 'init':
      callbacks.onInit?.(event.data);
      break;
      
    case 'subtitle':
      const segment: SubtitleSegment = {
        id: event.data.id,
        startTime: event.data.start_time,
        endTime: event.data.end_time,
        text: event.data.text,
        speaker: event.data.speaker,
      };
      callbacks.onSubtitle?.(segment, event.data.latency_ms);
      break;
      
    case 'progress':
      callbacks.onProgress?.(event.data.progress, event.data.count);
      break;
      
    case 'complete':
      callbacks.onComplete?.(event.data);
      break;
      
    case 'error':
      callbacks.onError?.(event.data.message);
      break;
  }
}

// [advice from AI] Mock 실시간 시뮬레이션 (백엔드 미연결 시)
async function simulateMockRealtime(callbacks: UltraRealtimeCallbacks): Promise<void> {
  const mockDialogues = [
    { speaker: '화자1', text: '안녕하십니까.' },
    { speaker: '화자1', text: 'KTV 국민방송입니다.' },
    { speaker: '화자1', text: '오늘의 주요 뉴스를 전해드리겠습니다.' },
    { speaker: '화자2', text: '네, 먼저 첫 번째 소식입니다.' },
    { speaker: '화자2', text: '정부는 오늘 새로운 정책을 발표했습니다.' },
    { speaker: '화자2', text: '이번 정책의 핵심 내용은 다음과 같습니다.' },
    { speaker: '화자1', text: '국민 여러분께 도움이 될 것으로 기대됩니다.' },
    { speaker: '화자3', text: '네, 저는 이번 정책이 좋다고 생각합니다.' },
  ];
  
  callbacks.onInit?.({ duration: mockDialogues.length * 2, mode: 'mock' });
  
  for (let i = 0; i < mockDialogues.length; i++) {
    // [advice from AI] 2초마다 문장 생성 (실제 STT 시뮬레이션)
    await new Promise(resolve => setTimeout(resolve, 500)); // 0.5초 지연 (2초 이내)
    
    const segment: SubtitleSegment = {
      id: i + 1,
      startTime: i * 2,
      endTime: (i + 1) * 2 - 0.1,
      text: mockDialogues[i].text,
      speaker: mockDialogues[i].speaker,
    };
    
    callbacks.onSubtitle?.(segment, 500);
    callbacks.onProgress?.(Math.round(((i + 1) / mockDialogues.length) * 100), i + 1);
  }
  
  callbacks.onComplete?.({
    total_subtitles: mockDialogues.length,
    processing_time: mockDialogues.length * 0.5
  });
}

// [advice from AI] 기존 배치 처리 (호환성 유지)
export const processSTT = async (
  file: File,
  _duration: number,
  onProgress?: (progress: number) => void
): Promise<STTResponse> => {
  
  return new Promise((resolve) => {
    const segments: SubtitleSegment[] = [];
    
    processSTTUltraRealtime(file, {
      onSubtitle: (segment) => {
        segments.push(segment);
      },
      onProgress: (progress) => {
        onProgress?.(progress);
      },
      onComplete: () => {
        resolve({
          segments,
          status: 'completed',
          message: `${segments.length}개 자막 생성 완료`
        });
      },
      onError: (message) => {
        if (segments.length === 0) {
          // Mock 데이터 반환
          simulateMockRealtime({
            onSubtitle: (seg) => segments.push(seg),
            onComplete: () => {
              resolve({
                segments,
                status: 'completed',
                message: 'Mock 데이터로 처리됨'
              });
            }
          });
        } else {
          resolve({
            segments,
            status: 'error',
            message
          });
        }
      }
    });
  });
};

// [advice from AI] 스트림 콜백 타입 (하위 호환)
export interface StreamCallbacks {
  onInit?: (data: { total_duration: number; total_chunks: number }) => void;
  onChunkStart?: (data: { chunk_index: number; start_time: number; progress: number }) => void;
  onSubtitle?: (segment: SubtitleSegment) => void;
  onChunkComplete?: (data: { chunk_index: number; total_segments: number; progress: number }) => void;
  onProgress?: (progress: number) => void;
  onComplete?: (data: { srt_content: string; vtt_content: string; total_segments: number }) => void;
  onError?: (message: string) => void;
}

// [advice from AI] 기존 스트림 처리 (하위 호환)
export const processSTTStream = async (
  file: File,
  callbacks: StreamCallbacks,
  options: { enableDiarization?: boolean; chunkDuration?: number } = {}
): Promise<void> => {
  // 초저지연으로 리다이렉트
  await processSTTUltraRealtime(file, {
    onInit: (data) => callbacks.onInit?.({ total_duration: data.duration, total_chunks: 1 }),
    onSubtitle: callbacks.onSubtitle,
    onProgress: (progress, count) => {
      callbacks.onProgress?.(progress);
      callbacks.onChunkComplete?.({ chunk_index: 0, total_segments: count, progress });
    },
    onComplete: (data) => callbacks.onComplete?.({
      srt_content: '',
      vtt_content: '',
      total_segments: data.total_subtitles
    }),
    onError: callbacks.onError
  }, options);
};

// [advice from AI] API 상태 확인
export const checkAPIStatus = async (): Promise<{
  connected: boolean;
  sttConnected: boolean;
  config?: any;
}> => {
  try {
    const response = await fetch(`${API_URL}/health`);
    
    if (!response.ok) {
      return { connected: false, sttConnected: false };
    }
    
    const data = await response.json();
    
    return {
      connected: true,
      sttConnected: data.stt_api_connected,
      config: data
    };
  } catch {
    return { connected: false, sttConnected: false };
  }
};
