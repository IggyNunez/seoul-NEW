# Seoul Glow Lab — Shopify Theme Instructions
> **Base Theme:** Horizon (Shopify)
> **Repo:** `https://github.com/IggyNunez/seoul-NEW` → branch `main`
> **Local Path:** `D:\Seoul-NEW\Theme-Shopify\`
> **Sync:** One-way GitHub → Shopify (auto-deploys on every `git push` to `main`)

---

## 1. Project Overview

Seoul Glow Lab is a K-beauty skincare brand. The theme is a **full reimagination** of a previous brand's Horizon theme. We are keeping the Horizon foundation intact but completely stripping out the old brand's custom sections and replacing all design tokens (colors, fonts, schemes) with Seoul Glow Lab's identity.

### Core Philosophy
- **Keep all Horizon native sections** — edit blocks only, never rebuild what works
- **Use Blocks as the primary build tool** — every piece of content lives in a block
- **No unnecessary sections** — clean, minimal file structure
- **Every commit deploys** — treat the repo as the live source of truth

---

## 2. Brand Identity

### 2.1 Logo Suite
| File | Use Case |
|---|---|
| `Primary Logo.png` — "SEOUL GLOW LAB" wordmark in rounded rectangle | Header, email headers, signage |
| `Secondary Logo.png` — Korean (서울) + GLOW LAB in portrait rectangle | Storytelling, editorial, social |
| `Logomark.png` — Mugunghwa (hibiscus) circular stamp | Favicon, icons, packaging, watermarks |

**Logo Rules:**
- Never rotate, flip, stretch or distort
- Never apply on low-contrast backgrounds
- Maintain exclusion zones (clear space equal to the height of the "G" in GLOW on all sides)
- Only use approved brand colours — never recolour logos

### 2.2 Colour Palette

#### Primary Colours
| Name | HEX | Usage |
|---|---|---|
| **Periwinkle** | `#B0C3FA` | Primary backgrounds, hero sections, key UI elements |
| **Blood Red** | `#5E0A02` | Headings on light bg, accents, borders |

#### Accent Colours
| Name | HEX | Usage |
|---|---|---|
| **Mindaro** | `#F2FFA0` | CTA highlights, badges, sale tags |
| **Forest Green** | `#1B4900` | Text on Mindaro, success states |

#### Secondary Colours
| Name | HEX | Usage |
|---|---|---|
| **Antique White** | `#F8EBDA` | Page background, card backgrounds |
| **Orange Crayola** | `#EA7940` | Warm accents, hover states |
| **Peach** | `#FFBF9F` | Soft background sections |

#### Colour Scheme Map (Horizon `settings_data.json`)
| Scheme | Background | Foreground | Primary Button | Use For |
|---|---|---|---|---|
| `scheme-1` | `#FFFFFF` | `#5E0A02` | `#B0C3FA` / text `#5E0A02` | Default / main pages |
| `scheme-2` | `#F8EBDA` | `#5E0A02` | `#5E0A02` / text `#F8EBDA` | Soft warm sections |
| `scheme-3` | `#B0C3FA` | `#5E0A02` | `#5E0A02` / text `#FFFFFF` | Feature/hero callouts |
| `scheme-4` | `#F2FFA0` | `#1B4900` | `#1B4900` / text `#F2FFA0` | Sale/promo sections |
| `scheme-5` | `#5E0A02` | `#F8EBDA` | `#F2FFA0` / text `#1B4900` | Dark/dramatic sections |
| `scheme-6` | `#1B4900` | `#F2FFA0` | `#B0C3FA` / text `#5E0A02` | Footer |

**Forbidden Combinations:**
- Never use old brand colours: `#c6d76b`, `#e08fbc`, `#280f2b`, `#afc3f9` (old periwinkle shade)
- Never place Blood Red text on Forest Green background (insufficient contrast)
- Never use white text on Antique White or Mindaro backgrounds

### 2.3 Typography

| Role | Font | Weight | Horizon Setting |
|---|---|---|---|
| **Title / H1** | Roboto Condensed | ExtraBold (800) | `type_heading_font` |
| **Heading / H2–H4** | Roboto Condensed | Medium (500) | `type_subheading_font` |
| **Body** | Anonymous Pro | Regular (400) | `type_body_font` |

