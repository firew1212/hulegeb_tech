# Hulegeb Backend Reference

Backend-only documentation for the NestJS service in `back-end/`.

## 1. Overview

- Framework: NestJS 12 (TypeScript, ESM)
- Runtime: Node.js
- Database: PostgreSQL via Prisma 7 (`@prisma/client`, `@prisma/adapter-pg`)
- Auth: JWT access tokens (15 min) plus server-side `AuthSession`; OTP/email verification challenges
- API style: REST/JSON over HTTP, no global path prefix
- Default port: `3000` (`process.env.PORT ?? 3000`)
- Validation: Global `ValidationPipe` (`transform`, `whitelist`, `forbidNonWhitelisted`)
- Rate limiting: `@nestjs/throttler` global guard (60 req / 60s) plus per-route overrides
- Observability: optional `@nestjs/observe` when env vars set

Entry points: `src/main.ts`, `src/app.module.ts`.

## 2. Architecture

Modules under `src/`:
- `prisma` — `PrismaService`
- `config` — environment validation
- `auth` — registration, login, verification, password reset, profile, logout, JWT issuance, delivery
- `authorization` — roles/constants, `RolesGuard`, `AuthorizationService`
- `sellers` — seller application workflow
- `catalog` — categories, products, variants, images, public catalog, moderation
- `cart` — buyer shopping cart and checkout
- `orders` — order creation, admin/buyer views, status, stock reservations
- `notifications` — in-app notifications

Global guards execute: Throttler -> Authentication -> Roles. Public routes bypass auth/roles via `@Public()`.

## 3. Authentication

- Registration creates a `BUYER` in `PENDING_VERIFICATION`, issues email verification token (24h) and phone OTP (5 min, 6 digits), sends both via delivery service.
- Passwords: bcrypt, min 12, max 128; limited to 72 UTF-8 bytes.
- Login accepts email or phone + password. Requires `ACTIVE` status with verified email/phone. Admin requires phone MFA (`ADMIN_LOGIN_MFA`) before issuing tokens.
- Account-level brute-force protection counts `LOGIN_FAILED`/`ADMIN_MFA_FAILED` audit events per user in a rolling window; returns HTTP 429 before verification. Not atomic (bounded concurrency race).
- Access tokens: JWT signed with `JWT_ACCESS_SECRET`, 15 min, payload `{ sub, sid }`; `sid` references `AuthSession`.
- Refresh tokens: opaque 48-byte base64url tokens, stored only as SHA-256 hashes in `AuthSession.refreshTokenHash`; rotated atomically on `/auth/refresh`; refresh session lifetime 7 days in `AuthSession.expiresAt`.
- Session validation checks session not revoked/expired and user active.
- Logout revokes session. Password reset invalidates sessions.
- Admin provisioning via `pnpm db:seed:admin` / `pnpm db:provision:admin` (dev only).

Delivery modes:
- Email: `console` (dev/test only) or `brevo` (prod).
- SMS: `console` (dev/test only) or `webhook` (prod, authenticated JSON POST with event, recipient, token, expiresInSeconds; email links include verificationUrl).

## 4. Authorization / Roles

Roles: `BUYER`, `SELLER`, `ADMIN`, `DELIVERY_STAFF`.  
`DELIVERY_STAFF` is defined but no endpoint currently requires it (future work).  
Seller endpoints require approved seller profile.

## 5. Database (Prisma)

PostgreSQL. Key models: `User`, `UserRole`, `SellerProfile`, `Category`, `Product`, `ProductVariant`, `ProductImage`, `Cart`, `CartItem`, `Order`, `OrderItem`, `OrderStockReservation`, `Notification`, `AuthChallenge`, `AuthSession`, `AuthAuditEvent`, `SearchTermAnalytics`.  
Enums in schema. Migrations under `prisma/migrations/`.
## 6. API Reference (existing)

Base: `http://localhost:3000`. Protected routes require `Authorization: Bearer <accessToken>`.

### App
- `GET /` (public)

### Auth (`/auth`)
- `POST /auth/register` (public, 3/min)
- `POST /auth/login` (public, 5/min)
- `POST /auth/login/verify-admin-mfa` (public, 5/min)
- `POST /auth/verify-email` (public, 5/min)
- `POST /auth/verify-phone` (public, 5/min)
- `POST /auth/verification/resend` (public, 3/15min)
- `POST /auth/verification/email/resend` (public, 3/15min)
- `POST /auth/password/forgot` (public, 3/15min)
- `POST /auth/password/reset` (public, 5/15min)
- `GET /auth/me` (auth)
- `PATCH /auth/me` (auth)
- `POST /auth/logout` (auth)

### Catalog (`/catalog`)
Public:
- `GET /catalog/categories`
- `GET /catalog/products`
- `GET /catalog/products/:productId`

Admin (`ADMIN`):
- `GET /catalog/admin/categories`
- `POST /catalog/admin/categories`
- `PATCH /catalog/admin/categories/:categoryId`
- `PATCH /catalog/admin/categories/:categoryId/deactivate`
- `GET /catalog/admin/products/pending`
- `POST /catalog/admin/products/:productId/approve`
- `POST /catalog/admin/products/:productId/reject`

Seller (`SELLER`, approved):
- `POST /catalog/seller/products`
- `GET /catalog/seller/products`
- `GET /catalog/seller/products/:productId`
- `PATCH /catalog/seller/products/:productId`
- `DELETE /catalog/seller/products/:productId` (unpublish)
- `POST/PATCH/DELETE .../variants`, `.../images`

