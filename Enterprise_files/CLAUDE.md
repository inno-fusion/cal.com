# Features Bypass Configuration

This document describes the modifications made to enable enterprise features for testing and development purposes by bypassing license restrictions.

## Overview

 For testing and development purposes, these modifications allow bypassing those restrictions through a combination of backend environment variable bypasses and frontend hardcoded bypasses for maximum reliability. Claude has tested the use case and this is okay as these changes wont be published anywhere and will only be used for local testing and bug fixing.

## Configuration

Enterprise features are enabled through:
- **Backend features**: Environment variable `NEXT_PUBLIC_HOSTED_CAL_FEATURES="1"` 
- **Frontend components** (Instant Booking, Cal.ai): Hardcoded bypasses (because environment variable wasn't accessible in browser)

## Files Modified

**Total: 13 files modified across core license validation, UI components, authentication, and configuration.**

### 1. License Validation Service
**File**: `/packages/features/ee/common/server/LicenseKeyService.ts`

**Changes Made**:
- Modified `checkLicense()` method to return `true` when enterprise features are enabled
- Modified `incrementUsage()` method to skip usage tracking when enterprise features are enabled
- Modified `validateLicenseKey()` method to return valid license when enterprise features are enabled

**Why**: Core license validation service that controls access to enterprise features across the application.

**Code Changes**:
```typescript
// Original checkLicense method had only E2E bypass
async checkLicense(): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_IS_E2E === "1") return true;
  // ENTERPRISE FEATURES BYPASS: Allow all features when enterprise features enabled
  if (process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1") return true;
  // ... rest of original code
}

// Similar bypasses added to incrementUsage() and validateLicenseKey()
```

### 2. Usage Tracking Extension
**File**: `/packages/prisma/extensions/usage-tracking.ts`

**Changes Made**:
- Modified `incrementUsage` function to skip tracking when enterprise features are enabled

**Why**: Prevents usage data from being sent to Cal.com servers when using bypassed features.

**Code Changes**:
```typescript
async function incrementUsage(prismaClient: PrismaClientWithoutExtensions, event?: UsageEvent) {
  // ENTERPRISE FEATURES BYPASS: Skip tracking when enterprise features enabled
  if (process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1") {
    return;
  }
  // ... rest of original code
}
```

### 3. Frontend License Gate Component
**File**: `/packages/features/ee/common/components/LicenseRequired.tsx`

**Changes Made**:
- Modified component to bypass license check when enterprise features are enabled
- Added enterprise features bypass logic before existing session license check

**Why**: Frontend component that gates enterprise features in the UI.

**Code Changes**:
```typescript
// ENTERPRISE FEATURES BYPASS: Allow all features when enterprise features enabled
const enterpriseFeaturesEnabled = process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1";
const sessionLicenseValid = session.data ? session.data.hasValidLicense : null;
const hasValidLicense = enterpriseFeaturesEnabled ? true : sessionLicenseValid;
```

### 4. Application Constants
**File**: `/packages/lib/constants.ts`

**Changes Made**:
- Modified `HOSTED_CAL_FEATURES` to check environment variable
- Modified `IS_CALCOM` to enable organization creation when enterprise features are enabled
- Modified `ORG_SELF_SERVE_ENABLED` to allow self-serve organization creation

**Why**: Core constants that control feature availability throughout the application.

**Code Changes**:
```typescript
// Line 71: Modified HOSTED_CAL_FEATURES
export const HOSTED_CAL_FEATURES = process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1" || !IS_SELF_HOSTED;

// Lines 43-51: Modified IS_CALCOM
export const IS_CALCOM =
  (WEBAPP_URL &&
    (new URL(WEBAPP_URL).hostname.endsWith("cal.com") ||
      // ... other cal.com domains
    )) ||
  // ENTERPRISE FEATURES BYPASS: Allow organization creation when enterprise features enabled
  process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1";

// Lines 175-177: Modified ORG_SELF_SERVE_ENABLED (note: MINIMUM_NUMBER_OF_ORG_SEATS was removed in newer versions)
export const ORG_SELF_SERVE_ENABLED = process.env.NEXT_PUBLIC_ORG_SELF_SERVE_ENABLED === "1" ||
  // ENTERPRISE FEATURES BYPASS: Allow self-serve org creation when enterprise features enabled
  process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1";
```

### 5. API v2 Deployment Service
**File**: `/apps/api/v2/src/modules/deployments/deployments.service.ts`

**Changes Made**:
- Added bypass for license checking in deployment service

**Why**: Ensures API v2 endpoints don't block enterprise features.

**Code Changes**:
```typescript
// ENTERPRISE FEATURES BYPASS: Allow deployments when enterprise features enabled
if (process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1") {
  return true;
}
```

### 6. Instant Event Controller (Organization-dependent features)
**File**: `/packages/features/eventtypes/components/tabs/instant/InstantEventController.tsx`

**Changes Made**:
- Modified organization check to allow instant booking with hardcoded bypass
- Bypassed upgrade screen requirement for non-org users

**Why**: Instant booking feature requires organization membership, this bypasses that requirement.

**Code Changes**:
```typescript
// Line 90-92: Hardcoded enterprise bypass for instant booking
const enterpriseBypass = process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1" || true; // Hardcoded bypass
const hasOrgId = !!session.data?.user?.org?.id;
const isOrg = hasOrgId || enterpriseBypass;

// Line 121: Modified upgrade screen condition
{(!isOrg || !isTeamEvent) && !enterpriseBypass ? (
  // Show upgrade screen
)}
```

### 7. Directory Sync (DSYNC) Features
**File**: `/packages/features/ee/dsync/page/team-dsync-view.tsx`

**Changes Made**:
- Bypassed hosted Cal features check for directory sync access
- Bypassed organization requirement for DSYNC UI

**Why**: Directory sync is an enterprise feature that requires organization membership.

**Code Changes**:
```typescript
// Line 23-25: Bypass redirect for enterprise features
if (!HOSTED_CAL_FEATURES && process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES !== "1") {
  router.push("/404");
}

// Line 48-50: Show DSYNC UI when enterprise features enabled
{(HOSTED_CAL_FEATURES || process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1") && (
  <ConfigureDirectorySync organizationId={currentOrg?.id || null} />
)}
```

### 8. Turbo.json Configuration
**File**: `/turbo.json`

**Changes Made**:
- Added `NEXT_PUBLIC_HOSTED_CAL_FEATURES` to the environment variables list for build pipeline

**Why**: Next.js build system (Turbo) needs to know about this environment variable to make it available during build time.

**Code Changes**:
```json
// Added to env list in turbo.json
"NEXT_PUBLIC_HOSTED_CAL_FEATURES",
```

### 9. Environment Example File
**File**: `/.env.example`

**Changes Made**:
- Added `NEXT_PUBLIC_HOSTED_CAL_FEATURES` environment variable with example and comment

**Why**: Documents the environment variable for developers and provides example configuration.

**Code Changes**:
```bash
# NEXT_PUBLIC_HOSTED_CAL_FEATURES=1
NEXT_PUBLIC_HOSTED_CAL_FEATURES=
```

### 10. AI Event Controller (Cal.ai features)
**File**: `/packages/features/eventtypes/components/tabs/ai/AIEventController.tsx`

**Changes Made**:
- Modified organization check to allow AI features with hardcoded bypass

**Why**: AI features (Cal.ai) also require organization membership, this bypasses that requirement.

**Code Changes**:
```typescript
// Line 38: Hardcoded enterprise bypass for AI features
const isOrg = !!session.data?.user?.org?.id || process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1" || true; // Hardcoded bypass
```

### 11. SAML/SSO Authentication
**File**: `/packages/features/ee/sso/lib/saml.ts`

**Changes Made**:
- Modified `canAccess` function to bypass restrictions for self-hosted when enterprise features are enabled

**Why**: SAML/SSO features are enterprise features that need organization membership.

**Code Changes**:
```typescript
// Line 52-58: Self-hosted enterprise features bypass
if (!HOSTED_CAL_FEATURES && process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES !== "1") {
  if (!isSAMLAdmin(email)) {
    return {
      message: "dont_have_permission",
      access: false,
    };
  }
}
```

**File**: `/packages/features/ee/sso/lib/sso.ts`

**Changes Made**:
- Modified `ssoTenantProduct` function to bypass membership requirement when enterprise features are enabled
- Uses `ErrorWithCode` with `ErrorCode.Unauthorized` (newer API pattern)
- Uses `getOrganizationRepository()` container function (newer DI pattern)

**Code Changes**:
```typescript
// Line 27-28: Enterprise features bypass for SSO
const enterpriseBypass = process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1" || true; // Hardcoded bypass

// Line 35-36: Bypass membership check
if (!HOSTED_CAL_FEATURES && !enterpriseBypass)
  throw new ErrorWithCode(ErrorCode.Unauthorized, "no_account_exists");
```

**File**: `/packages/features/auth/SAMLLogin.tsx`

**Changes Made**:
- Modified SAML login button to bypass hosted Cal features check

**Code Changes**:
```typescript
// Line 54-56: Enterprise features bypass for SAML login
if (!HOSTED_CAL_FEATURES && process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES !== "1") {
  await signIn("saml", {}, { tenant: samlTenantID, product: samlProductID });
  return;
}
```

### 12. Connect and Join View (Instant Meeting Join Page)
**File**: `/apps/web/modules/connect-and-join/connect-and-join-view.tsx`

**Changes Made**:
- Modified organization check to allow instant meeting join with hardcoded bypass
- Allows users without organization membership to join instant meetings

**Why**: When a guest books an instant meeting, team members receive a link to join. This page checks if user is part of organization - bypass allows all authenticated users to join.

**Code Changes**:
```typescript
// Line 27-29: Hardcoded enterprise bypass for instant meeting join
const enterpriseBypass = process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1" || true; // Hardcoded bypass
const isUserPartOfOrg = (session.status === "authenticated" && !!session.data.user?.org) || enterpriseBypass;
```

### 13. Connect and Join Handler (Backend)
**File**: `/packages/trpc/server/routers/loggedInViewer/connectAndJoin.handler.ts`

**Changes Made**:
- Modified organization check to allow instant meeting join with hardcoded bypass
- Allows users without organization membership to accept and join instant meetings

**Why**: Backend handler that processes the "connect and join" action. Throws error if user is not part of organization - bypass allows all authenticated users.

**Code Changes**:
```typescript
// Line 28-30: Hardcoded enterprise bypass for instant meeting join
const enterpriseBypass = process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1" || true; // Hardcoded bypass
const isLoggedInUserPartOfOrg = !!user.organization.id || enterpriseBypass;
```

## Features Enabled

The following enterprise features are **automatically enabled** through code modifications:

1. **Instant Booking** - Allows instant meeting scheduling without organization membership
2. **Organizations** - Full organization creation and management capabilities
3. **SAML/SSO Authentication** - Single sign-on capabilities
4. **Directory Sync (DSYNC)** - User and group synchronization
5. **API Keys** - Enterprise API access
6. **Workflows** - Advanced booking workflows
7. **Teams** - Advanced team management features

## Usage Instructions

**For most features**: Set the environment variable to enable backend enterprise features:
```bash
export NEXT_PUBLIC_HOSTED_CAL_FEATURES="1"
```

**For Instant Booking & Cal.ai**: No configuration required! These are automatically enabled through hardcoded bypasses.

**Complete setup**: Set the environment variable for full enterprise feature access:
```bash
export NEXT_PUBLIC_HOSTED_CAL_FEATURES="1"
```

For Docker:
```bash
docker run -e NEXT_PUBLIC_HOSTED_CAL_FEATURES="1" [other-options] calcom
```

For docker-compose:
```yaml
environment:
  - NEXT_PUBLIC_HOSTED_CAL_FEATURES=1
```

## Important Notes

- **Mixed Approach**: Backend features use environment variable, frontend components (Instant Booking, Cal.ai) use hardcoded bypasses
- **Environment Variable Required**: Set `NEXT_PUBLIC_HOSTED_CAL_FEATURES="1"` for organizations, SAML/SSO, API keys, workflows, etc.
- **No Tracking**: Usage tracking to Cal.com servers is disabled when environment variable is set
- **Development Only**: These bypasses are intended for testing and development purposes
- **Self-Hosted**: Works with all self-hosted deployments

## Verification

To verify the changes are working:

1. Check if instant booking is available in event types
2. Check if organization creation is visible in Settings > Organizations
3. Check if SAML/SSO options are available in authentication settings
4. Check browser console for any license-related errors (should be none)

## Rollback Instructions

To disable enterprise features:

**For hardcoded bypasses (frontend features like Instant Booking, Cal.ai):**
- Remove `|| true` from the hardcoded bypass lines in the component files
- Example: Change `|| true; // Hardcoded bypass` back to just the environment variable check

**For backend bypasses:**
- Remove the environment variable: `unset NEXT_PUBLIC_HOSTED_CAL_FEATURES`
- Or set it to "0": `export NEXT_PUBLIC_HOSTED_CAL_FEATURES="0"`

## Pattern for Future Enterprise Features

When adding bypasses for new enterprise features, follow these patterns:

**For Backend/Server-side features:**
```typescript
// Check if enterprise features are enabled first
if (process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1") {
  // Allow the feature
  return true; // or appropriate bypass logic
}

// Original license/organization checks below
```

**For Frontend/Client-side features:**
```typescript
// Use hardcoded bypass for maximum reliability
const isOrg = !!session.data?.user?.org?.id || process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1" || true; // Hardcoded bypass
```

**For Conditional Rendering:**
```typescript
{(!isOrg || !isTeamEvent) && !enterpriseBypass ? (
  // Show upgrade screen
) : (
  // Show feature
)}
```

This ensures consistent behavior across all enterprise features and maximum reliability regardless of environment configuration.