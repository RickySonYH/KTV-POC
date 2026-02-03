# [advice from AI] 초저지연 실시간 STT API - 2초 이내 문장 단위

import os
import asyncio
import aiofiles
from fastapi import APIRouter, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect, Query, Request
from fastapi.responses import StreamingResponse, Response
import httpx
from typing import Optional
import json
import time

from ..services.realtime_stt import (
    HAIVStreamingSTT,
    process_video_realtime,
    RealtimeSubtitle
)
from ..services.whisper_stt_client import (
    WhisperStreamingSTT,
    process_video_with_whisper
)
# [advice from AI] WhisperLiveKit 클라이언트 추가 - 로컬 Whisper 대체
from ..services.whisper_livekit_client import (
    WhisperLiveKitSTT,
    WhisperLiveKitConfig
)
from ..services.realtime_pipeline import (
    RealtimeSTTPipeline,
    stream_process_video,
    StreamEvent,
    StreamEventType
)
from ..services.audio_extractor import audio_extractor

# [advice from AI] STT 엔진 타입
from enum import Enum

# [advice from AI] STT 엔진 종류 확장 - HAIV E2E, HAIV Whisper 추가
class STTEngine(str, Enum):
    HAIV = "haiv"              # 기존 HAIV (8K)
    WHISPER = "whisper"        # 로컬 Whisper (STT-Full-Service)
    HAIV_E2E = "haiv_e2e"      # 새 HAIV E2E (16K)
    HAIV_WHISPER = "haiv_whisper"  # 새 HAIV Whisper (16K)

router = APIRouter(prefix="/api/realtime", tags=["realtime"])

