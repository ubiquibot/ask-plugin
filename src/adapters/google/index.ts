import { createGoogleDriveClient } from "./helpers/google-drive";
import { Env } from "../../types/env";

export function createGoogleAdapters(env: Pick<Env, "GOOGLE_API_KEY">) {
  return {
    drive: createGoogleDriveClient(env),
  };
}
