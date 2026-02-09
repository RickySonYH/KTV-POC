# WhisperLiveKit 실시간 STT 서버

KTV 파인튜닝 모델이 적용된 WhisperLiveKit 실시간 음성인식 서버입니다.

## 📋 시스템 요구사항

### 필수
- **Docker**: 20.10 이상
- **Docker Compose**: v2.0 이상
- **NVIDIA GPU**: CUDA 지원 GPU (최소 8GB VRAM 권장)
- **NVIDIA Driver**: 515 이상
- **NVIDIA Container Toolkit**: nvidia-docker2

### 디스크 공간
- Docker 이미지: ~15GB
- 모델 파일: ~3GB
- HuggingFace 캐시 (화자분리용): ~2GB

## 🚀 설치 방법

### 방법 A: Harbor 레지스트리에서 Pull (권장)

#### 1. Harbor 로그인
```bash
docker login harbor.timbel.dev
# Username: robot$devops
# Password: YffsYKagPCuEZJ9cDEoXAYoqQksEwYdP

# 이미지 Pull (선택 - docker-compose up 시 자동 Pull됨)
docker pull harbor.timbel.dev/etc/whisper-livekit-nemo:v1
```

#### 2. 디렉토리 준비
```bash
mkdir -p whisper-livekit && cd whisper-livekit
mkdir -p hf_cache models
```

#### 3. 모델 파일 복사
`models/` 디렉토리에 KTV 튜닝 모델 파일들을 복사합니다.

#### 4. docker-compose.yml 생성
```bash
# 또는 패키지의 docker-compose.yml 복사
```

#### 5. 서버 시작
```bash
docker-compose up -d
# 자동으로 Harbor에서 이미지 Pull됨
```

---

### 방법 B: tar 파일에서 로드

#### 1. 압축 해제
```bash
unzip whisper-livekit-package.zip
cd whisper-livekit-package
```

#### 2. Docker 이미지 로드
```bash
docker load -i whisper-livekit-nemo.tar
```

#### 3. docker-compose.yml 수정
```yaml
# image를 로컬 이미지로 변경
image: ktv-poc-whisper-livekit:nemo
```

#### 4. HuggingFace 캐시 디렉토리 생성
```bash
mkdir -p hf_cache
```

#### 5. 서버 시작
```bash
docker-compose up -d
```

### 5. 로그 확인
```bash
docker-compose logs -f whisper-livekit
```

## ✅ 설치 확인

### 헬스체크
```bash
curl http://localhost:6470/
```

### WebSocket 테스트
브라우저에서 `ws://localhost:6470/asr` 접속 가능 여부 확인

## 📁 디렉토리 구조

```
whisper-livekit-package/
├── docker-compose.yml      # Docker Compose 설정
├── README.md               # 이 파일
├── whisper-livekit-nemo.tar  # Docker 이미지 (docker load로 로드)
├── models/                 # KTV 파인튜닝 CTranslate2 모델
│   ├── config.json
│   ├── generation_config.json
│   ├── model.bin           # 메인 모델 파일 (~3GB)
│   ├── preprocessor_config.json
│   ├── tokenizer.json
│   └── vocabulary.json
└── WhisperLiveKit/         # (선택) 소스 코드 (수정 필요시)
```

## 🔧 설정 옵션

### docker-compose.yml 주요 설정

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--model` | 모델 경로 | `/app/models` |
| `--language` | 인식 언어 | `ko` |
| `--diarization` | 화자분리 활성화 | 활성화 |
| `--pcm-input` | PCM 직접 수신 | 활성화 |

### 포트 변경
```yaml
ports:
  - "원하는포트:8000"
```

### GPU 지정 (멀티 GPU 환경)
```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          device_ids: ['0']  # 특정 GPU 지정
          capabilities: [gpu]
```

## 🔗 연동 방법

### WebSocket 연결
```javascript
const ws = new WebSocket('ws://서버IP:6470/asr');

// PCM 오디오 전송 (16kHz, 16bit, mono)
ws.send(pcmAudioData);

// 결과 수신
ws.onmessage = (event) => {
  const result = JSON.parse(event.data);
  console.log(result.text);        // 인식 텍스트
  console.log(result.speaker);     // 화자 ID
};
```

### 오디오 포맷
- **샘플레이트**: 16000 Hz
- **비트**: 16bit
- **채널**: Mono
- **포맷**: Raw PCM (Little Endian)

## ❗ 트러블슈팅

### GPU를 찾지 못할 때
```bash
# NVIDIA 드라이버 확인
nvidia-smi

# NVIDIA Container Toolkit 설치
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker
```

### 메모리 부족
- VRAM 8GB 이상 필요
- 다른 GPU 작업 종료 후 재시작

### 모델 로드 실패
- `models/` 디렉토리 내 파일 확인
- model.bin 파일 크기 확인 (~3GB)

## 📞 지원

문의: [담당자 이메일]

---
버전: 1.0.0
모델: wl3_1000H_0204_ktv_ckpt1538 (CTranslate2)
WhisperLiveKit: NeMo Diarization 지원 버전
