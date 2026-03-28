import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);
  private client: S3Client | null = null;
  private bucket: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>("S3_ENDPOINT");
    this.bucket = this.config.get<string>("S3_BUCKET") ?? "o3on-meeting-assistant";

    if (!endpoint) {
      this.logger.warn("S3_ENDPOINT not configured; S3 storage disabled.");
      return;
    }

    const accessKeyId = this.config.get<string>("S3_ACCESS_KEY");
    const secretAccessKey = this.config.get<string>("S3_SECRET_KEY");
    if (!accessKeyId || !secretAccessKey) {
      this.logger.error("S3_ENDPOINT is set but S3_ACCESS_KEY / S3_SECRET_KEY are missing. S3 storage disabled.");
      return;
    }

    this.client = new S3Client({
      endpoint,
      region: this.config.get<string>("S3_REGION") ?? "eu-central-1",
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  get isAvailable(): boolean {
    return this.client !== null;
  }

  async onModuleInit() {
    if (!this.client) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`S3 bucket "${this.bucket}" is accessible.`);
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`S3 bucket "${this.bucket}" created.`);
      } catch (err) {
        this.logger.warn(`Could not create S3 bucket: ${err}`);
      }
    }
  }

  async getPresignedUploadUrl(key: string, contentType: string, expiresIn = 900): Promise<string | null> {
    if (!this.client) return null;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async getPresignedDownloadUrl(key: string, expiresIn = 900): Promise<string | null> {
    if (!this.client) return null;
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.client) return;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  }

  async getObjectStream(key: string) {
    if (!this.client) return null;
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    return response.Body;
  }
}
