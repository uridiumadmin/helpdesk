import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import * as Joi from "joi";
import { AuthController } from "./auth.controller";
import { HealthController } from "./health.controller";
import { MeetingsModule } from "./meetings/meetings.module";
import { SecurityModule } from "./security/security.module";
import { PingController } from "./ping.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { S3Module } from "./storage/s3.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        AUTH_MODE: Joi.string().valid("development", "auth0").default("auth0"),
        AUTH0_DOMAIN: Joi.string().allow("").optional(),
        AUTH0_AUDIENCE: Joi.string().allow("").optional(),
        JWT_ISSUER: Joi.string().allow("").optional(),
        JWT_AUDIENCE: Joi.string().allow("").optional(),
        JWT_JWKS_URI: Joi.string().uri().allow("").optional(),
        JWT_ORG_ID_CLAIM: Joi.string().allow("").optional(),
        JWT_ROLE_CLAIM: Joi.string().allow("").optional(),
        DEV_AUTH_SECRET: Joi.string().allow("").optional(),
        DEV_AUTH_PASSWORD: Joi.string().allow("").optional(),
        ALLOWED_ORIGINS: Joi.string().allow("").optional(),
        RATE_LIMIT_WINDOW_MS: Joi.number().default(60000),
        RATE_LIMIT_MAX_REQUESTS: Joi.number().default(120),
        AUTH_RATE_LIMIT_MAX_REQUESTS: Joi.number().default(12),
        UPLOAD_RATE_LIMIT_MAX_REQUESTS: Joi.number().default(24),
        PROCESS_RATE_LIMIT_MAX_REQUESTS: Joi.number().default(12),
        UPLOAD_URL_TTL_SECONDS: Joi.number().default(900),
        MEETING_STORAGE_ROOT: Joi.string().default("./var"),
        WORKER_BASE_URL: Joi.string().allow("").default(""),
        WORKER_AUTO_PROCESS: Joi.boolean().truthy("true").falsy("false").default(true),
        WORKER_SHARED_SECRET: Joi.string().allow("").optional(),
        DATABASE_URL: Joi.string().allow("").optional(),
        S3_ENDPOINT: Joi.string().allow("").optional(),
        S3_REGION: Joi.string().allow("").optional(),
        S3_BUCKET: Joi.string().allow("").optional(),
        S3_ACCESS_KEY: Joi.string().allow("").optional(),
        S3_SECRET_KEY: Joi.string().allow("").optional()
      })
    }),
    PrismaModule,
    S3Module,
    SecurityModule,
    MeetingsModule
  ],
  controllers: [AuthController, HealthController, PingController]
})
export class AppModule {}
