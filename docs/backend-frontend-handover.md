# Hulegeb Backend-Frontend Handover

## 1. Executive summary

The Hulegeb backend is a NestJS 12 + PostgreSQL/Prisma 7 REST service implementing approved MVP marketplace flows: auth/verification, seller applications, catalog moderation, cart, checkout/order creation, admin stock confirmation, payment-option selection, manual admin completion/cancellation, notifications, official buyer contact.

Evidence: modules in app.module.ts; controllers exist; pnpm test passed 2026-10-27: 25 files, 334 tests. E2E not run.

Overall: implemented/tested at unit level; limitations: non-atomic brute-force, no refresh tokens, no CORS/Helmet, DELIVERY_STAFF unused, legacy CONFIRMED shown as PENDING. MVP boundary respected.

## 2. Architecture

Stack: NestJS 12 TS ESM, Node, PostgreSQL/Prisma 7, JWT 15min + AuthSession, ValidationPipe, Throttler 60/60s, optional observe.

Guards order: Throttler -> Authentication -> Roles. Public via @Public().

Modules: prisma, config, auth, authorization, sellers, catalog, cart, orders, notifications.

Dependencies: CartService->OrdersService; OrdersService->PrismaService; CatalogService->PrismaService; controllers depend on services.
## 3. Database

Models: User, UserRole, Role, SellerProfile, Category, Product, ProductVariant, ProductImage, Cart, CartItem, Order, OrderItem, OrderStockReservation, Notification, AuthChallenge, AuthSession, AuthAuditEvent, SearchTermAnalytics.

Enums: UserStatus (PENDING_VERIFICATION, ACTIVE, SUSPENDED, DISABLED); RoleCode (BUYER, SELLER, ADMIN, DELIVERY_STAFF); SellerStatus (PENDING_APPROVAL, APPROVED, REJECTED, SUSPENDED); ProductStatus (DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, UNAVAILABLE, REMOVED); OrderStatus (PENDING, CONFIRMED, COMPLETED, CANCELLED); PaymentOption (DEPOSIT, FULL); AuthChallengeType (EMAIL_VERIFICATION, PHONE_VERIFICATION, PASSWORD_RESET, ADMIN_LOGIN_MFA); NotificationType (SELLER_APPLICATION_APPROVED/REJECTED, PRODUCT_APPROVED/REJECTED, ORDER_CANCELLED/COMPLETED).

Ownership: orders by buyerId; seller products by sellerId; cart one per buyer; notifications by userId; auth sessions/challenges by userId.

Stock flow: variants hold stockQuantity. Order creation validates server-side prices but does not reserve stock. Admin confirm-stock decrements stock and creates OrderStockReservation while order remains PENDING. Cancellation releases reservations and restores stock. Completion requires active reservations and selected payment option. Legacy CONFIRMED shown as PENDING; cannot be set via API.
## 4. Implemented API reference

Base URL http://localhost:3000 (or PORT). Protected routes require Authorization: Bearer <accessToken>.

App: GET / (public) -> Hello World.

Auth (/auth): register (3/min), login (5/min), login/verify-admin-mfa (5/min), refresh (10/min), verify-email (5/min), verify-phone (5/min), verification/resend (3/15min), verification/email/resend (3/15min), password/forgot (3/15min), password/reset (5/15min), GET me, PATCH me, POST logout.
RegisterDto: email, phone (ET), password 12-128, firstName, lastName, termsVersion, acceptedTerms=true. LoginDto: identifier, password. VerifyPhoneDto: phone, 6-digit code. VerifyEmailDto: token. ForgotPasswordDto: email. ResetPasswordDto: token, newPassword. UpdateProfileDto: firstName, lastName.
Login response: { accessToken, refreshToken, tokenType: Bearer, expiresIn: 900, user }. Refresh response same shape. Refresh tokens are rotated on use; access tokens remain 15 min.

