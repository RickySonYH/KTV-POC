# [advice from AI] 실시간 STT - FFmpeg 스트리밍 + HAIV 병렬 처리
# 실시간 방송처럼 오디오가 나오는 대로 바로 STT 처리

import os
import asyncio
import subprocess
from typing import AsyncGenerator, Optional, Dict, Any
from dataclasses import dataclass


@dataclass
class RealtimeSubtitle:
    """실시간 자막"""
    id: int
    start_time: float
    end_time: float
    text: str
    speaker: Optional[str] = None
    is_final: bool = True


# [advice from AI] HAIV 엔진 프리셋 설정
HAIV_PRESETS: Dict[str, Dict[str, Any]] = {
    # 기존 HAIV (8K)
    "haiv": {
        "host": "haiv.timbel.net:40001",
        "model": "KOREAN_ONLINE_8K",
        "project_id": "2ec95f1c-3b52-4eaa-a29a-6065e2d95d61",
        "byterate": 16000,
        "sample_rate": 16000,
        "name": "HAIV (8K)",
    },
    # 새 HAIV E2E (16K) - 실시간
    "haiv_e2e": {
        "host": "49.50.136.163:40001",
        "model": "KOREAN_ONLINE_16K",
        "project_id": "3ab9f7a5-234b-48e6-a794-cb8f826d0f8e",
        "byterate": 32000,
        "sample_rate": 16000,
        "name": "HAIV E2E (16K)",
    },
    # 새 HAIV Whisper (16K) - 실시간
    "haiv_whisper": {
        "host": "49.50.136.163:40001",
        "model": "KOREAN_16K_OSTT",
        "project_id": "3ab9f7a5-234b-48e6-a794-cb8f826d0f8e",
        "byterate": 32000,
        "sample_rate": 16000,
        "name": "HAIV Whisper (16K)",
    },
}


