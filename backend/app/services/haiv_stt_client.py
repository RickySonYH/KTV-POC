# [advice from AI] HAIV STT API 클라이언트 - HAIV_client_20250314.py 스펙 기반

import asyncio
import os
import json
from typing import AsyncGenerator, Optional
from dataclasses import dataclass
import websockets


@dataclass
class HAIVConfig:
    """HAIV STT 설정"""
    host: str = "haiv.timbel.net:40001"
    model_name: str = "KOREAN_ONLINE_8K"
    project_id: Optional[str] = "2ec95f1c-3b52-4eaa-a29a-6065e2d95d61"
    byterate: int = 16000
    num_speaker: Optional[int] = None
    language: str = "ko"
    verbosity: str = "final"
    norealtime: bool = False


@dataclass 
class STTResult:
    """STT 결과"""
    text: str
    start_time: float
    end_time: float
    speaker: Optional[str] = None
    is_final: bool = True


class HAIVSTTClient:
    """
    HAIV STT WebSocket 클라이언트
    HAIV_client_20250314.py 스펙 기반
    """
    
    def __init__(self, config: Optional[HAIVConfig] = None):
        self.config = config or HAIVConfig()
        self.websocket = None
        self.is_connected = False
        self.results = []
        
    def _build_uri(self) -> str:
        """WebSocket URI 생성 - HAIV 스펙"""
        # [advice from AI] 올바른 엔드포인트: /client/ws/speech
        uri = f"ws://{self.config.host}/client/ws/speech"
        uri += f"?model={self.config.model_name}"
        
        if self.config.project_id:
            uri += f"&project={self.config.project_id}"
        if self.config.num_speaker:
            uri += f"&num-speaker={self.config.num_speaker}"
        if self.config.norealtime:
            uri += "&mode=batch"
        if self.config.verbosity:
            uri += f"&verbosity={self.config.verbosity}"
        if self.config.language:
            uri += f"&lang={self.config.language}"
            
        return uri
        
    async def connect(self) -> bool:
        """WebSocket 연결"""
        try:
            uri = self._build_uri()
            print(f"[HAIV] 연결 시도: {uri}")
            
            self.websocket = await websockets.connect(
                uri,
                ping_interval=20,
                ping_timeout=10,
                close_timeout=5
            )
            
            self.is_connected = True
            print(f"[HAIV] ✅ 연결 성공!")
            return True
                
        except Exception as e:
            print(f"[HAIV] ❌ 연결 실패: {e}")
            self.is_connected = False
            return False
    
    async def disconnect(self):
        """연결 종료"""
        if self.websocket:
            try:
                await self.websocket.close()
            except:
                pass
        self.is_connected = False
        print("[HAIV] 연결 종료")
    
    async def transcribe_file(
        self,
        audio_path: str,
        start_offset: float = 0.0
    ) -> AsyncGenerator[STTResult, None]:
        """오디오 파일을 STT로 변환"""
        if not os.path.exists(audio_path):
            print(f"[HAIV] 파일 없음: {audio_path}")
            return
        
        if not self.is_connected:
            if not await self.connect():
                return
        
        self.results = []
        
        try:
            # [advice from AI] 송신/수신 태스크 병렬 실행
            send_task = asyncio.create_task(self._send_audio(audio_path))
            receive_task = asyncio.create_task(self._receive_results(start_offset))
            
            await send_task
            
            try:
                await asyncio.wait_for(receive_task, timeout=30.0)
            except asyncio.TimeoutError:
                print("[HAIV] 수신 타임아웃")
            
            for result in self.results:
                yield result
                
        except Exception as e:
            print(f"[HAIV] STT 오류: {e}")
            import traceback
            traceback.print_exc()
    
    async def _send_audio(self, audio_path: str):
        """오디오 데이터 전송 - HAIV 스펙"""
        try:
            # [advice from AI] HAIV: byterate/4 바이트씩, 0.25초 간격
            chunk_size = self.config.byterate // 4  # 4000 bytes
            
            with open(audio_path, "rb") as f:
                # WAV 헤더 스킵 (44 bytes)
                f.read(44)
                
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    
                    await self.websocket.send(chunk)
                    
                    if not self.config.norealtime:
                        await asyncio.sleep(0.25)
            
            # [advice from AI] 전송 완료: "EOS" 문자열
            await self.websocket.send("EOS")
            print("[HAIV] EOS 전송")
            
        except Exception as e:
            print(f"[HAIV] 전송 오류: {e}")
    
    async def _receive_results(self, start_offset: float):
        """결과 수신 - HAIV 스펙"""
        try:
            async for message in self.websocket:
                # Progress 메시지
                if isinstance(message, str) and message.startswith("Progress:"):
                    progress = message.split(":", 1)[1].strip()
                    print(f"[HAIV] 진행률: {progress}%")
                    if progress == "100.0":
                        print("[HAIV] 처리 완료")
                    continue
                
                # JSON 결과
                try:
                    response = json.loads(message)
                except json.JSONDecodeError as e:
                    print(f"[HAIV] JSON 오류: {e}")
                    continue
                
                print(f"[HAIV] 응답: {json.dumps(response, ensure_ascii=False)[:200]}")
                
                # [advice from AI] HAIV 응답 파싱
                if 'status' in response and 'result' in response:
                    result = response.get('result', {})
                    
                    if result.get('final'):
                        hypotheses = result.get('hypotheses', [])
                        if hypotheses:
                            transcript = hypotheses[0].get('transcript', '')
                            
                            if transcript.strip():
                                speaker = response.get('speaker')
                                seg_start = response.get('segment-start', 0)
                                seg_length = response.get('segment-length', 0)
                                seg_end = seg_start + seg_length
                                
                                speaker_str = f"화자{speaker}" if speaker is not None else None
                                
                                self.results.append(STTResult(
                                    text=transcript,
                                    start_time=start_offset + seg_start,
                                    end_time=start_offset + seg_end,
                                    speaker=speaker_str,
                                    is_final=True
                                ))
                                
                                print(f"[HAIV] 🎤 인식: {transcript}")
                
                # EOS 응답
                if isinstance(response, dict) and response.get("status") == 0 and response.get("EOS", False):
                    print("[HAIV] EOS 수신")
                    break
                    
        except websockets.ConnectionClosed as e:
            print(f"[HAIV] 연결 종료: {e}")
        except Exception as e:
            print(f"[HAIV] 수신 오류: {e}")


def get_haiv_client() -> HAIVSTTClient:
    """HAIV 클라이언트 인스턴스"""
    config = HAIVConfig(
        host=os.getenv("HAIV_URL", "haiv.timbel.net:40001"),
        project_id=os.getenv("HAIV_PROJECT_ID", "2ec95f1c-3b52-4eaa-a29a-6065e2d95d61"),
        model_name=os.getenv("HAIV_MODEL", "KOREAN_ONLINE_8K"),
        byterate=int(os.getenv("HAIV_BYTERATE", "16000")),
        language=os.getenv("HAIV_LANGUAGE", "ko")
    )
    return HAIVSTTClient(config)
