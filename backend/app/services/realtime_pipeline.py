# [advice from AI] 실시간 STT 파이프라인 - 청크 단위 스트리밍 처리

import os
import asyncio
import tempfile
import shutil
from typing import Optional, AsyncGenerator, Callable
from dataclasses import dataclass, asdict
from enum import Enum
import json

from .audio_extractor import audio_extractor
from .stt_service import stt_service
from .subtitle_service import subtitle_service
from ..models.subtitle import SubtitleSegment, ProcessStatus


class StreamEventType(str, Enum):
    """스트림 이벤트 타입"""
    INIT = "init"
    CHUNK_START = "chunk_start"
    CHUNK_AUDIO = "chunk_audio"
    CHUNK_STT = "chunk_stt"
    CHUNK_COMPLETE = "chunk_complete"
    SUBTITLE = "subtitle"
    PROGRESS = "progress"
    COMPLETE = "complete"
    ERROR = "error"


@dataclass
class StreamEvent:
    """스트림 이벤트"""
    type: StreamEventType
    data: dict
    
    def to_json(self) -> str:
        return json.dumps({
            "type": self.type.value,
            "data": self.data
        }, ensure_ascii=False)
    
    def to_sse(self) -> str:
        """Server-Sent Events 형식으로 변환"""
        return f"data: {self.to_json()}\n\n"


