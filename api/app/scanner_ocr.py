import re
import threading
from dataclasses import dataclass

from pydantic import BaseModel, Field


@dataclass(frozen=True)
class DetectedLine:
    text: str
    score: float
    y: float
    x: float = 0.0


class ScannerOcrHints(BaseModel):
    name: str = Field(max_length=200)
    title_candidates: list[str] = Field(max_length=8)
    set: str | None = Field(default=None, max_length=16)
    collector: str | None = Field(default=None, max_length=64)
    raw_text: str = Field(max_length=2000)


_RULES_TEXT = re.compile(
    r"\b(?:whenever|when|target|draw|discard|counter|control|attacks?|blocks?|"
    r"cast|damage|destroy|exile|gets?|put|return|sacrifice|until)\b",
    re.IGNORECASE,
)
_CARD_TYPE = re.compile(
    r"\b(?:artifact|battle|creature|enchantment|instant|land|planeswalker|sorcery)\b",
    re.IGNORECASE,
)
_TRAILING_NOISE = re.compile(r"^(?P<title>.+\b)\s+(?P<noise>[A-Za-z]{2,4})$")
_DETAIL_TOKEN = re.compile(r"[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*")
_COLLECTOR_TOKEN = re.compile(r"^(?=.*\d)[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*$")
_PLAIN_COLLECTOR_TOKEN = re.compile(r"^\d+(?:/\d+)?$")
_COPYRIGHT_YEAR_TOKEN = re.compile(r"(?:19|20)\d{2}", re.IGNORECASE)
_SET_TOKEN = re.compile(r"^(?=.*[A-Za-z])[A-Za-z0-9]{2,8}$")
_COPYRIGHT_FOOTER = re.compile(
    r"(?:©|\bTM\b|\bcopyright\b|\b(?:19|20)\d{2}\b.*\b(?:BSW|Wizards|Coast)\b)",
    re.IGNORECASE,
)
_LANGUAGE_CODES = {
    "EN",
    "ES",
    "FR",
    "DE",
    "IT",
    "PT",
    "JA",
    "KO",
    "RU",
    "ZHS",
    "ZHT",
}


def _clean_line(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" |[]{}<>_=~*")


def _plausible_title(value: str) -> bool:
    letters = sum(character.isalpha() for character in value)
    words = value.split()
    if letters < 3 or len(value) < 3 or len(value) > 200 or len(words) > 14:
        return False
    if _RULES_TEXT.search(value) or _CARD_TYPE.search(value):
        return False
    return re.search(r"[+=]|\d+\s*/\s*\d+", value) is None


def _title_variants(value: str) -> list[str]:
    match = _TRAILING_NOISE.match(value)
    if match and len(match.group("title").split()) >= 4:
        return [match.group("title").strip(), value]
    return [value]


def _printing_hints(
    lines: list[DetectedLine],
    *,
    image_height: int,
    image_width: int | None,
) -> tuple[str | None, str | None]:
    lower_limit = image_height * 0.62
    detail_lines = sorted(
        (
            line
            for line in lines
            if line.score >= 0.4
            and line.y >= lower_limit
            and (not image_width or line.x <= image_width * 0.72)
            and not _COPYRIGHT_FOOTER.search(line.text)
        ),
        key=lambda item: (item.y, item.x),
    )
    for plain_only in (True, False):
        for line_index in range(len(detail_lines) - 1, -1, -1):
            line = detail_lines[line_index]
            tokens = _DETAIL_TOKEN.findall(line.text)
            fallback_collector: str | None = None
            for index, token in enumerate(tokens):
                if not _COLLECTOR_TOKEN.fullmatch(token):
                    continue
                if bool(_PLAIN_COLLECTOR_TOKEN.fullmatch(token)) != plain_only:
                    continue
                if _COPYRIGHT_YEAR_TOKEN.search(token):
                    continue
                fallback_collector = fallback_collector or token
                set_code = next(
                    (
                        candidate
                        for candidate in tokens[index + 1 :]
                        if _SET_TOKEN.fullmatch(candidate)
                        and candidate.upper() not in _LANGUAGE_CODES
                    ),
                    None,
                )
                if set_code is None:
                    set_code = next(
                        (
                            candidate
                            for candidate in reversed(tokens[:index])
                            if _SET_TOKEN.fullmatch(candidate)
                            and candidate.upper() not in _LANGUAGE_CODES
                        ),
                        None,
                    )
                if set_code is None:
                    nearby_lines = sorted(
                        (
                            candidate
                            for candidate_index, candidate in enumerate(detail_lines)
                            if candidate_index != line_index
                            and abs(candidate.y - line.y) <= image_height * 0.08
                        ),
                        key=lambda candidate: abs(candidate.y - line.y),
                    )
                    set_code = next(
                        (
                            candidate_token
                            for candidate_line in nearby_lines
                            for candidate_token in _DETAIL_TOKEN.findall(candidate_line.text)
                            if _SET_TOKEN.fullmatch(candidate_token)
                            and candidate_token.upper() not in _LANGUAGE_CODES
                            and not _COPYRIGHT_YEAR_TOKEN.search(candidate_token)
                        ),
                        None,
                    )
                if set_code:
                    return set_code.casefold(), token
            if fallback_collector:
                return None, fallback_collector
    return None, None


