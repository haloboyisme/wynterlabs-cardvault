FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build
RUN mkdir -p /app/dist/ocr \
 && cp node_modules/tesseract.js/dist/worker.min.js /app/dist/ocr/worker.min.js \
 && cp node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js /app/dist/ocr/ \
 && cp node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm /app/dist/ocr/ \
 && cp node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz /app/dist/ocr/

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
