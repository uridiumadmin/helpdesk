import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateUploadSessionDto {
  @IsOptional()
  @IsString()
  contentType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedParts?: number;

  @IsOptional()
  @IsString()
  filename?: string;
}
