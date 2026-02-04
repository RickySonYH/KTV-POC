#!/usr/bin/env python3
"""
[advice from AI] WhisperLiveKit SimulStreaming 데이터 흐름 분석 스크립트
- MP4에서 오디오 추출
- WebSocket으로 WhisperLiveKit에 전송
- 응답 데이터를 JSON으로 저장하고 분석
"""

import asyncio
import websockets
import json
import subprocess
import os
import sys
from datetime import datetime

# 설정
WHISPER_WS_URL = "ws://localhost:6470/asr"  # WhisperLiveKit WebSocket
SAMPLE_VIDEO = "samples/이재명 대통령 제3회 국무회의 260127.mp4"
OUTPUT_DIR = "output/whisper_analysis"
SAMPLE_RATE = 16000
CHUNK_SIZE = 4800  # 0.3초 분량 (min-chunk-size와 맞춤)
MAX_DURATION = 30  # 30초만 분석
START_OFFSET = 90  # 90초부터 시작 (국민의례 이후)

async def analyze_whisper_stream():
    """WhisperLiveKit에 오디오를 보내고 응답을 분석"""
    
    # 출력 디렉토리 생성
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # 타임스탬프
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = f"{OUTPUT_DIR}/analysis_{timestamp}.jsonl"
    
    print(f"[INFO] 샘플 영상: {SAMPLE_VIDEO}")
    print(f"[INFO] 시작 오프셋: {START_OFFSET}초")
    print(f"[INFO] 분석 시간: {MAX_DURATION}초")
    print(f"[INFO] 출력 파일: {output_file}")
    print()
    
    # FFmpeg로 오디오 추출 (PCM 16kHz mono)
    ffmpeg_cmd = [
        "ffmpeg", 
        "-ss", str(START_OFFSET),  # 시작 오프셋
        "-i", SAMPLE_VIDEO,
        "-t", str(MAX_DURATION),  # 최대 시간 제한
        "-vn",  # 비디오 제외
        "-acodec", "pcm_s16le",
        "-ar", str(SAMPLE_RATE),
        "-ac", "1",  # mono
        "-f", "s16le",
        "pipe:1"  # stdout으로 출력
    ]
    
    print(f"[INFO] FFmpeg 시작: 오디오 추출 중...")
    
    try:
        ffmpeg_proc = subprocess.Popen(
            ffmpeg_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL
        )
    except Exception as e:
        print(f"[ERROR] FFmpeg 실행 실패: {e}")
        return
    
    # WebSocket 연결
    print(f"[INFO] WhisperLiveKit 연결 중: {WHISPER_WS_URL}")
    
    try:
        async with websockets.connect(WHISPER_WS_URL) as ws:
            print(f"[INFO] WebSocket 연결됨!")
            print()
            
            responses = []
            chunk_count = 0
            audio_time = 0.0
            
            async def receive_messages():
                """응답 수신"""
                nonlocal responses
                try:
                    async for message in ws:
                        data = json.loads(message)
                        
                        # 타임스탬프 추가
                        data['_recv_time'] = datetime.now().isoformat()
                        data['_audio_time'] = audio_time
                        
                        responses.append(data)
                        
                        # 실시간 출력
                        lines = data.get('lines', [])
                        buffer = data.get('buffer_transcription', '')
                        
                        print(f"[RECV] audio={audio_time:.1f}s | lines={len(lines)} | buffer={len(buffer)}자")
                        
                        if lines:
                            for i, line in enumerate(lines):
                                text = line.get('text', '')[:50]
                                speaker = line.get('speaker', '?')
                                print(f"       lines[{i}]: speaker={speaker}, text=\"{text}...\"")
                        
                        if buffer:
                            print(f"       buffer: \"{buffer[:50]}...\"")
                        
                        print()
                        
                except websockets.exceptions.ConnectionClosed:
                    print("[INFO] WebSocket 연결 종료")
            
            # 수신 태스크 시작
            receive_task = asyncio.create_task(receive_messages())
            
            # 오디오 전송
            print("[INFO] 오디오 전송 시작...")
            print("=" * 60)
            
            while True:
                chunk = ffmpeg_proc.stdout.read(CHUNK_SIZE * 2)  # 16bit = 2 bytes
                if not chunk:
                    break
                
                await ws.send(chunk)
                chunk_count += 1
                audio_time = chunk_count * CHUNK_SIZE / SAMPLE_RATE
                
                # 0.25초 간격으로 전송 (실시간 시뮬레이션)
                await asyncio.sleep(0.25)
            
            print("=" * 60)
            print(f"[INFO] 오디오 전송 완료: {chunk_count}개 청크, {audio_time:.1f}초")
            
            # 잠시 대기 (마지막 응답 수신)
            await asyncio.sleep(3)
            
            # 수신 태스크 취소
            receive_task.cancel()
            try:
                await receive_task
            except asyncio.CancelledError:
                pass
            
            # 결과 저장
            print(f"\n[INFO] 분석 결과 저장: {output_file}")
            with open(output_file, 'w', encoding='utf-8') as f:
                for resp in responses:
                    f.write(json.dumps(resp, ensure_ascii=False) + '\n')
            
            # 분석 결과 출력
            print_analysis(responses)
            
    except Exception as e:
        print(f"[ERROR] WebSocket 오류: {e}")
        import traceback
        traceback.print_exc()
    finally:
        ffmpeg_proc.terminate()