**Typography Scale:**
- H1: `48–56px` desktop / `28–36px` mobile — Roboto Condensed ExtraBold, tight leading
- H2: `32–40px` desktop / `22–28px` mobile — Roboto Condensed Medium
- H3: `24px` desktop / `18px` mobile — Roboto Condensed Medium
- Body: `16px` — Anonymous Pro Regular, loose leading (`1.6`)
- All headings: `UPPERCASE` preferred for major titles, mixed case for subheadings

**Font Loading:** Both Roboto Condensed and Anonymous Pro are available via Google Fonts. Reference in `snippets/fonts.liquid`.

### 2.4 Brand Voice & Tone
- **Casual, Fun, Approachable, Enthusiastic, Friendly**
- NOT: Formal, Serious, Exclusive, Reserved
- Key words: Simple, Easy, Supportive, Confident, Fresh, Fun, Playful, Empowering
- **Slogan:** *"Seoul you need for that glow"*
- **Archetype:** The Caregiver / The Glow Guide
- Write copy as a warm, knowledgeable friend — not a corporate brand

### 2.5 Imagery Style
- Clean, bright, editorial product photography
- Skin-focused close-ups with soft natural light
- Korean aesthetic references — minimal, intentional
- Models of diverse skin tones showing real, glowing skin
- Avoid: heavy filters, clinical/cold lighting, clutter

---

## 3. File Structure & Rules

### 3.1 What We Keep (Horizon Core)
All native Horizon sections are **kept and edited via blocks only**:

```
sections/
  ├── header.liquid              ✅ Keep — edit header blocks
  ├── header-announcements.liquid ✅ Keep — edit announcement blocks
  ├── footer.liquid              ✅ Keep — edit footer blocks
  ├── hero.liquid                ✅ Keep — primary hero
  ├── slideshow.liquid           ✅ Keep — homepage slideshow
  ├── layered-slideshow.liquid   ✅ Keep — layered visual hero
  ├── carousel.liquid            ✅ Keep — product/content carousels
  ├── marquee.liquid             ✅ Keep — scrolling text bar
  ├── media-with-content.liquid  ✅ Keep — split media sections
  ├── featured-product.liquid    ✅ Keep — hero product feature
  ├── featured-product-information.liquid ✅ Keep
  ├── product-list.liquid        ✅ Keep
  ├── product-hotspots.liquid    ✅ Keep
  ├── collection-list.liquid     ✅ Keep
  ├── collection-links.liquid    ✅ Keep
  ├── featured-blog-posts.liquid ✅ Keep
  ├── divider.liquid             ✅ Keep
  ├── custom-liquid.liquid       ✅ Keep
  ├── logo.liquid                ✅ Keep
  ├── section.liquid             ✅ Keep (generic blocks container)
  ├── _blocks.liquid             ✅ Keep (app blocks)
  ├── main-*.liquid              ✅ Keep all (cart, collection, blog, etc.)
  ├── product-information.liquid ✅ Keep
  ├── product-recommendations.liquid ✅ Keep
  ├── password.liquid            ✅ Keep
  ├── search-*.liquid            ✅ Keep all
  └── predictive-search*.liquid  ✅ Keep all
```

### 3.2 What Gets Deleted (Old Brand Sections)
Remove all `dw-` prefixed sections — these are from the previous brand and have no place in this theme:

```
sections/
  ├── dw-404.liquid              ❌ DELETE
  ├── dw-about.liquid            ❌ DELETE
  ├── dw-benefits-flip.liquid    ❌ DELETE
  ├── dw-bottom-cta_1.liquid     ❌ DELETE
  ├── dw-cart_1.liquid           ❌ DELETE
  ├── dw-clinical-proof.liquid   ❌ DELETE
  ├── dw-collection_1.liquid     ❌ DELETE
  ├── dw-comparison-chart.liquid ❌ DELETE
  ├── dw-faq_1.liquid            ❌ DELETE
  ├── dw-faq_4.liquid            ❌ DELETE
  ├── dw-footer.liquid           ❌ DELETE
  ├── dw-hero.liquid             ❌ DELETE
  ├── dw-how-it-works.liquid     ❌ DELETE
  ├── dw-ingredients.liquid      ❌ DELETE
  ├── dw-insider-club.liquid     ❌ DELETE
  ├── dw-insider-club_1.liquid   ❌ DELETE
  ├── dw-password-gate.liquid    ❌ DELETE
  ├── dw-password-page_3.liquid  ❌ DELETE
  ├── dw-preorder-details.liquid ❌ DELETE
  ├── dw-preorder-terms.liquid   ❌ DELETE
  ├── dw-product.liquid          ❌ DELETE
  ├── dw-social-proof.liquid     ❌ DELETE
  ├── dw-supplement-facts.liquid ❌ DELETE
  └── dw-testimonials-scroll.liquid ❌ DELETE
```

