import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import { ChunkTranscribePayload, ChunkTranscribeResult, SummarizePayload, SummarizeResult, WorkerProcessingResult } from "./worker-types";

@Injectable()
export class WorkerClient {
  private readonly logger = new Logger(WorkerClient.name);

  constructor(private readonly configService: ConfigService) {}

  get autoProcess(): boolean {
    return this.configService.get<boolean>("WORKER_AUTO_PROCESS") ?? true;
  }

  private get workerBaseUrl(): string | null {
    const value = this.configService.get<string>("WORKER_BASE_URL");
    return value && value.trim().length > 0 ? value.replace(/\/+$/, "") : null;
  }

  private get workerSharedSecret(): string | null {
    const value = this.configService.get<string>("WORKER_SHARED_SECRET");
    return value && value.trim().length > 0 ? value : null;
  }

  async processMeeting(payload: unknown): Promise<WorkerProcessingResult | null> {
    const baseUrl = this.workerBaseUrl;
    if (!baseUrl) {
      return null;
    }

    const secret = this.workerSharedSecret;
    if (!secret) {
      throw new Error("WORKER_SHARED_SECRET must be configured before worker processing is enabled.");
    }

    const body = JSON.stringify(payload);
    const maxAttempts = 3;
    const baseDelayMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

      try {
        const response = await fetch(`${baseUrl}/process`, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-o3on-timestamp": timestamp,
            "x-o3on-signature": signature
          },
          body,
          signal: AbortSignal.timeout(300_000)
        });

        if (!response.ok) {
          const responseBody = await response.text();
          const errMsg = `Worker processing failed: ${response.status} ${responseBody}`;
          if (attempt < maxAttempts && response.status >= 500) {
            const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
            this.logger.warn(`${errMsg} — retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`);
            await this.sleep(delayMs);
            continue;
          }
          this.logger.error(errMsg);
          throw new Error(`Worker processing failed with status ${response.status}.`);
        }

        return (await response.json()) as WorkerProcessingResult;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Worker processing failed with status")) {
          throw error;
        }

        if (attempt < maxAttempts) {
          const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
          this.logger.warn(
            `Worker request error (attempt ${attempt}/${maxAttempts}): ${error} — retrying in ${delayMs}ms`
          );
          await this.sleep(delayMs);
          continue;
        }

        this.logger.error(`Worker request failed after ${maxAttempts} attempts: ${error}`);
        throw error;
      }
    }

    throw new Error(`Worker processing failed after ${maxAttempts} attempts.`);
  }

  async transcribeChunk(payload: ChunkTranscribePayload): Promise<ChunkTranscribeResult> {
    const baseUrl = this.workerBaseUrl;
    if (!baseUrl) {
      throw new Error("WORKER_BASE_URL is not configured.");
    }

    const secret = this.workerSharedSecret;
    if (!secret) {
      throw new Error("WORKER_SHARED_SECRET must be configured before worker processing is enabled.");
    }

    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

    const response = await fetch(`${baseUrl}/transcribe-chunk`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-o3on-timestamp": timestamp,
        "x-o3on-signature": signature
      },
      body,
      signal: AbortSignal.timeout(600_000)
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`Worker transcribe-chunk failed: ${response.status} ${responseBody}`);
    }

    return (await response.json()) as ChunkTranscribeResult;
  }

  async summarizeMeeting(payload: SummarizePayload): Promise<SummarizeResult> {
    const baseUrl = this.workerBaseUrl;
    if (!baseUrl) {
      throw new Error("WORKER_BASE_URL is not configured.");
    }

    const secret = this.workerSharedSecret;
    if (!secret) {
      throw new Error("WORKER_SHARED_SECRET must be configured before worker processing is enabled.");
    }

    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

    const response = await fetch(`${baseUrl}/summarize`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-o3on-timestamp": timestamp,
        "x-o3on-signature": signature
      },
      body,
      signal: AbortSignal.timeout(300_000)
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`Worker summarize failed: ${response.status} ${responseBody}`);
    }

    return (await response.json()) as SummarizeResult;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
