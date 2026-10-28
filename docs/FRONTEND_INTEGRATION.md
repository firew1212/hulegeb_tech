# Hulegeb Frontend Integration Guide

Authoritative frontend integration document for the Hulegeb backend. Backend location: `back-end/`. Product requirements remain in `SRS.md` (Version 1.2, Approved MVP Baseline); this document describes the current verified implementation, not intended future behavior.

See also:

- `README.md` — setup and operational details.
- `docs/BACKEND_REFERENCE.md` — backend engineering reference.
- `docs/backend-frontend-handover.md` — consolidated legacy handover (prefer this file for frontend work).

## A. System overview

### Architecture

NestJS 12 TypeScript ESM application. Global guards execute in this order:

1. `ThrottlerGuard` (rate limiting)
2. `AuthenticationGuard` (JWT/session validation; `@Public()` bypasses)
3. `RolesGuard` (role checks; `@Public()` bypasses)

Controllers are grouped by domain module: `auth`, `sellers`, `catalog`, `cart`, `orders`, `notifications`, plus `app`.

### Stack

Node.js, PostgreSQL, Prisma 7 (`@prisma/client`, `@prisma/adapter-pg`), JWT access tokens, bcrypt password hashing, class-validator/class-transformer, helmet, `@nestjs/throttler`, optional `@nestjs/observe`.

### Startup

From `back-end/`:

```powershell
pnpm install
Copy-Item .env.example .env
# edit .env secrets
pnpm exec prisma validate
pnpm run build
pnpm run start:dev
```

Default API base URL: `http://localhost:3000` (or `PORT`). There is no global route prefix. CORS origins come from `CORS_ALLOWED_ORIGINS`/`CORS_ORIGINS`/`ALLOWED_ORIGINS`, falling back to `FRONTEND_URL`.

### Database/environment

Use `.env` (never commit). Required names are listed in section H. Do not connect frontend directly to PostgreSQL.

## B. Module and source map

- `src/main.ts` — bootstrap, helmet, CORS, global ValidationPipe.
- `src/app.module.ts` — module registration and global guards.
- `src/prisma` — `PrismaService`.
- `src/config` — environment validation and CORS helpers.
- `src/auth` — registration, login, verification, password reset, profile, logout, JWT issuance, refresh, delivery.
- `src/authorization` — roles, guards, current-user decorator.
- `src/sellers` — seller application workflow.
- `src/catalog` — categories, products, variants, images, public catalog, moderation.
- `src/cart` — buyer cart and checkout.
- `src/orders` — order creation, admin/buyer views, stock, payment option.
- `src/notifications` — in-app notifications.
- `prisma/` — schema, migrations, seed utilities.
- `generated/prisma/` — generated Prisma client (gitignored).
- `test/` — E2E specs and DB guard.
- `src/**/*.spec.ts`, `prisma/*.spec.ts` — unit/integration tests.

## C. API endpoint reference

All routes are relative to base URL `http://localhost:3000`. Protected routes require `Authorization: Bearer <accessToken>`. Validation errors use NestJS standard shape `{ statusCode, message, error }`, where `message` may be an array.

### App

- `GET /` (public) — health/hello. Response: `"Hello World!"`.

### Auth (`/auth`)

- `POST /auth/register` (public, 3/min) — register buyer. Body: `RegisterDto` (`email`, `phone` ET, `password` 12-128, `firstName`, `lastName`, `termsVersion`, `acceptedTerms=true`). Response: verification challenge result.
- `POST /auth/login` (public, 5/min) — login with `LoginDto` (`identifier`, `password`). Response: `{ accessToken, refreshToken, tokenType: "Bearer", expiresIn: 900, user }`.
- `POST /auth/refresh` (public, 10/min) — body `RefreshTokenDto` (`refreshToken`). Rotates refresh token; response same shape as login.
- `POST /auth/login/verify-admin-mfa` (public, 5/min) — body `VerifyPhoneDto` (`phone`, 6-digit `code`).
- `POST /auth/verify-email` (public, 5/min) — body `VerifyEmailDto` (`token`).
- `POST /auth/verify-phone` (public, 5/min) — body `VerifyPhoneDto`.
- `POST /auth/verification/resend` (public, 3/15min) — body `ResendPhoneVerificationDto` (`phone`).
- `POST /auth/verification/email/resend` (public, 3/15min) — body `ForgotPasswordDto` (`email`).
- `POST /auth/password/forgot` (public, 3/15min) — body `ForgotPasswordDto`.
- `POST /auth/password/reset` (public, 5/15min) — body `ResetPasswordDto` (`token`, `newPassword`).
- `GET /auth/me` (auth) — profile.
- `PATCH /auth/me` (auth) — body `UpdateProfileDto` (`firstName`, `lastName`).
- `POST /auth/logout` (auth) — revokes current session.

