"""
[advice from AI] 후처리 모듈
할루시네이션 필터링 + 사전 매칭 + 음악 감지 (원본 whisper_server.py에서 마이그레이션)
"""

import re
import logging
from typing import List, Tuple, Optional
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


# =============================================================================
# [advice from AI] 음악/노래 감지
# =============================================================================

class AudioContentType(Enum):
    """오디오 콘텐츠 타입"""
    SPEECH = "speech"       # 음성
    MUSIC = "music"         # 음악 (배경음악)
    SINGING = "singing"     # 노래 (가사)
    UNCLEAR = "unclear"     # 불분명


@dataclass
class MusicDetectionResult:
    """음악 감지 결과"""
    is_music: bool
    content_type: AudioContentType
    confidence: float
    replacement_text: str


# 음악 감지 패턴
MUSIC_PATTERNS = [
    # 음표 기호
    r'[♪♫🎵🎶🎤🎼]+',
    
    # 영어 음악 표현
    r'\[music\]',
    r'\[music playing\]',
    r'\(music\)',
    r'\(music playing\)',
    r'\[singing\]',
    r'\(singing\)',
    
    # 한국어 음악 표현
    r'\[음악\]',
    r'\(음악\)',
    r'\[노래\]',
    r'\(노래\)',
    r'\[배경음악\]',
]

# [advice from AI] 애국가 가사 패턴 (국민의례 시 음악 감지용)
ANTHEM_LYRICS = [
    # 애국가 1절
    r"동해\s*물과\s*백두산이",
    r"마르고\s*닳도록",
    r"하느님이\s*보우하사",
    r"우리나라\s*만세",
    r"무궁화\s*삼천리",
    r"화려\s*강산",
    r"대한\s*사람",
    r"대한으로",
    r"길이\s*보전하세",
    # 애국가 2절
    r"남산\s*위에\s*저\s*소나무",
    r"철갑을\s*두른\s*듯",
    r"바람\s*서리\s*불변함은",
    r"우리\s*기상일세",
    # 애국가 3절
    r"가을\s*하늘\s*공활한데",
    r"높고\s*구름\s*없이",
    r"밝은\s*달은\s*우리\s*가슴",
    r"일편단심일세",
    # 애국가 4절
    r"이\s*기상과\s*이\s*맘으로",
    r"충성을\s*다하여",
    r"괴로우나\s*즐거우나",
    r"나라\s*사랑하세",
]

COMPILED_ANTHEM_PATTERNS = [re.compile(p, re.IGNORECASE) for p in ANTHEM_LYRICS]

COMPILED_MUSIC_PATTERNS = [re.compile(p, re.IGNORECASE) for p in MUSIC_PATTERNS]

# 음악/노래 가사로 의심되는 패턴 (반복, 짧은 어절)
LYRIC_PATTERNS = [
    # 라라라, 나나나 등의 반복
    r'^(라|나|다|바|마|파|타|하|아|이|우|오)+\s*(라|나|다|바|마|파|타|하|아|이|우|오)+$',
    # 영어 스캣
    r'^(la|na|da|ba|sha|do|re|mi|fa|so|si|yeah|oh|ah)+\s*',
    # 허밍
    r'^(음|흠|훔|흥|응)+\s*(음|흠|훔|흥|응)*$',
]

COMPILED_LYRIC_PATTERNS = [re.compile(p, re.IGNORECASE) for p in LYRIC_PATTERNS]


def detect_music(
    text: str, 
    no_speech_prob: float = 0.0,
    avg_logprob: float = 0.0
) -> MusicDetectionResult:
    """
    [advice from AI] 음악/노래 감지
    
    Args:
        text: STT 결과 텍스트
        no_speech_prob: 무음 확률 (Whisper 출력)
        avg_logprob: 평균 로그 확률 (신뢰도)
    
    Returns:
        MusicDetectionResult: 음악 감지 결과
    """
    if not text:
        return MusicDetectionResult(
            is_music=False,
            content_type=AudioContentType.SPEECH,
            confidence=0.0,
            replacement_text=""
        )
    
    text_lower = text.strip().lower()
    confidence = 0.0
    content_type = AudioContentType.SPEECH
    
    # 1. 명시적 음악 패턴 체크 (음표 기호, [music] 등)
    for pattern in COMPILED_MUSIC_PATTERNS:
        if pattern.search(text):
            return MusicDetectionResult(
                is_music=True,
                content_type=AudioContentType.MUSIC,
                confidence=0.95,
                replacement_text="[♪]"
            )
    
    # 2. 가사/스캣 패턴 체크
    for pattern in COMPILED_LYRIC_PATTERNS:
        if pattern.match(text_lower):
            return MusicDetectionResult(
                is_music=True,
                content_type=AudioContentType.SINGING,
                confidence=0.8,
                replacement_text="[♪ 노래]"
            )
    
    # [advice from AI] 2.5. 애국가 가사 패턴 체크 (국민의례 시)
    for pattern in COMPILED_ANTHEM_PATTERNS:
        if pattern.search(text):
            return MusicDetectionResult(
                is_music=True,
                content_type=AudioContentType.SINGING,
                confidence=0.9,
                replacement_text="[♪ 애국가]"
            )
    
    # 3. 휴리스틱 체크: 높은 무음 확률 + 낮은 신뢰도 = 음악일 가능성
    if no_speech_prob > 0.7 and avg_logprob < -0.9:
        confidence = (no_speech_prob + (1.0 - abs(avg_logprob))) / 2
        if confidence > 0.6:
            return MusicDetectionResult(
                is_music=True,
                content_type=AudioContentType.MUSIC,
                confidence=confidence,
                replacement_text="[♪]"
            )
    
    # 4. 음악 아님
    return MusicDetectionResult(
        is_music=False,
        content_type=AudioContentType.SPEECH,
        confidence=0.0,
        replacement_text=""
    )


# =============================================================================
# [advice from AI] 비속어/민감어 필터 (방송 사고 방지)
# =============================================================================

# [advice from AI] 비속어 패턴 (마스킹 처리) - GPT-4.1 엄선
PROFANITY_PATTERNS = [
    # ========== 기본 욕설 ==========
    r"씨발", r"시발", r"씨bal", r"ㅅㅂ", r"ㅆㅂ",
    r"개새끼", r"개새", r"개색", r"ㄱㅅㄲ",
    r"병신", r"ㅂㅅ", r"븅신",
    r"지랄", r"ㅈㄹ", r"지랄한다",
    r"좆", r"ㅈㅇ", r"좆같다", r"좆밥", r"좆망", r"좆도", r"좆나", r"좆같이",
    r"니미", r"느금마", r"느금",
    r"엠창", r"애미", r"애비",
    r"새끼", r"ㅅㄲ",
    r"꺼져", r"닥쳐", r"죽어",
    # ========== 비하 표현 ==========
    r"장애인", r"정신병자", r"미친놈", r"미친년",
    r"찐따", r"루저", r"병자",
    r"정신나간", r"또라이", r"멍청이", r"꼴통",
    r"쌍놈", r"쌍년", r"양아치",
    # ========== 정치 관련 비속어 (GPT-4.1 추가) ==========
    r"개XX", r"쓰레기", r"꼴값",
    r"죽여버린다", r"후려친다",
    r"씨방새", r"개망신", r"개판",
    r"개소리", r"개뻥", r"개같이", r"개지랄", r"개돼지",
    r"쪽팔린다", r"빡친다", r"빡대가리", r"염병",
    r"죽일놈", r"더러운 놈",
    r"X같다", r"X발", r"X신", r"X놈", r"X년",
    r"정치깡패", r"정치모리배", r"정치쓰레기",
    r"정치사기꾼", r"정치깡패들", r"정치양아치", r"정치개입질",
]

