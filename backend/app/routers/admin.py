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
        'break_on_sentence_end': True
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
        'break_on_sentence_end': True
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
