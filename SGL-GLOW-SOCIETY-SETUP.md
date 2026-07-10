# SGL Glow Society — Rewards Setup Guide

This guide covers the parts of the rewards program that must be configured **manually in the Shopify admin and the Appstle app** (these have no API to automate). The branded rewards info page (`/pages/glow-society`) is already built in the theme.

---

## 1. Install & choose plan — Appstle Loyalty

1. Shopify admin → **Apps** → search **"Appstle Loyalty"** (Appstle℠ Loyalty, Rewards, Referrals) → **Install**.
2. In Appstle, choose the **Starter plan — $10/month**.
   - *Why Starter:* we only need points, rewards, and POS redemption. VIP tiers are handled via Shopify customer segments (Section 5), so we don't pay for built-in tiers.

## 2. Program basics

- **Program name:** `SGL Glow Society`
- **Earning rule:** `1 point for every $1 spent` (Appstle → Earning / "Points on order").
- Make sure earning is enabled for **both online and Shopify POS** orders.

## 3. Reward redemption tiers

In Appstle → **Redemption / Rewards**, create these 4 fixed-amount rewards. Set each with its **minimum order value**:

| Points | Reward | Minimum spend |
|---|---|---|
| 150 | $5 off | $50+ |
| 300 | $10 off | $100+ |
| 600 | $20 off | $200+ |
| 900 | $30 off | $250+ |

Rules to enforce (Appstle settings + discount config):
- **Cap the largest single redemption at 900 points** ($30 off). Customers keep earning past 900, but no reward larger than 900 pts.
- **One reward per transaction.**
- **No stacking** with other rewards, discount codes, automatic discounts, promotions, **sale items**, services, event tickets, gift cards, or **final sale items**.
  - In the reward's discount settings, set **"Cannot combine with other discounts"** and **exclude** the Sale collection + any services/tickets/gift-card products (use a collection or product exclusion).
- Rewards apply to **eligible product purchases only**, tied to the **customer account/email used at checkout**.

## 4. Birthday reward

- **Glow Member:** birthday points via Appstle. Preferred amount: **150 birthday points** (set in Appstle → Birthday reward, if available on Starter).
- **Glow Insider & Glow Circle:** birthday **gift in store** (not points) — handled manually from the current mini/travel-size promo assortment, while supplies last.
- **If Appstle Starter can't split birthday rewards by tier:** set up **one birthday points reward for all members** for launch, and handle upper-tier birthday gifts manually in store.

## 5. Tier workaround — Shopify customer segments (NOT Appstle VIP)

Do **not** enable Appstle's built-in VIP tiers. Instead, Shopify admin → **Customers → Segments → Create segment**:

| Tier | Segment name | Filter |
|---|---|---|
| Glow Member | (all loyalty members) | everyone enrolled — no segment needed |
| Glow Insider | `Glow Insider` | `amount_spent >= 500` |
| Glow Circle | `Glow Circle` | `amount_spent >= 1000` |

**Benefits:**
- **Glow Insider ($500+):** 24-hour early event access · birthday gift.
- **Glow Circle ($1,000+):** 48-hour early event access · priority access to limited-capacity events · birthday gift.

## 6. Event early-access workaround

For each event, the event is a **hidden Shopify product** (see the Shelf Care Club event as the template). Before public launch, keep it **out of navigation, homepage sections, and public collections**.

**Launch order:**
1. Send the **direct event product link to Glow Circle** first.
2. **24 hours later**, send the direct link to **Glow Insider**.
3. **24 hours later**, publish/post to the **general public**.

> Not a fully gated system — customers could share the direct link. Acceptable for launch (low-cost early access without a higher-tier loyalty app).

**Optional tracking:** to measure which tier uses early access, create **separate discount codes or link parameters per tier** (e.g. `?ref=circle` / `?ref=insider`) or duplicate the product per group. (Ask us to set this up per event.)

## 7. Shopify POS

- Add the **Appstle loyalty tile** to the POS smart grid (POS app → **⋯ More → Add tile → Appstle**).
- Confirm staff can **see points** and **redeem rewards** in store.
- **Train staff:** attach the customer's **email/profile before checkout** so points are earned correctly.

## 8. Testing checklist

- [ ] Create a test customer.
- [ ] Run one small **online** test order → confirm points earned online.
- [ ] Run one small **POS** test transaction → confirm points earned in store.
- [ ] Redeem a **$5 reward online**.
- [ ] Redeem a **$5 reward in POS**.
- [ ] Confirm the **minimum-spend** rule works (reward blocked below the minimum).
- [ ] Confirm rewards **can't stack** with other discounts.
- [ ] Confirm **customer spend updates** in Shopify.
- [ ] Confirm **$500+** customers appear in the **Glow Insider** segment.
- [ ] Confirm **$1,000+** customers appear in the **Glow Circle** segment.
- [ ] Create a **test hidden event product** → confirm it's **purchasable by direct link** but **not visible publicly**.

---

## What's already done in the theme
- **Rewards info page** at `/pages/glow-society` (currently **unpublished**). Publish it when the program is live, and link it from the footer/nav.
- The page explains earning, the 4 redemption tiers, and the 3 member tiers.
- The **event-as-hidden-product** early-access pattern is proven (Shelf Care Club).
