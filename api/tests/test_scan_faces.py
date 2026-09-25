from types import SimpleNamespace

from app.routers.catalog import _scan_name_matches, _scan_reason


def test_scan_matches_each_face_and_ocr_typo():
    for title, combined in [
        ('hospital room', 'surgical suite // hospital room'),
        ('hospitai room', 'surgical suite // hospital room'),
        ('insectile aberration', 'delver of secrets // insectile aberration'),
        ('ice', 'fire // ice'),
    ]:
        assert _scan_name_matches(title, combined)


def test_face_title_preserves_exact_printing_rank():
    row = (SimpleNamespace(collector_number='0012'),
           SimpleNamespace(name_normalized='surgical suite // hospital room'),
           SimpleNamespace(code_normalized='dsk'))
    assert _scan_reason(row, 'hospital room', 'dsk', '12') == 'exact_printing'
    assert _scan_reason(row, 'hospital room', None, None) == 'exact_name'
    assert _scan_reason(row, 'hospitai room', 'dsk', '12') == 'fuzzy_name'


def test_unrelated_rules_text_does_not_match_faces():
    assert not _scan_name_matches('draw a card', 'surgical suite // hospital room')
    assert not _scan_name_matches('i ro a a a', 'fire // ice')
