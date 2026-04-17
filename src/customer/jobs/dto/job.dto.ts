import { IsUUID, IsString, IsOptional, IsObject } from 'class-validator';

export class JobFileDto {
  id!: string;
  filename!: string;
  originalName!: string;
  mimeType!: string;
  size!: string;
  uploadedAt!: Date;
}

export class UploadSTLResponseDto {
  file!: JobFileDto;
  message!: string;
}

export class CreateJobRequestDto {
  @IsUUID()
  fileId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateJobResponseDto {
  id!: string;
  name!: string;
  description!: string | null;
  status!: string;
  fileId!: string;
  customerId!: string;
  printerId!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class JobDetailDto {
  id!: string;
  name!: string;
  description!: string | null;
  status!: string;
  fileId!: string;
  customerId!: string;
  customerName?: string | null;
  printerId!: string | null;
  printerDisplayName?: string | null;
  file!: JobFileDto;
  metadata!: Record<string, unknown> | null;
  startedAt!: Date | null;
  completedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class ListJobsResponseDto {
  jobs!: JobDetailDto[];
  count!: number;
}
