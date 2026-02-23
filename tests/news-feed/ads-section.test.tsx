import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { VintageAd } from "@/src/types";
import { AdsSection, ClassifiedsSection } from "@/features/news-feed/components/AdsSection";

// ── Factory ──────────────────────────────────────────────────────────

function makeAd(overrides: Partial<VintageAd> = {}): VintageAd {
  return { title: "Test Ad", body: "Short body.", ...overrides };
}

function body(len: number): string {
  return "x".repeat(len);
}

// ── Tier boundary tests ──────────────────────────────────────────────

describe("AdsSection – tier boundary detection via 'Clip & Save'", () => {
  it("body.length=79 → SHORT tier → no 'Clip & Save'", () => {
    render(<AdsSection displayAds={[makeAd({ body: body(79) })]} />);
    expect(screen.queryByText("Clip & Save")).toBeNull();
  });

  it("body.length=80 → MEDIUM tier → 'Clip & Save' present", () => {
    render(<AdsSection displayAds={[makeAd({ body: body(80) })]} />);
    expect(screen.getByText("Clip & Save")).toBeInTheDocument();
  });

  it("body.length=350 → MEDIUM tier → 'Clip & Save' present", () => {
    render(<AdsSection displayAds={[makeAd({ body: body(350) })]} />);
    expect(screen.getByText("Clip & Save")).toBeInTheDocument();
  });

  it("body.length=351 → LONG tier → no 'Clip & Save', but title renders", () => {
    render(<AdsSection displayAds={[makeAd({ title: "Long Ad", body: body(351) })]} />);
    expect(screen.queryByText("Clip & Save")).toBeNull();
    expect(screen.getByText("Long Ad")).toBeInTheDocument();
  });
});

// ── Category-to-variant mapping ──────────────────────────────────────

describe("AdsSection – category-to-variant mapping", () => {
  it("category 'Services' → service-card variant → CategoryBadge renders 'Services'", () => {
    render(<AdsSection displayAds={[makeAd({ category: "Services", body: body(80) })]} />);
    expect(screen.getByText("Services")).toBeInTheDocument();
  });

  it("category 'Other' (unmapped) + 80-char body → falls to MEDIUM → 'Clip & Save'", () => {
    render(<AdsSection displayAds={[makeAd({ category: "Other", body: body(80) })]} />);
    expect(screen.getByText("Clip & Save")).toBeInTheDocument();
  });
});

// ── Anti-monotony: block after 2 consecutive identical variants ───────

describe("AdsSection – anti-monotony variant blocking", () => {
  it("3 Entertainment ads: 3rd blocked from marquee, falls to MEDIUM → one 'Clip & Save'", () => {
    const entertainmentAd = makeAd({ category: "Entertainment", body: body(300) });
    render(
      <AdsSection displayAds={[entertainmentAd, entertainmentAd, entertainmentAd]} />,
    );
    // ad1 = marquee, ad2 = marquee, ad3 = blocked → retail-coupon (MEDIUM tier counter=0)
    expect(screen.getAllByText("Clip & Save")).toHaveLength(1);
  });

  it("4th Entertainment ad recovers (no 2-consecutive marquee in recent 2) → no extra 'Clip & Save'", () => {
    const entertainmentAd = makeAd({ category: "Entertainment", body: body(300) });
    const ads = [entertainmentAd, entertainmentAd, entertainmentAd, entertainmentAd];
    render(<AdsSection displayAds={ads} />);
    // ad3 = retail-coupon, ad4: recent = [retail-coupon, marquee] → not all marquee → marquee ok
    // So only ad3 gets retail-coupon → 1 "Clip & Save"
    expect(screen.getAllByText("Clip & Save")).toHaveLength(1);
  });
});

// ── Pagination (INITIAL_VISIBLE = 4) ─────────────────────────────────

