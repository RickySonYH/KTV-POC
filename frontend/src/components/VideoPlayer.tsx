// [advice from AI] 동영상 플레이어 - 실시간 캡션 오버레이 + HLS 지원

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import Hls from 'hls.js';
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
  const hlsRef = useRef<Hls | null>(null);
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

  // [advice from AI] ★★★ HLS 스트리밍 지원 ★★★
  useEffect(() => {
    const videoElement = videoRef.current;
    const url = videoUrl || video?.url;
    
    if (!videoElement || !url) return;
    
    // 이전 HLS 인스턴스 정리
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    
    // HLS URL 감지 (.m3u8)
    const isHlsUrl = url.includes('.m3u8') || url.includes('m3u8');
    
    if (isHlsUrl && Hls.isSupported()) {
      console.log('[VIDEO] 🎬 HLS 스트리밍 감지 → hls.js 사용');
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,  // [advice from AI] 저지연 모드
        backBufferLength: 90,
      });
      
      hls.loadSource(url);
      hls.attachMedia(videoElement);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('[VIDEO] ✅ HLS 매니페스트 로드 완료');
      });
      
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.error('[VIDEO] ❌ HLS 치명적 오류:', data.type, data.details);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            console.log('[VIDEO] 🔄 네트워크 오류 → 복구 시도...');
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            console.log('[VIDEO] 🔄 미디어 오류 → 복구 시도...');
            hls.recoverMediaError();
          }
        }
      });
      
      hlsRef.current = hls;
    } else if (isHlsUrl && videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari 네이티브 HLS 지원
      console.log('[VIDEO] 🎬 Safari 네이티브 HLS 사용');
      videoElement.src = url;
    } else {
      // 일반 비디오
      console.log('[VIDEO] 🎬 일반 비디오 소스 설정');
      videoElement.src = url;
    }
    
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [video?.url, videoUrl]);

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
        {/* [advice from AI] HLS는 hls.js가 src 관리, 일반 비디오는 useEffect에서 설정 */}
        <video
          ref={videoRef}
          className="video-player"
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
        {(subtitleLines.length > 0 || (liveSubtitleLines && (liveSubtitleLines[0] || liveSubtitleLines[1]))) && (
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
              ) : (isProcessing || (liveSubtitleLines && (liveSubtitleLines[0] || liveSubtitleLines[1]))) ? (
                // [advice from AI] ★ 60자 FIFO 자막 - 상단(오래된) / 하단(최신)
                // 부드러운 텍스트 전환 애니메이션 적용
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '6px', 
                  minHeight: '30px',
                  overflow: 'hidden'
                }}>
                  {/* [advice from AI] 상단 - 올라간 텍스트 */}
                  <div style={{
                    transition: 'all 0.3s ease-out',
                    opacity: liveSubtitleLines && liveSubtitleLines[0] ? 1 : 0,
                    transform: liveSubtitleLines && liveSubtitleLines[0] ? 'translateY(0)' : 'translateY(10px)',
                    minHeight: '32px'
                  }}>
                      <span style={{
                        color: '#fff',
                        fontSize: '24px',
                        fontWeight: '600',
                      lineHeight: '1.5',
                        letterSpacing: '0.5px',
                      textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                      transition: 'all 0.3s ease-out'
                      }}>
                      {liveSubtitleLines && liveSubtitleLines[0] ? liveSubtitleLines[0] : ''}
                      </span>
                    </div>
                  {/* [advice from AI] 하단 - 현재 채워지는 텍스트 */}
                  <div style={{
                    transition: 'all 0.3s ease-out',
                    opacity: liveSubtitleLines && liveSubtitleLines[1] ? 1 : 0,
                    transform: liveSubtitleLines && liveSubtitleLines[1] ? 'translateY(0)' : 'translateY(15px)',
                    minHeight: '32px'
                  }}>
                    <span style={{
                      color: '#fff',
                      fontSize: '24px',
                      fontWeight: '600',
                      lineHeight: '1.5',
                      letterSpacing: '0.5px',
                      textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                      transition: 'all 0.3s ease-out'
                    }}>
                      {liveSubtitleLines && liveSubtitleLines[1] ? liveSubtitleLines[1] : ''}
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
