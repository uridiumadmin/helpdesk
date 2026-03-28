import { IsEmail } from "class-validator";

export class ShareMeetingDto {
  @IsEmail()
  email!: string;
}