def print_analysis(responses):
    """분석 결과 출력"""
    print("\n" + "=" * 60)
    print("📊 데이터 흐름 분석 결과")
    print("=" * 60)
    
    if not responses:
        print("[WARN] 응답 없음")
        return
    
    # 통계
    total_responses = len(responses)
    lines_changes = []
    prev_lines_count = 0
    prev_lines_text = []
    
    for resp in responses:
        lines = resp.get('lines', [])
        lines_count = len(lines)
        
        # lines 변화 감지
        if lines_count != prev_lines_count:
            lines_changes.append({
                'type': 'count_change',
                'from': prev_lines_count,
                'to': lines_count,
                'time': resp.get('_audio_time', 0)
            })
        
        # 텍스트 변화 감지
        for i, line in enumerate(lines):
            text = line.get('text', '').strip()
            if i < len(prev_lines_text):
                if text != prev_lines_text[i]:
                    lines_changes.append({
                        'type': 'text_change',
                        'index': i,
                        'from': prev_lines_text[i][:30],
                        'to': text[:30],
                        'time': resp.get('_audio_time', 0)
                    })
            else:
                lines_changes.append({
                    'type': 'new_line',
                    'index': i,
                    'text': text[:30],
                    'time': resp.get('_audio_time', 0)
                })
        
        prev_lines_count = lines_count
        prev_lines_text = [line.get('text', '').strip() for line in lines]
    
    print(f"\n📈 기본 통계:")
    print(f"   - 총 응답 수: {total_responses}")
    print(f"   - lines 변화 이벤트: {len(lines_changes)}")
    
    print(f"\n🔄 lines 변화 패턴 (처음 20개):")
    for i, change in enumerate(lines_changes[:20]):
        if change['type'] == 'count_change':
            print(f"   [{change['time']:.1f}s] 📊 lines 개수: {change['from']} → {change['to']}")
        elif change['type'] == 'text_change':
            print(f"   [{change['time']:.1f}s] 📝 lines[{change['index']}] 변경: \"{change['from']}\" → \"{change['to']}\"")
        elif change['type'] == 'new_line':
            print(f"   [{change['time']:.1f}s] 🆕 lines[{change['index']}] 추가: \"{change['text']}\"")
    
    if len(lines_changes) > 20:
        print(f"   ... 외 {len(lines_changes) - 20}개 이벤트")
    
    # 마지막 응답의 전체 lines 출력
    if responses:
        last_resp = responses[-1]
        last_lines = last_resp.get('lines', [])
        print(f"\n📋 마지막 응답의 lines ({len(last_lines)}개):")
        for i, line in enumerate(last_lines):
            text = line.get('text', '')
            speaker = line.get('speaker', '?')
            start = line.get('start', '?')
            end = line.get('end', '?')
            print(f"   [{i}] speaker={speaker}, start={start}, end={end}")
            print(f"       text: \"{text[:60]}{'...' if len(text) > 60 else ''}\"")


if __name__ == "__main__":
    asyncio.run(analyze_whisper_stream())
