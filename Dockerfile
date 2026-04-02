FROM python:3.12-slim

WORKDIR /app

COPY public ./public
COPY src ./src
COPY data ./data

ENV PORT=3000
EXPOSE 3000

CMD ["python", "src/server.py"]
