import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { ActionItem, Meeting, MeetingArtifact as ContractArtifact, Participant } from "@o3on/contracts";
import { v7 as uuidv7 } from "uuid";
import { AuthContext } from "../security/auth-context";
import { AddParticipantDto } from "./dto/add-participant.dto";
import { CreateMeetingDto } from "./dto/create-meeting.dto";
import { CreateUploadSessionDto } from "./dto/create-upload-session.dto";
import { UploadStorageService } from "./upload-storage.service";
import { WorkerClient } from "./worker-client";
import { WorkerProcessingResult } from "./worker-types";
import { PrismaService } from "../prisma/prisma.service";
import { S3Service } from "../storage/s3.service";

interface StoredUpload {
  id: string;
  objectKey: string;
  expectedParts: number;
  completedAt?: string;
  filePath?: string;
  fileName?: string;
  fileSizeBytes?: number;
  contentType?: string;
  durationSeconds?: number;
}

interface StoredMeeting extends Meeting {
  orgId: string;
  createdBy: string;
  createdAt: string;
  upload?: StoredUpload;
}

@Injectable()
export class MeetingsService implements OnModuleInit {
  private readonly logger = new Logger(MeetingsService.name);
  private readonly meetings = new Map<string, StoredMeeting>();
  private usePrisma = false;

  constructor(
    private readonly uploadStorageService: UploadStorageService,
    private readonly workerClient: WorkerClient,
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service
  ) {}

