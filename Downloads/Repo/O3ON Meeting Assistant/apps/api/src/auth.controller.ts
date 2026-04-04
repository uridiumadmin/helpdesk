import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Post,
  Put,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";
import { randomBytes, timingSafeEqual } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { CurrentAuth } from "./security/auth-context.decorator";
import { AuthContext } from "./security/auth-context";
import { encodeDevToken } from "./security/dev-token";
import { PrismaService } from "./prisma/prisma.service";
import { UpdateProfileDto } from "./meetings/dto/update-profile.dto";

class CreateSessionDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(3)
  password!: string;
}

class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsOptional()
  fullName?: string;

  @IsString()
  @IsOptional()
  role?: string;
}

const BCRYPT_ROUNDS = 12;

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

function verifyPassword(password: string, hash: string): boolean {
  if (hash && hash.startsWith("$2")) {
    return bcrypt.compareSync(password, hash);
  }
  // Legacy HMAC-SHA256 hash — return null to signal "try legacy path"
  return false;
}

function verifyLegacyHmac(password: string, storedHash: string, salt: string): boolean {
  const { createHmac } = require("node:crypto");
  const computed = createHmac("sha256", salt).update(password).digest("hex");
  return timingSafeStringEqual(computed, storedHash);
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function generateStrongPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*()-_=+";
  const maxUnbiased = 256 - (256 % chars.length);
  let password = "";
  while (password.length < 24) {
    const bytes = randomBytes(32);
    for (const byte of bytes) {
      if (byte < maxUnbiased) {
        password += chars[byte % chars.length];
        if (password.length >= 24) break;
      }
    }
  }
  return password;
}

