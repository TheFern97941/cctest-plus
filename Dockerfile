FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.23-alpine AS backend
WORKDIR /app/backend
RUN apk add --no-cache ca-certificates
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS="${TARGETOS:-linux}" GOARCH="${TARGETARCH:-$(go env GOARCH)}" go build -o /app/cctest-plus ./cmd/server

FROM alpine:3.20
WORKDIR /app
RUN apk add --no-cache ca-certificates
COPY --from=backend /app/cctest-plus /app/cctest-plus
COPY --from=frontend /app/frontend/dist /app/frontend/dist
ENV APP_PORT=8080
ENV FRONTEND_DIST=/app/frontend/dist
ENV DATABASE_PATH=/app/data/cctest-plus.sqlite
ENV CCTEST_BASE_URL=https://cctest.ai
ENV POLL_INTERVAL_SECONDS=3
ENV TASK_TIMEOUT_MINUTES=30
EXPOSE 8080
CMD ["/app/cctest-plus"]
