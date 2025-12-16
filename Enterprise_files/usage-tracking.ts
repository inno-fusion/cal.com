import { Prisma } from "@prisma/client";
import type { PrismaClient as PrismaClientWithoutExtensions } from "@prisma/client";
import { waitUntil } from "@vercel/functions";

import { UsageEvent, LicenseKeySingleton } from "@calcom/ee/common/server/LicenseKeyService";
import { DeploymentRepository } from "@calcom/lib/server/repository/deployment";

async function incrementUsage(prismaClient: PrismaClientWithoutExtensions, event?: UsageEvent) {
  // Skip usage tracking when enterprise features are enabled
  if (process.env.NEXT_PUBLIC_HOSTED_CAL_FEATURES === "1") {
    return;
  }
  
  const deploymentRepo = new DeploymentRepository(prismaClient);
  try {
    const licenseKeyService = await LicenseKeySingleton.getInstance(deploymentRepo);
    await licenseKeyService.incrementUsage(event);
  } catch (e) {
    console.log(e);
  }
}

export function usageTrackingExtention(prismaClient: PrismaClientWithoutExtensions) {
  return Prisma.defineExtension({
    query: {
      booking: {
        async create({ args, query }) {
          waitUntil(incrementUsage(prismaClient, UsageEvent.BOOKING));
          return query(args);
        },
      },
      user: {
        async create({ args, query }) {
          waitUntil(incrementUsage(prismaClient, UsageEvent.USER));
          return query(args);
        },
      },
    },
  });
}
