import { IsArray, IsNumber, IsOptional, IsString, Min } from "class-validator";

export class CompleteUploadDto {
  @IsString()
  uploadId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  partEtags?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  durationSeconds?: number;
}
