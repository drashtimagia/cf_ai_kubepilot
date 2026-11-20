/** Llama 3.3 70B (fp8-fast) on Workers AI. Context window is ~24k tokens. */
export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * Workers AI stops at a small default if no limit is set, which truncates
 * long answers and cuts JSON mid-string. Set it explicitly everywhere.
 */
export const MAX_OUTPUT_TOKENS = 1024;
