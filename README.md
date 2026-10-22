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

The PostgreSQL e2e suite refuses to start unless `AUTH_TEST_DATABASE_URL` is set
explicitly to a URL whose database name is `hulegeb_auth_test`. It then replaces
`DATABASE_URL` for that test process. Do not point this variable at development
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
| GET              | `/catalog/products?page=1&limit=20`                       | Public          | Page through eligible in-stock products                      |
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
suite, use `AUTH_TEST_DATABASE_URL` and confirm it targets `hulegeb_auth_test`:

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

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

This project is already instrumented. Create a free account at [observe.nestjs.com](https://observe.nestjs.com), add an application, and paste the generated app key and secret into the `ObserveModule.forRoot()` call in `src/app.module.ts`.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

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