### 3.3 Templates — Keep vs Delete

```
templates/
  ├── index.json                 ✅ Keep — rebuild homepage layout
  ├── collection.json            ✅ Keep
  ├── product.json               ✅ Keep
  ├── cart.json                  ✅ Keep
  ├── 404.json                   ✅ Keep
  ├── blog.json                  ✅ Keep
  ├── article.json               ✅ Keep
  ├── search.json                ✅ Keep
  ├── list-collections.json      ✅ Keep
  ├── page.json                  ✅ Keep
  ├── page.contact.json          ✅ Keep
  ├── page.about-us.json         ✅ Keep — rebuild for Seoul Glow Lab
  ├── password.json              ✅ Keep — rebuild for Seoul Glow Lab
  ├── gift_card.liquid           ✅ Keep
  ├── page.insider-club.json     ❌ DELETE (old brand page)
  ├── page.pre-order-terms.json  ❌ DELETE (old brand page)
  ├── page.supplement-facts.json ❌ DELETE (old brand page)
  ├── product.dw-product.json    ❌ DELETE (old brand template)
  ├── product.insider-club-coconut.json ❌ DELETE
  └── product.insider-club-rasp.json    ❌ DELETE
```

### 3.4 Snippets & Assets
- **All snippets:** Keep — they are Horizon core utilities
- **Assets:** Keep all JS/CSS — they are Horizon core
- **`snippets/dw-style-js.liquid`:** ❌ DELETE — old brand only

---

## 4. How We Build — The Block System

### 4.1 Core Principle
> **Every piece of content is a block inside a Horizon section. We never write new sections from scratch.**

The Horizon `section.liquid` (generic blocks container) combined with `_blocks.liquid` (app blocks) gives us unlimited flexibility. Stack blocks inside sections to create any layout.

### 4.2 Available Blocks (Full List)
These are the building blocks for every page:

**Content Blocks:**
- `text.liquid` — body copy, RTE
- `heading.liquid` — H1–H6 with styling options
- `button.liquid` — single CTA
- `buy-buttons.liquid` — add to cart / dynamic checkout
- `image.liquid` — standalone image
- `video.liquid` — embedded video
- `icon.liquid` — SVG icon
- `spacer.liquid` — vertical spacing control
- `divider.liquid` — horizontal rule
- `custom-liquid.liquid` — raw Liquid/HTML escape hatch

**Product Blocks:**
- `product-title.liquid`
- `product-description.liquid`
- `price.liquid`
- `variant-picker.liquid`
- `quantity.liquid`
- `add-to-cart.liquid`
- `product-card.liquid`
- `product-inventory.liquid`
- `product-custom-property.liquid`
- `swatches.liquid`
- `sku.liquid`
- `review.liquid`
- `product-recommendations.liquid`
- `accelerated-checkout.liquid`

**Collection Blocks:**
- `collection-card.liquid`
- `collection-title.liquid`
- `featured-collection.liquid`

**Layout/Structure Blocks:**
- `group.liquid` — flex/grid wrapper for nesting blocks
- `logo.liquid` — brand logo
- `menu.liquid` — navigation menu
- `social-links.liquid` — social icons
- `jumbo-text.liquid` — oversized display text

**Commerce Blocks:**
- `email-signup.liquid`
- `contact-form.liquid`
- `filters.liquid`
- `payment-icons.liquid`
- `follow-on-shop.liquid`
- `popup-link.liquid`
- `comparison-slider.liquid`
- `page-content.liquid`
- `page.liquid`

**Footer Blocks:**
- `footer-copyright.liquid`
- `footer-policy-list.liquid`

### 4.3 Block Nesting with `group.liquid`
The `group` block is a flex/grid container. Use it to:
- Create side-by-side layouts (row direction)
- Stack elements with precise gap control
- Nest groups inside groups for complex layouts
- Control alignment, width, height, background, border, overlay

**Example pattern — 2-column text + image:**
```
Section: media-with-content
  └── Block: group (row, 50/50 split)
        ├── Block: image
        └── Block: group (column)
              ├── Block: heading
              ├── Block: text
              └── Block: button
```

### 4.4 Key Sections & Their Block Patterns

