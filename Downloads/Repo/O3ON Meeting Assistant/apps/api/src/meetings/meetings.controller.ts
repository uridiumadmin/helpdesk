import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseFilePipeBuilder,
  Post,
  Put,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ActionItem } from "@o3on/contracts";
import { CurrentAuth } from "../security/auth-context.decorator";
import { AuthContext } from "../security/auth-context";
import { AddParticipantDto } from "./dto/add-participant.dto";
import { CompleteUploadDto } from "./dto/complete-upload.dto";
import { CreateMeetingDto } from "./dto/create-meeting.dto";
import { CreateUploadSessionDto } from "./dto/create-upload-session.dto";
import { ProcessMeetingDto } from "./dto/process-meeting.dto";
import { MeetingsService } from "./meetings.service";

@Controller("meetings")
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Get()
  listMeetings(@CurrentAuth() auth: AuthContext) {
    return this.meetingsService.listMeetings(auth);
  }

  @Post()
  createMeeting(@CurrentAuth() auth: AuthContext, @Body() dto: CreateMeetingDto) {
    return this.meetingsService.createMeeting(auth, dto);
  }

  @Post(":meetingId/recording/start")
  startRecording(@CurrentAuth() auth: AuthContext, @Param("meetingId") meetingId: string) {
    return this.meetingsService.startRecording(auth, meetingId);
  }

  @Post(":meetingId/participants")
  addParticipant(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Body() dto: AddParticipantDto
  ) {
    return this.meetingsService.addParticipant(auth, meetingId, dto);
  }

  @Post(":meetingId/participants/:participantId/enroll")
  enrollParticipant(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Param("participantId") participantId: string
  ) {
    return this.meetingsService.enrollParticipant(auth, meetingId, participantId);
  }

  @Post(":meetingId/uploads/session")
  createUploadSession(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Body() dto: CreateUploadSessionDto
  ) {
    return this.meetingsService.createUploadSession(auth, meetingId, dto);
  }

  @Post(":meetingId/uploads/:uploadId/file")
  @UseInterceptors(FileInterceptor("file"))
  uploadMeetingFile(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Param("uploadId") uploadId: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 1024 * 1024 * 512 })
        .build({ fileIsRequired: true })
    )
    file: Express.Multer.File
  ) {
    const looksLikeMedia =
      /^(audio|video)\//.test(file.mimetype || "") ||
      /\.(m4a|mp3|wav|aac|ogg|mp4|mov|webm)$/i.test(file.originalname || "");
    if (!looksLikeMedia) {
      throw new BadRequestException("Only audio or video uploads are allowed.");
    }
    return this.meetingsService.uploadMeetingFile(auth, meetingId, uploadId, file);
  }

  @Post(":meetingId/uploads/complete")
  completeUpload(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Body() dto: CompleteUploadDto
  ) {
    return this.meetingsService.completeUpload(
      auth,
      meetingId,
      dto.uploadId,
      dto.partEtags,
      dto.durationSeconds
    );
  }

  @Post(":meetingId/process")
  processMeeting(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Body() dto: ProcessMeetingDto
  ) {
    return this.meetingsService.queueProcessing(auth, meetingId, dto.force);
  }

  @Get(":meetingId/status")
  getStatus(@CurrentAuth() auth: AuthContext, @Param("meetingId") meetingId: string) {
    return this.meetingsService.getMeetingStatus(auth, meetingId);
  }

  @Get(":meetingId/transcript")
  getTranscript(@CurrentAuth() auth: AuthContext, @Param("meetingId") meetingId: string) {
    return this.meetingsService.getTranscript(auth, meetingId);
  }

  @Get(":meetingId/artifacts")
  getArtifacts(@CurrentAuth() auth: AuthContext, @Param("meetingId") meetingId: string) {
    return this.meetingsService.getArtifacts(auth, meetingId);
  }

  @Put(":meetingId/action-items")
  saveActionItems(
    @CurrentAuth() auth: AuthContext,
    @Param("meetingId") meetingId: string,
    @Body("items") items: ActionItem[]
  ) {
    return this.meetingsService.saveActionItems(auth, meetingId, items);
  }
}
