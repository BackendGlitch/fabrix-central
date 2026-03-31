import { IsNotEmpty, IsString } from 'class-validator';

export class AgentRefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