class HAIVStreamingSTT:
    """
    HAIV 실시간 스트리밍 STT
    - FFmpeg로 오디오를 실시간 추출
    - 추출되는 대로 바로 HAIV로 전송
    - 결과 수신 즉시 yield
    """
    
    def __init__(self, preset: str = "haiv"):
        """
        Args:
            preset: 'haiv', 'haiv_e2e', 'haiv_whisper' 중 선택
        """
        self.segment_id = 0
        
        # [advice from AI] 프리셋 또는 환경변수에서 설정 로드
        if preset in HAIV_PRESETS:
            preset_config = HAIV_PRESETS[preset]
            self.config = {
                'host': os.getenv(f"HAIV_{preset.upper()}_URL", preset_config['host']),
                'model': preset_config['model'],
                'project_id': preset_config['project_id'],
                'byterate': preset_config['byterate'],
                'sample_rate': preset_config['sample_rate'],
                'language': 'ko',
                'num_speaker': None,
                'name': preset_config['name'],
            }
        else:
            # 기본값 (하위 호환성)
            self.config = {
                'host': os.getenv("HAIV_URL", "haiv.timbel.net:40001"),
                'model': os.getenv("HAIV_MODEL", "KOREAN_ONLINE_8K"),
                'project_id': os.getenv("HAIV_PROJECT_ID", "2ec95f1c-3b52-4eaa-a29a-6065e2d95d61"),
                'byterate': int(os.getenv("HAIV_BYTERATE", "16000")),
                'sample_rate': 16000,
                'language': 'ko',
                'num_speaker': None,
                'name': 'HAIV (기본)',
            }
    
    def _build_uri(self, verbosity: str = "final") -> str:
        """HAIV WebSocket URI
        
        Args:
            verbosity: 'final'(문장 완성 후) / 'partial'(실시간 부분 결과)
        """
        uri = f"ws://{self.config['host']}/client/ws/speech"
        uri += f"?model={self.config['model']}"
        if self.config['num_speaker']:
            uri += f"&num-speaker={self.config['num_speaker']}"
        uri += f"&verbosity={verbosity}&lang={self.config['language']}"
        return uri
    
    def get_ws_uri(self, verbosity: str = "final") -> str:
        """외부에서 WebSocket URI 가져오기"""
        return self._build_uri(verbosity=verbosity)
    
    async def process_video(
        self,
        input_path: str,
        enable_diarization: bool = True,
        start_offset: float = 0.0,
        sync_mode: bool = False
    ) -> AsyncGenerator[RealtimeSubtitle, None]:
        """
        영상을 실시간 스트리밍 STT 처리
        - FFmpeg가 오디오를 실시간으로 추출
        - 추출되는 대로 HAIV로 바로 전송
        - 결과 수신 즉시 yield
        
        Args:
            start_offset: 시작 위치 (초) - 영상 재생 위치와 동기화
            sync_mode: True면 영상 재생 속도(1x)에 맞춰 처리
        """
        import websockets
        import json
        
        print(f"[HAIV-STT] ========================================")
        print(f"[HAIV-STT] 🎬 process_video 시작!")
        print(f"[HAIV-STT] 📁 입력 파일: {input_path}")
        print(f"[HAIV-STT] ⏱️ 시작 위치: {start_offset}초")
        print(f"[HAIV-STT] 🔄 동기화 모드: {sync_mode}")
        print(f"[HAIV-STT] 🔧 설정: {self.config}")
        
        # [advice from AI] HAIV는 항상 final (원래 설정 - 건드리지 않음!)
        uri = self._build_uri(verbosity="final")
        print(f"[HAIV-STT] 🔗 WebSocket URI: {uri}")
        
        try:
            async with websockets.connect(uri, ping_interval=20, ping_timeout=60) as ws:
                print(f"[HAIV-STT] ✅ HAIV 연결 성공!")
                
                results_queue = asyncio.Queue()
                send_done = asyncio.Event()
                
                async def stream_audio_to_haiv():
                    """FFmpeg로 실시간 오디오 추출 → HAIV 전송"""
                    # [advice from AI] HAIV는 원본 오디오를 그대로 받음
                    # WAV 형식으로 출력 (헤더 포함)
                    ffmpeg_cmd = ['ffmpeg']
                    
                    # [advice from AI] 시작 위치 지정 (영상 재생과 동기화)
                    if start_offset > 0:
                        ffmpeg_cmd.extend(['-ss', str(start_offset)])
                    
                    ffmpeg_cmd.extend([
                        '-i', input_path,
                        '-vn',                    # 비디오 제외
                        '-acodec', 'pcm_s16le',   # 16bit PCM
                        '-ar', '16000',           # 16kHz (원본 HAIV 클라이언트와 동일)
                        '-ac', '1',               # 모노
                        '-f', 'wav',              # WAV 형식 (헤더 포함!)
                        '-loglevel', 'error',
                        'pipe:1'                  # stdout으로 출력
                    ])
                    
                    print(f"[HAIV-STT] 🎬 FFmpeg 스트리밍 시작: {input_path} (offset: {start_offset}초)")
                    
                    process = await asyncio.create_subprocess_exec(
                        *ffmpeg_cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    
                    # [advice from AI] byterate / 4 = 4000 bytes per chunk (0.25초 분량)
                    chunk_size = self.config['byterate'] // 4  # 4000 bytes
                    total_bytes = 0
                    chunk_count = 0
                    
                    # [advice from AI] 동기화 모드에 따라 전송 속도 조절
                    if sync_mode:
                        # 실시간 모드: 1x 속도 (라이브는 미래 오디오가 없음!)
                        # verbosity=partial로 부분 결과 즉시 출력
                        PREFETCH_CHUNKS = 12  # 3초 프리버퍼
                        CHUNK_DELAY = 0.25    # 1x 속도 (0.25초 청크를 0.25초 간격으로)
                    else:
                        # ⚡ 파일 모드: sleep 없이 최대한 빠르게!
                        PREFETCH_CHUNKS = 9999  # 무제한 프리버퍼
                        CHUNK_DELAY = 0.0       # sleep 없음!
                    
                    try:
                        while True:
                            chunk = await process.stdout.read(chunk_size)
                            if not chunk:
                                break
                            
                            await ws.send(chunk)
                            total_bytes += len(chunk)
                            chunk_count += 1
                            
                            # [advice from AI] 전송 속도 조절
                            if chunk_count <= PREFETCH_CHUNKS:
                                await asyncio.sleep(0.01)  # 프리버퍼: 빠르게
                            else:
                                await asyncio.sleep(CHUNK_DELAY)  # 실시간: 1x 속도
                            
                            if chunk_count % 16 == 0:  # 로그
                                current_time = start_offset + (total_bytes / self.config['byterate'])
                                mode = "프리버퍼" if chunk_count <= PREFETCH_CHUNKS else "실시간"
                                print(f"[HAIV-STT] 📤 [{mode}] 스트리밍: {current_time:.1f}초")
                        
                        # 마지막 EOS 전송 (모든 오디오 전송 완료 후 1번만!)
                        await ws.send("EOS")
                        seconds = total_bytes / self.config['byterate']
                        print(f"[HAIV-STT] 📤 EOS 전송 (총 {seconds:.1f}초 오디오)")
                        
                    except Exception as e:
                        print(f"[HAIV-STT] ❌ 전송 오류: {e}")
                    finally:
                        send_done.set()
                        process.terminate()
                
                async def receive_results():
                    """HAIV 결과 실시간 수신"""
                    import time
                    start_wall_time = time.time()  # 실제 시작 시간
                    print(f"[HAIV-STT] 📥 수신 태스크 시작!")
                    msg_count = 0
                    try:
                        async for message in ws:
                            msg_count += 1
                            
                            # Progress 메시지
                            if isinstance(message, str) and message.startswith("Progress:"):
                                print(f"[HAIV-STT] 📊 Progress: {message}")
                                continue
                            
                            # 메시지 타입 로그
                            if isinstance(message, bytes):
                                print(f"[HAIV-STT] 📦 바이너리 수신: {len(message)} bytes")
                                continue
                            
                            print(f"[HAIV-STT] 📨 메시지 #{msg_count}: {message[:200] if len(message) > 200 else message}")
                            
                            # JSON 결과 파싱
                            try:
                                response = json.loads(message)
                            except json.JSONDecodeError as e:
                                print(f"[HAIV-STT] ❌ JSON 파싱 오류: {e}")
                                continue
                            
                            # 결과 처리
                            if 'status' in response and 'result' in response:
                                result = response.get('result', {})
                                
                                if result.get('final'):
                                    hypotheses = result.get('hypotheses', [])
                                    if hypotheses:
                                        transcript = hypotheses[0].get('transcript', '')
                                        
                                        if transcript.strip():
                                            seg_start = response.get('segment-start', 0)
                                            seg_length = response.get('segment-length', 0)
                                            
                                            # [advice from AI] 처리 속도 측정: 실제 경과시간 vs 오디오 타임스탬프
                                            elapsed = time.time() - start_wall_time
                                            audio_time = seg_start + seg_length
                                            throughput = audio_time / elapsed if elapsed > 0 else 0
                                            print(f"[HAIV-STT] ⏱️ 처리속도: 실시간 {elapsed:.1f}s → 오디오 {audio_time:.1f}s ({throughput:.1f}x)")
                                            
                                            # [advice from AI] 타임스탬프는 HAIV가 반환한 값 그대로 사용
                                            actual_start = start_offset + seg_start
                                            actual_end = start_offset + seg_start + seg_length
                                            
                                            # [advice from AI] HAIV 모델은 화자 분리 없음 - speaker는 항상 None
                                            self.segment_id += 1
                                            subtitle = RealtimeSubtitle(
                                                id=self.segment_id,
                                                start_time=actual_start,
                                                end_time=actual_end,
                                                text=transcript,
                                                speaker=None,
                                                is_final=True
                                            )
                                            
                                            await results_queue.put(subtitle)
                                            print(f"[HAIV-STT] 🎤 [{actual_start:.1f}s] {transcript}")
                            
                            # EOS 응답
                            if isinstance(response, dict) and response.get("EOS"):
                                print(f"[HAIV-STT] 📥 EOS 수신 완료")
                                break
                                
                    except websockets.ConnectionClosed as e:
                        print(f"[HAIV-STT] 연결 종료: {e}")
                    except Exception as e:
                        print(f"[HAIV-STT] 수신 오류: {e}")
                    finally:
                        await results_queue.put(None)  # 종료 신호
                
                # 송신/수신 병렬 실행
                send_task = asyncio.create_task(stream_audio_to_haiv())
                recv_task = asyncio.create_task(receive_results())
                
                # 결과 실시간 yield
                while True:
                    subtitle = await results_queue.get()
                    if subtitle is None:
                        break
                    yield subtitle
                
                # 태스크 완료 대기
                await asyncio.gather(send_task, recv_task, return_exceptions=True)
                
        except Exception as e:
            print(f"[HAIV-STT] ❌ 연결 오류: {e}")
            import traceback
            traceback.print_exc()
        
        print(f"[HAIV-STT] 🏁 완료: 총 {self.segment_id}개 자막")


# [advice from AI] 간편 함수
async def process_video_realtime(
    input_path: str,
    enable_diarization: bool = True,
    start_offset: float = 0.0,
    sync_mode: bool = False
) -> AsyncGenerator[RealtimeSubtitle, None]:
    """
    영상을 실시간 STT로 처리
    
    Args:
        input_path: 영상 파일 경로
        enable_diarization: 화자 분리 (HAIV는 미지원)
        start_offset: 시작 위치 (초) - 영상 재생과 동기화
        sync_mode: True면 영상 재생 속도(1x)에 맞춰 처리
    """
    stt = HAIVStreamingSTT()
    async for subtitle in stt.process_video(
        input_path, 
        enable_diarization,
        start_offset=start_offset,
        sync_mode=sync_mode
    ):
        yield subtitle
