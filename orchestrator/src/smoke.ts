import { Storage } from "@google-cloud/storage";
import { OpenCode } from "@opencode/sdk";

if (typeof OpenCode.create !== "function" || typeof Storage !== "function") {
  throw new Error("The OpenCode SDK or Cloud Storage client failed to load.");
}

console.log("OpenCode SDK and Cloud Storage imports are available.");
