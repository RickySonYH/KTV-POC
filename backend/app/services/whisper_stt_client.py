# [advice from AI] Whisper 기반 STT 클라이언트 (WSTT API - 포트 6470)
# 화자 분리 지원, 실시간 스트리밍

import os
import asyncio
import json
from typing import AsyncGenerator, Optional
from dataclasses import dataclass
import websockets

from .realtime_stt import RealtimeSubtitle


@dataclass
class WhisperConfig:
    """Whisper STT 설정 (STT-Full-Service API)"""
    host: str = "localhost"
    port: int = 6470
    language: str = "ko"
    sample_rate: int = 16000
    model: str = "KOREAN_16K"  # KOREAN_8K, KOREAN_16K, KOREAN_32K


class WhisperStreamingSTT:
    """
    STT-Full-Service 클라이언트 (포트 6470)
    
    API 스펙:
    - WebSocket: ws://<HOST>:6470/client/ws/speech?model=KOREAN_16K&lang=ko
    - 오디오: PCM int16, mono
    - 종료: "EOS" 문자열 전송
    - 응답: {"text": "...", "final": true}
    - 화자 변경: 텍스트에 줄바꿈(\n) 삽입
    """
    
    def __init__(self, config: Optional[WhisperConfig] = None):
        self.config = config or WhisperConfig(
            host=os.getenv("WHISPER_HOST", "localhost"),
            port=int(os.getenv("WHISPER_PORT", "6470")),
        )
        self.segment_id = 0
        self.websocket = None
        self.current_audio_time = 0.0  # 현재 스트리밍 오디오 시간
    
    def get_ws_uri(self) -> str:
        """WebSocket URI 생성 (새 API 스펙)"""
        return (
            f"ws://{self.config.host}:{self.config.port}/client/ws/speech"
            f"?model={self.config.model}"
            f"&lang={self.config.language}"
        )
    
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
            enable_diarization: 화자 분리 활성화
            start_offset: 시작 위치 (초) - 영상 재생과 동기화
            sync_mode: True면 영상 재생 속도(1x)에 맞춰 처리
        
        Yields:
            RealtimeSubtitle: 실시간 자막
        """
        self.start_offset = start_offset  # 저장
        uri = self.get_ws_uri()
        
        print(f"[WHISPER-STT] ========================================")
        print(f"[WHISPER-STT] 🚀 Whisper STT 시작")
        print(f"[WHISPER-STT] URI: {uri}")
        print(f"[WHISPER-STT] 입력: {input_path}")
        print(f"[WHISPER-STT] ⏱️ 시작 위치: {start_offset}초")
        print(f"[WHISPER-STT] 🔄 동기화 모드: {sync_mode}")
        print(f"[WHISPER-STT] 화자분리: {enable_diarization}")
        print(f"[WHISPER-STT] ========================================")
        
        results_queue = asyncio.Queue()
        send_done = asyncio.Event()
        
        try:
            print(f"[WHISPER-STT] 🔌 WebSocket 연결 시도: {uri}")
            # [advice from AI] 연결 타임아웃 10초 (open_timeout 사용)
            async with websockets.connect(
                uri, 
                ping_interval=30, 
                ping_timeout=60, 
                close_timeout=10,
                open_timeout=10  # 연결 타임아웃
            ) as ws:
                print(f"[WHISPER-STT] ✅ WebSocket 연결 성공!")
                
                async def stream_audio_to_whisper():
                    """FFmpeg로 오디오 추출하여 Whisper로 전송"""
                    ffmpeg_cmd = ["ffmpeg"]
                    
                    # [advice from AI] 시작 위치 지정 (영상 재생과 동기화)
                    if start_offset > 0:
                        ffmpeg_cmd.extend(["-ss", str(start_offset)])
                    
                    ffmpeg_cmd.extend([
                        "-i", input_path,
                        "-vn",
                        "-acodec", "pcm_s16le",
                        "-ar", str(self.config.sample_rate),
                        "-ac", "1",
                        "-f", "s16le",  # Raw PCM
                        "-loglevel", "error",
                        "pipe:1"
                    ])
                    
                    print(f"[WHISPER-STT] 🎬 FFmpeg 시작 (offset: {start_offset}초)")
                    
                    process = await asyncio.create_subprocess_exec(
                        *ffmpeg_cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    
                    # [advice from AI] 청크 크기: 8000 bytes = 0.25초 @ 16kHz
                    chunk_size = 8000
                    total_bytes = 0
                    chunk_count = 0
                    self.current_audio_time = start_offset  # 시작 위치부터
                    
                    # [advice from AI] 동기화 모드에 따라 전송 속도 조절
                    if sync_mode:
                        # 실시간 모드: 1.5x 속도로 빠르게 전송 (2초 지연 목표)
                        PREFETCH_CHUNKS = 16  # 4초 프리버퍼
                        CHUNK_DELAY = 0.167   # 1.5x 속도 (0.25초 청크를 0.167초마다)
                    else:
                        # 파일 모드: 최대 속도로 처리
                        PREFETCH_CHUNKS = 40  # 10초 프리버퍼
                        CHUNK_DELAY = 0.05    # 5x 속도
                    
                    try:
                        while True:
                            chunk = await process.stdout.read(chunk_size)
                            if not chunk:
                                break
                            
                            await ws.send(chunk)
                            total_bytes += len(chunk)
                            chunk_count += 1
                            
                            # [advice from AI] 현재 오디오 시간 업데이트
                            self.current_audio_time = start_offset + (total_bytes / (self.config.sample_rate * 2))
                            
                            # [advice from AI] 전송 속도 조절
                            if chunk_count <= PREFETCH_CHUNKS:
                                await asyncio.sleep(0.01)  # 프리버퍼: 빠르게
                            else:
                                await asyncio.sleep(CHUNK_DELAY)  # 실시간: 1x 속도
                            
                            if chunk_count % 16 == 0:
                                seconds = self.current_audio_time
                                mode = "프리버퍼" if chunk_count <= PREFETCH_CHUNKS else "실시간"
                                print(f"[WHISPER-STT] 📤 [{mode}] 스트리밍: {seconds:.1f}초")
                        
                        # 마지막 EOS 전송 (모든 오디오 전송 완료 후 1번만!)
                        await ws.send("EOS")
                        seconds = total_bytes / (self.config.sample_rate * 2)
                        print(f"[WHISPER-STT] 📤 EOS 전송 (총 {seconds:.1f}초 오디오)")
                        
                    except Exception as e:
                        print(f"[WHISPER-STT] ❌ 전송 오류: {e}")
                    finally:
                        send_done.set()
                        process.terminate()
                
                async def receive_results():
                    """STT-Full-Service 결과 수신 (실시간 세그먼트 스트리밍)"""
                    import time
                    start_wall_time = time.time()  # 실제 시작 시간
                    print(f"[WHISPER-STT] 📥 수신 태스크 시작!")
                    msg_count = 0
                    current_speaker = 1
                    
                    try:
                        async for message in ws:
                            msg_count += 1
                            
                            # [advice from AI] 디버깅: 모든 메시지 출력
                            print(f"[WHISPER-STT] 📨 RAW 메시지 #{msg_count}: {str(message)[:200]}")
                            
                            try:
                                response = json.loads(message)
                                msg_type = response.get("type", "")
                                is_final = response.get("final", False)
                                
                                # [advice from AI] 디버깅: 파싱된 메시지 타입
                                print(f"[WHISPER-STT] 📋 파싱 결과: type={msg_type}, final={is_final}, keys={list(response.keys())}")
                                
                                # [advice from AI] 새 API: type으로 메시지 구분
                                # type: "segment" → 실시간 중간 결과 (발화마다)
                                # type: "final" → 최종 결과 (EOS 후)
                                
                                if msg_type == "segment":
                                    # ⚡ 실시간 세그먼트! (HAIV와 동일한 구조)
                                    text = response.get("text", "").strip()
                                    if not text:
                                        continue
                                    
                                    self.segment_id += 1
                                    
                                    seg_start = response.get("start", 0)
                                    seg_end = response.get("end", seg_start + 3)
                                    # [advice from AI] 타임스탬프가 너무 짧으면 최소 3초로 보정
                                    if seg_end - seg_start < 1.0:
                                        seg_end = seg_start + 3.0
                                    actual_start = start_offset + seg_start
                                    actual_end = start_offset + seg_end
                                    
                                    # 처리 속도 측정
                                    elapsed = time.time() - start_wall_time
                                    throughput = seg_end / elapsed if elapsed > 0 else 0
                                    print(f"[WHISPER-STT] ⏱️ 처리속도: 실시간 {elapsed:.1f}s → 오디오 {seg_end:.1f}s ({throughput:.1f}x)")
                                    
                                    # 화자 변경 처리
                                    if response.get("speaker_changed", False):
                                        current_speaker = 2 if current_speaker == 1 else 1
                                    
                                    speaker_str = f"화자{current_speaker}" if enable_diarization else None
                                    
                                    # [advice from AI] Whisper segment 결과도 최종 결과로 처리
                                    # 프론트엔드에서 캐시 기반으로 동작하려면 is_final=True 필요
                                    subtitle = RealtimeSubtitle(
                                        id=self.segment_id,
                                        start_time=actual_start,
                                        end_time=actual_end,
                                        text=text,
                                        speaker=speaker_str,
                                        is_final=True  # 항상 True로 설정 (캐시에 저장됨)
                                    )
                                    
                                    await results_queue.put(subtitle)
                                    print(f"[WHISPER-STT] 🎤 [{actual_start:.1f}s~{actual_end:.1f}s] {speaker_str or ''}: {text[:40]}...")
                                
                                elif msg_type == "final" or is_final:
                                    # 최종 결과 (EOS 후) - segments 배열 처리
                                    segments = response.get("segments", [])
                                    
                                    if segments:
                                        for seg in segments:
                                            text = seg.get("text", "").strip()
                                            if not text:
                                                continue
                                            
                                            self.segment_id += 1
                                            
                                            seg_start = seg.get("start", 0)
                                            seg_end = seg.get("end", seg_start + 3)
                                            # [advice from AI] 타임스탬프가 너무 짧으면 최소 3초로 보정
                                            if seg_end - seg_start < 1.0:
                                                seg_end = seg_start + 3.0
                                            actual_start = start_offset + seg_start
                                            actual_end = start_offset + seg_end
                                            
                                            if seg.get("speaker_changed", False):
                                                current_speaker = 2 if current_speaker == 1 else 1
                                            
                                            speaker_str = f"화자{current_speaker}" if enable_diarization else None
                                            
                                            subtitle = RealtimeSubtitle(
                                                id=self.segment_id,
                                                start_time=actual_start,
                                                end_time=actual_end,
                                                text=text,
                                                speaker=speaker_str,
                                                is_final=True
                                            )
                                            
                                            await results_queue.put(subtitle)
                                            print(f"[WHISPER-STT] 🎤 [FINAL] [{actual_start:.1f}s~{actual_end:.1f}s] {text[:40]}...")
                                    else:
                                        # segments 없으면 text로 폴백
                                        text = response.get("text", "").strip()
                                        if text:
                                            for line in text.split('\n'):
                                                line = line.strip()
                                                if not line:
                                                    continue
                                                
                                                self.segment_id += 1
                                                rel_start = max(0, self.current_audio_time - 3.0)
                                                rel_end = rel_start + 3
                                                
                                                subtitle = RealtimeSubtitle(
                                                    id=self.segment_id,
                                                    start_time=rel_start,
                                                    end_time=rel_end,
                                                    text=line,
                                                    speaker=None,
                                                    is_final=True
                                                )
                                                
                                                await results_queue.put(subtitle)
                                                print(f"[WHISPER-STT] 🎤 [폴백] [{rel_start:.1f}s] {line[:40]}...")
                                    
                                    print(f"[WHISPER-STT] ✅ 최종 결과 수신 완료!")
                                
                            except json.JSONDecodeError:
                                print(f"[WHISPER-STT] ⚠️ JSON 파싱 실패: {message[:100]}")
                    
                    except websockets.ConnectionClosed as e:
                        print(f"[WHISPER-STT] 연결 종료: {e}")
                    except Exception as e:
                        print(f"[WHISPER-STT] 수신 오류: {e}")
                    finally:
                        await results_queue.put(None)  # 종료 신호
                
                # 송신/수신 병렬 실행
                send_task = asyncio.create_task(stream_audio_to_whisper())
                recv_task = asyncio.create_task(receive_results())
                
                # 결과 실시간 yield
                while True:
                    subtitle = await results_queue.get()
                    if subtitle is None:
                        break
                    yield subtitle
                
                # 태스크 정리
                await send_task
                recv_task.cancel()
                
                print(f"[WHISPER-STT] ✅ 처리 완료! 총 {self.segment_id}개 자막")
        
        except asyncio.TimeoutError:
            print(f"[WHISPER-STT] ❌ 연결 타임아웃! Whisper 서버({self.config['host']})가 응답하지 않습니다.")
        except websockets.exceptions.WebSocketException as e:
            print(f"[WHISPER-STT] ❌ WebSocket 오류: {e}")
        except ConnectionRefusedError:
            print(f"[WHISPER-STT] ❌ 연결 거부! Whisper 서버({self.config['host']})가 실행 중인지 확인하세요.")
        except Exception as e:
            print(f"[WHISPER-STT] ❌ 오류: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # 상태 초기화
            if hasattr(self, 'base_time'):
                delattr(self, 'base_time')


# [advice from AI] 편의 함수
async def process_video_with_whisper(
    input_path: str,
    enable_diarization: bool = True,
    start_offset: float = 0.0,
    sync_mode: bool = False
) -> AsyncGenerator[RealtimeSubtitle, None]:
    """
    Whisper STT로 영상 처리
    
    Args:
        input_path: 입력 파일 경로
        enable_diarization: 화자 분리 활성화
        start_offset: 시작 위치 (초) - 영상 재생과 동기화
        sync_mode: True면 영상 재생 속도(1x)에 맞춰 처리
    
    Yields:
        RealtimeSubtitle: 실시간 자막
    """
    client = WhisperStreamingSTT()
    async for subtitle in client.process_audio_stream(
        input_path, 
        enable_diarization, 
        start_offset=start_offset, 
        sync_mode=sync_mode
    ):
        yield subtitle
