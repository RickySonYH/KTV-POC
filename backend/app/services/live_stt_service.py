# [advice from AI] 라이브 실시간 STT 서비스
# 프론트엔드에서 Web Audio API로 추출한 오디오를 실시간으로 처리

import os
import asyncio
import json
from typing import Optional, Callable, Awaitable
from dataclasses import dataclass
import websockets
from fastapi import WebSocket

from .realtime_stt import RealtimeSubtitle


@dataclass
class LiveSTTConfig:
    """라이브 STT 설정"""
    stt_engine: str = "whisper"  # haiv 또는 whisper
    language: str = "ko"
    sample_rate: int = 16000
    enable_diarization: bool = True


class LiveSTTService:
    """
    라이브 실시간 STT 서비스
    
    프론트엔드에서 Web Audio API로 추출한 PCM 오디오를 받아서
    STT 서버로 전달하고 결과를 반환
    """
    
    def __init__(self, config: Optional[LiveSTTConfig] = None):
        self.config = config or LiveSTTConfig()
        self.segment_id = 0
        self.stt_ws: Optional[websockets.WebSocketClientProtocol] = None
        self.is_running = False
        self.current_speaker_id = 0
        
    def get_stt_uri(self) -> str:
        """STT 서버 URI 생성"""
        if self.config.stt_engine == "whisper":
            host = os.getenv("WHISPER_HOST", "localhost")
            port = os.getenv("WHISPER_PORT", "6470")
            return (
                f"ws://{host}:{port}/api/v1/stream"
                f"?lang={self.config.language}"
                f"&sample_rate={self.config.sample_rate}"
                f"&speaker_change={'true' if self.config.enable_diarization else 'false'}"
            )
        else:  # HAIV
            host = os.getenv("HAIV_URL", "haiv.timbel.net:40001")
            model = os.getenv("HAIV_MODEL", "KOREAN_ONLINE_8K")
            project_id = os.getenv("HAIV_PROJECT_ID", "2ec95f1c-3b52-4eaa-a29a-6065e2d95d61")
            # [advice from AI] HAIV 필수 파라미터: project, verbosity=final
            return f"ws://{host}/client/ws/speech?model={model}&project={project_id}&verbosity=final&lang=ko"
    
    async def process_live_stream(
        self,
        client_ws: WebSocket,
        on_subtitle: Optional[Callable[[RealtimeSubtitle], Awaitable[None]]] = None
    ):
        """
        라이브 오디오 스트림 처리
        
        Args:
            client_ws: 프론트엔드 WebSocket 연결
            on_subtitle: 자막 생성 시 콜백
        """
        stt_uri = self.get_stt_uri()
        print(f"[LIVE-STT] ========================================")
        print(f"[LIVE-STT] 🚀 라이브 STT 시작")
        print(f"[LIVE-STT] 엔진: {self.config.stt_engine}")
        print(f"[LIVE-STT] URI: {stt_uri}")
        print(f"[LIVE-STT] ========================================")
        
        self.is_running = True
        self.segment_id = 0
        
        try:
            async with websockets.connect(stt_uri, ping_interval=30, ping_timeout=60) as stt_ws:
                self.stt_ws = stt_ws
                print(f"[LIVE-STT] ✅ STT 서버 연결 성공!")
                
                # 클라이언트에 연결 성공 알림
                await client_ws.send_json({
                    "type": "connected",
                    "data": {"engine": self.config.stt_engine}
                })
                
                # 수신 태스크: STT 결과 → 클라이언트
                async def receive_from_stt():
                    """STT 서버에서 결과 수신"""
                    msg_count = 0
                    try:
                        async for message in stt_ws:
                            if not self.is_running:
                                break
                            
                            msg_count += 1
                            
                            try:
                                # [advice from AI] 디버그: 원본 메시지 확인
                                if msg_count <= 5 or msg_count % 10 == 0:
                                    print(f"[LIVE-STT] 📩 메시지 #{msg_count}: {str(message)[:200]}")
                                
                                response = json.loads(message)
                                subtitle = self._parse_stt_response(response)
                                
                                if subtitle:
                                    # 콜백 호출
                                    if on_subtitle:
                                        await on_subtitle(subtitle)
                                    
                                    # 클라이언트에 자막 전송
                                    await client_ws.send_json({
                                        "type": "subtitle",
                                        "data": {
                                            "id": subtitle.id,
                                            "text": subtitle.text,
                                            "speaker": subtitle.speaker,
                                            "is_final": subtitle.is_final
                                        }
                                    })
                                    print(f"[LIVE-STT] 🎤 {subtitle.speaker or ''}: {subtitle.text}")
                                
                                # 완료 확인
                                if response.get("type") == "final" or response.get("EOS"):
                                    print(f"[LIVE-STT] 📥 STT 완료")
                                    break
                                    
                            except json.JSONDecodeError as e:
                                print(f"[LIVE-STT] ⚠️ JSON 파싱 오류: {e}, 메시지: {str(message)[:100]}")
                    except Exception as e:
                        print(f"[LIVE-STT] ❌ STT 수신 오류: {e}")
                    finally:
                        print(f"[LIVE-STT] 📬 총 {msg_count}개 메시지 수신")
                
                # 전송 태스크: 클라이언트 오디오 → STT
                async def send_to_stt():
                    """클라이언트에서 오디오 수신하여 STT로 전달"""
                    chunk_count = 0
                    audio_buffer = bytearray()  # 오디오 버퍼 (청크 크기 맞추기용)
                    HAIV_CHUNK_SIZE = 4000  # HAIV 예상 청크 크기 (byterate/4)
                    
                    try:
                        while self.is_running:
                            try:
                                # 클라이언트에서 오디오 데이터 수신
                                data = await asyncio.wait_for(
                                    client_ws.receive(),
                                    timeout=30.0
                                )
                                
                                if "bytes" in data:
                                    # 바이너리 오디오 데이터
                                    audio_chunk = data["bytes"]
                                    
                                    # [advice from AI] HAIV: 청크 크기를 맞춰서 전송
                                    if self.config.stt_engine == "haiv":
                                        audio_buffer.extend(audio_chunk)
                                        
                                        # 버퍼가 충분히 쌓이면 전송
                                        while len(audio_buffer) >= HAIV_CHUNK_SIZE:
                                            chunk_to_send = bytes(audio_buffer[:HAIV_CHUNK_SIZE])
                                            audio_buffer = audio_buffer[HAIV_CHUNK_SIZE:]
                                            await stt_ws.send(chunk_to_send)
                                            chunk_count += 1
                                    else:
                                        # Whisper: 그대로 전송
                                        await stt_ws.send(audio_chunk)
                                        chunk_count += 1
                                    
                                    if chunk_count % 16 == 0:  # 로그
                                        print(f"[LIVE-STT] 📤 {chunk_count}개 청크 전송")
                                        
                                elif "text" in data:
                                    # 텍스트 메시지 (제어 명령)
                                    msg = json.loads(data["text"])
                                    
                                    if msg.get("type") == "stop":
                                        print(f"[LIVE-STT] 🛑 클라이언트 중지 요청")
                                        await stt_ws.send("EOS")
                                        break
                                        
                            except asyncio.TimeoutError:
                                # 타임아웃 - 연결 유지
                                continue
                                
                    except Exception as e:
                        print(f"[LIVE-STT] ❌ 오디오 전송 오류: {e}")
                    finally:
                        # [advice from AI] 남은 버퍼 전송 (HAIV)
                        if self.config.stt_engine == "haiv" and len(audio_buffer) > 0:
                            try:
                                await stt_ws.send(bytes(audio_buffer))
                                chunk_count += 1
                            except:
                                pass
                        
                        # EOS 전송
                        try:
                            await stt_ws.send("EOS")
                            print(f"[LIVE-STT] 📤 EOS 전송")
                        except:
                            pass
                        print(f"[LIVE-STT] 📤 총 {chunk_count}개 청크 전송 완료")
                
                # 병렬 실행
                await asyncio.gather(
                    receive_from_stt(),
                    send_to_stt(),
                    return_exceptions=True
                )
                
        except websockets.exceptions.WebSocketException as e:
            print(f"[LIVE-STT] ❌ STT 연결 오류: {e}")
            await client_ws.send_json({
                "type": "error",
                "data": {"message": f"STT 서버 연결 실패: {str(e)}"}
            })
        except Exception as e:
            print(f"[LIVE-STT] ❌ 오류: {e}")
            import traceback
            traceback.print_exc()
        finally:
            self.is_running = False
            self.stt_ws = None
            print(f"[LIVE-STT] ✅ 라이브 STT 종료")
    
    def _parse_stt_response(self, response: dict) -> Optional[RealtimeSubtitle]:
        """STT 응답 파싱"""
        if self.config.stt_engine == "whisper":
            return self._parse_whisper_response(response)
        else:
            return self._parse_haiv_response(response)
    
    def _parse_whisper_response(self, response: dict) -> Optional[RealtimeSubtitle]:
        """Whisper (WSTT) 응답 파싱"""
        if response.get("type") != "segment":
            return None
        
        text = response.get("text", "").strip()
        if not text:
            return None
        
        self.segment_id += 1
        
        # 화자 정보
        speaker_id = response.get("speaker_id", 0)
        speaker_changed = response.get("speaker_changed", False)
        
        if speaker_changed:
            self.current_speaker_id = speaker_id
        
        speaker_str = f"화자{self.current_speaker_id + 1}" if self.config.enable_diarization else None
        
        return RealtimeSubtitle(
            id=self.segment_id,
            start_time=0,  # 라이브에서는 시간 불필요
            end_time=0,
            text=text,
            speaker=speaker_str,
            is_final=True
        )
    
    def _parse_haiv_response(self, response: dict) -> Optional[RealtimeSubtitle]:
        """HAIV 응답 파싱"""
        if response.get("status") != 0:
            return None
        
        result = response.get("result", {})
        hypotheses = result.get("hypotheses", [])
        
        if not hypotheses:
            return None
        
        transcript = hypotheses[0].get("transcript", "").strip()
        if not transcript:
            return None
        
        self.segment_id += 1
        
        return RealtimeSubtitle(
            id=self.segment_id,
            start_time=0,
            end_time=0,
            text=transcript,
            speaker=None,  # HAIV는 화자 분리 없음
            is_final=True
        )
    
    async def stop(self):
        """STT 중지"""
        self.is_running = False
        if self.stt_ws:
            try:
                await self.stt_ws.send("EOS")
                await self.stt_ws.close()
            except:
                pass