#### Hero Section (`hero.liquid`)
Supports 1–2 media items (image or video) with full overlay content blocks.
- Use `_content.liquid` (internal) for all hero text/CTA blocks
- Media: up to 2 images/videos desktop, separate mobile media
- Common block stack: `heading` → `text` → `button`

#### Slideshow (`slideshow.liquid`)
Each slide is a `_slide.liquid` block containing its own content blocks.

#### Marquee (`marquee.liquid`)
Each item is a `text` or `image` block. Use for scrolling taglines, trust badges, brand values.

#### Media With Content (`media-with-content.liquid`)
Split section — media left or right, content blocks on the other side.
Content block stack: `heading` → `text` → `button` or `buy-buttons`

#### Carousel (`carousel.liquid`)
Each carousel item is a `_carousel-content.liquid` block — supports image + content blocks.

#### Featured Product (`featured-product.liquid`)
Contains `_featured-product.liquid` (static) + `_media-without-appearance.liquid` (static).
Add product detail blocks inside the featured-product block.

#### Section (`section.liquid`) — Generic Container
The most flexible section. Add any block in any order.
Use this for: testimonials, about content, brand story, custom landing areas.

---

## 5. Settings & Config Rules

### 5.1 `config/settings_data.json` — What to Update

**Fonts (update to Seoul Glow Lab):**
```json
"type_body_font": "anonymous_pro_n4",
"type_heading_font": "roboto_condensed_n8",
"type_subheading_font": "roboto_condensed_n5",
"type_accent_font": "roboto_condensed_n8"
```

**Typography Scale:**
```json
"type_size_h1": "48",
"type_case_h1": "uppercase",
"type_letter_spacing_h1": "heading-wide",
"type_size_h2": "32",
"type_case_h2": "uppercase",
"type_size_h3": "24",
"type_size_paragraph": "16",
"type_line_height_paragraph": "body-loose"
```

**Buttons (keep rounded pill style — already correct):**
```json
"button_border_radius_primary": 48,
"button_text_case_primary": "uppercase",
"button_border_radius_secondary": 48
```

**Remove all old brand colour schemes** and replace with the 6 Seoul Glow Lab schemes defined in section 2.2.

**Remove references to old brand:**
- `doingwell-electrolytes` → remove from `empty_state_collection`
- Old logo image paths → replace with Seoul Glow Lab logos
- Old favicon → replace with Seoul Glow Lab logomark

### 5.2 `config/settings_schema.json`
Do not modify the schema structure. Only update default values if needed.

---

## 6. Page Templates & Layouts

### 6.1 Homepage (`templates/index.json`)
Planned section order:
1. `header-announcements` — promo bar ("Seoul you need for that glow")
2. `hero` — hero image/video with main headline
3. `marquee` — scrolling brand values / trust signals
4. `collection-list` — shop by category (bento grid)
5. `featured-product` — hero product spotlight
6. `media-with-content` — brand story / about section
7. `carousel` or `section` — testimonials/reviews
8. `featured-blog-posts` — education/skincare tips
9. `section (_blocks)` — Instagram feed embed
10. `footer`

### 6.2 Product Page (`templates/product.json`)
Block order inside `product-information`:
1. `product-title`
2. `price`
3. `swatches` (if applicable)
4. `variant-picker`
5. `quantity`
6. `buy-buttons`
7. `accelerated-checkout`
8. `product-description`
9. `product-inventory`
10. `product-recommendations`

### 6.3 Collection Page (`templates/collection.json`)
- Keep Horizon `main-collection` section
- Enable `filters` block
- Grid: 4 columns desktop, 2 columns mobile

### 6.4 About Us (`templates/page.about-us.json`)
Build using `section.liquid` with blocks:
- Brand story (heading + text)
- Values (group blocks in a grid)
- Team/founder (media-with-content)
- Mission statement (hero or jumbo-text)

### 6.5 Password Page (`templates/password.json`)
Use Horizon `password.liquid` section.
Content: Seoul Glow Lab logo + tagline + email signup block.
Background: Periwinkle (`#B0C3FA`) with Blood Red text.

---

## 7. Workflow — How Changes Are Made

### 7.1 Git Workflow
```bash
# 1. Make changes to files in D:\Seoul-NEW\Theme-Shopify\
# 2. Stage and commit
git add <specific-files>
git commit -m "description of change"
# 3. Push to main — auto-deploys to Shopify
git push origin main
```

