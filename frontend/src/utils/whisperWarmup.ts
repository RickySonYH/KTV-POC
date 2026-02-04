// [advice from AI] WhisperLiveKit 콜드스타트 방지 - 워밍업 유틸리티
// 앱 초기화 시 짧은 무음 오디오를 전송하여 모델을 GPU에 미리 로드

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

// [advice from AI] 무음 PCM 데이터 생성 (16kHz, 16bit, mono)
function generateSilentPCM(durationSec: number = 0.5): Int16Array {
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * durationSec);
  // 완전 무음 대신 아주 작은 노이즈 추가 (VAD 통과용)
  const pcmData = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    // 아주 작은 랜덤 노이즈 (-10 ~ +10)
    pcmData[i] = Math.floor(Math.random() * 20) - 10;
  }
  return pcmData;
}

// [advice from AI] WhisperLiveKit 워밍업 함수
export async function warmupWhisperLiveKit(
  wsUrl?: string,
  timeoutMs: number = 10000
): Promise<boolean> {
  const url = wsUrl || getWsUrl();
  
  return new Promise((resolve) => {
    console.log('[WARMUP] 🔥 WhisperLiveKit 워밍업 시작...');
    
    let ws: WebSocket | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;
    
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      ws = null;
    };
    
    const done = (success: boolean, reason: string) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      if (success) {
        console.log(`[WARMUP] ✅ 워밍업 완료: ${reason}`);
      } else {
        console.log(`[WARMUP] ⚠️ 워밍업 실패: ${reason}`);
      }
      resolve(success);
    };
    
    // 타임아웃 설정
    timeoutId = setTimeout(() => {
      done(false, '타임아웃');
    }, timeoutMs);
    
    try {
      ws = new WebSocket(url);
      
      ws.onopen = () => {
        console.log('[WARMUP] 📡 WebSocket 연결됨');
        
        // 무음 PCM 데이터 전송 (0.5초)
        const silentPCM = generateSilentPCM(0.5);
        ws?.send(silentPCM.buffer);
        console.log('[WARMUP] 📤 워밍업 오디오 전송 (0.5초 무음)');
        
        // 추가로 0.5초 더 전송
        setTimeout(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            const silentPCM2 = generateSilentPCM(0.5);
            ws.send(silentPCM2.buffer);
            console.log('[WARMUP] 📤 추가 워밍업 오디오 전송');
          }
        }, 200);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[WARMUP] 📨 응답 수신:', data.type || 'unknown');
          
          // 응답을 받으면 워밍업 성공
          if (data.lines !== undefined || data.buffer !== undefined || data.buffer_transcription !== undefined) {
            done(true, '모델 응답 확인');
          }
        } catch (e) {
          // JSON 파싱 실패해도 응답 받은 것으로 간주
          done(true, '응답 수신 (비JSON)');
        }
      };
      
      ws.onerror = (error) => {
        console.error('[WARMUP] ❌ WebSocket 에러:', error);
        done(false, 'WebSocket 에러');
      };
      
      ws.onclose = (event) => {
        console.log('[WARMUP] 🔌 WebSocket 닫힘:', event.code);
        // 정상 종료가 아니면 실패
        if (!resolved) {
          done(event.code === 1000, `연결 종료 (${event.code})`);
        }
      };
      
    } catch (error) {
      console.error('[WARMUP] ❌ 초기화 에러:', error);
      done(false, '초기화 에러');
    }
  });
}

// [advice from AI] 워밍업 상태 확인용
let isWarmedUp = false;

export function getWarmupStatus(): boolean {
  return isWarmedUp;
}

export function setWarmupStatus(status: boolean): void {
  isWarmedUp = status;
}

// [advice from AI] 워밍업 실행 (중복 방지)
export async function ensureWarmup(wsUrl?: string): Promise<boolean> {
  if (isWarmedUp) {
    console.log('[WARMUP] ✅ 이미 워밍업됨');
    return true;
  }
  
  const result = await warmupWhisperLiveKit(wsUrl);
  if (result) {
    isWarmedUp = true;
  }
  return result;
}
