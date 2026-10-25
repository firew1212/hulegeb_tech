<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

NestJS backend for the Hulegeb marketplace.

## Authentication

Copy `.env.example` to `.env` and set `JWT_ACCESS_SECRET` and
`AUTH_CHALLENGE_SECRET` to independent random values of at least 32 characters.
`AUTH_OTP_MAX_ATTEMPTS` defaults to five (valid range: 1–5). Passwords are
limited to 72 UTF-8 bytes to prevent bcrypt from silently truncating them.
Set `AUTH_EMAIL_MODE=brevo` with `BREVO_API_KEY`, `AUTH_EMAIL_FROM`, and
`FRONTEND_URL` for email delivery. Set `AUTH_SMS_MODE=webhook` with
`AUTH_SMS_WEBHOOK_URL` and `AUTH_DELIVERY_WEBHOOK_TOKEN` for SMS delivery.
The webhook receives authenticated JSON POST requests with `event`,
`recipient`, `token`, and `expiresInSeconds`; email links also include
`verificationUrl`. The receiving service must deliver the link/code and must
not log tokens. Console delivery is permitted only when `NODE_ENV` is explicitly
`development` or `test`; it prints verification tokens and is not for deployment.

The PostgreSQL e2e suite refuses to start unless `AUTH_TEST_DATABASE_URL`
explicitly targets the dedicated `hulegeb_auth_test` database on the local
Docker Compose PostgreSQL endpoint `127.0.0.1:5433`. It then replaces
`DATABASE_URL` for that test process. URLs using other hosts, ports, or database
names are rejected before tests run. Do not point this variable at development
or production databases.

Authentication endpoints:

| Method    | Path                              | Purpose                                                                         |
| :-------- | :-------------------------------- | :------------------------------------------------------------------------------ |
| POST      | `/auth/register`                  | Create a pending buyer account and send email/SMS verification                  |
| POST      | `/auth/login`                     | Authenticate by email or phone; administrator accounts receive an MFA challenge |
| POST      | `/auth/login/verify-admin-mfa`    | Verify the administrator SMS code and issue a 15-minute token                   |
| POST      | `/auth/verify-email`              | Consume a time-limited email verification token                                 |
| POST      | `/auth/verify-phone`              | Verify phone using a five-minute, five-attempt OTP                              |
| POST      | `/auth/verification/resend`       | Request a replacement phone OTP                                                 |
| POST      | `/auth/verification/email/resend` | Request a replacement email link                                                |
| POST      | `/auth/password/forgot`           | Request password recovery without account enumeration                           |
| POST      | `/auth/password/reset`            | Consume a reset link and revoke existing sessions                               |
| GET/PATCH | `/auth/me`                        | Read or update the authenticated user's name                                    |
| POST      | `/auth/logout`                    | Revoke the current authenticated session                                        |

Protected endpoints require `Authorization: Bearer <accessToken>`. Authentication
sessions are persisted and checked on requests, so logout and password reset
revoke access immediately. Authorization is applied globally; mark intentionally
public endpoints with `@Public()` and protected role routes with `@RequireRoles()`.
Seller-only routes additionally require an approved seller profile.

Seller application review:

| Method | Path                                | Permission   | Purpose                                                            |
| :----- | :---------------------------------- | :----------- | :----------------------------------------------------------------- |
| POST   | `/sellers/applications`             | Active buyer | Submit an individual or business seller application                |
| GET    | `/sellers/applications/pending`     | Active admin | List applications awaiting review                                  |
| POST   | `/sellers/applications/:id/approve` | Active admin | Approve a pending application and assign its owner the seller role |
| POST   | `/sellers/applications/:id/reject`  | Active admin | Reject a pending application                                       |

Only pending applications can be approved or rejected. Approved seller access
continues to require both the seller role and an approved profile.

## Product catalog

The category seed data is applied by `pnpm db:seed` alongside the role records.
It creates the three SRS category trees idempotently. Public category reads
return active root categories with their active children.

