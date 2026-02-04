// [advice from AI] 동영상 플레이어 - 실시간 캡션 오버레이

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import type { VideoFile } from '../types/subtitle';

// [advice from AI] 3줄 자막 타입
interface SubtitleLine {
  text: string;
  speaker?: string;
  id: number;
  fading?: boolean;
}

interface VideoPlayerProps {
  video?: VideoFile | null;
  videoUrl?: string | null;
  currentSpeaker: string | null;
  subtitleLines?: SubtitleLine[];  // [advice from AI] 3줄 자막 시스템용
  liveSubtitleLines?: string[];  // [advice from AI] 실시간 오디오 캡처용 3줄 자막 (상단, 중간, 하단)
  onTimeUpdate: (currentTime: number) => void;
  onDurationChange: (duration: number) => void;
  onPlay: () => void;
  onPause: () => void;
  isProcessing: boolean;
}

// [advice from AI] ref를 통해 video 요소에 접근 가능하게 함 (라이브 STT용)
export interface VideoPlayerRef {
  getVideoElement: () => HTMLVideoElement | null;
}

const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(({ 
  video, 
  videoUrl,
  subtitleLines = [],  // [advice from AI] 3줄 자막
  liveSubtitleLines,  // [advice from AI] 실시간 오디오 캡처용 3줄 자막
  onTimeUpdate, 
  onDurationChange,
  onPlay,
  onPause,
  isProcessing
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPlayButton, setShowPlayButton] = useState(true);
  
  // [advice from AI] ref 노출
  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current
  }), []);

  // [advice from AI] 중앙 재생 버튼 클릭
  const handleCenterPlayClick = () => {
    if (videoRef.current) {
      videoRef.current.play();
      setShowPlayButton(false);
    }
  };

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const handleTimeUpdate = () => {
      onTimeUpdate(videoElement.currentTime);
    };

    const handleLoadedMetadata = () => {
      onDurationChange(videoElement.duration);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      setShowPlayButton(false);
      onPlay();
    };

    const handlePause = () => {
      setIsPlaying(false);
      setShowPlayButton(true);
      onPause();
    };

    videoElement.addEventListener('timeupdate', handleTimeUpdate);
    videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoElement.addEventListener('play', handlePlay);
    videoElement.addEventListener('pause', handlePause);

    return () => {
      videoElement.removeEventListener('timeupdate', handleTimeUpdate);
      videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      videoElement.removeEventListener('play', handlePlay);
      videoElement.removeEventListener('pause', handlePause);
    };
  }, [onTimeUpdate, onDurationChange, onPlay, onPause]);

  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="video-container" style={{ position: 'relative' }}>
        <video
          ref={videoRef}
          className="video-player"
          src={videoUrl || video?.url}
          controls
          crossOrigin="anonymous"
          style={{ width: '100%', maxHeight: '600px', display: 'block', background: '#000', borderRadius: '8px' }}
        />
        
        {/* [advice from AI] 유튜브 스타일 큰 재생 버튼 (중앙) */}
        {showPlayButton && !isPlaying && (
          <div 
            onClick={handleCenterPlayClick}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '80px',
              height: '80px',
              background: 'rgba(0, 86, 179, 0.9)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1.1)';
              e.currentTarget.style.background = 'rgba(0, 86, 179, 1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translate(-50%, -50%) scale(1)';
              e.currentTarget.style.background = 'rgba(0, 86, 179, 0.9)';
            }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        )}
        
        {/* [advice from AI] 3줄 자막 시스템 - 상단[0], 중간[1], 하단/수집창[2] */}
        {/* [advice from AI] liveSubtitleLines: 상단[0], 중간[1], 수집창[2] - 30자씩 누적 표시 */}
        {/* [advice from AI] ★ [2]도 체크해야 수집창만 있을 때도 컨테이너 표시됨! */}
        {/* [advice from AI] ★★★ 자막창 위치: 화면 중앙, 30자 고정 너비, 텍스트 좌측 정렬 ★★★ */}
        {(subtitleLines.length > 0 || (liveSubtitleLines && (liveSubtitleLines[0] || liveSubtitleLines[1] || liveSubtitleLines[2]))) && (
          <div style={{
            position: 'absolute',
            bottom: '60px',
            left: '50%',  // [advice from AI] 화면 중앙 기준
            transform: 'translateX(-50%)',  // [advice from AI] 정확한 중앙 정렬
            zIndex: 10
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',  // [advice from AI] 텍스트 좌측 정렬
              gap: '6px',
              background: 'rgba(0, 0, 0, 0.85)',
              padding: '14px 28px',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              width: '720px',  // [advice from AI] 30자 기준 고정 너비 (24px * 30자)
              minWidth: '720px',
              maxWidth: '720px',
              textAlign: 'left'  // [advice from AI] 좌에서 우로 텍스트 쓰기
            }}>
              {/* [advice from AI] 확정 자막 (subtitleLines) 우선 표시 - 화자분리 "-" 적용됨 */}
              {subtitleLines.length > 0 ? (
                subtitleLines.map((line) => (
                  <div 
                    key={line.id} 
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      opacity: line.fading ? 0 : 1,
                      transform: line.fading ? 'translateY(-10px)' : 'translateY(0)',
                      transition: 'all 0.5s ease',
                      maxWidth: '100%',  // [advice from AI] 한 줄 제한
                    }}
                  >
                    <span style={{
                      color: '#fff',
                      fontSize: '24px',
                      fontWeight: '600',
                      lineHeight: '1.4',  // [advice from AI] 줄 간격 축소
                      letterSpacing: '0.5px',
                      textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                      whiteSpace: 'nowrap',  // [advice from AI] 한 줄 강제
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '100%',
                    }}>
                      {line.text}
                    </span>
                  </div>
                ))
              ) : (isProcessing || (liveSubtitleLines && (liveSubtitleLines[0] || liveSubtitleLines[1] || liveSubtitleLines[2]))) ? (
                // [advice from AI] ★ isProcessing 중이면 컨테이너 항상 표시!
                // 묵음 시에도 컨테이너가 사라지지 않고, 새 자막이 즉시 나타남
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minHeight: '30px' }}>
                  {/* [advice from AI] 1줄 (상단) - 가장 오래된 확정 자막 */}
                  {liveSubtitleLines && liveSubtitleLines[0] ? (
                    <div>
                      <span style={{
                        color: '#fff',
                        fontSize: '24px',
                        fontWeight: '600',
                        lineHeight: '1.6',
                        letterSpacing: '0.5px',
                        textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                      }}>
                        {liveSubtitleLines[0]}
                      </span>
                    </div>
                  ) : null}
                  {/* [advice from AI] 2줄 (중간) - 이전 확정 자막 */}
                  {liveSubtitleLines && liveSubtitleLines[1] ? (
                  <div>
                      <span style={{
                        color: '#fff',
                        fontSize: '24px',
                        fontWeight: '600',
                        lineHeight: '1.6',
                        letterSpacing: '0.5px',
                        textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                      }}>
                        {liveSubtitleLines[1]}
                      </span>
                    </div>
                  ) : null}
                  {/* [advice from AI] 3줄 (하단) - 현재 인식 중인 자막 */}
                  <div style={{ minHeight: '30px' }}>
                    <span style={{
                      color: '#fff',
                      fontSize: '24px',
                      fontWeight: '600',
                      lineHeight: '1.6',
                      letterSpacing: '0.5px',
                      textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                    }}>
                      {liveSubtitleLines && liveSubtitleLines[2] ? liveSubtitleLines[2] : ''}
                      {/* [advice from AI] 입력 중 커서 표시 - 항상 표시하여 수집 중임을 알림 */}
                      {isProcessing && (
                        <span style={{
                          display: 'inline-block',
                          width: '2px',
                          height: '1.2em',
                          background: '#fff',
                          marginLeft: '2px',
                          verticalAlign: 'middle',
                          animation: 'blink 0.7s infinite'
                        }} />
                      )}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* [advice from AI] 실시간 처리 중 표시 */}
        {isProcessing && isPlaying && (
          <div style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(220, 53, 69, 0.9)',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: 'bold'
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              background: '#fff',
              borderRadius: '50%',
              animation: 'pulse 1s infinite'
            }}></span>
            LIVE STT
          </div>
        )}
      </div>
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
