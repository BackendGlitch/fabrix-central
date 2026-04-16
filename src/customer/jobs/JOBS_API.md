# Customer Jobs API (CS-08)

## Overview

This document describes the implementation of the customer jobs API for order management and tracking (CS-08).

## Endpoints

### 1. POST /customer/jobs/upload

**Authorization**: `CUSTOMER` role (JWT required)

**Description**: Upload an STL file for 3D printing

**Request**:
```bash
curl -X POST \
  -H "Authorization: Bearer <customer-jwt-token>" \
  -F "file=@model.stl" \
  http://localhost:3000/customer/jobs/upload
```

**Response**: `201 Created`
```json
{
  "file": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "filename": "1713273600000-abc123.stl",
    "originalName": "model.stl",
    "mimeType": "application/sla",
    "size": "2097152",
    "uploadedAt": "2026-04-16T10:30:00Z"
  },
  "message": "File uploaded successfully"
}
```

**Validation**:
- ✅ Only `.stl` files (MIME: `application/sla`, `model/stl`, `application/x-stl`)
- ✅ Max file size: 500MB
- ✅ Files stored with SHA256 checksum for deduplication

### 2. POST /customer/jobs

**Authorization**: `CUSTOMER` role (JWT required)

**Description**: Create a new print job/order

**Request**:
```bash
curl -X POST \
  -H "Authorization: Bearer <customer-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "550e8400-e29b-41d4-a716-446655440000",
    "name": "My Custom Part",
    "description": "Replacement bracket with 2mm tolerance",
    "metadata": {
      "infill": 20,
      "supportType": "tree",
      "material": "PLA"
    }
  }' \
  http://localhost:3000/customer/jobs
```

**Response**: `201 Created`
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "My Custom Part",
  "description": "Replacement bracket with 2mm tolerance",
  "status": "pending",
  "fileId": "550e8400-e29b-41d4-a716-446655440000",
  "customerId": "550e8400-e29b-41d4-a716-446655440002",
  "printerId": null,
  "createdAt": "2026-04-16T10:30:00Z",
  "updatedAt": "2026-04-16T10:30:00Z"
}
```

**Job Status States**:
- `pending` - Job created, awaiting printer assignment
- `queued` - Job assigned to printer, in queue
- `printing` - Currently printing
- `completed` - Print finished successfully
- `failed` - Print failed
- `cancelled` - Job cancelled by customer or system

### 3. GET /customer/jobs/me

**Authorization**: `CUSTOMER` role (JWT required)

**Description**: List all jobs for authenticated customer

**Request**:
```bash
curl -H "Authorization: Bearer <customer-jwt-token>" \
  http://localhost:3000/customer/jobs/me
```

**Response**: `200 OK`
```json
{
  "jobs": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "name": "My Custom Part",
      "description": "Replacement bracket with 2mm tolerance",
      "status": "pending",
      "fileId": "550e8400-e29b-41d4-a716-446655440000",
      "customerId": "550e8400-e29b-41d4-a716-446655440002",
      "printerId": null,
      "file": {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "filename": "1713273600000-abc123.stl",
        "originalName": "model.stl",
        "mimeType": "application/sla",
        "size": "2097152",
        "uploadedAt": "2026-04-16T10:30:00Z"
      },
      "metadata": {
        "infill": 20,
        "supportType": "tree",
        "material": "PLA"
      },
      "startedAt": null,
      "completedAt": null,
      "createdAt": "2026-04-16T10:30:00Z",
      "updatedAt": "2026-04-16T10:30:00Z"
    }
  ],
  "count": 1
}
```

### 4. GET /customer/jobs/:id

**Authorization**: `CUSTOMER` role (JWT required)

**Description**: Get details for a specific job with ownership verification

**Request**:
```bash
curl -H "Authorization: Bearer <customer-jwt-token>" \
  http://localhost:3000/customer/jobs/550e8400-e29b-41d4-a716-446655440001
```

**Response**: `200 OK`
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "My Custom Part",
  "description": "Replacement bracket with 2mm tolerance",
  "status": "pending",
  "fileId": "550e8400-e29b-41d4-a716-446655440000",
  "customerId": "550e8400-e29b-41d4-a716-446655440002",
  "printerId": null,
  "file": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "filename": "1713273600000-abc123.stl",
    "originalName": "model.stl",
    "mimeType": "application/sla",
    "size": "2097152",
    "uploadedAt": "2026-04-16T10:30:00Z"
  },
  "metadata": {
    "infill": 20,
    "supportType": "tree",
    "material": "PLA"
  },
  "startedAt": null,
  "completedAt": null,
  "createdAt": "2026-04-16T10:30:00Z",
  "updatedAt": "2026-04-16T10:30:00Z"
}
```

