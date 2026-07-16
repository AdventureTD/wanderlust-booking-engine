"""
Wanderlust Booking Engine — Tax classes, a la carte items.

Two tax classes drive VAT:
  - "accommodation"  -> 10% VAT  (room nights)
  - "standard"       -> 15% VAT  (adventure services, a la carte extras)

These rates can be overridden at runtime via set_tax_rate() (e.g. for testing
or if an admin changes them in the Wix Settings collection). The Velo JS
backend reads them from Settings; the Python engine uses these defaults with
set_tax_rate() for tests.

RETIRED (2026-06-03): the old Packages catalog (Sampler/Explorer/Wanderluster)
has been REMOVED. The new pricing model uses a single all-in Adventure Package
rate per night (see Packages collection / backend/packages.web.js). The 15% "standard" tax class is still
used for the adventure portion of the 50/50 split AND for a la carte extras.

A la carte extras remain — guests can add them to a booking. Each item carries
its own tax_class so the pricing engine never has to guess.
"""

from dataclasses import dataclass
from typing import Dict


# Tax classes -> default VAT rates (mutable — can be overridden at runtime)
TAX_RATES = {
    "accommodation": 0.10,   # hotel / accommodation tax
    "standard": 0.15,        # adventure services, a la carte extras
}


def get_tax_rate(tax_class: str) -> float:
    """Get the current tax rate for a class. Pick this up at compute time so
    runtime changes via set_tax_rate() are respected."""
    if tax_class not in TAX_RATES:
        raise ValueError(
            f"Unknown tax class '{tax_class}'. Valid: {list(TAX_RATES.keys())}"
        )
    return TAX_RATES[tax_class]


def set_tax_rate(tax_class: str, rate: float) -> None:
    """Override a tax rate at runtime (e.g. for testing or dynamic configs)."""
    if tax_class not in TAX_RATES:
        raise ValueError(
            f"Unknown tax class '{tax_class}'. Valid: {list(TAX_RATES.keys())}"
        )
    TAX_RATES[tax_class] = rate


def get_all_tax_rates() -> Dict[str, float]:
    """Return a copy of all current tax rates."""
    return dict(TAX_RATES)


def reset_tax_rates() -> None:
    """Reset to the factory defaults (use in test tearDown)."""
    TAX_RATES["accommodation"] = 0.10
    TAX_RATES["standard"] = 0.15


@dataclass(frozen=True)
class CatalogItem:
    code: str
    name: str
    price: float             # USD, per the unit described in `priced_per`
    tax_class: str           # must be a key in TAX_RATES (get_tax_rate knows it)
    priced_per: str          # "person" | "booking" | "night" | "unit"
    description: str = ""

    def __post_init__(self):
        if self.tax_class not in TAX_RATES:
            raise ValueError(
                f"Item '{self.code}' has invalid tax_class '{self.tax_class}'. "
                f"Valid: {list(TAX_RATES.keys())}"
            )


# A la carte extras (taxed at standard rate). Prices are PLACEHOLDERS — owner to confirm.
A_LA_CARTE = {
    "whale_watching": CatalogItem(
        code="whale_watching", name="Whale Watching Tour", price=0.0,
        tax_class="standard", priced_per="person",
        description="Specialty tour — sperm whales year-round.",
    ),
    "canyoning": CatalogItem(
        code="canyoning", name="Canyoning Adventure", price=0.0,
        tax_class="standard", priced_per="person",
        description="Rappel waterfalls, leap into river pools, slot canyons.",
    ),
    "private_chef": CatalogItem(
        code="private_chef", name="Private Chef Dinner", price=0.0,
        tax_class="standard", priced_per="booking",
        description="A private sea-to-table dinner experience.",
    ),
    "airport_transfer": CatalogItem(
        code="airport_transfer", name="Airport Transfer", price=0.0,
        tax_class="standard", priced_per="booking",
        description="Round-trip airport transfers.",
    ),
}


def get_a_la_carte(code: str) -> CatalogItem:
    if code not in A_LA_CARTE:
        raise KeyError(
            f"Unknown a la carte item '{code}'. Valid: {list(A_LA_CARTE.keys())}"
        )
    return A_LA_CARTE[code]