# [advice from AI] 민감 정보 패턴 (마스킹 처리) - GPT-4.1 엄선
SENSITIVE_PATTERNS = [
    # ========== 기본 개인정보 ==========
    (r"\d{6}[-\s]?\d{7}", "[주민번호]"),                    # 주민등록번호
    (r"\d{3}[-\s]?\d{4}[-\s]?\d{4}", "[전화번호]"),         # 전화번호
    (r"\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4}", "[전화번호]"),     # 전화번호 변형
    (r"\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}", "[카드번호]"),  # 카드번호
    (r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", "[이메일]"),  # 이메일
    (r"\d{3}[-\s]?\d{2}[-\s]?\d{5}", "[사업자번호]"),       # 사업자등록번호
    # ========== GPT-4.1 추가 패턴 ==========
    (r"\d{2,4}-\d{2,4}-\d{2,4}-\d{2,4}", "[계좌번호]"),     # 계좌번호
    (r"\d{16,19}", "[카드번호]"),                           # 카드번호 (연속)
    (r"\d{2,3}[가-힣]{1}\d{4}", "[차량번호]"),              # 차량번호
    (r"M[0-9]{8}", "[여권번호]"),                           # 여권번호
    (r"[A-Z]{2}[0-9]{7}", "[여권번호]"),                    # 여권번호 변형
    (r"\d{2}-\d{2}-\d{6}-\d{2}", "[운전면허]"),             # 운전면허번호
    # ========== 개인정보 언급 패턴 ==========
    (r"[가-힣]{2,4}\s*씨의\s*주소는", "[개인주소]"),
    (r"[가-힣]{2,4}\s*의\s*휴대폰번호는", "[휴대전화]"),
    (r"[가-힣]{2,4}\s*의\s*계좌번호는", "[계좌번호]"),
    (r"[가-힣]{2,4}\s*의\s*비밀번호는", "[비밀번호]"),
    (r"[가-힣]{2,4}\s*의\s*주민등록번호는", "[주민번호]"),
    (r"[가-힣]{2,4}\s*의\s*카드번호는", "[카드번호]"),
]

# 컴파일된 비속어 패턴 (정적)
COMPILED_PROFANITY = [re.compile(p, re.IGNORECASE) for p in PROFANITY_PATTERNS]

# [advice from AI] ★ JSON 비속어 패턴 캐시
_compiled_json_profanity_cache = None
_json_profanity_mtime = 0

def _get_compiled_profanity_patterns():
    """정적 비속어 + JSON 비속어 패턴 병합"""
    global _compiled_json_profanity_cache, _json_profanity_mtime
    
    try:
        current_mtime = _os.path.getmtime(_DATA_FILE)
    except OSError:
        current_mtime = 0
    
    # 캐시 갱신 필요 여부 확인
    if _compiled_json_profanity_cache is None or _json_profanity_mtime != current_mtime:
        json_profanity = _load_json_profanity()
        
        # 정적 패턴 + JSON 패턴 병합 (중복 제거)
        all_patterns = list(PROFANITY_PATTERNS) + [p for p in json_profanity if p not in PROFANITY_PATTERNS]
        
        _compiled_json_profanity_cache = []
        for p in all_patterns:
            try:
                _compiled_json_profanity_cache.append(re.compile(re.escape(p), re.IGNORECASE))
            except re.error as e:
                logger.warning(f"⚠️ 잘못된 비속어 패턴 스킵: {p} - {e}")
        
        _json_profanity_mtime = current_mtime
        logger.info(f"🔄 비속어 패턴 재컴파일: 정적 {len(PROFANITY_PATTERNS)}개 + JSON {len(json_profanity)}개 = 총 {len(_compiled_json_profanity_cache)}개")
    
    return _compiled_json_profanity_cache


def filter_profanity(text: str, replacement: str = "***") -> tuple:
    """
    [advice from AI] 비속어 필터링 (정적 사전 + JSON 사전 병합)
    
    Args:
        text: 원본 텍스트
        replacement: 대체 문자열
    
    Returns:
        (필터링된 텍스트, 필터링된 단어 수)
    """
    if not text:
        return text, 0
    
    result = text
    count = 0
    
    # [advice from AI] ★ 동적으로 JSON 비속어 포함하여 필터링
    for pattern in _get_compiled_profanity_patterns():
        matches = pattern.findall(result)
        if matches:
            count += len(matches)
            result = pattern.sub(replacement, result)
    
    return result, count


def filter_sensitive_info(text: str) -> tuple:
    """
    [advice from AI] 민감 정보 필터링 (개인정보 보호)
    
    Args:
        text: 원본 텍스트
    
    Returns:
        (필터링된 텍스트, 필터링된 항목 수)
    """
    if not text:
        return text, 0
    
    result = text
    count = 0
    
    for pattern, replacement in SENSITIVE_PATTERNS:
        matches = re.findall(pattern, result)
        if matches:
            count += len(matches)
            result = re.sub(pattern, replacement, result)
    
    return result, count


def apply_broadcast_safety_filter(text: str) -> str:
    """
    [advice from AI] 방송 안전 필터 (비속어 + 민감정보)
    
    Args:
        text: 원본 텍스트
    
    Returns:
        필터링된 텍스트
    """
    if not text:
        return text
    
    # 1. 비속어 필터링
    result, profanity_count = filter_profanity(text)
    
    # 2. 민감 정보 필터링
    result, sensitive_count = filter_sensitive_info(result)
    
    if profanity_count > 0 or sensitive_count > 0:
        logger.warning(
            f"🚨 방송 안전 필터 적용: 비속어 {profanity_count}개, 민감정보 {sensitive_count}개"
        )
    
    return result


def replace_music_with_label(text: str) -> str:
    """
    [advice from AI] 텍스트에서 음악 패턴을 레이블로 대체
    
    Args:
        text: 원본 텍스트
    
    Returns:
        음악 패턴이 [♪]로 대체된 텍스트
    """
    result = text
    
    # 음표 기호 → [♪]
    result = re.sub(r'[♪♫🎵🎶🎤🎼]+', '[♪]', result)
    
    # 영어 음악 표현 정규화
    result = re.sub(r'\[?music\]?|\(music\)|\[music playing\]|\(music playing\)', '[♪]', result, flags=re.IGNORECASE)
    result = re.sub(r'\[?singing\]?|\(singing\)', '[♪ 노래]', result, flags=re.IGNORECASE)
    
    # 연속된 [♪] 합치기
    result = re.sub(r'(\[♪\]\s*)+', '[♪] ', result)
    
    return result.strip()


# =============================================================================
# [advice from AI] 1단계: 할루시네이션 필터
# =============================================================================

# [advice from AI] 알려진 할루시네이션 패턴 (정규식) - GPT-4.1 엄선 + 대규모 확장
HALLUCINATION_PATTERNS = [
    # ==========================================================================
    # ★★★ 영어 할루시네이션 (YouTube/영상 관련) ★★★
    # ==========================================================================
    r"^thank you( for watching)?\.?$",
    r"^thanks for watching\.?$",
    r"^please subscribe\.?$",
    r"^like and subscribe\.?$",
    r"^see you next time\.?$",
    r"^bye\.?$",
    r"^goodbye\.?$",
    r"^(Hello|Hi|Thank you|Subscribe|Like|Please subscribe|See you next time)[.!]?$",
    r"^don't forget to (like|subscribe|comment).*$",
    r"^hit the (like|subscribe|notification|bell).*$",
    r"^smash (the|that) (like|subscribe).*$",
    r"^leave a (like|comment).*$",
    r"^click the (subscribe|bell|link).*$",
    r"^check out (my|our|the) (channel|video|link).*$",
    r"^follow (me|us) on.*$",
    r"^see you in the next (one|video|episode)\.?$",
    r"^until next time\.?$",
    r"^peace\.?$",
    r"^take care\.?$",
    r"^have a (good|nice|great) (day|one)\.?$",
    r"^stay tuned\.?$",
    r"^watch more videos\.?$",
    r"^more videos coming soon\.?$",
    r"^new video every.*$",
    r"^upload.*every.*$",
    
    # ========== 영어 자막/편집 크레딧 (핵심 필터) ==========
    r".*subtitl(e|ed|ing|es)?\s*(by|:).*",
    r".*transcrib(e|ed|ing|es)?\s*(by|:).*",
    r".*edit(ed|ing|or|s)?\s*(by|:).*",
    r".*translat(e|ed|ing|ion|or|s)?\s*(by|:).*",
    r".*caption(ed|s|ing)?\s*(by|:).*",
    r".*creat(e|ed|ing|or|s)?\s*(by|:).*",
    r".*produc(e|ed|ing|er|tion)?\s*(by|:).*",
    r".*direct(ed|or|ing)?\s*(by|:).*",
    r".*writt(en|ing)?\s*(by|:).*",
    r".*narrat(e|ed|ing|or)?\s*(by|:).*",
    r".*present(ed|ing|er)?\s*(by|:).*",
    r".*host(ed|ing)?\s*(by|:).*",
    r".*powered\s*by.*",
    r".*sponsored\s*by.*",
    r".*brought\s*to\s*you\s*by.*",
    r".*made\s*(possible\s*)?\s*by.*",
    r".*courtesy\s*of.*",
    r".*copyright.*",
    r".*©.*",
    r".*all\s*rights\s*reserved.*",
    r"^[a-zA-Z]{2,}( [a-zA-Z]{2,}){0,4}[.!]?$",  # 짧은 영어 문장
    
    # ========== 영어 기타 패턴 ==========
    r"^(okay|ok|yes|no|um|uh|oh|ah|hmm|huh|well|so|like|you know)\.?$",
    r"^(i mean|basically|actually|literally|honestly)\.?$",
    r"^one moment( please)?\.?$",
    r"^just a (moment|second|sec)\.?$",
    r"^hold on\.?$",
    r"^wait\.?$",
    r"^let me (see|think|check)\.?$",
    r"^what\?$",
    r"^sorry\??$",
    r"^excuse me\??$",
    r"^pardon\??$",
    r"^right\.?$",
    r"^exactly\.?$",
    r"^indeed\.?$",
    r"^absolutely\.?$",
    r"^definitely\.?$",
    r"^of course\.?$",
    r"^sure\.?$",
    r"^anyway(s)?\.?$",
    r"^moving on\.?$",
    r"^next\.?$",
    r"^and\.{0,3}$",
    r"^but\.{0,3}$",
    r"^so\.{0,3}$",
    r"^now\.{0,3}$",
    r"^then\.{0,3}$",
    r"^here\.{0,3}$",
    r"^there\.{0,3}$",
    
    # ==========================================================================
    # ★★★ 한국어 할루시네이션 (YouTube/영상 관련) ★★★
    # ==========================================================================
    r"^구독.*좋아요.*눌러.*$",
    r"^시청해\s*주셔서\s*감사합니다\.?$",
    r"^감사합니다\.?$",
    r"^다음에\s*봐요\.?$",
    r"^안녕히\s*계세요\.?$",
    r"^구독(과)? 좋아요( 부탁드립니다)?\.?$",
    r"^좋아요(와|랑)? 구독( 부탁드립니다)?\.?$",
    r"^채널을?\s*구독해?\s*주세요\.?$",
    r"^다음에\s*또\s*만나요\.?$",
    r"^안녕하세요\.?$",
    r"^헬로우(\.|\!)?$",
    r".*구독.*알림\s*설정.*",
    r".*좋아요.*눌러.*",
    r".*구독\s*버튼.*",
    r".*알림\s*버튼.*",
    r".*종\s*모양.*",
    r".*댓글.*남겨.*",
    r".*영상.*끝까지.*봐.*",
    r".*채널.*방문.*",
    r".*링크.*확인.*",
    r"^다음\s*영상에서\s*만나(요|겠습니다|보겠습니다)?\.?$",
    r"^다음\s*시간에\s*만나(요|겠습니다)?\.?$",
    r"^다음\s*편에서\s*(만나요|봐요|뵙겠습니다)?\.?$",
    r"^영상\s*봐\s*주셔서\s*감사합니다\.?$",
    r"^시청\s*감사합니다\.?$",
    r"^끝까지\s*시청해\s*주셔서\s*감사합니다\.?$",
    r"^오늘\s*영상은\s*여기까지(입니다|예요)?\.?$",
    r"^오늘은\s*여기까지(입니다|예요)?\.?$",
    r"^여기까지(입니다|예요)?\.?$",
    r"^좋은\s*하루\s*(되세요|보내세요)\.?$",
    r"^좋은\s*밤\s*(되세요|보내세요)\.?$",
    r"^행복한\s*하루\s*(되세요|보내세요)\.?$",
    r"^즐거운\s*(하루|시간)\s*(되세요|보내세요)\.?$",
    
    # ==========================================================================
    # ★★★ 한국어 자막/편집 크레딧 (핵심 필터) ★★★
    # ==========================================================================
    r".*자막\s*(제작|편집|번역|감수)\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*자막\s*[:|-]\s*[가-힣a-zA-Z]+.*",
    r".*편집\s*(자|자막|영상)?\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*편집자\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*영상\s*편집\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*번역\s*(자)?\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*번역자\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*감수\s*(자)?\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*제작\s*(자)?\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*촬영\s*(자)?\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*연출\s*(자)?\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*기획\s*(자)?\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*진행\s*(자)?\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*나레이션\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*성우\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*해설\s*(자)?\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*출연\s*(자)?\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*협찬\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*후원\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*스폰서\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*제공\s*[:|-]?\s*[가-힣a-zA-Z]+.*",
    r".*저작권\s*[:|-]?\s*.*",
    r".*ⓒ.*",
    r".*무단\s*(복제|전재|배포)\s*(금지)?.*",
    r".*all\s*rights?\s*reserved.*",
    
    # ========== 한국어 자막 단독 문구 ==========
    r"^자막.*$",
    r"^subtitle.*$",
    r"^caption.*$",
    r"^자막\s*[가-힣]{2,4}$",
    r"^편집\s*[가-힣]{2,4}$",
    r"^번역\s*[가-힣]{2,4}$",
    r"^[가-힣]{2,4}\s*자막$",
    r"^[가-힣]{2,4}\s*편집$",
    r"^[가-힣]{2,4}\s*번역$",
    
    # ==========================================================================
    # ★★★ 한국어 일반 할루시네이션 ★★★
    # ==========================================================================
    r"^(네|예)\.?$",
    r"^(네|예),?\s*알겠습니다\.?$",
    r"^(네|예),?\s*감사합니다\.?$",
    r"^(네|예),?\s*이상입니다\.?$",
    r"^이상입니다\.?$",
    r"^(이|그|저)것은(요)?$",
    r"^이상으로\s*마치겠습니다\.?$",
    r"^(네|예),?\s*잠시만(요)?\.?$",
    r"^(네|예),?\s*잠깐만(요)?\.?$",
    r"^(네|예),?\s*준비가?\s*(되었습니다|됐습니다)\.?$",
    r"^(네|예),?\s*준비\s*중(입니다)?\.?$",
    r"^(네|예),?\s*연결(이|이요)?\s*(되었습니다|됐습니다|끊겼습니다)\.?$",
    r"^(네|예),?\s*연결\s*중(입니다)?\.?$",
    
    # ========== 한국어 짧은 응답/추임새 ==========
    r"^아\.?$",
    r"^어\.?$",
    r"^음\.?$",
    r"^응\.?$",
    r"^네\.?$",
    r"^예\.?$",
    r"^뭐\.?$",
    r"^왜\.?$",
    r"^뭐요\??$",
    r"^왜요\??$",
    r"^그래(요)?\.?$",
    r"^그렇죠\.?$",
    r"^그러니까(요)?\.?$",
    r"^그러게(요)?\.?$",
    r"^맞아(요)?\.?$",
    r"^정말(요)?\??$",
    r"^진짜(요)?\??$",
    r"^그러네(요)?\.?$",
    r"^아니(요)?\.?$",
    r"^글쎄(요)?\.?$",
    r"^잠깐(만)?(요)?\.?$",
    r"^잠시(만)?(요)?\.?$",
    r"^저기(요)?\.?$",
    r"^여기(요)?\.?$",
    r"^거기(요)?\.?$",
    
    # ========== 한국어 의미없는 문장 조각 ==========
    r"^것처럼\.?$",
    r"^것\s*같습니다\.?$",
    r"^있는\s*겁니다\.?$",
    r"^되겠습니다\.?$",
    r"^것입니다\.?$",
    r"^합니다\.?$",
    r"^입니다\.?$",
    r"^습니다\.?$",
    r"^니다\.?$",
    r"^데요\.?$",
    r"^거든요\.?$",
    r"^잖아요\.?$",
    r"^인데(요)?\.?$",
    r"^라고(요)?\.?$",
    r"^니까(요)?\.?$",
    r"^지만(요)?\.?$",
    r"^그래서(요)?\.?$",
    r"^그런데(요)?\.?$",
    r"^그리고(요)?\.?$",
    r"^하지만(요)?\.?$",
    r"^그러면(요)?\.?$",
    r"^그러나(요)?\.?$",
    r"^많은\.?$",
    r"^3회\.?$",
    r"^이\s*시각\s*세계였습니다\.?$",
    
    # ==========================================================================
    # ★★★ 반복 패턴 ★★★
    # ==========================================================================
    r"^(네|예)(\s*(네|예)){2,}\.?$",
    r"^(음|어|음음|어어)+$",
    r"^(네네네|예예예|네네|예예)+$",
    r"^(아아아|어어어|음음음)+$",
    r"^(하하|히히|호호|허허|후후)+$",
    r"^(ㅎㅎ|ㅋㅋ|ㅎㅎㅎ|ㅋㅋㅋ)+$",
    r"^(.)\1{3,}$",  # 같은 글자 4회 이상 반복
    r"^(.{2,5})\s*\1(\s*\1)*$",  # 같은 문구 반복
    
    # ==========================================================================
    # ★★★ 중국어 할루시네이션 ★★★
    # ==========================================================================
    r"^谢谢.*$",
    r"^[\u4e00-\u9fff]{2,15}$",  # 중국어 문자만 (2~15자)
    r"^(谢谢|你好|再见|请|是的|好的|对|不是|没有|可以|谢谢观看|订阅|点赞).*$",
    r".*感谢\s*收看.*",
    r".*感谢\s*观看.*",
    r".*请\s*订阅.*",
    r".*请\s*点赞.*",
    r".*字幕\s*[:：].*",
    r".*翻译\s*[:：].*",
    r".*编辑\s*[:：].*",
    r".*制作\s*[:：].*",
    
    # ==========================================================================
    # ★★★ 일본어 할루시네이션 ★★★
    # ==========================================================================
    r"^ありがとう.*$",
    r"^[\u3040-\u30ff]{2,15}$",  # 히라가나/가타카나만 (2~15자)
    r"^(こんにちは|こんばんは|おはよう|さようなら|ありがとう|はい|いいえ|そうです|そうですね).*$",
    r".*ご視聴.*ありがとう.*",
    r".*チャンネル登録.*",
    r".*高評価.*",
    r".*字幕\s*[:：].*",
    r".*翻訳\s*[:：].*",
    r".*編集\s*[:：].*",
    r".*制作\s*[:：].*",
    
    # ==========================================================================
    # ★★★ 특수 문자/기호 ★★★
    # ==========================================================================
    r"^[\s\.\,\!\?\-\~\♪\♫\🎵\🎶\…\*\#\@\&\%\$\^\=\+\_\|\\\[\]\{\}\<\>\'\"\`]+$",
    r"^\.{2,}$",
    r"^\s*$",
    r"^[-_=+*#@!?.,;:]{2,}$",
    r"^\(.*\)$",  # 괄호만 있는 텍스트
    r"^\[.*\]$",  # 대괄호만 있는 텍스트
    r"^「.*」$",
    r"^『.*』$",
    r"^《.*》$",
    r"^【.*】$",
    
    # ==========================================================================
    # ★★★ 무음/배경음/효과음 ★★★
    # ==========================================================================
    r"^음성\s*없음\.?$",
    r"^무음\.?$",
    r"^침묵\.?$",
    r"^(박수|환호|음악|웃음|울음|탄성|한숨|기침|재채기|딸꾹질)(\s*소리)?\.?$",
    r"^박수\s*갈채\.?$",
    r"^배경\s*음악\.?$",
    r"^배경음\.?$",
    r"^효과음\.?$",
    r"^잡음\.?$",
    r"^소음\.?$",
    r"^테스트(입니다)?\.?$",
    r"^마이크\s*테스트\.?$",
    r"^사운드\s*테스트\.?$",
    r"^음성\s*테스트\.?$",
    r"^\[음악\]$",
    r"^\[박수\]$",
    r"^\[웃음\]$",
    r"^\[침묵\]$",
    r"^\(음악\)$",
    r"^\(박수\)$",
    r"^\(웃음\)$",
    r"^\(침묵\)$",
    r"^♪.*♪$",
    r"^🎵.*🎵$",
    
    # ==========================================================================
    # ★★★ 기타 일반 할루시네이션 ★★★
    # ==========================================================================
    # 회의/방송 관련
    r"^화면이?\s*전환(됩니다|되었습니다)?\.?$",
    r"^영상이?\s*시작(됩니다|되었습니다)?\.?$",
    r"^영상이?\s*종료(됩니다|되었습니다)?\.?$",
    r"^방송이?\s*시작(됩니다|되었습니다)?\.?$",
    r"^방송이?\s*종료(됩니다|되었습니다)?\.?$",
    r"^잠시\s*후에?\s*(계속됩니다|돌아오겠습니다)\.?$",
    r"^잠시\s*후\.?$",
    r"^광고\s*후에?\s*(계속됩니다|돌아오겠습니다)\.?$",
    
    # 숫자/시간 단독
    r"^\d+\.?$",
    r"^\d+:\d+\.?$",
    r"^\d+분\.?$",
    r"^\d+초\.?$",
    r"^\d+시\.?$",
    
    # 문장부호/이모지 단독
    r"^[\!\?\.]+$",
    r"^[\u2600-\u26FF\u2700-\u27BF\U0001F300-\U0001F9FF]+$",  # 이모지만
    
    # 기타 무의미 패턴
    r"^[ㄱ-ㅎㅏ-ㅣ]+$",  # 자음/모음만
    r"^[a-zA-Z]$",  # 단일 알파벳
    r"^[가-힣]$",  # 단일 한글
    
    # ==========================================================================
    # ★★★ 팟캐스트/라디오 관련 ★★★
    # ==========================================================================
    r".*청취해\s*주셔서\s*감사.*",
    r".*들어주셔서\s*감사.*",
    r".*애청자\s*여러분.*",
    r".*시청자\s*여러분.*",
    r".*구독자\s*여러분.*",
    r".*청취자\s*여러분.*",
    r"^이\s*시간\s*마치겠습니다\.?$",
    r"^지금까지\s*.*였습니다\.?$",
    r"^다음\s*시간에\s*뵙겠습니다\.?$",
    r"^다음\s*주에\s*(만나요|뵙겠습니다)\.?$",
    
    # ==========================================================================
    # ★★★ 일반적인 묵음 구간 할루시네이션 ★★★
    # ==========================================================================
    r"^\.{3,}$",  # 말줄임표
    r"^-{3,}$",   # 대시 반복
    r"^_{3,}$",   # 밑줄 반복
    r"^~{2,}$",   # 물결 반복
    r"^\*{2,}$",  # 별표 반복
    
    # ==========================================================================
    # ★★★ 스페인어/프랑스어/독일어 할루시네이션 ★★★
    # ==========================================================================
    r"^(gracias|hola|adiós|por favor|sí|no)\.?$",
    r"^(merci|bonjour|au revoir|s'il vous plaît|oui|non)\.?$",
    r"^(danke|hallo|auf wiedersehen|bitte|ja|nein)\.?$",
    r".*subtítulos\s*por.*",
    r".*sous-titres\s*par.*",
    r".*untertitel\s*von.*",
    
    # ==========================================================================
    # ★★★ 추가 한국어 뉴스/방송 할루시네이션 ★★★
    # ==========================================================================
    r"^지금까지\s*.+\s*기자였습니다\.?$",
    r"^.+\s*기자의\s*보도였습니다\.?$",
    r"^.+에서\s*전해드렸습니다\.?$",
    r"^뉴스였습니다\.?$",
    r"^보도였습니다\.?$",
    r"^속보입니다\.?$",
    r"^긴급\s*속보\.?$",
    r"^.+\s*아나운서였습니다\.?$",
    r"^앵커였습니다\.?$",
    r"^이상\s*.+\s*뉴스였습니다\.?$",
]

# [advice from AI] 컴파일된 패턴 - 동적 업데이트 지원 (JSON 파일 포함)
_compiled_patterns_cache = None
_patterns_version = 0
_json_patterns_mtime = 0  # JSON 파일 수정 시간 추적

# [advice from AI] JSON 데이터 파일 경로
import os as _os
_DATA_FILE = _os.path.join(_os.path.dirname(_os.path.dirname(__file__)), "data", "stt_dictionaries.json")

# [advice from AI] JSON 사전 캐시 (파일 수정 시간 기반 갱신)
_json_data_cache = None
_json_data_mtime = 0

def _load_json_data():
    """JSON 파일에서 전체 사전 데이터 로드 (캐싱 포함)"""
    global _json_data_cache, _json_data_mtime
    
    try:
        current_mtime = _os.path.getmtime(_DATA_FILE)
    except OSError:
        current_mtime = 0
    
    # 캐시가 유효하면 반환
    if _json_data_cache is not None and _json_data_mtime == current_mtime:
        return _json_data_cache
    
    try:
        import json
        with open(_DATA_FILE, 'r', encoding='utf-8') as f:
            _json_data_cache = json.load(f)
            _json_data_mtime = current_mtime
            logger.info(f"🔄 JSON 사전 데이터 로드: {_DATA_FILE}")
            return _json_data_cache
    except (FileNotFoundError, json.JSONDecodeError) as e:
        logger.warning(f"⚠️ JSON 사전 데이터 로드 실패: {e}")
        return {}

def _load_json_hallucination_patterns():
    """JSON 파일에서 할루시네이션 패턴 로드"""
    data = _load_json_data()
    return data.get('hallucination', [])

def _load_json_profanity():
    """JSON 파일에서 비속어 패턴 로드"""
    data = _load_json_data()
    return data.get('profanity', [])

def _load_json_abbreviations():
    """JSON 파일에서 약어 사전 로드 (key-value 형태)"""
    data = _load_json_data()
    items = data.get('abbreviations', [])
    result = {}
    for item in items:
        if isinstance(item, dict) and 'key' in item and 'value' in item:
            result[item['key']] = item['value']
    return result

def _load_json_proper_nouns():
    """JSON 파일에서 고유명사 사전 로드"""
    data = _load_json_data()
    items = data.get('proper_nouns', [])
    result = {}
    for item in items:
        if isinstance(item, dict) and 'key' in item and 'value' in item:
            result[item['key']] = item['value']
    return result

def _load_json_government_dict():
    """JSON 파일에서 정부 용어 사전 로드"""
    data = _load_json_data()
    items = data.get('government_dict', [])
    result = {}
    for item in items:
        if isinstance(item, dict) and 'key' in item and 'value' in item:
            result[item['key']] = item['value']
    return result

def _get_compiled_patterns():
    """런타임에 추가된 패턴도 포함하여 컴파일 (JSON 파일 패턴 포함)"""
    global _compiled_patterns_cache, _patterns_version, _json_patterns_mtime
    
    # [advice from AI] JSON 파일 수정 시간 확인
    try:
        current_mtime = _os.path.getmtime(_DATA_FILE)
    except OSError:
        current_mtime = 0
    
    # 정적 패턴 + JSON 패턴 병합
    json_patterns = _load_json_hallucination_patterns()
    all_patterns = list(HALLUCINATION_PATTERNS) + [p for p in json_patterns if p not in HALLUCINATION_PATTERNS]
    current_version = len(all_patterns)
    
    # 캐시 갱신 조건: 패턴 수 변경 또는 JSON 파일 수정
    if (_compiled_patterns_cache is None or 
        _patterns_version != current_version or 
        _json_patterns_mtime != current_mtime):
        
        _compiled_patterns_cache = []
        for p in all_patterns:
            try:
                _compiled_patterns_cache.append(re.compile(p, re.IGNORECASE))
            except re.error as e:
                logger.warning(f"⚠️ 잘못된 정규식 패턴 스킵: {p} - {e}")
        
        _patterns_version = current_version
        _json_patterns_mtime = current_mtime
        logger.info(f"🔄 할루시네이션 패턴 재컴파일: 정적 {len(HALLUCINATION_PATTERNS)}개 + JSON {len(json_patterns)}개 = 총 {len(_compiled_patterns_cache)}개")
    
    return _compiled_patterns_cache

# 하위 호환성 유지
COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE) for p in HALLUCINATION_PATTERNS]


