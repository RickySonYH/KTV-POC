/**
 * [advice from AI] STT 사전/필터 관리 패널
 * STT-Full-Service의 admin.html을 React 컴포넌트로 변환
 * 아이보리톤 배경, 텍스트 위주 심플 디자인
 */

import { useState, useEffect, useCallback } from 'react';
import { reloadDictionaries } from '../utils/sttPostprocessing';

// [advice from AI] 스타일 정의 (CSS 변수 대신 인라인)
const colors = {
  bgPrimary: '#FDFBF7',
  bgSecondary: '#F5F2EB',
  textPrimary: '#2C2C2C',
  textSecondary: '#5A5A5A',
  borderColor: '#D4D0C8',
  accent: '#4A6741',
  accentHover: '#3D5536',
  danger: '#B54834',
  success: '#4A6741',
};

// [advice from AI] API 기본 URL - 상대 경로 사용 (nginx 프록시)
const API_BASE = '/api/v1/admin';

interface DictItem {
  key: string;
  value: string;
}

interface SensitiveItem {
  pattern: string;
  replacement: string;
}

interface SubtitleRules {
  max_lines: number;
  max_chars_per_line: number;
  fade_timeout_ms: number;
  display_delay_ms: number;
  min_display_ms: number;
  break_on_sentence_end: boolean;
}

interface Stats {
  profanity_count: number;
  sensitive_count: number;
  proper_noun_count: number;
  government_dict_count: number;
  abbreviation_count: number;
  hallucination_count: number;
}

