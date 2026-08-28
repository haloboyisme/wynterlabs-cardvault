# Browser-local OCR assets

The production web image copies the pinned Tesseract worker, SIMD LSTM core, and
fast English trained data from installed npm packages into this same-origin
`/ocr/` directory. No scanner asset is loaded from a CDN.
