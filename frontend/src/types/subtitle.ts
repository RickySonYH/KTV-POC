// [advice from AI] 자막 관련 타입 정의

export interface SubtitleSegment {
  id: number;
  startTime: number; // 초 단위
  endTime: number;
  text: string;
  speaker?: string; // 화자 분리용
}

export interface STTResponse {
  segments: SubtitleSegment[];
  status: 'processing' | 'completed' | 'error';
  message?: string;
}

export interface VideoFile {
  file: File;
  url: string;
  name: string;
  duration?: number;
}