Sellers (/sellers/applications): POST (BUYER) SellerApplicationDto {sellerType, displayName, legalName?}; GET pending (ADMIN); POST :id/approve (ADMIN); POST :id/reject (ADMIN).

Catalog (/catalog): public GET categories; GET products with page,limit,q,categoryId,subcategoryId,minPrice,maxPrice,condition,sort; GET products/:productId. Admin: GET admin/categories; POST admin/categories CreateCategoryDto; PATCH admin/categories/:categoryId UpdateCategoryDto; PATCH deactivate; GET admin/products/pending; POST approve; POST reject. Seller: POST seller/products CreateProductDto; GET seller/products; GET seller/products/:productId; PATCH update; DELETE unpublish; variants/images endpoints.
Cart (/cart) BUYER only: GET /cart; POST items {variantId, quantity 1-10}; PATCH items/:variantId {quantity}; DELETE items/:variantId; POST checkout requires Idempotency-Key header, returns order.

Orders (/orders): Admin GET admin page/limit; GET admin/:id; POST admin/:id/confirm-stock; PATCH admin/:id/status {status: PENDING|COMPLETED|CANCELLED}. Buyer GET /orders; GET /orders/:id; PATCH /orders/:id/payment {paymentOption: DEPOSIT|FULL}; POST /orders body {items:[{variantId,quantity}]} requires Idempotency-Key; GET /orders/contact?orderId= returns official phone/telegram after payment option selected.

Notifications (/notifications): GET page/limit; PATCH :id/read.
## 5. Business workflows

Registration/verification: register creates BUYER PENDING_VERIFICATION, issues email token (24h) and phone OTP (5 min, 6 digits); buyer verifies both; login requires ACTIVE with verified email/phone.
Login: email or phone + password; admin requires phone MFA; account-level brute-force counts LOGIN_FAILED/ADMIN_MFA_FAILED in rolling window, returns 429, not atomic.
Seller application: buyer applies with sellerType, displayName, legalName; admin lists/approves/rejects; notifications on decisions.
Product approval: approved seller creates product; admin approves/rejects; notifications; public catalog only approved with active category/seller.
Catalog browsing: public search/filter/pagination/sort; search analytics tracked.
Cart: add/update/remove quantity 1-10, max 20 lines; stock/eligibility checks; checkout requires idempotency key and creates order then clears cart.
Checkout/order creation: direct or cart; server-side pricing; idempotency prevents duplicates (409 on different payload); stock not reserved at creation.
Stock confirmation: admin confirm-stock decrements stock and creates reservations; only pending; idempotent if matching active reservations.
Payment option: buyer selects DEPOSIT/FULL; paymentAmount deposit=total/2 rounded half up, full=total; contact available after selection; selection not proof of payment.
Completion: admin marks COMPLETED only if stock reserved and payment option selected; creates notification.
Cancellation: admin cancels pending/confirmed (displayed pending), releases stock; notification.
Notifications: in-app list pagination, mark read; created on seller decisions, moderation, order cancel/complete.

## 6. SRS traceability matrix

SRS-AUTH-01 Implemented (OrdersController BUYER + auth guard). SRS-AUTH-02 Implemented (roles + ownership filters + tests). SRS-ORDER-01 Implemented (server-side variant prices). SRS-ORDER-02 Implemented (buyer filters). SRS-ORDER-03 Implemented (item snapshots + totals/timestamps). SRS-CHECKOUT-01 Implemented (confirm-stock + completion requires reservations). SRS-CHECKOUT-02 Implemented (DEPOSIT/FULL only). SRS-CHECKOUT-03 Implemented (paymentAmount). SRS-CHECKOUT-04 Implemented (total + paymentAmount). SRS-CHECKOUT-05 Implemented (contact after selection). In-scope seller apps/catalog/cart/stock/admin controls Implemented. Out-of-scope payment/delivery/finance Respected (not implemented). Gap: legacy CONFIRMED in schema while API shows PENDING; unverified if legacy rows exist.
## 7. Quality and security review