@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("session")
  async createSession(@Body() dto: CreateSessionDto) {
    if (this.configService.get<string>("AUTH_MODE") !== "development") {
      throw new ForbiddenException("Credential login is disabled when AUTH_MODE=auth0.");
    }

    const secret = this.configService.get<string>("DEV_AUTH_SECRET")?.trim();
    if (!secret) {
      throw new ForbiddenException("DEV_AUTH_SECRET must be configured for development auth.");
    }

    const emailLower = dto.email.toLowerCase();
    let userRole = "member";
    let userFullName = dto.email.split("@")[0].replace(/[._-]/g, " ");

    // Step 1: Try database authentication (users created by admin)
    let dbAuthenticated = false;
    try {
      const dbUser = await this.prisma.user.findUnique({ where: { email: emailLower } });
      if (dbUser?.passwordHash) {
        if (verifyPassword(dto.password, dbUser.passwordHash)) {
          dbAuthenticated = true;
          userRole = dbUser.role;
          userFullName = dbUser.fullName ?? userFullName;
        } else if (dbUser.passwordHash && !dbUser.passwordHash.startsWith("$2")) {
          // Legacy HMAC-SHA256 hash — try transparent migration
          const legacySalt = this.configService.get<string>("LEGACY_AUTH_HMAC_SECRET") ?? "o3on-meeting-assistant-2026";
          if (verifyLegacyHmac(dto.password, dbUser.passwordHash, legacySalt)) {
            // Migrate to bcrypt transparently
            const newHash = hashPassword(dto.password);
            await this.prisma.user.update({ where: { id: dbUser.id }, data: { passwordHash: newHash } });
            this.logger.log(`Migrated legacy password hash to bcrypt for user ${dbUser.id}`);
            dbAuthenticated = true;
            userRole = dbUser.role;
            userFullName = dbUser.fullName ?? userFullName;
          } else {
            throw new UnauthorizedException("Pogrešna lozinka.");
          }
        } else {
          throw new UnauthorizedException("Pogrešna lozinka.");
        }
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.warn("DB auth check failed");
    }

    // Step 2: Fallback to USER_CREDENTIALS env var
    if (!dbAuthenticated) {
      const userCredentials = this.configService.get<string>("USER_CREDENTIALS")?.trim();
      if (userCredentials) {
        const credentials = new Map<string, string>();
        for (const entry of userCredentials.split("|")) {
          const sepIndex = entry.indexOf(":");
          if (sepIndex > 0) {
            credentials.set(entry.slice(0, sepIndex).trim().toLowerCase(), entry.slice(sepIndex + 1).trim());
          }
        }
        const userPassword = credentials.get(emailLower);
        if (!userPassword) {
          throw new ForbiddenException("Vaš nalog nema pristup ovoj aplikaciji.");
        }
        if (!timingSafeStringEqual(dto.password, userPassword)) {
          throw new UnauthorizedException("Pogrešna lozinka.");
        }
      } else {
        const expectedPassword = this.configService.get<string>("DEV_AUTH_PASSWORD")?.trim();
        if (!expectedPassword || !timingSafeStringEqual(dto.password, expectedPassword)) {
          throw new UnauthorizedException("Pogrešna lozinka.");
        }
        const allowedUsers = (this.configService.get<string>("ALLOWED_USERS") ?? "")
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean);
        if (allowedUsers.length > 0 && !allowedUsers.includes(emailLower)) {
          throw new ForbiddenException("Vaš nalog nema pristup ovoj aplikaciji.");
        }
      }
    }

    // Determine role from ADMIN_EMAILS env var if not set from DB
    if (!dbAuthenticated) {
      const adminEmails = (this.configService.get<string>("ADMIN_EMAILS") ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      if (adminEmails.includes(emailLower)) {
        userRole = "admin";
      }
    }

    const local = {
      orgId: "org-o3on",
      userId: `dev:${emailLower}`,
      email: dto.email,
      role: userRole as "owner" | "admin" | "member",
    };

    // Auto-provision user in DB
    try {
      await this.prisma.organization.upsert({
        where: { id: local.orgId },
        create: { id: local.orgId, name: "O3ON" },
        update: {},
      });
      await this.prisma.user.upsert({
        where: { email: emailLower },
        create: {
          id: local.userId,
          email: emailLower,
          fullName: userFullName,
          role: userRole,
          orgId: local.orgId,
        },
        update: { role: userRole },
      });
    } catch {
      // non-critical
    }

    return {
      accessToken: encodeDevToken(local, secret),
      refreshToken: null,
      user: {
        id: local.userId,
        email: local.email,
        fullName: userFullName,
        role: local.role,
      },
      organization: {
        id: local.orgId,
        name: "O3ON",
      },
    };
  }

  @Delete("session")
  @HttpCode(204)
  dropSession() {
    return;
  }

  @Get("me")
  me(@CurrentAuth() auth: AuthContext) {
    const authMode = this.configService.get<string>("AUTH_MODE");
    const secret = this.configService.get<string>("DEV_AUTH_SECRET")?.trim();
    return {
      accessToken: authMode === "development" && secret ? encodeDevToken(auth, secret) : "",
      refreshToken: null,
      user: {
        id: auth.userId,
        email: auth.email,
        fullName: auth.email.split("@")[0].replace(/[._-]/g, " "),
        role: auth.role,
      },
      organization: {
        id: auth.orgId,
        name: "O3ON",
      },
    };
  }

  @Get("profile")
  async getProfile(@CurrentAuth() auth: AuthContext) {
    try {
      const user = await this.prisma.user.findFirst({ where: { id: auth.userId } });
      if (user) {
        return {
          id: user.id,
          email: user.email,
          fullName: user.fullName ?? auth.email.split("@")[0].replace(/[._-]/g, " "),
          avatarUrl: user.avatarUrl ?? null,
          role: user.role,
        };
      }
    } catch (error) {
      this.logger.warn(`Profile lookup failed: ${error}`);
    }
    return {
      id: auth.userId,
      email: auth.email,
      fullName: auth.email.split("@")[0].replace(/[._-]/g, " "),
      avatarUrl: null,
      role: auth.role,
    };
  }

  @Put("profile")
  async updateProfile(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateProfileDto) {
    try {
      await this.prisma.organization.upsert({
        where: { id: auth.orgId },
        create: { id: auth.orgId, name: "O3ON" },
        update: {},
      });
      const data: Record<string, string> = {};
      if (dto.fullName !== undefined) data.fullName = dto.fullName;
      if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;

      const user = await this.prisma.user.upsert({
        where: { id: auth.userId },
        create: {
          id: auth.userId,
          email: auth.email,
          fullName: dto.fullName ?? auth.email.split("@")[0].replace(/[._-]/g, " "),
          avatarUrl: dto.avatarUrl ?? null,
          role: auth.role,
          orgId: auth.orgId,
        },
        update: data,
      });
      return {
        id: user.id,
        email: user.email,
        fullName: user.fullName ?? auth.email.split("@")[0].replace(/[._-]/g, " "),
        avatarUrl: user.avatarUrl ?? null,
        role: user.role,
      };
    } catch (error) {
      this.logger.warn(`Profile update failed: ${error}`);
      return {
        id: auth.userId,
        email: auth.email,
        fullName: dto.fullName ?? auth.email.split("@")[0].replace(/[._-]/g, " "),
        avatarUrl: dto.avatarUrl ?? null,
        role: auth.role,
      };
    }
  }

  /* ─── Admin: User Management ────────────────────────────────────────── */

  @Get("users")
  async listUsers(@CurrentAuth() auth: AuthContext) {
    if (auth.role !== "admin" && auth.role !== "owner") {
      throw new ForbiddenException("Samo administratori mogu da vide listu korisnika.");
    }
    try {
      const users = await this.prisma.user.findMany({
        where: { orgId: auth.orgId },
        orderBy: { createdAt: "desc" },
      });
      return users.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        createdAt: u.createdAt.toISOString(),
      }));
    } catch {
      return [];
    }
  }

  @Post("users")
  async createUser(@CurrentAuth() auth: AuthContext, @Body() dto: CreateUserDto) {
    if (auth.role !== "admin" && auth.role !== "owner") {
      throw new ForbiddenException("Samo administratori mogu da kreiraju korisnike.");
    }

    const emailLower = dto.email.toLowerCase();
    const generatedPassword = generateStrongPassword();
    const passwordHash = hashPassword(generatedPassword);
    const role = dto.role === "admin" ? "admin" : "member";

    try {
      await this.prisma.organization.upsert({
        where: { id: auth.orgId },
        create: { id: auth.orgId, name: "O3ON" },
        update: {},
      });

      const user = await this.prisma.user.upsert({
        where: { email: emailLower },
        create: {
          id: `dev:${emailLower}`,
          email: emailLower,
          fullName: dto.fullName ?? emailLower.split("@")[0].replace(/[._-]/g, " "),
          passwordHash,
          role,
          orgId: auth.orgId,
        },
        update: {
          passwordHash,
          role,
          fullName: dto.fullName ?? undefined,
        },
      });

      return {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        generatedPassword,
      };
    } catch (error) {
      this.logger.error(`Create user failed: ${error}`);
      throw new ForbiddenException("Kreiranje korisnika nije uspelo.");
    }
  }
}
