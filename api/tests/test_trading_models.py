from app.models import (
    TradeListing,
    TradeModerationEvent,
    TradeReport,
    TradeStrike,
    TradingAccount,
    WantListing,
)
from app.trading_constants import REPORT_REASONS, TRADING_STATUSES


def test_trading_tables_and_policy_constants_are_explicit():
    assert TRADING_STATUSES == ("active", "suspended")
    assert REPORT_REASONS == ("scam", "spam", "misrepresentation", "harassment", "other")
    assert {
        TradingAccount.__tablename__,
        TradeListing.__tablename__,
        WantListing.__tablename__,
        TradeReport.__tablename__,
        TradeStrike.__tablename__,
        TradeModerationEvent.__tablename__,
    } == {
        "trading_accounts",
        "trade_listings",
        "want_listings",
        "trade_reports",
        "trade_strikes",
        "trade_moderation_events",
    }
    assert any(
        item.name == "uq_trade_listings_collection_item"
        for item in TradeListing.__table__.constraints
    )
    assert any(item.name == "uq_trade_strikes_report" for item in TradeStrike.__table__.constraints)
