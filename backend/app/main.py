# [advice from AI] KTV 실시간 AI 자동자막 POC 백엔드 메인

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from .routers import transcribe, pipeline, realtime, admin
from .models.subtitle import HealthResponse
from .services.stt_service import stt_service
from .services.audio_extractor import audio_extractor

# [advice from AI] 환경변수 로드
load_dotenv()

# [advice from AI] FastAPI 앱 생성
app = FastAPI(
    title="KTV 실시간 AI 자동자막 API",
    description="""
    동영상/음성 파일의 STT 변환 및 자막 생성 API
    
    ## 주요 기능
    - **실시간 스트리밍**: 청크 단위로 즉시 STT 처리 (SSE/WebSocket)
    - MP4 → 오디오 추출 → STT → 자막 생성 파이프라인
    - 화자 분리 (Speaker Diarization)
    - SRT/VTT 자막 파일 생성
    - HAIV STT 연동
    """,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# [advice from AI] CORS 설정 (프론트엔드 연동용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:6430",
        "http://127.0.0.1:6430",
        "http://0.0.0.0:6430",
        "*"  # POC용 - 실제 운영 시 제한 필요
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# [advice from AI] 라우터 등록
app.include_router(transcribe.router)
app.include_router(pipeline.router)
app.include_router(realtime.router)
app.include_router(admin.router, prefix="/api/v1")  # [advice from AI] 사전/필터 관리 API

# [advice from AI] 정적 파일 서빙 (admin.html)
static_path = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_path):
    app.mount("/static", StaticFiles(directory=static_path), name="static")


@app.get("/", tags=["root"])
async def root():
    """API 루트 - 기본 정보"""
    return {
        "service": "KTV 실시간 AI 자동자막 API",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": {
            "transcribe": "/api/transcribe - STT 변환",
            "pipeline": "/api/pipeline - 배치 파이프라인",
            "realtime": "/api/realtime - 실시간 스트리밍 (SSE/WebSocket)"
        }
    }


@app.get("/health", response_model=HealthResponse, tags=["health"])
async def health_check():
    """
    헬스체크 엔드포인트
    """
    stt_connected = await stt_service.check_connection()
    
    return HealthResponse(
        status="healthy",
        stt_api_connected=stt_connected,
        version="1.0.0"
    )


@app.get("/config", tags=["config"])
async def get_config():
    """현재 서비스 설정 정보"""
    return {
        "stt": stt_service.get_config(),
        "ffmpeg_available": audio_extractor.is_available(),
        "upload_dir": os.getenv("UPLOAD_DIR", "/tmp/ktv-uploads"),
        "environment": os.getenv("ENVIRONMENT", "development")
    }