Validation: global ValidationPipe + DTO validators, unknown fields forbidden. Authorization: RolesGuard + AuthorizationService active/seller approval checks. Auth/session: JWT 15 min + server-side sessions, refresh tokens rotate, logout revokes, password reset invalidates sessions. Rate limiting: global 60/60s + per-route auth limits, single-instance. Concurrency/idempotency: serializable transactions for order creation/stock/status and atomic brute-force counters; idempotency keys for orders/cart checkout; retry on serialization conflicts. Error handling: NestJS standard error shape, validation errors may be arrays. Secrets/config: production validation enforces secrets/URLs/modes, placeholders rejected. CORS/Helmet: not explicitly configured. Logging: not deeply audited, optional observe. Deployment: needs PostgreSQL, env validation, production requires brevo/webhook and HTTPS.

## 8. Test and verification status

Unit/integration: pnpm test passed 2026-10-27: 25 files, 334 tests. Areas: auth service/delivery/guard, orders service/controller/DTO/contact, catalog service/moderation/public DTO/public service/admin controller/DTO/category DTO, config environment, notifications controller/service, sellers applications, cart service, authorization service, app controller, Prisma seeds/admin provisioning/auth test DB. E2E tests exist but not run (requires test DB). Coverage command not run.

## 9. Frontend integration contract

Auth: store accessToken, send Authorization Bearer, handle 401 re-login, complete registration/verification before login. Data formats: UUIDs, money decimal strings, ISO timestamps, pagination page default 1 limit default 20 max 100, errors {statusCode,message,error} with possible arrays. Idempotency: Idempotency-Key required for POST /cart/checkout and POST /orders; pattern 1-255 chars starting letter/digit allowed [A-Za-z0-9._:-]; unique per attempt. Dependencies: configure API base URL; handle CORS (backend no explicit CORS); official contact only after payment selection; no payment gateway; no delivery tracking UI.

Required calls by role:
Buyer: register/verify/login; browse catalog; cart get/add/update/remove/checkout with idempotency; orders list/get/select payment/get contact; notifications list/read; apply seller.
Seller approved: login; catalog create/update/unpublish products and variants/images; notifications.
Admin: login MFA; seller applications list/approve/reject; catalog categories CRUD/deactivate and product moderation; orders list/get/confirm stock/status complete or cancel; notifications.
## 10. Prioritized findings

Critical blockers: 1) No explicit CORS config -> frontend cross-origin blocked (main.ts no CORS). 2) Short-lived access tokens without refresh -> re-login every 15 min. 3) Brute-force protection not atomic -> concurrency race.
Important fixes: 4) Legacy CONFIRMED in schema while API exposes PENDING (migration decision). 5) E2E tests not verified. 6) No OpenAPI/Swagger. 7) Official contact placeholders cause 503 if unset.
Later improvements: 8) Helmet/security headers. 9) Distributed rate-limit store. 10) Delivery staff endpoints if future scope. 11) Refresh token flow.
Questions: 12) Migrate CONFIRMED to PENDING? 13) Frontend served by backend or separate origin? 14) Exact manual payment confirmation process and completion authority. 15) Does seller approval auto-grant SELLER role and what about buyer role?

## 11. Recommended roadmap

Backend follow-up (not implemented): 1 CORS+Helmet; 2 refresh tokens/longer sessions; 3 atomic brute-force; 4 run E2E and fix; 5 OpenAPI/Swagger; 6 decide/migrate CONFIRMED; 7 configure prod env and contacts.
Frontend prerequisites: separate project; API client with bearer handling and 401 re-login; idempotency key generation; money string handling; pagination; role-based routing; no payment/delivery automation UI beyond manual instructions.

Files changed by this task: back-end/docs/backend-frontend-handover.md only.

## Authoritative frontend document
Use docs/FRONTEND_INTEGRATION.md as the current frontend integration reference.

