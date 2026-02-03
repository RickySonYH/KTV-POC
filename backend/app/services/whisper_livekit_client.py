# [advice from AI] WhisperLiveKit 클라이언트 (포트 6470)
# 실시간 STT 서버 연동 - 마이크/시스템 오디오 캡처 지원

import os
import asyncio
import json
import subprocess
from typing import AsyncGenerator, Optional
from dataclasses import dataclass
import websockets

from .realtime_stt import RealtimeSubtitle
# [advice from AI] 후처리 모듈 임포트
from .postprocessing import (
    postprocess_text,
    is_hallucination,
    clean_text,
    apply_dictionary_mapping,
)


@dataclass
class WhisperLiveKitConfig:
    """WhisperLiveKit 설정"""
    host: str = "localhost"
    port: int = 8000
    sample_rate: int = 16000


class WhisperLiveKitSTT:
    """
    WhisperLiveKit 클라이언트
    
    API 스펙:
    - WebSocket: ws://<HOST>:<PORT>/asr
    - 오디오: PCM int16, mono, 16kHz
    - 응답: {"lines": [...], "buffer_transcription": "...", "status": "..."}
    """
    
    def __init__(self, config: Optional[WhisperLiveKitConfig] = None):
        self.config = config or WhisperLiveKitConfig(
            host=os.getenv("WHISPER_HOST", "whisper-livekit"),
            port=int(os.getenv("WHISPER_PORT", "8000")),
        )
        self.segment_id = 0
        self.websocket = None
        self.current_audio_time = 0.0
        self.last_lines_count = 0  # 마지막으로 처리한 lines 수
    
    def get_ws_uri(self) -> str:
        """WebSocket URI 생성"""
        return f"ws://{self.config.host}:{self.config.port}/asr"
    
    async def process_audio_stream(
        self,
        input_path: str,
        enable_diarization: bool = True,
        start_offset: float = 0.0,
        sync_mode: bool = False
    ) -> AsyncGenerator[RealtimeSubtitle, None]:
        """
        오디오 파일을 실시간으로 처리하여 자막 생성
        
        Args:
            input_path: 입력 파일 경로 (MP4, WAV 등)
            enable_diarization: 화자 분리 활성화 (WhisperLiveKit은 서버에서 설정)
            start_offset: 시작 위치 (초)
            sync_mode: True면 영상 재생 속도(1x)에 맞춰 처리
        
        Yields:
            RealtimeSubtitle: 실시간 자막
        """
        self.start_offset = start_offset
        uri = self.get_ws_uri()
        
        print(f"[WLK-STT] ========================================")
        print(f"[WLK-STT] 🚀 WhisperLiveKit STT 시작")
        print(f"[WLK-STT] URI: {uri}")
        print(f"[WLK-STT] 입력: {input_path}")
        print(f"[WLK-STT] ⏱️ 시작 위치: {start_offset}초")
        print(f"[WLK-STT] 🔄 동기화 모드: {sync_mode}")
        print(f"[WLK-STT] ========================================")
        
        results_queue = asyncio.Queue()
        send_done = asyncio.Event()
        self.last_lines_count = 0
        
        try:
            print(f"[WLK-STT] 🔌 WebSocket 연결 시도: {uri}")
            async with websockets.connect(
                uri, 
                ping_interval=30, 
                ping_timeout=60, 
                close_timeout=10,
                open_timeout=10
            ) as ws:
                print(f"[WLK-STT] ✅ WebSocket 연결 성공!")
                
                # config 메시지 대기
                try:
                    config_msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                    config_data = json.loads(config_msg)
                    if config_data.get("type") == "config":
                        use_worklet = config_data.get("useAudioWorklet", False)
                        print(f"[WLK-STT] ⚙️ 서버 설정: useAudioWorklet={use_worklet}")
                except asyncio.TimeoutError:
                    print(f"[WLK-STT] ⚠️ config 메시지 없음, 계속 진행")
                except Exception as e:
                    print(f"[WLK-STT] ⚠️ config 파싱 실패: {e}")
                
                async def stream_audio():
                    """FFmpeg로 오디오 추출하여 전송"""
                    nonlocal send_done
                    
                    # PCM 16kHz mono 변환
                    ffmpeg_cmd = [
                        'ffmpeg',
                        '-i', input_path,
                        '-ss', str(start_offset),
                        '-vn',
                        '-acodec', 'pcm_s16le',
                        '-ar', str(self.config.sample_rate),
                        '-ac', '1',
                        '-f', 's16le',
                        '-'
                    ]
                    
                    print(f"[WLK-STT] 🎬 FFmpeg 시작: {' '.join(ffmpeg_cmd[:6])}...")
                    
                    process = await asyncio.create_subprocess_exec(
                        *ffmpeg_cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.DEVNULL
                    )
                    
                    chunk_size = self.config.sample_rate * 2 // 10  # 100ms 청크
                    bytes_sent = 0
                    
                    try:
                        while True:
                            chunk = await process.stdout.read(chunk_size)
                            if not chunk:
                                break
                            
                            await ws.send(chunk)
                            bytes_sent += len(chunk)
                            
                            # 오디오 시간 계산
                            self.current_audio_time = start_offset + (bytes_sent / (self.config.sample_rate * 2))
                            
                            # 동기화 모드면 실시간 속도로
                            if sync_mode:
                                await asyncio.sleep(0.1)
                            else:
                                await asyncio.sleep(0.01)
                        
                        # 종료 시그널 (빈 Blob)
                        await ws.send(b'')
                        print(f"[WLK-STT] 📤 전송 완료: {bytes_sent / 1024:.1f}KB")
                        
                    except Exception as e:
                        print(f"[WLK-STT] ❌ 전송 오류: {e}")
                    finally:
                        send_done.set()
                        if process.returncode is None:
                            process.kill()
                
                async def receive_results():
                    """서버 응답 수신"""
                    nonlocal send_done
                    
                    try:
                        while True:
                            try:
                                msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
                                data = json.loads(msg)
                                
                                # ready_to_stop 처리
                                if data.get("type") == "ready_to_stop":
                                    print(f"[WLK-STT] 🏁 처리 완료 신호 수신")
                                    break
                                
                                # config 무시
                                if data.get("type") == "config":
                                    continue
                                
                                # 자막 처리
                                lines = data.get("lines", [])
                                buffer_text = data.get("buffer_transcription", "")
                                status = data.get("status", "active_transcription")
                                
                                # 새로운 lines만 처리
                                for i, line in enumerate(lines):
                                    if i >= self.last_lines_count:
                                        raw_text = line.get("text", "").strip()
                                        
                                        # [advice from AI] 후처리 적용
                                        # 1. 할루시네이션 필터
                                        if is_hallucination(raw_text):
                                            print(f"[WLK-STT] 🚫 할루시네이션 필터: {raw_text[:30]}...")
                                            continue
                                        
                                        # 2. 후처리 (정리 + 사전 매칭 + 비속어 필터)
                                        processed_text = postprocess_text(raw_text)
                                        
                                        if not processed_text:
                                            continue
                                        
                                        self.segment_id += 1
                                        
                                        # [advice from AI] 타임스탬프를 float로 변환 (문자열일 수 있음)
                                        start_time_val = line.get("start", self.current_audio_time)
                                        end_time_val = line.get("end", self.current_audio_time + 3.0)
                                        try:
                                            start_time_float = float(start_time_val) if start_time_val is not None else self.current_audio_time
                                            end_time_float = float(end_time_val) if end_time_val is not None else (self.current_audio_time + 3.0)
                                        except (ValueError, TypeError):
                                            start_time_float = self.current_audio_time
                                            end_time_float = self.current_audio_time + 3.0
                                        
                                        subtitle = RealtimeSubtitle(
                                            id=self.segment_id,
                                            start_time=start_time_float,
                                            end_time=end_time_float,
                                            text=processed_text,
                                            speaker=f"화자{line.get('speaker', 1)}" if line.get("speaker", 0) > 0 else None,
                                            is_final=True
                                        )
                                        
                                        if subtitle.text:
                                            await results_queue.put(subtitle)
                                            print(f"[WLK-STT] 🎤 [{subtitle.start_time:.1f}s] {subtitle.text[:40]}...")
                                
                                self.last_lines_count = len(lines)
                                
                                # 버퍼 텍스트도 중간 결과로 전송 (선택적)
                                if buffer_text and buffer_text.strip():
                                    self.segment_id += 1
                                    buffer_subtitle = RealtimeSubtitle(
                                        id=self.segment_id,
                                        start_time=self.current_audio_time,
                                        end_time=self.current_audio_time + 2.0,
                                        text=buffer_text.strip(),
                                        speaker=None,
                                        is_final=False
                                    )
                                    # 중간 결과는 선택적으로 전송
                                    # await results_queue.put(buffer_subtitle)
                                
                            except asyncio.TimeoutError:
                                if send_done.is_set():
                                    break
                                continue
                                
                    except websockets.exceptions.ConnectionClosed:
                        print(f"[WLK-STT] 🔌 WebSocket 연결 종료")
                    except Exception as e:
                        print(f"[WLK-STT] ❌ 수신 오류: {e}")
                    
                    await results_queue.put(None)  # 종료 신호
                
                # 송수신 태스크 시작
                send_task = asyncio.create_task(stream_audio())
                recv_task = asyncio.create_task(receive_results())
                
                # 결과 yield
                while True:
                    result = await results_queue.get()
                    if result is None:
                        break
                    yield result
                
                # 정리
                await send_task
                await recv_task
                
        except ConnectionRefusedError:
            # [advice from AI] websockets.exceptions.ConnectionRefusedError 대신 표준 예외 사용
            print(f"[WLK-STT] ❌ 연결 거부됨: {uri}")
            print(f"[WLK-STT] WhisperLiveKit 서버가 실행 중인지 확인하세요")
        except Exception as e:
            print(f"[WLK-STT] ❌ 오류: {e}")
        
        print(f"[WLK-STT] 🏁 STT 종료")