| Method           | Path                                                      | Permission      | Purpose                                                      |
| :--------------- | :-------------------------------------------------------- | :-------------- | :----------------------------------------------------------- |
| GET              | `/catalog/categories`                                     | Public          | List active categories                                       |
| GET              | `/catalog/products?page=1&limit=20`                       | Public          | Search and page through eligible in-stock products           |
| GET              | `/catalog/products/:productId`                            | Public          | Get a publicly available product by UUID                     |
| GET              | `/catalog/seller/products`                                | Approved seller | List the seller's products                                   |
| POST             | `/catalog/seller/products`                                | Approved seller | Create a product pending approval                            |
| GET/PATCH/DELETE | `/catalog/seller/products/:productId`                     | Approved seller | Read, update, or unpublish an owned product                  |
| POST             | `/catalog/seller/products/:productId/variants`            | Approved seller | Add a variant with price and stock                           |
| PATCH/DELETE     | `/catalog/seller/products/:productId/variants/:variantId` | Approved seller | Update stock/variant or deactivate it                        |
| POST             | `/catalog/seller/products/:productId/images`              | Approved seller | Add an HTTPS image URL                                       |
| PATCH/DELETE     | `/catalog/seller/products/:productId/images/:imageId`     | Approved seller | Update or remove an image URL                                |
| GET              | `/catalog/admin/products/pending`                         | Active admin    | List pending products with seller and product review details |
| POST             | `/catalog/admin/products/:productId/approve`              | Active admin    | Approve a valid pending product                              |
| POST             | `/catalog/admin/products/:productId/reject`               | Active admin    | Reject a pending product                                     |

Product edits, variant changes, and image changes return the product to
`PENDING_APPROVAL`; seller routes never grant approval. Product and nested
resource operations are scoped to the authenticated seller profile.
Moderation accepts only pending products. Approval rechecks product field
validation, category activity, and seller approval. The current product model
does not store rejection reasons, so rejection changes status only.
Public product responses include bilingual product and category fields,
in-stock active variants, and image metadata; seller details, product status,
and variant SKU are not exposed. Listings require approved product and seller
statuses, an active seller account and category, and at least one active,
in-stock variant.

The public listing accepts optional `q`, `categoryId`, `subcategoryId`,
`minPrice`, `maxPrice`, `condition`, and `sort` query parameters. Keyword
search checks English and Amharic titles and descriptions; a category ID
includes its direct subcategories, while a subcategory ID narrows to that
category. Price bounds match in-stock active variants. Sort values are
`newest` (default), `oldest`, `price_asc`, and `price_desc`. Pagination is
bounded to 100 results per page. Non-empty normalized search terms are stored
without user identifiers and aggregated with search counts and total result
counts.

## Shopping cart

| Method | Path                     | Permission   | Purpose                                       |
| :----- | :----------------------- | :----------- | :-------------------------------------------- |
| GET    | `/cart`                  | Active buyer | View the buyer's own cart and current pricing |
| POST   | `/cart/items`            | Active buyer | Add a catalog variant and quantity            |
| PATCH  | `/cart/items/:variantId` | Active buyer | Set the quantity of an owned cart item        |
| DELETE | `/cart/items/:variantId` | Active buyer | Remove an owned cart item                     |
| POST   | `/cart/checkout`         | Active buyer | Create an order from the buyer's saved cart   |

Cart operations require the authenticated buyer's bearer token. Adding an
existing variant increments its quantity; updating a variant sets its
quantity. Quantities follow the order limits of 1-10 per variant, and a cart can
contain up to 20 variants. Add and update validate the current product, seller,
variant, and stock eligibility. Cart prices are read from the current catalog
and are never accepted from the request. Items that later become unavailable
remain visible in the cart with `isAvailable: false`; checkout revalidates them.

Cart checkout requires the same `Idempotency-Key` format as order creation. It
uses the saved cart quantities with the existing order-pricing and stock
validation behavior, then removes only the cart rows that still match the
checked-out quantities. If checkout fails, cart contents remain unchanged.
`POST /orders` remains available with its existing request-body behavior.

## Checkout

| Method | Path      | Permission   | Purpose                                     |
| :----- | :-------- | :----------- | :------------------------------------------ |
| POST   | `/orders` | Active buyer | Create a pending order from catalog variants |

