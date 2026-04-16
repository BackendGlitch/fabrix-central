# Customer Printer Discovery API

## Overview

This document describes the implementation of the `GET /customer/printers` endpoint for customer-facing printer discovery and visibility (CS-07).

## Endpoint

### GET /customer/printers

**Authorization**: `CUSTOMER` role (JWT required)

**Path**: `/customer/printers`

**Request**:
```bash
curl -H "Authorization: Bearer <customer-jwt-token>" \
  http://localhost:3000/customer/printers
```

**Response**: `200 OK`
```json
{
  "printers": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "nodeId": "printer-001",
      "displayName": "Bambu Lab X1",
      "status": "online",
      "activityState": "idle",
      "lastHeartbeatAt": "2026-04-16T10:30:00Z",
      "options": {
        "model": "X1",
        "capabilities": ["print", "scan"],
        "maxBedTemp": 110
      }
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "nodeId": "printer-002",
      "displayName": "Bambu Lab P1S",
      "status": "online",
      "activityState": "working",
      "lastHeartbeatAt": "2026-04-16T10:29:45Z",
      "options": null
    }
  ],
  "count": 2
}
```

## Response DTOs

### PrinterDto
Represents a single available printer.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique printer/agent ID |
| `nodeId` | string | Manufacturer-assigned node identifier |
| `displayName` | string | Human-friendly printer name |
| `status` | `'online' \| 'offline'` | Current connectivity status |
| `activityState` | `'idle' \| 'working' \| 'offline'` | Activity state (only includes idle/working when online) |
| `lastHeartbeatAt` | Date \| null | Timestamp of last heartbeat from agent |
| `options` | object \| undefined | Printer-specific metadata (capabilities, models, etc.) |

### ListCustomerPrintersResponseDto
Wraps the list of available printers.

| Field | Type | Description |
|-------|------|-------------|
| `printers` | PrinterDto[] | Array of available printers |
| `count` | number | Total count of returned printers |

## Filtering Logic

The endpoint returns **only**:
1. ✅ Agents with `status = 'active'` (not revoked)
2. ✅ Agents that are currently **online** (have active WebSocket connections)

The endpoint **excludes**:
- ❌ Revoked/inactive agents
- ❌ Offline/disconnected agents
- ❌ Agents without active WebSocket connections

## Options Metadata

The `options` field contains printer-specific metadata stored in the `agent_sessions.metadata` JSONB column. This allows agents to communicate capabilities and configuration details such as:

- Printer model and version
- Supported features (print, scan, etc.)
- Temperature ranges
- Material/filament compatibility
- Custom configuration

The system fetches the most recent active (non-revoked) session for each agent to retrieve this metadata.

## Error Responses

### 401 Unauthorized
Missing or invalid JWT token.
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### 403 Forbidden
User role is not `CUSTOMER`.
```json
{
  "statusCode": 403,
  "message": "Forbidden"
}
```

## Implementation Details

### Module Structure
- **Customer Module**: `src/customer/customer.module.ts`
- **Controller**: `src/customer/customer.controller.ts`
- **Service**: `src/customer/customer.service.ts`
- **DTOs**: `src/customer/dto/printer.dto.ts`

### Authentication & Authorization
- Uses `JwtAuthGuard` to validate JWT tokens
- Uses `RolesGuard` with `@Roles('CUSTOMER')` decorator to enforce role-based access control

### Database Queries
1. **Fetch active agents**: Queries all agents with `status = 'active'`
2. **Runtime state**: Fetches connectivity status from `AgentGateway` in-memory state
3. **Options metadata**: Queries the most recent non-revoked session's metadata

### Performance Considerations
- Single database query to fetch all active agents
- For each online agent, performs an additional query for session metadata
- Runtime state lookups are O(1) from in-memory gateway state
- No n+1 queries for agent status (uses gateway state)

## Testing

E2E tests are provided in `test/customer-discovery.e2e-spec.ts`:

```bash
pnpm test:e2e -- customer-discovery.e2e-spec
```

Test cases:
- ✅ Unauthenticated requests return 401
- ✅ OWNER role requests return 403
- ✅ CUSTOMER role receives 200 with printers list
- ✅ Response structure matches PrinterDto schema

## Related Endpoints

- `GET /agent/pair/owner/agents` - Owner's printer list (includes offline agents)
- `POST /agent/pair/:code/approve` - Pairing flow
- `DELETE /agent/pair/owner/agents/:agentId` - Revoke printer access
