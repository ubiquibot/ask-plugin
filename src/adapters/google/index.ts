import { createGoogleDriveClient } from "./helpers/google-drive";
import { Env } from "../../types/env";

export function createGoogleAdapters(env: Pick<Env, "GOOGLE_SERVICE_ACCOUNT_KEY">) {
  return {
    drive: createGoogleDriveClient(env),
  };
}
