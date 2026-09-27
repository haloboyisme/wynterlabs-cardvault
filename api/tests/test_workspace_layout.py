import pytest
from pydantic import ValidationError
from app.branding_schemas import BrandDesign, WorkspaceLayout

def test_old_branding_keeps_values_and_gets_layout_defaults():
    design = BrandDesign(surface="light", accent="#abcdef")
    assert design.surface == "light"
    assert design.accent == "#abcdef"
    assert design.workspace.preset == "collector"

def test_panels_are_complete_unique_and_known():
    value = WorkspaceLayout(dashboardOrder=["sets", "sets"])
    assert value.dashboardOrder == ["sets", "history", "recent", "decks", "attention"]
    with pytest.raises(ValidationError):
        WorkspaceLayout(dashboardOrder=["secret"])

@pytest.mark.parametrize("preset", ["collector", "gallery", "compact", "paper", "night-studio", "soft-glass"])
def test_presets_round_trip(preset):
    design = BrandDesign(workspace={"preset": preset})
    assert BrandDesign.model_validate(design.model_dump()).workspace.preset == preset

@pytest.mark.parametrize("data", [{"sidebarWidth": 9999}, {"logoSize": -1}, {"navigation": "script"}, {"view": "bad"}])
def test_bad_layout_values_are_rejected(data):
    with pytest.raises(ValidationError):
        WorkspaceLayout(**data)
