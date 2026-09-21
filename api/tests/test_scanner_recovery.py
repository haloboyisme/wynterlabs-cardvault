from app.scanner_ocr import DetectedLine, hints_from_lines

def test_full_art_title_below_normal_title_band():
    hints = hints_from_lines([DetectedLine('Black Lotus', .99, 650, 10)], image_height=1000, image_width=700, thorough=True)
    assert hints.name == 'Black Lotus'

def test_real_short_names_with_rules_words_are_not_discarded():
    for name in ['Return to Nature', 'Control Magic', 'Land Tax']:
        hints = hints_from_lines([DetectedLine(name, .99, 20)], image_height=1000)
        assert hints.name == name

def test_deep_pass_still_excludes_rules_and_type_lines():
    hints = hints_from_lines([DetectedLine('When you cast this spell draw a card', .99, 600), DetectedLine('Legendary Creature — Human Wizard', .99, 700)], image_height=1000, thorough=True)
    assert hints.name == ''

def test_deep_read_keeps_later_rotated_title_after_early_false_title():
    import sys
    import numpy as np
    from types import SimpleNamespace
    from unittest.mock import patch
    from app.scanner_ocr import RapidCardOcr
    image=np.zeros((200,100,3),dtype=np.uint8)
    fake=SimpleNamespace(IMREAD_COLOR=1,ROTATE_90_CLOCKWISE=0,ROTATE_90_COUNTERCLOCKWISE=1,COLOR_BGR2LAB=2,COLOR_LAB2BGR=3,imdecode=lambda *_:image,rotate=lambda x,d:np.rot90(x,1 if d else -1),cvtColor=lambda x,_:x,split=lambda x:tuple(x[:,:,i] for i in range(3)),createCLAHE=lambda **_:SimpleNamespace(apply=lambda x:x),merge=lambda xs:np.stack(xs,axis=2),GaussianBlur=lambda x,*_:x,addWeighted=lambda x,*_:x)
    calls=[]
    def engine(img):
        calls.append(img.shape)
        title='Unrelated artwork' if len(calls)==1 else 'Black Lotus'
        return SimpleNamespace(txts=[title],scores=[.5 if len(calls)==1 else .99],boxes=[[[5,5],[50,5],[50,20],[5,20]]])
    service=RapidCardOcr();service._engine=engine
    with patch.dict(sys.modules,{'cv2':fake}):
        result=service.recognize(b'test',thorough=True)
    assert len(calls)==8
    assert result.name=='Black Lotus'
    assert result.title_candidates==['Black Lotus','Unrelated artwork']