Checkout requires the authenticated buyer's bearer token and an
`Idempotency-Key` header containing 1-255 ASCII letters, digits, dots,
underscores, colons, or hyphens; the first character must be a letter or digit.
Send `items` as an array of `{ "variantId": "<UUID>", "quantity": 1 }` entries.
The buyer identity and prices are taken from the authenticated session and
database, not the request body. Retrying the same key and payload returns the
existing order; using that key with a different payload returns `409 Conflict`.
Checkout validates current stock but does not reserve or decrement it. An
administrator must confirm stock through `POST /orders/admin/:id/confirm-stock`;
this transaction rechecks availability, decrements inventory, and records an
active reservation. The buyer cannot select a payment option until every order
item has an active reservation.

| Method | Path                             | Permission   | Purpose                                      |
| :----- | :------------------------------- | :----------- | :------------------------------------------- |
| GET    | `/orders`                        | Active buyer | List the buyer's own order history           |
| GET    | `/orders/:id`                    | Active buyer | Get an owned order                           |
| PATCH  | `/orders/:id/payment`            | Active buyer | Select `DEPOSIT` (50%) or `FULL`             |
| GET    | `/orders/contact?orderId=…`      | Active buyer | Get the official contact after option choice |
| GET    | `/orders/admin`                  | Active admin | List orders                                  |
| GET    | `/orders/admin/:id`              | Active admin | Get an order for administration              |
| POST   | `/orders/admin/:id/confirm-stock` | Active admin | Confirm and reserve order stock              |
| PATCH  | `/orders/admin/:id/status`       | Active admin | Manually complete or cancel an order         |

Selecting `DEPOSIT` or `FULL` returns both the final `total` and the calculated
`paymentAmount`; a deposit is half the final total, rounded to two decimal
places. Payment remains external: the API does not accept payment proof or
verify payment. An order stays `PENDING` until an administrator manually
completes it or cancels it. Cancellation releases any active reservation and
restores inventory. Contact details are read from `HULEGEB_OFFICIAL_PHONE` and
`HULEGEB_OFFICIAL_TELEGRAM`; both must be configured for the contact endpoint.

## Development administrator

From `back-end`, run `pnpm db:seed:admin`. The command requires
`NODE_ENV=development` and a PostgreSQL URL targeting
`127.0.0.1:5433/hulegeb_dev`; it also checks the connected database name and
PostgreSQL server port before asking for input. It prompts for first name, last
name, email, an Ethiopian phone number, and a password entered twice without
terminal echo. Do not pass credentials as command-line arguments or environment
variables.

The new administrator remains `PENDING_VERIFICATION`, with both verification
timestamps unset. Complete the existing email and phone verification flows
before login; verified phone MFA remains required for administrator sign-in.
The command refuses to change an existing account and does not log the entered
credentials. It does not reset or migrate the database. The existing
`pnpm db:seed` command provisions role records and the SRS category tree.

Check the configured database before applying migrations. For the auth e2e
suite, set `AUTH_TEST_DATABASE_URL` to the explicitly allowlisted local test
endpoint and confirm the migrations target `hulegeb_auth_test`:

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

## Project setup

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

The SRS does not select a hosting provider. Use the production configuration
instructions below and the documentation for the platform selected by the
deployment operator.

No cloud provider is preconfigured or assumed by this backend.

## Observability

Observability is optional and enabled only when all required service credentials
are explicitly provided through the environment.

