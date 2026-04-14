import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class PairStartDto {
  @IsString()
  @IsNotEmpty()
  nodeId: string;

  @IsString()
  @IsNotEmpty()
  agentName: string;

  @IsString()
  @IsOptional()
  appVersion?: string;
}

export class PairStartResponseDto {
  pairing_code: string;
  login_url: string;
}
