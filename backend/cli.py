#!/usr/bin/env python3
# [advice from AI] CLI 스크립트 - 파이프라인 직접 실행

import asyncio
import argparse
import os
import sys

# 모듈 경로 추가
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.pipeline import process_video, PipelineProgress


def print_progress(progress: PipelineProgress):
    """진행률 출력"""
    if progress.total_chunks > 1:
        print(f"[{progress.stage.value}] {progress.progress}% - {progress.message} (청크 {progress.current_chunk}/{progress.total_chunks})")
    else:
        print(f"[{progress.stage.value}] {progress.progress}% - {progress.message}")


async def main():
    parser = argparse.ArgumentParser(
        description="KTV 자막 생성 파이프라인 CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  python cli.py -i video.mp4 -o output/
  python cli.py -i video.mp4 --no-diarization
  python cli.py -i video.mp4 --chunk 600  # 10분 단위
        """
    )
    
    parser.add_argument(
        "-i", "--input",
        required=True,
        help="입력 동영상 파일 경로"
    )
    
    parser.add_argument(
        "-o", "--output",
        default="./output",
        help="출력 디렉토리 (기본: ./output)"
    )
    
    parser.add_argument(
        "--chunk",
        type=float,
        default=300.0,
        help="청크 길이 (초, 기본: 300 = 5분)"
    )
    
    parser.add_argument(
        "--no-diarization",
        action="store_true",
        help="화자 분리 비활성화"
    )
    
    parser.add_argument(
        "--srt-only",
        action="store_true",
        help="SRT 파일만 생성"
    )
    
    parser.add_argument(
        "--vtt-only",
        action="store_true",
        help="VTT 파일만 생성"
    )
    
    args = parser.parse_args()
    
    # 입력 파일 확인
    if not os.path.exists(args.input):
        print(f"오류: 입력 파일을 찾을 수 없습니다: {args.input}")
        sys.exit(1)
    
    # 출력 디렉토리 생성
    os.makedirs(args.output, exist_ok=True)
    
    print("=" * 60)
    print("KTV 자막 생성 파이프라인")
    print("=" * 60)
    print(f"입력 파일: {args.input}")
    print(f"출력 디렉토리: {args.output}")
    print(f"청크 길이: {args.chunk}초")
    print(f"화자 분리: {'비활성화' if args.no_diarization else '활성화'}")
    print("=" * 60)
    print()
    
    # 파이프라인 실행
    result = await process_video(
        input_path=args.input,
        enable_diarization=not args.no_diarization,
        chunk_duration=args.chunk,
        on_progress=print_progress
    )
    
    print()
    print("=" * 60)
    
    if not result.success:
        print(f"오류: {result.message}")
        sys.exit(1)
    
    # 결과 출력
    print(f"처리 완료!")
    print(f"- 영상 길이: {int(result.duration // 60)}분 {int(result.duration % 60)}초")
    print(f"- 자막 세그먼트: {len(result.segments)}개")
    print(f"- 화자 수: {result.speaker_count}명")
    print()
    
    # 파일 저장
    input_stem = os.path.splitext(os.path.basename(args.input))[0]
    
    if not args.vtt_only:
        srt_path = os.path.join(args.output, f"{input_stem}.srt")
        with open(srt_path, "w", encoding="utf-8") as f:
            f.write(result.srt_content)
        print(f"SRT 저장: {srt_path}")
    
    if not args.srt_only:
        vtt_path = os.path.join(args.output, f"{input_stem}.vtt")
        with open(vtt_path, "w", encoding="utf-8") as f:
            f.write(result.vtt_content)
        print(f"VTT 저장: {vtt_path}")
    
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
