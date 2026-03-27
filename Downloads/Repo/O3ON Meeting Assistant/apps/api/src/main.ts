import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";

type RateLimitPolicy = {
  name: string;
  maxRequests: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();

function getClientIp(request: Request): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0]?.trim() || request.ip || request.socket.remoteAddress || "unknown";
  }
  return request.ip || request.socket.remoteAddress || "unknown";
}

function pickRateLimitPolicy(request: Request, configService: ConfigService): RateLimitPolicy {
  const path = request.path;
  if (request.method === "POST" && path === "/v1/auth/session") {
    return {
      name: "auth",
      maxRequests: configService.get<number>("AUTH_RATE_LIMIT_MAX_REQUESTS") ?? 12
    };
  }

  if (request.method === "POST" && /\/v1\/meetings\/[^/]+\/uploads\/[^/]+\/file$/.test(path)) {
    return {
      name: "upload",
      maxRequests: configService.get<number>("UPLOAD_RATE_LIMIT_MAX_REQUESTS") ?? 24
    };
  }

  if (
    request.method === "POST" &&
    (/\/v1\/meetings\/[^/]+\/uploads\/complete$/.test(path) || /\/v1\/meetings\/[^/]+\/process$/.test(path))
  ) {
    return {
      name: "process",
      maxRequests: configService.get<number>("PROCESS_RATE_LIMIT_MAX_REQUESTS") ?? 12
    };
  }

  return {
    name: "default",
    maxRequests: configService.get<number>("RATE_LIMIT_MAX_REQUESTS") ?? 120
  };
}

function buildAllowedOrigins(configService: ConfigService): string[] {
  const configured = (configService.get<string>("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return configured;
  }

  if (configService.get<string>("AUTH_MODE") === "development") {
    return ["http://localhost:8081", "http://localhost:19006", "http://127.0.0.1:8081"];
  }

  return [];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set("trust proxy", true);

  const configService = app.get(ConfigService);
  app.setGlobalPrefix("v1");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true
    })
  );
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false
    })
  );

  const allowedOrigins = buildAllowedOrigins(configService);
  app.enableCors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed by CORS policy."), false);
    }
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    const policy = pickRateLimitPolicy(request, configService);
    const windowMs = configService.get<number>("RATE_LIMIT_WINDOW_MS") ?? 60000;
    const key = `${policy.name}:${getClientIp(request)}`;
    const now = Date.now();
    const current = rateLimitStore.get(key);

    const entry =
      current && current.resetAt > now
        ? current
        : {
            count: 0,
            resetAt: now + windowMs
          };

    entry.count += 1;
    rateLimitStore.set(key, entry);

    response.setHeader("X-RateLimit-Limit", String(policy.maxRequests));
    response.setHeader("X-RateLimit-Remaining", String(Math.max(0, policy.maxRequests - entry.count)));
    response.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > policy.maxRequests) {
      response.status(429).json({
        status: "rate_limited",
        message: "Too many requests. Please retry later."
      });
      return;
    }

    if (rateLimitStore.size > 5000) {
      for (const [storedKey, storedEntry] of rateLimitStore.entries()) {
        if (storedEntry.resetAt <= now) {
          rateLimitStore.delete(storedKey);
        }
      }
    }

    next();
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

bootstrap();