def is_hallucination(text: str) -> bool:
    """
    할루시네이션 여부 확인
    
    Args:
        text: 검사할 텍스트
    
    Returns:
        True if hallucination, False otherwise
    """
    if not text:
        return True
    
    text = text.strip()
    
    # 1. 너무 짧은 텍스트 (1~2글자)
    if len(text) <= 2:
        logger.debug(f"Filtered (too short): {text}")
        return True
    
    # [advice from AI] 2. 알려진 할루시네이션 패턴 - 동적 업데이트 지원!
    for pattern in _get_compiled_patterns():
        if pattern.match(text):
            logger.info(f"🚫 [할루시네이션 필터] 걸림: {text}")
            return True
    
    # 3. 동일 단어/문구 반복 (3회 이상)
    words = text.split()
    if len(words) >= 3:
        for i in range(len(words) - 2):
            if words[i] == words[i+1] == words[i+2]:
                logger.debug(f"Filtered (repeated words): {text}")
                return True
    
    # 4. 전체 텍스트 반복 패턴 (예: "안녕 안녕 안녕")
    if len(words) >= 2:
        unique_words = set(words)
        if len(unique_words) == 1:
            logger.debug(f"Filtered (all same words): {text}")
            return True
    
    return False


def clean_text(text: str, preserve_music_labels: bool = True) -> str:
    """
    텍스트 정리
    
    Args:
        text: 정리할 텍스트
        preserve_music_labels: 음악 레이블 유지 여부
    
    Returns:
        정리된 텍스트
    """
    if not text:
        return ""
    
    # 앞뒤 공백 제거
    text = text.strip()
    
    # 연속 공백을 하나로
    text = re.sub(r'\s+', ' ', text)
    
    # [advice from AI] 음악 처리: 제거 대신 레이블로 변환
    if preserve_music_labels:
        text = replace_music_with_label(text)
    else:
        # 음표 기호 제거 (기존 방식)
        text = re.sub(r'[♪♫🎵🎶]+', '', text)
    
    # 앞뒤 마침표/쉼표 정리
    text = text.strip('.,!? ')
    
    return text


# =============================================================================
# [advice from AI] 2단계: 사전 매칭 (숫자/약어 변환)
# =============================================================================

# 약어 변환 사전 (음성 → 텍스트)
ABBREVIATION_DICT = {
    # ============ IT/기술 관련 ============
    "아이엠에프": "IMF",
    "에이아이": "AI",
    "케이피아이": "KPI",
    "비피에스": "BPS",
    "이피에스": "EPS",
    "디비": "DB",
    "유아이": "UI",
    "유엑스": "UX",
    "에이피아이": "API",
    "에스디케이": "SDK",
    "씨디엔": "CDN",
    "브이피엔": "VPN",
    "아이피": "IP",
    "티씨피": "TCP",
    "유디피": "UDP",
    "에이치티티피": "HTTP",
    "에이치티티피에스": "HTTPS",
    "제이에스오엔": "JSON",
    "엑스엠엘": "XML",
    "씨에스에스": "CSS",
    "에이치티엠엘": "HTML",
    "씨피유": "CPU",
    "지피유": "GPU",
    "램": "RAM",
    "에스에스디": "SSD",
    "에이치디디": "HDD",
    "엘엘엠": "LLM",
    "지피티": "GPT",
    "엔엘피": "NLP",
    "엠엘": "ML",
    "디엘": "DL",
    "에스티티": "STT",
    "티티에스": "TTS",
    "오씨알": "OCR",
    
    # ============ 비즈니스 관련 ============
    "비투비": "B2B",
    "비투씨": "B2C",
    "시투씨": "C2C",
    "오투오": "O2O",
    "알앤디": "R&D",
    "엠앤에이": "M&A",
    "아이피오": "IPO",
    "피알": "PR",
    "에이치알": "HR",
    "씨이오": "CEO",
    "씨에프오": "CFO",
    "씨티오": "CTO",
    "씨오오": "COO",
    "브이피": "VP",
    "지엠": "GM",
    "피디": "PD",
    "피엠": "PM",
    "오케이알": "OKR",
    "에스오피": "SOP",
    "아르오아이": "ROI",
    "피앤엘": "P&L",
    
    # ============ 금융 관련 ============
    "퍼센트": "%",
    "프로": "%",
    "달러": "$",
    "유에스디": "USD",
    "케이알더블유": "KRW",
    "제이피와이": "JPY",
    "씨엔와이": "CNY",
    "유로": "EUR",
    
    # ============ 회의/Zoom 관련 ============
    "줌": "Zoom",
    "줌 회의": "Zoom 회의",
    "화상회의": "화상회의",
    "미팅": "미팅",
    "콜": "콜",
    "컨퍼런스": "컨퍼런스",
    "웨비나": "웨비나",
    "브레이크아웃": "브레이크아웃",
    "스크린쉐어": "화면공유",
    "뮤트": "음소거",
    "언뮤트": "음소거 해제",
    
    # ============ 기타 ============
    "오케이": "OK",
    "엔지": "NG",
    "티비": "TV",
    "피씨": "PC",
    "유에스비": "USB",
    "와이파이": "WiFi",
    "블루투스": "Bluetooth",
    "큐알": "QR",
    "이메일": "이메일",
    "유알엘": "URL",
    
    # ============ 영어 발음 → 약어 ============
    "R and D": "R&D",
    "r and d": "R&D",
    "R & D": "R&D",
    "M and A": "M&A",
    "m and a": "M&A",
    "P and L": "P&L",
    "fifty percent": "50%",
    "twenty percent": "20%",
    "thirty percent": "30%",
    "one hundred percent": "100%",
    
    # ============ 국제기구/정치 약어 (GPT-4.1 추가) ============
    "오이시디": "OECD",
    "더블유티오": "WTO",
    "에프티에이": "FTA",
    "알씨이피": "RCEP",
    "티피피": "TPP",
    "에스디지에스": "SDGs",
    "에이아이아이비": "AIIB",
    "에이디비": "ADB",
    "에이펙": "APEC",
    "씨오피": "COP",
    "엔디씨": "NDC",
    "지디피": "GDP",
    "지엔피": "GNP",
    
    # ============ 정부기관 영문 약어 (GPT-4.1 추가) ============
    "모에프": "MOEF",      # 기획재정부
    "모이스": "MOIS",      # 행정안전부
    "모파": "MOFA",        # 외교부
    "모유": "MOU",         # 통일부
    "모제이": "MOJ",       # 법무부
    "엠엔디": "MND",       # 국방부
    "모히트": "MOLIT",     # 국토교통부
    "모에이치더블유": "MOHW",  # 보건복지부
    "케이디아이": "KDI",    # 한국개발연구원
    "엔아이에스": "NIS",    # 국가정보원
    "비에이아이": "BAI",    # 감사원
    "케이에프티씨": "KFTC", # 공정거래위원회
    "에프에스에스": "FSS",  # 금융감독원
}

# =============================================================================
# [advice from AI] 국회/국무회의 전문 용어 사전
# =============================================================================

# 오인식 교정 사전 (자주 잘못 인식되는 용어)
GOVERNMENT_CORRECTION_DICT = {
    # ============ 회의 용어 오인식 교정 ============
    "국민의뢰": "국민의례",
    "국민 의뢰": "국민의례",
    "국민이례": "국민의례",
    "공모회의": "국무회의",
    "국모회의": "국무회의",
    "국무 회의": "국무회의",
    "성령": "의장",  # 문맥상 "의장께서"
    "성령께서": "의장께서",
    "개의": "개의",  # 회의 시작
    "폐의": "폐회",
    "페회": "폐회",
    
    # ============ 직책명 ============
    "대통영": "대통령",
    "대퉁령": "대통령",
    "국무총니": "국무총리",
    "국무 총리": "국무총리",
    "부총니": "부총리",
    "장관님": "장관",
    "차관님": "차관",
    "청장님": "청장",
    
    # ============ 정부 기관명 ============
    "기회재정부": "기획재정부",
    "기획 재정부": "기획재정부",
    "외교부": "외교부",
    "국방부": "국방부",
    "행정안전부": "행정안전부",
    "행안부": "행정안전부",
    "문체부": "문화체육관광부",
    "문화체육 관광부": "문화체육관광부",
    "농식품부": "농림축산식품부",
    "산업부": "산업통상자원부",
    "산자부": "산업통상자원부",
    "복지부": "보건복지부",
    "환경부": "환경부",
    "고용부": "고용노동부",
    "여가부": "여성가족부",
    "국토부": "국토교통부",
    "해수부": "해양수산부",
    "중기부": "중소벤처기업부",
    "과기부": "과학기술정보통신부",
    "과기정통부": "과학기술정보통신부",
    "법무부": "법무부",
    "교육부": "교육부",
    "통일부": "통일부",
    
    # ============ 국회 용어 ============
    "본회의": "본회의",
    "상임위": "상임위원회",
    "상임 위원회": "상임위원회",
    "특위": "특별위원회",
    "특별 위원회": "특별위원회",
    "예결위": "예산결산특별위원회",
    "법사위": "법제사법위원회",
    "정무위": "정무위원회",
    "기재위": "기획재정위원회",
    "국방위": "국방위원회",
    "행안위": "행정안전위원회",
    "문체위": "문화체육관광위원회",
    "농해수위": "농림축산식품해양수산위원회",
    "산자위": "산업통상자원중소벤처기업위원회",
    "복지위": "보건복지위원회",
    "환노위": "환경노동위원회",
    "국토위": "국토교통위원회",
    "교육위": "교육위원회",
    "과방위": "과학기술정보방송통신위원회",
    "외통위": "외교통일위원회",
    "여가위": "여성가족위원회",
    "정보위": "정보위원회",
    "윤리위": "윤리특별위원회",
    
    # ============ 법률/행정 용어 ============
    "의안": "의안",
    "법률안": "법률안",
    "법률 안": "법률안",
    "시행령": "시행령",
    "시행 령": "시행령",
    "대통령령": "대통령령",
    "대통령 령": "대통령령",
    "동의안": "동의안",
    "동의 안": "동의안",
    "결의안": "결의안",
    "결의 안": "결의안",
    "건의안": "건의안",
    "예산안": "예산안",
    "예산 안": "예산안",
    "추경": "추가경정예산",
    "추경안": "추가경정예산안",
    "본예산": "본예산",
    
    # ============ 회의 진행 용어 (GPT-4.1 보강) ============
    "가결": "가결",
    "부결": "부결",
    "재적": "재적",
    "출석": "출석",
    "찬성": "찬성",
    "반대": "반대",
    "기권": "기권",
    "의결": "의결",
    "의결 정족수": "의결정족수",
    "과반수": "과반수",
    "삼분의이": "3분의 2",
    "3분의 이": "3분의 2",
    "이의없음": "이의 없음",
    "이의 없음": "이의 없음",
    "만장일치": "만장일치",
    "표결": "표결",
    "기명투표": "기명투표",
    "무기명투표": "무기명투표",
    # GPT-4.1 추가
    "의사일정": "의사일정",
    "의사진행발언": "의사진행발언",
    "정회": "정회",
    "산회": "산회",
    "속개": "속개",
    "개회": "개회",
    "상정": "상정",
    "심사": "심사",
    "소위원회": "소위원회",
    "간사": "간사",
    "위원장": "위원장",
    "질의": "질의",
    "답변": "답변",
    "자료제출": "자료제출",
    "의사봉": "의사봉",
    "정족수": "정족수",
    "위원정수": "위원정수",
    "위원정족수": "위원정족수",
    "청원": "청원",
    "국정조사": "국정조사",
    "운영위원회": "운영위원회",
    
    # ============ 기타 정부 용어 ============
    "정책": "정책",
    "시책": "시책",
    "현안": "현안",
    "안건": "안건",
    "보고": "보고",
    "심의": "심의",
    "의결": "의결",
    "승인": "승인",
    "허가": "허가",
    "인가": "인가",
    "국정감사": "국정감사",
    "국정 감사": "국정감사",
    "국감": "국정감사",
    "청문회": "청문회",
    "청문 회": "청문회",
    "인사청문회": "인사청문회",
    "대정부질문": "대정부질문",
    "대정부 질문": "대정부질문",
}

# [advice from AI] 고유명사 사전 (인명/기관명/지명)
# [advice from AI] 고유명사 사전 - GPT-4.1 엄선 (국회/정치/의정활동)
PROPER_NOUN_DICT = {
    # ============ 역대 대통령 ============
    "이재명": "이재명",
    "이 재명": "이재명",
    "윤석열": "윤석열",
    "윤 석열": "윤석열",
    "문재인": "문재인",
    "박근혜": "박근혜",
    "이명박": "이명박",
    "노무현": "노무현",
    "김대중": "김대중",
    "김영삼": "김영삼",
    "전두환": "전두환",
    "노태우": "노태우",
    
    # ============ 국무총리/주요 정치인 (GPT-4.1 추가) ============
    "한덕수": "한덕수",
    "이낙연": "이낙연",
    "정세균": "정세균",
    "김기현": "김기현",
    "이준석": "이준석",
    "홍준표": "홍준표",
    "유승민": "유승민",
    "안철수": "안철수",
    "심상정": "심상정",
    "이정미": "이정미",
    "조국": "조국",
    "추미애": "추미애",
    "박용진": "박용진",
    "나경원": "나경원",
    "오세훈": "오세훈",
    "박영선": "박영선",
    "김동연": "김동연",
    "김진표": "김진표",
    
    # ============ 정당 (GPT-4.1 추가) ============
    "더불어민주당": "더불어민주당",
    "더민주": "더불어민주당",
    "민주당": "더불어민주당",
    "국민의힘": "국민의힘",
    "국힘": "국민의힘",
    "조국혁신당": "조국혁신당",
    "조국 혁신당": "조국혁신당",
    "개혁신당": "개혁신당",
    "진보당": "진보당",
    "정의당": "정의당",
    "국민의당": "국민의당",
    "녹색당": "녹색당",
    "기본소득당": "기본소득당",
    "시대전환": "시대전환",
    "노동당": "노동당",
    "새로운미래": "새로운미래",
    
    # ============ 주요 기관 ============
    "청와대": "청와대",
    "청아대": "청와대",
    "대통령실": "대통령실",
    "대통령 실": "대통령실",
    "용산청사": "용산청사",
    "국회의사당": "국회의사당",
    "국회 의사당": "국회의사당",
    "헌법재판소": "헌법재판소",
    "헌재": "헌법재판소",
    "대법원": "대법원",
    "감사원": "감사원",
    "국정원": "국가정보원",
    "국가정보원": "국가정보원",
    "경찰청": "경찰청",
    "검찰청": "검찰청",
    "대검찰청": "대검찰청",
    "국세청": "국세청",
    "관세청": "관세청",
    "특허청": "특허청",
    "기상청": "기상청",
    "소방청": "소방청",
    "산림청": "산림청",
    "조달청": "조달청",
    "통계청": "통계청",
    "병무청": "병무청",
    "방위사업청": "방위사업청",
    "행정안전부": "행정안전부",
    
    # ============ 지역/지명 ============
    "서울특별시": "서울특별시",
    "서울시": "서울시",
    "부산광역시": "부산광역시",
    "부산시": "부산시",
    "대구광역시": "대구광역시",
    "대구시": "대구시",
    "인천광역시": "인천광역시",
    "인천시": "인천시",
    "광주광역시": "광주광역시",
    "광주시": "광주시",
    "대전광역시": "대전광역시",
    "대전시": "대전시",
    "울산광역시": "울산광역시",
    "울산시": "울산시",
    "세종특별자치시": "세종특별자치시",
    "세종시": "세종시",
    "경기도": "경기도",
    "강원도": "강원도",
    "충청북도": "충청북도",
    "충북": "충청북도",
    "충청남도": "충청남도",
    "충남": "충청남도",
    "전라북도": "전라북도",
    "전북": "전라북도",
    "전라남도": "전라남도",
    "전남": "전라남도",
    "경상북도": "경상북도",
    "경북": "경상북도",
    "경상남도": "경상남도",
    "경남": "경상남도",
    "제주특별자치도": "제주특별자치도",
    "제주도": "제주도",
    
    # ============ 국제기구 오인식 ============
    "유엔": "UN",
    "유앤": "UN",
    "나토": "NATO",
    "나또": "NATO",
    "아세안": "ASEAN",
    "오펙": "OPEC",
    "지투십": "G20",
    "지이십": "G20",
    "지세븐": "G7",
    "지칠": "G7",
    "아이엠에프": "IMF",
    "세계은행": "세계은행",
    "월드뱅크": "세계은행",
    "세계보건기구": "WHO",
    "더블유에이치오": "WHO",
    
    # ============ 박수/잡음 오인식 ============
    "박수": "[박수]",
    "환호": "[환호]",
    "웅성웅성": "[웅성]",
    "웅성거림": "[웅성]",
}

# 숫자 패턴 변환 (정규식으로 처리)
NUMBER_PATTERNS = [
    # 금액 패턴
    (r"(\d+)\s*백만\s*원", lambda m: f"{int(m.group(1)) * 1000000:,}원"),
    (r"(\d+)\s*천만\s*원", lambda m: f"{int(m.group(1)) * 10000000:,}원"),
    (r"(\d+)\s*억\s*원", lambda m: f"{int(m.group(1)) * 100000000:,}원"),
    (r"(\d+)\s*조\s*원", lambda m: f"{int(m.group(1)) * 1000000000000:,}원"),
    (r"백만\s*원", "1,000,000원"),
    (r"천만\s*원", "10,000,000원"),
    (r"일억\s*원", "100,000,000원"),
    (r"십억\s*원", "1,000,000,000원"),
    (r"백억\s*원", "10,000,000,000원"),
    (r"천억\s*원", "100,000,000,000원"),
    (r"일조\s*원", "1,000,000,000,000원"),
    
    # 퍼센트 패턴
    (r"(\d+)\s*퍼센트", r"\1%"),
    (r"(\d+)\s*프로", r"\1%"),
]


def apply_dictionary_mapping(text: str, apply_government_dict: bool = True) -> str:
    """
    사전 매칭 적용 (정적 사전 + JSON 사전 병합)
    
    - 약어 변환 (아이엠에프 → IMF)
    - 숫자 변환 (백만원 → 1,000,000원)
    - 국회/국무회의 용어 교정 (국민의뢰 → 국민의례)
    - 고유명사 교정 (인명/기관명/지명)
    
    Args:
        text: 변환할 텍스트
        apply_government_dict: 정부 용어 사전 적용 여부
    
    Returns:
        변환된 텍스트
    """
    if not text:
        return text
    
    result = text
    
    # [advice from AI] ★ JSON 사전 로드 (관리 페이지에서 설정한 데이터)
    json_proper_nouns = _load_json_proper_nouns()
    json_abbreviations = _load_json_abbreviations()
    json_government_dict = _load_json_government_dict()
    
    # [advice from AI] 0. 국회/국무회의 오인식 교정 (먼저 적용)
    if apply_government_dict:
        # 정적 사전 적용
        for wrong, correct in GOVERNMENT_CORRECTION_DICT.items():
            pattern = re.compile(re.escape(wrong), re.IGNORECASE)
            result = pattern.sub(correct, result)
        # [advice from AI] ★ JSON 정부 용어 사전 적용
        for wrong, correct in json_government_dict.items():
            if wrong not in GOVERNMENT_CORRECTION_DICT:  # 중복 방지
                pattern = re.compile(re.escape(wrong), re.IGNORECASE)
                result = pattern.sub(correct, result)
    
    # [advice from AI] 0.5. 고유명사 사전 적용 (인명/기관명/지명)
    # 정적 사전 적용
    for wrong, correct in PROPER_NOUN_DICT.items():
        pattern = re.compile(re.escape(wrong), re.IGNORECASE)
        result = pattern.sub(correct, result)
    # [advice from AI] ★ JSON 고유명사 사전 적용
    for wrong, correct in json_proper_nouns.items():
        if wrong not in PROPER_NOUN_DICT:  # 중복 방지
            pattern = re.compile(re.escape(wrong), re.IGNORECASE)
            result = pattern.sub(correct, result)
    
    # 1. 약어 변환 (대소문자 무시)
    # 정적 사전 적용
    for korean, english in ABBREVIATION_DICT.items():
        pattern = re.compile(re.escape(korean), re.IGNORECASE)
        result = pattern.sub(english, result)
    # [advice from AI] ★ JSON 약어 사전 적용
    for korean, english in json_abbreviations.items():
        if korean not in ABBREVIATION_DICT:  # 중복 방지
            pattern = re.compile(re.escape(korean), re.IGNORECASE)
            result = pattern.sub(english, result)
    
    # 2. 숫자 패턴 변환
    for pattern, replacement in NUMBER_PATTERNS:
        if callable(replacement):
            result = re.sub(pattern, replacement, result)
        else:
            result = re.sub(pattern, replacement, result)
    
    return result


# =============================================================================
# [advice from AI] 3단계: 세그먼트 필터링
# =============================================================================

def filter_segments(
    segments: List[dict],
    min_confidence: float = -0.8,
    max_no_speech_prob: float = 0.95,
    detect_music_enabled: bool = True,
) -> List[dict]:
    """
    세그먼트 필터링
    
    - 할루시네이션 제거
    - 저신뢰도 제거
    - 음악 감지 및 레이블링
    - 텍스트 정리 및 사전 매칭 적용
    
    Args:
        segments: 원본 세그먼트 목록
        min_confidence: 최소 신뢰도 (avg_logprob 기준)
        max_no_speech_prob: 최대 무음 확률
        detect_music_enabled: 음악 감지 활성화 여부
    
    Returns:
        필터링된 세그먼트 목록
    """
    filtered = []
    
    for seg in segments:
        raw_text = seg.get("text", "")
        avg_logprob = seg.get("avg_logprob", 0)
        no_speech_prob = seg.get("no_speech_prob", 0)
        
        # [advice from AI] 음악 감지 (필터링 전에 먼저 체크)
        if detect_music_enabled:
            music_result = detect_music(raw_text, no_speech_prob, avg_logprob)
            if music_result.is_music:
                logger.info(
                    f"🎵 Music detected: '{raw_text}' -> '{music_result.replacement_text}' "
                    f"(type={music_result.content_type.value}, conf={music_result.confidence:.2f})"
                )
                filtered.append({
                    **seg,
                    "text": music_result.replacement_text,
                    "is_music": True,
                    "music_type": music_result.content_type.value,
                    "confidence": music_result.confidence,
                })
                continue
        
        text = clean_text(raw_text)
        
        # 1. 빈 텍스트 스킵
        if not text:
            continue
        
        # 2. 할루시네이션 체크
        if is_hallucination(text):
            logger.info(f"Hallucination filtered: '{raw_text}' (logprob: {avg_logprob:.2f})")
            continue
        
        # 3. 신뢰도 체크
        if avg_logprob < min_confidence:
            logger.info(f"Low confidence filtered: '{text}' (logprob: {avg_logprob:.2f})")
            continue
        
        # 4. 무음 확률 체크
        if no_speech_prob > max_no_speech_prob:
            logger.info(f"No speech filtered: '{text}' (no_speech: {no_speech_prob:.2f})")
            continue
        
        # 5. 사전 매칭 적용
        text = apply_dictionary_mapping(text)
        
        # 필터링 통과
        filtered.append({
            **seg,
            "text": text,
            "is_music": False,
            "confidence": 1.0 + avg_logprob,  # 정규화된 신뢰도 (0~1 범위로 변환)
        })
    
    return filtered


def postprocess_text(text: str, detect_speaker_change: bool = False) -> str:
    """
    텍스트 후처리 (단일 텍스트용)
    
    Args:
        text: 후처리할 텍스트
        detect_speaker_change: 화자 변경 패턴 감지 여부 (기본: False)
    
    Returns:
        후처리된 텍스트
    """
    if not text:
        return ""
    
    # 1. 텍스트 정리
    text = clean_text(text)
    
    # 2. 할루시네이션 체크
    if is_hallucination(text):
        return ""
    
    # 3. 사전 매칭
    text = apply_dictionary_mapping(text)
    
    # [advice from AI] 4. 방송 안전 필터 (비속어 + 민감정보)
    text = apply_broadcast_safety_filter(text)
    
    # [advice from AI] 5. 화자 변경 패턴 감지 및 줄바꿈 삽입
    if detect_speaker_change:
        text = detect_and_insert_speaker_breaks(text)
    
    return text


