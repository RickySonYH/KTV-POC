// [advice from AI] 자막 목록 - 실시간 스트리밍 + SRT 다운로드 + 수동 편집

import { useEffect, useRef, useState, useCallback } from 'react';
import type { SubtitleSegment } from '../types/subtitle';

interface SubtitleListProps {
  subtitles: SubtitleSegment[];
  currentTime: number;
  status: 'idle' | 'processing' | 'completed' | 'error';
  latestId: number | null;
  videoName?: string;  // [advice from AI] 다운로드 파일명용
  onSubtitleEdit?: (id: number, newText: string) => void;  // [advice from AI] 편집 콜백
}

const SubtitleList = ({ subtitles, currentTime, status, latestId, videoName = 'subtitle', onSubtitleEdit }: SubtitleListProps) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState<string>('');

  // [advice from AI] 시간을 타임코드 형식으로 변환 (MM:SS)
  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // [advice from AI] 시간을 SRT 형식으로 변환 (HH:MM:SS,mmm)
  const formatSrtTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  };

  // [advice from AI] 화자별 색상
  const getSpeakerColor = (speaker?: string) => {
    if (!speaker) return '#0073cf';
    const num = parseInt(speaker.replace(/\D/g, '')) || 1;
    const colors = ['#0073cf', '#28a745', '#fd7e14', '#6f42c1'];
    return colors[(num - 1) % colors.length];
  };

  // [advice from AI] SRT 파일 생성 및 다운로드
  const handleDownloadSrt = useCallback(() => {
    if (subtitles.length === 0) return;

    const srtContent = subtitles.map((sub, index) => {
      const speakerPrefix = sub.speaker ? `[${sub.speaker}] ` : '';
      return `${index + 1}\n${formatSrtTime(sub.startTime)} --> ${formatSrtTime(sub.endTime)}\n${speakerPrefix}${sub.text}\n`;
    }).join('\n');

    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const baseName = videoName.replace(/\.[^/.]+$/, '');
    link.download = `${baseName}.srt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [subtitles, videoName]);

  // [advice from AI] 편집 시작
  const handleEditStart = (subtitle: SubtitleSegment) => {
    setEditingId(subtitle.id);
    setEditText(subtitle.text);
  };

  // [advice from AI] 편집 저장
  const handleEditSave = () => {
    if (editingId !== null && onSubtitleEdit) {
      onSubtitleEdit(editingId, editText);
    }
    setEditingId(null);
    setEditText('');
  };

  // [advice from AI] 편집 취소
  const handleEditCancel = () => {
    setEditingId(null);
    setEditText('');
  };

  // [advice from AI] Enter로 저장, Escape로 취소
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSave();
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  // [advice from AI] 새 자막 추가 시 스크롤
  useEffect(() => {
    if (listRef.current && subtitles.length > 0) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [subtitles.length]);

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '12px',
        paddingBottom: '12px',
        borderBottom: '2px solid var(--ktv-primary)'
      }}>
        <span style={{ fontSize: '18px', fontWeight: '600' }}>
          자막 목록
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '13px', color: '#666' }}>
            {status === 'processing' && (
              <span style={{ color: '#dc3545', fontWeight: 'bold' }}>● 실시간 </span>
            )}
            총 {subtitles.length}개
          </span>
          {/* [advice from AI] SRT 다운로드 버튼 */}
          <button
            onClick={handleDownloadSrt}
            disabled={subtitles.length === 0}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              fontWeight: '600',
              color: subtitles.length === 0 ? '#999' : '#fff',
              background: subtitles.length === 0 ? '#e0e0e0' : '#0073cf',
              border: 'none',
              borderRadius: '4px',
              cursor: subtitles.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s'
            }}
            onMouseOver={(e) => {
              if (subtitles.length > 0) {
                e.currentTarget.style.background = '#005bb5';
              }
            }}
            onMouseOut={(e) => {
              if (subtitles.length > 0) {
                e.currentTarget.style.background = '#0073cf';
              }
            }}
          >
            SRT 다운로드
          </button>
        </div>
      </div>

      <div 
        ref={listRef}
        style={{ 
          height: '350px', 
          overflowY: 'auto',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          background: '#fafafa'
        }}
      >
        {subtitles.length === 0 ? (
          <div style={{ 
            height: '100%', 
            display: 'flex', 
            flexDirection: 'column',
            alignItems: 'center', 
            justifyContent: 'center',
            color: '#999'
          }}>
            <div style={{ fontSize: '14px', color: '#999' }}>영상을 재생하면 자막이 여기에 표시됩니다</div>
          </div>
        ) : (
          subtitles.map((subtitle) => {
            const isActive = currentTime >= subtitle.startTime && currentTime <= subtitle.endTime;
            const isLatest = subtitle.id === latestId;
            const isEditing = editingId === subtitle.id;
            
            return (
              <div
                key={subtitle.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '10px 12px',
                  borderBottom: '1px solid #eee',
                  background: isEditing ? '#fff8e1' : isActive ? '#e3f2fd' : isLatest ? '#fff3cd' : '#fff',
                  transition: 'background 0.2s'
                }}
              >
                {/* 시간 */}
                <span style={{
                  flexShrink: 0,
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: '#888',
                  minWidth: '45px',
                  paddingTop: '2px'
                }}>
                  {formatTime(subtitle.startTime)}
                </span>
                
                {/* 화자 */}
                <span style={{
                  flexShrink: 0,
                  padding: '2px 8px',
                  borderRadius: '10px',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  color: '#fff',
                  background: getSpeakerColor(subtitle.speaker),
                  minWidth: '45px',
                  textAlign: 'center'
                }}>
                  {subtitle.speaker || '화자'}
                </span>
                
                {/* 텍스트 - 편집 모드 */}
                {isEditing ? (
                  <div style={{ flex: 1, display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      autoFocus
                      style={{
                        flex: 1,
                        padding: '4px 8px',
                        fontSize: '14px',
                        border: '2px solid #0073cf',
                        borderRadius: '4px',
                        outline: 'none'
                      }}
                    />
                    <button
                      onClick={handleEditSave}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        color: '#fff',
                        background: '#28a745',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      저장
                    </button>
                    <button
                      onClick={handleEditCancel}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        color: '#666',
                        background: '#e0e0e0',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  /* 텍스트 - 일반 모드 (더블클릭으로 편집) */
                  <span
                    onDoubleClick={() => onSubtitleEdit && handleEditStart(subtitle)}
                    style={{
                      flex: 1,
                      fontSize: '14px',
                      color: '#333',
                      lineHeight: '1.4',
                      cursor: onSubtitleEdit ? 'text' : 'default',
                      padding: '2px 4px',
                      borderRadius: '4px',
                      transition: 'background 0.2s'
                    }}
                    title={onSubtitleEdit ? '더블클릭하여 편집' : undefined}
                  >
                    {subtitle.text}
                  </span>
                )}
                
                {/* NEW 표시 */}
                {isLatest && !isEditing && (
                  <span style={{
                    fontSize: '9px',
                    color: '#fff',
                    background: '#dc3545',
                    padding: '1px 6px',
                    borderRadius: '8px',
                    fontWeight: 'bold'
                  }}>
                    NEW
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
      
      {/* [advice from AI] 편집 안내 문구 */}
      {onSubtitleEdit && subtitles.length > 0 && (
        <div style={{ 
          marginTop: '8px', 
          fontSize: '11px', 
          color: '#888',
          textAlign: 'right'
        }}>
          💡 자막을 더블클릭하면 직접 편집할 수 있습니다
        </div>
      )}
    </div>
  );
};

export default SubtitleList;
