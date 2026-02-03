// [advice from AI] 자막 파일 내보내기 컴포넌트 (SRT, VTT 지원) - 서버 생성 콘텐츠 지원

import type { SubtitleSegment } from '../types/subtitle';

interface SubtitleExportProps {
  subtitles: SubtitleSegment[];
  videoName: string;
  disabled: boolean;
  srtContent?: string;  // [advice from AI] 서버에서 생성한 SRT
  vttContent?: string;  // [advice from AI] 서버에서 생성한 VTT
}

const SubtitleExport = ({ subtitles, videoName, disabled, srtContent, vttContent }: SubtitleExportProps) => {
  
  // [advice from AI] 시간을 SRT 형식으로 변환 (HH:MM:SS,mmm)
  const formatSrtTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  };

  // [advice from AI] 시간을 VTT 형식으로 변환 (HH:MM:SS.mmm)
  const formatVttTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  // [advice from AI] SRT 형식으로 변환 (서버 콘텐츠 없을 때)
  const generateSrt = (): string => {
    return subtitles.map((sub, index) => {
      const speakerPrefix = sub.speaker ? `[${sub.speaker}] ` : '';
      return `${index + 1}\n${formatSrtTime(sub.startTime)} --> ${formatSrtTime(sub.endTime)}\n${speakerPrefix}${sub.text}\n`;
    }).join('\n');
  };

  // [advice from AI] VTT 형식으로 변환 (서버 콘텐츠 없을 때)
  const generateVtt = (): string => {
    const header = 'WEBVTT\n\n';
    const body = subtitles.map((sub, index) => {
      const speakerPrefix = sub.speaker ? `<v ${sub.speaker}>` : '';
      return `${index + 1}\n${formatVttTime(sub.startTime)} --> ${formatVttTime(sub.endTime)}\n${speakerPrefix}${sub.text}\n`;
    }).join('\n');
    return header + body;
  };

  // [advice from AI] 파일 다운로드 함수
  const downloadFile = (content: string, extension: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    // 파일명에서 확장자 제거 후 새 확장자 추가
    const baseName = videoName.replace(/\.[^/.]+$/, '');
    link.download = `${baseName}.${extension}`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportSrt = () => {
    // [advice from AI] 서버에서 생성한 콘텐츠 우선 사용
    const content = srtContent || generateSrt();
    downloadFile(content, 'srt');
  };

  const handleExportVtt = () => {
    // [advice from AI] 서버에서 생성한 콘텐츠 우선 사용
    const content = vttContent || generateVtt();
    downloadFile(content, 'vtt');
  };

  return (
    <div className="card">
      <div className="card-title">자막 파일 내보내기</div>
      <p style={{ color: '#666', marginBottom: '16px', fontSize: '14px' }}>
        생성된 자막을 SRT 또는 VTT 형식으로 다운로드할 수 있습니다.
        {subtitles.length > 0 && (
          <span style={{ color: 'var(--ktv-primary)', fontWeight: 500 }}>
            {' '}({subtitles.length}개 자막 준비됨)
          </span>
        )}
      </p>
      <div className="btn-group">
        <button 
          className="btn btn-primary" 
          onClick={handleExportSrt}
          disabled={disabled}
        >
          SRT 다운로드
        </button>
        <button 
          className="btn btn-secondary" 
          onClick={handleExportVtt}
          disabled={disabled}
        >
          VTT 다운로드
        </button>
      </div>
      {disabled && (
        <p style={{ color: '#999', marginTop: '12px', fontSize: '13px' }}>
          * 자막 생성이 완료되면 다운로드가 활성화됩니다.
        </p>
      )}
    </div>
  );
};

export default SubtitleExport;
