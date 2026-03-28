import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "./prisma/prisma.service";

interface CheckResult {
  status: "ok" | "error" | "not_configured";
  message: string;
}

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  @Get()
  async getHealth() {
    const database = await this.checkDatabase();
    const worker = await this.checkWorker();

    const dbDown = database.status === "error";
    const workerDown = worker.status === "error";

    let status: "ok" | "degraded" | "unhealthy";
    if (dbDown && workerDown) {
      status = "unhealthy";
    } else if (dbDown || workerDown) {
      status = "degraded";
    } else {
      status = "ok";
    }

    return {
      status,
      service: "o3on-meeting-api",
      checks: { database, worker },
      timestamp: new Date().toISOString()
    };
  }

  private async checkDatabase(): Promise<CheckResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", message: "Database connection is healthy." };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: "error", message: `Database unreachable: ${message}` };
    }
  }

  private async checkWorker(): Promise<CheckResult> {
    const baseUrl = this.config.get<string>("WORKER_BASE_URL");
    if (!baseUrl || baseUrl.trim().length === 0) {
      return { status: "not_configured", message: "WORKER_BASE_URL is not set." };
    }

    try {
      const url = `${baseUrl.replace(/\/+$/, "")}/health`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        return { status: "ok", message: "Worker is healthy." };
      }
      return { status: "error", message: `Worker returned HTTP ${response.status}.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: "error", message: `Worker unreachable: ${message}` };
    }
  }
}
