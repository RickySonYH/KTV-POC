# [advice from AI] 파이프라인 API 라우터 - MP4 → 오디오 → STT → 자막

import os
import tempfile
import aiofiles
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import PlainTextResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional, List

from ..models.subtitle import SubtitleSegment, ProcessStatus
from ..services.pipeline import process_video, PipelineResult
from ..services.audio_extractor import audio_extractor

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])

# [advice from AI] 업로드 디렉토리
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/tmp/ktv-uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


class PipelineRequest(BaseModel):
    """파이프라인 요청 모델"""
    file_path: str
    enable_diarization: bool = True
    chunk_duration: float = 300.0  # 5분


class PipelineResponse(BaseModel):
    """파이프라인 응답 모델"""
    success: bool
    segments: List[SubtitleSegment]
    srt_content: str
    vtt_content: str
    duration: float
    speaker_count: int
    message: str


@router.post("/process", response_model=PipelineResponse)
async def process_video_file(
    file: UploadFile = File(...),
    enable_diarization: bool = True,
    chunk_duration: float = 300.0
):
    """
    동영상 파일 업로드 → 오디오 추출 → STT → 자막 생성 파이프라인
    
    - **file**: 동영상 파일 (MP4, WebM, MOV 등)
    - **enable_diarization**: 화자 분리 활성화 (기본: True)
    - **chunk_duration**: 청크 길이 초 단위 (기본: 300초 = 5분)
    """
    
    # [advice from AI] 파일 형식 검증
    allowed_extensions = {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"}
    file_ext = os.path.splitext(file.filename)[1].lower()
    
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 파일 형식입니다. 지원 형식: {', '.join(allowed_extensions)}"
        )
    
    # [advice from AI] 파일 저장
    temp_file_path = os.path.join(UPLOAD_DIR, f"upload_{os.urandom(8).hex()}{file_ext}")
    
    try:
        async with aiofiles.open(temp_file_path, "wb") as f:
            content = await file.read()
            await f.write(content)
        
        print(f"[Pipeline API] File saved: {temp_file_path} ({len(content)} bytes)")
        
        # [advice from AI] 파이프라인 실행
        result = await process_video(
            input_path=temp_file_path,
            enable_diarization=enable_diarization,
            chunk_duration=chunk_duration
        )
        
        return PipelineResponse(
            success=result.success,
            segments=result.segments,
            srt_content=result.srt_content,
            vtt_content=result.vtt_content,
            duration=result.duration,
            speaker_count=result.speaker_count,
            message=result.message
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"파이프라인 처리 중 오류 발생: {str(e)}"
        )
    finally:
        # [advice from AI] 임시 파일 정리
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)


@router.post("/process-local")
async def process_local_file(request: PipelineRequest):
    """
    로컬 파일 경로로 파이프라인 실행 (서버에 있는 파일)
    
    - **file_path**: 서버의 파일 경로
    - **enable_diarization**: 화자 분리 활성화
    - **chunk_duration**: 청크 길이 (초)
    """
    
    if not os.path.exists(request.file_path):
        raise HTTPException(
            status_code=404,
            detail=f"파일을 찾을 수 없습니다: {request.file_path}"
        )
    
    try:
        result = await process_video(
            input_path=request.file_path,
            enable_diarization=request.enable_diarization,
            chunk_duration=request.chunk_duration
        )
        
        return PipelineResponse(
            success=result.success,
            segments=result.segments,
            srt_content=result.srt_content,
            vtt_content=result.vtt_content,
            duration=result.duration,
            speaker_count=result.speaker_count,
            message=result.message
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"파이프라인 처리 중 오류 발생: {str(e)}"
        )


@router.get("/extract-audio")
async def extract_audio_only(
    file_path: str,
    output_path: Optional[str] = None,
    sample_rate: int = 16000,
    channels: int = 1
):
    """
    오디오만 추출 (STT 없이)
    
    - **file_path**: 입력 파일 경로
    - **output_path**: 출력 파일 경로 (선택)
    - **sample_rate**: 샘플레이트 (기본: 16000)
    - **channels**: 채널 수 (기본: 1 = 모노)
    """
    
    if not os.path.exists(file_path):
        raise HTTPException(
            status_code=404,
            detail=f"파일을 찾을 수 없습니다: {file_path}"
        )
    
    success, output, message = await audio_extractor.extract_audio(
        input_path=file_path,
        output_path=output_path,
        sample_rate=sample_rate,
        channels=channels
    )
    
    if not success:
        raise HTTPException(status_code=500, detail=message)
    
    return {
        "success": True,
        "output_path": output,
        "message": message
    }


@router.get("/info")
async def get_media_info(file_path: str):
    """
    미디어 파일 정보 조회
    
    - **file_path**: 파일 경로
    """
    
    if not os.path.exists(file_path):
        raise HTTPException(
            status_code=404,
            detail=f"파일을 찾을 수 없습니다: {file_path}"
        )
    
    info = audio_extractor.get_media_info(file_path)
    duration = audio_extractor.get_duration(file_path)
    
    return {
        "file_path": file_path,
        "duration": duration,
        "duration_formatted": f"{int(duration // 60)}분 {int(duration % 60)}초",
        "info": info
    }


@router.get("/status")
async def get_pipeline_status():
    """파이프라인 상태 확인"""
    
    ffmpeg_available = audio_extractor.is_available()
    stt_configured = stt_service.is_configured() if 'stt_service' in dir() else False
    
    from ..services.stt_service import stt_service
    
    return {
        "ffmpeg_available": ffmpeg_available,
        "stt_configured": stt_service.is_configured(),
        "stt_client_available": stt_service.is_client_available(),
        "stt_config": stt_service.get_config()
    }
