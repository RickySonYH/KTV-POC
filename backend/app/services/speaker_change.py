# [advice from AI] 화자 변경 감지 서비스 - Resemblyzer 기반
# GPU 불필요, CPU만 사용, ~100ms 지연

import numpy as np
from typing import Optional, Tuple
import logging

logger = logging.getLogger(__name__)

# Resemblyzer 지연 로딩 (import 시간 절약)
_encoder = None

def get_encoder():
    """VoiceEncoder 싱글톤"""
    global _encoder
    if _encoder is None:
        try:
            from resemblyzer import VoiceEncoder
            logger.info("[SPEAKER] Resemblyzer VoiceEncoder 초기화 중...")
            _encoder = VoiceEncoder()
            logger.info("[SPEAKER] VoiceEncoder 초기화 완료")
        except ImportError:
            logger.error("[SPEAKER] resemblyzer 설치 필요: pip install resemblyzer")
            raise
    return _encoder


class SpeakerChangeDetector:
    """
    화자 변경 감지기
    - 음성 임베딩 비교로 화자 변경 감지
    - 화자가 누구인지는 식별하지 않음 (A↔B 구분만)
    """
    
    def __init__(self, threshold: float = 0.70, min_audio_length: float = 0.5):
        """
        Args:
            threshold: 코사인 유사도 임계값 (낮을수록 민감)
            min_audio_length: 최소 오디오 길이 (초)
        """
        self.threshold = threshold
        self.min_audio_length = min_audio_length
        self.last_embedding: Optional[np.ndarray] = None
        self.current_speaker: int = 0  # 0=흰색, 1=노란색
        self.sample_rate = 16000  # WhisperLiveKit과 동일
        
    def reset(self):
        """상태 초기화"""
        self.last_embedding = None
        self.current_speaker = 0
        logger.info("[SPEAKER] 상태 초기화됨")
        
    def process_audio(self, audio_data: bytes) -> Tuple[bool, int]:
        """
        오디오 데이터로 화자 변경 감지
        
        Args:
            audio_data: PCM 16-bit 오디오 데이터 (16kHz)
            
        Returns:
            (speaker_changed, current_speaker)
            - speaker_changed: 화자가 변경되었는지
            - current_speaker: 현재 화자 인덱스 (0 또는 1)
        """
        try:
            # bytes → numpy array (int16 → float32)
            audio_np = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0
            
            # 최소 길이 체크
            min_samples = int(self.min_audio_length * self.sample_rate)
            if len(audio_np) < min_samples:
                return False, self.current_speaker
            
            # 음성 임베딩 추출
            encoder = get_encoder()
            embedding = encoder.embed_utterance(audio_np)
            
            # 첫 번째 발화
            if self.last_embedding is None:
                self.last_embedding = embedding
                logger.debug("[SPEAKER] 첫 번째 발화 - 화자 0")
                return False, self.current_speaker
            
            # 코사인 유사도 계산
            similarity = float(np.dot(self.last_embedding, embedding))
            
            # 화자 변경 감지
            speaker_changed = similarity < self.threshold
            
            if speaker_changed:
                # 화자 토글 (0↔1)
                self.current_speaker = 1 - self.current_speaker
                logger.info(f"[SPEAKER] 화자 변경 감지! 유사도={similarity:.3f}, 새 화자={self.current_speaker}")
            else:
                logger.debug(f"[SPEAKER] 동일 화자, 유사도={similarity:.3f}")
            
            # 임베딩 업데이트
            self.last_embedding = embedding
            
            return speaker_changed, self.current_speaker
            
        except Exception as e:
            logger.error(f"[SPEAKER] 오디오 처리 오류: {e}")
            return False, self.current_speaker
    
    def process_audio_chunk(self, audio_chunk: np.ndarray) -> Tuple[bool, int]:
        """
        numpy array로 직접 처리
        
        Args:
            audio_chunk: float32 오디오 배열 (-1 ~ 1)
        """
        try:
            min_samples = int(self.min_audio_length * self.sample_rate)
            if len(audio_chunk) < min_samples:
                return False, self.current_speaker
            
            encoder = get_encoder()
            embedding = encoder.embed_utterance(audio_chunk)
            
            if self.last_embedding is None:
                self.last_embedding = embedding
                return False, self.current_speaker
            
            similarity = float(np.dot(self.last_embedding, embedding))
            speaker_changed = similarity < self.threshold
            
            if speaker_changed:
                self.current_speaker = 1 - self.current_speaker
                logger.info(f"[SPEAKER] 화자 변경! 유사도={similarity:.3f}")
            
            self.last_embedding = embedding
            return speaker_changed, self.current_speaker
            
        except Exception as e:
            logger.error(f"[SPEAKER] 처리 오류: {e}")
            return False, self.current_speaker


# 전역 인스턴스
_detector: Optional[SpeakerChangeDetector] = None

def get_speaker_detector() -> SpeakerChangeDetector:
    """전역 화자 변경 감지기 반환"""
    global _detector
    if _detector is None:
        _detector = SpeakerChangeDetector()
    return _detector


def detect_speaker_change(audio_data: bytes) -> dict:
    """
    API용 간단 함수
    
    Returns:
        {"speaker_changed": bool, "speaker": int}
    """
    detector = get_speaker_detector()
    changed, speaker = detector.process_audio(audio_data)
    return {
        "speaker_changed": changed,
        "speaker": speaker  # 0=흰색, 1=노란색
    }
