# [advice from AI] KTV POC 프론트엔드 Dockerfile

FROM node:18-alpine

WORKDIR /app

# 패키지 파일 복사 및 설치
COPY package*.json ./
RUN npm install

# 소스 코드 복사
COPY . .

# 포트 노출
EXPOSE 6430

# 개발 서버 실행
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