type TabType = 'subtitle-rules' | 'profanity' | 'proper-nouns' | 'government-dict' | 'abbreviations' | 'hallucination' | 'sensitive-patterns';

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState<TabType>('subtitle-rules');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  
  // [advice from AI] 각 탭별 데이터
  const [profanityList, setProfanityList] = useState<string[]>([]);
  const [properNouns, setProperNouns] = useState<DictItem[]>([]);
  const [govtDict, setGovtDict] = useState<DictItem[]>([]);
  const [abbreviations, setAbbreviations] = useState<DictItem[]>([]);
  const [hallucinations, setHallucinations] = useState<string[]>([]);
  const [sensitivePatterns, setSensitivePatterns] = useState<SensitiveItem[]>([]);
  
  // [advice from AI] 입력 필드
  const [profanityInput, setProfanityInput] = useState('');
  const [properKey, setProperKey] = useState('');
  const [properValue, setProperValue] = useState('');
  const [govtKey, setGovtKey] = useState('');
  const [govtValue, setGovtValue] = useState('');
  const [abbrKey, setAbbrKey] = useState('');
  const [abbrValue, setAbbrValue] = useState('');
  const [hallucinationInput, setHallucinationInput] = useState('');
  
  // [advice from AI] 검색 필터
  const [searchFilters, setSearchFilters] = useState<Record<string, string>>({});
  
  // [advice from AI] 자막 규칙
  const [subtitleRules, setSubtitleRules] = useState<SubtitleRules>({
    max_lines: 2,
    max_chars_per_line: 18,
    fade_timeout_ms: 3000,
    display_delay_ms: 0,
    min_display_ms: 1000,
    break_on_sentence_end: true,
  });

  // [advice from AI] 메시지 표시 + 성공 시 사전 리로드
  const showMessage = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
    
    // [advice from AI] 성공 시 프론트엔드 후처리 캐시 리로드
    if (type === 'success') {
      reloadDictionaries().then(() => {
        console.log('[AdminPanel] ✅ 후처리 사전 리로드 완료');
      });
    }
  }, []);

  // [advice from AI] API 호출
  const apiCall = useCallback(async (endpoint: string, method = 'GET', body: unknown = null) => {
    const options: RequestInit = { 
      method, 
      headers: { 'Content-Type': 'application/json' } 
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(API_BASE + endpoint, options);
    return res.json();
  }, []);

  // [advice from AI] 통계 로드
  const loadStats = useCallback(async () => {
    try {
      const data = await apiCall('/stats');
      setStats(data);
    } catch (e) {
      console.error('Failed to load stats:', e);
    }
  }, [apiCall]);

  // [advice from AI] 자막 규칙 로드
  const loadSubtitleRules = useCallback(async () => {
    try {
      const data = await apiCall('/subtitle-rules');
      setSubtitleRules(data);
    } catch (e) {
      console.error('Failed to load subtitle rules:', e);
    }
  }, [apiCall]);

  // [advice from AI] 비속어 목록 로드
  const loadProfanity = useCallback(async () => {
    try {
      const data = await apiCall('/profanity');
      setProfanityList(data.items || []);
    } catch (e) {
      console.error('Failed to load profanity:', e);
    }
  }, [apiCall]);

  // [advice from AI] 고유명사 로드
  const loadProperNouns = useCallback(async () => {
    try {
      const data = await apiCall('/proper-nouns');
      setProperNouns(data.items || []);
    } catch (e) {
      console.error('Failed to load proper nouns:', e);
    }
  }, [apiCall]);

  // [advice from AI] 정부 용어 로드
  const loadGovtDict = useCallback(async () => {
    try {
      const data = await apiCall('/government-dict');
      setGovtDict(data.items || []);
    } catch (e) {
      console.error('Failed to load govt dict:', e);
    }
  }, [apiCall]);

  // [advice from AI] 약어 로드
  const loadAbbreviations = useCallback(async () => {
    try {
      const data = await apiCall('/abbreviations');
      setAbbreviations(data.items || []);
    } catch (e) {
      console.error('Failed to load abbreviations:', e);
    }
  }, [apiCall]);

  // [advice from AI] 할루시네이션 로드
  const loadHallucinations = useCallback(async () => {
    try {
      const data = await apiCall('/hallucination');
      setHallucinations(data.items || []);
    } catch (e) {
      console.error('Failed to load hallucinations:', e);
    }
  }, [apiCall]);

  // [advice from AI] 민감정보 패턴 로드
  const loadSensitivePatterns = useCallback(async () => {
    try {
      const data = await apiCall('/sensitive-patterns');
      setSensitivePatterns(data.items || []);
    } catch (e) {
      console.error('Failed to load sensitive patterns:', e);
    }
  }, [apiCall]);

  // [advice from AI] 초기 데이터 로드
  useEffect(() => {
    loadStats();
    loadSubtitleRules();
    loadProfanity();
    loadProperNouns();
    loadGovtDict();
    loadAbbreviations();
    loadHallucinations();
    loadSensitivePatterns();
  }, [loadStats, loadSubtitleRules, loadProfanity, loadProperNouns, loadGovtDict, loadAbbreviations, loadHallucinations, loadSensitivePatterns]);

  // [advice from AI] 자막 규칙 저장
  const saveSubtitleRules = async () => {
    try {
      await apiCall('/subtitle-rules', 'POST', subtitleRules);
      showMessage('자막 규칙이 저장되었습니다');
    } catch (e) {
      showMessage('저장 실패', 'error');
    }
  };

  // [advice from AI] 자막 규칙 초기화
  const resetSubtitleRules = async () => {
    try {
      await apiCall('/subtitle-rules/reset', 'POST');
      loadSubtitleRules();
      showMessage('자막 규칙이 기본값으로 초기화되었습니다');
    } catch (e) {
      showMessage('초기화 실패', 'error');
    }
  };

  // [advice from AI] 비속어 추가
  const addProfanity = async () => {
    if (!profanityInput.trim()) return;
    await apiCall('/profanity', 'POST', { pattern: profanityInput.trim() });
    setProfanityInput('');
    loadProfanity();
    loadStats();
    showMessage('추가되었습니다');
  };

  // [advice from AI] 비속어 삭제
  const deleteProfanity = async (pattern: string) => {
    await apiCall(`/profanity/${encodeURIComponent(pattern)}`, 'DELETE');
    loadProfanity();
    loadStats();
    showMessage('삭제되었습니다');
  };

  // [advice from AI] 고유명사 추가
  const addProperNoun = async () => {
    if (!properKey.trim() || !properValue.trim()) return;
    await apiCall('/proper-nouns', 'POST', { key: properKey.trim(), value: properValue.trim() });
    setProperKey('');
    setProperValue('');
    loadProperNouns();
    loadStats();
    showMessage('추가되었습니다');
  };

  // [advice from AI] 고유명사 삭제
  const deleteProperNoun = async (key: string) => {
    await apiCall(`/proper-nouns/${encodeURIComponent(key)}`, 'DELETE');
    loadProperNouns();
    loadStats();
    showMessage('삭제되었습니다');
  };

  // [advice from AI] 정부 용어 추가
  const addGovtTerm = async () => {
    if (!govtKey.trim() || !govtValue.trim()) return;
    await apiCall('/government-dict', 'POST', { key: govtKey.trim(), value: govtValue.trim() });
    setGovtKey('');
    setGovtValue('');
    loadGovtDict();
    loadStats();
    showMessage('추가되었습니다');
  };

  // [advice from AI] 정부 용어 삭제
  const deleteGovtTerm = async (key: string) => {
    await apiCall(`/government-dict/${encodeURIComponent(key)}`, 'DELETE');
    loadGovtDict();
    loadStats();
    showMessage('삭제되었습니다');
  };

  // [advice from AI] 약어 추가
  const addAbbreviation = async () => {
    if (!abbrKey.trim() || !abbrValue.trim()) return;
    await apiCall('/abbreviations', 'POST', { key: abbrKey.trim(), value: abbrValue.trim() });
    setAbbrKey('');
    setAbbrValue('');
    loadAbbreviations();
    loadStats();
    showMessage('추가되었습니다');
  };

  // [advice from AI] 약어 삭제
  const deleteAbbreviation = async (key: string) => {
    await apiCall(`/abbreviations/${encodeURIComponent(key)}`, 'DELETE');
    loadAbbreviations();
    loadStats();
    showMessage('삭제되었습니다');
  };

  // [advice from AI] 할루시네이션 추가
  const addHallucination = async () => {
    if (!hallucinationInput.trim()) return;
    await apiCall('/hallucination', 'POST', { pattern: hallucinationInput.trim() });
    setHallucinationInput('');
    loadHallucinations();
    loadStats();
    showMessage('추가되었습니다');
  };

  // [advice from AI] 할루시네이션 삭제
  const deleteHallucination = async (pattern: string) => {
    await apiCall(`/hallucination/${encodeURIComponent(pattern)}`, 'DELETE');
    loadHallucinations();
    loadStats();
    showMessage('삭제되었습니다');
  };

  // [advice from AI] 필터링된 목록
  const getFilteredList = <T,>(list: T[], filterKey: string, getSearchText: (item: T) => string): T[] => {
    const search = (searchFilters[filterKey] || '').toLowerCase();
    if (!search) return list;
    return list.filter(item => getSearchText(item).toLowerCase().includes(search));
  };

  // [advice from AI] 스타일
  const styles = {
    container: {
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '2rem',
      fontFamily: "'Noto Sans KR', -apple-system, BlinkMacSystemFont, sans-serif",
      background: colors.bgPrimary,
      minHeight: '100%',
      color: colors.textPrimary,
    },
    header: {
      borderBottom: `1px solid ${colors.borderColor}`,
      paddingBottom: '1rem',
      marginBottom: '2rem',
    },
    title: {
      fontSize: '1.5rem',
      fontWeight: 500,
      color: colors.textPrimary,
      margin: 0,
    },
    subtitle: {
      fontSize: '0.875rem',
      color: colors.textSecondary,
      marginTop: '0.25rem',
    },
    stats: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
      gap: '1rem',
      marginBottom: '2rem',
      padding: '1rem',
      background: colors.bgSecondary,
      borderRadius: '4px',
    },
    statItem: {
      textAlign: 'center' as const,
    },
    statValue: {
      fontSize: '1.5rem',
      fontWeight: 600,
      color: colors.accent,
    },
    statLabel: {
      fontSize: '0.75rem',
      color: colors.textSecondary,
    },
    tabs: {
      display: 'flex',
      gap: '0.5rem',
      borderBottom: `1px solid ${colors.borderColor}`,
      marginBottom: '1.5rem',
      flexWrap: 'wrap' as const,
    },
    tab: (isActive: boolean) => ({
      padding: '0.75rem 1rem',
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      fontSize: '0.875rem',
      color: isActive ? colors.accent : colors.textSecondary,
      borderBottom: `2px solid ${isActive ? colors.accent : 'transparent'}`,
      transition: 'all 0.2s',
    }),
    message: (type: 'success' | 'error') => ({
      padding: '0.75rem',
      borderRadius: '3px',
      marginBottom: '1rem',
      fontSize: '0.875rem',
      background: type === 'success' ? 'rgba(74, 103, 65, 0.1)' : 'rgba(181, 72, 52, 0.1)',
      color: type === 'success' ? colors.success : colors.danger,
    }),
    formRow: {
      display: 'flex',
      gap: '0.5rem',
      marginBottom: '1rem',
    },
    input: {
      flex: 1,
      padding: '0.5rem 0.75rem',
      border: `1px solid ${colors.borderColor}`,
      borderRadius: '3px',
      fontSize: '0.875rem',
      background: '#fff',
    },
    btnPrimary: {
      padding: '0.5rem 1rem',
      border: 'none',
      borderRadius: '3px',
      fontSize: '0.875rem',
      cursor: 'pointer',
      background: colors.accent,
      color: '#fff',
    },
    btnDanger: {
      background: 'transparent',
      color: colors.danger,
      padding: '0.25rem 0.5rem',
      fontSize: '0.75rem',
      border: 'none',
      cursor: 'pointer',
    },
    itemList: {
      border: `1px solid ${colors.borderColor}`,
      borderRadius: '3px',
      maxHeight: '400px',
      overflowY: 'auto' as const,
    },
    item: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '0.5rem 0.75rem',
      borderBottom: `1px solid ${colors.borderColor}`,
      fontSize: '0.875rem',
    },
    description: {
      fontSize: '0.8rem',
      color: colors.textSecondary,
      marginBottom: '1rem',
    },
    ruleCard: {
      background: colors.bgSecondary,
      padding: '1rem',
      borderRadius: '4px',
    },
    ruleLabel: {
      display: 'block',
      fontWeight: 500,
      marginBottom: '0.5rem',
    },
    ruleInput: {
      width: '100%',
      padding: '0.5rem',
      border: `1px solid ${colors.borderColor}`,
      borderRadius: '3px',
    },
    ruleHint: {
      fontSize: '0.75rem',
      color: colors.textSecondary,
      marginTop: '0.25rem',
    },
  };

  const tabs: { id: TabType; label: string }[] = [
    { id: 'subtitle-rules', label: '자막 규칙' },
    { id: 'profanity', label: '비속어 필터' },
    { id: 'proper-nouns', label: '고유명사' },
    { id: 'government-dict', label: '정부 용어' },
    { id: 'abbreviations', label: '약어' },
    { id: 'hallucination', label: '할루시네이션' },
    { id: 'sensitive-patterns', label: '민감정보' },
  ];

  return (
    <div style={styles.container}>
      {/* 헤더 */}
      <header style={styles.header}>
        <h1 style={styles.title}>STT 사전/필터 관리</h1>
        <p style={styles.subtitle}>비속어 필터, 고유명사, 정부 용어 사전을 관리합니다</p>
      </header>

      {/* 통계 */}
      {stats && (
        <div style={styles.stats}>
          <div style={styles.statItem}>
            <div style={styles.statValue}>{stats.profanity_count}</div>
            <div style={styles.statLabel}>비속어 필터</div>
          </div>
          <div style={styles.statItem}>
            <div style={styles.statValue}>{stats.sensitive_count}</div>
            <div style={styles.statLabel}>민감정보 패턴</div>
          </div>
          <div style={styles.statItem}>
            <div style={styles.statValue}>{stats.proper_noun_count}</div>
            <div style={styles.statLabel}>고유명사</div>
          </div>
          <div style={styles.statItem}>
            <div style={styles.statValue}>{stats.government_dict_count}</div>
            <div style={styles.statLabel}>정부 용어</div>
          </div>
          <div style={styles.statItem}>
            <div style={styles.statValue}>{stats.abbreviation_count}</div>
            <div style={styles.statLabel}>약어</div>
          </div>
          <div style={styles.statItem}>
            <div style={styles.statValue}>{stats.hallucination_count}</div>
            <div style={styles.statLabel}>할루시네이션</div>
          </div>
        </div>
      )}

      {/* 탭 */}
      <div style={styles.tabs}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            style={styles.tab(activeTab === tab.id)}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 메시지 */}
      {message && (
        <div style={styles.message(message.type)}>{message.text}</div>
      )}

      {/* 자막 규칙 탭 */}
      {activeTab === 'subtitle-rules' && (
        <div>
          <p style={styles.description}>실시간 자막 표시 규칙을 설정합니다. 변경사항은 즉시 프론트엔드에 적용됩니다.</p>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
            <div style={styles.ruleCard}>
              <label style={styles.ruleLabel}>자막 줄 수</label>
              <input
                type="number"
                min={1}
                max={5}
                value={subtitleRules.max_lines}
                onChange={e => setSubtitleRules({ ...subtitleRules, max_lines: parseInt(e.target.value) || 2 })}
                style={styles.ruleInput}
              />
              <p style={styles.ruleHint}>화면에 표시할 자막 줄 수 (1~5)</p>
            </div>

            <div style={styles.ruleCard}>
              <label style={styles.ruleLabel}>한 줄당 최대 글자 수</label>
              <input
                type="number"
                min={10}
                max={50}
                value={subtitleRules.max_chars_per_line}
                onChange={e => setSubtitleRules({ ...subtitleRules, max_chars_per_line: parseInt(e.target.value) || 18 })}
                style={styles.ruleInput}
              />
              <p style={styles.ruleHint}>한 줄에 표시할 최대 글자 수 (10~50)</p>
            </div>

            <div style={styles.ruleCard}>
              <label style={styles.ruleLabel}>묵음 시 페이드아웃 (ms)</label>
              <input
                type="number"
                min={1000}
                max={10000}
                step={500}
                value={subtitleRules.fade_timeout_ms}
                onChange={e => setSubtitleRules({ ...subtitleRules, fade_timeout_ms: parseInt(e.target.value) || 3000 })}
                style={styles.ruleInput}
              />
              <p style={styles.ruleHint}>묵음이 지속되면 자막 페이드아웃 (1000~10000ms)</p>
            </div>

            <div style={styles.ruleCard}>
              <label style={styles.ruleLabel}>자막 표시 지연 (ms)</label>
              <input
                type="number"
                min={0}
                max={5000}
                step={100}
                value={subtitleRules.display_delay_ms}
                onChange={e => setSubtitleRules({ ...subtitleRules, display_delay_ms: parseInt(e.target.value) || 0 })}
                style={styles.ruleInput}
              />
              <p style={styles.ruleHint}>자막 표시 전 대기 시간 (0=실시간)</p>
            </div>

            <div style={styles.ruleCard}>
              <label style={styles.ruleLabel}>최소 표시 시간 (ms)</label>
              <input
                type="number"
                min={500}
                max={5000}
                step={100}
                value={subtitleRules.min_display_ms}
                onChange={e => setSubtitleRules({ ...subtitleRules, min_display_ms: parseInt(e.target.value) || 1000 })}
                style={styles.ruleInput}
              />
              <p style={styles.ruleHint}>자막이 최소한 표시되어야 하는 시간</p>
            </div>

            <div style={styles.ruleCard}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={subtitleRules.break_on_sentence_end}
                  onChange={e => setSubtitleRules({ ...subtitleRules, break_on_sentence_end: e.target.checked })}
                  style={{ width: '18px', height: '18px', accentColor: colors.accent }}
                />
                <span style={{ fontWeight: 500 }}>문장 끝에서 줄바꿈</span>
              </label>
              <p style={styles.ruleHint}>마침표(.), 물음표(?), 느낌표(!) 후 줄바꿈</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button style={styles.btnPrimary} onClick={saveSubtitleRules}>저장</button>
            <button 
              style={{ ...styles.btnPrimary, background: colors.bgSecondary, color: colors.textPrimary }} 
              onClick={resetSubtitleRules}
            >
              기본값으로 초기화
            </button>
          </div>

          <div style={{ ...styles.ruleCard, marginTop: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>자막 표시 방식</h3>
            <ul style={{ fontSize: '0.85rem', color: colors.textSecondary, marginLeft: '1.5rem' }}>
              <li>아랫줄부터 채워지고, 꽉 차면 윗줄로 이동</li>
              <li>문장이 끝나면 (마침표 등) 즉시 줄바꿈</li>
              <li>묵음이 지속되면 페이드아웃으로 정리</li>
              <li>후처리 규칙 변경 시 이미 표시된 자막도 교체 가능</li>
            </ul>
          </div>
        </div>
      )}

      {/* 비속어 필터 탭 */}
      {activeTab === 'profanity' && (
        <div>
          <p style={styles.description}>방송 사고 방지를 위한 비속어 패턴입니다. 해당 단어가 감지되면 ***로 대체됩니다.</p>
          <div style={styles.formRow}>
            <input
              type="text"
              value={profanityInput}
              onChange={e => setProfanityInput(e.target.value)}
              placeholder="비속어 패턴 입력"
              style={styles.input}
              onKeyDown={e => e.key === 'Enter' && addProfanity()}
            />
            <button style={styles.btnPrimary} onClick={addProfanity}>추가</button>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <input
              type="text"
              placeholder="검색..."
              value={searchFilters.profanity || ''}
              onChange={e => setSearchFilters({ ...searchFilters, profanity: e.target.value })}
              style={{ ...styles.input, width: '100%' }}
            />
          </div>
          <div style={styles.itemList}>
            {getFilteredList(profanityList, 'profanity', item => item).map(item => (
              <div key={item} style={styles.item}>
                <span>{item}</span>
                <button style={styles.btnDanger} onClick={() => deleteProfanity(item)}>삭제</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 고유명사 탭 */}
      {activeTab === 'proper-nouns' && (
        <div>
          <p style={styles.description}>인명, 기관명, 지명 등 고유명사 교정 사전입니다. (오인식 → 정확한 표현)</p>
          <div style={styles.formRow}>
            <input
              type="text"
              value={properKey}
              onChange={e => setProperKey(e.target.value)}
              placeholder="오인식 (예: 이 재명)"
              style={styles.input}
            />
            <input
              type="text"
              value={properValue}
              onChange={e => setProperValue(e.target.value)}
              placeholder="정확한 표현 (예: 이재명)"
              style={styles.input}
              onKeyDown={e => e.key === 'Enter' && addProperNoun()}
            />
            <button style={styles.btnPrimary} onClick={addProperNoun}>추가</button>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <input
              type="text"
              placeholder="검색..."
              value={searchFilters.proper || ''}
              onChange={e => setSearchFilters({ ...searchFilters, proper: e.target.value })}
              style={{ ...styles.input, width: '100%' }}
            />
          </div>
          <div style={styles.itemList}>
            {getFilteredList(properNouns, 'proper', item => `${item.key} ${item.value}`).map(item => (
              <div key={item.key} style={styles.item}>
                <span>
                  <span style={{ color: colors.textPrimary }}>{item.key}</span>
                  <span style={{ color: colors.accent, margin: '0 0.5rem' }}>→</span>
                  <span style={{ color: colors.textSecondary }}>{item.value}</span>
                </span>
                <button style={styles.btnDanger} onClick={() => deleteProperNoun(item.key)}>삭제</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 정부 용어 탭 */}
      {activeTab === 'government-dict' && (
        <div>
          <p style={styles.description}>국회/국무회의 관련 용어 교정 사전입니다. (오인식 → 정확한 표현)</p>
          <div style={styles.formRow}>
            <input
              type="text"
              value={govtKey}
              onChange={e => setGovtKey(e.target.value)}
              placeholder="오인식 (예: 국민의뢰)"
              style={styles.input}
            />
            <input
              type="text"
              value={govtValue}
              onChange={e => setGovtValue(e.target.value)}
              placeholder="정확한 표현 (예: 국민의례)"
              style={styles.input}
              onKeyDown={e => e.key === 'Enter' && addGovtTerm()}
            />
            <button style={styles.btnPrimary} onClick={addGovtTerm}>추가</button>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <input
              type="text"
              placeholder="검색..."
              value={searchFilters.govt || ''}
              onChange={e => setSearchFilters({ ...searchFilters, govt: e.target.value })}
              style={{ ...styles.input, width: '100%' }}
            />
          </div>
          <div style={styles.itemList}>
            {getFilteredList(govtDict, 'govt', item => `${item.key} ${item.value}`).map(item => (
              <div key={item.key} style={styles.item}>
                <span>
                  <span style={{ color: colors.textPrimary }}>{item.key}</span>
                  <span style={{ color: colors.accent, margin: '0 0.5rem' }}>→</span>
                  <span style={{ color: colors.textSecondary }}>{item.value}</span>
                </span>
                <button style={styles.btnDanger} onClick={() => deleteGovtTerm(item.key)}>삭제</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 약어 탭 */}
      {activeTab === 'abbreviations' && (
        <div>
          <p style={styles.description}>약어 변환 사전입니다. (한글 발음 → 영문 약어)</p>
          <div style={styles.formRow}>
            <input
              type="text"
              value={abbrKey}
              onChange={e => setAbbrKey(e.target.value)}
              placeholder="한글 발음 (예: 아이엠에프)"
              style={styles.input}
            />
            <input
              type="text"
              value={abbrValue}
              onChange={e => setAbbrValue(e.target.value)}
              placeholder="영문 약어 (예: IMF)"
              style={styles.input}
              onKeyDown={e => e.key === 'Enter' && addAbbreviation()}
            />
            <button style={styles.btnPrimary} onClick={addAbbreviation}>추가</button>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <input
              type="text"
              placeholder="검색..."
              value={searchFilters.abbr || ''}
              onChange={e => setSearchFilters({ ...searchFilters, abbr: e.target.value })}
              style={{ ...styles.input, width: '100%' }}
            />
          </div>
          <div style={styles.itemList}>
            {getFilteredList(abbreviations, 'abbr', item => `${item.key} ${item.value}`).map(item => (
              <div key={item.key} style={styles.item}>
                <span>
                  <span style={{ color: colors.textPrimary }}>{item.key}</span>
                  <span style={{ color: colors.accent, margin: '0 0.5rem' }}>→</span>
                  <span style={{ color: colors.textSecondary }}>{item.value}</span>
                </span>
                <button style={styles.btnDanger} onClick={() => deleteAbbreviation(item.key)}>삭제</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 할루시네이션 탭 */}
      {activeTab === 'hallucination' && (
        <div>
          <p style={styles.description}>Whisper STT가 잘못 인식하는 할루시네이션 패턴입니다. 정규식 형태로 입력하세요.</p>
          <div style={styles.formRow}>
            <input
              type="text"
              value={hallucinationInput}
              onChange={e => setHallucinationInput(e.target.value)}
              placeholder="할루시네이션 패턴 (정규식, 예: ^감사합니다\.?$)"
              style={styles.input}
              onKeyDown={e => e.key === 'Enter' && addHallucination()}
            />
            <button style={styles.btnPrimary} onClick={addHallucination}>추가</button>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <input
              type="text"
              placeholder="검색..."
              value={searchFilters.hallucination || ''}
              onChange={e => setSearchFilters({ ...searchFilters, hallucination: e.target.value })}
              style={{ ...styles.input, width: '100%' }}
            />
          </div>
          <div style={styles.itemList}>
            {getFilteredList(hallucinations, 'hallucination', item => item).map(item => (
              <div key={item} style={styles.item}>
                <span style={{ fontFamily: 'monospace' }}>{item}</span>
                <button style={styles.btnDanger} onClick={() => deleteHallucination(item)}>삭제</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 민감정보 탭 */}
      {activeTab === 'sensitive-patterns' && (
        <div>
          <p style={styles.description}>개인정보 보호를 위한 민감정보 패턴입니다. (수정 불가)</p>
          <div style={styles.itemList}>
            {sensitivePatterns.map((item, idx) => (
              <div key={idx} style={styles.item}>
                <span>
                  <span style={{ color: colors.textPrimary, fontFamily: 'monospace' }}>{item.pattern}</span>
                  <span style={{ color: colors.accent, margin: '0 0.5rem' }}>→</span>
                  <span style={{ color: colors.textSecondary }}>{item.replacement}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
