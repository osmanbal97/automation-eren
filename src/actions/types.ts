import type { channelEnum } from "@/db/schema";

/** Which surface triggered an action — recorded on the affected row for auditing. */
export type Channel = (typeof channelEnum.enumValues)[number];