def hints_from_lines(
    lines: list[DetectedLine],
    *,
    image_height: int,
    image_width: int | None = None,
) -> ScannerOcrHints:
    candidates: list[str] = []
    seen: set[str] = set()
    top_limit = image_height * 0.4
    for line in sorted(lines, key=lambda item: (item.y, -item.score)):
        cleaned = _clean_line(line.text)
        if line.score < 0.45 or line.y > top_limit or not _plausible_title(cleaned):
            continue
        for candidate in _title_variants(cleaned):
            key = candidate.casefold()
            if key not in seen:
                seen.add(key)
                candidates.append(candidate)
    candidates = candidates[:8]
    set_code, collector = _printing_hints(
        lines,
        image_height=image_height,
        image_width=image_width,
    )
    raw_text = "\n".join(_clean_line(line.text) for line in lines if line.text.strip())[:2000]
    return ScannerOcrHints(
        name=candidates[0] if candidates else "",
        title_candidates=candidates,
        set=set_code,
        collector=collector,
        raw_text=raw_text,
    )


class ScannerOcrError(Exception):
    pass


class RapidCardOcr:
    def __init__(self) -> None:
        self._engine = None
        self._lock = threading.Lock()

    def _load_engine(self):
        if self._engine is None:
            from rapidocr import RapidOCR

            self._engine = RapidOCR(
                params={
                    "EngineConfig.onnxruntime.intra_op_num_threads": 2,
                    "EngineConfig.onnxruntime.inter_op_num_threads": 1,
                    "Global.log_level": "critical",
                }
            )
        return self._engine

    def recognize(self, payload: bytes | bytearray) -> ScannerOcrHints:
        import cv2
        import numpy as np

        image = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ScannerOcrError("The uploaded image could not be decoded.")
        height, width = image.shape[:2]
        if width * height > 20_000_000:
            raise ScannerOcrError("The uploaded image dimensions are too large.")
        candidates = [
            image,
            cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE),
            cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE),
        ]
        best: ScannerOcrHints | None = None
        with self._lock:
            engine = self._load_engine()
            for candidate in candidates:
                candidate_height, candidate_width = candidate.shape[:2]
                result = engine(candidate)
                texts = result.txts if result.txts is not None else []
                scores = result.scores if result.scores is not None else []
                boxes = result.boxes if result.boxes is not None else []
                lines = [
                    DetectedLine(
                        text=str(text),
                        score=float(score),
                        y=min(float(point[1]) for point in box),
                        x=min(float(point[0]) for point in box),
                    )
                    for text, score, box in zip(texts, scores, boxes, strict=False)
                ]
                hints = hints_from_lines(
                    lines,
                    image_height=candidate_height,
                    image_width=candidate_width,
                )
                if best is None or len(hints.title_candidates) > len(best.title_candidates):
                    best = hints
                # Upright cards remain a single pass. Sideways retries happen
                # only when the current orientation has no usable title.
                if hints.name:
                    return hints
        return best or hints_from_lines([], image_height=height, image_width=width)


scanner_ocr = RapidCardOcr()
