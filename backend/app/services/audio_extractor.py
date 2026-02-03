# [advice from AI] 오디오 추출 서비스 - FFmpeg를 사용하여 MP4에서 오디오 추출

import os
import asyncio
import subprocess
from pathlib import Path
from typing import Optional, Tuple


class AudioExtractor:
    """MP4에서 오디오를 추출하는 서비스"""
    
    # [advice from AI] HAIV STT에 맞는 오디오 설정
    DEFAULT_SAMPLE_RATE = 16000  # 16kHz
    DEFAULT_CHANNELS = 1        # 모노
    DEFAULT_FORMAT = "wav"      # WAV 형식
    
    def __init__(self):
        self.ffmpeg_path = self._find_ffmpeg()
    
    def _find_ffmpeg(self) -> str:
        """FFmpeg 경로 찾기"""
        # 시스템 PATH에서 찾기
        result = subprocess.run(
            ["which", "ffmpeg"],
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            return result.stdout.strip()
        return "ffmpeg"  # 기본값
    
    def is_available(self) -> bool:
        """FFmpeg 사용 가능 여부 확인"""
        try:
            result = subprocess.run(
                [self.ffmpeg_path, "-version"],
                capture_output=True,
                timeout=5
            )
            return result.returncode == 0
        except Exception:
            return False
    
    def get_media_info(self, input_path: str) -> dict:
        """미디어 파일 정보 조회"""
        try:
            cmd = [
                "ffprobe",
                "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                input_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0:
                import json
                return json.loads(result.stdout)
            return {}
        except Exception:
            return {}
    
    def get_duration(self, input_path: str) -> float:
        """미디어 파일 길이(초) 조회"""
        info = self.get_media_info(input_path)
        try:
            return float(info.get("format", {}).get("duration", 0))
        except (ValueError, TypeError):
            return 0.0
    
    async def extract_audio(
        self,
        input_path: str,
        output_path: Optional[str] = None,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        channels: int = DEFAULT_CHANNELS,
        output_format: str = DEFAULT_FORMAT,
        start_time: Optional[float] = None,
        duration: Optional[float] = None,
        on_progress: Optional[callable] = None
    ) -> Tuple[bool, str, str]:
        """
        MP4에서 오디오 추출
        
        Args:
            input_path: 입력 파일 경로 (MP4)
            output_path: 출력 파일 경로 (없으면 자동 생성)
            sample_rate: 샘플레이트 (기본: 16000Hz)
            channels: 채널 수 (기본: 1 = 모노)
            output_format: 출력 형식 (기본: wav)
            start_time: 시작 시간 (초)
            duration: 추출 길이 (초)
            on_progress: 진행률 콜백
        
        Returns:
            Tuple[성공여부, 출력파일경로, 메시지]
        """
        
        if not os.path.exists(input_path):
            return False, "", f"입력 파일이 존재하지 않습니다: {input_path}"
        
        # [advice from AI] 출력 경로 자동 생성
        if output_path is None:
            input_stem = Path(input_path).stem
            output_dir = os.path.dirname(input_path)
            output_path = os.path.join(output_dir, f"{input_stem}_audio.{output_format}")
        
        # [advice from AI] FFmpeg 명령 구성
        cmd = [
            self.ffmpeg_path,
            "-y",  # 덮어쓰기
            "-i", input_path,
        ]
        
        # 시작 시간 설정
        if start_time is not None:
            cmd.extend(["-ss", str(start_time)])
        
        # 길이 설정
        if duration is not None:
            cmd.extend(["-t", str(duration)])
        
        # 오디오 설정
        cmd.extend([
            "-vn",  # 비디오 제거
            "-acodec", "pcm_s16le",  # 16비트 PCM
            "-ar", str(sample_rate),  # 샘플레이트
            "-ac", str(channels),  # 채널 수
            "-f", output_format,  # 출력 형식
            output_path
        ])
        
        try:
            print(f"[AudioExtractor] Running: {' '.join(cmd)}")
            
            # [advice from AI] 비동기 프로세스 실행
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await process.communicate()
            
            if process.returncode != 0:
                error_msg = stderr.decode() if stderr else "Unknown error"
                print(f"[AudioExtractor] Error: {error_msg}")
                return False, "", f"오디오 추출 실패: {error_msg}"
            
            if not os.path.exists(output_path):
                return False, "", "출력 파일이 생성되지 않았습니다"
            
            file_size = os.path.getsize(output_path)
            print(f"[AudioExtractor] Success: {output_path} ({file_size} bytes)")
            
            return True, output_path, "오디오 추출 완료"
            
        except Exception as e:
            return False, "", f"오디오 추출 중 오류: {str(e)}"
    
    async def extract_audio_chunks(
        self,
        input_path: str,
        output_dir: str,
        chunk_duration: float = 300.0,  # 5분 단위
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        channels: int = DEFAULT_CHANNELS
    ) -> Tuple[bool, list, str]:
        """
        긴 영상을 청크 단위로 분할하여 오디오 추출
        
        Args:
            input_path: 입력 파일 경로
            output_dir: 출력 디렉토리
            chunk_duration: 청크 길이 (초, 기본: 300초 = 5분)
            sample_rate: 샘플레이트
            channels: 채널 수
        
        Returns:
            Tuple[성공여부, 출력파일목록, 메시지]
        """
        
        total_duration = self.get_duration(input_path)
        if total_duration <= 0:
            return False, [], "영상 길이를 확인할 수 없습니다"
        
        os.makedirs(output_dir, exist_ok=True)
        
        input_stem = Path(input_path).stem
        output_files = []
        
        chunk_index = 0
        current_time = 0.0
        
        while current_time < total_duration:
            chunk_output = os.path.join(
                output_dir, 
                f"{input_stem}_chunk_{chunk_index:03d}.wav"
            )
            
            # 남은 시간이 청크보다 짧으면 남은 시간만큼만
            remaining = total_duration - current_time
            actual_duration = min(chunk_duration, remaining)
            
            success, output_path, msg = await self.extract_audio(
                input_path=input_path,
                output_path=chunk_output,
                sample_rate=sample_rate,
                channels=channels,
                start_time=current_time,
                duration=actual_duration
            )
            
            if not success:
                return False, output_files, f"청크 {chunk_index} 추출 실패: {msg}"
            
            output_files.append({
                "index": chunk_index,
                "path": output_path,
                "start_time": current_time,
                "duration": actual_duration
            })
            
            current_time += chunk_duration
            chunk_index += 1
        
        return True, output_files, f"{len(output_files)}개 청크 추출 완료"


# 싱글톤 인스턴스
audio_extractor = AudioExtractor()
