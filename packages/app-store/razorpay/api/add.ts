import { createDefaultInstallation } from "@calcom/app-store/_utils/installation";
import type { AppDeclarativeHandler } from "@calcom/types/AppHandler";
import appConfig from "../config.json";

const handler: AppDeclarativeHandler = {
  appType: appConfig.type,
  variant: appConfig.variant,
  slug: appConfig.slug,
  supportsMultipleInstalls: false,
  handlerType: "add",
  // v1: user-level install only. Do NOT forward teamId — see spec §5.1.
  createCredential: ({ appType, user, slug }) => createDefaultInstallation({ appType, user, slug, key: {} }),
  redirect: { newTab: false, url: "/apps/razorpay/setup" },
};

export default handler;
