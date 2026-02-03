// [advice from AI] 동영상 플레이어 - 실시간 캡션 오버레이

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import type { VideoFile } from '../types/subtitle';

// [advice from AI] 2줄 자막 타입
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
  subtitleLines?: SubtitleLine[];  // [advice from AI] 2줄 자막 시스템용
  liveSubtitleLines?: string[];  // [advice from AI] 실시간 오디오 캡처용 2줄 자막 (윗줄, 아랫줄)
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
  currentSpeaker,
  subtitleLines = [],  // [advice from AI] 2줄 자막
  liveSubtitleLines,  // [advice from AI] 실시간 오디오 캡처용 2줄 자막
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

  // [advice from AI] 화자별 색상
  const getSpeakerColor = (speaker?: string | null) => {
    if (!speaker) return '#0073cf';
    const num = parseInt(speaker.replace(/\D/g, '')) || 1;
    const colors = ['#0073cf', '#28a745', '#fd7e14', '#6f42c1'];
    return colors[(num - 1) % colors.length];
  };

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
        
        {/* [advice from AI] 2줄 자막 시스템 - 아래서 추가(페이드인), 위에서 삭제(페이드아웃) */}
        {/* [advice from AI] liveSubtitleLines: 윗줄[0], 아랫줄[1] - 20자씩 누적 표시 */}
        {(subtitleLines.length > 0 || (liveSubtitleLines && (liveSubtitleLines[0] || liveSubtitleLines[1]))) && (
          <div style={{
            position: 'absolute',
            bottom: '60px',
            left: '0',
            right: '0',
            display: 'flex',
            justifyContent: 'center',
            zIndex: 10
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(0, 0, 0, 0.85)',
              padding: '14px 28px',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              maxWidth: '90%',
              textAlign: 'center'
            }}>
              {/* [advice from AI] 실시간 오디오 캡처용 자막 (최우선) - 2줄 고정 */}
              {liveSubtitleLines && (liveSubtitleLines[0] || liveSubtitleLines[1]) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {/* 윗줄 (이전에 완성된 20자) */}
                  {liveSubtitleLines[0] && (
                    <div style={{ opacity: 0.7 }}>
                      <span style={{
                        color: '#fff',
                        fontSize: '18px',
                        fontWeight: '400',
                        lineHeight: '1.4',
                        textShadow: '1px 1px 3px rgba(0,0,0,0.7)'
                      }}>
                        {liveSubtitleLines[0]}
                      </span>
                    </div>
                  )}
                  {/* 아랫줄 (현재 쌓이는 중인 텍스트) */}
                  {liveSubtitleLines[1] && (
                    <div>
                      <span style={{
                        color: '#fff',
                        fontSize: '22px',
                        fontWeight: '600',
                        lineHeight: '1.4',
                        textShadow: '1px 1px 3px rgba(0,0,0,0.7)'
                      }}>
                        {liveSubtitleLines[1]}
                        {/* 입력 중 커서 표시 */}
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
                  )}
                </div>
              ) : subtitleLines.length > 0 ? (
                /* [advice from AI] 기존 2줄 자막 시스템 */
                subtitleLines.map((line, idx) => (
                  <div 
                    key={line.id} 
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      opacity: line.fading ? 0 : (idx === 0 && subtitleLines.length > 1 ? 0.6 : 1),
                      transform: line.fading ? 'translateY(-10px)' : 'translateY(0)',
                      transition: 'all 0.5s ease',  // 페이드 애니메이션
                    }}
                  >
                    {line.speaker && idx === subtitleLines.length - 1 && (
                      <span style={{
                        display: 'inline-block',
                        background: getSpeakerColor(line.speaker),
                        color: '#fff',
                        padding: '2px 10px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        flexShrink: 0
                      }}>
                        {line.speaker}
                      </span>
                    )}
                    <span style={{
                      color: '#fff',
                      fontSize: idx === subtitleLines.length - 1 ? '22px' : '17px',
                      fontWeight: idx === subtitleLines.length - 1 ? '600' : '400',
                      lineHeight: '1.4',
                      textShadow: '1px 1px 3px rgba(0,0,0,0.7)'
                    }}>
                      {line.text}
                    </span>
                  </div>
                ))
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
