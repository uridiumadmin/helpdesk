import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";

export class AddParticipantDto {
  @IsString()
  @MaxLength(120)
  displayName!: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
