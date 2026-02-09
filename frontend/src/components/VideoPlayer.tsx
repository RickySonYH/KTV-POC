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

// [advice from AI] ★ 화자별 색상 + 라벨
const SPEAKER_COLORS: Record<number, string> = {
  0: '#4FC3F7',  // 화자1 - 파란
  1: '#81C784',  // 화자2 - 초록
  2: '#FFB74D',  // 화자3 - 주황
  3: '#CE93D8',  // 화자4 - 보라
};
const SPEAKER_LABELS: Record<number, string> = {
  0: '화자1',
  1: '화자2',
  2: '화자3',
  3: '화자4',
};

interface VideoPlayerProps {
  video?: VideoFile | null;
  videoUrl?: string | null;
  currentSpeaker: string | null;
  subtitleLines?: SubtitleLine[];  // [advice from AI] 3줄 자막 시스템용
  // [advice from AI] ★★★ 3줄 자막 + 화자 라벨 ★★★
  liveSubtitleLines?: Array<{text: string; speaker: number}>;
  currentLiveSpeaker?: number;
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
  currentLiveSpeaker = -1,  // [advice from AI] ★ 현재 화자 번호
  onTimeUpdate, 
  onDurationChange,
  onPlay,
  onPause,
  isProcessing
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);  // [advice from AI] ★ 전체화면 대상
  const hlsRef = useRef<Hls | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPlayButton, setShowPlayButton] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
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

  // [advice from AI] ★★★ 전체화면: container 기준으로 (자막 포함) ★★★
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // [advice from AI] video 더블클릭 → container fullscreen (자막 포함!)
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    const handleDblClick = (e: Event) => {
      e.preventDefault();
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current?.requestFullscreen();
      }
    };
    videoEl.addEventListener('dblclick', handleDblClick);
    return () => videoEl.removeEventListener('dblclick', handleDblClick);
  }, []);

  return (
    <div className="card" style={{ margin: 0 }}>
      <div ref={containerRef} className="video-container" style={{ position: 'relative', background: '#000' }}>
        {/* [advice from AI] HLS는 hls.js가 src 관리, 일반 비디오는 useEffect에서 설정 */}
        <video
          ref={videoRef}
          className="video-player"
          controls
          crossOrigin="anonymous"
          style={{ width: '100%', maxHeight: isFullscreen ? '100vh' : '600px', display: 'block', background: '#000', borderRadius: isFullscreen ? '0' : '8px' }}
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
        {(subtitleLines.length > 0 || (liveSubtitleLines && liveSubtitleLines.some(l => l?.text))) && (
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
              textAlign: 'left',  // [advice from AI] 좌에서 우로 텍스트 쓰기
              border: 'none'
            }}>
              {/* [advice from AI] ★★★ TV 방송 스타일 3줄 자막 + 화자 라벨 ★★★ */}
              {(isProcessing || (liveSubtitleLines && liveSubtitleLines.some(l => l?.text))) ? (
                <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
                  {/* [advice from AI] 왼쪽: 화자 라벨 + 색상 바 */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: '50px',
                    borderRight: `3px solid ${currentLiveSpeaker >= 0 ? (SPEAKER_COLORS[currentLiveSpeaker] || '#888') : '#888'}`,
                    paddingRight: '10px',
                    transition: 'border-color 0.2s ease',
                  }}>
                    <span style={{
                      color: currentLiveSpeaker >= 0 ? (SPEAKER_COLORS[currentLiveSpeaker] || '#aaa') : '#aaa',
                      fontSize: '11px',
                      fontWeight: '700',
                      letterSpacing: '1px',
                      transition: 'color 0.2s ease',
                    }}>
                      {currentLiveSpeaker >= 0 ? (SPEAKER_LABELS[currentLiveSpeaker] || `화자${currentLiveSpeaker + 1}`) : ''}
                    </span>
                  </div>
                  {/* [advice from AI] 오른쪽: 3줄 자막 텍스트 (흰색 통일) */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, overflow: 'hidden' }}>
                    {liveSubtitleLines?.map((line, i) => (
                      <div key={i} style={{
                        transition: 'all 0.3s ease-out',
                        opacity: line?.text ? 1 : 0,
                        minHeight: '30px',
                      }}>
                        <span style={{
                          color: '#fff',
                          fontSize: '22px',
                          fontWeight: '600',
                          lineHeight: '1.4',
                          letterSpacing: '0.5px',
                          textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {line?.text || ''}
                        </span>
                      </div>
                    ))}
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
