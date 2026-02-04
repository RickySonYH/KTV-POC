# [advice from AI] 화자 변경 감지 라우터
# WebSocket으로 오디오 수신 → 화자 변경 감지 → 응답

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
import logging
import asyncio

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/speaker", tags=["speaker"])

# 지연 로딩 (서버 시작 시 로드하지 않음)
_detector = None

def get_detector():
    global _detector
    if _detector is None:
        from ..services.speaker_change import SpeakerChangeDetector
        _detector = SpeakerChangeDetector(threshold=0.70)
        logger.info("[SPEAKER] 화자 변경 감지기 초기화됨")
    return _detector


@router.get("/status")
async def speaker_status():
    """화자 감지 서비스 상태"""
    try:
        detector = get_detector()
        return {
            "status": "ready",
            "threshold": detector.threshold,
            "current_speaker": detector.current_speaker
        }
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "message": str(e)}
        )


@router.post("/reset")
async def reset_speaker():
    """화자 상태 초기화"""
    try:
        detector = get_detector()
        detector.reset()
        return {"status": "reset", "current_speaker": 0}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


@router.websocket("/ws")
async def speaker_websocket(websocket: WebSocket):
    """
    화자 변경 감지 WebSocket
    
    클라이언트가 오디오 청크(PCM 16-bit, 16kHz)를 전송하면
    화자 변경 여부와 현재 화자 인덱스를 응답
    
    Request (binary): PCM audio bytes
    Response (JSON): {"speaker_changed": bool, "speaker": 0|1}
    """
    await websocket.accept()
    logger.info("[SPEAKER-WS] 클라이언트 연결됨")
    
    detector = get_detector()
    detector.reset()  # 새 세션 시작
    
    try:
        while True:
            # 바이너리 데이터(오디오) 수신
            data = await websocket.receive_bytes()
            
            if len(data) < 1600:  # 최소 0.05초 (16000 * 0.05 * 2bytes)
                continue
            
            # 화자 변경 감지
            changed, speaker = detector.process_audio(data)
            
            # 결과 전송
            await websocket.send_json({
                "speaker_changed": changed,
                "speaker": speaker  # 0=흰색, 1=노란색
            })
            
    except WebSocketDisconnect:
        logger.info("[SPEAKER-WS] 클라이언트 연결 종료")
    except Exception as e:
        logger.error(f"[SPEAKER-WS] 오류: {e}")
        try:
            await websocket.close(code=1011, reason=str(e))
        except:
            pass


@router.post("/analyze")
async def analyze_audio(audio_data: bytes):
    """
    REST API로 단일 오디오 청크 분석
    
    Content-Type: application/octet-stream
    Body: PCM 16-bit audio (16kHz)
    """
    try:
        detector = get_detector()
        changed, speaker = detector.process_audio(audio_data)
        return {
            "speaker_changed": changed,
            "speaker": speaker
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )
