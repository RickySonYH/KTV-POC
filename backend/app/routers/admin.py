"""
[advice from AI] 사전/필터 관리 API
JSON 파일 기반으로 비속어 필터, 고유명사 사전, 정부 용어 사전 등을 동적으로 관리
+ 실시간 로그 스트리밍
"""

import os
import logging
import asyncio
import json
from typing import List, Set, Dict, Any
from datetime import datetime
from collections import deque
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])

# =============================================================================
# [advice from AI] JSON 데이터 파일 관리
# =============================================================================

DATA_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "stt_dictionaries.json")

def load_data() -> Dict[str, Any]:
    """JSON 파일에서 데이터 로드"""
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        # 기본 데이터 구조
        return {
            'profanity': [],
            'sensitive': [],
            'proper_nouns': [],
            'government_dict': [],
            'abbreviations': [],
            'hallucination': [],
            'subtitle_rules': {
                'max_lines': 2,
                'max_chars_per_line': 18,
                'fade_timeout_ms': 3000,
                'display_delay_ms': 0,
                'min_display_ms': 1000,
                'break_on_sentence_end': True
            }
        }

def save_data(data: Dict[str, Any]):
    """JSON 파일에 데이터 저장"""
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    logger.info(f"💾 데이터 저장 완료: {DATA_FILE}")


# =============================================================================
# [advice from AI] 실시간 로그 스트리밍 시스템
# =============================================================================

LOG_BUFFER: deque = deque(maxlen=500)
LOG_CLIENTS: Set[WebSocket] = set()


class WebSocketLogHandler(logging.Handler):
    """WebSocket으로 로그를 브로드캐스트하는 핸들러"""
    
    def emit(self, record):
        try:
            log_entry = {
                "timestamp": datetime.now().strftime("%H:%M:%S.%f")[:-3],
                "level": record.levelname,
                "logger": record.name,
                "message": self.format(record),
            }
            LOG_BUFFER.append(log_entry)
            if LOG_CLIENTS:
                asyncio.create_task(self._broadcast(log_entry))
        except Exception:
            pass
    
    async def _broadcast(self, log_entry: dict):
        disconnected = set()
        for client in LOG_CLIENTS:
            try:
                await client.send_json(log_entry)
            except Exception:
                disconnected.add(client)
        for client in disconnected:
            LOG_CLIENTS.discard(client)


def setup_log_handler():
    handler = WebSocketLogHandler()
    handler.setFormatter(logging.Formatter('%(message)s'))
    handler.setLevel(logging.INFO)
    root_logger = logging.getLogger()
    for h in root_logger.handlers:
        if isinstance(h, WebSocketLogHandler):
            return
    root_logger.addHandler(handler)
    logger.info("📡 실시간 로그 스트리밍 활성화")

setup_log_handler()


# =============================================================================
# 데이터 모델
# =============================================================================

class DictionaryItem(BaseModel):
    key: str
    value: str

class FilterPattern(BaseModel):
    pattern: str

class DictionaryStats(BaseModel):
    profanity_count: int
    sensitive_count: int
    proper_noun_count: int
    government_dict_count: int
    abbreviation_count: int
    hallucination_count: int

class DictionaryResponse(BaseModel):
    dictionary_type: str
    items: list
    total: int

class SubtitleRules(BaseModel):
    max_lines: int = 2
    max_chars_per_line: int = 18
    fade_timeout_ms: int = 3000
    display_delay_ms: int = 0
    min_display_ms: int = 1000
    break_on_sentence_end: bool = True
    postprocess_enabled: bool = True  # [advice from AI] 후처리 ON/OFF 설정


# =============================================================================
# 통계 조회
# =============================================================================

@router.get("/stats", response_model=DictionaryStats)
async def get_dictionary_stats():
    """모든 사전/필터 통계 조회"""
    data = load_data()
    return DictionaryStats(
        profanity_count=len(data.get('profanity', [])),
        sensitive_count=len(data.get('sensitive', [])),
        proper_noun_count=len(data.get('proper_nouns', [])),
        government_dict_count=len(data.get('government_dict', [])),
        abbreviation_count=len(data.get('abbreviations', [])),
        hallucination_count=len(data.get('hallucination', [])),
    )


# =============================================================================
# 비속어 필터 관리
# =============================================================================

@router.get("/profanity", response_model=DictionaryResponse)
async def get_profanity_patterns():
    """비속어 패턴 목록 조회"""
    data = load_data()
    items = data.get('profanity', [])
    return DictionaryResponse(
        dictionary_type="profanity",
        items=items,
        total=len(items),
    )

@router.post("/profanity")
async def add_profanity_pattern(pattern: FilterPattern):
    """비속어 패턴 추가"""
    data = load_data()
    if pattern.pattern in data.get('profanity', []):
        raise HTTPException(status_code=400, detail="이미 존재하는 패턴입니다")
    
    data.setdefault('profanity', []).append(pattern.pattern)
    save_data(data)
    logger.info(f"✅ 비속어 패턴 추가: {pattern.pattern}")
    return {"message": "추가 완료", "total": len(data['profanity'])}

@router.delete("/profanity/{pattern}")
async def delete_profanity_pattern(pattern: str):
    """비속어 패턴 삭제"""
    data = load_data()
    if pattern not in data.get('profanity', []):
        raise HTTPException(status_code=404, detail="패턴을 찾을 수 없습니다")
    
    data['profanity'].remove(pattern)
    save_data(data)
    logger.info(f"🗑️ 비속어 패턴 삭제: {pattern}")
    return {"message": "삭제 완료", "total": len(data['profanity'])}


# =============================================================================
# 고유명사 사전 관리
# =============================================================================

@router.get("/proper-nouns", response_model=DictionaryResponse)
async def get_proper_nouns():
    """고유명사 사전 조회"""
    data = load_data()
    items = data.get('proper_nouns', [])
    return DictionaryResponse(
        dictionary_type="proper_noun",
        items=items,
        total=len(items),
    )

@router.post("/proper-nouns")
async def add_proper_noun(item: DictionaryItem):
    """고유명사 추가"""
    data = load_data()
    proper_nouns = data.setdefault('proper_nouns', [])
    
    # 중복 체크
    for existing in proper_nouns:
        if existing.get('key') == item.key:
            raise HTTPException(status_code=400, detail="이미 존재하는 항목입니다")
    
    proper_nouns.append({'key': item.key, 'value': item.value})
    save_data(data)
    logger.info(f"✅ 고유명사 추가: {item.key} → {item.value}")
    return {"message": "추가 완료", "total": len(proper_nouns)}

@router.delete("/proper-nouns/{key}")
async def delete_proper_noun(key: str):
    """고유명사 삭제"""
    data = load_data()
    proper_nouns = data.get('proper_nouns', [])
    
    for i, item in enumerate(proper_nouns):
        if item.get('key') == key:
            proper_nouns.pop(i)
            save_data(data)
            logger.info(f"🗑️ 고유명사 삭제: {key}")
            return {"message": "삭제 완료", "total": len(proper_nouns)}
    
    raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다")


# =============================================================================
# 정부 용어 사전 관리
# =============================================================================

@router.get("/government-dict", response_model=DictionaryResponse)
async def get_government_dict():
    """정부 용어 사전 조회"""
    data = load_data()
    items = data.get('government_dict', [])
    return DictionaryResponse(
        dictionary_type="government",
        items=items,
        total=len(items),
    )

@router.post("/government-dict")
async def add_government_term(item: DictionaryItem):
    """정부 용어 추가"""
    data = load_data()
    govt_dict = data.setdefault('government_dict', [])
    
    for existing in govt_dict:
        if existing.get('key') == item.key:
            raise HTTPException(status_code=400, detail="이미 존재하는 항목입니다")
    
    govt_dict.append({'key': item.key, 'value': item.value})
    save_data(data)
    logger.info(f"✅ 정부 용어 추가: {item.key} → {item.value}")
    return {"message": "추가 완료", "total": len(govt_dict)}

@router.delete("/government-dict/{key}")
async def delete_government_term(key: str):
    """정부 용어 삭제"""
    data = load_data()
    govt_dict = data.get('government_dict', [])
    
    for i, item in enumerate(govt_dict):
        if item.get('key') == key:
            govt_dict.pop(i)
            save_data(data)
            logger.info(f"🗑️ 정부 용어 삭제: {key}")
            return {"message": "삭제 완료", "total": len(govt_dict)}
    
    raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다")


# =============================================================================
# 약어 사전 관리
# =============================================================================

@router.get("/abbreviations", response_model=DictionaryResponse)
async def get_abbreviations():
    """약어 사전 조회"""
    data = load_data()
    items = data.get('abbreviations', [])
    return DictionaryResponse(
        dictionary_type="abbreviation",
        items=items,
        total=len(items),
    )

@router.post("/abbreviations")
async def add_abbreviation(item: DictionaryItem):
    """약어 추가"""
    data = load_data()
    abbr_list = data.setdefault('abbreviations', [])
    
    for existing in abbr_list:
        if existing.get('key') == item.key:
            raise HTTPException(status_code=400, detail="이미 존재하는 항목입니다")
    
    abbr_list.append({'key': item.key, 'value': item.value})
    save_data(data)
    logger.info(f"✅ 약어 추가: {item.key} → {item.value}")
    return {"message": "추가 완료", "total": len(abbr_list)}

@router.delete("/abbreviations/{key}")
async def delete_abbreviation(key: str):
    """약어 삭제"""
    data = load_data()
    abbr_list = data.get('abbreviations', [])
    
    for i, item in enumerate(abbr_list):
        if item.get('key') == key:
            abbr_list.pop(i)
            save_data(data)
            logger.info(f"🗑️ 약어 삭제: {key}")
            return {"message": "삭제 완료", "total": len(abbr_list)}
    
    raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다")


# =============================================================================
# 할루시네이션 패턴 관리
# =============================================================================

@router.get("/hallucination", response_model=DictionaryResponse)
async def get_hallucination_patterns():
    """할루시네이션 패턴 조회"""
    data = load_data()
    items = data.get('hallucination', [])
    return DictionaryResponse(
        dictionary_type="hallucination",
        items=items,
        total=len(items),
    )

@router.post("/hallucination")
async def add_hallucination_pattern(pattern: FilterPattern):
    """할루시네이션 패턴 추가"""
    data = load_data()
    if pattern.pattern in data.get('hallucination', []):
        raise HTTPException(status_code=400, detail="이미 존재하는 패턴입니다")
    
    data.setdefault('hallucination', []).append(pattern.pattern)
    save_data(data)
    logger.info(f"✅ 할루시네이션 패턴 추가: {pattern.pattern}")
    return {"message": "추가 완료", "total": len(data['hallucination'])}
    
@router.delete("/hallucination/{pattern:path}")
async def delete_hallucination_pattern(pattern: str):
    """할루시네이션 패턴 삭제"""
    data = load_data()
    if pattern not in data.get('hallucination', []):
        raise HTTPException(status_code=404, detail="패턴을 찾을 수 없습니다")
    
    data['hallucination'].remove(pattern)
    save_data(data)
    logger.info(f"🗑️ 할루시네이션 패턴 삭제: {pattern}")
    return {"message": "삭제 완료", "total": len(data['hallucination'])}


# =============================================================================
# 민감정보 패턴 (읽기 전용)
# =============================================================================

@router.get("/sensitive-patterns", response_model=DictionaryResponse)
async def get_sensitive_patterns():
    """민감정보 패턴 조회 (읽기 전용)"""
    data = load_data()
    items = data.get('sensitive', [])
    return DictionaryResponse(
        dictionary_type="sensitive",
        items=items,
        total=len(items),
    )


# =============================================================================
# 자막 규칙 관리
# =============================================================================

@router.get("/subtitle-rules")
async def get_subtitle_rules():
    """자막 규칙 조회"""
    data = load_data()
    return data.get('subtitle_rules', {
        'max_lines': 2,
        'max_chars_per_line': 18,
        'fade_timeout_ms': 3000,
        'display_delay_ms': 0,
        'min_display_ms': 1000,
        'break_on_sentence_end': True,
        'postprocess_enabled': True  # [advice from AI] 기본값: 후처리 ON
    })

@router.post("/subtitle-rules")
async def save_subtitle_rules(rules: SubtitleRules):
    """자막 규칙 저장"""
    data = load_data()
    data['subtitle_rules'] = rules.dict()
    save_data(data)
    logger.info(f"✅ 자막 규칙 저장: {rules.dict()}")
    return {"message": "저장 완료"}

@router.post("/subtitle-rules/reset")
async def reset_subtitle_rules():
    """자막 규칙 초기화"""
    data = load_data()
    data['subtitle_rules'] = {
        'max_lines': 2,
        'max_chars_per_line': 18,
        'fade_timeout_ms': 3000,
        'display_delay_ms': 0,
        'min_display_ms': 1000,
        'break_on_sentence_end': True,
        'postprocess_enabled': True  # [advice from AI] 기본값: 후처리 ON
    }
    save_data(data)
    logger.info("🔄 자막 규칙 초기화")
    return data['subtitle_rules']


# =============================================================================
# 실시간 로그 WebSocket
# =============================================================================

@router.websocket("/logs")
async def websocket_logs(websocket: WebSocket):
    """실시간 로그 WebSocket"""
    await websocket.accept()
    LOG_CLIENTS.add(websocket)
    logger.info(f"📡 로그 클라이언트 연결: 현재 {len(LOG_CLIENTS)}개")
    
    try:
        # 기존 로그 전송
        for log in LOG_BUFFER:
            await websocket.send_json(log)
        
        # 연결 유지
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                if data == "pong":
                    continue
            except asyncio.TimeoutError:
                await websocket.send_text("ping")
    except WebSocketDisconnect:
        pass
    finally:
        LOG_CLIENTS.discard(websocket)
        logger.info(f"📡 로그 클라이언트 해제: 현재 {len(LOG_CLIENTS)}개")


# =============================================================================
# [advice from AI] STT 디버그 로그 파일 관리
# 프론트엔드에서 전송한 원본/후처리 데이터를 파일로 저장
# =============================================================================

STT_LOG_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "stt_debug.log")
MAX_LOG_LINES = 500  # 최대 500줄 유지

class STTLogEntry(BaseModel):
    """STT 로그 항목"""
    timestamp: str = ""
    log_type: str  # WHISPER_RAW, SUBTITLE_LIST, DISPLAY, BUFFER
    raw_text: str = ""
    processed_text: str = ""
    video_time: float = 0
    extra: dict = {}

def append_stt_log(entry: STTLogEntry):
    """STT 로그를 파일에 추가 (최대 줄 수 유지)"""
    try:
        # 기존 로그 읽기
        lines = []
        if os.path.exists(STT_LOG_FILE):
            with open(STT_LOG_FILE, 'r', encoding='utf-8') as f:
                lines = f.readlines()
        
        # 새 로그 추가
        timestamp = entry.timestamp or datetime.now().strftime("%H:%M:%S.%f")[:-3]
        log_line = f"[{timestamp}] [{entry.log_type}] T={entry.video_time:.1f}s | 원본: {entry.raw_text[:80]} | 후처리: {entry.processed_text[:80]}"
        if entry.extra:
            log_line += f" | {json.dumps(entry.extra, ensure_ascii=False)}"
        log_line += "\n"
        lines.append(log_line)
        
        # 최대 줄 수 유지
        if len(lines) > MAX_LOG_LINES:
            lines = lines[-MAX_LOG_LINES:]
        
        # 파일 저장
        os.makedirs(os.path.dirname(STT_LOG_FILE), exist_ok=True)
        with open(STT_LOG_FILE, 'w', encoding='utf-8') as f:
            f.writelines(lines)
            
    except Exception as e:
        logger.error(f"STT 로그 저장 오류: {e}")

@router.post("/stt-log")
async def add_stt_log(entry: STTLogEntry):
    """프론트엔드에서 STT 로그 수신"""
    append_stt_log(entry)
    return {"status": "ok"}