# =============================================================================
# [advice from AI] 화자 변경 추정 패턴 - 세그먼트 내 화자 변경 감지
# =============================================================================

# 응답/동의 시작 패턴 (화자 변경 가능성 높음)
SPEAKER_CHANGE_RESPONSE_PATTERNS = [
    # 동의/응답 시작
    (r'(\S)\s+(네,\s*)', r'\1\n\2'),           # "보죠 네," → "보죠\n네,"
    (r'(\S)\s+(예,\s*)', r'\1\n\2'),           # "보죠 예," → "보죠\n예,"
    (r'(\S)\s+(네\s+)', r'\1\n\2'),            # "보죠 네 " → "보죠\n네 "
    (r'(\S)\s+(예\s+)', r'\1\n\2'),            # "보죠 예 " → "보죠\n예 "
    (r'(\S)\s+(아니요,?\s*)', r'\1\n\2'),      # "보죠 아니요" → "보죠\n아니요"
    (r'(\S)\s+(아뇨,?\s*)', r'\1\n\2'),        # "보죠 아뇨" → "보죠\n아뇨"
    
    # 질문 후 응답 (물음표 뒤)
    (r'(\?)\s*([가-힣])', r'\1\n\2'),          # "뭡니까? 네" → "뭡니까?\n네"
    
    # 감사/인사 시작
    (r'(\S)\s+(감사합니다)', r'\1\n\2'),       # "보죠 감사합니다" → "보죠\n감사합니다"
    (r'(\S)\s+(알겠습니다)', r'\1\n\2'),       # "보죠 알겠습니다" → "보죠\n알겠습니다"
    (r'(\S)\s+(말씀드리겠습니다)', r'\1\n\2'), # "보죠 말씀드리겠습니다"
    (r'(\S)\s+(답변드리겠습니다)', r'\1\n\2'), # "보죠 답변드리겠습니다"
    
    # 국회/국무회의 특화 - 발언권 전환
    (r'(\S)\s+(위원장님)', r'\1\n\2'),         # "보죠 위원장님"
    (r'(\S)\s+(의원님)', r'\1\n\2'),           # "보죠 의원님"
    (r'(\S)\s+(총리님)', r'\1\n\2'),           # "보죠 총리님"
    (r'(\S)\s+(장관님)', r'\1\n\2'),           # "보죠 장관님"
    (r'(\S)\s+(존경하는)', r'\1\n\2'),         # "보죠 존경하는"
    
    # 말씀 전환
    (r'(입니다)\s+(그리고)', r'\1\n\2'),       # "입니다 그리고" → "입니다\n그리고"
    (r'(습니다)\s+(그런데)', r'\1\n\2'),       # "습니다 그런데" → "습니다\n그런데"
    (r'(합니다)\s+(다음으로)', r'\1\n\2'),     # "합니다 다음으로" → "합니다\n다음으로"
]

COMPILED_SPEAKER_CHANGE_PATTERNS = [
    (re.compile(pattern), replacement) 
    for pattern, replacement in SPEAKER_CHANGE_RESPONSE_PATTERNS
]


def detect_and_insert_speaker_breaks(text: str) -> str:
    """
    [advice from AI] 세그먼트 내 화자 변경 추정 및 줄바꿈 삽입
    
    국회/국무회의 특성상 응답 시작 패턴("네,", "예,", "알겠습니다" 등)을 
    감지하여 화자 변경으로 추정하고 줄바꿈 삽입
    
    Args:
        text: 입력 텍스트
    
    Returns:
        화자 변경 위치에 줄바꿈이 삽입된 텍스트
    """
    if not text or len(text) < 5:
        return text
    
    result = text
    
    for pattern, replacement in COMPILED_SPEAKER_CHANGE_PATTERNS:
        result = pattern.sub(replacement, result)
    
    # 연속 줄바꿈 정리
    result = re.sub(r'\n+', '\n', result)
    
    # 줄바꿈 앞뒤 공백 정리
    result = re.sub(r'\s*\n\s*', '\n', result)
    
    if result != text:
        logger.debug(f"[화자변경추정] '{text[:50]}...' → '{result[:50]}...'")
    
    return result


# =============================================================================
# [advice from AI] 자막 최적화 - 긴 문장 분리
# =============================================================================

# 자막 분리 기준점 (우선순위 순)
SUBTITLE_BREAK_PATTERNS = [
    # 1. 문장 종결
    (r'([.?!。？！])\s*', r'\1\n'),
    # 2. 쉼표 + 접속사/부사
    (r',\s*(그리고|그런데|그러나|하지만|또한|그래서|따라서|그러면|그러므로)\s*', r',\n\1 '),
    # 3. 접속사 앞
    (r'\s+(그리고|그런데|그러나|하지만|또한|그래서|따라서|그러면|그러므로)\s+', r'\n\1 '),
    # 4. "네," "예," 등 응답 후
    (r'(네,|예,|아니요,|아뇨,)\s*', r'\1\n'),
]


def split_for_subtitle(
    text: str,
    max_length: int = 40,
    min_length: int = 10,
) -> List[str]:
    """
    [advice from AI] 자막용 문장 분리
    
    긴 문장을 자막에 적합한 길이로 분리합니다.
    
    Args:
        text: 원본 텍스트
        max_length: 최대 자막 길이 (기본 40자)
        min_length: 최소 자막 길이 (기본 10자)
    
    Returns:
        분리된 자막 리스트
    
    Example:
        입력: "제2회는 매년 횟수를 붙이는가 보죠 네, 매년 1회부터 횟수를 붙입니다 네, 제2회 국무회의를 시작하겠습니다"
        출력: [
            "제2회는 매년 횟수를 붙이는가 보죠",
            "네, 매년 1회부터 횟수를 붙입니다",
            "네, 제2회 국무회의를 시작하겠습니다"
        ]
    """
    if not text:
        return []
    
    text = text.strip()
    
    # 이미 짧으면 그대로 반환
    if len(text) <= max_length:
        return [text]
    
    lines = []
    remaining = text
    
    while remaining:
        remaining = remaining.strip()
        
        if not remaining:
            break
        
        # 이미 짧으면 추가하고 종료
        if len(remaining) <= max_length:
            lines.append(remaining)
            break
        
        # 최적 분리점 찾기
        best_split = -1
        
        # 1. max_length 이내에서 분리점 찾기
        search_text = remaining[:max_length + 20]  # 약간 여유 있게 탐색
        
        # 우선순위 1: 문장 부호 (. ? !)
        for punct in ['. ', '? ', '! ', '。', '？', '！']:
            idx = search_text.rfind(punct)
            if idx > min_length and idx <= max_length:
                best_split = idx + len(punct)
                break
        
        # 우선순위 2: "네," "예," 등 응답 후
        if best_split == -1:
            for marker in ['네, ', '예, ', '네,', '예,']:
                idx = search_text.find(marker, min_length)
                if idx > 0 and idx <= max_length:
                    best_split = idx + len(marker)
                    break
        
        # 우선순위 3: 접속사 앞
        if best_split == -1:
            for conj in [' 그리고 ', ' 그런데 ', ' 그러나 ', ' 하지만 ', ' 또한 ', ' 그래서 ']:
                idx = search_text.find(conj, min_length)
                if idx > 0 and idx <= max_length:
                    best_split = idx
                    break
        
        # 우선순위 4: 쉼표 뒤
        if best_split == -1:
            idx = search_text.rfind(', ', min_length, max_length)
            if idx > 0:
                best_split = idx + 2
        
        # 우선순위 5: 공백에서 자르기 (최후의 수단)
        if best_split == -1:
            idx = search_text.rfind(' ', min_length, max_length)
            if idx > 0:
                best_split = idx + 1
        
        # 분리점을 찾지 못하면 강제로 자르기
        if best_split == -1:
            best_split = max_length
        
        # 분리
        line = remaining[:best_split].strip()
        remaining = remaining[best_split:].strip()
        
        if line:
            lines.append(line)
    
    # 너무 짧은 줄은 이전 줄과 합치기
    merged = []
    for line in lines:
        if merged and len(line) < min_length and len(merged[-1]) + len(line) + 1 <= max_length:
            merged[-1] = merged[-1] + ' ' + line
        else:
            merged.append(line)
    
    return merged


def format_subtitle_text(text: str, max_length: int = 40) -> str:
    """
    [advice from AI] 자막 포맷팅 (줄바꿈 포함)
    
    Args:
        text: 원본 텍스트
        max_length: 최대 자막 길이
    
    Returns:
        줄바꿈이 포함된 자막 텍스트
    """
    lines = split_for_subtitle(text, max_length)
    return '\n'.join(lines)
