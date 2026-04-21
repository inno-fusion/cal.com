import { getParsedAppKeysFromSlug } from "../../_utils/getParsedAppKeysFromSlug";
import type { AppKeys } from "../zod";
import { appKeysSchema } from "../zod";

export async function getRazorpayAppKeys(): Promise<AppKeys> {
  return getParsedAppKeysFromSlug("razorpay", appKeysSchema);
}
