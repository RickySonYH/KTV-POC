# [advice from AI] pyannote.audio 실시간 화자분리 전용 컨테이너
# RTX 5090 (sm_120) 지원을 위해 NVIDIA 최신 CUDA 이미지 사용
FROM nvidia/cuda:12.9.0-cudnn-runtime-ubuntu22.04

WORKDIR /app

# 시스템 패키지 + Python
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev \
    libsndfile1 ffmpeg curl \
    && ln -s /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

# [advice from AI] PyTorch 2.8+ (RTX 5090 sm_120 지원)
RUN pip install --no-cache-dir torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu129

# Python 패키지
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

EXPOSE 8001

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