@router.post("/stt-log/batch")
async def add_stt_logs_batch(entries: List[STTLogEntry]):
    """프론트엔드에서 STT 로그 일괄 수신"""
    for entry in entries:
        append_stt_log(entry)
    return {"status": "ok", "count": len(entries)}

@router.get("/stt-log")
async def get_stt_log(lines: int = 100):
    """STT 디버그 로그 조회"""
    try:
        if not os.path.exists(STT_LOG_FILE):
            return {"logs": [], "total_lines": 0}
        
        with open(STT_LOG_FILE, 'r', encoding='utf-8') as f:
            all_lines = f.readlines()
        
        # 최근 N줄 반환
        recent_lines = all_lines[-lines:] if len(all_lines) > lines else all_lines
        return {
            "logs": [line.strip() for line in recent_lines],
            "total_lines": len(all_lines)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/stt-log")
async def clear_stt_log():
    """STT 디버그 로그 초기화"""
    try:
        if os.path.exists(STT_LOG_FILE):
            os.remove(STT_LOG_FILE)
        return {"status": "cleared"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# =============================================================================
# [advice from AI] ★★★ WhisperLiveKit (STT) 관리 API ★★★
# =============================================================================

import subprocess
import httpx

# WhisperLiveKit 컨테이너 이름 및 내부 URL
WHISPER_CONTAINER_NAME = "ktv-whisper-livekit"
WHISPER_INTERNAL_URL = "http://whisper-livekit:8000"

@router.get("/whisper/health")
async def whisper_health_check():
    """
    WhisperLiveKit 서버 헬스체크
    - 컨테이너 상태 확인
    - WebSocket 서버 응답 확인
    """
    result = {
        "container_running": False,
        "server_responding": False,
        "status": "unknown",
        "message": ""
    }
    
    # 1. 컨테이너 상태 확인
    try:
        container_check = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Running}}", WHISPER_CONTAINER_NAME],
            capture_output=True,
            text=True,
            timeout=5
        )
        if container_check.returncode == 0 and container_check.stdout.strip() == "true":
            result["container_running"] = True
        else:
            result["status"] = "stopped"
            result["message"] = "WhisperLiveKit 컨테이너가 중지됨"
            return result
    except subprocess.TimeoutExpired:
        result["status"] = "error"
        result["message"] = "Docker 명령 타임아웃"
        return result
    except Exception as e:
        result["status"] = "error"
        result["message"] = f"Docker 확인 실패: {str(e)}"
        return result
    
    # 2. HTTP 응답 확인 (WebSocket 서버의 HTTP 핸들러)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(WHISPER_INTERNAL_URL)
            if response.status_code == 200:
                result["server_responding"] = True
                result["status"] = "healthy"
                result["message"] = "WhisperLiveKit 정상 작동 중"
            else:
                result["status"] = "degraded"
                result["message"] = f"HTTP 응답 코드: {response.status_code}"
    except httpx.TimeoutException:
        result["status"] = "degraded"
        result["message"] = "서버 응답 타임아웃 (컨테이너는 실행 중)"
    except Exception as e:
        result["status"] = "degraded"
        result["message"] = f"연결 실패: {str(e)}"
    
    return result

@router.post("/whisper/restart")
async def restart_whisper():
    """
    WhisperLiveKit 서버 재시작
    - Docker 컨테이너 재시작
    """
    logger.info("[ADMIN] WhisperLiveKit 재시작 요청")
    
    try:
        # Docker 컨테이너 재시작
        restart_cmd = subprocess.run(
            ["docker", "restart", WHISPER_CONTAINER_NAME],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if restart_cmd.returncode == 0:
            logger.info("[ADMIN] WhisperLiveKit 재시작 완료")
            return {
                "status": "success",
                "message": "WhisperLiveKit 재시작 완료",
                "container": WHISPER_CONTAINER_NAME
            }
        else:
            logger.error(f"[ADMIN] 재시작 실패: {restart_cmd.stderr}")
            raise HTTPException(
                status_code=500,
                detail=f"재시작 실패: {restart_cmd.stderr}"
            )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="재시작 타임아웃 (30초 초과)")
    except Exception as e:
        logger.error(f"[ADMIN] 재시작 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))