### Sellers (`/sellers/applications`)

- `POST /sellers/applications` (BUYER) — body `SellerApplicationDto` (`sellerType`: INDIVIDUAL/BUSINESS, `displayName`, optional `legalName`).
- `GET /sellers/applications/pending` (ADMIN).
- `POST /sellers/applications/:id/approve` (ADMIN).
- `POST /sellers/applications/:id/reject` (ADMIN).

### Catalog (`/catalog`)

Public:

- `GET /catalog/categories`
- `GET /catalog/products` — query `PublicProductPaginationDto` (`page`, `limit`, `q`, `categoryId`, `subcategoryId`, `minPrice`, `maxPrice`, `condition`, `sort`).
- `GET /catalog/products/:productId`

Admin:

- `GET /catalog/admin/categories`
- `POST /catalog/admin/categories` — `CreateCategoryDto`
- `PATCH /catalog/admin/categories/:categoryId` — `UpdateCategoryDto`
- `PATCH /catalog/admin/categories/:categoryId/deactivate`
- `GET /catalog/admin/products/pending`
- `POST /catalog/admin/products/:productId/approve`
- `POST /catalog/admin/products/:productId/reject`

Seller:

- `POST /catalog/seller/products` — `CreateProductDto`
- `GET /catalog/seller/products`
- `GET /catalog/seller/products/:productId`
- `PATCH /catalog/seller/products/:productId` — `UpdateProductDto`
- `DELETE /catalog/seller/products/:productId` (unpublish)
- variants/images endpoints under `/catalog/seller/products/:productId/...`

### Cart (`/cart`, BUYER)

- `GET /cart`
- `POST /cart/items` — body `AddCartItemDto` (`variantId`, `quantity`)
- `PATCH /cart/items/:variantId` — body `UpdateCartItemDto` (`quantity`)
- `DELETE /cart/items/:variantId`
- `POST /cart/checkout` — requires `Idempotency-Key` header.

### Orders (`/orders`)

Admin:

- `GET /orders/admin` — `OrdersPaginationDto`
- `GET /orders/admin/:id`
- `POST /orders/admin/:id/confirm-stock`
- `PATCH /orders/admin/:id/status` — body `UpdateOrderStatusDto` (`status`: PENDING/COMPLETED/CANCELLED)

Buyer:

- `GET /orders/contact?orderId=<uuid>` — returns official buyer contact only after payment option selected.
- `GET /orders` — `OrdersPaginationDto`
- `GET /orders/:id`
- `PATCH /orders/:id/payment` — body `SelectPaymentOptionDto` (`paymentOption`: DEPOSIT/FULL)
- `POST /orders` — body `CreateOrderDto`, requires `Idempotency-Key` header.

### Notifications (`/notifications`, auth)

- `GET /notifications` — `NotificationsPaginationDto`
- `PATCH /notifications/:id/read`

## D. Authentication and authorization

- Registration creates BUYER in `PENDING_VERIFICATION`, issues email verification token (24h) and phone OTP (5 min, 6 digits).
- Login accepts email or phone + password; requires ACTIVE status with verified email/phone.
- Admin login requires phone MFA before tokens issued.
- Access token: JWT, 15 min, payload `{ sub, sid }`; `sid` references AuthSession.
- Refresh token: opaque 48-byte base64url, stored only as SHA-256 hash in `AuthSession.refreshTokenHash`; rotated atomically on `/auth/refresh`; session lifetime 7 days.
- Logout revokes session. Password reset invalidates sessions.
- Roles: BUYER, SELLER, ADMIN, DELIVERY_STAFF (defined but no endpoint currently requires DELIVERY_STAFF).
- CORS: configured from env; credentials disabled (`credentials: false`).

