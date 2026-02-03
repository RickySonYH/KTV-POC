# [advice from AI] 자막 관련 Pydantic 모델 정의

from pydantic import BaseModel
from typing import Optional, List
from enum import Enum


class ProcessStatus(str, Enum):
    IDLE = "idle"
    PROCESSING = "processing"
    COMPLETED = "completed"
    ERROR = "error"


class SubtitleSegment(BaseModel):
    """자막 세그먼트 모델"""
    id: int
    start_time: float  # 초 단위
    end_time: float
    text: str
    speaker: Optional[str] = None  # 화자 분리용


class STTRequest(BaseModel):
    """STT 요청 모델"""
    file_path: str
    language: str = "ko"
    enable_diarization: bool = True  # 화자 분리 활성화


class STTResponse(BaseModel):
    """STT 응답 모델"""
    segments: List[SubtitleSegment]
    status: ProcessStatus
    message: Optional[str] = None
    duration: Optional[float] = None
    speaker_count: Optional[int] = None


class SubtitleExportRequest(BaseModel):
    """자막 내보내기 요청 모델"""
    segments: List[SubtitleSegment]
    format: str = "srt"  # srt 또는 vtt
    include_speaker: bool = True


class HealthResponse(BaseModel):
    """헬스체크 응답 모델"""
    status: str
    stt_api_connected: bool
    version: str
