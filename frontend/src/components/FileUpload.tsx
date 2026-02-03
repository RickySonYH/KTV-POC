// [advice from AI] 동영상 파일 업로드 컴포넌트

import { useState, useRef, type DragEvent, type ChangeEvent } from 'react';
import type { VideoFile } from '../types/subtitle';

interface FileUploadProps {
  onFileSelect: (video: VideoFile) => void;
}

const FileUpload = ({ onFileSelect }: FileUploadProps) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const processFile = (file: File) => {
    // [advice from AI] 동영상 파일 형식 검증
    const validTypes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
    if (!validTypes.includes(file.type)) {
      alert('지원하지 않는 파일 형식입니다.\n지원 형식: MP4, WebM, OGG, MOV');
      return;
    }

    const url = URL.createObjectURL(file);
    onFileSelect({
      file,
      url,
      name: file.name
    });
  };

  return (
    <div
      className={`upload-area ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="video/*"
        style={{ display: 'none' }}
      />
      {/* [advice from AI] 아이콘 대신 심플한 SVG 사용 */}
      <div className="upload-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.5">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <polygon points="10,8 16,12 10,16" fill="#888" stroke="none" />
        </svg>
      </div>
      <div className="upload-text">
        동영상 파일을 드래그하거나 클릭하여 업로드하세요
      </div>
      <div className="upload-hint">
        지원 형식: MP4, WebM, OGG, MOV (최대 500MB)
      </div>
    </div>
  );
};

export default FileUpload;
