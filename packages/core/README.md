# @warlock.js/core

A robust Node.js framework for building blazing fast applications.

## Installation

```bash
yarn create warlock my-backend-app
```

## What's in the box

`@warlock.js/core` bundles the runtime primitives an application boots on:

| Primitive          | What it does                                                            |
| ------------------ | ----------------------------------------------------------------------- |
| Application        | Boot/shutdown lifecycle, boot hooks, health & readiness endpoints       |
| HTTP + router      | Fastify-backed server, route groups, RESTful resource routes            |
| Middleware         | Request pipeline guards and transformers                                |
| Storage            | Disk-contained local + remote file storage                              |
| Repositories       | Cached query layer over Cascade models                                  |
| Use-cases          | Composable application services with history                            |
| Validation         | Framework validators (file, database rules) layered on `@warlock.js/seal` |
| Mail               | Mail sending and templating                                             |
| Cache              | Application cache facade                                                 |
| Socket             | Real-time socket layer                                                  |
| Dev-server         | `warlock dev` with type generation and update notices                   |
| CLI                | `warlock` generators, migrations, and project commands                  |

## Optional peer dependencies

Core keeps these as **optional** peers — install a package only when you use the
feature that needs it:

| Install                                                                          | Needed for                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------- |
| `sharp`                                                                          | image processing / resizing                 |
| `socket.io`                                                                      | the socket layer                            |
| `nodemailer`                                                                     | sending mail                                |
| `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` + `@aws-sdk/s3-request-presigner`  | S3 storage driver + presigned URLs          |
| `@aws-sdk/client-sesv2`                                                          | the AWS SES mail driver                     |
| `react` + `react-dom` + `@react-email/render`                                    | React Email templates                       |
| `@warlock.js/herald`                                                             | the Herald message-broker connector         |

## Documentation

Full documentation is available at the [official documentation](https://warlock.js.org).