Frontend should attach `Authorization: Bearer <accessToken>`, handle 401 by attempting refresh once then re-login, and 403 by role/navigation handling.

## E. Marketplace workflows

- Seller onboarding: buyer applies; admin approves/rejects; approval grants seller capability.
- Catalog: categories managed by admin; products created by approved sellers in DRAFT/PENDING_APPROVAL; admin approves/rejects; public sees APPROVED.
- Variants hold stock; images metadata only (URLs).
- Cart: one per buyer; item uniqueness by variant; checkout creates order from server-priced cart and clears checked-out items.
- Orders: server-side pricing; multi-seller order contains items from multiple sellers; price snapshots stored in OrderItem.
- Payment options: DEPOSIT or FULL. Deposit rounding: VERIFIED — backend calculates half of the order total using `ROUND_HALF_UP` to two decimal places and exposes the resulting amount as `paymentAmount` in the order response.
- Stock: order creation does not reserve stock; admin confirm-stock decrements and creates reservations while order remains PENDING.
- Status transitions: PENDING -> COMPLETED/CANCELLED (legacy CONFIRMED displayed as PENDING; cannot be set via API).
- Cancellation restores reserved stock.
- Completion requires active reservations and selected payment option.
- Official buyer contact available only after payment option selected.
- Notifications on seller decisions, product moderation, order events.

Server is authoritative for prices, stock, totals, order status, and contact eligibility. Frontend must not calculate or assume these.

## F. Data contract and domain model

Key Prisma models: User, UserRole, Role, SellerProfile, Category, Product, ProductVariant, ProductImage, Cart, CartItem, Order, OrderItem, OrderStockReservation, Notification, AuthChallenge, AuthSession, AuthAuditEvent, SearchTermAnalytics.

IDs are UUIDs; money fields are Decimal serialized as strings; timestamps ISO. Important enums listed in schema and existing docs.

## G. Error handling and frontend integration patterns

Global ValidationPipe with transform/whitelist/forbidNonWhitelisted. Unknown fields rejected. Error responses NestJS standard. Rate limit 60/60s global plus per-route auth limits.

TypeScript API client example:

```ts
const api = axios.create({ baseURL: 'http://localhost:3000' });
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('accessToken');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});
```

Handle validation errors by reading `error.response.data.message` (string or array). Avoid automatic retries for POST/checkout/order creation except idempotent retry with same Idempotency-Key.

## H. Environment and deployment contract

Required env names (no values): NODE_ENV, DATABASE_URL, JWT_ACCESS_SECRET, AUTH_CHALLENGE_SECRET, AUTH_OTP_MAX_ATTEMPTS, AUTH_LOGIN_MAX_FAILURES, AUTH_LOGIN_FAILURE_WINDOW_MINUTES, AUTH_EMAIL_MODE, BREVO_API_KEY (prod), AUTH_EMAIL_FROM (prod), FRONTEND_URL, AUTH_SMS_MODE, AUTH_SMS_WEBHOOK_URL (prod), AUTH_DELIVERY_WEBHOOK_TOKEN (prod), HULEGEB_OFFICIAL_PHONE, HULEGEB_OFFICIAL_TELEGRAM, optional OBSERVE_APP_KEY/OBSERVE_APP_SECRET/OBSERVE_SERVICE_ID, PORT, CORS_ALLOWED_ORIGINS/CORS_ORIGINS/ALLOWED_ORIGINS, POSTGRES_* (compose).

## I. Frontend implementation checklist

- Auth flows and verification states.
- Role-based navigation (buyer/seller/admin).
- Seller/catalog workflows.
- Product variations and stock display.
- Cart and checkout with idempotency key.
- Payment choice and instructions.
- Order history/status handling.
- Notifications and error states.
- Amharic/English localization.
- Loading/empty/offline/unauthorized states.

## J. API coverage and limitations

Implemented and tested: auth, catalog, sellers, cart, orders, notifications (unit + E2E where present). NOT VERIFIED: exact deposit rounding formula, some DTO field-level rules beyond controller visibility, production delivery integrations (brevo/webhook) are config-dependent. Known limitations: refresh tokens returned in JSON (not cookies), CORS/Helmet partially configured, DELIVERY_STAFF unused, brute-force protection not fully atomic, legacy CONFIRMED displayed as PENDING.
