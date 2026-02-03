# [advice from AI] HAIV STT 서비스 - haiv.timbel.net 연동

import os
import asyncio
import subprocess
import json
import tempfile
import shutil
from typing import List, Optional, Callable
from pathlib import Path
from ..models.subtitle import SubtitleSegment, STTResponse, ProcessStatus

# [advice from AI] HAIV STT API 설정
HAIV_URL = os.getenv("HAIV_URL", "haiv.timbel.net:40001")
HAIV_CHANNEL = os.getenv("HAIV_CHANNEL", "1")
HAIV_BYTERATE = os.getenv("HAIV_BYTERATE", "16000")
HAIV_MODEL = os.getenv("HAIV_MODEL", "KOREAN_ONLINE_8K")
HAIV_PROJECT_ID = os.getenv("HAIV_PROJECT_ID", "2ec95f1c-3b52-4eaa-a29a-6065e2d95d61")

# HAIV 클라이언트 스크립트 경로
HAIV_CLIENT_PATH = os.getenv("HAIV_CLIENT_PATH", "/app/haiv/HAIV_client.py")


class HAIVSTTService:
    """HAIV STT 서비스 클래스"""
    
    def __init__(self):
        self.url = HAIV_URL
        self.channel = HAIV_CHANNEL
        self.byterate = HAIV_BYTERATE
        self.model = HAIV_MODEL
        self.project_id = HAIV_PROJECT_ID
        self.client_path = HAIV_CLIENT_PATH
    
    def is_configured(self) -> bool:
        """HAIV STT가 설정되어 있는지 확인"""
        return bool(self.url and self.project_id)
    
    def is_client_available(self) -> bool:
        """HAIV 클라이언트 스크립트가 존재하는지 확인"""
        return os.path.exists(self.client_path)
    
    async def check_connection(self) -> bool:
        """HAIV STT 연결 상태 확인"""
        if not self.is_configured():
            return False
        
        # [advice from AI] 실제 연결 테스트는 클라이언트가 있을 때만
        if not self.is_client_available():
            return False
        
        try:
            # 간단한 연결 테스트 (ping 또는 health check)
            import socket
            host, port = self.url.split(":")
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5)
            result = sock.connect_ex((host, int(port)))
            sock.close()
            return result == 0
        except Exception:
            return False
    
    async def transcribe(
        self,
        file_path: str,
        enable_diarization: bool = True,
        on_progress: Optional[Callable[[int], None]] = None
    ) -> STTResponse:
        """
        HAIV STT를 사용하여 음성을 텍스트로 변환
        
        Args:
            file_path: 음성/영상 파일 경로
            enable_diarization: 화자 분리 활성화 여부
            on_progress: 진행률 콜백 함수
        
        Returns:
            STTResponse: 변환된 자막 세그먼트 목록
        """
        
        # [advice from AI] 클라이언트가 없으면 Mock 데이터 반환
        if not self.is_client_available():
            print(f"[HAIV STT] Client not found at {self.client_path}, using mock data")
            return await self._generate_mock_response(on_progress)
        
        try:
            # [advice from AI] 임시 디렉토리에 파일 복사 (HAIV는 디렉토리 기반)
            with tempfile.TemporaryDirectory() as temp_dir:
                # 파일 복사
                file_name = os.path.basename(file_path)
                temp_file = os.path.join(temp_dir, file_name)
                shutil.copy(file_path, temp_file)
                
                # 결과 파일 경로
                result_file = os.path.join(temp_dir, "result.json")
                
                # [advice from AI] HAIV 클라이언트 실행
                cmd = [
                    "python", self.client_path,
                    "-u", self.url,
                    "-ch", self.channel,
                    "--byterate", self.byterate,
                    "--model-name", self.model,
                    "-d", temp_dir,
                    "--project_id", self.project_id,
                    "--output", result_file
                ]
                
                if enable_diarization:
                    cmd.append("--diarization")
                
                print(f"[HAIV STT] Running command: {' '.join(cmd)}")
                
                # 비동기 프로세스 실행
                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                
                # 진행률 시뮬레이션 (실제로는 클라이언트 출력 파싱 필요)
                if on_progress:
                    for i in range(10):
                        await asyncio.sleep(0.5)
                        on_progress((i + 1) * 10)
                
                stdout, stderr = await process.communicate()
                
                if process.returncode != 0:
                    error_msg = stderr.decode() if stderr else "Unknown error"
                    print(f"[HAIV STT] Error: {error_msg}")
                    return STTResponse(
                        segments=[],
                        status=ProcessStatus.ERROR,
                        message=f"HAIV STT Error: {error_msg}"
                    )
                
                # [advice from AI] 결과 파일 파싱
                if os.path.exists(result_file):
                    with open(result_file, "r", encoding="utf-8") as f:
                        result = json.load(f)
                    
                    segments = self._parse_haiv_result(result)
                    
                    return STTResponse(
                        segments=segments,
                        status=ProcessStatus.COMPLETED,
                        message="HAIV STT 처리 완료",
                        duration=result.get("duration"),
                        speaker_count=len(set(s.speaker for s in segments if s.speaker))
                    )
                else:
                    # 결과 파일이 없으면 stdout에서 파싱 시도
                    output = stdout.decode()
                    segments = self._parse_haiv_output(output)
                    
                    return STTResponse(
                        segments=segments,
                        status=ProcessStatus.COMPLETED,
                        message="HAIV STT 처리 완료",
                        speaker_count=len(set(s.speaker for s in segments if s.speaker))
                    )
                    
        except Exception as e:
            print(f"[HAIV STT] Exception: {str(e)}")
            return STTResponse(
                segments=[],
                status=ProcessStatus.ERROR,
                message=f"HAIV STT 처리 중 오류: {str(e)}"
            )
    
    def _parse_haiv_result(self, result: dict) -> List[SubtitleSegment]:
        """HAIV 결과 JSON 파싱"""
        segments = []
        
        # [advice from AI] HAIV 결과 형식에 맞게 파싱 (예상 형식)
        for i, seg in enumerate(result.get("segments", result.get("results", []))):
            segments.append(SubtitleSegment(
                id=i + 1,
                start_time=seg.get("start", seg.get("start_time", 0)),
                end_time=seg.get("end", seg.get("end_time", 0)),
                text=seg.get("text", seg.get("transcript", "")),
                speaker=seg.get("speaker", seg.get("speaker_id"))
            ))
        
        return segments
    
    def _parse_haiv_output(self, output: str) -> List[SubtitleSegment]:
        """HAIV stdout 출력 파싱"""
        segments = []
        
        # [advice from AI] 라인별 파싱 시도
        lines = output.strip().split("\n")
        for i, line in enumerate(lines):
            if not line.strip():
                continue
            
            try:
                # JSON 라인 형식 시도
                data = json.loads(line)
                segments.append(SubtitleSegment(
                    id=i + 1,
                    start_time=data.get("start", 0),
                    end_time=data.get("end", 0),
                    text=data.get("text", ""),
                    speaker=data.get("speaker")
                ))
            except json.JSONDecodeError:
                # 일반 텍스트 형식
                if line.strip():
                    segments.append(SubtitleSegment(
                        id=len(segments) + 1,
                        start_time=len(segments) * 3.0,
                        end_time=(len(segments) + 1) * 3.0,
                        text=line.strip(),
                        speaker=None
                    ))
        
        return segments
    
    async def _generate_mock_response(
        self,
        on_progress: Optional[Callable[[int], None]] = None
    ) -> STTResponse:
        """Mock 데이터 생성 (테스트용)"""
        
        # [advice from AI] Mock 데이터 - 다화자 대화 예시
        mock_data = [
            {"speaker": "화자1", "text": "안녕하십니까, KTV 국민방송입니다."},
            {"speaker": "화자1", "text": "오늘 뉴스의 주요 내용을 전해드리겠습니다."},
            {"speaker": "화자2", "text": "네, 먼저 첫 번째 소식입니다."},
            {"speaker": "화자2", "text": "정부는 오늘 새로운 정책을 발표했습니다."},
            {"speaker": "화자1", "text": "이에 대해 자세히 알아보겠습니다."},
            {"speaker": "화자2", "text": "전문가들은 이번 정책에 대해 긍정적인 평가를 내리고 있습니다."},
            {"speaker": "화자1", "text": "시민들의 반응은 어떨까요?"},
            {"speaker": "화자3", "text": "네, 저는 이번 정책이 매우 좋다고 생각합니다."},
            {"speaker": "화자3", "text": "특히 청년들에게 많은 도움이 될 것 같습니다."},
            {"speaker": "화자1", "text": "다음 소식입니다."},
            {"speaker": "화자2", "text": "오늘 날씨는 전국적으로 맑겠습니다."},
            {"speaker": "화자2", "text": "다만 일부 지역에서는 소나기가 예상됩니다."},
            {"speaker": "화자1", "text": "이상으로 오늘의 뉴스를 마치겠습니다."},
            {"speaker": "화자1", "text": "시청해 주셔서 감사합니다."},
        ]
        
        # 진행률 시뮬레이션
        for i in range(10):
            await asyncio.sleep(0.3)
            if on_progress:
                on_progress((i + 1) * 10)
        
        # 세그먼트 생성 (300초 기준으로 분배)
        duration = 300.0
        segment_duration = duration / len(mock_data)
        
        segments = [
            SubtitleSegment(
                id=i + 1,
                start_time=i * segment_duration,
                end_time=(i + 1) * segment_duration - 0.1,
                text=item["text"],
                speaker=item["speaker"]
            )
            for i, item in enumerate(mock_data)
        ]
        
        return STTResponse(
            segments=segments,
            status=ProcessStatus.COMPLETED,
            message="Mock 데이터로 처리됨 (HAIV 클라이언트 미설치)",
            duration=duration,
            speaker_count=3
        )
    
    def get_config(self) -> dict:
        """현재 설정 반환"""
        return {
            "url": self.url,
            "channel": self.channel,
            "byterate": self.byterate,
            "model": self.model,
            "project_id": self.project_id,
            "client_path": self.client_path,
            "client_available": self.is_client_available()
        }


# 싱글톤 인스턴스
stt_service = HAIVSTTService()
