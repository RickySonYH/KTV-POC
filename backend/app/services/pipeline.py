# [advice from AI] STT 파이프라인 - MP4 → 오디오 추출 → STT → 자막 생성

import os
import asyncio
import tempfile
import shutil
from typing import Optional, Callable, List
from dataclasses import dataclass
from enum import Enum

from .audio_extractor import audio_extractor
from .stt_service import stt_service
from .subtitle_service import subtitle_service
from ..models.subtitle import SubtitleSegment, ProcessStatus


class PipelineStage(str, Enum):
    """파이프라인 단계"""
    INIT = "init"
    AUDIO_EXTRACT = "audio_extract"
    STT_PROCESS = "stt_process"
    SUBTITLE_GENERATE = "subtitle_generate"
    COMPLETED = "completed"
    ERROR = "error"


@dataclass
class PipelineProgress:
    """파이프라인 진행 상태"""
    stage: PipelineStage
    progress: int  # 0-100
    message: str
    current_chunk: int = 0
    total_chunks: int = 1


@dataclass
class PipelineResult:
    """파이프라인 결과"""
    success: bool
    segments: List[SubtitleSegment]
    srt_content: str
    vtt_content: str
    duration: float
    speaker_count: int
    message: str


class STTPipeline:
    """MP4 → 오디오 추출 → STT → 자막 생성 파이프라인"""
    
    def __init__(self):
        self.temp_dir: Optional[str] = None
    
    async def process(
        self,
        input_path: str,
        enable_diarization: bool = True,
        chunk_duration: float = 300.0,  # 5분 단위
        on_progress: Optional[Callable[[PipelineProgress], None]] = None
    ) -> PipelineResult:
        """
        전체 파이프라인 실행
        
        Args:
            input_path: 입력 MP4 파일 경로
            enable_diarization: 화자 분리 활성화
            chunk_duration: 청크 길이 (초)
            on_progress: 진행률 콜백
        
        Returns:
            PipelineResult: 파이프라인 결과
        """
        
        all_segments: List[SubtitleSegment] = []
        
        try:
            # [advice from AI] 임시 디렉토리 생성
            self.temp_dir = tempfile.mkdtemp(prefix="ktv_pipeline_")
            print(f"[Pipeline] Temp dir: {self.temp_dir}")
            
            # === 1단계: 오디오 추출 ===
            self._notify_progress(on_progress, PipelineProgress(
                stage=PipelineStage.AUDIO_EXTRACT,
                progress=0,
                message="오디오 추출 중..."
            ))
            
            # 영상 길이 확인
            total_duration = audio_extractor.get_duration(input_path)
            if total_duration <= 0:
                return PipelineResult(
                    success=False,
                    segments=[],
                    srt_content="",
                    vtt_content="",
                    duration=0,
                    speaker_count=0,
                    message="영상 길이를 확인할 수 없습니다"
                )
            
            print(f"[Pipeline] Total duration: {total_duration:.2f}s")
            
            # [advice from AI] 긴 영상은 청크로 분할
            if total_duration > chunk_duration:
                success, chunks, msg = await audio_extractor.extract_audio_chunks(
                    input_path=input_path,
                    output_dir=self.temp_dir,
                    chunk_duration=chunk_duration
                )
                
                if not success:
                    return PipelineResult(
                        success=False, segments=[], srt_content="", vtt_content="",
                        duration=total_duration, speaker_count=0, message=msg
                    )
            else:
                # 짧은 영상은 단일 파일로 추출
                audio_path = os.path.join(self.temp_dir, "audio.wav")
                success, audio_path, msg = await audio_extractor.extract_audio(
                    input_path=input_path,
                    output_path=audio_path
                )
                
                if not success:
                    return PipelineResult(
                        success=False, segments=[], srt_content="", vtt_content="",
                        duration=total_duration, speaker_count=0, message=msg
                    )
                
                chunks = [{
                    "index": 0,
                    "path": audio_path,
                    "start_time": 0,
                    "duration": total_duration
                }]
            
            self._notify_progress(on_progress, PipelineProgress(
                stage=PipelineStage.AUDIO_EXTRACT,
                progress=100,
                message=f"오디오 추출 완료 ({len(chunks)}개 청크)"
            ))
            
            # === 2단계: STT 처리 ===
            self._notify_progress(on_progress, PipelineProgress(
                stage=PipelineStage.STT_PROCESS,
                progress=0,
                message="STT 처리 중...",
                total_chunks=len(chunks)
            ))
            
            segment_id = 1
            
            for i, chunk in enumerate(chunks):
                self._notify_progress(on_progress, PipelineProgress(
                    stage=PipelineStage.STT_PROCESS,
                    progress=int((i / len(chunks)) * 100),
                    message=f"STT 처리 중... ({i+1}/{len(chunks)})",
                    current_chunk=i+1,
                    total_chunks=len(chunks)
                ))
                
                # [advice from AI] 각 청크 STT 처리
                result = await stt_service.transcribe(
                    file_path=chunk["path"],
                    enable_diarization=enable_diarization
                )
                
                if result.status == ProcessStatus.ERROR:
                    print(f"[Pipeline] Chunk {i} STT error: {result.message}")
                    continue
                
                # [advice from AI] 청크 시작 시간 오프셋 적용
                chunk_start = chunk["start_time"]
                for seg in result.segments:
                    all_segments.append(SubtitleSegment(
                        id=segment_id,
                        start_time=seg.start_time + chunk_start,
                        end_time=seg.end_time + chunk_start,
                        text=seg.text,
                        speaker=seg.speaker
                    ))
                    segment_id += 1
            
            self._notify_progress(on_progress, PipelineProgress(
                stage=PipelineStage.STT_PROCESS,
                progress=100,
                message=f"STT 처리 완료 ({len(all_segments)}개 세그먼트)"
            ))
            
            # === 3단계: 자막 생성 ===
            self._notify_progress(on_progress, PipelineProgress(
                stage=PipelineStage.SUBTITLE_GENERATE,
                progress=50,
                message="자막 파일 생성 중..."
            ))
            
            srt_content = subtitle_service.generate_srt(all_segments, include_speaker=True)
            vtt_content = subtitle_service.generate_vtt(all_segments, include_speaker=True)
            
            # 화자 수 계산
            speakers = set(s.speaker for s in all_segments if s.speaker)
            
            self._notify_progress(on_progress, PipelineProgress(
                stage=PipelineStage.COMPLETED,
                progress=100,
                message="파이프라인 완료"
            ))
            
            return PipelineResult(
                success=True,
                segments=all_segments,
                srt_content=srt_content,
                vtt_content=vtt_content,
                duration=total_duration,
                speaker_count=len(speakers),
                message=f"처리 완료: {len(all_segments)}개 세그먼트, {len(speakers)}명 화자"
            )
            
        except Exception as e:
            print(f"[Pipeline] Exception: {str(e)}")
            return PipelineResult(
                success=False,
                segments=[],
                srt_content="",
                vtt_content="",
                duration=0,
                speaker_count=0,
                message=f"파이프라인 오류: {str(e)}"
            )
        finally:
            # [advice from AI] 임시 파일 정리
            self._cleanup()
    
    def _notify_progress(
        self,
        callback: Optional[Callable[[PipelineProgress], None]],
        progress: PipelineProgress
    ):
        """진행률 알림"""
        print(f"[Pipeline] {progress.stage.value}: {progress.progress}% - {progress.message}")
        if callback:
            callback(progress)
    
    def _cleanup(self):
        """임시 파일 정리"""
        if self.temp_dir and os.path.exists(self.temp_dir):
            try:
                shutil.rmtree(self.temp_dir)
                print(f"[Pipeline] Cleaned up: {self.temp_dir}")
            except Exception as e:
                print(f"[Pipeline] Cleanup error: {e}")
            self.temp_dir = None


# [advice from AI] 간편 실행 함수
async def process_video(
    input_path: str,
    enable_diarization: bool = True,
    chunk_duration: float = 300.0,
    on_progress: Optional[Callable[[PipelineProgress], None]] = None
) -> PipelineResult:
    """
    비디오 파일을 처리하여 자막 생성
    
    Args:
        input_path: 입력 MP4 파일 경로
        enable_diarization: 화자 분리 활성화
        chunk_duration: 청크 길이 (초, 기본 5분)
        on_progress: 진행률 콜백
    
    Returns:
        PipelineResult: 처리 결과
    """
    pipeline = STTPipeline()
    return await pipeline.process(
        input_path=input_path,
        enable_diarization=enable_diarization,
        chunk_duration=chunk_duration,
        on_progress=on_progress
    )
