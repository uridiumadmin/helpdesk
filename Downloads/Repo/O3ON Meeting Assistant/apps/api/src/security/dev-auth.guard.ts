import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { AuthContext } from "./auth-context";
import { decodeDevToken } from "./dev-token";

@Injectable()
export class DevAuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    if (request.method === "POST" && request.path === "/v1/auth/session") {
      return true;
    }
    if (request.path === "/v1/health") {
      return true;
    }

    const secret = this.configService.get<string>("DEV_AUTH_SECRET")?.trim();
    if (!secret) {
      throw new ServiceUnavailableException("DEV_AUTH_SECRET must be configured in development mode.");
    }

    const authHeader = request.header("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice("Bearer ".length);
      const decoded = decodeDevToken(token, secret);
      if (decoded) {
        request.auth = decoded;
        return true;
      }
    }

    throw new UnauthorizedException("Missing or invalid development bearer token.");
  }
}
