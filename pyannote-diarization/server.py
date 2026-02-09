# [advice from AI] pyannote.audio 실시간 화자분리 WebSocket 서비스
# WhisperLiveKit과 별도로 동작, PCM 오디오를 받아 화자 번호만 반환

import asyncio
import logging
import os
import re
import threading
from typing import Optional

import numpy as np
import torch
# [advice from AI] PyTorch 2.6+: weights_only=True 기본값 → pyannote 호환을 위해 전역 패치
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    kwargs['weights_only'] = False
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load
# lightning_fabric도 패치
try:
    import lightning_fabric.utilities.cloud_io as _lio
    _lio_original = _lio.torch.load
    _lio.torch.load = _patched_torch_load
except Exception:
    pass

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="pyannote Speaker Diarization Service")

# [advice from AI] HuggingFace 토큰
HF_TOKEN = os.environ.get("HF_TOKEN", "")

# [advice from AI] 글로벌 파이프라인 (서버 시작 시 1회 로드)
pipeline = None
SAMPLE_RATE = 16000


def load_pipeline():
    """pyannote.audio 파이프라인 로드 - 여러 인증 방식 시도"""
    global pipeline
    from pyannote.audio import Pipeline
    
    logger.info("[DIAR] pyannote.audio 파이프라인 로드 중...")
    
    # [advice from AI] huggingface_hub 버전별 호환: 여러 방식 시도
    for method in ['token', 'use_auth_token', 'env']:
        try:
            if method == 'token':
                pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=HF_TOKEN)
            elif method == 'use_auth_token':
                pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=HF_TOKEN)
            else:
                import os as _os
                _os.environ["HF_TOKEN"] = HF_TOKEN
                _os.environ["HUGGING_FACE_HUB_TOKEN"] = HF_TOKEN
                pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1")
            
            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            pipeline.to(device)
            logger.info(f"[DIAR] ✅ 파이프라인 로드 완료 (method={method}, device={device})")
            return
        except TypeError as e:
            logger.warning(f"[DIAR] method={method} 실패: {e}, 다음 시도...")
            continue
        except Exception as e:
            logger.error(f"[DIAR] ❌ 파이프라인 로드 실패: {e}")
            pipeline = None
            return
    
    logger.error("[DIAR] ❌ 모든 인증 방식 실패")
    pipeline = None


@app.on_event("startup")
async def startup():
    load_pipeline()


@app.get("/health")
async def health():
    return JSONResponse({
        "status": "ok" if pipeline else "no_model",
        "model": "pyannote/speaker-diarization-3.1",
        "gpu": torch.cuda.is_available()
    })


class StreamingDiarizer:
    """[advice from AI] 실시간 스트리밍 화자분리 - 슬라이딩 윈도우 방식"""
    
    def __init__(self, sample_rate: int = 16000, window_sec: float = 5.0, step_sec: float = 1.0):
        self.sample_rate = sample_rate
        self.window_sec = window_sec      # 분석 윈도우 (5초)
        self.step_sec = step_sec          # 분석 주기 (1초마다)
        self.step_size = int(step_sec * sample_rate)
        self.window_size = int(window_sec * sample_rate)
        self.all_audio = np.array([], dtype=np.float32)
        self.buffer_since_last = np.array([], dtype=np.float32)
        self.current_speaker = -1
        self.lock = threading.Lock()
    
    def add_audio(self, pcm_data: np.ndarray):
        with self.lock:
            self.all_audio = np.concatenate([self.all_audio, pcm_data])
            self.buffer_since_last = np.concatenate([self.buffer_since_last, pcm_data])
    
    async def process(self) -> Optional[int]:
        """[advice from AI] step_size 이상 쌓이면 슬라이딩 윈도우로 화자분리"""
        if pipeline is None:
            return None
        
        with self.lock:
            if len(self.buffer_since_last) < self.step_size:
                return None
            
            # 최근 window_sec 분량만 분석
            audio = self.all_audio[-self.window_size:] if len(self.all_audio) > self.window_size else self.all_audio
            self.buffer_since_last = np.array([], dtype=np.float32)
        
        if len(audio) < self.sample_rate:  # 최소 1초
            return None
        
        try:
            waveform = torch.tensor(audio, dtype=torch.float32).unsqueeze(0)
            audio_input = {"waveform": waveform, "sample_rate": self.sample_rate}
            
            # [advice from AI] pyannote 화자분리 실행
            diarization = pipeline(audio_input)
            
            # 마지막 화자 추출 (가장 최근 발화자)
            last_speaker = -1
            last_end = 0.0
            for turn, _, speaker in diarization.itertracks(yield_label=True):
                if turn.end >= last_end:
                    last_end = turn.end
                    match = re.search(r'(\d+)', speaker)
                    if match:
                        last_speaker = int(match.group())
            
            if last_speaker >= 0 and last_speaker != self.current_speaker:
                old = self.current_speaker
                self.current_speaker = last_speaker
                logger.info(f"[DIAR] 🔄 화자 변경: {old} → {last_speaker}")
                return last_speaker
            
            return None
            
        except Exception as e:
            logger.warning(f"[DIAR] 처리 오류: {e}")
            return None


@app.websocket("/diarize")
async def websocket_diarize(websocket: WebSocket):
    """[advice from AI] PCM 오디오를 받아 실시간 화자 번호 반환"""
    await websocket.accept()
    logger.info("[DIAR] WebSocket 연결됨")
    
    diarizer = StreamingDiarizer(window_sec=5.0, step_sec=1.0)
    running = True
    
    async def process_loop():
        while running:
            try:
                result = await diarizer.process()
                if result is not None:
                    await websocket.send_json({
                        "type": "speaker_change",
                        "speaker": result
                    })
                    logger.info(f"[DIAR] 📤 화자 변경 전송: {result}")
                await asyncio.sleep(0.3)
            except Exception:
                break
    
    process_task = asyncio.create_task(process_loop())
    
    try:
        while True:
            data = await websocket.receive_bytes()
            pcm_int16 = np.frombuffer(data, dtype=np.int16)
            pcm_float = pcm_int16.astype(np.float32) / 32768.0
            diarizer.add_audio(pcm_float)
    except WebSocketDisconnect:
        logger.info("[DIAR] WebSocket 연결 해제")
    except Exception as e:
        logger.error(f"[DIAR] WebSocket 오류: {e}")
    finally:
        running = False
        process_task.cancel()
