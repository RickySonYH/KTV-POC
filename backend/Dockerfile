# [advice from AI] KTV POC 백엔드 Dockerfile

FROM python:3.11-slim

WORKDIR /app

# 시스템 패키지 설치 (FFmpeg, curl, docker-cli)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# [advice from AI] Docker CLI 설치 (STT 컨테이너 재시작용) - 최신 버전
RUN curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.4.1.tgz | tar xz -C /usr/local/bin --strip-components=1 docker/docker

# Python 의존성 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 애플리케이션 코드 복사
COPY app/ ./app/

# HAIV 클라이언트 디렉토리 생성 (나중에 마운트)
RUN mkdir -p /app/haiv

# 업로드 디렉토리 생성
RUN mkdir -p /tmp/ktv-uploads

# 환경변수
ENV PYTHONUNBUFFERED=1
ENV UPLOAD_DIR=/tmp/ktv-uploads
ENV HAIV_CLIENT_PATH=/app/haiv/HAIV_client.py

# 포트 노출
EXPOSE 6431

# 실행
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "6431", "--reload"]