**Always commit specific files, never `git add .` blindly.**
**Commit messages should be clear and descriptive.**

### 7.2 Change Hierarchy
1. **Color/Font/Global changes** → `config/settings_data.json`
2. **Section layout changes** → edit the relevant `templates/*.json`
3. **Block content/style changes** → edit `blocks/*.liquid` files
4. **Section structure changes** → edit `sections/*.liquid` files (only if absolutely necessary)
5. **Global styles** → `assets/base.css`
6. **Custom JS** → create new asset file, reference in `snippets/scripts.liquid`

### 7.3 Never Do These
- ❌ Never edit files directly in Shopify's theme editor if they exist in the repo (causes sync conflicts)
- ❌ Never use `git push --force` on `main`
- ❌ Never commit `.env` files, credentials, or API keys
- ❌ Never rebuild a Horizon section from scratch — edit blocks instead
- ❌ Never add inline styles to `.liquid` files — use CSS variables and color schemes
- ❌ Never hardcode colours in Liquid — reference scheme variables

### 7.4 CSS Variable Convention
Horizon uses CSS custom properties via color schemes. Always use:
```css
var(--color-background)
var(--color-foreground)
var(--color-primary)
var(--color-border)
var(--font-body--family)
var(--font-heading--family)
```
Never hardcode hex values in CSS unless creating a new asset file for a very specific component.

---

## 8. Sections to Build / Priorities

### Phase 1 — Foundation (do first)
- [ ] Update `settings_data.json` — new color schemes + fonts
- [ ] Delete all `dw-` sections
- [ ] Delete old brand templates
- [ ] Delete `snippets/dw-style-js.liquid`
- [ ] Update homepage `index.json` with clean section order
- [ ] Update header blocks (logo, menu, color scheme)
- [ ] Update footer blocks (logo, links, copyright, socials)

### Phase 2 — Homepage
- [ ] Hero section — Seoul Glow Lab hero image + headline + CTA
- [ ] Marquee — brand values scrolling bar
- [ ] Collection list — K-beauty categories bento grid
- [ ] Featured product section
- [ ] Brand story section (media-with-content)
- [ ] Testimonials (section with custom blocks)
- [ ] Instagram feed embed

### Phase 3 — Product & Collection
- [ ] Product page template
- [ ] Collection page template
- [ ] Product card styling (corner radius, badge colours)

### Phase 4 — Supporting Pages
- [ ] About us page
- [ ] Contact page
- [ ] Blog / educational content
- [ ] Password page (if needed)

---

## 9. Reference — Horizon Block Attributes

When editing block settings in JSON templates, key attributes available on most blocks:

**Text/Heading blocks:**
- `type_preset`: `"h1"` through `"h6"` or `"rte"`
- `alignment`: `"left"` / `"center"` / `"right"`
- `case`: `"none"` / `"uppercase"` / `"lowercase"`
- `color`: CSS variable or hex
- `wrap`: `"pretty"` / `"nowrap"`

**Group blocks:**
- `content_direction`: `"row"` / `"column"`
- `horizontal_alignment`: `"flex-start"` / `"center"` / `"flex-end"`
- `vertical_alignment`: `"flex-start"` / `"center"` / `"flex-end"`
- `gap`: integer (px)
- `width`: `"fill"` / `"fit"` / `"custom"`
- `inherit_color_scheme`: `true` / `false`
- `color_scheme`: scheme ID string

**Image blocks:**
- `image_ratio`: `"adapt"` / `"square"` / `"portrait"` / `"landscape"`
- `image_position`: CSS object-position value

**Button blocks:**
- `style`: `"primary"` / `"secondary"` / `"link"`
- `size`: `"small"` / `"medium"` / `"large"`

---

## 10. Brand Assets Location

```
D:\Seoul-NEW\
  ├── Logomark.png                    — Circular stamp logo
  ├── Primary Logo.png                — Wordmark horizontal
  ├── Secondary Logo.png              — Korean + GLOW LAB vertical
  ├── Logomark_Logomark.ai            — Vector source
  ├── Primary Logo_Primary Logo.ai    — Vector source
  ├── Secondary Logo_Secondary Logo.ai — Vector source
  └── Seoul Glow Lab - Brand Identity Pack version 2 (2).pdf — Full brand guidelines
```

**Upload logos to Shopify Files** before referencing them in `settings_data.json`.

---

*Last updated: March 2026 | Seoul Glow Lab Theme v1.0*
