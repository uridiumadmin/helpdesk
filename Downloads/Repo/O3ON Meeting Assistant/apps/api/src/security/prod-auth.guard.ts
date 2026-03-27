import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { JWTPayload, createRemoteJWKSet, jwtVerify } from "jose";
import { AuthContext } from "./auth-context";

@Injectable()
export class ProdAuthGuard implements CanActivate {
  private jwksCache:
    | {
        url: string;
        loader: ReturnType<typeof createRemoteJWKSet>;
      }
    | undefined;

  constructor(private readonly configService: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    if (request.method === "POST" && request.path === "/v1/auth/session") {
      return true;
    }
    if (request.path === "/v1/health") {
      return true;
    }

    const authHeader = request.header("authorization");
    const audience =
      this.configService.get<string>("JWT_AUDIENCE") || this.configService.get<string>("AUTH0_AUDIENCE");
    const issuer =
      this.configService.get<string>("JWT_ISSUER") ||
      this.configService.get<string>("AUTH0_DOMAIN");

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing Bearer token.");
    }

    if (!audience || !issuer) {
      throw new UnauthorizedException("Auth0 configuration is incomplete.");
    }

    const token = authHeader.slice("Bearer ".length);
    const normalizedIssuer = issuer.startsWith("https://") ? issuer.replace(/\/+$/, "") : `https://${issuer.replace(/\/+$/, "")}`;
    const jwks = this.getJwks();

    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(token, jwks, {
        issuer: normalizedIssuer,
        audience
      });
      payload = verified.payload;
    } catch {
      throw new UnauthorizedException("Invalid bearer token.");
    }

    const userId = typeof payload.sub === "string" ? payload.sub : null;
    if (!userId) {
      throw new UnauthorizedException("Bearer token is missing sub claim.");
    }

    const orgId = this.readStringClaim(
      payload,
      this.configService.get<string>("JWT_ORG_ID_CLAIM"),
      "org_id",
      "organization_id",
      "https://o3on.dev/org_id"
    );
    if (!orgId) {
      throw new UnauthorizedException("Bearer token is missing an organization claim.");
    }

    const email =
      this.readStringClaim(payload, "email", "preferred_username", "upn") || `${userId}@token.invalid`;

    request.auth = {
      orgId,
      userId,
      email,
      role: this.readRoleClaim(payload)
    };
    return true;
  }

  private getJwks(): ReturnType<typeof createRemoteJWKSet> {
    const issuer =
      this.configService.get<string>("JWT_ISSUER") ||
      this.configService.get<string>("AUTH0_DOMAIN");
    if (!issuer) {
      throw new UnauthorizedException("Auth issuer is not configured.");
    }

    const normalizedIssuer = issuer.startsWith("https://") ? issuer.replace(/\/+$/, "") : `https://${issuer.replace(/\/+$/, "")}`;
    const explicitJwksUri = this.configService.get<string>("JWT_JWKS_URI")?.trim();
    const jwksUrl = explicitJwksUri || `${normalizedIssuer}/.well-known/jwks.json`;

    if (!this.jwksCache || this.jwksCache.url !== jwksUrl) {
      this.jwksCache = {
        url: jwksUrl,
        loader: createRemoteJWKSet(new URL(jwksUrl))
      };
    }

    return this.jwksCache.loader;
  }

  private readStringClaim(payload: JWTPayload, ...claimNames: Array<string | undefined>): string | null {
    for (const claimName of claimNames) {
      if (!claimName) {
        continue;
      }
      const value = payload[claimName];
      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }
    }
    return null;
  }

  private readRoleClaim(payload: JWTPayload): AuthContext["role"] {
    const configuredRoleClaim = this.configService.get<string>("JWT_ROLE_CLAIM")?.trim();
    const candidates = [
      configuredRoleClaim,
      "roles",
      "role",
      "https://o3on.dev/role",
      "https://o3on.dev/roles"
    ].filter(Boolean) as string[];

    for (const claimName of candidates) {
      const value = payload[claimName];
      if (typeof value === "string") {
        return this.normalizeRole(value);
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (typeof entry === "string") {
            return this.normalizeRole(entry);
          }
        }
      }
    }

    return "member";
  }

  private normalizeRole(value: string): AuthContext["role"] {
    if (value === "owner" || value.endsWith(":owner")) {
      return "owner";
    }
    if (value === "admin" || value.endsWith(":admin")) {
      return "admin";
    }
    return "member";
  }
}
