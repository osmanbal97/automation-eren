"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { savePlatformAppCredentials } from "@/actions/platform-apps";
import { getDb } from "@/db/client";

const appCredentialsFormSchema = z.object({
  platform: z.enum(["tiktok", "instagram", "youtube"]),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
});

/** Saves one platform's OAuth app credentials (US-021/022/023's authorize/callback routes
 * read these back via getPlatformAppCredentials, preferring them over process.env). This is
 * the "ask for the API key once, configure the rest" entry point -- no other setup is needed
 * before an operator can start connecting niche accounts via OAuth. */
export async function saveAppCredentialsAction(formData: FormData) {
  const { platform, clientId, clientSecret } = appCredentialsFormSchema.parse(Object.fromEntries(formData));
  const db = getDb();
  await savePlatformAppCredentials(db, platform, clientId, clientSecret);
  revalidatePath("/socials");
}