  async onModuleInit() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      this.usePrisma = true;
      this.logger.log("MeetingsService: using Prisma/PostgreSQL for storage.");
    } catch {
      this.usePrisma = false;
      this.logger.warn("MeetingsService: database unavailable, using in-memory Map fallback.");
    }
  }

  async createMeeting(auth: AuthContext, dto: CreateMeetingDto): Promise<Meeting> {
    if (this.usePrisma) {
      try {
        const meeting = await this.prisma.meeting.create({
          data: {
            id: uuidv7(),
            title: dto.title,
            startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
            durationMinutes: dto.durationMinutes ?? 60,
            language: "sr-RS",
            status: "draft",
            orgId: auth.orgId,
            createdById: auth.userId,
            participants: {
              create: (dto.participantNames ?? []).map((name) => ({
                id: uuidv7(),
                name,
                enrollmentStatus: "pending",
              })),
            },
          },
          include: { participants: true, artifact: true },
        });
        return this.prismaToMeetingResponse(meeting);
      } catch (error) {
        this.logger.error(`Prisma createMeeting failed, falling back to Map: ${error}`);
      }
    }

    return this.createMeetingInMemory(auth, dto);
  }

  async listMeetings(auth: AuthContext): Promise<Meeting[]> {
    if (this.usePrisma) {
      try {
        const meetings = await this.prisma.meeting.findMany({
          where: { orgId: auth.orgId },
          include: { participants: true, artifact: true },
          orderBy: { createdAt: "desc" },
        });
        return meetings.map((m) => this.prismaToMeetingResponse(m));
      } catch (error) {
        this.logger.error(`Prisma listMeetings failed, falling back to Map: ${error}`);
      }
    }

    return Array.from(this.meetings.values())
      .filter((meeting) => meeting.orgId === auth.orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((meeting) => this.toMeetingResponse(meeting));
  }

  async addParticipant(auth: AuthContext, meetingId: string, dto: AddParticipantDto): Promise<Participant> {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId);
        const participant = await this.prisma.participant.create({
          data: {
            id: uuidv7(),
            meetingId,
            name: dto.displayName,
            email: dto.email,
            enrollmentStatus: "pending",
          },
        });
        return {
          id: participant.id,
          meetingId: participant.meetingId,
          name: participant.name,
          email: participant.email ?? undefined,
          enrollmentStatus: participant.enrollmentStatus as "pending" | "enrolled" | "needs_retry",
        };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.logger.error(`Prisma addParticipant failed, falling back to Map: ${error}`);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    const participant: Participant = {
      id: uuidv7(),
      meetingId,
      name: dto.displayName,
      email: dto.email,
      enrollmentStatus: "pending",
    };
    meeting.participants.push(participant);
    return participant;
  }

  async enrollParticipant(auth: AuthContext, meetingId: string, participantId: string) {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId);
        const participant = await this.prisma.participant.findFirst({
          where: { id: participantId, meetingId },
        });
        if (!participant) {
          throw new NotFoundException(`Participant ${participantId} was not found.`);
        }
        const allParticipants = await this.prisma.participant.findMany({
          where: { meetingId },
          orderBy: { name: "asc" },
        });
        const index = allParticipants.findIndex((p) => p.id === participantId);
        const speakerLabel = `speaker-${index + 1}`;
        await this.prisma.participant.update({
          where: { id: participantId },
          data: { enrollmentStatus: "enrolled", speakerLabel },
        });
        return {
          participantId,
          speakerProfileId: uuidv7(),
          enrolledAt: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.logger.error(`Prisma enrollParticipant failed, falling back to Map: ${error}`);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    const participant = meeting.participants.find((item) => item.id === participantId);
    if (!participant) {
      throw new NotFoundException(`Participant ${participantId} was not found.`);
    }
    participant.enrollmentStatus = "enrolled";
    participant.speakerLabel = `speaker-${meeting.participants.indexOf(participant) + 1}`;
    return {
      participantId,
      speakerProfileId: uuidv7(),
      enrolledAt: new Date().toISOString(),
    };
  }

  async createUploadSession(auth: AuthContext, meetingId: string, dto: CreateUploadSessionDto) {
    const uploadId = uuidv7();
    const expectedParts = dto.expectedParts ?? 1;
    const objectKey = `${auth.orgId}/${meetingId}/${uploadId}/${dto.filename ?? "recording.m4a"}`;

    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId);
        await this.prisma.upload.create({
          data: {
            id: uploadId,
            meetingId,
            objectKey,
            expectedParts,
          },
        });
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.logger.error(`Prisma createUploadSession failed, falling back to Map: ${error}`);
        const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
        meeting.upload = { id: uploadId, objectKey, expectedParts };
      }
    } else {
      const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
      meeting.upload = { id: uploadId, objectKey, expectedParts };
    }

    let partUrls: Array<{ partNumber: number; url: string }>;

    if (this.s3Service.isAvailable) {
      partUrls = [];
      for (let i = 0; i < expectedParts; i++) {
        const partKey = expectedParts > 1 ? `${objectKey}.part${i + 1}` : objectKey;
        const presignedUrl = await this.s3Service.getPresignedUploadUrl(
          partKey,
          "application/octet-stream"
        );
        partUrls.push({
          partNumber: i + 1,
          url: presignedUrl ?? `/v1/meetings/${meetingId}/uploads/${uploadId}/file?partNumber=${i + 1}`,
        });
      }
    } else {
      partUrls = Array.from({ length: expectedParts }, (_, index) => ({
        partNumber: index + 1,
        url: `/v1/meetings/${meetingId}/uploads/${uploadId}/file?partNumber=${index + 1}`,
      }));
    }

    return {
      uploadId,
      chunkSizeBytes: 5 * 1024 * 1024,
      uploadUrl: `/v1/meetings/${meetingId}/uploads/${uploadId}/file`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      objectKey,
      expiresInSeconds: 900,
      partUrls,
    };
  }

  async uploadMeetingFile(
    auth: AuthContext,
    meetingId: string,
    uploadId: string,
    file: Express.Multer.File
  ) {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId);
        const upload = await this.prisma.upload.findFirst({
          where: { id: uploadId, meetingId },
        });
        if (!upload) {
          throw new NotFoundException(`Upload ${uploadId} was not found for meeting ${meetingId}.`);
        }

        if (this.s3Service.isAvailable) {
          const objectKey = upload.objectKey;
          await this.s3Service.putObject(
            objectKey,
            file.buffer,
            file.mimetype || "application/octet-stream"
          );
          await this.prisma.upload.update({
            where: { id: uploadId },
            data: {
              filePath: objectKey,
              fileName: file.originalname || "recording.m4a",
              fileSizeBytes: BigInt(file.buffer.byteLength),
              contentType: file.mimetype || "application/octet-stream",
            },
          });
          return {
            uploadId,
            fileName: file.originalname || "recording.m4a",
            bytesStored: file.buffer.byteLength,
          };
        }

        const stored = await this.uploadStorageService.saveUploadedFile({
          orgId: auth.orgId,
          meetingId,
          uploadId,
          originalName: file.originalname || "recording.m4a",
          bytes: file.buffer,
        });
        await this.prisma.upload.update({
          where: { id: uploadId },
          data: {
            filePath: stored.path,
            fileName: stored.fileName,
            fileSizeBytes: BigInt(stored.size),
            contentType: file.mimetype || "application/octet-stream",
          },
        });
        return {
          uploadId,
          fileName: stored.fileName,
          bytesStored: stored.size,
        };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.logger.error(`Prisma uploadMeetingFile failed, falling back to Map: ${error}`);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    if (!meeting.upload || meeting.upload.id !== uploadId) {
      throw new NotFoundException(`Upload ${uploadId} was not found for meeting ${meetingId}.`);
    }

    if (this.s3Service.isAvailable) {
      const objectKey = meeting.upload.objectKey;
      await this.s3Service.putObject(objectKey, file.buffer, file.mimetype || "application/octet-stream");
      meeting.upload.filePath = objectKey;
      meeting.upload.fileName = file.originalname || "recording.m4a";
      meeting.upload.fileSizeBytes = file.buffer.byteLength;
      meeting.upload.contentType = file.mimetype || "application/octet-stream";
      return {
        uploadId,
        fileName: meeting.upload.fileName,
        bytesStored: file.buffer.byteLength,
      };
    }

    const stored = await this.uploadStorageService.saveUploadedFile({
      orgId: auth.orgId,
      meetingId,
      uploadId,
      originalName: file.originalname || "recording.m4a",
      bytes: file.buffer,
    });
    meeting.upload.filePath = stored.path;
    meeting.upload.fileName = stored.fileName;
    meeting.upload.fileSizeBytes = stored.size;
    meeting.upload.contentType = file.mimetype || "application/octet-stream";
    return {
      uploadId,
      fileName: stored.fileName,
      bytesStored: stored.size,
    };
  }

  async completeUpload(
    auth: AuthContext,
    meetingId: string,
    uploadId: string,
    partEtags?: string[],
    durationSeconds?: number
  ) {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId);
        const upload = await this.prisma.upload.findFirst({
          where: { id: uploadId, meetingId },
        });
        if (!upload) {
          throw new NotFoundException(`Upload ${uploadId} was not found for meeting ${meetingId}.`);
        }
        await this.prisma.upload.update({
          where: { id: uploadId },
          data: { completedAt: new Date() },
        });

        const updateData: Record<string, unknown> = { status: "processing" };
        if (durationSeconds && durationSeconds > 0) {
          updateData.durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
        }
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: updateData,
        });

        let processingJobId = uuidv7();
        if (upload.filePath && this.workerClient.autoProcess) {
          processingJobId = await this.runWorkerPipelinePrisma(auth, meetingId, durationSeconds);
        }

        return {
          processingJobId,
          uploadId,
          partsReceived: (partEtags ?? []).length,
        };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.logger.error(`Prisma completeUpload failed, falling back to Map: ${error}`);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    if (!meeting.upload || meeting.upload.id !== uploadId) {
      throw new NotFoundException(`Upload ${uploadId} was not found for meeting ${meetingId}.`);
    }

    meeting.upload.completedAt = new Date().toISOString();
    if (durationSeconds && durationSeconds > 0) {
      meeting.upload.durationSeconds = durationSeconds;
      meeting.durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
    }
    meeting.status = "processing";

    let processingJobId = uuidv7();
    if (meeting.upload.filePath && this.workerClient.autoProcess) {
      processingJobId = await this.runWorkerPipeline(auth, meeting);
    }

    return {
      processingJobId,
      uploadId,
      partsReceived: (partEtags ?? []).length,
    };
  }

  async queueProcessing(auth: AuthContext, meetingId: string, force = false) {
    if (this.usePrisma) {
      try {
        const meeting = await this.getPrismaMeetingForOrg(auth.orgId, meetingId);
        if (meeting.status === "processing" && !force) {
          return { meetingId, status: "processing", accepted: false };
        }
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: "processing" },
        });

        const upload = await this.prisma.upload.findFirst({
          where: { meetingId },
          orderBy: { completedAt: "desc" },
        });

        const processingJobId = upload?.filePath
          ? await this.runWorkerPipelinePrisma(auth, meetingId)
          : uuidv7();

        return {
          processingJobId,
          meetingId,
          accepted: true,
        };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.logger.error(`Prisma queueProcessing failed, falling back to Map: ${error}`);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    if (meeting.status === "processing" && !force) {
      return { meetingId, status: "processing", accepted: false };
    }

    meeting.status = "processing";
    const processingJobId = meeting.upload?.filePath
      ? await this.runWorkerPipeline(auth, meeting)
      : uuidv7();

    return {
      processingJobId,
      meetingId,
      accepted: true,
    };
  }

  async startRecording(auth: AuthContext, meetingId: string) {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId);
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: "recording" },
        });
        return { jobId: uuidv7() };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.logger.error(`Prisma startRecording failed, falling back to Map: ${error}`);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    meeting.status = "recording";
    return { jobId: uuidv7() };
  }

  async getTranscript(auth: AuthContext, meetingId: string) {
    if (this.usePrisma) {
      try {
        const meeting = await this.getPrismaMeetingForOrg(auth.orgId, meetingId);
        const artifact = await this.prisma.meetingArtifact.findUnique({
          where: { meetingId },
        });
        if (artifact) {
          return {
            meetingId,
            status: meeting.status,
            segments: artifact.transcriptJson,
          };
        }
        throw new ConflictException("Transcript is not ready yet.");
      } catch (error) {
        if (error instanceof NotFoundException || error instanceof ConflictException) throw error;
        this.logger.error(`Prisma getTranscript failed, falling back to Map: ${error}`);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    if (meeting.artifact) {
      return {
        meetingId,
        status: meeting.status,
        segments: meeting.artifact.transcript,
      };
    }
    throw new ConflictException("Transcript is not ready yet.");
  }

  async getArtifacts(auth: AuthContext, meetingId: string) {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId);
        const artifact = await this.prisma.meetingArtifact.findUnique({
          where: { meetingId },
        });
        if (!artifact) {
          throw new ConflictException("Meeting artifacts are not ready yet.");
        }
        return this.prismaArtifactToContract(meetingId, artifact);
      } catch (error) {
        if (error instanceof NotFoundException || error instanceof ConflictException) throw error;
        this.logger.error(`Prisma getArtifacts failed, falling back to Map: ${error}`);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    if (!meeting.artifact) {
      throw new ConflictException("Meeting artifacts are not ready yet.");
    }
    return meeting.artifact;
  }

  async getMeetingStatus(auth: AuthContext, meetingId: string) {
    if (this.usePrisma) {
      try {
        const meeting = await this.prisma.meeting.findFirst({
          where: { id: meetingId, orgId: auth.orgId },
          include: { participants: true, uploads: { orderBy: { completedAt: "desc" }, take: 1 } },
        });
        if (!meeting) {
          throw new NotFoundException(`Meeting ${meetingId} was not found.`);
        }
        const upload = meeting.uploads[0];
        return {
          id: meeting.id,
          status: meeting.status,
          participants: meeting.participants.length,
          uploadCompletedAt: upload?.completedAt?.toISOString(),
          uploadFileName: upload?.fileName,
          processingReady: Boolean(upload?.filePath),
        };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.logger.error(`Prisma getMeetingStatus failed, falling back to Map: ${error}`);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    return {
      id: meeting.id,
      status: meeting.status,
      participants: meeting.participants.length,
      uploadCompletedAt: meeting.upload?.completedAt,
      uploadFileName: meeting.upload?.fileName,
      processingReady: Boolean(meeting.upload?.filePath),
    };
  }

  async saveActionItems(auth: AuthContext, meetingId: string, actionItems: ActionItem[]) {
    if (this.usePrisma) {
      try {
        await this.getPrismaMeetingForOrg(auth.orgId, meetingId);
        const existing = await this.prisma.meetingArtifact.findUnique({
          where: { meetingId },
        });
        if (existing) {
          await this.prisma.meetingArtifact.update({
            where: { meetingId },
            data: { actionItemsJson: JSON.parse(JSON.stringify(actionItems)) },
          });
        }
        return { meetingId, count: actionItems.length };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.logger.error(`Prisma saveActionItems failed, falling back to Map: ${error}`);
      }
    }

    const meeting = this.getMeetingForOrg(auth.orgId, meetingId);
    meeting.actionItems = actionItems;
    if (meeting.artifact) {
      meeting.artifact.actionItems = actionItems;
    }
    return { meetingId, count: actionItems.length };
  }

  /* ---------- In-memory helpers (Map fallback) ---------- */

  private createMeetingInMemory(auth: AuthContext, dto: CreateMeetingDto): Meeting {
    const meeting: StoredMeeting = {
      id: uuidv7(),
      title: dto.title,
      startsAt: dto.startsAt ?? new Date().toISOString(),
      durationMinutes: dto.durationMinutes ?? 60,
      language: "sr-RS",
      status: "draft",
      summary: undefined,
      actionItems: [],
      orgId: auth.orgId,
      createdAt: new Date().toISOString(),
      createdBy: auth.userId,
      participants: (dto.participantNames ?? []).map((name, index) => ({
        id: uuidv7(),
        meetingId: `pending-${index}`,
        name,
        enrollmentStatus: "pending",
      })),
    };

    meeting.participants = meeting.participants.map((participant) => ({
      ...participant,
      meetingId: meeting.id,
    }));

    this.meetings.set(meeting.id, meeting);
    return this.toMeetingResponse(meeting);
  }

  private getMeetingForOrg(orgId: string, meetingId: string): StoredMeeting {
    const meeting = this.meetings.get(meetingId);
    if (!meeting || meeting.orgId !== orgId) {
      throw new NotFoundException(`Meeting ${meetingId} was not found.`);
    }
    return meeting;
  }

  private toMeetingResponse(meeting: StoredMeeting): Meeting {
    return {
      id: meeting.id,
      title: meeting.title,
      startsAt: meeting.startsAt,
      durationMinutes: meeting.durationMinutes,
      language: meeting.language,
      status: meeting.status,
      participants: meeting.participants,
      summary: meeting.artifact?.summary ?? meeting.summary,
      actionItems: meeting.artifact?.actionItems ?? meeting.actionItems,
      artifact: meeting.artifact,
    };
  }

  /* ---------- Prisma helpers ---------- */

  private async getPrismaMeetingForOrg(orgId: string, meetingId: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, orgId },
    });
    if (!meeting) {
      throw new NotFoundException(`Meeting ${meetingId} was not found.`);
    }
    return meeting;
  }

  private prismaToMeetingResponse(meeting: {
    id: string;
    title: string;
    startsAt: Date;
    durationMinutes: number;
    language: string;
    status: string;
    summary: string | null;
    participants: Array<{
      id: string;
      meetingId: string;
      name: string;
      email: string | null;
      speakerLabel: string | null;
      enrollmentStatus: string;
    }>;
    artifact: {
      id: string;
      meetingId: string;
      summaryText: string;
      transcriptJson: unknown;
      minutesJson: unknown;
      decisionsJson: unknown;
      risksJson: unknown;
      openQuestionsJson: unknown;
      actionItemsJson: unknown;
      needsReview: boolean;
    } | null;
  }): Meeting {
    const participants: Participant[] = meeting.participants.map((p) => ({
      id: p.id,
      meetingId: p.meetingId,
      name: p.name,
      email: p.email ?? undefined,
      speakerLabel: p.speakerLabel ?? undefined,
      enrollmentStatus: p.enrollmentStatus as "pending" | "enrolled" | "needs_retry",
    }));

    let artifact: ContractArtifact | undefined;
    if (meeting.artifact) {
      artifact = this.prismaArtifactToContract(meeting.id, meeting.artifact);
    }

    return {
      id: meeting.id,
      title: meeting.title,
      startsAt: meeting.startsAt.toISOString(),
      durationMinutes: meeting.durationMinutes,
      language: meeting.language as "sr-RS",
      status: meeting.status as Meeting["status"],
      participants,
      summary: artifact?.summary ?? meeting.summary ?? undefined,
      actionItems: artifact?.actionItems,
      artifact,
    };
  }

  private prismaArtifactToContract(
    meetingId: string,
    artifact: {
      summaryText: string;
      transcriptJson: unknown;
      minutesJson: unknown;
      decisionsJson: unknown;
      risksJson: unknown;
      openQuestionsJson: unknown;
      actionItemsJson: unknown;
      needsReview: boolean;
    }
  ): ContractArtifact {
    return {
      meetingId,
      summary: artifact.summaryText,
      transcript: artifact.transcriptJson as ContractArtifact["transcript"],
      minutes: artifact.minutesJson as string[],
      decisions: artifact.decisionsJson as string[],
      risks: artifact.risksJson as string[],
      openQuestions: artifact.openQuestionsJson as string[],
      actionItems: artifact.actionItemsJson as ActionItem[],
      needsReview: artifact.needsReview,
    };
  }

  /* ---------- Worker pipeline (in-memory mode) ---------- */

  private async runWorkerPipeline(auth: AuthContext, meeting: StoredMeeting): Promise<string> {
    const upload = meeting.upload;
    if (!upload?.filePath) {
      return uuidv7();
    }

    const payload = this.buildWorkerPayload(auth, meeting.id, meeting.title, meeting.participants, upload);

    const result = await this.workerClient.processMeeting(payload);
    if (result) {
      this.applyWorkerResult(meeting, result);
    }
    return uuidv7();
  }

  /* ---------- Worker pipeline (Prisma mode) ---------- */

  private async runWorkerPipelinePrisma(
    auth: AuthContext,
    meetingId: string,
    durationSeconds?: number
  ): Promise<string> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { participants: true, uploads: { orderBy: { completedAt: "desc" }, take: 1 } },
    });
    if (!meeting) return uuidv7();

    const upload = meeting.uploads[0];
    if (!upload?.filePath) return uuidv7();

    const jobId = uuidv7();
    await this.prisma.processingJob.create({
      data: {
        id: jobId,
        meetingId,
        status: "pending",
      },
    });

    const storedUpload: StoredUpload = {
      id: upload.id,
      objectKey: upload.objectKey,
      expectedParts: upload.expectedParts,
      filePath: upload.filePath ?? undefined,
      fileName: upload.fileName ?? undefined,
      fileSizeBytes: upload.fileSizeBytes ? Number(upload.fileSizeBytes) : undefined,
      contentType: upload.contentType ?? undefined,
      durationSeconds: durationSeconds ?? meeting.durationMinutes * 60,
    };

    const contractParticipants: Participant[] = meeting.participants.map((p) => ({
      id: p.id,
      meetingId: p.meetingId,
      name: p.name,
      email: p.email ?? undefined,
      speakerLabel: p.speakerLabel ?? undefined,
      enrollmentStatus: p.enrollmentStatus as "pending" | "enrolled" | "needs_retry",
    }));

    const payload = this.buildWorkerPayload(
      auth,
      meeting.id,
      meeting.title,
      contractParticipants,
      storedUpload
    );

    // Fire-and-forget: run worker in background without awaiting
    this.executeWorkerPrisma(jobId, meetingId, contractParticipants, payload).catch((err) => {
      this.logger.error(`Background worker pipeline failed for meeting ${meetingId}: ${err}`);
    });

    return jobId;
  }

  private async executeWorkerPrisma(
    jobId: string,
    meetingId: string,
    participants: Participant[],
    payload: unknown
  ): Promise<void> {
    try {
      await this.prisma.processingJob.update({
        where: { id: jobId },
        data: { status: "running" },
      });

      const result = await this.workerClient.processMeeting(payload);
      if (result) {
        await this.applyWorkerResultPrisma(meetingId, participants, result);
        await this.prisma.processingJob.update({
          where: { id: jobId },
          data: {
            status: "completed",
            completedAt: new Date(),
            workerResultJson: JSON.parse(JSON.stringify(result)),
          },
        });
      } else {
        await this.prisma.processingJob.update({
          where: { id: jobId },
          data: { status: "completed", completedAt: new Date() },
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Worker pipeline error for job ${jobId}: ${errorMessage}`);
      try {
        await this.prisma.processingJob.update({
          where: { id: jobId },
          data: {
            status: "failed",
            completedAt: new Date(),
            errorMessage,
          },
        });
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { status: "failed" },
        });
      } catch (dbErr) {
        this.logger.error(`Failed to record worker error in DB: ${dbErr}`);
      }
    }
  }

  private buildWorkerPayload(
    auth: AuthContext,
    meetingId: string,
    title: string,
    participants: Participant[],
    upload: StoredUpload
  ) {
    return {
      meeting_id: meetingId,
      title,
      organizer_id: auth.userId,
      language: "sr",
      notes: `tenant=${auth.orgId}`,
      audio_source: {
        source_id: upload.id,
        uri: upload.filePath,
        duration_seconds: upload.durationSeconds ?? 3600,
        language: "sr",
      },
      participants: participants.map((participant) => ({
        participant_id: participant.id,
        display_name: participant.name,
        email: participant.email ?? null,
        locale: "sr-RS",
        speaker_label: participant.speakerLabel ?? null,
      })),
      enrollments: participants
        .filter((participant) => participant.enrollmentStatus === "enrolled")
        .map((participant) => ({
          participant_id: participant.id,
          enrollment_sample_id: `${participant.id}-enrollment`,
          sample_uri: upload.filePath,
          confidence: 0.75,
        })),
      chunk_seconds: 45,
      chunk_overlap_seconds: 5,
    };
  }

  /* ---------- Apply worker result (in-memory) ---------- */

  private applyWorkerResult(meeting: StoredMeeting, result: WorkerProcessingResult): void {
    const transcript = result.transcript_segments.map((segment) => {
      const participant = meeting.participants.find(
        (candidate) =>
          candidate.speakerLabel === segment.speaker_id || candidate.id === segment.speaker_id
      );

      return {
        id: segment.chunk_id,
        speakerLabel: segment.speaker_id,
        speakerName: participant?.name,
        startMs: Math.round(segment.start_seconds * 1000),
        endMs: Math.round(segment.end_seconds * 1000),
        text: segment.text,
        confidence: segment.confidence,
      };
    });

    const actionItems = result.artifact.action_items.map((item, index) => ({
      id: `${meeting.id}-action-${index + 1}`,
      title: item.task,
      owner: item.owner ?? undefined,
      dueDate: item.due_date ?? undefined,
      confidence: item.confidence,
    }));

    meeting.artifact = {
      meetingId: meeting.id,
      transcript,
      summary: result.artifact.summary,
      minutes: result.artifact.meeting_minutes
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean),
      decisions: result.artifact.decisions ?? [],
      risks: result.artifact.risks ?? [],
      openQuestions: result.artifact.next_steps ?? [],
      actionItems,
      needsReview: (result.warnings ?? []).length > 0,
    };
    const artifact = meeting.artifact;
    meeting.summary = artifact.summary;
    meeting.actionItems = actionItems;
    meeting.status = artifact.needsReview ? "needs_review" : "ready";
  }

  /* ---------- Apply worker result (Prisma) ---------- */

  private async applyWorkerResultPrisma(
    meetingId: string,
    participants: Participant[],
    result: WorkerProcessingResult
  ): Promise<void> {
    const transcript = result.transcript_segments.map((segment) => {
      const participant = participants.find(
        (candidate) =>
          candidate.speakerLabel === segment.speaker_id || candidate.id === segment.speaker_id
      );
      return {
        id: segment.chunk_id,
        speakerLabel: segment.speaker_id,
        speakerName: participant?.name,
        startMs: Math.round(segment.start_seconds * 1000),
        endMs: Math.round(segment.end_seconds * 1000),
        text: segment.text,
        confidence: segment.confidence,
      };
    });

    const actionItems = result.artifact.action_items.map((item, index) => ({
      id: `${meetingId}-action-${index + 1}`,
      title: item.task,
      owner: item.owner ?? undefined,
      dueDate: item.due_date ?? undefined,
      confidence: item.confidence,
    }));

    const minutes = result.artifact.meeting_minutes
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    const needsReview = (result.warnings ?? []).length > 0;
    const status = needsReview ? "needs_review" : "ready";

    await this.prisma.meetingArtifact.upsert({
      where: { meetingId },
      create: {
        id: uuidv7(),
        meetingId,
        summaryText: result.artifact.summary,
        transcriptJson: JSON.parse(JSON.stringify(transcript)),
        minutesJson: JSON.parse(JSON.stringify(minutes)),
        decisionsJson: JSON.parse(JSON.stringify(result.artifact.decisions ?? [])),
        risksJson: JSON.parse(JSON.stringify(result.artifact.risks ?? [])),
        openQuestionsJson: JSON.parse(JSON.stringify(result.artifact.next_steps ?? [])),
        actionItemsJson: JSON.parse(JSON.stringify(actionItems)),
        needsReview,
      },
      update: {
        summaryText: result.artifact.summary,
        transcriptJson: JSON.parse(JSON.stringify(transcript)),
        minutesJson: JSON.parse(JSON.stringify(minutes)),
        decisionsJson: JSON.parse(JSON.stringify(result.artifact.decisions ?? [])),
        risksJson: JSON.parse(JSON.stringify(result.artifact.risks ?? [])),
        openQuestionsJson: JSON.parse(JSON.stringify(result.artifact.next_steps ?? [])),
        actionItemsJson: JSON.parse(JSON.stringify(actionItems)),
        needsReview,
      },
    });

    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: {
        status,
        summary: result.artifact.summary,
      },
    });
  }
}
