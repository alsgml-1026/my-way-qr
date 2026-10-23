# 내 방식 QR — 배포용 (Render·Railway 등 어디든)
# 1) 화면(React)을 빌드하고  2) FastAPI 서버가 화면과 API 를 주소 하나로 함께 내보낸다.
# 필요한 환경변수: OPENAI_API_KEY (호스팅 서비스 설정 화면에서 입력, 파일에 쓰지 않음)

FROM node:20-alpine AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY --from=web /src/frontend/dist frontend/dist

# 공개 주소에서는 캐시 무시(fresh) 요청을 막는다
ENV ALLOW_FRESH=0
WORKDIR /app/backend
# 서버는 반드시 1대 (창구·주문번호를 메모리에 보관하므로)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8010} --workers 1"]
