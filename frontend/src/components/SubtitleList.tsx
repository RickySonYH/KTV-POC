// [advice from AI] 자막 목록 - 실시간 스트리밍 스타일 (스크롤 수정)

import { useEffect, useRef } from 'react';
import type { SubtitleSegment } from '../types/subtitle';

interface SubtitleListProps {
  subtitles: SubtitleSegment[];
  currentTime: number;
  status: 'idle' | 'processing' | 'completed' | 'error';
  latestId: number | null;  // [advice from AI] 최신 자막 ID
}

const SubtitleList = ({ subtitles, currentTime, status, latestId }: SubtitleListProps) => {
  const listRef = useRef<HTMLDivElement>(null);

  // [advice from AI] 시간을 타임코드 형식으로 변환
  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // [advice from AI] 화자별 색상
  const getSpeakerColor = (speaker?: string) => {
    if (!speaker) return '#0073cf';
    const num = parseInt(speaker.replace(/\D/g, '')) || 1;
    const colors = ['#0073cf', '#28a745', '#fd7e14', '#6f42c1'];
    return colors[(num - 1) % colors.length];
  };

  // [advice from AI] 새 자막 추가 시 스크롤 - 심플하게 scrollTop 사용
  useEffect(() => {
    if (listRef.current && subtitles.length > 0) {
      // 맨 아래로 스크롤
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
        <span style={{ fontSize: '13px', color: '#666' }}>
          {status === 'processing' && (
            <span style={{ color: '#dc3545', fontWeight: 'bold' }}>실시간 | </span>
          )}
          총 {subtitles.length}개
        </span>
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
            
            return (
              <div
                key={subtitle.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '10px 12px',
                  borderBottom: '1px solid #eee',
                  background: isActive ? '#e3f2fd' : isLatest ? '#fff3cd' : '#fff',
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
                
                {/* 텍스트 */}
                <span style={{
                  flex: 1,
                  fontSize: '14px',
                  color: '#333',
                  lineHeight: '1.4'
                }}>
                  {subtitle.text}
                </span>
                
                {/* NEW 표시 */}
                {isLatest && (
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
    </div>
  );
};

export default SubtitleList;