describe("AdsSection – pagination", () => {
  it("4 ads → no 'See All' button", () => {
    const ads = Array.from({ length: 4 }, (_, i) =>
      makeAd({ title: `Ad ${i}`, body: body(10) }),
    );
    render(<AdsSection displayAds={ads} />);
    expect(screen.queryByText(/See All/)).toBeNull();
  });

  it("5 ads → 'See All 5 Ads' button present; 5th ad title NOT in document", () => {
    const ads = Array.from({ length: 5 }, (_, i) =>
      makeAd({ title: `Ad ${i}`, body: body(10) }),
    );
    render(<AdsSection displayAds={ads} />);
    expect(screen.getByText("See All 5 Ads")).toBeInTheDocument();
    expect(screen.queryByText("Ad 4")).toBeNull();
  });

  it("click 'See All 5 Ads' → 5th ad title visible; button gone", () => {
    const ads = Array.from({ length: 5 }, (_, i) =>
      makeAd({ title: `Ad ${i}`, body: body(10) }),
    );
    render(<AdsSection displayAds={ads} />);
    fireEvent.click(screen.getByText("See All 5 Ads"));
    expect(screen.getByText("Ad 4")).toBeInTheDocument();
    expect(screen.queryByText(/See All/)).toBeNull();
  });
});

// ── Badge pluralization ───────────────────────────────────────────────

describe("AdsSection – badge pluralization", () => {
  it("1 ad → '1 Ad'", () => {
    render(<AdsSection displayAds={[makeAd()]} />);
    expect(screen.getByText("1 Ad")).toBeInTheDocument();
  });

  it("2 ads → '2 Ads'", () => {
    render(<AdsSection displayAds={[makeAd(), makeAd({ title: "Ad 2" })]} />);
    expect(screen.getByText("2 Ads")).toBeInTheDocument();
  });
});

// ── Empty state ───────────────────────────────────────────────────────

describe("AdsSection – empty state", () => {
  it("0 ads → 'No advertisements available'; no 'See All' button", () => {
    render(<AdsSection displayAds={[]} />);
    expect(screen.getByText("No advertisements available")).toBeInTheDocument();
    expect(screen.queryByText(/See All/)).toBeNull();
  });
});

// ── ClassifiedsSection ────────────────────────────────────────────────

describe("ClassifiedsSection – empty state", () => {
  it("0 classifieds → 'No classifieds available'", () => {
    render(<ClassifiedsSection classifiedAds={[]} />);
    expect(screen.getByText("No classifieds available")).toBeInTheDocument();
  });
});

describe("ClassifiedsSection – pagination", () => {
  it("4 classifieds → no 'See All' button", () => {
    const ads = Array.from({ length: 4 }, (_, i) =>
      makeAd({ title: `Classified ${i}`, body: body(10) }),
    );
    render(<ClassifiedsSection classifiedAds={ads} />);
    expect(screen.queryByText(/See All/)).toBeNull();
  });

  it("5 classifieds → 'See All 5 Listings' button; 5th NOT in document", () => {
    const ads = Array.from({ length: 5 }, (_, i) =>
      makeAd({ title: `Classified ${i}`, body: body(10) }),
    );
    render(<ClassifiedsSection classifiedAds={ads} />);
    expect(screen.getByText("See All 5 Listings")).toBeInTheDocument();
    expect(screen.queryByText("Classified 4")).toBeNull();
  });

  it("click 'See All 5 Listings' → 5th classified visible; button gone", () => {
    const ads = Array.from({ length: 5 }, (_, i) =>
      makeAd({ title: `Classified ${i}`, body: body(10) }),
    );
    render(<ClassifiedsSection classifiedAds={ads} />);
    fireEvent.click(screen.getByText("See All 5 Listings"));
    expect(screen.getByText("Classified 4")).toBeInTheDocument();
    expect(screen.queryByText(/See All/)).toBeNull();
  });
});

describe("ClassifiedsSection – badge pluralization", () => {
  it("1 classified → '1 Listing'", () => {
    render(<ClassifiedsSection classifiedAds={[makeAd()]} />);
    expect(screen.getByText("1 Listing")).toBeInTheDocument();
  });

  it("2 classifieds → '2 Listings'", () => {
    render(<ClassifiedsSection classifiedAds={[makeAd(), makeAd({ title: "Ad 2" })]} />);
    expect(screen.getByText("2 Listings")).toBeInTheDocument();
  });
});