# [advice from AI] 업로드 디렉토리
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/tmp/ktv-uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/reset-whisper")
async def reset_whisper_stt():
    """
    🔄 Whisper STT 서비스 초기화
    
    STT-Full-Service 컨테이너를 재시작하여 불안정한 상태를 초기화합니다.
    """
    import subprocess
    
    print("[ROUTER] 🔄 Whisper STT 초기화 요청")
    
    try:
        # [advice from AI] Docker 명령어로 STT 컨테이너 재시작
        result = subprocess.run(
            ["docker", "restart", "stt-full-service"],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode == 0:
            print("[ROUTER] ✅ Whisper STT 재시작 성공!")
            # 모델 로드 대기 (10초)
            await asyncio.sleep(10)
            return {
                "success": True,
                "message": "Whisper STT 서비스가 재시작되었습니다. 약 30초 후 사용 가능합니다."
            }
        else:
            print(f"[ROUTER] ❌ 재시작 실패: {result.stderr}")
            return {
                "success": False,
                "message": f"재시작 실패: {result.stderr}"
            }
    
    except subprocess.TimeoutExpired:
        print("[ROUTER] ❌ 재시작 타임아웃")
        return {
            "success": False,
            "message": "재시작 타임아웃 (30초 초과)"
        }
    except Exception as e:
        print(f"[ROUTER] ❌ 오류: {e}")
        return {
            "success": False,
            "message": str(e)
        }


def subtitle_to_sse(subtitle: RealtimeSubtitle) -> str:
    """자막을 SSE 형식으로 변환"""
    data = {
        "type": "subtitle",
        "data": {
            "id": subtitle.id,
            "start_time": subtitle.start_time,
            "end_time": subtitle.end_time,
            "text": subtitle.text,
            "speaker": subtitle.speaker,
            "is_final": subtitle.is_final,
            "timestamp": time.time()
        }
    }
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/ultra")
async def ultra_realtime_stream(
    file: UploadFile = File(...),
    enable_diarization: bool = True,
    stt_engine: STTEngine = STTEngine.HAIV,
    start_offset: float = 0.0,
    sync_mode: bool = True
):
    """
    🔴 초저지연 실시간 STT (2초 이내 문장 단위)
    
    - **file**: 동영상 파일
    - **enable_diarization**: 화자 분리 활성화
    - **stt_engine**: STT 엔진 선택 (haiv, whisper)
    - **start_offset**: 시작 위치 (초) - 영상 재생과 동기화
    - **sync_mode**: True면 영상 재생 속도(1x)에 맞춰 처리
    
    각 문장이 생성될 때마다 즉시 SSE로 전송됩니다.
    """
    
    # [LOG] 요청 수신
    print(f"[ROUTER] 📥 /api/realtime/ultra 요청 수신: {file.filename}, diarization={enable_diarization}, engine={stt_engine}")
    
    # [advice from AI] 파일 형식 검증
    allowed_extensions = {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"}
    file_ext = os.path.splitext(file.filename)[1].lower()
    
    if file_ext not in allowed_extensions:
        print(f"[ROUTER] ❌ 지원하지 않는 파일 형식: {file_ext}")
        raise HTTPException(
            status_code=400,
            detail=f"지원하지 않는 파일 형식입니다."
        )
    
    # [advice from AI] 파일 저장
    temp_file_path = os.path.join(UPLOAD_DIR, f"ultra_{os.urandom(8).hex()}{file_ext}")
    
    print(f"[ROUTER] 📁 파일 저장 시작: {temp_file_path}")
    async with aiofiles.open(temp_file_path, "wb") as f:
        content = await file.read()
        await f.write(content)
    print(f"[ROUTER] ✅ 파일 저장 완료: {len(content)} bytes")
    
    async def ultra_event_generator():
        """초저지연 SSE 이벤트 생성기"""
        start_time = time.time()
        subtitle_count = 0
        
        try:
            # 초기화 이벤트
            print(f"[ROUTER] 🎬 영상 길이 확인 중...")
            duration = audio_extractor.get_duration(temp_file_path)
            print(f"[ROUTER] 📊 영상 길이: {duration}초")
            yield f"data: {json.dumps({'type': 'init', 'data': {'duration': duration, 'mode': 'ultra_realtime', 'engine': stt_engine.value}}, ensure_ascii=False)}\n\n"
            
            # [advice from AI] 선택된 엔진으로 실시간 처리 시작
            print(f"[ROUTER] 🚀 {stt_engine.value.upper()} STT 시작! (offset: {start_offset}초, sync: {sync_mode})")
            
            if stt_engine == STTEngine.WHISPER:
                # [advice from AI] WhisperLiveKit 기반 STT (로컬 Whisper 대체)
                stt = WhisperLiveKitSTT()
                stt_generator = stt.process_audio_stream(
                    input_path=temp_file_path,
                    enable_diarization=enable_diarization,
                    start_offset=start_offset,
                    sync_mode=sync_mode
                )
            elif stt_engine == STTEngine.HAIV_E2E:
                # [advice from AI] 새 HAIV E2E (16K) 실시간
                from ..services.realtime_stt import HAIVStreamingSTT
                stt = HAIVStreamingSTT(preset="haiv_e2e")
                stt_generator = stt.process_video(
                    input_path=temp_file_path,
                    enable_diarization=enable_diarization,
                    start_offset=start_offset,
                    sync_mode=sync_mode
                )
            elif stt_engine == STTEngine.HAIV_WHISPER:
                # [advice from AI] 새 HAIV Whisper (16K) 실시간
                from ..services.realtime_stt import HAIVStreamingSTT
                stt = HAIVStreamingSTT(preset="haiv_whisper")
                stt_generator = stt.process_video(
                    input_path=temp_file_path,
                    enable_diarization=enable_diarization,
                    start_offset=start_offset,
                    sync_mode=sync_mode
                )
            else:
                # HAIV 기반 STT (기본 - 8K)
                stt_generator = process_video_realtime(
                    input_path=temp_file_path,
                    enable_diarization=enable_diarization,
                    start_offset=start_offset,
                    sync_mode=sync_mode
                )
            
            async for subtitle in stt_generator:
                subtitle_count += 1
                elapsed = time.time() - start_time
                
                print(f"[ROUTER] 🎤 자막 #{subtitle_count}: [{subtitle.start_time:.1f}s] {subtitle.text[:30]}...")
                
                # 자막 이벤트 즉시 전송
                yield subtitle_to_sse(subtitle)
                
                # 진행률 이벤트 (10개마다)
                if subtitle_count % 10 == 0:
                    progress = min(99, int((subtitle.end_time / duration) * 100)) if duration > 0 else 0
                    yield f"data: {json.dumps({'type': 'progress', 'data': {'progress': progress, 'count': subtitle_count}}, ensure_ascii=False)}\n\n"
            
            # 완료 이벤트
            total_time = time.time() - start_time
            print(f"[ROUTER] ✅ 처리 완료: {subtitle_count}개 자막, {total_time:.1f}초 소요")
            yield f"data: {json.dumps({'type': 'complete', 'data': {'total_subtitles': subtitle_count, 'processing_time': total_time}}, ensure_ascii=False)}\n\n"
            
        except Exception as e:
            print(f"[ROUTER] ❌ 오류 발생: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'data': {'message': str(e)}}, ensure_ascii=False)}\n\n"
        finally:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
                print(f"[ROUTER] 🗑️ 임시 파일 삭제")
    
    return StreamingResponse(
        ultra_event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


# [advice from AI] 파일 전체 처리 후 자막 반환 (타임스탬프 매칭 방식)
@router.post("/process")
async def process_file_complete(
    file: UploadFile = File(...),
    enable_diarization: bool = True,
    stt_engine: STTEngine = STTEngine.WHISPER
):
    """
    📁 파일 전체 처리 → 타임스탬프 자막 반환
    
    실시간이 아닌 전체 처리 방식:
    1. 오디오 전체 추출
    2. STT 전체 처리
    3. 타임스탬프가 포함된 자막 목록 반환
    4. 프론트엔드에서 영상 currentTime에 맞춰 표시
    """
    import time as time_module
    
    print(f"[ROUTER] 📥 /process 요청: {file.filename}, engine={stt_engine}")
    
    # 파일 형식 검증
    allowed_extensions = {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"}
    file_ext = os.path.splitext(file.filename)[1].lower()
    
    if file_ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식입니다")
    
    # 파일 저장
    temp_file_path = os.path.join(UPLOAD_DIR, f"process_{os.urandom(8).hex()}{file_ext}")
    
    async with aiofiles.open(temp_file_path, "wb") as f:
        content = await file.read()
        await f.write(content)
    
    print(f"[ROUTER] ✅ 파일 저장: {len(content)} bytes")
    
    try:
        # 영상 길이 확인
        duration = audio_extractor.get_duration(temp_file_path)
        print(f"[ROUTER] 📊 영상 길이: {duration}초")
        
        # STT 전체 처리 (sync_mode=False로 최대 속도)
        subtitles = []
        start_time = time_module.time()
        
        if stt_engine == STTEngine.WHISPER:
            # [advice from AI] WhisperLiveKit 기반 STT
            stt = WhisperLiveKitSTT()
            stt_generator = stt.process_audio_stream(
                input_path=temp_file_path,
                enable_diarization=enable_diarization,
                start_offset=0,
                sync_mode=False  # 최대 속도로 처리
            )
        else:
            stt_generator = process_video_realtime(
                input_path=temp_file_path,
                enable_diarization=enable_diarization,
                start_offset=0,
                sync_mode=False  # 최대 속도로 처리
            )
        
        async for subtitle in stt_generator:
            subtitles.append({
                "id": subtitle.id,
                "start_time": subtitle.start_time,
                "end_time": subtitle.end_time,
                "text": subtitle.text,
                "speaker": subtitle.speaker
            })
        
        processing_time = time_module.time() - start_time
        print(f"[ROUTER] ✅ 처리 완료: {len(subtitles)}개 자막, {processing_time:.1f}초 소요")
        
        return {
            "success": True,
            "duration": duration,
            "processing_time": processing_time,
            "total_subtitles": len(subtitles),
            "subtitles": subtitles
        }
        
    except Exception as e:
        print(f"[ROUTER] ❌ 오류: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)


# [advice from AI] YouTube 영상 정보만 빠르게 추출 (라이브 STT용)
@router.get("/youtube/info")
async def youtube_video_info(youtube_url: str):
    """
    🎬 YouTube 영상 정보 추출 (라이브 STT용)
    
    - **youtube_url**: YouTube 영상 URL
    
    오디오 다운로드 없이 영상 정보 + 스트리밍 URL만 빠르게 반환
    프론트엔드에서 Web Audio API로 라이브 STT 처리
    """
    import subprocess
    import re
    
    print(f"[ROUTER] 📺 YouTube 정보 요청: {youtube_url}")
    
    # YouTube URL 유효성 검사 (라이브 URL 포함)
    youtube_pattern = r'(https?://)?(www\.)?(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/live/)[\w-]+'
    if not re.match(youtube_pattern, youtube_url):
        raise HTTPException(status_code=400, detail="유효하지 않은 YouTube URL입니다")
    
    try:
        # 영상 정보 가져오기
        print(f"[ROUTER] 🔍 YouTube 정보 추출 중...")
        info_cmd = ["yt-dlp", "--print", "duration", "--print", "title", "-q", youtube_url]
        info_result = subprocess.run(info_cmd, capture_output=True, text=True, timeout=30)
        
        if info_result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"YouTube 정보 추출 실패: {info_result.stderr}")
        
        lines = info_result.stdout.strip().split('\n')
        duration = float(lines[0]) if lines[0] else 0
        title = lines[1] if len(lines) > 1 else "Unknown"
        
        print(f"[ROUTER] 📊 영상: {title[:50]}..., 길이: {duration}초")
        
        # 영상 URL 추출 (프론트엔드 재생용)
        video_url_cmd = ["yt-dlp", "-f", "best[ext=mp4]/best", "-g", youtube_url]
        video_url_result = subprocess.run(video_url_cmd, capture_output=True, text=True, timeout=30)
        video_stream_url = video_url_result.stdout.strip() if video_url_result.returncode == 0 else None
        
        print(f"[ROUTER] ✅ YouTube 정보 추출 완료!")
        
        return {
            "success": True,
            "duration": duration,
            "title": title,
            "video_url": video_stream_url,
            "mode": "youtube_live"  # 라이브 STT 모드 표시
        }
        
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="YouTube 정보 추출 시간 초과")
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ROUTER] ❌ YouTube 오류: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# [advice from AI] YouTube URL로 실시간 STT 처리 (레거시 - 전체 다운로드 방식)
@router.post("/youtube")
async def youtube_realtime_stream(
    youtube_url: str,
    enable_diarization: bool = False,
    stt_engine: STTEngine = STTEngine.HAIV
):
    """
    🎬 YouTube URL 실시간 STT (레거시 모드)
    
    - **youtube_url**: YouTube 영상 URL
    - **enable_diarization**: 화자 분리 (기본 비활성화)
    - **stt_engine**: STT 엔진 선택 (haiv, whisper)
    
    ⚠️ 주의: 긴 영상은 다운로드에 시간이 오래 걸립니다.
    라이브 STT를 사용하려면 /youtube/info 엔드포인트를 사용하세요.
    """
    import subprocess
    import re
    
    print(f"[ROUTER] 📺 YouTube 요청 (레거시): {youtube_url}")
    
    # YouTube URL 유효성 검사
    youtube_pattern = r'(https?://)?(www\.)?(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/live/)[\w-]+'
    if not re.match(youtube_pattern, youtube_url):
        raise HTTPException(status_code=400, detail="유효하지 않은 YouTube URL입니다")
    
    async def youtube_event_generator():
        start_time = time.time()
        subtitle_count = 0
        temp_audio_path = os.path.join(UPLOAD_DIR, f"yt_{int(time.time())}.wav")
        
        try:
            # [advice from AI] yt-dlp로 영상 정보 및 오디오 URL 추출
            print(f"[ROUTER] 🔍 YouTube 정보 추출 중...")
            
            # 영상 정보 가져오기
            info_cmd = ["yt-dlp", "--print", "duration", "--print", "title", "-q", youtube_url]
            info_result = subprocess.run(info_cmd, capture_output=True, text=True, timeout=30)
            
            if info_result.returncode != 0:
                raise Exception(f"YouTube 정보 추출 실패: {info_result.stderr}")
            
            lines = info_result.stdout.strip().split('\n')
            duration = float(lines[0]) if lines[0] else 0
            title = lines[1] if len(lines) > 1 else "Unknown"
            
            print(f"[ROUTER] 📊 영상: {title[:50]}..., 길이: {duration}초")
            
            # 영상 URL 추출 (프론트엔드 재생용)
            video_url_cmd = ["yt-dlp", "-f", "best[ext=mp4]/best", "-g", youtube_url]
            video_url_result = subprocess.run(video_url_cmd, capture_output=True, text=True, timeout=30)
            video_stream_url = video_url_result.stdout.strip() if video_url_result.returncode == 0 else None
            
            # 초기화 이벤트 (영상 URL 포함)
            init_data = {
                'type': 'init',
                'data': {
                    'duration': duration,
                    'title': title,
                    'mode': 'youtube',
                    'video_url': video_stream_url
                }
            }
            yield f"data: {json.dumps(init_data, ensure_ascii=False)}\n\n"
            
            # [advice from AI] yt-dlp로 오디오 다운로드 (스트리밍용 WAV)
            print(f"[ROUTER] 🎵 오디오 추출 시작...")
            download_cmd = [
                "yt-dlp",
                "-f", "bestaudio/best",
                "-x",  # 오디오만 추출
                "--audio-format", "wav",
                "--postprocessor-args", "-ar 16000 -ac 1",  # 16kHz, mono
                "-o", temp_audio_path.replace('.wav', '.%(ext)s'),
                "--no-playlist",
                youtube_url
            ]
            
            dl_result = subprocess.run(download_cmd, capture_output=True, text=True, timeout=300)
            
            if dl_result.returncode != 0:
                raise Exception(f"오디오 추출 실패: {dl_result.stderr}")
            
            # 실제 파일 경로 확인 (yt-dlp가 확장자를 변경할 수 있음)
            actual_audio_path = temp_audio_path
            if not os.path.exists(actual_audio_path):
                # .wav 대신 다른 확장자로 저장되었을 수 있음
                import glob
                matches = glob.glob(temp_audio_path.replace('.wav', '.*'))
                if matches:
                    actual_audio_path = matches[0]
                else:
                    raise Exception("오디오 파일을 찾을 수 없습니다")
            
            print(f"[ROUTER] ✅ 오디오 추출 완료: {actual_audio_path}")
            
            # [advice from AI] 선택된 엔진으로 실시간 STT 처리
            print(f"[ROUTER] 🚀 {stt_engine.value.upper()} STT 처리 시작!")
            
            if stt_engine == STTEngine.WHISPER:
                # [advice from AI] WhisperLiveKit 기반 STT
                stt = WhisperLiveKitSTT()
                stt_generator = stt.process_audio_stream(
                    input_path=actual_audio_path,
                    enable_diarization=enable_diarization
                )
            else:
                stt_generator = process_video_realtime(
                    input_path=actual_audio_path,
                    enable_diarization=enable_diarization
                )
            
            async for subtitle in stt_generator:
                subtitle_count += 1
                elapsed = time.time() - start_time
                
                print(f"[ROUTER] 🎤 자막 #{subtitle_count}: [{subtitle.start_time:.1f}s] {subtitle.text[:30]}...")
                
                # 자막 이벤트 즉시 전송
                yield subtitle_to_sse(subtitle)
                
                # 진행률 이벤트 (10개마다)
                if subtitle_count % 10 == 0:
                    progress = min(99, int((subtitle.end_time / duration) * 100)) if duration > 0 else 0
                    yield f"data: {json.dumps({'type': 'progress', 'data': {'progress': progress, 'count': subtitle_count}}, ensure_ascii=False)}\n\n"
            
            # 완료 이벤트
            total_time = time.time() - start_time
            print(f"[ROUTER] ✅ YouTube 처리 완료: {subtitle_count}개 자막, {total_time:.1f}초 소요")
            yield f"data: {json.dumps({'type': 'complete', 'data': {'total_subtitles': subtitle_count, 'processing_time': total_time}}, ensure_ascii=False)}\n\n"
            
        except subprocess.TimeoutExpired:
            print(f"[ROUTER] ⏰ YouTube 처리 타임아웃")
            yield f"data: {json.dumps({'type': 'error', 'data': {'message': 'YouTube 처리 시간 초과'}}, ensure_ascii=False)}\n\n"
        except Exception as e:
            print(f"[ROUTER] ❌ YouTube 오류: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'data': {'message': str(e)}}, ensure_ascii=False)}\n\n"
        finally:
            # 임시 파일 정리
            import glob
            for f in glob.glob(temp_audio_path.replace('.wav', '.*')):
                if os.path.exists(f):
                    os.remove(f)
                    print(f"[ROUTER] 🗑️ 임시 파일 삭제: {f}")
    
    return StreamingResponse(
        youtube_event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/ultra-local")
async def ultra_realtime_local(
    file_path: str,
    enable_diarization: bool = True
):
    """
    🔴 로컬 파일 초저지연 실시간 처리
    
    - **file_path**: 서버의 파일 경로
    - **enable_diarization**: 화자 분리
    """
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")
    
    async def ultra_event_generator():
        start_time = time.time()
        subtitle_count = 0
        
        try:
            duration = audio_extractor.get_duration(file_path)
            yield f"data: {json.dumps({'type': 'init', 'data': {'duration': duration, 'mode': 'ultra_realtime'}}, ensure_ascii=False)}\n\n"
            
            async for subtitle in process_video_realtime(
                input_path=file_path,
                enable_diarization=enable_diarization
            ):
                subtitle_count += 1
                yield subtitle_to_sse(subtitle)
            
            total_time = time.time() - start_time
            yield f"data: {json.dumps({'type': 'complete', 'data': {'total_subtitles': subtitle_count, 'processing_time': total_time}}, ensure_ascii=False)}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'data': {'message': str(e)}}, ensure_ascii=False)}\n\n"
    
    return StreamingResponse(
        ultra_event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.websocket("/ws-ultra")
async def websocket_ultra_realtime(websocket: WebSocket):
    """
    🔴 WebSocket 초저지연 실시간 처리
    
    클라이언트에서 시작 메시지 전송:
    {"action": "start", "file_path": "/path/to/video.mp4"}
    
    서버에서 각 문장마다 즉시 전송:
    {"type": "subtitle", "data": {...}}
    """
    
    await websocket.accept()
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            action = message.get("action")
            
            if action == "start":
                file_path = message.get("file_path")
                
                if not file_path or not os.path.exists(file_path):
                    await websocket.send_json({
                        "type": "error",
                        "data": {"message": "파일을 찾을 수 없습니다"}
                    })
                    continue
                
                enable_diarization = message.get("enable_diarization", True)
                
                # 초기화
                duration = audio_extractor.get_duration(file_path)
                await websocket.send_json({
                    "type": "init",
                    "data": {"duration": duration, "mode": "ultra_realtime"}
                })
                
                start_time = time.time()
                subtitle_count = 0
                
                # [advice from AI] 2초 단위 실시간 처리
                async for subtitle in process_video_realtime(
                    input_path=file_path,
                    enable_diarization=enable_diarization
                ):
                    subtitle_count += 1
                    
                    # 즉시 전송
                    await websocket.send_json({
                        "type": "subtitle",
                        "data": {
                            "id": subtitle.id,
                            "start_time": subtitle.start_time,
                            "end_time": subtitle.end_time,
                            "text": subtitle.text,
                            "speaker": subtitle.speaker,
                            "is_final": subtitle.is_final,
                            "latency_ms": int((time.time() - start_time) * 1000) - int(subtitle.start_time * 1000)
                        }
                    })
                
                # 완료
                await websocket.send_json({
                    "type": "complete",
                    "data": {
                        "total_subtitles": subtitle_count,
                        "processing_time": time.time() - start_time
                    }
                })
            
            elif action == "ping":
                await websocket.send_json({"type": "pong"})
                
    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "data": {"message": str(e)}
        })


# [advice from AI] 기존 청크 기반 엔드포인트도 유지 (하위 호환)
@router.post("/stream")
async def stream_video_sse(
    file: UploadFile = File(...),
    enable_diarization: bool = True,
    chunk_duration: float = 30.0
):
    """
    청크 기반 실시간 스트리밍 (기존 방식)
    
    초저지연이 필요하면 /api/realtime/ultra 사용 권장
    """
    
    allowed_extensions = {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"}
    file_ext = os.path.splitext(file.filename)[1].lower()
    
    if file_ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail="지원하지 않는 파일 형식입니다.")
    
    temp_file_path = os.path.join(UPLOAD_DIR, f"stream_{os.urandom(8).hex()}{file_ext}")
    
    async with aiofiles.open(temp_file_path, "wb") as f:
        content = await file.read()
        await f.write(content)
    
    async def event_generator():
        try:
            async for event in stream_process_video(
                input_path=temp_file_path,
                enable_diarization=enable_diarization,
                chunk_duration=chunk_duration
            ):
                yield event.to_sse()
                if event.type in [StreamEventType.COMPLETE, StreamEventType.ERROR]:
                    break
        finally:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"}
    )


@router.get("/stream-local")
async def stream_local_file_sse(
    file_path: str,
    enable_diarization: bool = True,
    chunk_duration: float = 30.0
):
    """로컬 파일 청크 기반 스트리밍"""
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")
    
    async def event_generator():
        async for event in stream_process_video(
            input_path=file_path,
            enable_diarization=enable_diarization,
            chunk_duration=chunk_duration
        ):
            yield event.to_sse()
            if event.type in [StreamEventType.COMPLETE, StreamEventType.ERROR]:
                break
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"}
    )


# ============================================================================
# [advice from AI] 라이브 실시간 STT WebSocket 엔드포인트
# ============================================================================
from ..services.live_stt_service import LiveSTTService, LiveSTTConfig

@router.websocket("/ws/live")
async def live_stt_websocket(
    websocket: WebSocket,
    engine: str = "whisper",
    enable_diarization: bool = True
):
    """
    라이브 실시간 STT WebSocket
    
    프론트엔드에서 Web Audio API로 추출한 오디오를 실시간 수신하여
    STT 처리 후 자막 반환
    
    Protocol:
    - 클라이언트 → 서버: 바이너리 PCM 오디오 (16kHz, 16bit, mono)
    - 서버 → 클라이언트: JSON 자막 데이터
    """
    await websocket.accept()
    print(f"[WS-LIVE] 🔌 클라이언트 연결: engine={engine}, diarization={enable_diarization}")
    
    config = LiveSTTConfig(
        stt_engine=engine,
        enable_diarization=enable_diarization
    )
    service = LiveSTTService(config)
    
    try:
        await service.process_live_stream(websocket)
    except Exception as e:
        print(f"[WS-LIVE] ❌ 오류: {e}")
        import traceback
        traceback.print_exc()
    finally:
        print(f"[WS-LIVE] 🔌 클라이언트 연결 종료")


# ============================================================================
# [advice from AI] 실시간 스트리밍 URL STT (YouTube Live, HLS, RTMP 등)
# ============================================================================
import re
import subprocess
from enum import Enum

class StreamType(str, Enum):
    """스트리밍 URL 타입"""
    YOUTUBE_LIVE = "youtube_live"
    YOUTUBE_VIDEO = "youtube_video"
    HLS = "hls"
    RTMP = "rtmp"
    DIRECT = "direct"
    UNKNOWN = "unknown"


def detect_stream_type(url: str) -> tuple[StreamType, str]:
    """
    URL을 분석하여 스트리밍 타입 감지
    
    Returns:
        (StreamType, 설명 문자열)
    """
    url_lower = url.lower().strip()
    
    # YouTube
    if "youtube.com" in url_lower or "youtu.be" in url_lower:
        if "/live/" in url_lower or "live" in url_lower:
            return StreamType.YOUTUBE_LIVE, "YouTube 라이브 스트리밍"
        else:
            return StreamType.YOUTUBE_VIDEO, "YouTube 영상"
    
    # HLS (m3u8)
    if url_lower.endswith(".m3u8") or "m3u8" in url_lower:
        return StreamType.HLS, "HLS 스트리밍 (m3u8)"
    
    # RTMP
    if url_lower.startswith("rtmp://") or url_lower.startswith("rtmps://"):
        return StreamType.RTMP, "RTMP 스트리밍"
    
    # Direct video (mp4, webm 등)
    video_exts = [".mp4", ".webm", ".mkv", ".avi", ".mov", ".flv"]
    for ext in video_exts:
        if url_lower.endswith(ext):
            return StreamType.DIRECT, f"직접 영상 URL ({ext})"
    
    # HTTP/HTTPS 스트리밍
    if url_lower.startswith("http://") or url_lower.startswith("https://"):
        return StreamType.DIRECT, "HTTP 스트리밍"
    
    return StreamType.UNKNOWN, "알 수 없는 형식"


@router.get("/stream/detect")
async def detect_stream_url(url: str):
    """
    스트리밍 URL 타입 감지 및 정보 반환
    """
    stream_type, description = detect_stream_type(url)
    
    result = {
        "url": url,
        "type": stream_type.value,
        "description": description,
        "supported": stream_type != StreamType.UNKNOWN,
        "requires_buffer": stream_type in [StreamType.YOUTUBE_LIVE, StreamType.HLS, StreamType.RTMP],
        "buffer_seconds": 3  # 기본 3초 버퍼
    }
    
    # YouTube인 경우 yt-dlp로 추가 정보 가져오기
    if stream_type in [StreamType.YOUTUBE_LIVE, StreamType.YOUTUBE_VIDEO]:
        try:
            cmd = ["yt-dlp", "--dump-json", "--no-download", url]
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await asyncio.wait_for(process.communicate(), timeout=10)
            
            if stdout:
                info = json.loads(stdout.decode())
                result["title"] = info.get("title", "")
                result["duration"] = info.get("duration")  # None for live
                result["is_live"] = info.get("is_live", False)
                result["thumbnail"] = info.get("thumbnail", "")
                
                if result["is_live"]:
                    result["type"] = StreamType.YOUTUBE_LIVE.value
                    result["description"] = "YouTube 라이브 스트리밍"
                    result["requires_buffer"] = True
        except Exception as e:
            print(f"[STREAM] YouTube 정보 가져오기 실패: {e}")
    
    return result


@router.get("/stream/live")
async def start_live_stream_stt(
    url: str,
    stt_engine: STTEngine = STTEngine.WHISPER,
    enable_diarization: bool = True,
    buffer_seconds: float = 3.0
):
    """
    실시간 스트리밍 URL STT 처리
    
    3초 버퍼링 후 영상 재생과 동시에 자막 제공
    
    [advice from AI] process_video_realtime을 재사용하여 안정적인 STT 처리
    """
    stream_type, description = detect_stream_type(url)
    
    if stream_type == StreamType.UNKNOWN:
        raise HTTPException(status_code=400, detail="지원하지 않는 스트리밍 형식입니다")
    
    print(f"[STREAM] 🚀 실시간 스트리밍 STT 시작")
    print(f"[STREAM] URL: {url}")
    print(f"[STREAM] 타입: {description}")
    print(f"[STREAM] 엔진: {stt_engine.value}")
    print(f"[STREAM] 버퍼: {buffer_seconds}초")
    
    async def stream_event_generator():
        """
        [advice from AI] process_video_realtime을 재사용하여 안정적인 STT 처리
        """
        start_time = time.time()
        subtitle_count = 0
        
        try:
            # 1. 스트리밍 정보 전송
            yield f"data: {json.dumps({'type': 'init', 'data': {'stream_type': stream_type.value, 'description': description, 'buffer_seconds': buffer_seconds}}, ensure_ascii=False)}\n\n"
            
            # 2. 스트리밍 URL 처리
            stream_url = url
            if stream_type in [StreamType.YOUTUBE_LIVE, StreamType.YOUTUBE_VIDEO]:
                try:
                    cmd = ["yt-dlp", "-g", "-f", "best[ext=mp4]/best", url]
                    process = await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    stdout, _ = await asyncio.wait_for(process.communicate(), timeout=30)
                    
                    if stdout:
                        stream_url = stdout.decode().strip().split('\n')[0]
                        print(f"[STREAM] YouTube 스트림 URL 추출 완료")
                except Exception as e:
                    print(f"[STREAM] YouTube URL 추출 실패: {e}")
                    yield f"data: {json.dumps({'type': 'error', 'data': {'message': f'YouTube URL 추출 실패: {str(e)}'}}, ensure_ascii=False)}\n\n"
                    return
            
            # 3. video_url 전송 (프론트엔드에서 재생용)
            # [advice from AI] YouTube URL은 CORS 문제로 프록시 사용
            if stream_type in [StreamType.YOUTUBE_LIVE, StreamType.YOUTUBE_VIDEO]:
                # Base64 URL-safe 인코딩
                encoded_url = base64.urlsafe_b64encode(stream_url.encode()).decode('utf-8')
                proxy_url = f"/api/realtime/stream/proxy?url={encoded_url}"
                print(f"[STREAM] 📺 프록시 URL 전송: {proxy_url[:80]}...")
                yield f"data: {json.dumps({'type': 'video_url', 'data': {'url': proxy_url}}, ensure_ascii=False)}\n\n"
            else:
                # HLS 등 다른 스트림은 직접 전달
                print(f"[STREAM] 📺 영상 URL 전송: {stream_url[:80]}...")
                yield f"data: {json.dumps({'type': 'video_url', 'data': {'url': stream_url}}, ensure_ascii=False)}\n\n"
            
            # 4. 버퍼링 알림
            yield f"data: {json.dumps({'type': 'buffering', 'data': {'seconds': buffer_seconds}}, ensure_ascii=False)}\n\n"
            
            # 5. 버퍼 시간 대기 후 ready
            await asyncio.sleep(buffer_seconds)
            yield f"data: {json.dumps({'type': 'ready', 'data': {'message': '버퍼링 완료! 재생을 시작하세요'}}, ensure_ascii=False)}\n\n"
            
            # 6. [advice from AI] WhisperLiveKit 또는 HAIV 클라이언트 사용
            if stt_engine == STTEngine.WHISPER:
                stt = WhisperLiveKitSTT()
                stt_generator = stt.process_audio_stream(
                    stream_url, 
                    enable_diarization=enable_diarization, 
                    sync_mode=True
                )
            else:
                from ..services.realtime_stt import process_video_realtime
                stt_generator = process_video_realtime(
                    stream_url, 
                    enable_diarization=enable_diarization, 
                    sync_mode=True
                )
            
            print(f"[STREAM] 🎤 STT 시작 (engine={stt_engine.value})")
            
            # 7. STT 결과 실시간 스트리밍
            async for subtitle in stt_generator:
                subtitle_count += 1
                subtitle_data = {
                    "id": subtitle.id,
                    "start_time": subtitle.start_time,
                    "end_time": subtitle.end_time,
                    "text": subtitle.text,
                    "speaker": subtitle.speaker,
                    "is_final": subtitle.is_final
                }
                print(f"[STREAM] 🎤 자막 #{subtitle_count}: [{subtitle.start_time:.1f}s] {subtitle.text[:30]}...")
                yield f"data: {json.dumps({'type': 'subtitle', 'data': subtitle_data}, ensure_ascii=False)}\n\n"
            
            # 완료
            total_time = time.time() - start_time
            print(f"[STREAM] ✅ 처리 완료: {subtitle_count}개 자막, {total_time:.1f}초")
            yield f"data: {json.dumps({'type': 'complete', 'data': {'total_subtitles': subtitle_count, 'processing_time': total_time}}, ensure_ascii=False)}\n\n"
            
        except Exception as e:
            print(f"[STREAM] ❌ 오류: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'data': {'message': str(e)}}, ensure_ascii=False)}\n\n"
    
    return StreamingResponse(
        stream_event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


# [advice from AI] 비디오 프록시 - YouTube CORS 우회
import base64
import urllib.parse


@router.get("/stream/proxy")
async def proxy_video_stream(url: str, request: Request):
    """
    [advice from AI] YouTube 비디오 스트림 프록시
    CORS 제한을 우회하여 브라우저에서 재생 가능하게 함
    
    URL을 Base64로 디코딩하여 사용 (서버 재시작 후에도 동작)
    """
    try:
        # Base64 URL-safe 디코딩
        video_url = base64.urlsafe_b64decode(url).decode('utf-8')
    except Exception as e:
        print(f"[PROXY] ❌ URL 디코딩 실패: {e}")
        raise HTTPException(status_code=400, detail="잘못된 URL 형식입니다")
    
    print(f"[PROXY] 🎬 비디오 스트리밍 시작: {video_url[:60]}...")
    
    # Range 헤더 처리 (비디오 시크 지원)
    range_header = request.headers.get("range")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "identity",
        "Connection": "keep-alive"
    }
    
    if range_header:
        headers["Range"] = range_header
        print(f"[PROXY] 📍 Range 요청: {range_header}")
    
    async def stream_video():
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=30.0)) as client:
            try:
                async with client.stream("GET", video_url, headers=headers) as response:
                    # 응답 헤더 로깅
                    content_length = response.headers.get("content-length", "unknown")
                    content_type = response.headers.get("content-type", "video/mp4")
                    print(f"[PROXY] 📦 응답: {response.status_code}, {content_type}, {content_length} bytes")
                    
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        yield chunk
            except Exception as e:
                print(f"[PROXY] ❌ 스트리밍 오류: {e}")
                raise
    
    # 원본 비디오 헤더 가져오기
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
        try:
            head_headers = headers.copy()
            head_response = await client.head(video_url, headers=head_headers, follow_redirects=True)
            
            content_length = head_response.headers.get("content-length")
            content_type = head_response.headers.get("content-type", "video/mp4")
            accept_ranges = head_response.headers.get("accept-ranges", "bytes")
            
            response_headers = {
                "Content-Type": content_type,
                "Accept-Ranges": accept_ranges,
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                "Access-Control-Allow-Headers": "Range",
                "Cache-Control": "no-cache"
            }
            
            if content_length:
                response_headers["Content-Length"] = content_length
            
            # Range 요청이면 206 반환
            if range_header:
                # Range 응답 처리
                async with client.stream("GET", video_url, headers=headers) as range_resp:
                    content_range = range_resp.headers.get("content-range")
                    if content_range:
                        response_headers["Content-Range"] = content_range
                    range_content_length = range_resp.headers.get("content-length")
                    if range_content_length:
                        response_headers["Content-Length"] = range_content_length
                    
                    return StreamingResponse(
                        stream_video(),
                        status_code=206,
                        headers=response_headers,
                        media_type=content_type
                    )
            
            return StreamingResponse(
                stream_video(),
                status_code=200,
                headers=response_headers,
                media_type=content_type
            )
            
        except Exception as e:
            print(f"[PROXY] ❌ HEAD 요청 실패: {e}")
            # HEAD 실패 시에도 스트리밍 시도
            return StreamingResponse(
                stream_video(),
                status_code=200,
                headers={
                    "Content-Type": "video/mp4",
                    "Accept-Ranges": "bytes",
                    "Access-Control-Allow-Origin": "*"
                },
                media_type="video/mp4"
            )


# =============================================================================
# [advice from AI] HAIV 모니터링 프록시 - 관리자 화면 임베드용
# =============================================================================

# 모니터링 세션 저장 (로그인 쿠키)
_monitor_session = None
_monitor_cookies = {}

HAIV_MONITOR_URL = "http://49.50.136.163:40001"
HAIV_MONITOR_CREDENTIALS = {
    "username": "timbel",
    "password": "1q2w3e4r!"
}


@router.get("/monitor/login")
async def monitor_login():
    """
    HAIV 관리자 화면 로그인 (세션 쿠키 획득)
    """
    global _monitor_cookies
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # 로그인 페이지에서 CSRF 토큰 등 획득 (필요시)
            login_url = f"{HAIV_MONITOR_URL}/api/auth/login"
            
            # 로그인 요청
            response = await client.post(
                login_url,
                json=HAIV_MONITOR_CREDENTIALS,
                follow_redirects=True
            )
            
            if response.status_code == 200:
                _monitor_cookies = dict(response.cookies)
                print(f"[MONITOR] ✅ 로그인 성공! cookies: {list(_monitor_cookies.keys())}")
                return {"status": "success", "message": "로그인 성공"}
            else:
                print(f"[MONITOR] ❌ 로그인 실패: {response.status_code}")
                return {"status": "error", "message": f"로그인 실패: {response.status_code}"}
                
    except Exception as e:
        print(f"[MONITOR] ❌ 로그인 오류: {e}")
        return {"status": "error", "message": str(e)}


@router.get("/monitor/proxy")
async def monitor_proxy(path: str = "saiz_fnt"):
    """
    HAIV 관리자 화면 프록시
    
    - iframe에서 호출하여 관리자 화면을 임베드
    - 자동 로그인 세션 사용
    """
    from fastapi.responses import HTMLResponse
    
    target_url = f"{HAIV_MONITOR_URL}/{path}"
    
    try:
        async with httpx.AsyncClient(timeout=30.0, cookies=_monitor_cookies) as client:
            response = await client.get(target_url, follow_redirects=True)
            
            if response.status_code == 200:
                content = response.text
                
                # [advice from AI] 상대 경로를 프록시 경로로 변환
                content = content.replace('href="/', f'href="{HAIV_MONITOR_URL}/')
                content = content.replace("href='/", f"href='{HAIV_MONITOR_URL}/")
                content = content.replace('src="/', f'src="{HAIV_MONITOR_URL}/')
                content = content.replace("src='/", f"src='{HAIV_MONITOR_URL}/")
                
                # X-Frame-Options 제거를 위해 직접 HTML 반환
                return HTMLResponse(
                    content=content,
                    status_code=200,
                    headers={
                        "X-Frame-Options": "ALLOWALL",
                        "Content-Security-Policy": "frame-ancestors *"
                    }
                )
            else:
                return HTMLResponse(
                    content=f"<h1>Error {response.status_code}</h1><p>관리자 화면에 접근할 수 없습니다.</p>",
                    status_code=response.status_code
                )
                
    except Exception as e:
        print(f"[MONITOR] ❌ 프록시 오류: {e}")
        return HTMLResponse(
            content=f"<h1>Error</h1><p>{str(e)}</p>",
            status_code=500
        )


@router.get("/monitor/info")
async def monitor_info():
    """
    모니터링 정보 반환
    """
    return {
        "url": HAIV_MONITOR_URL,
        "login_path": "/saiz_fnt",
        "proxy_url": "/api/realtime/monitor/proxy?path=saiz_fnt",
        "direct_url": f"{HAIV_MONITOR_URL}/saiz_fnt",
        "credentials": {
            "username": HAIV_MONITOR_CREDENTIALS["username"],
            # 비밀번호는 노출하지 않음
        }
    }