class RealtimeSTTPipeline:
    """실시간 STT 파이프라인 - 청크 단위 스트리밍"""
    
    def __init__(self):
        self.temp_dir: Optional[str] = None
        self.is_cancelled = False
    
    def cancel(self):
        """파이프라인 취소"""
        self.is_cancelled = True
    
    async def process_stream(
        self,
        input_path: str,
        enable_diarization: bool = True,
        chunk_duration: float = 30.0,  # [advice from AI] 실시간은 30초 단위가 적합
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        실시간 스트리밍 파이프라인
        
        청크 단위로 오디오 추출 → STT → 자막 생성을 동시에 처리
        
        Args:
            input_path: 입력 MP4 파일 경로
            enable_diarization: 화자 분리 활성화
            chunk_duration: 청크 길이 (초, 실시간은 30초 권장)
        
        Yields:
            StreamEvent: 실시간 이벤트
        """
        
        self.is_cancelled = False
        all_segments = []
        segment_id = 1
        
        try:
            # [advice from AI] 임시 디렉토리 생성
            self.temp_dir = tempfile.mkdtemp(prefix="ktv_realtime_")
            
            # 영상 길이 확인
            total_duration = audio_extractor.get_duration(input_path)
            if total_duration <= 0:
                yield StreamEvent(
                    type=StreamEventType.ERROR,
                    data={"message": "영상 길이를 확인할 수 없습니다"}
                )
                return
            
            # 청크 수 계산
            total_chunks = int(total_duration / chunk_duration) + 1
            
            yield StreamEvent(
                type=StreamEventType.INIT,
                data={
                    "total_duration": total_duration,
                    "chunk_duration": chunk_duration,
                    "total_chunks": total_chunks,
                    "file_path": input_path
                }
            )
            
            # [advice from AI] 청크 단위 실시간 처리
            chunk_index = 0
            current_time = 0.0
            
            while current_time < total_duration and not self.is_cancelled:
                remaining = total_duration - current_time
                actual_duration = min(chunk_duration, remaining)
                
                # 청크 시작 이벤트
                yield StreamEvent(
                    type=StreamEventType.CHUNK_START,
                    data={
                        "chunk_index": chunk_index,
                        "start_time": current_time,
                        "duration": actual_duration,
                        "progress": int((current_time / total_duration) * 100)
                    }
                )
                
                # [advice from AI] 1. 오디오 추출 (이 청크만)
                chunk_audio_path = os.path.join(
                    self.temp_dir,
                    f"chunk_{chunk_index:04d}.wav"
                )
                
                success, audio_path, msg = await audio_extractor.extract_audio(
                    input_path=input_path,
                    output_path=chunk_audio_path,
                    start_time=current_time,
                    duration=actual_duration
                )
                
                if not success:
                    yield StreamEvent(
                        type=StreamEventType.ERROR,
                        data={
                            "chunk_index": chunk_index,
                            "message": f"오디오 추출 실패: {msg}"
                        }
                    )
                    current_time += chunk_duration
                    chunk_index += 1
                    continue
                
                yield StreamEvent(
                    type=StreamEventType.CHUNK_AUDIO,
                    data={
                        "chunk_index": chunk_index,
                        "audio_path": audio_path,
                        "message": "오디오 추출 완료"
                    }
                )
                
                # [advice from AI] 2. 즉시 STT 처리
                result = await stt_service.transcribe(
                    file_path=audio_path,
                    enable_diarization=enable_diarization
                )
                
                if result.status == ProcessStatus.ERROR:
                    yield StreamEvent(
                        type=StreamEventType.ERROR,
                        data={
                            "chunk_index": chunk_index,
                            "message": f"STT 실패: {result.message}"
                        }
                    )
                else:
                    # [advice from AI] 3. 시간 오프셋 적용하여 자막 생성
                    chunk_segments = []
                    for seg in result.segments:
                        new_segment = SubtitleSegment(
                            id=segment_id,
                            start_time=seg.start_time + current_time,
                            end_time=seg.end_time + current_time,
                            text=seg.text,
                            speaker=seg.speaker
                        )
                        chunk_segments.append(new_segment)
                        all_segments.append(new_segment)
                        segment_id += 1
                        
                        # [advice from AI] 각 자막을 실시간으로 전송
                        yield StreamEvent(
                            type=StreamEventType.SUBTITLE,
                            data={
                                "segment": {
                                    "id": new_segment.id,
                                    "start_time": new_segment.start_time,
                                    "end_time": new_segment.end_time,
                                    "text": new_segment.text,
                                    "speaker": new_segment.speaker
                                }
                            }
                        )
                    
                    yield StreamEvent(
                        type=StreamEventType.CHUNK_STT,
                        data={
                            "chunk_index": chunk_index,
                            "segment_count": len(chunk_segments),
                            "message": f"{len(chunk_segments)}개 자막 생성"
                        }
                    )
                
                # 청크 완료
                yield StreamEvent(
                    type=StreamEventType.CHUNK_COMPLETE,
                    data={
                        "chunk_index": chunk_index,
                        "total_segments": len(all_segments),
                        "progress": int(((current_time + actual_duration) / total_duration) * 100)
                    }
                )
                
                # [advice from AI] 임시 오디오 파일 삭제 (메모리 절약)
                if os.path.exists(audio_path):
                    os.remove(audio_path)
                
                current_time += chunk_duration
                chunk_index += 1
            
            # [advice from AI] 최종 자막 파일 생성
            if all_segments and not self.is_cancelled:
                srt_content = subtitle_service.generate_srt(all_segments, include_speaker=True)
                vtt_content = subtitle_service.generate_vtt(all_segments, include_speaker=True)
                speakers = set(s.speaker for s in all_segments if s.speaker)
                
                yield StreamEvent(
                    type=StreamEventType.COMPLETE,
                    data={
                        "success": True,
                        "total_segments": len(all_segments),
                        "total_duration": total_duration,
                        "speaker_count": len(speakers),
                        "srt_content": srt_content,
                        "vtt_content": vtt_content,
                        "message": "처리 완료"
                    }
                )
            elif self.is_cancelled:
                yield StreamEvent(
                    type=StreamEventType.ERROR,
                    data={"message": "처리가 취소되었습니다"}
                )
            else:
                yield StreamEvent(
                    type=StreamEventType.COMPLETE,
                    data={
                        "success": False,
                        "total_segments": 0,
                        "message": "자막을 생성할 수 없습니다"
                    }
                )
                
        except Exception as e:
            yield StreamEvent(
                type=StreamEventType.ERROR,
                data={"message": f"파이프라인 오류: {str(e)}"}
            )
        finally:
            self._cleanup()
    
    def _cleanup(self):
        """임시 파일 정리"""
        if self.temp_dir and os.path.exists(self.temp_dir):
            try:
                shutil.rmtree(self.temp_dir)
            except Exception:
                pass
            self.temp_dir = None


# [advice from AI] 간편 스트리밍 함수
async def stream_process_video(
    input_path: str,
    enable_diarization: bool = True,
    chunk_duration: float = 30.0
) -> AsyncGenerator[StreamEvent, None]:
    """
    비디오 파일을 실시간 스트리밍으로 처리
    
    Args:
        input_path: 입력 MP4 파일 경로
        enable_diarization: 화자 분리 활성화
        chunk_duration: 청크 길이 (초, 기본 30초)
    
    Yields:
        StreamEvent: 실시간 이벤트
    """
    pipeline = RealtimeSTTPipeline()
    async for event in pipeline.process_stream(
        input_path=input_path,
        enable_diarization=enable_diarization,
        chunk_duration=chunk_duration
    ):
        yield event