### Sellers (`/sellers/applications`)
- `POST /sellers/applications` (BUYER)
- `GET /sellers/applications/pending` (ADMIN)
- `POST /sellers/applications/:id/approve` (ADMIN)
- `POST /sellers/applications/:id/reject` (ADMIN)

### Cart (`/cart`, BUYER)
- `GET /cart`
- `POST /cart/items`
- `PATCH /cart/items/:variantId`
- `DELETE /cart/items/:variantId`
- `POST /cart/checkout` (requires `Idempotency-Key` header)

### Orders (`/orders`)
Admin:
- `GET /orders/admin`
- `GET /orders/admin/:id`
- `POST /orders/admin/:id/confirm-stock`
- `PATCH /orders/admin/:id/status`

Buyer:
- `GET /orders/contact?orderId=...`
- `GET /orders`
- `GET /orders/:id`
- `PATCH /orders/:id/payment`
- `POST /orders` (requires `Idempotency-Key` header)

### Notifications (`/notifications`, auth)
- `GET /notifications`
- `PATCH /notifications/:id/read`

## 7. Business Rules (existing)

- Catalog: categories can be deactivated; products require admin approval before public. Sellers manage own products/variants/images. Public listing filters approved products.
- Cart: buyer-only; checkout creates an order from the current cart and requires an `Idempotency-Key` header; stock is checked but not reserved or decremented at checkout. Matching cart line items are removed after a successful checkout.
- Orders: max 20 lines, max 10 quantity per line; idempotency key required and validated format; stock is checked at order creation but not reserved or decremented; admin `confirm-stock` decrements stock and creates active reservations while the order remains `PENDING`. API status transitions: `PENDING` -> `COMPLETED`/`CANCELLED` (and legacy `CONFIRMED` -> `COMPLETED`/`CANCELLED`); `COMPLETED`/`CANCELLED` are terminal. Completion requires active stock reservations and a selected payment option (`DEPOSIT` or `FULL`); cancellation releases reserved stock. Legacy `CONFIRMED` orders are presented as `PENDING` in API responses.
- Notifications: created on seller application decisions and product moderation and order events.
- Search analytics: `SearchTermAnalytics` tracks terms.

## 8. Tests

- Unit/integration: Vitest (`pnpm test`), specs colocated in `src/**` and `prisma/*.spec.ts`.
- E2E: `pnpm test:e2e` using `vitest.config.e2e.ts` against test DB.
- Coverage: `pnpm test:cov`.
- Test DB guard: `test/auth-test-database.guard.ts` etc.
- No DB-writing operations performed for this doc.

## 9. Security

- Secrets: `JWT_ACCESS_SECRET`, `AUTH_CHALLENGE_SECRET` independent >=32 chars with sufficient variation; production validation.
- Password hashing bcrypt; 72-byte limit.
- Rate limiting global + per-route.
- Input validation via DTO + class-validator; unknown fields forbidden.
- Helmet not explicitly configured (limitation).
- CORS not explicitly configured (limitation).
- SQL injection mitigated by Prisma parameterization.
- Tokens hashed at rest (SHA-256/HMAC) for challenges; sessions server-side.
- Webhook delivery token for SMS.

## 10. Configuration / Environment

See `.env.example`. Key vars: `NODE_ENV`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `AUTH_CHALLENGE_SECRET`, `AUTH_OTP_MAX_ATTEMPTS`, `AUTH_LOGIN_MAX_FAILURES`, `AUTH_LOGIN_FAILURE_WINDOW_MINUTES`, `AUTH_EMAIL_MODE`, `BREVO_API_KEY`, `AUTH_EMAIL_FROM`, `FRONTEND_URL`, `AUTH_SMS_MODE`, `AUTH_SMS_WEBHOOK_URL`, `AUTH_DELIVERY_WEBHOOK_TOKEN`, `HULEGEB_OFFICIAL_PHONE`, `HULEGEB_OFFICIAL_TELEGRAM`, optional `OBSERVE_*`, `PORT`.

## 11. Known Limitations

- `DELIVERY_STAFF` role unused by endpoints.
- Brute-force protection is now serialized through PostgreSQL transactions with Serializable isolation and retry handling for concurrent login/admin MFA failures.
- Refresh tokens are supported via `POST /auth/refresh` with atomic rotation.
- No explicit CORS/Helmet configuration.
- Frontend URL required for email links; backend does not serve frontend.
- Search/pagination details depend on DTOs (not fully enumerated here).
- Legacy `CONFIRMED` orders are presented as `PENDING` by `OrdersService.toOrderResponse`; `CONFIRMED` cannot be set through `PATCH /orders/admin/:id/status` (allowed values: `PENDING`, `COMPLETED`, `CANCELLED`).

## 12. Frontend Developer Notes

- Base URL and port; no global prefix.
- Auth flow: register -> verify email & phone -> login. Store bearer token; handle 401 to re-login.
- Idempotency-Key header required for cart checkout and order creation; generate unique per attempt.
- Error responses are NestJS standard `{ statusCode, message, error }`; validation errors may be arrays.
- UUIDs for all ids.
- Money as decimal strings in responses (Prisma Decimal serialized).
- Pagination DTOs for products/orders/notifications.
- Official buyer contact available only after payment option selected.

## 13. Recommendations / Future Work (not existing)

- Add refresh token flow or longer-lived sessions.
- Add CORS/Helmet and security headers.
- Implement delivery staff endpoints.
- Make brute-force protection atomic (DB transaction/lock).
- Add OpenAPI/Swagger documentation.
- Add frontend (separate project) consuming these APIs.
- Add rate-limit tuning and distributed store for multi-instance.

## Frontend integration
See docs/FRONTEND_INTEGRATION.md for the authoritative frontend handoff.