**Ownership Verification**:
- ✅ Returns `404 Not Found` if job doesn't exist
- ✅ Returns `404 Not Found` if job belongs to different customer (permission denied)
- ✅ Only authenticated customer can access their own jobs

## Request/Response DTOs

### CreateJobRequestDto
```typescript
{
  fileId: string;           // Required: UUID of uploaded STL file
  name: string;             // Required: Job display name
  description?: string;     // Optional: Job description
  metadata?: object;        // Optional: Print settings (infill, material, etc.)
}
```

### JobDetailDto
```typescript
{
  id: string;                              // Job UUID
  name: string;                            // Job name
  description: string | null;              // Job description
  status: string;                          // Current job status
  fileId: string;                          // Referenced file UUID
  customerId: string;                      // Owner UUID
  printerId: string | null;                // Assigned printer (if any)
  file: JobFileDto;                        // Embedded file details
  metadata: Record<string, unknown> | null; // Print settings
  startedAt: Date | null;                  // Print start time
  completedAt: Date | null;                // Print completion time
  createdAt: Date;                         // Job creation timestamp
  updatedAt: Date;                         // Last update timestamp
}
```

### JobFileDto
```typescript
{
  id: string;          // File UUID
  filename: string;    // Storage filename
  originalName: string; // Original filename
  mimeType: string;    // MIME type
  size: string;        // File size in bytes
  uploadedAt: Date;    // Upload timestamp
}
```

## Error Responses

### 400 Bad Request
- Missing file in upload
- Unsupported file type (not STL)
- File exceeds 500MB size limit
- Invalid request body

```json
{
  "statusCode": 400,
  "message": "Only STL files are allowed"
}
```

### 401 Unauthorized
Missing or invalid JWT token

```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### 403 Forbidden
User role is not `CUSTOMER`

```json
{
  "statusCode": 403,
  "message": "Forbidden"
}
```

### 404 Not Found
- File not found when creating job
- Job not found
- Job belongs to different customer

```json
{
  "statusCode": 404,
  "message": "Job not found"
}
```

## Database Schema

### job_files Table
Stores uploaded STL files with metadata and checksums.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `filename` | varchar(255) | Storage filename (timestamped) |
| `original_name` | varchar(255) | User-provided filename |
| `mime_type` | varchar(50) | File MIME type |
| `size` | text | File size in bytes |
| `storage_path` | varchar(512) | Disk storage path |
| `checksum` | varchar(64) | SHA256 hash for deduplication |
| `uploaded_at` | timestamp | Upload time |
| `created_at` | timestamp | Record creation time |

### jobs Table
Stores print jobs/orders created by customers.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `customer_id` | UUID | FK to users (cascade delete) |
| `file_id` | UUID | FK to job_files (cascade delete) |
| `printer_id` | UUID | FK to agents (set null on delete) |
| `name` | varchar(255) | Job display name |
| `description` | text | Job description |
| `status` | job_status enum | Current status (default: pending) |
| `metadata` | jsonb | Print settings, capabilities |
| `started_at` | timestamp | Print start time |
| `completed_at` | timestamp | Print completion time |
| `created_at` | timestamp | Job creation time |
| `updated_at` | timestamp | Last modification time |

**Indexes**:
- `jobs_customer_id_idx` - Query jobs by customer
- `jobs_printer_id_idx` - Query jobs by printer
- `jobs_status_idx` - Filter by status
- `jobs_created_at_idx` - Sort by creation time

## Implementation Details

### Module Structure
```
src/customer/
  customer.module.ts
  customer.controller.ts
  customer.service.ts
  jobs/
    jobs.module.ts
    jobs.controller.ts
    jobs.service.ts
    dto/
      job.dto.ts
      index.ts
```

### Authentication & Authorization
- Uses `JwtAuthGuard` to validate JWT tokens
- Uses `RolesGuard` with `@Roles('CUSTOMER')` decorator
- Ownership checks in service layer (customer_id verification)

### File Upload
- Handled via `@UseInterceptors(FileInterceptor('file'))`
- Files stored on disk with timestamped filenames
- SHA256 checksums for deduplication and integrity checking
- Max 500MB file size

### Database Queries
1. **Upload**: Single insert into job_files
2. **Create Job**: Single insert into jobs
3. **List Jobs**: Single query with JOIN to fetch file details
4. **Get Job**: Single query with WHERE (customer_id, job_id) and ownership check

## Future Enhancements

- File deduplication using checksums
- Printer assignment algorithm
- Job status webhooks/events
- Print time/cost estimation
- File slicing and preview generation
- Job history and audit logging
- Batch job creation
