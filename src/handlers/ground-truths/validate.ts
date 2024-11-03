import { logger } from "../../helpers/errors";

export function validateGroundTruths(truthsString: string | null): string[] {
  let truths;
  if (!truthsString) {
    throw logger.error("Failed to generate ground truths");
  }

  try {
    truths = JSON.parse(truthsString);
  } catch (err) {
    throw logger.error("Failed to parse ground truths");
  }
  if (!Array.isArray(truths)) {
    throw logger.error("Ground truths must be an array");
  }

  if (truths.length > 10) {
    throw logger.error("Ground truths must not exceed 10");
  }

  truths.forEach((truth: string) => {
    if (typeof truth !== "string") {
      throw logger.error("Each ground truth must be a string");
    }
  });

  return truths;
}