[NestJS Observe](https://observe.nestjs.com) can be configured for this backend:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

Observe is optional: leave `OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`, and
`OBSERVE_SERVICE_ID` unset to disable it, or configure all three through the
deployment environment. Do not put provider credentials in source code.

## Production configuration and deployment

The approved SRS 1.2 does not select a hosting provider or prescribe a
deployment/migration workflow. It does require external providers to be
explicitly approved and configured; this backend does not assume a default
provider. Configure secrets through the deployment platform's secret manager,
not source control, image build arguments, or command-line arguments.

Before starting the production service, provide these environment variables:

| Variable | Production requirement |
| :--- | :--- |
| `NODE_ENV` | Exactly `production`. |
| `DATABASE_URL` | PostgreSQL URL for a remote production database. Local hosts and database names containing a development, test, staging, or QA marker are rejected. |
| `JWT_ACCESS_SECRET`, `AUTH_CHALLENGE_SECRET` | Independent cryptographically random secrets, each at least 32 characters with at least 12 distinct characters; placeholders and identical values are rejected. |
| `AUTH_EMAIL_MODE`, `BREVO_API_KEY`, `AUTH_EMAIL_FROM`, `FRONTEND_URL` | Set the mode to `brevo`; provide a non-placeholder provider key of at least 16 characters, valid sender email, and HTTPS frontend URL. |
| `AUTH_SMS_MODE`, `AUTH_SMS_WEBHOOK_URL`, `AUTH_DELIVERY_WEBHOOK_TOKEN` | Set the mode to `webhook`; provide an HTTPS endpoint and an independently generated non-placeholder token of at least 32 characters with at least 12 distinct characters. |
| `HULEGEB_OFFICIAL_PHONE`, `HULEGEB_OFFICIAL_TELEGRAM` | Set the approved phone in E.164 format and an `@username` or HTTPS `t.me` URL. |
| `PORT` | Optional; if set, use a valid port number. |

Startup rejects a missing or unsupported `NODE_ENV`; only `development`,
`test`, and `production` are accepted, so production validation cannot be
skipped by omitting the environment mode.

Production startup rejects missing or unsafe required settings before the app
starts. Console email/SMS delivery is development/test-only and is rejected in
production. `AUTH_OTP_MAX_ATTEMPTS` remains optional and defaults to five.

The NestJS Observe integration is optional. Leave
`OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`, and `OBSERVE_SERVICE_ID` all unset to
disable it. To enable it, set all three to values issued for the service; partial
or placeholder values are rejected. Do not commit provider credentials.

After setting the production environment and verifying the database target
independently, run these commands from `back-end` as the authorized deployment
operator:

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma generate
pnpm run build
pnpm start:prod
```

`migrate deploy` applies migrations and should only be run by the deployment
operator after checking the configured target. The application and provisioning
commands do not reset a database.

## Production administrator provisioning

The public registration endpoint creates buyers only; it does not accept a role
or assign administrator access. Provision the initial administrator using a
trusted one-off production task after the database migrations have been applied:

```bash
pnpm db:provision:admin
```

Set `NODE_ENV=production` and `DATABASE_URL` in the task's protected environment.
The command rejects local databases and database names marked development, test,
staging, or QA. Before connecting, it requires an interactive operator to type
the exact production database name, host, and port shown by the command. It then
checks the connected PostgreSQL database name and port before asking for the
administrator details. Enter the password twice in the hidden terminal prompt;
never pass it as an argument or environment variable.

The account is created as `PENDING_VERIFICATION`, and the command does not
change an existing account, log credentials, migrate, or reset the database.
Complete the configured email and phone verification flows before signing in;
administrator phone MFA remains required. `pnpm db:seed:admin` is development
only and rejects production database targets.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
# Local development sample data

The default `pnpm db:seed` command remains unchanged: it seeds the roles and
categories. To add repeatable sample buyers, approved seller profiles, and
products, run the separate command below from `back-end` in a local development
environment:

```powershell
$env:NODE_ENV = 'development'
$env:SAMPLE_SEED_PASSWORD = Read-Host "Enter a local-only password (12+ characters)"
pnpm db:seed:sample
Remove-Item Env:SAMPLE_SEED_PASSWORD
Remove-Item Env:NODE_ENV
```

The sample command refuses to run unless `NODE_ENV=development`,
`DATABASE_URL` targets `127.0.0.1:5433/hulegeb_dev`, and the connected
PostgreSQL identity matches that development database. It does not reset or
clear data. Sample records use stable `.test` email addresses and SKU/slug
identifiers; existing records are left unchanged on reruns.

Newly created sample accounts use the password supplied through
`SAMPLE_SEED_PASSWORD`; reruns preserve any existing account credentials:

- `sample.buyer.one@example.test` — buyer
- `sample.buyer.two@example.test` — buyer
- `sample.seller.individual@example.test` — individual seller
- `sample.seller.business@example.test` — business seller

These credentials and accounts are for local development only. Sample users
remain `PENDING_VERIFICATION` with no verification timestamps, so the existing
authentication flow will not allow login until normal verification activates
the account. Sample products are `PENDING_APPROVAL`; they are not made public
by bypassing product moderation. Do not reuse the supplied local-only password
for any real account or environment.
