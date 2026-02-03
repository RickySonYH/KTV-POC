# [advice from AI] STT 변환 API 라우터

import os
import tempfile
import aiofiles
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import PlainTextResponse
from typing import Optional

from ..models.subtitle import (
    STTResponse,
    SubtitleSegment,
    SubtitleExportRequest,
    ProcessStatus
)
from ..services.stt_service import stt_service
from ..services.subtitle_service import subtitle_service

router = APIRouter(prefix="/api/transcribe", tags=["transcribe"])

# [advice from AI] 업로드된 파일 저장 디렉토리
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/tmp/ktv-uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/", response_model=STTResponse)
async def transcribe_video(
    file: UploadFile = File(...),
    enable_diarization: bool = True
):
    """
    동영상/음성 파일을 업로드하여 STT 변환
    
    - **file**: 동영상 또는 음성 파일 (MP4, MP3, WAV 등)
    - **enable_diarization**: 화자 분리 활성화 여부 (기본: True)
    """
    
    # [advice from AI] 파일 형식 검증
    allowed_extensions = {".mp4", ".mp3", ".wav", ".webm", ".ogg", ".m4a", ".flac"}
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
        
        # [advice from AI] HAIV STT 처리
        result = await stt_service.transcribe(
            file_path=temp_file_path,
            enable_diarization=enable_diarization
        )
        
        return result
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"STT 처리 중 오류 발생: {str(e)}"
        )
    finally:
        # [advice from AI] 임시 파일 정리
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)


@router.post("/export/srt", response_class=PlainTextResponse)
async def export_srt(request: SubtitleExportRequest):
    """
    자막 세그먼트를 SRT 형식으로 내보내기
    """
    try:
        srt_content = subtitle_service.generate_srt(
            segments=request.segments,
            include_speaker=request.include_speaker
        )
        return PlainTextResponse(
            content=srt_content,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=subtitle.srt"}
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"SRT 생성 중 오류 발생: {str(e)}"
        )


@router.post("/export/vtt", response_class=PlainTextResponse)
async def export_vtt(request: SubtitleExportRequest):
    """
    자막 세그먼트를 VTT 형식으로 내보내기
    """
    try:
        vtt_content = subtitle_service.generate_vtt(
            segments=request.segments,
            include_speaker=request.include_speaker
        )
        return PlainTextResponse(
            content=vtt_content,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=subtitle.vtt"}
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"VTT 생성 중 오류 발생: {str(e)}"
        )


@router.get("/config")
async def get_stt_config():
    """
    현재 STT 설정 정보 조회
    """
    return stt_service.get_config()
