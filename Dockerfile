FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
COPY cmd/server/ cmd/server/
RUN go build -o server cmd/server/main.go

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /app/server /usr/local/bin/server
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Pre-install uv for running python commands
RUN pip install --no-cache-dir uv

EXPOSE 8080
CMD ["server"]
