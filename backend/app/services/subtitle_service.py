# [advice from AI] 자막 파일 생성 서비스 (SRT, VTT 변환)

from typing import List
from ..models.subtitle import SubtitleSegment


class SubtitleService:
    """자막 파일 생성 서비스"""
    
    @staticmethod
    def format_srt_time(seconds: float) -> str:
        """시간을 SRT 형식으로 변환 (HH:MM:SS,mmm)"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds % 1) * 1000)
        
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
    
    @staticmethod
    def format_vtt_time(seconds: float) -> str:
        """시간을 VTT 형식으로 변환 (HH:MM:SS.mmm)"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds % 1) * 1000)
        
        return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"
    
    def generate_srt(
        self,
        segments: List[SubtitleSegment],
        include_speaker: bool = True
    ) -> str:
        """
        SRT 형식 자막 파일 생성
        
        Args:
            segments: 자막 세그먼트 목록
            include_speaker: 화자 정보 포함 여부
        
        Returns:
            str: SRT 형식 문자열
        """
        lines = []
        
        for i, segment in enumerate(segments):
            # 시퀀스 번호
            lines.append(str(i + 1))
            
            # 타임코드
            start = self.format_srt_time(segment.start_time)
            end = self.format_srt_time(segment.end_time)
            lines.append(f"{start} --> {end}")
            
            # 자막 텍스트 (화자 정보 포함)
            if include_speaker and segment.speaker:
                lines.append(f"[{segment.speaker}] {segment.text}")
            else:
                lines.append(segment.text)
            
            # 빈 줄 (세그먼트 구분)
            lines.append("")
        
        return "\n".join(lines)
    
    def generate_vtt(
        self,
        segments: List[SubtitleSegment],
        include_speaker: bool = True
    ) -> str:
        """
        VTT 형식 자막 파일 생성
        
        Args:
            segments: 자막 세그먼트 목록
            include_speaker: 화자 정보 포함 여부
        
        Returns:
            str: VTT 형식 문자열
        """
        lines = ["WEBVTT", ""]
        
        for i, segment in enumerate(segments):
            # 시퀀스 번호 (선택적)
            lines.append(str(i + 1))
            
            # 타임코드
            start = self.format_vtt_time(segment.start_time)
            end = self.format_vtt_time(segment.end_time)
            lines.append(f"{start} --> {end}")
            
            # 자막 텍스트 (화자 정보 포함 - VTT 스타일)
            if include_speaker and segment.speaker:
                lines.append(f"<v {segment.speaker}>{segment.text}")
            else:
                lines.append(segment.text)
            
            # 빈 줄 (세그먼트 구분)
            lines.append("")
        
        return "\n".join(lines)
    
    def generate(
        self,
        segments: List[SubtitleSegment],
        format: str = "srt",
        include_speaker: bool = True
    ) -> str:
        """
        자막 파일 생성 (형식 선택)
        
        Args:
            segments: 자막 세그먼트 목록
            format: 출력 형식 (srt 또는 vtt)
            include_speaker: 화자 정보 포함 여부
        
        Returns:
            str: 자막 파일 문자열
        """
        if format.lower() == "vtt":
            return self.generate_vtt(segments, include_speaker)
        else:
            return self.generate_srt(segments, include_speaker)


# 싱글톤 인스턴스
subtitle_service = SubtitleService()
